import { z } from "zod";
import { aiEngine, type InflowConditions } from "../ai/surrogate-model";
import { telemetryBus } from "../telemetry-bus";
import {
  getLatestInMemoryTelemetry,
  getLatestPersistedTelemetry,
} from "../db/telemetry-repository";
import { DatabaseUnavailableError } from "../db/errors";
import {
  evaluateAiRecommendation,
  expireAiRecommendation,
  revokeAiApproval,
  saveAiRecommendation,
} from "../db/recommendations-repository";
import { isSameOriginRequest, operationalIdentity } from "./request-security";
import { logServerError } from "../logging";

const InputSchema = z
  .object({
    plantCode: z.string().min(1).max(50).optional(),
    inflowRateM3h: z.number().finite().min(0).max(1000).optional(),
    inflowTurbidityNtu: z.number().finite().min(0).max(500).optional(),
    inflowDqoMgL: z.number().finite().min(0).max(2000).optional(),
    inflowPh: z.number().finite().min(0).max(14).optional(),
    inflowTemperatureC: z.number().finite().min(0).max(60).optional(),
    currentDosePpm: z.number().finite().min(5).max(50).optional(),
  })
  .strict();

const EvaluationSchema = z
  .object({
    plantCode: z.string().min(1).max(50),
    recommendationId: z.number().int().positive(),
    dosePpm: z.number().finite().min(5).max(50).optional(),
    shiftCode: z.enum(["A", "B", "C"]),
    status: z.enum(["APROBADA", "RECHAZADA"]).default("APROBADA"),
    notes: z.string().max(500).optional(),
  })
  .strict();

const ExpireSchema = z
  .object({
    recommendationId: z.number().int().positive(),
    plantCode: z.string().min(1).max(50).default("PL_NORTE"),
    shiftCode: z.enum(["A", "B", "C"]),
  })
  .strict();
const RevokeSchema = z
  .object({
    recommendationId: z.number().int().positive(),
    plantCode: z.string().min(1).max(50),
    shiftCode: z.enum(["A", "B", "C"]),
  })
  .strict();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

async function parseBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new TypeError("Request body must be valid JSON.");
  }
}

export async function handleAiOptimizeRequest(request: Request): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed. Use POST." }, 405);
  if (!isSameOriginRequest(request))
    return json({ error: "Optimization requests must come from this application origin." }, 403);
  try {
    const parsed = InputSchema.safeParse(await parseBody(request));
    if (!parsed.success)
      return json({ error: "Invalid optimization input.", details: parsed.error.flatten() }, 400);
    const body = parsed.data;
    const memoryCandidate = telemetryBus.getLatest() ?? getLatestInMemoryTelemetry();
    const requestedPlant = body.plantCode ?? memoryCandidate?.plantCode ?? "PL_NORTE";
    const latestTelemetry =
      memoryCandidate?.plantCode === requestedPlant
        ? memoryCandidate
        : await getLatestPersistedTelemetry(requestedPlant);
    const required = {
      inflowRateM3h: body.inflowRateM3h ?? latestTelemetry?.inflowRateM3h,
      inflowTurbidityNtu: body.inflowTurbidityNtu ?? latestTelemetry?.inflowTurbidityNtu,
      inflowDqoMgL: body.inflowDqoMgL ?? latestTelemetry?.inflowDqoMgL,
      inflowPh: body.inflowPh ?? latestTelemetry?.inflowPh,
      currentDosePpm: body.currentDosePpm ?? latestTelemetry?.pacDosePpm,
    };
    if (Object.values(required).some((value) => value === undefined)) {
      return json(
        {
          error:
            "No recent process telemetry is available; provide the complete required inflow conditions.",
        },
        409,
      );
    }
    const inflowConditions: InflowConditions = {
      inflowRateM3h: required.inflowRateM3h!,
      inflowTurbidityNtu: required.inflowTurbidityNtu!,
      inflowDqoMgL: required.inflowDqoMgL!,
      inflowPh: required.inflowPh!,
      ...(body.inflowTemperatureC !== undefined
        ? { inflowTemperatureC: body.inflowTemperatureC }
        : latestTelemetry?.inflowTemperatureC !== undefined
          ? { inflowTemperatureC: latestTelemetry.inflowTemperatureC }
          : {}),
      currentDosePpm: required.currentDosePpm!,
    };
    const result = aiEngine.optimize(inflowConditions);
    try {
      const recommendationId = await saveAiRecommendation(result, requestedPlant);
      return json({ ok: true, persisted: true, recommendationId, inflowConditions, result }, 201);
    } catch (error) {
      if (!(error instanceof DatabaseUnavailableError)) throw error;
      return json(
        {
          ok: true,
          persisted: false,
          recommendationId: null,
          inflowConditions,
          result,
          warning:
            "The result is calculated but was not saved; approval is disabled until database persistence is available.",
        },
        200,
      );
    }
  } catch (error) {
    if (error instanceof TypeError) return json({ error: error.message }, 400);
    logServerError("AI optimization failed.", error);
    return json(
      { error: "Optimization failed." },
      error instanceof DatabaseUnavailableError ? 503 : 500,
    );
  }
}

export async function handleAiApproveRequest(request: Request): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed. Use POST." }, 405);
  if (!isSameOriginRequest(request))
    return json({ error: "Operational decisions must come from this application origin." }, 403);
  try {
    const parsed = EvaluationSchema.safeParse(await parseBody(request));
    if (!parsed.success)
      return json(
        { error: "Invalid recommendation decision.", details: parsed.error.flatten() },
        400,
      );
    const identity = operationalIdentity();
    if (!identity)
      return json(
        {
          error:
            "Configure OPERATOR_NAME and OPERATOR_ROLE before recording operational decisions.",
        },
        503,
      );
    const decision = await evaluateAiRecommendation({
      recommendationId: parsed.data.recommendationId,
      plantCode: parsed.data.plantCode,
      status: parsed.data.status,
      shiftCode: parsed.data.shiftCode,
      operatorName: identity.name,
      operatorRole: identity.role,
      ...(parsed.data.dosePpm !== undefined ? { expectedDose: parsed.data.dosePpm } : {}),
      ...(parsed.data.notes ? { notes: parsed.data.notes } : {}),
    });
    return json({ ok: true, ...decision, simulatedApplication: "NOT_SENT_TO_PLC" });
  } catch (error) {
    if (error instanceof TypeError) return json({ error: error.message }, 400);
    if (error instanceof DatabaseUnavailableError)
      return json({ error: "Database persistence is unavailable." }, 503);
    if (
      error instanceof Error &&
      error.message === "Recommendation not found or already evaluated."
    )
      return json({ error: error.message }, 409);
    logServerError("AI recommendation decision failed.", error);
    return json({ error: "Recommendation decision could not be recorded." }, 500);
  }
}

export async function handleAiExpireRequest(request: Request): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed. Use POST." }, 405);
  if (!isSameOriginRequest(request))
    return json({ error: "Operational decisions must come from this application origin." }, 403);
  try {
    const parsed = ExpireSchema.safeParse(await parseBody(request));
    if (!parsed.success)
      return json(
        { error: "Invalid recommendation expiration request.", details: parsed.error.flatten() },
        400,
      );
    const identity = operationalIdentity();
    if (!identity)
      return json(
        { error: "Configure OPERATOR_NAME and OPERATOR_ROLE before expiring recommendations." },
        503,
      );
    const changed = await expireAiRecommendation({
      ...parsed.data,
      operatorName: identity.name,
      operatorRole: identity.role,
    });
    return changed
      ? json({ ok: true, status: "EXPIRADA" })
      : json({ error: "Pending recommendation not found." }, 404);
  } catch (error) {
    if (error instanceof DatabaseUnavailableError)
      return json({ error: "Database persistence is unavailable." }, 503);
    logServerError("AI recommendation expiration failed.", error);
    return json({ error: "Recommendation expiration could not be recorded." }, 500);
  }
}

export async function handleAiRevokeRequest(request: Request): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed. Use POST." }, 405);
  if (!isSameOriginRequest(request))
    return json({ error: "Operational decisions must come from this application origin." }, 403);
  try {
    const parsed = RevokeSchema.safeParse(await parseBody(request));
    if (!parsed.success)
      return json(
        { error: "Invalid approval reversal request.", details: parsed.error.flatten() },
        400,
      );
    const identity = operationalIdentity();
    if (!identity)
      return json(
        {
          error: "Configure OPERATOR_NAME and OPERATOR_ROLE before changing operational decisions.",
        },
        503,
      );
    await revokeAiApproval(
      parsed.data.recommendationId,
      parsed.data.plantCode,
      identity.name,
      identity.role,
      parsed.data.shiftCode,
    );
    return json({
      ok: true,
      status: "RECHAZADA",
      simulatedApplication: "REVERSED_FOR_NEXT_SIMULATOR_PACKET",
    });
  } catch (error) {
    if (error instanceof DatabaseUnavailableError)
      return json({ error: "Database persistence is unavailable." }, 503);
    if (error instanceof Error && error.message === "Approved recommendation not found.")
      return json({ error: error.message }, 404);
    logServerError("AI approval reversal failed.", error);
    return json({ error: "Approval reversal could not be recorded." }, 500);
  }
}

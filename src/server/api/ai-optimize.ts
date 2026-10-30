import { z } from "zod";
import { aiEngine, type InflowConditions } from "../ai/surrogate-model";
import { telemetryBus } from "../telemetry-bus";
import { getLatestInMemoryTelemetry } from "../db/telemetry-repository";
import { DatabaseUnavailableError, evaluateAiRecommendation, expireAiRecommendation, saveAiRecommendation } from "../db/recommendations-repository";

const InputSchema = z.object({
  plantCode: z.string().min(1).max(50).optional(),
  inflowRateM3h: z.number().finite().min(0).max(1000).optional(),
  inflowTurbidityNtu: z.number().finite().min(0).max(500).optional(),
  inflowDqoMgL: z.number().finite().min(0).max(2000).optional(),
  inflowPh: z.number().finite().min(0).max(14).optional(),
  inflowTemperatureC: z.number().finite().min(0).max(60).optional(),
  currentDosePpm: z.number().finite().min(5).max(50).optional(),
}).strict();

const EvaluationSchema = z.object({
  recommendationId: z.number().int().positive(),
  dosePpm: z.number().finite().min(5).max(50).optional(),
  status: z.enum(["APROBADA", "RECHAZADA"]).default("APROBADA"),
  notes: z.string().max(500).optional(),
}).strict();

const ExpireSchema = z.object({ recommendationId: z.number().int().positive(), plantCode: z.string().min(1).max(50).default("PL_NORTE") }).strict();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

async function parseBody(request: Request): Promise<unknown> {
  try { return await request.json(); } catch { throw new TypeError("Request body must be valid JSON."); }
}

export async function handleAiOptimizeRequest(request: Request): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed. Use POST." }, 405);
  try {
    const parsed = InputSchema.safeParse(await parseBody(request));
    if (!parsed.success) return json({ error: "Invalid optimization input.", details: parsed.error.flatten() }, 400);
    const body = parsed.data;
    const candidate = telemetryBus.getLatest() ?? getLatestInMemoryTelemetry();
    const latestTelemetry = candidate && (!body.plantCode || candidate.plantCode === body.plantCode) ? candidate : null;
    const required = {
      inflowRateM3h: body.inflowRateM3h ?? latestTelemetry?.inflowRateM3h,
      inflowTurbidityNtu: body.inflowTurbidityNtu ?? latestTelemetry?.inflowTurbidityNtu,
      inflowDqoMgL: body.inflowDqoMgL ?? latestTelemetry?.inflowDqoMgL,
      inflowPh: body.inflowPh ?? latestTelemetry?.inflowPh,
      currentDosePpm: body.currentDosePpm ?? latestTelemetry?.pacDosePpm,
    };
    if (Object.values(required).some((value) => value === undefined)) {
      return json({ error: "No recent process telemetry is available; provide the complete required inflow conditions." }, 409);
    }
    const inflowConditions: InflowConditions = {
      inflowRateM3h: required.inflowRateM3h!,
      inflowTurbidityNtu: required.inflowTurbidityNtu!,
      inflowDqoMgL: required.inflowDqoMgL!,
      inflowPh: required.inflowPh!,
      ...(body.inflowTemperatureC !== undefined ? { inflowTemperatureC: body.inflowTemperatureC } :
        latestTelemetry?.inflowTemperatureC !== undefined ? { inflowTemperatureC: latestTelemetry.inflowTemperatureC } : {}),
      currentDosePpm: required.currentDosePpm!,
    };
    const result = aiEngine.optimize(inflowConditions);
    try {
      const recommendationId = await saveAiRecommendation(result, body.plantCode ?? latestTelemetry?.plantCode ?? "PL_NORTE");
      return json({ ok: true, persisted: true, recommendationId, inflowConditions, result }, 201);
    } catch (error) {
      if (!(error instanceof DatabaseUnavailableError)) throw error;
      return json({ ok: true, persisted: false, recommendationId: null, inflowConditions, result, warning: "The result is calculated but was not saved; approval is disabled until database persistence is available." }, 200);
    }
  } catch (error) {
    if (error instanceof TypeError) return json({ error: error.message }, 400);
    console.error("[AquaSense AI] Optimization failed.", error instanceof Error ? error.name : "Unknown error");
    return json({ error: "Optimization failed." }, error instanceof DatabaseUnavailableError ? 503 : 500);
  }
}

export async function handleAiApproveRequest(request: Request): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed. Use POST." }, 405);
  try {
    const parsed = EvaluationSchema.safeParse(await parseBody(request));
    if (!parsed.success) return json({ error: "Invalid recommendation decision.", details: parsed.error.flatten() }, 400);
    const operatorName = process.env["OPERATOR_NAME"]?.trim();
    const operatorRole = process.env["OPERATOR_ROLE"]?.trim();
    if (!operatorName || !operatorRole) return json({ error: "Configure OPERATOR_NAME and OPERATOR_ROLE before recording operational decisions." }, 503);
    const decision = await evaluateAiRecommendation({
      recommendationId: parsed.data.recommendationId,
      status: parsed.data.status,
      operatorName,
      operatorRole,
      ...(parsed.data.dosePpm !== undefined ? { expectedDose: parsed.data.dosePpm } : {}),
      ...(parsed.data.notes ? { notes: parsed.data.notes } : {}),
    });
    return json({ ok: true, ...decision, simulatedApplication: "NOT_SENT_TO_PLC" });
  } catch (error) {
    if (error instanceof TypeError) return json({ error: error.message }, 400);
    if (error instanceof DatabaseUnavailableError) return json({ error: "Database persistence is unavailable." }, 503);
    if (error instanceof Error && error.message === "Recommendation not found or already evaluated.") return json({ error: error.message }, 409);
    console.error("[AquaSense AI] Recommendation decision failed.", error instanceof Error ? error.name : "Unknown error");
    return json({ error: "Recommendation decision could not be recorded." }, 500);
  }
}

export async function handleAiExpireRequest(request: Request): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Method not allowed. Use POST." }, 405);
  try {
    const parsed = ExpireSchema.safeParse(await parseBody(request));
    if (!parsed.success) return json({ error: "Invalid recommendation expiration request.", details: parsed.error.flatten() }, 400);
    const changed = await expireAiRecommendation(parsed.data.recommendationId, parsed.data.plantCode);
    return changed ? json({ ok: true, status: "EXPIRADA" }) : json({ error: "Pending recommendation not found." }, 404);
  } catch (error) {
    if (error instanceof DatabaseUnavailableError) return json({ error: "Database persistence is unavailable." }, 503);
    console.error("[AquaSense AI] Recommendation expiration failed.", error instanceof Error ? error.name : "Unknown error");
    return json({ error: "Recommendation expiration could not be recorded." }, 500);
  }
}

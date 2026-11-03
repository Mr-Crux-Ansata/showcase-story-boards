import { z } from "zod";
import {
  createAlert,
  createHandover,
  getTelemetryHistory,
  listAlerts,
  listHandovers,
  listOperationsLog,
  listRecommendations,
  updateAlert,
} from "../db/operations-repository";
import { DatabaseUnavailableError } from "../db/errors";
import { isSameOriginRequest, operationalIdentity } from "./request-security";
import { logServerError } from "../logging";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

const HandoverSchema = z
  .object({
    plantCode: z.string().min(1).max(50).default("PL_NORTE"),
    shiftCode: z.enum(["A", "B", "C"]),
    handoverDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    volumeTreatedM3: z.number().finite().nonnegative(),
    averageFlowRateM3h: z.number().finite().nonnegative(),
    averageTurbidityNtu: z.number().finite().nonnegative(),
    averageDqoMgL: z.number().finite().nonnegative(),
    averageSstMgL: z.number().finite().nonnegative(),
    nom001CompliancePct: z.number().finite().min(0).max(100),
  })
  .strict();

const AlertUpdateSchema = z
  .object({
    plantCode: z.string().min(1).max(50),
    status: z.enum(["abierta", "pausada", "resuelta"]),
    shiftCode: z.enum(["A", "B", "C"]),
    pausedUntil: z.string().datetime().optional(),
    note: z.string().max(500).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.status === "pausada" && !value.pausedUntil) {
      ctx.addIssue({
        code: "custom",
        path: ["pausedUntil"],
        message: "pausedUntil is required when pausing an alert.",
      });
    }
    if (value.status !== "pausada" && value.pausedUntil) {
      ctx.addIssue({
        code: "custom",
        path: ["pausedUntil"],
        message: "pausedUntil is only valid for paused alerts.",
      });
    }
    if (value.pausedUntil && Date.parse(value.pausedUntil) <= Date.now()) {
      ctx.addIssue({
        code: "custom",
        path: ["pausedUntil"],
        message: "pausedUntil must be in the future.",
      });
    }
  });

const AlertCreateSchema = z
  .object({
    plantCode: z.string().min(1).max(50),
    shiftCode: z.enum(["A", "B", "C"]),
    alertCode: z.enum(["pac", "filtro", "membrana"]),
    category: z.enum(["sobrecosto", "quimico", "mantenimiento"]),
    severity: z.enum(["CRITICA", "ALTA", "MODERADA", "INFORMATIVA"]),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(20000),
  })
  .strict();

function pagination(url: URL) {
  const limit = Number(url.searchParams.get("limit") ?? 50);
  const offset = Number(url.searchParams.get("offset") ?? 0);
  const plantCode = url.searchParams.get("plantCode") ?? "PL_NORTE";
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 200 ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    !/^[A-Za-z0-9_-]{1,50}$/.test(plantCode)
  ) {
    throw new TypeError("Invalid plantCode, limit, or offset.");
  }
  return { plantCode, limit, offset };
}

async function parseJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new TypeError("Request body must be valid JSON.");
  }
}

export async function handleOperationsApi(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  try {
    if (path === "/api/operator/context") {
      if (request.method !== "GET") return json({ error: "Method not allowed." }, 405);
      const identity = operationalIdentity();
      return json({
        configured: Boolean(identity),
        operatorName: identity?.name ?? null,
        operatorRole: identity?.role ?? null,
      });
    }
    if (
      [
        "/api/telemetry/history",
        "/api/alerts",
        "/api/operations-log",
        "/api/shift-handovers",
        "/api/ai/recommendations",
      ].includes(path)
    ) {
      if (path === "/api/alerts" && request.method === "POST") {
        if (!isSameOriginRequest(request))
          return json(
            { error: "Operational actions must come from this application origin." },
            403,
          );
        const parsed = AlertCreateSchema.safeParse(await parseJson(request));
        if (!parsed.success)
          return json({ error: "Invalid alert payload.", details: parsed.error.flatten() }, 400);
        const identity = operationalIdentity();
        if (!identity)
          return json(
            { error: "Configure OPERATOR_NAME and OPERATOR_ROLE before creating alerts." },
            503,
          );
        const alert = await createAlert({
          ...parsed.data,
          operator: identity.name,
          operatorRole: identity.role,
        });
        return json({ ok: true, alert }, 201);
      }
      if (path === "/api/shift-handovers" && request.method === "POST") {
        if (!isSameOriginRequest(request))
          return json(
            { error: "Operational actions must come from this application origin." },
            403,
          );
        const parsed = HandoverSchema.safeParse(await parseJson(request));
        if (!parsed.success)
          return json({ error: "Invalid handover payload.", details: parsed.error.flatten() }, 400);
        const identity = operationalIdentity();
        if (!identity)
          return json(
            { error: "Configure OPERATOR_NAME and OPERATOR_ROLE before recording a handover." },
            503,
          );
        const result = await createHandover({
          ...parsed.data,
          signedBy: identity.name,
          operatorRole: identity.role,
        });
        return json({ ok: true, handover: result }, 201);
      }
      if (request.method !== "GET") return json({ error: "Method not allowed." }, 405);
      const page = pagination(url);
      if (path === "/api/telemetry/history")
        return json(await getTelemetryHistory(page.plantCode, page.limit, page.offset));
      if (path === "/api/alerts")
        return json(await listAlerts(page.plantCode, page.limit, page.offset));
      if (path === "/api/operations-log")
        return json(await listOperationsLog(page.plantCode, page.limit, page.offset));
      if (path === "/api/shift-handovers")
        return json(await listHandovers(page.plantCode, page.limit, page.offset));
      return json(await listRecommendations(page.plantCode, page.limit, page.offset));
    }

    const alertMatch = path.match(/^\/api\/alerts\/(\d+)$/);
    if (alertMatch) {
      if (request.method !== "PATCH") return json({ error: "Method not allowed." }, 405);
      if (!isSameOriginRequest(request))
        return json({ error: "Operational actions must come from this application origin." }, 403);
      const alertId = Number(alertMatch[1]);
      if (!Number.isSafeInteger(alertId) || alertId <= 0)
        return json({ error: "Invalid alert id." }, 400);
      const parsed = AlertUpdateSchema.safeParse(await parseJson(request));
      if (!parsed.success)
        return json({ error: "Invalid alert update.", details: parsed.error.flatten() }, 400);
      const identity = operationalIdentity();
      if (!identity)
        return json(
          { error: "Configure OPERATOR_NAME and OPERATOR_ROLE before changing alert status." },
          503,
        );
      const result = await updateAlert({
        alertId,
        plantCode: parsed.data.plantCode,
        status: parsed.data.status,
        shiftCode: parsed.data.shiftCode,
        operator: identity.name,
        operatorRole: identity.role,
        ...(parsed.data.pausedUntil ? { pausedUntil: parsed.data.pausedUntil } : {}),
        ...(parsed.data.note ? { note: parsed.data.note } : {}),
      });
      return result ? json({ ok: true, alert: result }) : json({ error: "Alert not found." }, 404);
    }
    return null;
  } catch (error) {
    if (error instanceof DatabaseUnavailableError)
      return json({ error: "Database persistence is unavailable." }, 503);
    if (error instanceof TypeError) return json({ error: error.message }, 400);
    logServerError("Operational API request failed.", error);
    return json({ error: "The requested operation could not be completed." }, 500);
  }
}

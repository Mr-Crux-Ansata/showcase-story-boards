import { TelemetryPayloadSchema, type TelemetrySnapshot } from "../../lib/types/telemetry";
import { insertTelemetrySnapshot } from "../db/telemetry-repository";
import { telemetryBus } from "../telemetry-bus";
import { timingSafeEqual } from "node:crypto";

const EXPECTED_GATEWAY_KEY = process.env["EDGE_GATEWAY_KEY"];

export async function handleEdgeTelemetryRequest(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed. Use POST." }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Validación de Autenticación del Gateway
  if (!EXPECTED_GATEWAY_KEY) {
    return new Response(JSON.stringify({ error: "Gateway authentication is not configured." }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
  const providedKey = request.headers.get("x-edge-gateway-key") || request.headers.get("X-Edge-Gateway-Key");
  const provided = Buffer.from(providedKey ?? "");
  const expected = Buffer.from(EXPECTED_GATEWAY_KEY);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return new Response(
      JSON.stringify({ error: "Unauthorized gateway." }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  try {
    const rawBody = await request.json();
    const parseResult = TelemetryPayloadSchema.safeParse(rawBody);

    if (!parseResult.success) {
      return new Response(
        JSON.stringify({
          error: "Payload validation failed",
          details: parseResult.error.flatten(),
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const payload = parseResult.data;
    const nowIso = payload.timestamp || new Date().toISOString();

    // Verificación de integridad y límites normativos NOM-001
    const nom001Compliant = payload.effluentTurbidityNtu < 4.0 && payload.effluentDqoMgL < 60.0;
    
    // Regla de calidad de señal OT (detección de anomalías en sensor)
    let dataQualityFlag: "GOOD" | "BAD" | "UNCERTAIN" | "STUCK" = "GOOD";
    if (payload.inflowPh < 5.0 || payload.inflowPh > 9.5) {
      dataQualityFlag = "UNCERTAIN";
    }

    const snapshot: TelemetrySnapshot = {
      ...payload,
      recordedAt: nowIso,
      nom001Compliant,
      dataQualityFlag,
    };

    // 1. Persistencia en Base de Datos SQL Server / Caché
    const snapshotId = await insertTelemetrySnapshot(snapshot);
    if (snapshotId) {
      snapshot.snapshotId = snapshotId;
    }

    // 2. Notificación en tiempo real al bus de eventos
    telemetryBus.publish(snapshot);

    const persisted = snapshotId !== null;
    return new Response(
      JSON.stringify({
        ok: true,
        message: persisted ? "Telemetry packet stored in SQL Server." : "Telemetry packet accepted in temporary in-memory fallback; it was not persisted.",
        persisted,
        storage: persisted ? "sql-server" : "memory-fallback",
        snapshotId,
        recordedAt: nowIso,
        nom001Compliant,
        dataQualityFlag,
      }),
      {
        status: persisted ? 201 : 202,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    console.error("[AquaSense API] Error procesando telemetría del Gateway:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error processing telemetry" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

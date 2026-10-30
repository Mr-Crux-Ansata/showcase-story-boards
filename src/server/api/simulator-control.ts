import { timingSafeEqual } from "node:crypto";
import sql from "mssql";
import { getDbPool } from "../db/client";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

function authorized(request: Request) {
  const expectedKey = process.env["EDGE_GATEWAY_KEY"];
  const suppliedKey = request.headers.get("x-edge-gateway-key") ?? "";
  if (!expectedKey) return false;
  const supplied = Buffer.from(suppliedKey);
  const expected = Buffer.from(expectedKey);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export async function handleSimulatorControlRequest(request: Request) {
  if (request.method !== "GET") return json({ error: "Method not allowed." }, 405);
  if (!authorized(request)) return json({ error: process.env["EDGE_GATEWAY_KEY"] ? "Unauthorized gateway." : "Gateway authentication is not configured." }, process.env["EDGE_GATEWAY_KEY"] ? 401 : 503);

  const pool = await getDbPool();
  if (pool) {
    const result = await pool.request().input("PlantCode", sql.NVarChar(50), "PL_NORTE").query<{ dosePpm: number }>(`
      SELECT TOP (1) r.RecommendedValue AS dosePpm
      FROM dbo.AiRecommendations r JOIN dbo.Plants p ON p.PlantId = r.PlantId
      WHERE p.PlantCode = @PlantCode AND r.ParameterName = N'PAC_DOSE' AND r.Status = N'APROBADA'
      ORDER BY r.EvaluatedAt DESC, r.RecommendationId DESC;
    `);
    const dose = result.recordset[0]?.dosePpm;
    if (dose !== undefined) return json({ mode: "SIMULATION", source: "approved-recommendation", setpointPpm: dose, plcAcknowledged: false });
  }

  const configuredDose = Number(process.env["PAC_INITIAL_SETPOINT"]);
  if (Number.isFinite(configuredDose) && configuredDose >= 5 && configuredDose <= 50) {
    return json({ mode: "SIMULATION", source: "configured-simulation", setpointPpm: configuredDose, plcAcknowledged: false, persisted: Boolean(pool) });
  }
  return json({ error: "No simulated PAC setpoint is configured and no approved recommendation is available." }, 503);
}

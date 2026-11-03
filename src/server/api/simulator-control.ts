import { timingSafeEqual } from "node:crypto";
import sql from "mssql";
import { getDbPool } from "../db/client";
import { logServerError } from "../logging";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

function authorized(request: Request) {
  const expectedKey = process.env["EDGE_GATEWAY_KEY"];
  const suppliedKey = request.headers.get("x-edge-gateway-key") ?? "";
  if (!expectedKey || expectedKey.length < 32) return false;
  const supplied = Buffer.from(suppliedKey);
  const expected = Buffer.from(expectedKey);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export async function handleSimulatorControlRequest(request: Request) {
  if (request.method !== "GET") return json({ error: "Method not allowed." }, 405);
  if (!process.env["EDGE_GATEWAY_KEY"] || process.env["EDGE_GATEWAY_KEY"]!.length < 32)
    return json({ error: "Gateway authentication is not configured." }, 503);
  if (!authorized(request)) return json({ error: "Unauthorized gateway." }, 401);
  const plantCode = new URL(request.url).searchParams.get("plantCode") ?? "PL_NORTE";
  if (!/^[A-Za-z0-9_-]{1,50}$/.test(plantCode)) return json({ error: "Invalid plantCode." }, 400);

  const pool = await getDbPool();
  if (pool) {
    try {
      const result = await pool.request().input("PlantCode", sql.NVarChar(50), plantCode).query<{
        dosePpm: number;
      }>(`
        SELECT TOP (1) r.RecommendedValue AS dosePpm
        FROM dbo.AiRecommendations r JOIN dbo.Plants p ON p.PlantId = r.PlantId
        WHERE p.PlantCode = @PlantCode AND r.ParameterName = N'PAC_DOSE' AND r.Status = N'APROBADA'
        ORDER BY r.EvaluatedAt DESC, r.RecommendationId DESC;
      `);
      const dose = result.recordset[0]?.dosePpm;
      if (dose !== undefined)
        return json({
          mode: "SIMULATION",
          source: "approved-recommendation",
          setpointPpm: dose,
          plcAcknowledged: false,
          databaseStatus: "connected",
        });
    } catch (error) {
      logServerError("Simulator setpoint lookup failed.", error);
      const details = error as { code?: unknown; number?: unknown };
      return json(
        {
          error: "Unable to read the simulated setpoint from SQL Server.",
          databaseStatus: "query-error",
          ...(typeof details.code === "string" ? { databaseErrorCode: details.code } : {}),
          ...(typeof details.number === "number" ? { databaseErrorNumber: details.number } : {}),
        },
        500,
      );
    }
  }

  const configuredDose = Number(process.env["PAC_INITIAL_SETPOINT"]);
  if (Number.isFinite(configuredDose) && configuredDose >= 5 && configuredDose <= 50) {
    return json({
      mode: "SIMULATION",
      source: "configured-simulation",
      setpointPpm: configuredDose,
      plcAcknowledged: false,
      persisted: Boolean(pool),
      databaseStatus: pool ? "connected" : "unavailable",
    });
  }
  return json(
    {
      error: "No simulated PAC setpoint is configured and no approved recommendation is available.",
      databaseStatus: "unavailable",
    },
    503,
  );
}

import sql from "mssql";
import { getDbPool } from "./client";
import { DatabaseUnavailableError } from "./errors";
import type { TelemetrySnapshot } from "../../lib/types/telemetry";

async function database() {
  const pool = await getDbPool();
  if (!pool) throw new DatabaseUnavailableError();
  return pool;
}

async function plantId(pool: sql.ConnectionPool, plantCode: string) {
  const result = await pool
    .request()
    .input("PlantCode", sql.NVarChar(50), plantCode)
    .query<{ PlantId: number }>(
      "SELECT PlantId FROM dbo.Plants WHERE PlantCode = @PlantCode AND IsActive = 1",
    );
  const id = result.recordset[0]?.PlantId;
  if (id === undefined) throw new Error("Unknown plant.");
  return id;
}

export async function getTelemetryHistory(plantCode: string, limit: number, offset: number) {
  const pool = await database();
  const id = await plantId(pool, plantCode);
  const result = await pool
    .request()
    .input("PlantId", sql.Int, id)
    .input("Limit", sql.Int, limit)
    .input("Offset", sql.Int, offset).query(`
      SELECT SnapshotId AS snapshotId, RecordedAt AS recordedAt, s.ShiftCode AS shiftCode,
        p.PlantCode AS plantCode, InflowRateM3h AS inflowRateM3h,
        InflowTurbidityNtu AS inflowTurbidityNtu, InflowDqoMgL AS inflowDqoMgL,
        InflowPh AS inflowPh, InflowTemperatureC AS inflowTemperatureC,
        PacDosePpm AS pacDosePpm, PacPumpFrequencyHz AS pacPumpFrequencyHz,
        MbrDissolvedOxygenMgL AS mbrDissolvedOxygenMgL, BlowerFrequencyHz AS blowerFrequencyHz,
        EffluentTurbidityNtu AS effluentTurbidityNtu, EffluentDqoMgL AS effluentDqoMgL,
        EffluentSstMgL AS effluentSstMgL, EffluentPh AS effluentPh,
        Nom001Compliant AS nom001Compliant, DataQualityFlag AS dataQualityFlag
      FROM dbo.TelemetrySnapshots t
      JOIN dbo.Plants p ON p.PlantId = t.PlantId
      JOIN dbo.Shifts s ON s.ShiftId = t.ShiftId
      WHERE t.PlantId = @PlantId
      ORDER BY RecordedAt DESC, SnapshotId DESC
      OFFSET @Offset ROWS FETCH NEXT @Limit ROWS ONLY;
    `);
  const count = await pool
    .request()
    .input("PlantId", sql.Int, id)
    .query<{ total: number }>(
      "SELECT COUNT_BIG(*) AS total FROM dbo.TelemetrySnapshots WHERE PlantId = @PlantId",
    );
  return {
    data: result.recordset as unknown as TelemetrySnapshot[],
    total: Number(count.recordset[0]?.total ?? 0),
    limit,
    offset,
  };
}

export async function listAlerts(plantCode: string, limit: number, offset: number) {
  const pool = await database();
  const id = await plantId(pool, plantCode);
  await pool.request().input("PlantId", sql.Int, id).query(`
    UPDATE dbo.OperationalAlerts SET Status = N'abierta', PausedUntil = NULL
    WHERE PlantId = @PlantId AND Status = N'pausada' AND PausedUntil <= SYSDATETIMEOFFSET();
  `);
  const result = await pool
    .request()
    .input("PlantId", sql.Int, id)
    .input("Limit", sql.Int, limit)
    .input("Offset", sql.Int, offset).query(`
      SELECT AlertId AS alertId, AlertCode AS alertCode, Category AS category, Severity AS severity,
        Title AS title, Description AS description, Status AS status, TriggeredAt AS triggeredAt,
        PausedUntil AS pausedUntil, ResolvedAt AS resolvedAt, ResolvedBy AS resolvedBy,
        ResolutionNote AS resolutionNote
      FROM dbo.OperationalAlerts WHERE PlantId = @PlantId
      ORDER BY CASE WHEN Status = N'abierta' THEN 0 WHEN Status = N'pausada' THEN 1 ELSE 2 END,
        TriggeredAt DESC, AlertId DESC
      OFFSET @Offset ROWS FETCH NEXT @Limit ROWS ONLY;
    `);
  const count = await pool
    .request()
    .input("PlantId", sql.Int, id)
    .query<{ total: number }>(
      "SELECT COUNT_BIG(*) AS total FROM dbo.OperationalAlerts WHERE PlantId = @PlantId",
    );
  return {
    data: result.recordset,
    total: Number(count.recordset[0]?.total ?? 0),
    limit,
    offset,
  };
}

export async function updateAlert(input: {
  alertId: number;
  plantCode: string;
  status: "abierta" | "pausada" | "resuelta";
  operator: string;
  operatorRole: string;
  shiftCode: "A" | "B" | "C";
  pausedUntil?: string;
  note?: string;
}) {
  const pool = await database();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const request = new sql.Request(transaction)
      .input("AlertId", sql.BigInt, input.alertId)
      .input("PlantCode", sql.NVarChar(50), input.plantCode)
      .input("Status", sql.NVarChar(20), input.status)
      .input("Operator", sql.NVarChar(100), input.operator)
      .input(
        "PausedUntil",
        sql.DateTimeOffset,
        input.pausedUntil ? new Date(input.pausedUntil) : null,
      )
      .input("Note", sql.NVarChar(500), input.note ?? null);
    const result = await request.query<{
      alertId: number;
      plantId: number;
      title: string;
      status: string;
      pausedUntil: string | null;
      resolvedAt: string | null;
      resolvedBy: string | null;
    }>(`
      UPDATE dbo.OperationalAlerts
      SET Status = @Status,
          PausedUntil = CASE WHEN @Status = N'pausada' THEN @PausedUntil ELSE NULL END,
          ResolvedAt = CASE WHEN @Status = N'resuelta' THEN SYSDATETIMEOFFSET() ELSE NULL END,
          ResolvedBy = CASE WHEN @Status = N'resuelta' THEN @Operator ELSE NULL END,
          ResolutionNote = CASE WHEN @Status = N'resuelta' THEN @Note ELSE NULL END
      OUTPUT INSERTED.AlertId AS alertId, INSERTED.PlantId AS plantId, INSERTED.Title AS title,
        INSERTED.Status AS status, INSERTED.PausedUntil AS pausedUntil,
        INSERTED.ResolvedAt AS resolvedAt, INSERTED.ResolvedBy AS resolvedBy
      WHERE AlertId = @AlertId AND PlantId = (SELECT PlantId FROM dbo.Plants WHERE PlantCode = @PlantCode AND IsActive = 1);
    `);
    const alert = result.recordset[0];
    if (!alert) {
      await transaction.rollback();
      return null;
    }
    const log = new sql.Request(transaction);
    log
      .input("PlantId", sql.Int, alert.plantId)
      .input("ShiftCode", sql.Char(1), input.shiftCode)
      .input("Title", sql.NVarChar(200), `Alerta ${alert.status}: ${alert.title}`)
      .input("Detail", sql.NVarChar(sql.MAX), input.note ?? `Estado actualizado a ${alert.status}.`)
      .input("Operator", sql.NVarChar(100), input.operator)
      .input("Role", sql.NVarChar(100), input.operatorRole);
    await log.query(`
      DECLARE @ShiftId INT = (SELECT ShiftId FROM dbo.Shifts WHERE ShiftCode = @ShiftCode);
      INSERT dbo.OperationsLog (PlantId, ShiftId, EventKind, Title, Detail, OperatorName, OperatorRole, PlcAckStatus)
      VALUES (@PlantId, @ShiftId, N'alerta', @Title, @Detail, @Operator, @Role, N'NOT_APPLICABLE');
    `);
    await transaction.commit();
    const { plantId: _plantId, title: _title, ...response } = alert;
    return response;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function createAlert(input: {
  plantCode: string;
  shiftCode: "A" | "B" | "C";
  alertCode: "pac" | "filtro" | "membrana";
  category: "sobrecosto" | "quimico" | "mantenimiento";
  severity: "CRITICA" | "ALTA" | "MODERADA" | "INFORMATIVA";
  title: string;
  description: string;
  operator: string;
  operatorRole: string;
}) {
  const pool = await database();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const request = new sql.Request(transaction);
    request
      .input("PlantCode", sql.NVarChar(50), input.plantCode)
      .input("ShiftCode", sql.Char(1), input.shiftCode)
      .input("AlertCode", sql.NVarChar(50), input.alertCode)
      .input("Category", sql.NVarChar(50), input.category)
      .input("Severity", sql.NVarChar(20), input.severity)
      .input("Title", sql.NVarChar(200), input.title)
      .input("Description", sql.NVarChar(sql.MAX), input.description);
    const inserted = await request.query<{ alertId: number; plantId: number; title: string }>(`
      DECLARE @PlantId INT = (SELECT PlantId FROM dbo.Plants WHERE PlantCode = @PlantCode AND IsActive = 1);
      DECLARE @ShiftId INT = (SELECT ShiftId FROM dbo.Shifts WHERE ShiftCode = @ShiftCode);
      IF @PlantId IS NULL OR @ShiftId IS NULL THROW 50001, 'Unknown plant or shift.', 1;
      INSERT dbo.OperationalAlerts (PlantId, AlertCode, Category, Severity, Title, Description)
      OUTPUT INSERTED.AlertId AS alertId, INSERTED.PlantId AS plantId, INSERTED.Title AS title
      VALUES (@PlantId, @AlertCode, @Category, @Severity, @Title, @Description);
    `);
    const alert = inserted.recordset[0];
    if (!alert) throw new Error("Alert was not inserted.");
    const log = new sql.Request(transaction);
    log
      .input("PlantId", sql.Int, alert.plantId)
      .input("ShiftCode", sql.Char(1), input.shiftCode)
      .input("Title", sql.NVarChar(200), `Alerta creada: ${alert.title}`)
      .input("Operator", sql.NVarChar(100), input.operator)
      .input("Role", sql.NVarChar(100), input.operatorRole);
    await log.query(`
      DECLARE @ShiftId INT = (SELECT ShiftId FROM dbo.Shifts WHERE ShiftCode = @ShiftCode);
      INSERT dbo.OperationsLog (PlantId, ShiftId, EventKind, Title, Detail, OperatorName, OperatorRole, PlcAckStatus)
      VALUES (@PlantId, @ShiftId, N'alerta', @Title, N'Alerta creada y guardada en OperationalAlerts.', @Operator, @Role, N'NOT_APPLICABLE');
    `);
    await transaction.commit();
    return alert;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function listOperationsLog(plantCode: string, limit: number, offset: number) {
  const pool = await database();
  const id = await plantId(pool, plantCode);
  const result = await pool
    .request()
    .input("PlantId", sql.Int, id)
    .input("Limit", sql.Int, limit)
    .input("Offset", sql.Int, offset).query(`
      SELECT LogId AS logId, LoggedAt AS loggedAt, s.ShiftCode AS shiftCode, EventKind AS eventKind,
        Title AS title, Detail AS detail, OperatorName AS operatorName, OperatorRole AS operatorRole,
        PlcAckStatus AS plcAckStatus, DigitalSignatureSha256 AS digitalSignatureSha256
      FROM dbo.OperationsLog l JOIN dbo.Shifts s ON s.ShiftId = l.ShiftId
      WHERE PlantId = @PlantId ORDER BY LoggedAt DESC, LogId DESC
      OFFSET @Offset ROWS FETCH NEXT @Limit ROWS ONLY;
    `);
  const count = await pool
    .request()
    .input("PlantId", sql.Int, id)
    .query<{ total: number }>(
      "SELECT COUNT_BIG(*) AS total FROM dbo.OperationsLog WHERE PlantId = @PlantId",
    );
  return { data: result.recordset, total: Number(count.recordset[0]?.total ?? 0), limit, offset };
}

export async function listRecommendations(plantCode: string, limit: number, offset: number) {
  const pool = await database();
  const id = await plantId(pool, plantCode);
  const result = await pool
    .request()
    .input("PlantId", sql.Int, id)
    .input("Limit", sql.Int, limit)
    .input("Offset", sql.Int, offset).query(`
      SELECT RecommendationId AS recommendationId, ProcessUnit AS processUnit, ParameterName AS parameterName,
        CurrentValue AS currentValue, RecommendedValue AS recommendedValue,
        ModelConfidencePct AS modelConfidencePct, ModelVersion AS modelVersion,
        UnitSavingUsdPerM3 AS unitSavingUsdPerM3, MonthlySavingUsd AS monthlySavingUsd,
        TotalMonthlySavingUsd AS totalMonthlySavingUsd, ProjectedTurbidityNtu AS projectedTurbidityNtu,
        ProjectedDqoMgL AS projectedDqoMgL, ProjectedNom001Compliant AS projectedNom001Compliant,
        IsStressScenario AS isStressScenario, Status AS status, EvaluatedAt AS evaluatedAt,
        EvaluatedBy AS evaluatedBy, OperatorNotes AS operatorNotes, CreatedAt AS createdAt
      FROM dbo.AiRecommendations WHERE PlantId = @PlantId
      ORDER BY CreatedAt DESC, RecommendationId DESC
      OFFSET @Offset ROWS FETCH NEXT @Limit ROWS ONLY;
    `);
  const count = await pool
    .request()
    .input("PlantId", sql.Int, id)
    .query<{ total: number }>(
      "SELECT COUNT_BIG(*) AS total FROM dbo.AiRecommendations WHERE PlantId = @PlantId",
    );
  return { data: result.recordset, total: Number(count.recordset[0]?.total ?? 0), limit, offset };
}

export type HandoverInput = {
  plantCode: string;
  shiftCode: string;
  handoverDate: string;
  volumeTreatedM3: number;
  averageFlowRateM3h: number;
  averageTurbidityNtu: number;
  averageDqoMgL: number;
  averageSstMgL: number;
  nom001CompliancePct: number;
  signedBy: string;
  operatorRole: string;
};

export async function createHandover(input: HandoverInput) {
  const pool = await database();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const req = new sql.Request(transaction);
    req
      .input("PlantCode", sql.NVarChar(50), input.plantCode)
      .input("ShiftCode", sql.Char(1), input.shiftCode)
      .input("HandoverDate", sql.Date, input.handoverDate)
      .input("Volume", sql.Decimal(12, 2), input.volumeTreatedM3)
      .input("Flow", sql.Decimal(8, 2), input.averageFlowRateM3h)
      .input("Turbidity", sql.Decimal(6, 2), input.averageTurbidityNtu)
      .input("Dqo", sql.Decimal(6, 2), input.averageDqoMgL)
      .input("Sst", sql.Decimal(6, 2), input.averageSstMgL)
      .input("Compliance", sql.Decimal(5, 2), input.nom001CompliancePct)
      .input("SignedBy", sql.NVarChar(100), input.signedBy)
      .input("OperatorRole", sql.NVarChar(100), input.operatorRole);
    const result = await req.query(`
      DECLARE @PlantId INT = (SELECT PlantId FROM dbo.Plants WHERE PlantCode = @PlantCode AND IsActive = 1);
      DECLARE @ShiftId INT = (SELECT ShiftId FROM dbo.Shifts WHERE ShiftCode = @ShiftCode);
      IF @PlantId IS NULL OR @ShiftId IS NULL THROW 50001, 'Unknown plant or shift.', 1;
      DECLARE @Canonical NVARCHAR(1000) = CONCAT(@PlantCode, '|', @ShiftCode, '|', CONVERT(NVARCHAR(10), @HandoverDate, 23), '|',
        @Volume, '|', @Flow, '|', @Turbidity, '|', @Dqo, '|', @Sst, '|', @Compliance, '|', @SignedBy);
      DECLARE @Digest NVARCHAR(64) = CONVERT(NVARCHAR(64), HASHBYTES('SHA2_256', @Canonical), 2);
      INSERT dbo.ShiftHandovers (PlantId, ShiftId, HandoverDate, VolumeTreatedM3, AverageFlowRateM3h,
        AverageTurbidityNtu, AverageDqoMgL, AverageSstMgL, Nom001CompliancePct, SignedBy, SignatureHashSha256)
      OUTPUT INSERTED.HandoverId AS handoverId, INSERTED.Status AS status, INSERTED.SignedAt AS signedAt,
        INSERTED.SignatureHashSha256 AS signatureHashSha256
      VALUES (@PlantId, @ShiftId, @HandoverDate, @Volume, @Flow, @Turbidity, @Dqo, @Sst, @Compliance, @SignedBy, @Digest);
      INSERT dbo.OperationsLog (PlantId, ShiftId, EventKind, Title, Detail, OperatorName, OperatorRole, PlcAckStatus)
      VALUES (@PlantId, @ShiftId, N'turno', N'Entrega de turno registrada',
        CONCAT(N'HandoverId=', CONVERT(NVARCHAR(30), SCOPE_IDENTITY()), N'; SHA-256 de integridad almacenado.'),
        @SignedBy, @OperatorRole, N'NOT_APPLICABLE');
    `);
    await transaction.commit();
    return result.recordset[0];
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function listHandovers(plantCode: string, limit: number, offset: number) {
  const pool = await database();
  const id = await plantId(pool, plantCode);
  const result = await pool
    .request()
    .input("PlantId", sql.Int, id)
    .input("Limit", sql.Int, limit)
    .input("Offset", sql.Int, offset).query(`
      SELECT HandoverId AS handoverId, s.ShiftCode AS shiftCode, HandoverDate AS handoverDate,
        VolumeTreatedM3 AS volumeTreatedM3, AverageFlowRateM3h AS averageFlowRateM3h,
        AverageTurbidityNtu AS averageTurbidityNtu, AverageDqoMgL AS averageDqoMgL,
        AverageSstMgL AS averageSstMgL, Nom001CompliancePct AS nom001CompliancePct,
        IsCertified AS isCertified, SignedBy AS signedBy, SignedAt AS signedAt,
        SignatureHashSha256 AS signatureHashSha256, Status AS status
      FROM dbo.ShiftHandovers h JOIN dbo.Shifts s ON s.ShiftId = h.ShiftId
      WHERE PlantId = @PlantId ORDER BY HandoverDate DESC, HandoverId DESC
      OFFSET @Offset ROWS FETCH NEXT @Limit ROWS ONLY;
    `);
  const count = await pool
    .request()
    .input("PlantId", sql.Int, id)
    .query<{ total: number }>(
      "SELECT COUNT_BIG(*) AS total FROM dbo.ShiftHandovers WHERE PlantId = @PlantId",
    );
  return { data: result.recordset, total: Number(count.recordset[0]?.total ?? 0), limit, offset };
}

export async function appendOperationsLog(input: {
  plantCode: string;
  shiftCode: string;
  eventKind: string;
  title: string;
  detail: string;
  operatorName: string;
  operatorRole: string;
  plcAckStatus?: string;
}) {
  const pool = await database();
  const request = pool.request();
  request
    .input("PlantCode", sql.NVarChar(50), input.plantCode)
    .input("ShiftCode", sql.Char(1), input.shiftCode)
    .input("EventKind", sql.NVarChar(20), input.eventKind)
    .input("Title", sql.NVarChar(200), input.title)
    .input("Detail", sql.NVarChar(sql.MAX), input.detail)
    .input("OperatorName", sql.NVarChar(100), input.operatorName)
    .input("OperatorRole", sql.NVarChar(100), input.operatorRole)
    .input("PlcAckStatus", sql.NVarChar(50), input.plcAckStatus ?? "NOT_APPLICABLE");
  const result = await request.query(`
    DECLARE @PlantId INT = (SELECT PlantId FROM dbo.Plants WHERE PlantCode = @PlantCode AND IsActive = 1);
    DECLARE @ShiftId INT = (SELECT ShiftId FROM dbo.Shifts WHERE ShiftCode = @ShiftCode);
    IF @PlantId IS NULL OR @ShiftId IS NULL THROW 50001, 'Unknown plant or shift.', 1;
    INSERT dbo.OperationsLog (PlantId, ShiftId, EventKind, Title, Detail, OperatorName, OperatorRole, PlcAckStatus)
      OUTPUT INSERTED.LogId AS logId, INSERTED.LoggedAt AS loggedAt
      VALUES (@PlantId, @ShiftId, @EventKind, @Title, @Detail, @OperatorName, @OperatorRole, @PlcAckStatus);
  `);
  return result.recordset[0];
}

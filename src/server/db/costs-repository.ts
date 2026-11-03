import sql from "mssql";
import { getDbPool } from "./client";
import { DatabaseUnavailableError } from "./errors";

export type OperationalCostRecord = {
  operationalCostId: number;
  plantCode: string;
  periodStart: string;
  energyCostUsd: number;
  sludgeCostUsd: number;
  membraneCostUsd: number;
  sourceNote: string | null;
  recordedBy: string;
  recordedByRole: string;
  updatedAt: string;
};

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
  if (id === undefined) throw new TypeError("La planta seleccionada no está disponible.");
  return id;
}

export async function listOperationalCosts(plantCode: string, limit: number, offset: number) {
  const pool = await database();
  const id = await plantId(pool, plantCode);
  const result = await pool
    .request()
    .input("PlantId", sql.Int, id)
    .input("Limit", sql.Int, limit)
    .input("Offset", sql.Int, offset).query<OperationalCostRecord>(`
      SELECT c.OperationalCostId AS operationalCostId, p.PlantCode AS plantCode,
        CONVERT(char(10), c.PeriodStart, 23) AS periodStart,
        c.EnergyCostUsd AS energyCostUsd, c.SludgeCostUsd AS sludgeCostUsd,
        c.MembraneCostUsd AS membraneCostUsd, c.SourceNote AS sourceNote,
        c.RecordedBy AS recordedBy, c.RecordedByRole AS recordedByRole,
        c.UpdatedAt AS updatedAt
      FROM dbo.OperationalCostRecords c
      JOIN dbo.Plants p ON p.PlantId = c.PlantId
      WHERE c.PlantId = @PlantId
      ORDER BY c.PeriodStart DESC, c.OperationalCostId DESC
      OFFSET @Offset ROWS FETCH NEXT @Limit ROWS ONLY;
    `);
  const count = await pool
    .request()
    .input("PlantId", sql.Int, id)
    .query<{ total: number }>(
      "SELECT COUNT_BIG(*) AS total FROM dbo.OperationalCostRecords WHERE PlantId = @PlantId",
    );
  return {
    data: result.recordset,
    total: Number(count.recordset[0]?.total ?? 0),
    limit,
    offset,
  };
}

export async function saveOperationalCost(input: {
  plantCode: string;
  period: string;
  energyCostUsd: number;
  sludgeCostUsd: number;
  membraneCostUsd: number;
  sourceNote: string | null;
  operator: string;
  operatorRole: string;
}) {
  const pool = await database();
  const id = await plantId(pool, input.plantCode);
  const periodStart = new Date(`${input.period}-01T00:00:00.000Z`);
  await pool
    .request()
    .input("PlantId", sql.Int, id)
    .input("PeriodStart", sql.Date, periodStart)
    .input("EnergyCostUsd", sql.Decimal(14, 2), input.energyCostUsd)
    .input("SludgeCostUsd", sql.Decimal(14, 2), input.sludgeCostUsd)
    .input("MembraneCostUsd", sql.Decimal(14, 2), input.membraneCostUsd)
    .input("SourceNote", sql.NVarChar(500), input.sourceNote)
    .input("RecordedBy", sql.NVarChar(100), input.operator)
    .input("RecordedByRole", sql.NVarChar(100), input.operatorRole).query(`
      SET XACT_ABORT ON;
      BEGIN TRANSACTION;
      IF EXISTS (
        SELECT 1 FROM dbo.OperationalCostRecords WITH (UPDLOCK, HOLDLOCK)
        WHERE PlantId = @PlantId AND PeriodStart = @PeriodStart
      )
        UPDATE dbo.OperationalCostRecords
        SET EnergyCostUsd = @EnergyCostUsd, SludgeCostUsd = @SludgeCostUsd,
          MembraneCostUsd = @MembraneCostUsd, SourceNote = @SourceNote,
          RecordedBy = @RecordedBy, RecordedByRole = @RecordedByRole,
          UpdatedAt = SYSDATETIMEOFFSET()
        WHERE PlantId = @PlantId AND PeriodStart = @PeriodStart;
      ELSE
        INSERT INTO dbo.OperationalCostRecords (
          PlantId, PeriodStart, EnergyCostUsd, SludgeCostUsd, MembraneCostUsd,
          SourceNote, RecordedBy, RecordedByRole
        ) VALUES (
          @PlantId, @PeriodStart, @EnergyCostUsd, @SludgeCostUsd, @MembraneCostUsd,
          @SourceNote, @RecordedBy, @RecordedByRole
        );
      COMMIT TRANSACTION;
    `);
}

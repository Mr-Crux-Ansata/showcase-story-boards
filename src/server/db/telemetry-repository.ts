import sql from "mssql";
import { getDbPool } from "./client";
import { DatabaseUnavailableError } from "./errors";
import type { TelemetrySnapshot } from "../../lib/types/telemetry";

// Memoria caché para cuando SQL Server no está conectado
const inMemoryHistory: TelemetrySnapshot[] = [];

export async function insertTelemetrySnapshot(snapshot: TelemetrySnapshot): Promise<number | null> {
  // Siempre almacenar en el historial en memoria para disponibilidad inmediata
  inMemoryHistory.unshift(snapshot);
  if (inMemoryHistory.length > 500) {
    inMemoryHistory.pop();
  }

  const pool = await getDbPool();
  if (!pool) {
    return null;
  }

  const request = pool.request();

  // Mapeo de parámetros para SQL Server
  request.input("PlantCode", sql.NVarChar(50), snapshot.plantCode);
  request.input("ShiftCode", sql.Char(1), snapshot.shiftCode);
  request.input("RecordedAt", sql.DateTimeOffset, new Date(snapshot.recordedAt));
  request.input("InflowRateM3h", sql.Decimal(8, 2), snapshot.inflowRateM3h);
  request.input("InflowTurbidityNtu", sql.Decimal(8, 2), snapshot.inflowTurbidityNtu);
  request.input("InflowDqoMgL", sql.Decimal(8, 2), snapshot.inflowDqoMgL);
  request.input("InflowPh", sql.Decimal(4, 2), snapshot.inflowPh);
  request.input("InflowTemperatureC", sql.Decimal(5, 2), snapshot.inflowTemperatureC ?? null);
  request.input("PacDosePpm", sql.Decimal(6, 2), snapshot.pacDosePpm);
  request.input("PacPumpFrequencyHz", sql.Decimal(5, 2), snapshot.pacPumpFrequencyHz ?? null);
  request.input("MbrDissolvedOxygenMgL", sql.Decimal(5, 2), snapshot.mbrDissolvedOxygenMgL ?? null);
  request.input("BlowerFrequencyHz", sql.Decimal(5, 2), snapshot.blowerFrequencyHz ?? null);
  request.input("EffluentTurbidityNtu", sql.Decimal(6, 2), snapshot.effluentTurbidityNtu);
  request.input("EffluentDqoMgL", sql.Decimal(6, 2), snapshot.effluentDqoMgL);
  request.input("EffluentSstMgL", sql.Decimal(6, 2), snapshot.effluentSstMgL ?? null);
  request.input("EffluentPh", sql.Decimal(4, 2), snapshot.effluentPh);
  request.input("Nom001Compliant", sql.Bit, snapshot.nom001Compliant ? 1 : 0);
  request.input("DataQualityFlag", sql.NVarChar(20), snapshot.dataQualityFlag);

  const result = await request.query(`
      DECLARE @PId INT = (SELECT TOP 1 PlantId FROM dbo.Plants WHERE PlantCode = @PlantCode AND IsActive = 1);
      IF @PId IS NULL THROW 50001, 'Unknown plant.', 1;
      
      DECLARE @SId INT = (SELECT TOP 1 ShiftId FROM dbo.Shifts WHERE ShiftCode = @ShiftCode);
      IF @SId IS NULL THROW 50002, 'Unknown shift.', 1;

      INSERT INTO dbo.TelemetrySnapshots (
        PlantId, ShiftId, RecordedAt,
        InflowRateM3h, InflowTurbidityNtu, InflowDqoMgL, InflowPh, InflowTemperatureC,
        PacDosePpm, PacPumpFrequencyHz,
        MbrDissolvedOxygenMgL, BlowerFrequencyHz,
        EffluentTurbidityNtu, EffluentDqoMgL, EffluentSstMgL, EffluentPh,
        Nom001Compliant, DataQualityFlag
      )
      OUTPUT INSERTED.SnapshotId
      VALUES (
        @PId, @SId, @RecordedAt,
        @InflowRateM3h, @InflowTurbidityNtu, @InflowDqoMgL, @InflowPh, @InflowTemperatureC,
        @PacDosePpm, @PacPumpFrequencyHz,
        @MbrDissolvedOxygenMgL, @BlowerFrequencyHz,
        @EffluentTurbidityNtu, @EffluentDqoMgL, @EffluentSstMgL, @EffluentPh,
        @Nom001Compliant, @DataQualityFlag
      );
  `);

  const insertedId: unknown = result.recordset[0]?.SnapshotId;
  if (typeof insertedId === "number" && Number.isSafeInteger(insertedId)) return insertedId;
  if (typeof insertedId === "bigint" && insertedId <= BigInt(Number.MAX_SAFE_INTEGER))
    return Number(insertedId);
  if (typeof insertedId === "string" && /^\d+$/.test(insertedId)) {
    const numericId = Number(insertedId);
    if (Number.isSafeInteger(numericId)) return numericId;
  }
  return null;
}

export function getLatestInMemoryTelemetry(): TelemetrySnapshot | null {
  return inMemoryHistory[0] ?? null;
}

export async function getLatestPersistedTelemetry(
  plantCode: string,
): Promise<TelemetrySnapshot | null> {
  const pool = await getDbPool();
  if (!pool) return null;
  const result = await pool.request().input("PlantCode", sql.NVarChar(50), plantCode)
    .query<TelemetrySnapshot>(`
    SELECT TOP (1) SnapshotId AS snapshotId, RecordedAt AS recordedAt, s.ShiftCode AS shiftCode,
      p.PlantCode AS plantCode, InflowRateM3h AS inflowRateM3h,
      InflowTurbidityNtu AS inflowTurbidityNtu, InflowDqoMgL AS inflowDqoMgL, InflowPh AS inflowPh,
      InflowTemperatureC AS inflowTemperatureC, PacDosePpm AS pacDosePpm,
      PacPumpFrequencyHz AS pacPumpFrequencyHz, MbrDissolvedOxygenMgL AS mbrDissolvedOxygenMgL,
      BlowerFrequencyHz AS blowerFrequencyHz, EffluentTurbidityNtu AS effluentTurbidityNtu,
      EffluentDqoMgL AS effluentDqoMgL, EffluentSstMgL AS effluentSstMgL, EffluentPh AS effluentPh,
      Nom001Compliant AS nom001Compliant, DataQualityFlag AS dataQualityFlag
    FROM dbo.TelemetrySnapshots t JOIN dbo.Plants p ON p.PlantId = t.PlantId
    JOIN dbo.Shifts s ON s.ShiftId = t.ShiftId
    WHERE p.PlantCode = @PlantCode AND p.IsActive = 1
    ORDER BY RecordedAt DESC, SnapshotId DESC;
  `);
  return result.recordset[0] ?? null;
}

export async function getTelemetryImportCodes() {
  const pool = await getDbPool();
  if (!pool) throw new DatabaseUnavailableError();
  const [plants, shifts] = await Promise.all([
    pool
      .request()
      .query<{ PlantCode: string }>("SELECT PlantCode FROM dbo.Plants WHERE IsActive = 1"),
    pool.request().query<{ ShiftCode: string }>("SELECT ShiftCode FROM dbo.Shifts"),
  ]);
  return {
    plantCodes: new Set(plants.recordset.map((row) => row.PlantCode)),
    shiftCodes: new Set(shifts.recordset.map((row) => row.ShiftCode)),
  };
}

export async function insertTelemetrySnapshotsBatch(
  snapshots: TelemetrySnapshot[],
  operator: { name: string; role: string },
) {
  const pool = await getDbPool();
  if (!pool) throw new DatabaseUnavailableError();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const ids: number[] = [];
    for (const snapshot of snapshots) {
      const request = new sql.Request(transaction);
      request
        .input("PlantCode", sql.NVarChar(50), snapshot.plantCode)
        .input("ShiftCode", sql.Char(1), snapshot.shiftCode)
        .input("RecordedAt", sql.DateTimeOffset, new Date(snapshot.recordedAt))
        .input("InflowRateM3h", sql.Decimal(8, 2), snapshot.inflowRateM3h)
        .input("InflowTurbidityNtu", sql.Decimal(8, 2), snapshot.inflowTurbidityNtu)
        .input("InflowDqoMgL", sql.Decimal(8, 2), snapshot.inflowDqoMgL)
        .input("InflowPh", sql.Decimal(4, 2), snapshot.inflowPh)
        .input("InflowTemperatureC", sql.Decimal(5, 2), snapshot.inflowTemperatureC ?? null)
        .input("PacDosePpm", sql.Decimal(6, 2), snapshot.pacDosePpm)
        .input("PacPumpFrequencyHz", sql.Decimal(5, 2), snapshot.pacPumpFrequencyHz ?? null)
        .input("MbrDissolvedOxygenMgL", sql.Decimal(5, 2), snapshot.mbrDissolvedOxygenMgL ?? null)
        .input("BlowerFrequencyHz", sql.Decimal(5, 2), snapshot.blowerFrequencyHz ?? null)
        .input("EffluentTurbidityNtu", sql.Decimal(6, 2), snapshot.effluentTurbidityNtu)
        .input("EffluentDqoMgL", sql.Decimal(6, 2), snapshot.effluentDqoMgL)
        .input("EffluentSstMgL", sql.Decimal(6, 2), snapshot.effluentSstMgL ?? null)
        .input("EffluentPh", sql.Decimal(4, 2), snapshot.effluentPh)
        .input("Nom001Compliant", sql.Bit, snapshot.nom001Compliant ? 1 : 0)
        .input("DataQualityFlag", sql.NVarChar(20), snapshot.dataQualityFlag);
      const inserted = await request.query<{ SnapshotId: number }>(`
        DECLARE @PlantId INT = (SELECT PlantId FROM dbo.Plants WHERE PlantCode = @PlantCode AND IsActive = 1);
        DECLARE @ShiftId INT = (SELECT ShiftId FROM dbo.Shifts WHERE ShiftCode = @ShiftCode);
        IF @PlantId IS NULL OR @ShiftId IS NULL THROW 50001, 'Unknown plant or shift.', 1;
        INSERT dbo.TelemetrySnapshots (PlantId, ShiftId, RecordedAt, InflowRateM3h, InflowTurbidityNtu,
          InflowDqoMgL, InflowPh, InflowTemperatureC, PacDosePpm, PacPumpFrequencyHz,
          MbrDissolvedOxygenMgL, BlowerFrequencyHz, EffluentTurbidityNtu, EffluentDqoMgL,
          EffluentSstMgL, EffluentPh, Nom001Compliant, DataQualityFlag)
        OUTPUT INSERTED.SnapshotId
        VALUES (@PlantId, @ShiftId, @RecordedAt, @InflowRateM3h, @InflowTurbidityNtu,
          @InflowDqoMgL, @InflowPh, @InflowTemperatureC, @PacDosePpm, @PacPumpFrequencyHz,
          @MbrDissolvedOxygenMgL, @BlowerFrequencyHz, @EffluentTurbidityNtu, @EffluentDqoMgL,
          @EffluentSstMgL, @EffluentPh, @Nom001Compliant, @DataQualityFlag);
      `);
      const id = inserted.recordset[0]?.SnapshotId;
      if (id === undefined) throw new Error("Telemetry row was not inserted.");
      ids.push(id);
    }
    const groups = new Map<string, { plantCode: string; shiftCode: string; count: number }>();
    for (const snapshot of snapshots) {
      const key = `${snapshot.plantCode}:${snapshot.shiftCode}`;
      const group = groups.get(key) ?? {
        plantCode: snapshot.plantCode,
        shiftCode: snapshot.shiftCode,
        count: 0,
      };
      group.count++;
      groups.set(key, group);
    }
    for (const group of groups.values()) {
      const audit = new sql.Request(transaction);
      audit
        .input("PlantCode", sql.NVarChar(50), group.plantCode)
        .input("ShiftCode", sql.Char(1), group.shiftCode)
        .input("Count", sql.Int, group.count)
        .input("Operator", sql.NVarChar(100), operator.name)
        .input("Role", sql.NVarChar(100), operator.role);
      await audit.query(`
        DECLARE @PlantId INT = (SELECT PlantId FROM dbo.Plants WHERE PlantCode = @PlantCode);
        DECLARE @ShiftId INT = (SELECT ShiftId FROM dbo.Shifts WHERE ShiftCode = @ShiftCode);
        INSERT dbo.OperationsLog (PlantId, ShiftId, EventKind, Title, Detail, OperatorName, OperatorRole, PlcAckStatus)
        VALUES (@PlantId, @ShiftId, N'datos', N'Importación CSV de telemetría persistida',
          CONCAT(@Count, N' snapshots insertados en TelemetrySnapshots.'), @Operator, @Role, N'NOT_APPLICABLE');
      `);
    }
    await transaction.commit();
    return ids;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

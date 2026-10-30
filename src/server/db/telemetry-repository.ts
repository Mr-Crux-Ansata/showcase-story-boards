import sql from "mssql";
import { getDbPool } from "./client";
import type { TelemetrySnapshot } from "../../lib/types/telemetry";

// Memoria caché para cuando SQL Server no está conectado
let inMemoryHistory: TelemetrySnapshot[] = [];

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

  try {
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

    const insertedId = result.recordset[0]?.SnapshotId;
    return typeof insertedId === "number" ? insertedId : null;
  } catch (err) {
    console.error("[AquaSense DB] Error al insertar telemetría en SQL Server:", err);
    return null;
  }
}

export function getLatestInMemoryTelemetry(): TelemetrySnapshot | null {
  return inMemoryHistory[0] ?? null;
}

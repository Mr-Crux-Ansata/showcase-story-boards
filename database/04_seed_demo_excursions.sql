-- AquaSense AI - Snapshot sintéticos para demostrar cumplimiento y desviaciones.
-- Ejecutar solo en entornos de demostración; no son mediciones de una planta real.
USE [AquaSenseSCADA];
GO

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @PlantId INT = (SELECT PlantId FROM dbo.Plants WHERE PlantCode = N'PL_NORTE' AND IsActive = 1);
DECLARE @ShiftId INT = (SELECT ShiftId FROM dbo.Shifts WHERE ShiftCode = 'B');

IF @PlantId IS NULL OR @ShiftId IS NULL
    THROW 50020, 'No se encontró PL_NORTE o el turno B. Ejecuta primero los scripts de esquema y datos iniciales.', 1;

-- Esta combinación de valores identifica este lote y evita insertarlo más de una vez.
IF EXISTS (
    SELECT 1
    FROM dbo.TelemetrySnapshots
    WHERE PlantId = @PlantId
      AND ShiftId = @ShiftId
      AND InflowRateM3h = 142.80
      AND InflowTurbidityNtu = 1.85
      AND InflowDqoMgL = 48.20
      AND InflowPh = 7.42
      AND PacDosePpm = 19.00
      AND EffluentTurbidityNtu > 4.00
      AND EffluentDqoMgL > 60.00
)
BEGIN
    PRINT 'El lote de demostración ya existe; no se insertaron muestras duplicadas.';
    RETURN;
END;

DECLARE @Samples TABLE (
    SequenceNo INT PRIMARY KEY,
    EffluentTurbidityNtu DECIMAL(6,2) NOT NULL,
    EffluentDqoMgL DECIMAL(6,2) NOT NULL
);

INSERT INTO @Samples (SequenceNo, EffluentTurbidityNtu, EffluentDqoMgL)
VALUES
    (1, 1.54, 43.86), (2, 1.62, 44.10), (3, 1.70, 44.32), (4, 1.59, 43.92),
    (5, 1.76, 45.04), (6, 1.67, 44.48), (7, 1.58, 43.76), (8, 1.72, 44.66),
    (9, 4.68, 62.40), (10, 1.63, 44.21), (11, 1.55, 43.95), (12, 4.91, 65.10);

DECLARE @Now DATETIMEOFFSET = SYSDATETIMEOFFSET();

BEGIN TRANSACTION;

INSERT INTO dbo.TelemetrySnapshots (
    PlantId, ShiftId, RecordedAt,
    InflowRateM3h, InflowTurbidityNtu, InflowDqoMgL, InflowPh, InflowTemperatureC,
    PacDosePpm, PacPumpFrequencyHz, MbrDissolvedOxygenMgL, BlowerFrequencyHz,
    EffluentTurbidityNtu, EffluentDqoMgL, EffluentSstMgL, EffluentPh,
    Nom001Compliant, DataQualityFlag
)
SELECT
    @PlantId, @ShiftId, DATEADD(SECOND, (SequenceNo - 12) * 10, @Now),
    142.80, 1.85, 48.20, 7.42, 22.40,
    19.00, 29.70, 2.15, 42.00,
    EffluentTurbidityNtu, EffluentDqoMgL, 11.80, 7.38,
    CASE WHEN EffluentTurbidityNtu < 4.00 AND EffluentDqoMgL < 60.00 THEN 1 ELSE 0 END,
    N'GOOD'
FROM @Samples;

COMMIT TRANSACTION;

PRINT 'Se insertaron 12 muestras sintéticas recientes (10 conformes y 2 fuera de referencia) para PL_NORTE.';
GO

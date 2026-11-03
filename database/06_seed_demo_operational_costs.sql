-- AquaSense AI - Costos operativos sintéticos para probar el tablero.
-- Ejecutar solo en entornos de demostración. Los importes no son datos reales.
USE [AquaSenseSCADA];
GO

SET NOCOUNT ON;
SET XACT_ABORT ON;

IF OBJECT_ID(N'dbo.OperationalCostRecords', N'U') IS NULL
    THROW 50030, 'No existe la tabla de costos. Ejecuta primero 02_schema.sql o 05_add_operational_cost_records.sql.', 1;

DECLARE @PlantId INT = (SELECT PlantId FROM dbo.Plants WHERE PlantCode = N'PL_NORTE' AND IsActive = 1);
IF @PlantId IS NULL
    THROW 50031, 'No se encontró la planta PL_NORTE.', 1;

DECLARE @CurrentMonth DATE = DATEFROMPARTS(YEAR(SYSDATETIME()), MONTH(SYSDATETIME()), 1);
DECLARE @DemoCosts TABLE (
    MonthOffset INT PRIMARY KEY,
    EnergyCostUsd DECIMAL(14,2) NOT NULL,
    SludgeCostUsd DECIMAL(14,2) NOT NULL,
    MembraneCostUsd DECIMAL(14,2) NOT NULL,
    SourceNote NVARCHAR(500) NOT NULL
);

INSERT INTO @DemoCosts (MonthOffset, EnergyCostUsd, SludgeCostUsd, MembraneCostUsd, SourceNote)
VALUES
    (-5, 8420.00, 3180.00, 1250.00, N'Dato sintético de demostración; reemplazar con el reporte real.'),
    (-4, 8795.00, 3360.00, 1820.00, N'Dato sintético de demostración; reemplazar con el reporte real.'),
    (-3, 8610.00, 3540.00, 4680.00, N'Dato sintético de demostración; reemplazar con el reporte real.'),
    (-2, 9135.00, 3710.00, 2140.00, N'Dato sintético de demostración; reemplazar con el reporte real.'),
    (-1, 9360.00, 3890.00, 2760.00, N'Dato sintético de demostración; reemplazar con el reporte real.'),
    ( 0, 9580.00, 4025.00, 1925.00, N'Dato sintético de demostración; reemplazar con el reporte real.');

DECLARE @InsertedCount INT;

BEGIN TRANSACTION;

INSERT INTO dbo.OperationalCostRecords (
    PlantId, PeriodStart, EnergyCostUsd, SludgeCostUsd, MembraneCostUsd,
    SourceNote, RecordedBy, RecordedByRole
)
SELECT
    @PlantId,
    DATEADD(MONTH, demo.MonthOffset, @CurrentMonth),
    demo.EnergyCostUsd,
    demo.SludgeCostUsd,
    demo.MembraneCostUsd,
    demo.SourceNote,
    N'Demostración AquaSense',
    N'Datos sintéticos'
FROM @DemoCosts AS demo
WHERE NOT EXISTS (
    SELECT 1
    FROM dbo.OperationalCostRecords AS existing WITH (UPDLOCK, HOLDLOCK)
    WHERE existing.PlantId = @PlantId
      AND existing.PeriodStart = DATEADD(MONTH, demo.MonthOffset, @CurrentMonth)
);
SET @InsertedCount = @@ROWCOUNT;
COMMIT TRANSACTION;

PRINT CONCAT(@InsertedCount, ' periodos sintéticos agregados para PL_NORTE. Los registros existentes se conservaron.');
GO

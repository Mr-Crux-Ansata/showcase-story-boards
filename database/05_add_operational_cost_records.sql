-- AquaSense AI - Migración para captura mensual de costos operativos.
-- Ejecutar una vez en bases existentes. No modifica registros de costos existentes.
USE [AquaSenseSCADA];
GO

IF OBJECT_ID(N'dbo.OperationalCostRecords', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.OperationalCostRecords (
        OperationalCostId BIGINT IDENTITY(1,1) PRIMARY KEY,
        PlantId INT NOT NULL REFERENCES dbo.Plants(PlantId),
        PeriodStart DATE NOT NULL,
        EnergyCostUsd DECIMAL(14,2) NOT NULL CHECK (EnergyCostUsd >= 0),
        SludgeCostUsd DECIMAL(14,2) NOT NULL CHECK (SludgeCostUsd >= 0),
        MembraneCostUsd DECIMAL(14,2) NOT NULL CHECK (MembraneCostUsd >= 0),
        SourceNote NVARCHAR(500) NULL,
        RecordedBy NVARCHAR(100) NOT NULL,
        RecordedByRole NVARCHAR(100) NOT NULL,
        RecordedAt DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
        UpdatedAt DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
        CONSTRAINT UQ_OperationalCostRecords_Plant_Period UNIQUE (PlantId, PeriodStart)
    );

    PRINT 'Tabla de costos operativos creada.';
END
ELSE
    PRINT 'La tabla de costos operativos ya existe; no se realizaron cambios.';
GO

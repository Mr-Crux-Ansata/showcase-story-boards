-- ============================================================================
-- AquaSense AI - Industrial Water SCADA
-- Script 02: Esquema Relacional de Base de Datos
-- Motor: Microsoft SQL Server (T-SQL)
-- ============================================================================

USE [AquaSenseSCADA];
GO

-- ----------------------------------------------------------------------------
-- 1. Tablas Maestras: Plantas y Turnos
-- ----------------------------------------------------------------------------
IF OBJECT_ID(N'dbo.Plants', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Plants (
        PlantId INT IDENTITY(1,1) PRIMARY KEY,
        PlantCode NVARCHAR(50) NOT NULL UNIQUE,
        PlantName NVARCHAR(100) NOT NULL,
        EffluentType NVARCHAR(100) NOT NULL DEFAULT N'Efluente Industrial',
        DesignCapacityM3h DECIMAL(10,2) NOT NULL DEFAULT 200.00,
        IsActive BIT NOT NULL DEFAULT 1,
        CreatedAt DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
    );
END
GO

IF OBJECT_ID(N'dbo.Shifts', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.Shifts (
        ShiftId INT IDENTITY(1,1) PRIMARY KEY,
        ShiftCode CHAR(1) NOT NULL UNIQUE, -- 'A', 'B', 'C'
        ShiftName NVARCHAR(50) NOT NULL,
        StartTime TIME(0) NOT NULL,
        EndTime TIME(0) NOT NULL,
        CreatedAt DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
    );
END
GO

-- ----------------------------------------------------------------------------
-- 2. Catálogo de Instrumentación y Tags SCADA
-- ----------------------------------------------------------------------------
IF OBJECT_ID(N'dbo.ScadaTags', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ScadaTags (
        TagId INT IDENTITY(1,1) PRIMARY KEY,
        PlantId INT NOT NULL REFERENCES dbo.Plants(PlantId),
        TagName NVARCHAR(100) NOT NULL UNIQUE,
        ParameterCode NVARCHAR(50) NOT NULL, -- 'turbidez', 'caudal', 'dqo', 'ph', 'pac', 'presion', 'od'
        Description NVARCHAR(250) NOT NULL,
        Unit NVARCHAR(20) NOT NULL,
        OpcNodeId NVARCHAR(250) NULL,
        ModbusRegister NVARCHAR(50) NULL,
        MinSafeRange DECIMAL(12,4) NOT NULL,
        MaxSafeRange DECIMAL(12,4) NOT NULL,
        IsActive BIT NOT NULL DEFAULT 1,
        CreatedAt DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
    );
END
GO

-- ----------------------------------------------------------------------------
-- 3. Telemetría de Proceso: Instantáneas Consolidadas (Consumo de la UI)
-- ----------------------------------------------------------------------------
IF OBJECT_ID(N'dbo.TelemetrySnapshots', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.TelemetrySnapshots (
        SnapshotId BIGINT IDENTITY(1,1) PRIMARY KEY,
        PlantId INT NOT NULL REFERENCES dbo.Plants(PlantId),
        ShiftId INT NOT NULL REFERENCES dbo.Shifts(ShiftId),
        RecordedAt DATETIMEOFFSET NOT NULL,
        
        -- Afluente (Entrada)
        InflowRateM3h DECIMAL(8,2) NOT NULL,
        InflowTurbidityNtu DECIMAL(8,2) NOT NULL,
        InflowDqoMgL DECIMAL(8,2) NOT NULL,
        InflowPh DECIMAL(4,2) NOT NULL,
        InflowTemperatureC DECIMAL(5,2) NULL,
        
        -- Dosificación y Reactor Floculador (PAC)
        PacDosePpm DECIMAL(6,2) NOT NULL,
        PacPumpFrequencyHz DECIMAL(5,2) NULL,
        
        -- Biorreactor MBR / Aireación
        MbrDissolvedOxygenMgL DECIMAL(5,2) NULL,
        BlowerFrequencyHz DECIMAL(5,2) NULL,
        
        -- Efluente de Descarga (Cumplimiento NOM-001)
        EffluentTurbidityNtu DECIMAL(6,2) NOT NULL,
        EffluentDqoMgL DECIMAL(6,2) NOT NULL,
        EffluentSstMgL DECIMAL(6,2) NULL,
        EffluentPh DECIMAL(4,2) NOT NULL,
        
        -- Indicadores de Integridad
        Nom001Compliant BIT NOT NULL,
        DataQualityFlag NVARCHAR(20) NOT NULL DEFAULT N'GOOD', -- GOOD, BAD, UNCERTAIN, STUCK
        CreatedAt DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
    );

    CREATE NONCLUSTERED INDEX IX_TelemetrySnapshots_Plant_Time
    ON dbo.TelemetrySnapshots(PlantId, RecordedAt DESC);
END
GO

-- ----------------------------------------------------------------------------
-- 4. Motor de Recomendaciones IA
-- ----------------------------------------------------------------------------
IF OBJECT_ID(N'dbo.AiRecommendations', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.AiRecommendations (
        RecommendationId BIGINT IDENTITY(1,1) PRIMARY KEY,
        PlantId INT NOT NULL REFERENCES dbo.Plants(PlantId),
        ProcessUnit NVARCHAR(100) NOT NULL, -- 'Reactor Floculador #01 · Dosificación PAC'
        ParameterName NVARCHAR(50) NOT NULL, -- 'PAC_DOSE', 'BLOWER_HZ'
        
        -- Valores de Consigna
        CurrentValue DECIMAL(8,2) NOT NULL,     -- p. ej. 28.00 ppm
        RecommendedValue DECIMAL(8,2) NOT NULL, -- p. ej. 19.00 ppm
        ModelConfidencePct DECIMAL(5,2) NOT NULL DEFAULT 94.00,
        ModelVersion NVARCHAR(50) NOT NULL DEFAULT N'v2.4-surrogate',
        
        -- Proyecciones Económicas
        UnitSavingUsdPerM3 DECIMAL(8,4) NOT NULL,
        MonthlySavingUsd DECIMAL(12,2) NOT NULL,
        TotalMonthlySavingUsd DECIMAL(12,2) NOT NULL,
        
        -- Proyecciones Ambientales / Calidad
        ProjectedTurbidityNtu DECIMAL(6,2) NOT NULL,
        ProjectedDqoMgL DECIMAL(6,2) NOT NULL,
        ProjectedNom001Compliant BIT NOT NULL DEFAULT 1,
        IsStressScenario BIT NOT NULL DEFAULT 0,
        
        -- Estado del Flujo de Aprobación (HITL)
        Status NVARCHAR(20) NOT NULL DEFAULT N'PENDIENTE', -- 'PENDIENTE', 'APROBADA', 'RECHAZADA', 'EXPIRADA'
        EvaluatedAt DATETIMEOFFSET NULL,
        EvaluatedBy NVARCHAR(100) NULL,
        OperatorNotes NVARCHAR(500) NULL,
        
        CreatedAt DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET()
    );

    CREATE NONCLUSTERED INDEX IX_AiRecommendations_Plant_Status
    ON dbo.AiRecommendations(PlantId, Status, CreatedAt DESC);
END
GO

-- ----------------------------------------------------------------------------
-- 5. Desviaciones y Alertas SCADA
-- ----------------------------------------------------------------------------
IF OBJECT_ID(N'dbo.OperationalAlerts', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.OperationalAlerts (
        AlertId BIGINT IDENTITY(1,1) PRIMARY KEY,
        PlantId INT NOT NULL REFERENCES dbo.Plants(PlantId),
        AlertCode NVARCHAR(50) NOT NULL, -- 'pac', 'filtro', 'membrana'
        Category NVARCHAR(50) NOT NULL, -- 'sobrecosto', 'quimico', 'mantenimiento'
        Severity NVARCHAR(20) NOT NULL, -- 'CRITICA', 'ALTA', 'MODERADA', 'INFORMATIVA'
        Title NVARCHAR(200) NOT NULL,
        Description NVARCHAR(MAX) NOT NULL,
        
        Status NVARCHAR(20) NOT NULL DEFAULT N'abierta', -- 'abierta', 'pausada', 'resuelta'
        TriggeredAt DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
        PausedUntil DATETIMEOFFSET NULL,
        ResolvedAt DATETIMEOFFSET NULL,
        ResolvedBy NVARCHAR(100) NULL,
        ResolutionNote NVARCHAR(500) NULL
    );

    CREATE NONCLUSTERED INDEX IX_OperationalAlerts_Plant_Status
    ON dbo.OperationalAlerts(PlantId, Status);
END
GO

-- ----------------------------------------------------------------------------
-- 6. Bitácora de Operaciones & Trazabilidad (Audit Trail NOM-001)
-- ----------------------------------------------------------------------------
IF OBJECT_ID(N'dbo.OperationsLog', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.OperationsLog (
        LogId BIGINT IDENTITY(1,1) PRIMARY KEY,
        PlantId INT NOT NULL REFERENCES dbo.Plants(PlantId),
        ShiftId INT NOT NULL REFERENCES dbo.Shifts(ShiftId),
        LoggedAt DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
        EventKind NVARCHAR(20) NOT NULL, -- 'consigna', 'alerta', 'datos', 'turno', 'sistema'
        Title NVARCHAR(200) NOT NULL,
        Detail NVARCHAR(MAX) NOT NULL,
        OperatorName NVARCHAR(100) NOT NULL,
        OperatorRole NVARCHAR(100) NOT NULL DEFAULT N'Jefe de Operación',
        PlcAckStatus NVARCHAR(50) NOT NULL DEFAULT N'ACK_OK',
        DigitalSignatureSha256 NVARCHAR(64) NULL -- Firma SHA-256 para auditoría ambiental
    );

    CREATE NONCLUSTERED INDEX IX_OperationsLog_Plant_Date
    ON dbo.OperationsLog(PlantId, LoggedAt DESC);
END
GO

-- ----------------------------------------------------------------------------
-- 7. Cierre Formal y Entrega de Turno (Shift Handover)
-- ----------------------------------------------------------------------------
IF OBJECT_ID(N'dbo.ShiftHandovers', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.ShiftHandovers (
        HandoverId BIGINT IDENTITY(1,1) PRIMARY KEY,
        PlantId INT NOT NULL REFERENCES dbo.Plants(PlantId),
        ShiftId INT NOT NULL REFERENCES dbo.Shifts(ShiftId),
        HandoverDate DATE NOT NULL,
        VolumeTreatedM3 DECIMAL(12,2) NOT NULL,
        AverageFlowRateM3h DECIMAL(8,2) NOT NULL,
        AverageTurbidityNtu DECIMAL(6,2) NOT NULL,
        AverageDqoMgL DECIMAL(6,2) NOT NULL,
        AverageSstMgL DECIMAL(6,2) NOT NULL,
        Nom001CompliancePct DECIMAL(5,2) NOT NULL,
        
        IsCertified BIT NOT NULL DEFAULT 1,
        SignedBy NVARCHAR(100) NOT NULL,
        SignedAt DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
        SignatureHashSha256 NVARCHAR(64) NOT NULL,
        Status NVARCHAR(20) NOT NULL DEFAULT N'FIRMADO'
    );

    CREATE UNIQUE NONCLUSTERED INDEX UQ_ShiftHandovers_Plant_Date_Shift
    ON dbo.ShiftHandovers(PlantId, HandoverDate, ShiftId);
END
GO

PRINT 'Esquema de base de datos AquaSenseSCADA generado correctamente.';
GO

-- ============================================================================
-- AquaSense AI - Industrial Water SCADA
-- Script 03: Datos Semilla Iniciales (Seed Data)
-- ============================================================================

USE [AquaSenseSCADA];
GO

-- 1. Insertar Plantas de Demostración
IF NOT EXISTS (SELECT 1 FROM dbo.Plants WHERE PlantCode = 'PL_NORTE')
BEGIN
    INSERT INTO dbo.Plants (PlantCode, PlantName, EffluentType, DesignCapacityM3h)
    VALUES 
        ('PL_NORTE', N'Planta Norte', N'Efluente Industrial Automotriz', 250.00),
        ('PL_SUR', N'Planta Sur', N'Efluente Industrial Metalmecánica', 180.00),
        ('PL_ORIENTE', N'Planta Oriente', N'Efluente Químico y Farmacéutico', 220.00);
END

UPDATE dbo.Plants
SET PlantName = CASE PlantCode
        WHEN N'PL_NORTE' THEN N'Planta Norte'
        WHEN N'PL_SUR' THEN N'Planta Sur'
        WHEN N'PL_ORIENTE' THEN N'Planta Oriente'
    END,
    EffluentType = CASE PlantCode
        WHEN N'PL_NORTE' THEN N'Efluente Industrial Automotriz'
        WHEN N'PL_SUR' THEN N'Efluente Industrial Metalmecánica'
        WHEN N'PL_ORIENTE' THEN N'Efluente Químico y Farmacéutico'
    END
WHERE PlantCode IN (N'PL_NORTE', N'PL_SUR', N'PL_ORIENTE');
GO

-- 2. Insertar Turnos Operativos
IF NOT EXISTS (SELECT 1 FROM dbo.Shifts WHERE ShiftCode = 'A')
BEGIN
    INSERT INTO dbo.Shifts (ShiftCode, ShiftName, StartTime, EndTime)
    VALUES 
        ('A', N'Turno A', '06:00:00', '14:00:00'),
        ('B', N'Turno B', '14:00:00', '22:00:00'),
        ('C', N'Turno C', '22:00:00', '06:00:00');
END
GO

-- 3. Insertar Tags SCADA Principales (Planta Norte)
DECLARE @NorteId INT = (SELECT PlantId FROM dbo.Plants WHERE PlantCode = 'PL_NORTE');

IF NOT EXISTS (SELECT 1 FROM dbo.ScadaTags WHERE PlantId = @NorteId)
BEGIN
    INSERT INTO dbo.ScadaTags (PlantId, TagName, ParameterCode, Description, Unit, MinSafeRange, MaxSafeRange, OpcNodeId)
    VALUES 
        (@NorteId, N'AFL_CAUDAL_01', N'caudal', N'Caudal de Afluente al Reactor', N'm³/h', 50.00, 300.00, N'ns=2;s=Afl.FIT01.PV'),
        (@NorteId, N'AFL_TURB_01', N'turbidez', N'Turbidez de Entrada Agua Cruda', N'NTU', 5.00, 150.00, N'ns=2;s=Afl.AIT01_Turb.PV'),
        (@NorteId, N'AFL_DQO_01', N'dqo', N'Demanda Química de Oxígeno Afluente', N'mg/L', 20.00, 800.00, N'ns=2;s=Afl.AIT02_DQO.PV'),
        (@NorteId, N'PAC_DOSIS_SP', N'pac', N'Consigna de Dosificación PAC Reactor 01', N'ppm', 15.00, 32.00, N'ns=2;s=Dos.PAC_SP'),
        (@NorteId, N'EFL_TURB_02', N'turbidez', N'Turbidez en Efluente Clarificado', N'NTU', 0.10, 4.00, N'ns=2;s=Efl.AIT03_Turb.PV'),
        (@NorteId, N'EFL_DQO_02', N'dqo', N'DQO en Efluente de Descarga Final', N'mg/L', 10.00, 60.00, N'ns=2;s=Efl.AIT04_DQO.PV'),
        (@NorteId, N'MBR_OD_01', N'od', N'Oxígeno Disuelto Biorreactor Tren 2', N'mg/L', 1.50, 3.50, N'ns=2;s=MBR.OD01.PV'),
        (@NorteId, N'FILT_DP_02', N'presion', N'Presión Diferencial Filtro Prensa 02', N'bar', 1.00, 5.00, N'ns=2;s=Filt.DPT02.PV');
END

UPDATE target
SET Description = seeded.Description,
    Unit = seeded.Unit
FROM dbo.ScadaTags AS target
JOIN (VALUES
    (N'AFL_CAUDAL_01', N'Caudal de Afluente al Reactor', N'm³/h'),
    (N'AFL_TURB_01', N'Turbidez de Entrada Agua Cruda', N'NTU'),
    (N'AFL_DQO_01', N'Demanda Química de Oxígeno Afluente', N'mg/L'),
    (N'PAC_DOSIS_SP', N'Consigna de Dosificación PAC Reactor 01', N'ppm'),
    (N'EFL_TURB_02', N'Turbidez en Efluente Clarificado', N'NTU'),
    (N'EFL_DQO_02', N'DQO en Efluente de Descarga Final', N'mg/L'),
    (N'MBR_OD_01', N'Oxígeno Disuelto Biorreactor Tren 2', N'mg/L'),
    (N'FILT_DP_02', N'Presión Diferencial Filtro Prensa 02', N'bar')
) AS seeded(TagName, Description, Unit) ON target.TagName = seeded.TagName
WHERE target.PlantId = @NorteId;
GO

-- 4. Insertar Alertas Operativas Base
DECLARE @PlantId INT = (SELECT PlantId FROM dbo.Plants WHERE PlantCode = 'PL_NORTE');

IF NOT EXISTS (SELECT 1 FROM dbo.OperationalAlerts WHERE PlantId = @PlantId)
BEGIN
    INSERT INTO dbo.OperationalAlerts (PlantId, AlertCode, Category, Severity, Title, Description, Status)
    VALUES 
        (@PlantId, N'pac', N'sobrecosto', N'ALTA', N'Sobredosificación PAC en Reactor MBR', N'Dosis actual de 28 ppm supera el requerimiento cinético para la turbidez de afluente (1.8 NTU proyectada).', N'abierta'),
        (@PlantId, N'filtro', N'mantenimiento', N'MODERADA', N'Presión diferencial alta en FILT-DEHYD-02', N'Delta P acumulado de 4.8 bar en telas de filtración. Requiere retrolavado preventivo.', N'abierta'),
        (@PlantId, N'membrana', N'quimico', N'MODERADA', N'Deriva química en membrana', N'Gradiente de permeabilidad sugiere incrustación inorgánica leve.', N'abierta');
END

UPDATE target
SET Title = seeded.Title,
    Description = seeded.Description
FROM dbo.OperationalAlerts AS target
JOIN (VALUES
    (N'pac', N'Sobredosificaci%', N'Sobredosificación PAC en Reactor MBR', N'Dosis actual de 28 ppm supera el requerimiento cinético para la turbidez de afluente (1.8 NTU proyectada).'),
    (N'filtro', N'Presi%', N'Presión diferencial alta en FILT-DEHYD-02', N'Delta P acumulado de 4.8 bar en telas de filtración. Requiere retrolavado preventivo.'),
    (N'membrana', N'Deriva%', N'Deriva química en membrana', N'Gradiente de permeabilidad sugiere incrustación inorgánica leve.')
) AS seeded(AlertCode, TitlePrefix, Title, Description)
    ON target.AlertCode = seeded.AlertCode AND target.Title LIKE seeded.TitlePrefix
WHERE target.PlantId = @PlantId;
GO

-- 5. Insertar Recomendación IA Activa
DECLARE @PlantId INT = (SELECT PlantId FROM dbo.Plants WHERE PlantCode = 'PL_NORTE');

IF NOT EXISTS (SELECT 1 FROM dbo.AiRecommendations WHERE PlantId = @PlantId)
BEGIN
    INSERT INTO dbo.AiRecommendations 
    (
        PlantId, ProcessUnit, ParameterName, CurrentValue, RecommendedValue, 
        ModelConfidencePct, UnitSavingUsdPerM3, MonthlySavingUsd, TotalMonthlySavingUsd, 
        ProjectedTurbidityNtu, ProjectedDqoMgL, ProjectedNom001Compliant, Status
    )
    VALUES 
    (
        @PlantId, 
        N'Reactor Floculador #01 · Dosificación PAC', 
        N'PAC_DOSE', 
        28.00, 
        19.00, 
        94.00, 
        0.1040, 
        14820.00, 
        19340.00, 
        1.80, 
        48.00, 
        1, 
        N'PENDIENTE'
    );
END
GO

UPDATE dbo.AiRecommendations
SET ProcessUnit = N'Reactor Floculador #01 · Dosificación PAC'
WHERE PlantId = (SELECT PlantId FROM dbo.Plants WHERE PlantCode = N'PL_NORTE')
  AND ParameterName = N'PAC_DOSE'
  AND CurrentValue = 28.00
  AND RecommendedValue = 19.00
  AND MonthlySavingUsd = 14820.00
  AND TotalMonthlySavingUsd = 19340.00;
GO

DECLARE @SeedPlantId INT = (SELECT PlantId FROM dbo.Plants WHERE PlantCode = 'PL_NORTE');

IF @SeedPlantId IS NULL
   OR (SELECT COUNT(*) FROM dbo.Shifts WHERE ShiftCode IN ('A', 'B', 'C')) < 3
   OR (SELECT COUNT(*) FROM dbo.ScadaTags WHERE PlantId = @SeedPlantId) < 8
   OR (SELECT COUNT(*) FROM dbo.OperationalAlerts WHERE PlantId = @SeedPlantId) < 3
   OR NOT EXISTS (
       SELECT 1 FROM dbo.AiRecommendations
       WHERE PlantId = @SeedPlantId AND ParameterName = 'PAC_DOSE'
   )
BEGIN
    THROW 50010, 'Seed data verification failed; review earlier SQL errors before continuing.', 1;
END

PRINT 'Datos semilla verificados e insertados correctamente en AquaSenseSCADA.';
GO

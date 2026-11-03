-- AquaSense AI - Eventos y cierres sintéticos para demostrar la bitácora.
-- Ejecutar solo en entornos de demostración; estos registros no son datos reales.
USE [AquaSenseSCADA];
GO

SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @PlantId INT = (SELECT PlantId FROM dbo.Plants WHERE PlantCode = N'PL_NORTE' AND IsActive = 1);
IF @PlantId IS NULL
    THROW 50040, 'No se encontró la planta PL_NORTE. Ejecuta primero los scripts de esquema y datos iniciales.', 1;

DECLARE @Now DATETIMEOFFSET = SYSDATETIMEOFFSET();
DECLARE @Today DATE = CONVERT(DATE, @Now);
DECLARE @DemoOperator NVARCHAR(100) = N'Demostración AquaSense';
DECLARE @DemoRole NVARCHAR(100) = N'Datos sintéticos';

DECLARE @Events TABLE (
    SequenceNo INT PRIMARY KEY,
    ShiftCode CHAR(1) NOT NULL,
    EventKind NVARCHAR(20) NOT NULL,
    Title NVARCHAR(200) NOT NULL,
    Detail NVARCHAR(MAX) NOT NULL,
    PlcAckStatus NVARCHAR(50) NOT NULL
);

INSERT INTO @Events (SequenceNo, ShiftCode, EventKind, Title, Detail, PlcAckStatus)
VALUES
    (1, 'B', N'datos', N'Revisión de parámetros de entrada', N'Dato sintético: caudal y condiciones de afluente revisados en el turno.', N'ACK_OK'),
    (2, 'B', N'alerta', N'Excursión de calidad en simulación', N'Dato sintético: excursión simulada de turbidez y DQO revisada por operación.', N'NOT_APPLIED'),
    (3, 'B', N'consigna', N'Recomendación PAC calculada', N'Dato sintético: se calculó una recomendación de dosis para evaluación humana.', N'NOT_APPLICABLE'),
    (4, 'B', N'consigna', N'Recomendación aprobada para simulación', N'Dato sintético: aprobación de ejemplo; no se enviaron órdenes a equipos reales.', N'APPROVED_NOT_APPLIED'),
    (5, 'A', N'alerta', N'Alerta de mantenimiento revisada', N'Dato sintético: condición de filtro revisada y seguimiento anotado.', N'ACK_OK'),
    (6, 'C', N'turno', N'Resumen del turno registrado', N'Dato sintético: valores de cierre capturados como ejemplo de demostración.', N'ACK_OK');

DECLARE @HandoverSamples TABLE (
    DaysAgo INT NOT NULL,
    ShiftCode CHAR(1) NOT NULL,
    VolumeTreatedM3 DECIMAL(12,2) NOT NULL,
    AverageFlowRateM3h DECIMAL(8,2) NOT NULL,
    AverageTurbidityNtu DECIMAL(6,2) NOT NULL,
    AverageDqoMgL DECIMAL(6,2) NOT NULL,
    AverageSstMgL DECIMAL(6,2) NOT NULL,
    Nom001CompliancePct DECIMAL(5,2) NOT NULL
);

INSERT INTO @HandoverSamples
    (DaysAgo, ShiftCode, VolumeTreatedM3, AverageFlowRateM3h, AverageTurbidityNtu, AverageDqoMgL, AverageSstMgL, Nom001CompliancePct)
VALUES
    (2, 'A', 1098.40, 137.30, 1.82, 44.60, 11.20, 100.00),
    (1, 'B', 1134.80, 141.85, 2.74, 51.30, 12.10, 91.70),
    (0, 'C', 1116.00, 139.50, 2.06, 46.80, 11.60, 100.00);

DECLARE @InsertedEvents INT = 0;
DECLARE @InsertedHandovers INT = 0;

BEGIN TRANSACTION;

INSERT INTO dbo.OperationsLog (
    PlantId, ShiftId, LoggedAt, EventKind, Title, Detail,
    OperatorName, OperatorRole, PlcAckStatus
)
SELECT
    @PlantId,
    shifts.ShiftId,
    DATEADD(MINUTE, -(events.SequenceNo - 1) * 15, @Now),
    events.EventKind,
    events.Title,
    events.Detail,
    @DemoOperator,
    @DemoRole,
    events.PlcAckStatus
FROM @Events AS events
JOIN dbo.Shifts AS shifts ON shifts.ShiftCode = events.ShiftCode
WHERE NOT EXISTS (
    SELECT 1
    FROM dbo.OperationsLog AS existing WITH (UPDLOCK, HOLDLOCK)
    WHERE existing.PlantId = @PlantId
      AND existing.OperatorName = @DemoOperator
      AND existing.Title = events.Title
);
SET @InsertedEvents = @@ROWCOUNT;

INSERT INTO dbo.ShiftHandovers (
    PlantId, ShiftId, HandoverDate, VolumeTreatedM3, AverageFlowRateM3h,
    AverageTurbidityNtu, AverageDqoMgL, AverageSstMgL, Nom001CompliancePct,
    IsCertified, SignedBy, SignedAt, SignatureHashSha256, Status
)
SELECT
    @PlantId,
    shifts.ShiftId,
    DATEADD(DAY, -samples.DaysAgo, @Today),
    samples.VolumeTreatedM3,
    samples.AverageFlowRateM3h,
    samples.AverageTurbidityNtu,
    samples.AverageDqoMgL,
    samples.AverageSstMgL,
    samples.Nom001CompliancePct,
    0,
    @DemoOperator,
    @Now,
    CONVERT(VARCHAR(64), HASHBYTES(
        'SHA2_256',
        CONCAT(@PlantId, '|', CONVERT(CHAR(10), DATEADD(DAY, -samples.DaysAgo, @Today), 23), '|', samples.ShiftCode, '|DEMO')
    ), 2),
    N'FIRMADO'
FROM @HandoverSamples AS samples
JOIN dbo.Shifts AS shifts ON shifts.ShiftCode = samples.ShiftCode
WHERE NOT EXISTS (
    SELECT 1
    FROM dbo.ShiftHandovers AS existing WITH (UPDLOCK, HOLDLOCK)
    WHERE existing.PlantId = @PlantId
      AND existing.HandoverDate = DATEADD(DAY, -samples.DaysAgo, @Today)
      AND existing.ShiftId = shifts.ShiftId
);
SET @InsertedHandovers = @@ROWCOUNT;

COMMIT TRANSACTION;

PRINT CONCAT(@InsertedEvents, ' eventos sintéticos y ', @InsertedHandovers, ' cierres de ejemplo agregados para PL_NORTE.');
PRINT 'Los cierres tienen IsCertified = 0 y están atribuidos a Demostración AquaSense.';
GO

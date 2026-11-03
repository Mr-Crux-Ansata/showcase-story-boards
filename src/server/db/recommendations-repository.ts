import sql from "mssql";
import { getDbPool } from "./client";
import { DatabaseUnavailableError } from "./errors";
import type { OptimizationResult } from "../ai/surrogate-model";

export async function saveAiRecommendation(
  result: OptimizationResult,
  plantCode = "PL_NORTE",
): Promise<number> {
  const pool = await getDbPool();
  if (!pool) throw new DatabaseUnavailableError();
  const request = pool.request();
  request.input("PlantCode", sql.NVarChar(50), plantCode);
  request.input("ProcessUnit", sql.NVarChar(100), "Reactor Floculador #01 · Dosificación PAC");
  request.input("ParameterName", sql.NVarChar(50), "PAC_DOSE");
  request.input("CurrentValue", sql.Decimal(8, 2), result.currentDosePpm);
  request.input("RecommendedValue", sql.Decimal(8, 2), result.recommendedDosePpm);
  request.input("ModelConfidencePct", sql.Decimal(5, 2), result.confidencePct);
  request.input("ModelVersion", sql.NVarChar(50), result.modelVersion);
  request.input("UnitSavingUsdPerM3", sql.Decimal(8, 4), result.prediction.unitSavingUsd);
  request.input("MonthlySavingUsd", sql.Decimal(12, 2), result.prediction.monthlySavingUsd);
  request.input("TotalMonthlySavingUsd", sql.Decimal(12, 2), result.prediction.monthlySavingUsd);
  request.input("ProjectedTurbidityNtu", sql.Decimal(6, 2), result.prediction.turbidityNtu);
  request.input("ProjectedDqoMgL", sql.Decimal(6, 2), result.prediction.dqoMgL);
  request.input("ProjectedNom001Compliant", sql.Bit, result.prediction.nom001Compliant ? 1 : 0);
  const inserted = await request.query<{ RecommendationId: number }>(`
    DECLARE @PlantId INT = (SELECT PlantId FROM dbo.Plants WHERE PlantCode = @PlantCode AND IsActive = 1);
    IF @PlantId IS NULL THROW 50001, 'Unknown plant.', 1;
    INSERT dbo.AiRecommendations (PlantId, ProcessUnit, ParameterName, CurrentValue, RecommendedValue,
      ModelConfidencePct, ModelVersion, UnitSavingUsdPerM3, MonthlySavingUsd, TotalMonthlySavingUsd,
      ProjectedTurbidityNtu, ProjectedDqoMgL, ProjectedNom001Compliant, Status)
    OUTPUT INSERTED.RecommendationId
    VALUES (@PlantId, @ProcessUnit, @ParameterName, @CurrentValue, @RecommendedValue,
      @ModelConfidencePct, @ModelVersion, @UnitSavingUsdPerM3, @MonthlySavingUsd, @TotalMonthlySavingUsd,
      @ProjectedTurbidityNtu, @ProjectedDqoMgL, @ProjectedNom001Compliant, N'PENDIENTE');
  `);
  const id = inserted.recordset[0]?.RecommendationId;
  if (id === undefined) throw new Error("Recommendation was not inserted.");
  return id;
}

export async function evaluateAiRecommendation(input: {
  recommendationId: number;
  plantCode: string;
  status: "APROBADA" | "RECHAZADA";
  operatorName: string;
  operatorRole: string;
  shiftCode: "A" | "B" | "C";
  expectedDose?: number;
  notes?: string;
}) {
  const pool = await getDbPool();
  if (!pool) throw new DatabaseUnavailableError();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const request = new sql.Request(transaction);
    request
      .input("RecommendationId", sql.BigInt, input.recommendationId)
      .input("PlantCode", sql.NVarChar(50), input.plantCode)
      .input("Status", sql.NVarChar(20), input.status)
      .input("Operator", sql.NVarChar(100), input.operatorName)
      .input("Role", sql.NVarChar(100), input.operatorRole)
      .input("ExpectedDose", sql.Decimal(8, 2), input.expectedDose ?? null)
      .input("Notes", sql.NVarChar(500), input.notes ?? null);
    const changed = await request.query<{
      RecommendationId: number;
      PlantId: number;
      RecommendedValue: number;
      ParameterName: string;
    }>(`
      UPDATE dbo.AiRecommendations
      SET Status = @Status, EvaluatedAt = SYSDATETIMEOFFSET(), EvaluatedBy = @Operator, OperatorNotes = @Notes
      OUTPUT INSERTED.RecommendationId, INSERTED.PlantId, INSERTED.RecommendedValue, INSERTED.ParameterName
      WHERE RecommendationId = @RecommendationId AND Status = N'PENDIENTE'
        AND PlantId = (SELECT PlantId FROM dbo.Plants WHERE PlantCode = @PlantCode AND IsActive = 1)
        AND (@ExpectedDose IS NULL OR RecommendedValue = @ExpectedDose);
    `);
    const rec = changed.recordset[0];
    if (!rec) throw new Error("Recommendation not found or already evaluated.");
    const plant = await new sql.Request(transaction)
      .input("PlantId", sql.Int, rec.PlantId)
      .query<{ PlantCode: string }>("SELECT PlantCode FROM dbo.Plants WHERE PlantId = @PlantId");
    const plantCode = plant.recordset[0]?.PlantCode;
    if (!plantCode) throw new Error("Recommendation plant was not found.");
    const event = new sql.Request(transaction);
    event
      .input("PlantId", sql.Int, rec.PlantId)
      .input("ShiftCode", sql.Char(1), input.shiftCode)
      .input("Title", sql.NVarChar(200), `Recomendación IA ${input.status.toLowerCase()}`)
      .input(
        "Detail",
        sql.NVarChar(sql.MAX),
        input.notes ??
          `Recomendación ${input.recommendationId}; dosis ${rec.RecommendedValue} ppm.`,
      )
      .input("Operator", sql.NVarChar(100), input.operatorName)
      .input("Role", sql.NVarChar(100), input.operatorRole)
      .input(
        "Ack",
        sql.NVarChar(50),
        input.status === "APROBADA" ? "APPROVED_NOT_APPLIED" : "NOT_APPLIED",
      );
    await event.query(`
      DECLARE @ShiftId INT = (SELECT ShiftId FROM dbo.Shifts WHERE ShiftCode = @ShiftCode);
      INSERT dbo.OperationsLog (PlantId, ShiftId, EventKind, Title, Detail, OperatorName, OperatorRole, PlcAckStatus)
      VALUES (@PlantId, @ShiftId, N'consigna', @Title, @Detail, @Operator, @Role, @Ack);
    `);
    await transaction.commit();
    return {
      recommendationId: rec.RecommendationId,
      plantCode,
      dosePpm: rec.RecommendedValue,
      status: input.status,
    };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function expireAiRecommendation(input: {
  recommendationId: number;
  plantCode: string;
  operatorName: string;
  operatorRole: string;
  shiftCode: "A" | "B" | "C";
}) {
  const pool = await getDbPool();
  if (!pool) throw new DatabaseUnavailableError();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const result = await new sql.Request(transaction)
      .input("RecommendationId", sql.BigInt, input.recommendationId)
      .input("PlantCode", sql.NVarChar(50), input.plantCode)
      .input("Operator", sql.NVarChar(100), input.operatorName)
      .input("ShiftCode", sql.Char(1), input.shiftCode)
      .input("Role", sql.NVarChar(100), input.operatorRole).query(`
      UPDATE dbo.AiRecommendations SET Status = N'EXPIRADA', EvaluatedAt = SYSDATETIMEOFFSET(), EvaluatedBy = @Operator
      WHERE RecommendationId = @RecommendationId AND Status = N'PENDIENTE'
        AND PlantId = (SELECT PlantId FROM dbo.Plants WHERE PlantCode = @PlantCode);
      DECLARE @Changed INT = @@ROWCOUNT;
      IF @Changed = 1
      BEGIN
        DECLARE @PlantId INT = (SELECT PlantId FROM dbo.Plants WHERE PlantCode = @PlantCode);
        DECLARE @ShiftId INT = (SELECT ShiftId FROM dbo.Shifts WHERE ShiftCode = @ShiftCode);
        INSERT dbo.OperationsLog (PlantId, ShiftId, EventKind, Title, Detail, OperatorName, OperatorRole, PlcAckStatus)
        VALUES (@PlantId, @ShiftId, N'consigna', N'Recomendación IA expirada',
          CONCAT(N'Recomendación ', @RecommendationId, N' marcada como expirada por el operador.'),
          @Operator, @Role, N'NOT_APPLIED');
      END;
      SELECT @Changed AS changed;
    `);
    await transaction.commit();
    return result.recordset[0]?.changed === 1;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function revokeAiApproval(
  recommendationId: number,
  plantCode: string,
  operatorName: string,
  operatorRole: string,
  shiftCode: "A" | "B" | "C",
) {
  const pool = await getDbPool();
  if (!pool) throw new DatabaseUnavailableError();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const update = await new sql.Request(transaction)
      .input("RecommendationId", sql.BigInt, recommendationId)
      .input("PlantCode", sql.NVarChar(50), plantCode)
      .input("Operator", sql.NVarChar(100), operatorName).query<{
      PlantId: number;
      RecommendedValue: number;
    }>(`
        UPDATE dbo.AiRecommendations SET Status = N'RECHAZADA', EvaluatedAt = SYSDATETIMEOFFSET(),
          EvaluatedBy = @Operator
        OUTPUT INSERTED.PlantId, INSERTED.RecommendedValue
        WHERE RecommendationId = @RecommendationId AND Status = N'APROBADA' AND ParameterName = N'PAC_DOSE'
          AND PlantId = (SELECT PlantId FROM dbo.Plants WHERE PlantCode = @PlantCode AND IsActive = 1);
      `);
    const record = update.recordset[0];
    if (!record) throw new Error("Approved recommendation not found.");
    const log = new sql.Request(transaction);
    log
      .input("PlantId", sql.Int, record.PlantId)
      .input("ShiftCode", sql.Char(1), shiftCode)
      .input("Operator", sql.NVarChar(100), operatorName)
      .input("Role", sql.NVarChar(100), operatorRole)
      .input("Dose", sql.Decimal(8, 2), record.RecommendedValue);
    await log.query(`
      DECLARE @ShiftId INT = (SELECT ShiftId FROM dbo.Shifts WHERE ShiftCode = @ShiftCode);
      INSERT dbo.OperationsLog (PlantId, ShiftId, EventKind, Title, Detail, OperatorName, OperatorRole, PlcAckStatus)
      VALUES (@PlantId, @ShiftId, N'consigna', N'Aprobación IA retirada',
        CONCAT(N'Aprobación retirada; los siguientes ciclos simulados dejarán de leer la dosis ', @Dose, N' ppm.'),
        @Operator, @Role, N'SIMULATED_APPROVAL_REVOKED');
    `);
    await transaction.commit();
    return true;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

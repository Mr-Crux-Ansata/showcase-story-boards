import { z } from "zod";

export const TelemetryPayloadSchema = z.object({
  plantCode: z.string().regex(/^[A-Za-z0-9_-]{1,50}$/),
  shiftCode: z.enum(["A", "B", "C"]),
  timestamp: z.string().datetime().optional(),

  // Afluente (Entrada al reactor)
  inflowRateM3h: z.number().min(0).max(1000),
  inflowTurbidityNtu: z.number().min(0).max(500),
  inflowDqoMgL: z.number().min(0).max(2000),
  inflowPh: z.number().min(0).max(14),
  inflowTemperatureC: z.number().min(0).max(60).optional(),

  // Dosificación Coagulante PAC
  pacDosePpm: z.number().min(5).max(50),
  pacPumpFrequencyHz: z.number().min(0).max(60).optional(),

  // Biorreactor MBR / Aireación
  mbrDissolvedOxygenMgL: z.number().min(0).max(15).optional(),
  blowerFrequencyHz: z.number().min(0).max(60).optional(),

  // Efluente de Descarga (NOM-001)
  effluentTurbidityNtu: z.number().min(0).max(50),
  effluentDqoMgL: z.number().min(0).max(200),
  effluentSstMgL: z.number().min(0).max(100).optional(),
  effluentPh: z.number().min(0).max(14),

  // Estado del Gateway
  gatewayStatus: z.enum(["ONLINE", "DEGRADED", "CALIBRATING"]).optional(),
});

export type TelemetryPayload = z.infer<typeof TelemetryPayloadSchema>;

export interface TelemetrySnapshot extends Omit<TelemetryPayload, "gatewayStatus"> {
  gatewayStatus?: TelemetryPayload["gatewayStatus"];
  snapshotId?: number;
  recordedAt: string;
  nom001Compliant: boolean;
  dataQualityFlag: "GOOD" | "BAD" | "UNCERTAIN" | "STUCK";
}

export interface InflowConditions {
  inflowRateM3h: number;
  inflowTurbidityNtu: number;
  inflowDqoMgL: number;
  inflowPh: number;
  inflowTemperatureC?: number;
  currentDosePpm?: number;
}

export interface QualityPrediction {
  turbidityNtu: number;
  dqoMgL: number;
  unitCostUsd: number;
  unitSavingUsd: number;
  monthlySavingUsd: number;
  nom001Compliant: boolean;
  turbidityMarginPct: number;
  dqoMarginPct: number;
}

export interface OptimizationResult {
  currentDosePpm: number;
  recommendedDosePpm: number;
  confidencePct: number;
  modelVersion: string;
  prediction: QualityPrediction;
  referencePrediction: QualityPrediction;
  reasoning: string;
  doseSensitivityCurve: Array<{
    dosePpm: number;
    turbidityNtu: number;
    dqoMgL: number;
    monthlySavingUsd: number;
    isOptimal: boolean;
    compliant: boolean;
  }>;
  safetySafeguards: {
    safeRangeMin: number;
    safeRangeMax: number;
    outOfDistributionWarning: boolean;
  };
}

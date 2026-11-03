import type { TelemetrySnapshot } from "./types/telemetry";

export function selectedPlantCode(label: string) {
  if (label === "Planta Sur" || label === "PL_SUR") return "PL_SUR";
  if (label === "Planta Oriente" || label === "PL_ORIENTE") return "PL_ORIENTE";
  return "PL_NORTE";
}

export type Page<T> = { data: T[]; total: number; limit: number; offset: number };
export type OperationalAlert = {
  alertId: number;
  alertCode: string;
  category: string;
  severity: string;
  title: string;
  description: string;
  status: "abierta" | "pausada" | "resuelta";
  triggeredAt: string;
  pausedUntil: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
};
export type OperationsLogRecord = {
  logId: number;
  loggedAt: string;
  shiftCode: string;
  eventKind: string;
  title: string;
  detail: string;
  operatorName: string;
  operatorRole: string;
  plcAckStatus: string;
  digitalSignatureSha256: string | null;
};
export type RecommendationRecord = {
  recommendationId: number;
  processUnit: string;
  parameterName: string;
  currentValue: number;
  recommendedValue: number;
  modelConfidencePct: number;
  modelVersion: string;
  unitSavingUsdPerM3: number;
  monthlySavingUsd: number;
  totalMonthlySavingUsd: number;
  projectedTurbidityNtu: number;
  projectedDqoMgL: number;
  projectedNom001Compliant: boolean;
  isStressScenario: boolean;
  status: "PENDIENTE" | "APROBADA" | "RECHAZADA" | "EXPIRADA";
  evaluatedAt: string | null;
  evaluatedBy: string | null;
  operatorNotes: string | null;
  createdAt: string;
};
export type HandoverRecord = {
  handoverId: number;
  shiftCode: string;
  handoverDate: string;
  volumeTreatedM3: number;
  averageFlowRateM3h: number;
  averageTurbidityNtu: number;
  averageDqoMgL: number;
  averageSstMgL: number;
  nom001CompliancePct: number;
  isCertified: boolean;
  signedBy: string;
  signedAt: string;
  signatureHashSha256: string;
  status: string;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : `Request failed (${response.status}).`;
    throw new ApiError(message, response.status);
  }
  return payload as T;
}

function pageUrl(path: string, plantCode: string, limit = 50, offset = 0) {
  const params = new URLSearchParams({ plantCode, limit: String(limit), offset: String(offset) });
  return `${path}?${params.toString()}`;
}

export const api = {
  telemetry: (plantCode: string, limit = 200) =>
    request<Page<TelemetrySnapshot>>(pageUrl("/api/telemetry/history", plantCode, limit)),
  alerts: (plantCode: string) => request<Page<OperationalAlert>>(pageUrl("/api/alerts", plantCode)),
  updateAlert: (
    id: number,
    plantCode: string,
    status: OperationalAlert["status"],
    shiftCode: "A" | "B" | "C",
    pausedUntil?: string,
  ) =>
    request<{ ok: true; alert: Partial<OperationalAlert> }>(`/api/alerts/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        plantCode,
        status,
        shiftCode,
        ...(pausedUntil ? { pausedUntil } : {}),
      }),
    }),
  operationsLog: (plantCode: string, limit = 200, offset = 0) =>
    request<Page<OperationsLogRecord>>(pageUrl("/api/operations-log", plantCode, limit, offset)),
  recommendations: (plantCode: string) =>
    request<Page<RecommendationRecord>>(pageUrl("/api/ai/recommendations", plantCode)),
  handovers: (plantCode: string) =>
    request<Page<HandoverRecord>>(pageUrl("/api/shift-handovers", plantCode)),
  createHandover: (input: {
    plantCode: string;
    shiftCode: string;
    handoverDate: string;
    volumeTreatedM3: number;
    averageFlowRateM3h: number;
    averageTurbidityNtu: number;
    averageDqoMgL: number;
    averageSstMgL: number;
    nom001CompliancePct: number;
  }) =>
    request<{
      ok: true;
      handover: Pick<HandoverRecord, "handoverId" | "status" | "signedAt" | "signatureHashSha256">;
    }>("/api/shift-handovers", { method: "POST", body: JSON.stringify(input) }),
};

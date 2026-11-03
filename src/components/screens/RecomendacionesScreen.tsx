import { useState } from "react";
import { toast } from "sonner";
import { ScadaShell } from "./ScadaShell";
import { Button } from "@/components/ui/button";
import { useApiData } from "@/hooks/use-api-data";
import { api, selectedPlantCode, type Page, type RecommendationRecord } from "@/lib/api-client";
import { useAppContext } from "@/lib/app-context-store";
import { useLiveTelemetry } from "@/hooks/use-live-telemetry";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { OptimizationResult } from "@/lib/types/telemetry";
import { SAFE_DOSE_MAX, SAFE_DOSE_MIN, validateDose } from "@/lib/dose-validation";

type OptimizeResponse = {
  result: OptimizationResult;
  persisted: boolean;
  recommendationId: number | null;
  warning?: string;
};
type Decision = "APROBADA" | "RECHAZADA" | "EXPIRADA" | "REVOKE" | null;
const money = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
const createdAt = (value: string) => new Date(value).toLocaleString("es-MX");

export function RecomendacionesScreen() {
  const plant = useAppContext((state) => state.plant);
  const shift = useAppContext((state) => state.shift);
  const plantCode = selectedPlantCode(plant);
  const { isLive, data: liveTelemetry } = useLiveTelemetry();
  const [refresh, setRefresh] = useState(0);
  const [generated, setGenerated] = useState<OptimizeResponse | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [decisionBusy, setDecisionBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decision, setDecision] = useState<Decision>(null);
  const listUrl = `/api/ai/recommendations?${new URLSearchParams({ plantCode, limit: "100" })}`;
  const history = useApiData<Page<RecommendationRecord>>(listUrl, refresh);
  const pending = history.data?.data.find((record) => record.status === "PENDIENTE") ?? null;

  const recommendationId = generated?.recommendationId ?? pending?.recommendationId ?? null;
  const dose = generated?.result.recommendedDosePpm ?? pending?.recommendedValue ?? null;
  const currentDose =
    generated?.result.currentDosePpm ?? pending?.currentValue ?? liveTelemetry?.pacDosePpm ?? null;
  const turbidity =
    generated?.result.prediction.turbidityNtu ?? pending?.projectedTurbidityNtu ?? null;
  const dqo = generated?.result.prediction.dqoMgL ?? pending?.projectedDqoMgL ?? null;
  const savings =
    generated?.result.prediction.monthlySavingUsd ?? pending?.monthlySavingUsd ?? null;
  const compliant =
    generated?.result.prediction.nom001Compliant ?? pending?.projectedNom001Compliant ?? null;
  const status = generated?.persisted ? "PENDIENTE" : (pending?.status ?? null);
  const doseCheck =
    dose === null
      ? { ok: false as const, reason: "No hay dosis para evaluar." }
      : validateDose(dose, compliant === true);
  const canApprove =
    recommendationId !== null && doseCheck.ok && status === "PENDIENTE" && !decisionBusy;

  async function generate() {
    setOptimizing(true);
    setError(null);
    setGenerated(null);
    try {
      const response = await fetch("/api/ai/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ plantCode }),
      });
      const body = (await response.json()) as OptimizeResponse & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "No se pudo calcular la recomendación.");
      setGenerated(body);
      setRefresh((value) => value + 1);
      if (!body.persisted)
        setError(body.warning ?? "La recomendación no se guardó y no se puede aprobar.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Error de optimización.");
    } finally {
      setOptimizing(false);
    }
  }

  async function submitDecision(next: Exclude<Decision, null>) {
    if (!recommendationId || !dose) return;
    setDecision(next);
    if (next === "APROBADA") {
      setConfirming(true);
      return;
    }
    await persistDecision(next);
  }

  async function persistDecision(next: Exclude<Decision, null>) {
    if (!recommendationId) return;
    setDecisionBusy(true);
    setError(null);
    try {
      const url =
        next === "REVOKE"
          ? "/api/ai/recommendations/revoke"
          : next === "EXPIRADA"
            ? "/api/ai/recommendations/expire"
            : "/api/ai/recommendations/approve";
      const payload =
        next === "REVOKE"
          ? { recommendationId, plantCode, shiftCode: shift }
          : next === "EXPIRADA"
            ? { recommendationId, plantCode, shiftCode: shift }
            : {
                recommendationId,
                plantCode,
                dosePpm: dose,
                shiftCode: shift,
                status: next,
                notes: `Decisión del operador ${next.toLowerCase()}.`,
              };
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as { error?: string; status?: string };
      if (!response.ok) throw new Error(body.error ?? "No se pudo guardar la decisión.");
      setGenerated(null);
      setRefresh((value) => value + 1);
      setConfirming(false);
      toast.success(
        next === "APROBADA"
          ? "Recomendación aprobada para la simulación. No se enviaron órdenes a equipos reales."
          : next === "REVOKE"
            ? "Aprobación retirada para los próximos ciclos de simulación."
            : `Recomendación ${next.toLowerCase()}.`,
      );
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "No se pudo guardar la decisión.";
      setError(message);
      toast.error(message);
    } finally {
      setDecisionBusy(false);
      setDecision(null);
    }
  }

  async function revokeRecord(recommendationId: number) {
    setDecisionBusy(true);
    try {
      const response = await fetch("/api/ai/recommendations/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ recommendationId, plantCode, shiftCode: shift }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "No se pudo retirar la aprobación.");
      setRefresh((value) => value + 1);
      toast.success("Aprobación retirada para los próximos ciclos de simulación.");
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "No se pudo retirar la aprobación.");
    } finally {
      setDecisionBusy(false);
    }
  }

  return (
    <ScadaShell>
      <main className="min-h-screen space-y-6 px-8 pb-16 pt-24">
        <header className="flex flex-wrap items-end justify-between gap-3 border-b border-scada-ink-26 pb-4">
          <div>
            <h1 className="text-2xl font-bold text-scada-ink-33">Recomendaciones IA</h1>
            <p className="mt-1 text-sm text-scada-ink-35">
              Un modelo estima la dosis sugerida; la persona operadora decide si aprobarla.
            </p>
          </div>
          <span className="rounded-full border px-3 py-1 text-xs font-bold">
            {isLive ? "Simulación conectada" : "Sin telemetría en vivo"}
          </span>
        </header>

        {history.error && (
          <p
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
          >
            No se pudo cargar el historial de recomendaciones. Intenta de nuevo más tarde.
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
          >
            {error}
          </p>
        )}
        <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
          <article className="space-y-5 rounded-xl border bg-background p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase text-primary">
                  Modelo de estimación PAC
                </p>
                <h2 className="mt-1 text-xl font-bold">Optimización de dosificación PAC</h2>
              </div>
              <Button onClick={generate} disabled={optimizing}>
                {optimizing ? "Calculando…" : "Calcular con telemetría actual"}
              </Button>
            </div>
            {history.loading && <p role="status">Cargando recomendaciones…</p>}
            {dose === null ? (
              <p className="rounded-lg bg-muted/50 p-5 text-sm text-muted-foreground">
                No hay recomendación pendiente. Calcula una usando la telemetría recibida, o
                consulta el historial guardado.
              </p>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Metric
                    label="Dosis actual"
                    value={currentDose === null ? "—" : `${currentDose.toFixed(2)} ppm`}
                  />
                  <Metric label="Dosis sugerida" value={`${dose.toFixed(2)} ppm`} />
                  <Metric
                    label="Ahorro PAC estimado"
                    value={savings === null ? "—" : `${money(savings)}/mes`}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Metric
                    label="Turbidez proyectada"
                    value={turbidity === null ? "—" : `${turbidity.toFixed(2)} NTU`}
                  />
                  <Metric
                    label="DQO proyectada"
                    value={dqo === null ? "—" : `${dqo.toFixed(1)} mg/L`}
                  />
                </div>
                {generated?.result.reasoning && (
                  <p className="rounded-lg bg-muted/50 p-4 text-sm">{generated.result.reasoning}</p>
                )}
                <div className="space-y-1 text-sm">
                  <p>
                    Predicción NOM-001:{" "}
                    <strong>
                      {compliant === null ? "sin datos" : compliant ? "cumple" : "no cumple"}
                    </strong>
                  </p>
                  <p>
                    Estado de la recomendación:{" "}
                    <strong>{status ?? (generated?.persisted ? "PENDIENTE" : "Temporal")}</strong>
                  </p>
                  {pending && (
                    <p className="text-xs text-muted-foreground">
                      Creada: {createdAt(pending.createdAt)} · Confianza estimada:{" "}
                      {pending.modelConfidencePct}%
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2 border-t pt-4">
                  <Button disabled={!canApprove} onClick={() => void submitDecision("APROBADA")}>
                    Aprobar recomendación
                  </Button>
                  <Button
                    variant="outline"
                    disabled={!canApprove}
                    onClick={() => void submitDecision("RECHAZADA")}
                  >
                    Rechazar
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={!recommendationId || status !== "PENDIENTE" || decisionBusy}
                    onClick={() => void submitDecision("EXPIRADA")}
                  >
                    Marcar expirada
                  </Button>
                  {status === "APROBADA" && (
                    <Button
                      variant="destructive"
                      disabled={decisionBusy}
                      onClick={() => void submitDecision("REVOKE")}
                    >
                      Retirar aprobación
                    </Button>
                  )}
                </div>
                {!doseCheck.ok && dose !== null && (
                  <p className="text-sm text-destructive">
                    {doseCheck.reason} La dosis debe estar entre {SAFE_DOSE_MIN}–{SAFE_DOSE_MAX}{" "}
                    ppm.
                  </p>
                )}
                {generated && !generated.persisted && (
                  <p className="text-sm text-amber-700">
                    El resultado no quedó guardado y no se puede aprobar.
                  </p>
                )}
              </>
            )}
          </article>

          <article className="space-y-3 rounded-xl border bg-background p-6">
            <h2 className="text-lg font-bold">Historial de recomendaciones</h2>
            {(history.data?.data ?? []).length === 0 && !history.loading && (
              <p className="text-sm text-muted-foreground">Sin recomendaciones almacenadas.</p>
            )}
            <ul className="space-y-2">
              {history.data?.data.map((record) => (
                <li key={record.recommendationId} className="rounded-lg border p-3 text-sm">
                  <div className="flex justify-between gap-2">
                    <strong>{record.recommendedValue.toFixed(2)} ppm · Dosis PAC</strong>
                    <span>{record.status}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {createdAt(record.createdAt)}
                  </p>
                  {record.status === "APROBADA" && (
                    <Button
                      className="mt-2"
                      size="sm"
                      variant="outline"
                      disabled={decisionBusy}
                      onClick={() => void revokeRecord(record.recommendationId)}
                    >
                      Retirar aprobación
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </article>
        </section>

        <section className="rounded-xl border bg-muted/30 p-5 text-sm text-muted-foreground">
          Las recomendaciones aprobadas solo afectan a la simulación; no controlan equipos reales.
        </section>

        <AlertDialog open={confirming} onOpenChange={setConfirming}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Aprobar la recomendación de {dose ?? "—"} ppm?</AlertDialogTitle>
              <AlertDialogDescription>
                Esta aprobación solo afecta a la simulación y no envía órdenes a equipos reales.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={decisionBusy}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                disabled={decisionBusy}
                onClick={(event) => {
                  event.preventDefault();
                  void persistDecision("APROBADA");
                }}
              >
                Confirmar aprobación
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </main>
    </ScadaShell>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-4">
      <p className="text-xs font-semibold uppercase text-muted-foreground">{label}</p>
      <p className="mt-2 text-xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

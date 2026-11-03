import { useState } from "react";
import { toast } from "sonner";
import { BadgeCheck, Beaker, BrainCircuit, CircleAlert, History, Sparkles } from "lucide-react";
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

function recommendationStatusTone(status: RecommendationRecord["status"]) {
  if (status === "APROBADA") return "bg-emerald-50 text-emerald-800 ring-emerald-200";
  if (status === "PENDIENTE") return "bg-amber-50 text-amber-800 ring-amber-200";
  if (status === "RECHAZADA") return "bg-rose-50 text-rose-800 ring-rose-200";
  return "bg-slate-100 text-slate-700 ring-slate-200";
}

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

  const recommendationId = generated
    ? generated.recommendationId
    : (pending?.recommendationId ?? null);
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
  const status = generated ? (generated.persisted ? "PENDIENTE" : null) : (pending?.status ?? null);
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
        <header className="relative overflow-hidden rounded-2xl border border-violet-200 bg-gradient-to-br from-violet-50 via-background to-sky-50 p-6 shadow-sm">
          <div className="pointer-events-none absolute -right-8 -top-12 h-48 w-48 rounded-full bg-violet-300/20 blur-3xl" />
          <div className="relative flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <span className="rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-700 p-3 text-white shadow-lg shadow-violet-900/20">
                <BrainCircuit aria-hidden="true" className="h-7 w-7" />
              </span>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-violet-800">
                  Asistencia a la operación
                </p>
                <h1 className="text-2xl font-bold text-scada-ink-33">Recomendaciones IA</h1>
                <p className="mt-1 text-sm text-scada-ink-35">
                  Un modelo estima la dosis sugerida; la persona operadora decide si aprobarla.
                </p>
              </div>
            </div>
            <span
              className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-bold ring-1 ring-inset ${isLive ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-amber-50 text-amber-800 ring-amber-200"}`}
            >
              <span
                className={`h-2 w-2 rounded-full ${isLive ? "bg-emerald-500" : "bg-amber-500"}`}
              />
              {isLive ? "Simulación conectada" : "Sin telemetría en vivo"}
            </span>
          </div>
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
          <article className="space-y-5 rounded-xl border border-violet-200 bg-gradient-to-br from-background via-background to-violet-50/60 p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="rounded-xl bg-violet-100 p-2.5 text-violet-700">
                  <Sparkles aria-hidden="true" className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-violet-800">
                    Modelo de estimación PAC
                  </p>
                  <h2 className="mt-1 text-xl font-bold text-violet-950">
                    Optimización de dosificación PAC
                  </h2>
                </div>
              </div>
              <Button
                onClick={generate}
                disabled={optimizing}
                className="bg-violet-700 text-white shadow-sm hover:bg-violet-800"
              >
                <Sparkles aria-hidden="true" className="mr-2 h-4 w-4" />
                {optimizing ? "Calculando…" : "Calcular con telemetría actual"}
              </Button>
            </div>
            {history.loading && <p role="status">Cargando recomendaciones…</p>}
            {dose === null ? (
              <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-violet-200 bg-violet-50/60 p-7 text-center">
                <Beaker aria-hidden="true" className="h-8 w-8 text-violet-500" />
                <p className="text-sm font-semibold text-violet-950">
                  No hay recomendación pendiente.
                </p>
                <p className="max-w-md text-sm text-muted-foreground">
                  Calcula una con la telemetría recibida o consulta el historial guardado.
                </p>
              </div>
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
                  <p className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm leading-relaxed text-sky-950">
                    {generated.result.reasoning}
                  </p>
                )}
                <div className="flex flex-wrap gap-2 text-xs font-semibold">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 ring-1 ring-inset ${compliant === null ? "bg-slate-50 text-slate-700 ring-slate-200" : compliant ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-rose-50 text-rose-800 ring-rose-200"}`}
                  >
                    {compliant === null ? (
                      <Sparkles className="h-4 w-4" />
                    ) : compliant ? (
                      <BadgeCheck className="h-4 w-4" />
                    ) : (
                      <CircleAlert className="h-4 w-4" />
                    )}
                    Predicción:{" "}
                    {compliant === null ? "sin datos" : compliant ? "cumple" : "no cumple"}
                  </span>
                  <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1.5 text-slate-700 ring-1 ring-inset ring-slate-200">
                    Estado: {status ?? (generated?.persisted ? "PENDIENTE" : "Temporal")}
                  </span>
                  {pending && (
                    <span className="inline-flex items-center rounded-full bg-blue-50 px-3 py-1.5 text-blue-800 ring-1 ring-inset ring-blue-200">
                      Creada: {createdAt(pending.createdAt)} · Confianza estimada:{" "}
                      {pending.modelConfidencePct}%
                    </span>
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
                  <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
                    {doseCheck.reason}
                    {(dose < SAFE_DOSE_MIN || dose > SAFE_DOSE_MAX) && (
                      <>
                        {" "}
                        Calcula de nuevo para obtener una recomendación dentro de {SAFE_DOSE_MIN}–
                        {SAFE_DOSE_MAX} ppm.
                      </>
                    )}
                  </p>
                )}
                {generated && !generated.persisted && (
                  <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    El resultado no quedó guardado y no se puede aprobar.
                  </p>
                )}
              </>
            )}
          </article>

          <article className="space-y-3 rounded-xl border border-blue-200 bg-gradient-to-br from-background via-background to-blue-50/60 p-6 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="rounded-lg bg-blue-100 p-2 text-blue-700">
                <History aria-hidden="true" className="h-4 w-4" />
              </span>
              <h2 className="text-lg font-bold text-blue-950">Historial de recomendaciones</h2>
            </div>
            {(history.data?.data ?? []).length === 0 && !history.loading && (
              <p className="rounded-xl border border-dashed border-blue-200 bg-blue-50/60 p-5 text-center text-sm text-blue-900">
                Aún no hay recomendaciones en el historial.
              </p>
            )}
            <ul className="space-y-2">
              {history.data?.data.map((record) => (
                <li
                  key={record.recommendationId}
                  className="rounded-xl border border-blue-100 bg-white/80 p-3 text-sm shadow-sm"
                >
                  <div className="flex justify-between gap-2">
                    <strong className="text-slate-900">
                      {record.recommendedValue.toFixed(2)} ppm · Dosis PAC
                    </strong>
                    <span
                      className={`inline-flex h-fit rounded-full px-2.5 py-1 text-[10px] font-bold ring-1 ring-inset ${recommendationStatusTone(record.status)}`}
                    >
                      {record.status}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {createdAt(record.createdAt)}
                  </p>
                  {record.status === "APROBADA" && (
                    <Button
                      className="mt-2 border-amber-300 text-amber-800 hover:bg-amber-50"
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

        <section className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 shadow-sm">
          <CircleAlert aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
          <p>
            Las recomendaciones aprobadas solo afectan a la simulación; no controlan equipos reales.
          </p>
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
  const styles: Record<string, string> = {
    "Dosis actual": "border-blue-200 bg-blue-50/70 text-blue-950",
    "Dosis sugerida": "border-violet-200 bg-violet-50/70 text-violet-950",
    "Ahorro PAC estimado": "border-emerald-200 bg-emerald-50/70 text-emerald-950",
    "Turbidez proyectada": "border-sky-200 bg-sky-50/70 text-sky-950",
    "DQO proyectada": "border-amber-200 bg-amber-50/70 text-amber-950",
  };
  return (
    <div
      className={`rounded-xl border p-4 shadow-sm ${styles[label] ?? "border-slate-200 bg-slate-50 text-slate-950"}`}
    >
      <p className="text-xs font-semibold uppercase tracking-wide opacity-75">{label}</p>
      <p className="mt-2 text-xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

import { useState } from "react";
import { toast } from "sonner";
import { BellRing, CircleAlert, CircleCheck, Clock3 } from "lucide-react";
import { ScadaShell } from "./ScadaShell";
import { Button } from "@/components/ui/button";
import { useApiData } from "@/hooks/use-api-data";
import { api, selectedPlantCode, type OperationalAlert, type Page } from "@/lib/api-client";
import { useAppContext } from "@/lib/app-context-store";

type Filter = "all" | "sobrecosto" | "quimico" | "mantenimiento";
const timestamp = (value: string) => new Date(value).toLocaleString("es-MX");

function alertSeverityTone(severity: string) {
  if (severity === "CRITICA" || severity === "ALTA")
    return "bg-rose-50 text-rose-800 ring-rose-200";
  if (severity === "MODERADA") return "bg-amber-50 text-amber-800 ring-amber-200";
  return "bg-sky-50 text-sky-800 ring-sky-200";
}

function alertStatusPresentation(status: OperationalAlert["status"]) {
  if (status === "abierta")
    return { label: "Abierta", tone: "bg-rose-100 text-rose-800", icon: CircleAlert };
  if (status === "pausada")
    return { label: "Pausada", tone: "bg-amber-100 text-amber-800", icon: Clock3 };
  return { label: "Resuelta", tone: "bg-emerald-100 text-emerald-800", icon: CircleCheck };
}

export function AlertasScreen() {
  const plant = useAppContext((state) => state.plant);
  const shift = useAppContext((state) => state.shift);
  const plantCode = selectedPlantCode(plant);
  const [filter, setFilter] = useState<Filter>("all");
  const [refresh, setRefresh] = useState(0);
  const [busyId, setBusyId] = useState<number | null>(null);
  const params = new URLSearchParams({ plantCode, limit: "200" });
  const { data, loading, error } = useApiData<Page<OperationalAlert>>(
    `/api/alerts?${params}`,
    refresh,
    30_000,
  );
  const alerts = data?.data ?? [];
  const visible = alerts.filter(
    (alert) => filter === "all" || alert.category.toLowerCase() === filter,
  );
  const openCount = alerts.filter((alert) => alert.status === "abierta").length;

  async function changeStatus(alert: OperationalAlert, status: OperationalAlert["status"]) {
    setBusyId(alert.alertId);
    try {
      const pausedUntil =
        status === "pausada" ? new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString() : undefined;
      await api.updateAlert(alert.alertId, plantCode, status, shift, pausedUntil);
      setRefresh((value) => value + 1);
      toast.success(
        status === "pausada"
          ? "Alerta pausada por cuatro horas."
          : status === "resuelta"
            ? "Alerta resuelta."
            : "Alerta reabierta.",
      );
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "No se pudo actualizar la alerta.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <ScadaShell>
      <main className="min-h-screen space-y-6 px-8 pb-16 pt-24">
        <header className="relative overflow-hidden rounded-2xl border border-rose-200 bg-gradient-to-br from-rose-50 via-background to-amber-50 p-6 shadow-sm">
          <div className="pointer-events-none absolute -right-8 -top-12 h-48 w-48 rounded-full bg-rose-300/20 blur-3xl" />
          <div className="relative flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <span className="rounded-2xl bg-gradient-to-br from-rose-600 to-orange-600 p-3 text-white shadow-lg shadow-rose-900/20">
                <BellRing aria-hidden="true" className="h-7 w-7" />
              </span>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-rose-800">
                  Supervisión de eventos
                </p>
                <h1 className="text-2xl font-bold text-scada-ink-33">
                  Desviaciones operativas y alertas
                </h1>
                <p className="mt-1 text-sm text-scada-ink-35">
                  Alertas de {plant}. Puedes pausarlas, resolverlas o volver a abrirlas.
                </p>
              </div>
            </div>
            <span className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-white/80 px-4 py-3 text-sm font-bold text-rose-800 shadow-sm">
              <CircleAlert aria-hidden="true" className="h-4 w-4" />
              {openCount} abiertas
            </span>
          </div>
        </header>

        <div
          className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-slate-50/80 p-3"
          aria-label="Filtrar alertas"
        >
          {(["all", "sobrecosto", "quimico", "mantenimiento"] as const).map((value) => (
            <Button
              key={value}
              type="button"
              variant={filter === value ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter(value)}
            >
              {value === "all" ? "Todas" : value[0]!.toUpperCase() + value.slice(1)}
            </Button>
          ))}
        </div>

        {loading && <p role="status">Cargando alertas…</p>}
        {error && (
          <p
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
          >
            No se pudieron cargar las alertas. Intenta de nuevo más tarde.
          </p>
        )}
        {!loading && !error && visible.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-emerald-200 bg-emerald-50/60 px-4 py-8 text-center">
            <CircleCheck aria-hidden="true" className="h-8 w-8 text-emerald-500" />
            <p className="text-sm font-semibold text-emerald-900">
              No hay alertas para este filtro.
            </p>
          </div>
        )}

        <section className="grid gap-4 lg:grid-cols-2">
          {visible.map((alert) => (
            <article
              key={alert.alertId}
              className={`space-y-4 rounded-xl border border-slate-200 border-l-4 bg-background p-5 shadow-sm transition-shadow hover:shadow-md ${alert.status === "abierta" ? "border-l-rose-500" : alert.status === "pausada" ? "border-l-amber-500" : "border-l-emerald-500"}`}
            >
              <header className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {alert.category}
                  </p>
                  <h2 className="mt-1 text-lg font-bold text-slate-900">{alert.title}</h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span
                    className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset ${alertSeverityTone(alert.severity)}`}
                  >
                    {alert.severity}
                  </span>
                  {(() => {
                    const status = alertStatusPresentation(alert.status);
                    const StatusIcon = status.icon;
                    return (
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${status.tone}`}
                      >
                        <StatusIcon aria-hidden="true" className="h-3.5 w-3.5" />
                        {status.label}
                      </span>
                    );
                  })()}
                </div>
              </header>
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                {alert.description}
              </p>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3 text-xs text-muted-foreground">
                <span>Activada: {timestamp(alert.triggeredAt)}</span>
                {alert.status === "pausada" && alert.pausedUntil && (
                  <span>Reapertura automática: {timestamp(alert.pausedUntil)}</span>
                )}
                {alert.status === "resuelta" && alert.resolvedAt && (
                  <span>Resuelta: {timestamp(alert.resolvedAt)}</span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {alert.status !== "resuelta" && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busyId === alert.alertId}
                    onClick={() => changeStatus(alert, "resuelta")}
                  >
                    Resolver
                  </Button>
                )}
                {alert.status === "abierta" && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busyId === alert.alertId}
                    onClick={() => changeStatus(alert, "pausada")}
                  >
                    Pausar 4 h
                  </Button>
                )}
                {alert.status !== "abierta" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busyId === alert.alertId}
                    onClick={() => changeStatus(alert, "abierta")}
                  >
                    Reabrir
                  </Button>
                )}
              </div>
            </article>
          ))}
        </section>
      </main>
    </ScadaShell>
  );
}

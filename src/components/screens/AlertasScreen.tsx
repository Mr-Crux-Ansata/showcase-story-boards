import { useState } from "react";
import { toast } from "sonner";
import { ScadaShell } from "./ScadaShell";
import { Button } from "@/components/ui/button";
import { useApiData } from "@/hooks/use-api-data";
import { api, selectedPlantCode, type OperationalAlert, type Page } from "@/lib/api-client";
import { useAppContext } from "@/lib/app-context-store";

type Filter = "all" | "sobrecosto" | "quimico" | "mantenimiento";
const timestamp = (value: string) => new Date(value).toLocaleString("es-MX");

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
        <header className="flex flex-wrap items-end justify-between gap-3 border-b border-scada-ink-26 pb-4">
          <div>
            <h1 className="text-2xl font-bold text-scada-ink-33">
              Desviaciones operativas y alertas
            </h1>
            <p className="mt-1 text-sm text-scada-ink-35">
              Alertas almacenadas para {plant}. Las acciones cambian su estado en SQL Server.
            </p>
          </div>
          <div className="rounded-full bg-muted px-3 py-1 text-sm font-semibold">
            {openCount} abiertas
          </div>
        </header>

        <div className="flex flex-wrap gap-2" aria-label="Filtrar alertas">
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
            No se pudieron cargar alertas: {error}
          </p>
        )}
        {!loading && !error && visible.length === 0 && (
          <p className="rounded-lg border p-5 text-sm text-muted-foreground">
            No hay alertas para este filtro.
          </p>
        )}

        <section className="grid gap-4 lg:grid-cols-2">
          {visible.map((alert) => (
            <article
              key={alert.alertId}
              className="space-y-4 rounded-xl border bg-background p-5 shadow-sm"
            >
              <header className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold uppercase text-muted-foreground">
                    {alert.alertCode} · {alert.category}
                  </p>
                  <h2 className="mt-1 text-lg font-bold">{alert.title}</h2>
                </div>
                <span className="rounded-full border px-2.5 py-1 text-xs font-bold">
                  {alert.severity} · {alert.status}
                </span>
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

import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { ScadaShell } from "./ScadaShell";
import { Button } from "@/components/ui/button";
import { useApiData } from "@/hooks/use-api-data";
import { selectedPlantCode, type Page, type RecommendationRecord } from "@/lib/api-client";
import { useDemo } from "@/lib/demo-store";
import type { OptimizationResult, TelemetrySnapshot } from "@/lib/types/telemetry";

type OptimizationResponse = { result: OptimizationResult; persisted: boolean; recommendationId: number | null; warning?: string };
const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
const date = (value: string) => new Date(value).toLocaleString("es-MX");

export function CostosScreen() {
  const plant = useDemo((state) => state.plant);
  const plantCode = selectedPlantCode(plant);
  const [refresh, setRefresh] = useState(0);
  const [optimizing, setOptimizing] = useState(false);
  const [optimization, setOptimization] = useState<OptimizationResponse | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const params = new URLSearchParams({ plantCode, limit: "200" });
  const history = useApiData<Page<TelemetrySnapshot>>(`/api/telemetry/history?${params}`, refresh);
  const recommendations = useApiData<Page<RecommendationRecord>>(`/api/ai/recommendations?${new URLSearchParams({ plantCode, limit: "20" })}`, refresh);
  const latest = history.data?.data[0] ?? null;
  const compliance = history.data?.data.length
    ? 100 * history.data.data.filter((item) => item.nom001Compliant).length / history.data.data.length
    : null;
  const latestRecommendation = recommendations.data?.data.find((item) => item.status === "PENDIENTE") ?? recommendations.data?.data[0] ?? null;

  async function runOptimization() {
    setOptimizing(true);
    setActionError(null);
    try {
      const response = await fetch("/api/ai/optimize", {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ plantCode }),
      });
      const body = await response.json() as OptimizationResponse & { error?: string };
      if (!response.ok) throw new Error(body.error ?? `Optimización fallida (${response.status}).`);
      setOptimization(body);
      setRefresh((value) => value + 1);
      if (body.persisted) toast.success("Recomendación calculada y guardada.");
      else toast.warning("Recomendación calculada sin persistencia; no se puede aprobar.");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "No se pudo calcular la optimización.");
    } finally {
      setOptimizing(false);
    }
  }

  const result = optimization?.result;
  return <ScadaShell>
    <main className="min-h-screen space-y-6 px-8 pb-16 pt-24">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-scada-ink-26 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-scada-ink-33">Centro de Mando Operativo</h1>
          <p className="mt-1 text-sm text-scada-ink-35">Telemetría e historial persistido de {plant}.</p>
        </div>
        <span className="text-xs text-scada-ink-35">{latest ? `Última muestra: ${date(latest.recordedAt)}` : "Sin muestras guardadas"}</span>
      </header>

      {(history.error || recommendations.error) && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        {history.error ?? recommendations.error}. La pantalla no sustituye datos faltantes por valores de ejemplo.
      </div>}
      {history.loading && <p role="status">Cargando historial…</p>}
      {!history.loading && !history.error && !latest && <p className="rounded-lg border p-5 text-sm text-muted-foreground">No hay telemetría histórica disponible para esta planta.</p>}

      {latest && <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          ["Caudal de afluente", `${latest.inflowRateM3h.toFixed(2)} m³/h`],
          ["PAC registrado", `${latest.pacDosePpm.toFixed(2)} ppm`],
          ["Turbidez de efluente", `${latest.effluentTurbidityNtu.toFixed(2)} NTU`],
          ["DQO de efluente", `${latest.effluentDqoMgL.toFixed(2)} mg/L`],
        ].map(([label, value]) => <article key={label} className="rounded-xl border bg-background p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase text-muted-foreground">{label}</p>
          <p className="mt-3 text-2xl font-bold tabular-nums">{value}</p>
          <p className="mt-2 text-xs text-muted-foreground">{date(latest.recordedAt)}</p>
        </article>)}
      </section>}

      <section className="grid gap-5 lg:grid-cols-2">
        <article className="space-y-4 rounded-xl border bg-background p-6">
          <div>
            <h2 className="text-lg font-bold">Cumplimiento según muestras guardadas</h2>
            <p className="text-sm text-muted-foreground">Proporción de las últimas {history.data?.data.length ?? 0} muestras que cumplen los límites calculados al recibirlas.</p>
          </div>
          <p className="text-3xl font-bold">{compliance === null ? "—" : `${compliance.toFixed(1)}%`}</p>
          <p className="text-xs text-muted-foreground">{history.data?.total ?? 0} muestras en el historial consultado.</p>
        </article>

        <article className="space-y-4 rounded-xl border bg-background p-6">
          <div>
            <h2 className="text-lg font-bold">Optimización PAC</h2>
            <p className="text-sm text-muted-foreground">El motor usa la última telemetría disponible y persiste el resultado cuando SQL Server está conectado.</p>
          </div>
          <Button onClick={runOptimization} disabled={optimizing || !latest}>
            {optimizing ? "Calculando…" : "Calcular recomendación"}
          </Button>
          {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}
          {result && <div className="space-y-2 rounded-lg bg-muted/50 p-4 text-sm">
            <p>Dosis actual: <strong>{result.currentDosePpm.toFixed(2)} ppm</strong></p>
            <p>Dosis recomendada: <strong>{result.recommendedDosePpm.toFixed(2)} ppm</strong></p>
            <p>Ahorro PAC estimado: <strong>{money(result.prediction.monthlySavingUsd)} USD/mes</strong></p>
            <p>Calidad estimada: turbidez {result.prediction.turbidityNtu.toFixed(2)} NTU · DQO {result.prediction.dqoMgL.toFixed(1)} mg/L</p>
            <p>Predicción NOM-001: {result.prediction.nom001Compliant ? "cumple" : "no cumple"} · {result.modelVersion}</p>
            <p className="text-xs text-muted-foreground">{optimization?.persisted ? "Persistida en SQL Server." : "Solo resultado temporal; aprobación deshabilitada."}</p>
          </div>}
          {latestRecommendation && <div className="border-t pt-3 text-sm">
            <p>Recomendación guardada: <strong>{latestRecommendation.recommendedValue} ppm</strong> · {latestRecommendation.status}</p>
            <p className="text-xs text-muted-foreground">Creada {date(latestRecommendation.createdAt)} · ahorro previsto {money(latestRecommendation.monthlySavingUsd)} USD/mes</p>
          </div>}
          <Link to="/recomendaciones" className="text-sm font-semibold text-primary hover:underline">Revisar recomendaciones y decisiones</Link>
        </article>
      </section>

      <section className="rounded-xl border bg-background p-6">
        <h2 className="text-lg font-bold">Costos operativos</h2>
        <p className="mt-2 text-sm text-muted-foreground">El esquema actual no almacena costos observados de energía, lodos ni membranas. El único dato económico disponible es la proyección del modelo PAC mostrada arriba; no se presenta como costo medido.</p>
      </section>
    </main>
  </ScadaShell>;
}

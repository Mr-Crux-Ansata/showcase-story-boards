import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { ScadaShell } from "./ScadaShell";
import { Button } from "@/components/ui/button";
import { useApiData } from "@/hooks/use-api-data";
import { useLiveTelemetry } from "@/hooks/use-live-telemetry";
import { selectedPlantCode, type Page, type RecommendationRecord } from "@/lib/api-client";
import { useAppContext } from "@/lib/app-context-store";
import type { OptimizationResult, TelemetrySnapshot } from "@/lib/types/telemetry";

type OptimizationResponse = {
  result: OptimizationResult;
  persisted: boolean;
  recommendationId: number | null;
  warning?: string;
};
const money = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
const date = (value: string) => new Date(value).toLocaleString("es-MX");

export function CostosScreen() {
  const plant = useAppContext((state) => state.plant);
  const plantCode = selectedPlantCode(plant);
  const { isLive, data: liveTelemetry } = useLiveTelemetry();
  const [refresh, setRefresh] = useState(0);
  const [optimizing, setOptimizing] = useState(false);
  const [optimization, setOptimization] = useState<OptimizationResponse | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const params = new URLSearchParams({ plantCode, limit: "200" });
  const history = useApiData<Page<TelemetrySnapshot>>(`/api/telemetry/history?${params}`, refresh);
  const recommendations = useApiData<Page<RecommendationRecord>>(
    `/api/ai/recommendations?${new URLSearchParams({ plantCode, limit: "20" })}`,
    refresh,
  );
  const latest = history.data?.data[0] ?? null;
  const hasLiveTelemetryForPlant = isLive && liveTelemetry?.plantCode === plantCode;
  const compliance = history.data?.data.length
    ? (100 * history.data.data.filter((item) => item.nom001Compliant).length) /
      history.data.data.length
    : null;
  const samples = [...(history.data?.data ?? [])].reverse();
  const chartData = samples.map((sample) => ({
    ...sample,
    timeLabel: new Date(sample.recordedAt).toLocaleString("es-MX", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }),
  }));
  const compliantCount = samples.filter((sample) => sample.nom001Compliant).length;
  const nonCompliantCount = samples.length - compliantCount;
  const average = (values: number[]) =>
    values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const averagePac = average(samples.map((sample) => sample.pacDosePpm));
  const averageTurbidity = average(samples.map((sample) => sample.effluentTurbidityNtu));
  const averageDqo = average(samples.map((sample) => sample.effluentDqoMgL));
  const latestRecommendation =
    recommendations.data?.data.find((item) => item.status === "PENDIENTE") ??
    recommendations.data?.data[0] ??
    null;

  async function runOptimization() {
    setOptimizing(true);
    setActionError(null);
    try {
      const response = await fetch("/api/ai/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ plantCode }),
      });
      const body = (await response.json()) as OptimizationResponse & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "No se pudo calcular la recomendación.");
      setOptimization(body);
      setRefresh((value) => value + 1);
      if (body.persisted) toast.success("Recomendación calculada y guardada.");
      else toast.warning("Recomendación calculada temporalmente; no se puede aprobar.");
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "No se pudo calcular la optimización.",
      );
    } finally {
      setOptimizing(false);
    }
  }

  const result = optimization?.result;
  return (
    <ScadaShell>
      <main className="min-h-screen space-y-6 px-8 pb-16 pt-24">
        <header className="flex flex-wrap items-end justify-between gap-3 border-b border-scada-ink-26 pb-4">
          <div>
            <h1 className="text-2xl font-bold text-scada-ink-33">Centro de Mando Operativo</h1>
            <p className="mt-1 text-sm text-scada-ink-35">Lecturas e historial de {plant}.</p>
          </div>
          <span className="text-xs text-scada-ink-35">
            {latest ? `Última muestra: ${date(latest.recordedAt)}` : "Sin muestras guardadas"}
          </span>
        </header>

        {(history.error || recommendations.error) && (
          <div
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
          >
            No se pudieron cargar las lecturas o recomendaciones. Intenta de nuevo más tarde.
          </div>
        )}
        {history.loading && <p role="status">Cargando historial…</p>}
        {!history.loading && !history.error && !latest && (
          <p className="rounded-lg border p-5 text-sm text-muted-foreground">
            No hay telemetría histórica disponible para esta planta.
          </p>
        )}

        {latest && (
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[
              ["Caudal de afluente", `${latest.inflowRateM3h.toFixed(2)} m³/h`],
              ["PAC registrado", `${latest.pacDosePpm.toFixed(2)} ppm`],
              ["Turbidez de efluente", `${latest.effluentTurbidityNtu.toFixed(2)} NTU`],
              ["DQO de efluente", `${latest.effluentDqoMgL.toFixed(2)} mg/L`],
            ].map(([label, value]) => (
              <article key={label} className="rounded-xl border bg-background p-5 shadow-sm">
                <p className="text-xs font-semibold uppercase text-muted-foreground">{label}</p>
                <p className="mt-3 text-2xl font-bold tabular-nums">{value}</p>
                <p className="mt-2 text-xs text-muted-foreground">{date(latest.recordedAt)}</p>
              </article>
            ))}
          </section>
        )}

        <section
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
          aria-label="Resumen estadístico"
        >
          {[
            ["Muestras analizadas", `${samples.length} de ${history.data?.total ?? 0}`],
            ["Cumplimiento registrado", compliance === null ? "—" : `${compliance.toFixed(1)}%`],
            ["Dosis PAC promedio", averagePac === null ? "—" : `${averagePac.toFixed(2)} ppm`],
            [
              "Turbidez promedio",
              averageTurbidity === null ? "—" : `${averageTurbidity.toFixed(2)} NTU`,
            ],
          ].map(([label, value]) => (
            <article key={label} className="rounded-xl border bg-background p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase text-muted-foreground">{label}</p>
              <p className="mt-2 text-2xl font-bold tabular-nums">{value}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Según las muestras mostradas abajo
              </p>
            </article>
          ))}
        </section>

        {samples.length > 0 && (
          <section className="grid gap-5 xl:grid-cols-2" aria-label="Gráficas de operación">
            <article className="space-y-3 rounded-xl border bg-background p-5">
              <div>
                <h2 className="text-lg font-bold">Tendencia de dosificación PAC</h2>
                <p className="text-sm text-muted-foreground">
                  Dosis registrada por muestra, ordenada cronológicamente.
                </p>
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="timeLabel" minTickGap={28} />
                  <YAxis unit=" ppm" width={60} />
                  <Tooltip labelFormatter={(label) => `Muestra: ${label}`} />
                  <Line
                    type="monotone"
                    dataKey="pacDosePpm"
                    name="Dosis PAC"
                    stroke="#0f766e"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </article>

            <article className="space-y-3 rounded-xl border bg-background p-5">
              <div>
                <h2 className="text-lg font-bold">Calidad del efluente</h2>
                <p className="text-sm text-muted-foreground">
                  Tendencia de turbidez y DQO; cada indicador tiene su propia escala.
                </p>
              </div>
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="timeLabel" minTickGap={28} />
                  <YAxis yAxisId="turbidity" unit=" NTU" width={68} />
                  <YAxis yAxisId="dqo" orientation="right" unit=" mg/L" width={70} />
                  <Tooltip labelFormatter={(label) => `Muestra: ${label}`} />
                  <Legend />
                  <Line
                    yAxisId="turbidity"
                    type="monotone"
                    dataKey="effluentTurbidityNtu"
                    name="Turbidez"
                    stroke="#2563eb"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    yAxisId="dqo"
                    type="monotone"
                    dataKey="effluentDqoMgL"
                    name="DQO"
                    stroke="#c2410c"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
              <p className="text-xs text-muted-foreground">
                Promedios del periodo: turbidez {averageTurbidity?.toFixed(2) ?? "—"} NTU · DQO{" "}
                {averageDqo?.toFixed(1) ?? "—"} mg/L.
              </p>
            </article>

            <article className="space-y-3 rounded-xl border bg-background p-5 xl:col-span-2">
              <div>
                <h2 className="text-lg font-bold">Distribución de cumplimiento</h2>
                <p className="text-sm text-muted-foreground">
                  Clasificación de las muestras recibidas: {compliantCount} cumplen y{" "}
                  {nonCompliantCount} no cumplen.
                </p>
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={[
                      { name: "Cumple", value: compliantCount },
                      { name: "No cumple", value: nonCompliantCount },
                    ]}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={82}
                    paddingAngle={3}
                    label={({ name, value }) => `${name}: ${value}`}
                  >
                    <Cell fill="#0f766e" />
                    <Cell fill="#dc2626" />
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </article>
          </section>
        )}

        <section className="grid gap-5 lg:grid-cols-2">
          <article className="space-y-4 rounded-xl border bg-background p-6">
            <div>
              <h2 className="text-lg font-bold">Cumplimiento según muestras guardadas</h2>
              <p className="text-sm text-muted-foreground">
                Proporción de las últimas {history.data?.data.length ?? 0} muestras que cumplen los
                límites calculados al recibirlas.
              </p>
            </div>
            <p className="text-3xl font-bold">
              {compliance === null ? "—" : `${compliance.toFixed(1)}%`}
            </p>
            <p className="text-xs text-muted-foreground">
              {history.data?.total ?? 0} muestras en el historial consultado.
            </p>
          </article>

          <article className="space-y-4 rounded-xl border bg-background p-6">
            <div>
              <h2 className="text-lg font-bold">Optimización PAC</h2>
              <p className="text-sm text-muted-foreground">
                Proyección de dosis PAC, ahorro y calidad para las condiciones de proceso actuales.
              </p>
            </div>
            <Button
              onClick={runOptimization}
              disabled={optimizing || (!latest && !hasLiveTelemetryForPlant)}
            >
              {optimizing ? "Calculando…" : "Calcular recomendación"}
            </Button>
            {actionError && (
              <p role="alert" className="text-sm text-destructive">
                {actionError}
              </p>
            )}
            {result && (
              <div className="space-y-2 rounded-lg bg-muted/50 p-4 text-sm">
                <p>
                  Dosis actual: <strong>{result.currentDosePpm.toFixed(2)} ppm</strong>
                </p>
                <p>
                  Dosis recomendada: <strong>{result.recommendedDosePpm.toFixed(2)} ppm</strong>
                </p>
                <p>
                  Ahorro PAC estimado:{" "}
                  <strong>{money(result.prediction.monthlySavingUsd)} USD/mes</strong>
                </p>
                <p>
                  Calidad estimada: turbidez {result.prediction.turbidityNtu.toFixed(2)} NTU · DQO{" "}
                  {result.prediction.dqoMgL.toFixed(1)} mg/L
                </p>
                <p>
                  Predicción NOM-001: {result.prediction.nom001Compliant ? "cumple" : "no cumple"} ·{" "}
                  {result.modelVersion}
                </p>
                <p className="text-xs text-muted-foreground">
                  {optimization?.persisted
                    ? "Recomendación guardada."
                    : "Resultado temporal; no se puede aprobar."}
                </p>
              </div>
            )}
            {latestRecommendation && (
              <div className="border-t pt-3 text-sm">
                <p>
                  Recomendación guardada:{" "}
                  <strong>{latestRecommendation.recommendedValue} ppm</strong> ·{" "}
                  {latestRecommendation.status}
                </p>
                <p className="text-xs text-muted-foreground">
                  Creada {date(latestRecommendation.createdAt)} · ahorro previsto{" "}
                  {money(latestRecommendation.monthlySavingUsd)} USD/mes
                </p>
              </div>
            )}
            <Link
              to="/recomendaciones"
              className="text-sm font-semibold text-primary hover:underline"
            >
              Revisar recomendaciones y decisiones
            </Link>
          </article>
        </section>

        <section className="rounded-xl border bg-background p-6">
          <h2 className="text-lg font-bold">Costos operativos</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            No hay mediciones de costos de energía, lodos o membranas disponibles en esta vista. El
            ahorro de PAC mostrado arriba es una estimación.
          </p>
        </section>
      </main>
    </ScadaShell>
  );
}

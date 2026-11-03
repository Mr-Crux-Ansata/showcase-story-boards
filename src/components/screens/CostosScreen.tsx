import { useEffect, useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import {
  CartesianGrid,
  Bar,
  BarChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  Cell,
  ResponsiveContainer,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import {
  Activity,
  BadgeCheck,
  Beaker,
  CircleAlert,
  Droplets,
  Gauge,
  Lightbulb,
  Wallet,
} from "lucide-react";
import { ScadaShell } from "./ScadaShell";
import { Button } from "@/components/ui/button";
import { useApiData } from "@/hooks/use-api-data";
import { useLiveTelemetry } from "@/hooks/use-live-telemetry";
import {
  selectedPlantCode,
  type OperationalCostRecord,
  type Page,
  type RecommendationRecord,
} from "@/lib/api-client";
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

type MetricTone = "blue" | "violet" | "teal" | "rose" | "amber";

function DashboardMetric({
  label,
  value,
  detail,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Activity;
  tone: MetricTone;
}) {
  const styles: Record<MetricTone, { strip: string; icon: string; value: string }> = {
    blue: { strip: "bg-sky-500", icon: "bg-sky-500/10 text-sky-700", value: "text-sky-800" },
    violet: {
      strip: "bg-violet-500",
      icon: "bg-violet-500/10 text-violet-700",
      value: "text-violet-800",
    },
    teal: { strip: "bg-teal-500", icon: "bg-teal-500/10 text-teal-700", value: "text-teal-800" },
    rose: { strip: "bg-rose-500", icon: "bg-rose-500/10 text-rose-700", value: "text-rose-800" },
    amber: {
      strip: "bg-amber-500",
      icon: "bg-amber-500/10 text-amber-700",
      value: "text-amber-800",
    },
  };
  const color = styles[tone];

  return (
    <article className="overflow-hidden rounded-xl border bg-background shadow-sm">
      <div className={`h-1.5 ${color.strip}`} />
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <span className={`rounded-lg p-2 ${color.icon}`}>
            <Icon aria-hidden="true" className="h-4 w-4" />
          </span>
        </div>
        <p className={`mt-3 text-2xl font-bold tabular-nums ${color.value}`}>{value}</p>
        <p className="mt-2 text-xs text-muted-foreground">{detail}</p>
      </div>
    </article>
  );
}

export function CostosScreen() {
  const plant = useAppContext((state) => state.plant);
  const plantCode = selectedPlantCode(plant);
  const { isLive, data: liveTelemetry } = useLiveTelemetry();
  const [refresh, setRefresh] = useState(0);
  const [optimizing, setOptimizing] = useState(false);
  const [optimization, setOptimization] = useState<OptimizationResponse | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savingCosts, setSavingCosts] = useState(false);
  const [costsError, setCostsError] = useState<string | null>(null);
  const [costPeriod, setCostPeriod] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });
  const [energyCost, setEnergyCost] = useState("");
  const [sludgeCost, setSludgeCost] = useState("");
  const [membraneCost, setMembraneCost] = useState("");
  const [costSourceNote, setCostSourceNote] = useState("");
  const params = new URLSearchParams({ plantCode, limit: "200" });
  const history = useApiData<Page<TelemetrySnapshot>>(`/api/telemetry/history?${params}`, refresh);
  const recommendations = useApiData<Page<RecommendationRecord>>(
    `/api/ai/recommendations?${new URLSearchParams({ plantCode, limit: "20" })}`,
    refresh,
  );
  const operationalCosts = useApiData<Page<OperationalCostRecord>>(
    `/api/operational-costs?${new URLSearchParams({ plantCode, limit: "12" })}`,
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
  const costChartData = [...(operationalCosts.data?.data ?? [])].reverse().map((record) => {
    const [year, month] = record.periodStart.split("-").map(Number);
    return {
      ...record,
      monthLabel: new Date(year!, month! - 1, 1).toLocaleDateString("es-MX", {
        month: "short",
        year: "2-digit",
      }),
      totalCostUsd: record.energyCostUsd + record.sludgeCostUsd + record.membraneCostUsd,
    };
  });

  useEffect(() => {
    setEnergyCost("");
    setSludgeCost("");
    setMembraneCost("");
    setCostSourceNote("");
  }, [plantCode]);

  function chooseCostPeriod(period: string) {
    setCostPeriod(period);
    const record = operationalCosts.data?.data.find((item) => item.periodStart.startsWith(period));
    setEnergyCost(record ? String(record.energyCostUsd) : "");
    setSludgeCost(record ? String(record.sludgeCostUsd) : "");
    setMembraneCost(record ? String(record.membraneCostUsd) : "");
    setCostSourceNote(record?.sourceNote ?? "");
  }

  async function saveCosts(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingCosts(true);
    setCostsError(null);
    try {
      const response = await fetch("/api/operational-costs", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          plantCode,
          period: costPeriod,
          energyCostUsd: Number(energyCost),
          sludgeCostUsd: Number(sludgeCost),
          membraneCostUsd: Number(membraneCost),
          sourceNote: costSourceNote.trim() || null,
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "No se pudieron guardar los costos.");
      toast.success("Costos del periodo guardados.");
      setRefresh((value) => value + 1);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "No se pudieron guardar los costos.";
      setCostsError(message);
      toast.error(message);
    } finally {
      setSavingCosts(false);
    }
  }

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
        <header className="relative overflow-hidden rounded-2xl border border-cyan-200 bg-gradient-to-br from-cyan-50 via-background to-emerald-50 p-6 shadow-sm">
          <div className="pointer-events-none absolute -right-8 -top-12 h-48 w-48 rounded-full bg-cyan-300/20 blur-3xl" />
          <div className="relative flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <span className="rounded-2xl bg-gradient-to-br from-cyan-600 to-teal-700 p-3 text-white shadow-lg shadow-cyan-900/20">
                <Activity aria-hidden="true" className="h-7 w-7" />
              </span>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-800">
                  Centro de mando
                </p>
                <h1 className="text-2xl font-bold text-scada-ink-33">Centro de Mando Operativo</h1>
                <p className="mt-1 text-sm text-scada-ink-35">Lecturas e historial de {plant}.</p>
              </div>
            </div>
            <span className="inline-flex items-center gap-2 rounded-xl border border-cyan-200 bg-white/80 px-3 py-2 text-xs font-semibold text-cyan-900 shadow-sm">
              <span
                className={`h-2 w-2 rounded-full ${latest ? "bg-emerald-500" : "bg-slate-400"}`}
              />
              {latest ? `Última muestra: ${date(latest.recordedAt)}` : "Sin muestras guardadas"}
            </span>
          </div>
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
          <p className="rounded-xl border border-sky-200 bg-sky-50 p-5 text-sm text-sky-950">
            No hay telemetría histórica disponible para esta planta.
          </p>
        )}

        {latest && (
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <DashboardMetric
              label="Caudal de afluente"
              value={`${latest.inflowRateM3h.toFixed(2)} m³/h`}
              detail={date(latest.recordedAt)}
              icon={Activity}
              tone="blue"
            />
            <DashboardMetric
              label="PAC registrado"
              value={`${latest.pacDosePpm.toFixed(2)} ppm`}
              detail={date(latest.recordedAt)}
              icon={Beaker}
              tone="violet"
            />
            <DashboardMetric
              label="Turbidez de efluente"
              value={`${latest.effluentTurbidityNtu.toFixed(2)} NTU`}
              detail={
                latest.effluentTurbidityNtu > 4
                  ? `Sobre la referencia de 4 NTU · ${date(latest.recordedAt)}`
                  : `Dentro de la referencia de 4 NTU · ${date(latest.recordedAt)}`
              }
              icon={Droplets}
              tone={latest.effluentTurbidityNtu > 4 ? "rose" : "teal"}
            />
            <DashboardMetric
              label="DQO de efluente"
              value={`${latest.effluentDqoMgL.toFixed(2)} mg/L`}
              detail={
                latest.effluentDqoMgL > 60
                  ? `Sobre la referencia de 60 mg/L · ${date(latest.recordedAt)}`
                  : `Dentro de la referencia de 60 mg/L · ${date(latest.recordedAt)}`
              }
              icon={Gauge}
              tone={latest.effluentDqoMgL > 60 ? "rose" : "teal"}
            />
          </section>
        )}

        <section
          className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
          aria-label="Resumen estadístico"
        >
          <DashboardMetric
            label="Muestras fuera de referencia"
            value={`${nonCompliantCount} de ${samples.length}`}
            detail="Rebasan el límite de turbidez o DQO"
            icon={CircleAlert}
            tone={nonCompliantCount > 0 ? "rose" : "teal"}
          />
          <DashboardMetric
            label="Cumplimiento registrado"
            value={compliance === null ? "—" : `${compliance.toFixed(1)}%`}
            detail="Porcentaje de muestras conformes"
            icon={BadgeCheck}
            tone={compliance === null ? "amber" : compliance < 100 ? "rose" : "teal"}
          />
          <DashboardMetric
            label="Dosis PAC promedio"
            value={averagePac === null ? "—" : `${averagePac.toFixed(2)} ppm`}
            detail="Promedio de las muestras cargadas"
            icon={Beaker}
            tone="violet"
          />
          <DashboardMetric
            label="DQO promedio"
            value={averageDqo === null ? "—" : `${averageDqo.toFixed(1)} mg/L`}
            detail="Promedio de las muestras cargadas"
            icon={Gauge}
            tone={averageDqo !== null && averageDqo > 60 ? "rose" : "teal"}
          />
        </section>

        {samples.length > 0 && (
          <section className="grid gap-5 xl:grid-cols-2" aria-label="Gráficas de operación">
            <article className="space-y-3 rounded-xl border border-teal-200 bg-gradient-to-br from-background via-background to-teal-50/60 p-5 shadow-sm">
              <div>
                <h2 className="text-lg font-bold text-teal-950">Tendencia de dosificación PAC</h2>
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

            <article className="space-y-3 rounded-xl border border-sky-200 bg-gradient-to-br from-background via-background to-sky-50/60 p-5 shadow-sm">
              <div>
                <h2 className="text-lg font-bold text-sky-950">Calidad del efluente</h2>
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
                  <ReferenceLine
                    yAxisId="turbidity"
                    y={4}
                    stroke="#2563eb"
                    strokeDasharray="5 5"
                    label={{ value: "Referencia turbidez", position: "insideTopLeft" }}
                  />
                  <ReferenceLine
                    yAxisId="dqo"
                    y={60}
                    stroke="#c2410c"
                    strokeDasharray="5 5"
                    label={{ value: "Referencia DQO", position: "insideTopRight" }}
                  />
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

            <article className="space-y-3 rounded-xl border border-violet-200 bg-gradient-to-br from-background via-background to-violet-50/60 p-5 shadow-sm xl:col-span-2">
              <div>
                <h2 className="text-lg font-bold text-violet-950">Distribución de cumplimiento</h2>
                <p className="text-sm text-muted-foreground">
                  Clasificación de las muestras recibidas: {compliantCount} cumplen y{" "}
                  {nonCompliantCount} no cumplen.
                </p>
                <p className="text-xs text-muted-foreground">
                  Los límites mostrados son referencias usadas por la aplicación. En el perfil de
                  demostración, el simulador genera excursiones periódicas para visualizar cómo
                  cambia el indicador; son datos sintéticos.
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
          <article className="space-y-4 rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50/70 via-background to-background p-6 shadow-sm">
            <div>
              <h2 className="text-lg font-bold text-emerald-950">
                Cumplimiento según muestras guardadas
              </h2>
              <p className="text-sm text-muted-foreground">
                Proporción de las últimas {history.data?.data.length ?? 0} muestras que cumplen los
                límites calculados al recibirlas.
              </p>
            </div>
            <p className="text-3xl font-bold text-emerald-800">
              {compliance === null ? "—" : `${compliance.toFixed(1)}%`}
            </p>
            <p className="text-xs text-muted-foreground">
              {history.data?.total ?? 0} muestras en el historial consultado.
            </p>
          </article>

          <article className="space-y-4 rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50/70 via-background to-background p-6 shadow-sm">
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded-lg bg-violet-100 p-2 text-violet-700">
                  <Lightbulb aria-hidden="true" className="h-4 w-4" />
                </span>
                <h2 className="text-lg font-bold text-violet-950">Optimización PAC</h2>
              </div>
              <p className="text-sm text-muted-foreground">
                Proyección de dosis PAC, ahorro y calidad para las condiciones de proceso actuales.
              </p>
            </div>
            <Button
              onClick={runOptimization}
              disabled={optimizing || (!latest && !hasLiveTelemetryForPlant)}
              className="bg-violet-700 text-white hover:bg-violet-800"
            >
              {optimizing ? "Calculando…" : "Calcular recomendación"}
            </Button>
            {actionError && (
              <p role="alert" className="text-sm text-destructive">
                {actionError}
              </p>
            )}
            {result && (
              <div className="space-y-2 rounded-xl border border-violet-200 bg-violet-50/70 p-4 text-sm text-violet-950">
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

        <section className="space-y-5 rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50/70 via-background to-background p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <span className="rounded-xl bg-amber-100 p-2.5 text-amber-800">
              <Wallet aria-hidden="true" className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-lg font-bold text-amber-950">Costos operativos reales</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Registra los importes mensuales de facturas o reportes. Se mantienen separados del
                ahorro PAC, que es una proyección del modelo.
              </p>
            </div>
          </div>

          <form
            onSubmit={saveCosts}
            className="space-y-4 rounded-xl border border-amber-200 bg-white/80 p-4 shadow-sm"
          >
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <label className="space-y-1 text-sm font-medium">
                Periodo
                <input
                  type="month"
                  required
                  value={costPeriod}
                  onChange={(event) => chooseCostPeriod(event.target.value)}
                  className="w-full rounded-md border border-amber-200 bg-background px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                />
              </label>
              <label className="space-y-1 text-sm font-medium">
                Energía (USD)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={energyCost}
                  onChange={(event) => setEnergyCost(event.target.value)}
                  className="w-full rounded-md border border-amber-200 bg-background px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                  placeholder="Importe mensual"
                />
              </label>
              <label className="space-y-1 text-sm font-medium">
                Manejo de lodos (USD)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={sludgeCost}
                  onChange={(event) => setSludgeCost(event.target.value)}
                  className="w-full rounded-md border border-amber-200 bg-background px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                  placeholder="Importe mensual"
                />
              </label>
              <label className="space-y-1 text-sm font-medium">
                Membranas (USD)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={membraneCost}
                  onChange={(event) => setMembraneCost(event.target.value)}
                  className="w-full rounded-md border border-amber-200 bg-background px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                  placeholder="Importe mensual"
                />
              </label>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="min-w-64 flex-1 space-y-1 text-sm font-medium">
                Referencia o notas (opcional)
                <input
                  type="text"
                  maxLength={500}
                  value={costSourceNote}
                  onChange={(event) => setCostSourceNote(event.target.value)}
                  className="w-full rounded-md border border-amber-200 bg-background px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                  placeholder="Ej. folio de factura o reporte mensual"
                />
              </label>
              <Button
                type="submit"
                disabled={savingCosts}
                className="bg-amber-700 text-white hover:bg-amber-800"
              >
                {savingCosts ? "Guardando…" : "Guardar costos del periodo"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Al guardar de nuevo el mismo periodo, se actualizan sus importes. La captura queda
              identificada con el operador activo.
            </p>
          </form>

          {costsError && (
            <p role="alert" className="text-sm text-destructive">
              {costsError}
            </p>
          )}
          {operationalCosts.error && (
            <p role="alert" className="text-sm text-destructive">
              No se pudo cargar el historial de costos. Intenta de nuevo más tarde.
            </p>
          )}
          {operationalCosts.loading && <p role="status">Cargando costos registrados…</p>}
          {!operationalCosts.loading && costChartData.length === 0 && (
            <p className="rounded-lg bg-muted/50 p-4 text-sm text-muted-foreground">
              Aún no hay costos registrados para esta planta.
            </p>
          )}

          {costChartData.length > 0 && (
            <div className="grid gap-5 xl:grid-cols-[1.3fr_0.7fr]">
              <article className="space-y-3 rounded-xl border border-blue-200 bg-blue-50/40 p-4 shadow-sm">
                <div>
                  <h3 className="font-semibold">Costos mensuales registrados</h3>
                  <p className="text-xs text-muted-foreground">
                    Importes capturados por periodo; hasta los últimos 12 meses.
                  </p>
                </div>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={costChartData} margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="monthLabel" />
                    <YAxis tickFormatter={(value: number) => money(value)} width={90} />
                    <Tooltip formatter={(value) => money(Number(value ?? 0))} />
                    <Legend />
                    <Bar dataKey="energyCostUsd" name="Energía" stackId="costs" fill="#2563eb" />
                    <Bar dataKey="sludgeCostUsd" name="Lodos" stackId="costs" fill="#0f766e" />
                    <Bar
                      dataKey="membraneCostUsd"
                      name="Membranas"
                      stackId="costs"
                      fill="#c2410c"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </article>

              <article className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/40 p-4 shadow-sm">
                <h3 className="font-semibold text-indigo-950">Detalle por periodo</h3>
                <ul className="max-h-80 space-y-3 overflow-y-auto">
                  {[...(operationalCosts.data?.data ?? [])].map((record) => {
                    const total =
                      record.energyCostUsd + record.sludgeCostUsd + record.membraneCostUsd;
                    return (
                      <li
                        key={record.operationalCostId}
                        className="rounded-md bg-muted/40 p-3 text-sm"
                      >
                        <div className="flex justify-between gap-2">
                          <strong>{record.periodStart.slice(0, 7)}</strong>
                          <strong>{money(total)}</strong>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Energía {money(record.energyCostUsd)} · Lodos{" "}
                          {money(record.sludgeCostUsd)} · Membranas {money(record.membraneCostUsd)}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Actualizado por {record.recordedBy} · {date(record.updatedAt)}
                        </p>
                        {record.sourceNote && (
                          <p className="mt-1 text-xs text-muted-foreground">{record.sourceNote}</p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </article>
            </div>
          )}
        </section>
      </main>
    </ScadaShell>
  );
}

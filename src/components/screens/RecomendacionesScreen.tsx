import { useState, useEffect } from "react";
import { simulatePac, formatDemoMoney } from "@/lib/pac-simulation";
import { Button } from "@/components/ui/button";
import { ScadaShell } from "./ScadaShell";
import { toast } from "sonner";
import { demo, useDemo } from "@/lib/demo-store";
import { validateDose, SAFE_DOSE_MIN, SAFE_DOSE_MAX } from "@/lib/demo-logic";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useLiveTelemetry } from "@/hooks/use-live-telemetry";
import type { OptimizationResult } from "@/lib/types/telemetry";

export function RecomendacionesScreen() {
  const { isLive, data } = useLiveTelemetry();
  const [ppm, setPpm] = useState(19);
  const [stress, setStress] = useState(false);
  const [completed, setCompleted] = useState<Record<string, string>>({});
  const [detail, setDetail] = useState<string | null>(null);

  // Estado del Motor de IA
  const [aiResult, setAiResult] = useState<OptimizationResult | null>(null);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [recommendationId, setRecommendationId] = useState<number | null>(null);
  const [lastOptimizedAt, setLastOptimizedAt] = useState<string | null>(null);

  const projection = simulatePac(ppm, stress);
  const approvedDose = useDemo((st) => st.approvedDose);
  const applied = approvedDose === ppm;
  const check = validateDose(ppm, projection.qualityWithinLimits);
  const [confirming, setConfirming] = useState(false);

  // Ejecución de la Inferencia y Optimización IA
  async function runAiOptimization() {
    setIsOptimizing(true);
    try {
      const res = await fetch("/api/ai/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inflowRateM3h: data?.inflowRateM3h,
          inflowTurbidityNtu: data?.inflowTurbidityNtu,
          inflowDqoMgL: data?.inflowDqoMgL,
          inflowPh: data?.inflowPh,
          currentDosePpm: data?.pacDosePpm ?? 28,
        }),
      });

      if (res.ok) {
        const json = (await res.json()) as { result: OptimizationResult; recommendationId: number | null };
        setAiResult(json.result);
        setRecommendationId(json.recommendationId);
        setPpm(json.result.recommendedDosePpm);
        setLastOptimizedAt(new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
        toast.success("Optimización IA Calculada", {
          description: `Consigna óptima: ${json.result.recommendedDosePpm} ppm (Confianza: ${json.result.confidencePct}%)`,
        });
      } else {
        toast.error("Error al consultar motor IA");
      }
    } catch (err) {
      console.error("Error optimizando con IA:", err);
    } finally {
      setIsOptimizing(false);
    }
  }

  // Ejecutar optimización automática inicial al montar o al recibir enlace Edge
  useEffect(() => {
    runAiOptimization();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive]);

  async function confirmApply() {
    setConfirming(false);
    const undo = demo.approveDose(
      ppm,
      `Costo PAC estimado ${formatDemoMoney(projection.projectedCost, 3)}/m³ · ahorro estimado ${formatDemoMoney(projection.monthlySaving)}/mes.`,
    );

    // Persistir aprobación en la Base de Datos SQL Server (dbo.AiRecommendations & dbo.OperationsLog)
    try {
      await fetch("/api/ai/recommendations/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recommendationId,
          dosePpm: ppm,
          operatorName: "Ing. M. Romero",
          notes: `Consigna de PAC ${ppm} ppm aprobada mediante Human-in-the-Loop. ${aiResult ? aiResult.reasoning : ""}`,
        }),
      });
    } catch {
      // Manejo transparente si está offline
    }

    toast.success(`Consigna de ${ppm} ppm aprobada`, {
      description: "Registrada en la Bitácora y enviada al SCADA.",
      action: {
        label: "Deshacer",
        onClick: () => {
          undo();
          toast("Consigna deshecha");
        },
      },
      duration: 8000,
    });
  }

  function handleAction(id: string) {
    if (id === "btn-stress-test") {
      setStress(!stress);
      setPpm(stress ? 19 : 23);
      return;
    }
    if (id === "btn-apply-pac") {
      if (check.ok) setConfirming(true);
      return;
    }
    setCompleted((current) => ({ ...current, [id]: "Registrado" }));
    demo.log("consigna", id === "action-2" ? "Ajuste de sopladores simulado" : "Ajuste de ósmosis simulado", "Registrado desde Recomendaciones IA.");
    toast.success("Acción registrada en la Bitácora");
  }

  return (
    <ScadaShell>
      <div data-stress={stress ? "active" : "inactive"}>
        <main className="w-full pt-28 pb-20 px-10 max-w-7xl mx-auto space-y-8">
          {/* Cabecera Principal */}
          <div className="rounded-lg bg-gradient-to-br from-scada-ink-10 via-scada-ink-30/70 to-scada-ink-85/40 border border-scada-ink-26/80 p-8 shadow-sm relative overflow-hidden">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
              <div className="space-y-3 max-w-2xl">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-label-mono font-bold bg-primary/10 text-primary">
                    <span className="w-2 h-2 rounded-full bg-primary animate-pulse"></span>
                    Motor Inferencial IA Activo
                  </span>
                  <span className="text-xs font-label-mono text-scada-ink-35">
                    Modelo: <strong className="text-scada-ink-86">{aiResult?.modelVersion ?? "v2.4-PINN-Surrogate"}</strong>
                  </span>
                  {lastOptimizedAt && (
                    <span className="text-xs font-label-mono text-scada-ink-35">
                      Último cálculo: <strong className="text-scada-ink-86">{lastOptimizedAt}</strong>
                    </span>
                  )}
                </div>
                <div>
                  <h1 className="text-2xl lg:text-3xl font-bold text-scada-ink-33 tracking-normal font-headline-lg">
                    Recomendaciones de Optimización IA
                  </h1>
                  <p className="text-sm text-scada-ink-34 mt-1 leading-relaxed">
                    Prescripciones operativas basadas en aprendizaje automático y balances de masa para coagulación y desinfección.
                  </p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 bg-gradient-to-br from-scada-ink-17/10 via-scada-ink-17/5 to-transparent border border-scada-ink-37/80 rounded-lg p-5 shadow-xs shrink-0">
                <div className="w-12 h-12 rounded-lg bg-scada-ink-43 text-scada-ink-10 flex items-center justify-center shrink-0 shadow-md shadow-scada-ink-43/20">
                  <span className="material-symbols-outlined text-[26px]">savings</span>
                </div>
                <div>
                  <span className="block text-xs font-label-mono uppercase tracking-normal text-scada-ink-39 font-bold">
                    Ahorro Proyectado Total
                  </span>
                  <div className="text-3xl font-extrabold text-scada-ink-51 font-data-metric-lg tracking-normal mt-0.5">
                    {formatDemoMoney(aiResult ? aiResult.prediction.monthlySavingUsd + 3120 + 1400 : projection.totalMonthlySaving)}{" "}
                    <span className="text-base font-semibold text-scada-ink-43 font-sans">USD/mes</span>
                  </div>
                  <span className="text-xs text-scada-ink-35 font-body-sm mt-0.5 block">
                    Confianza del Gemelo Digital: <strong className="text-emerald-700">{aiResult?.confidencePct ?? 95.4}%</strong>
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Tarjeta de Optimización PAC */}
          <div className="rounded-lg bg-scada-ink-10 border border-scada-ink-26 shadow-sm p-8 space-y-8">
            <div className="flex flex-col md:flex-row md:items-center justify-between pb-6 border-b border-scada-ink-31 gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2.5">
                  <span className="px-2.5 py-1 rounded-md text-xs font-label-mono font-bold bg-scada-ink-44/15 text-scada-ink-82 border border-scada-ink-44/30 uppercase tracking-normal">
                    Prioridad Alta
                  </span>
                  <span className="text-xs font-label-mono text-scada-ink-35">Reactor Floculador #01 · Dosificación PAC</span>
                </div>
                <h2 className="text-xl font-bold text-scada-ink-33 font-headline-md tracking-normal">
                  Optimización Dinámica de Coagulación (PAC) según Carga Orgánica
                </h2>
                <p className="text-sm text-scada-ink-34 font-body-md">
                  Ajuste cinético de dosificación en función de la turbidez y DQO de afluente medidos por telemetría.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={runAiOptimization}
                  disabled={isOptimizing}
                  className="px-3.5 py-2 rounded-lg border border-primary/30 text-primary hover:bg-primary/5 font-semibold text-xs flex items-center gap-2"
                >
                  <span className={`material-symbols-outlined text-[18px] ${isOptimizing ? "animate-spin" : ""}`}>
                    {isOptimizing ? "refresh" : "psychology"}
                  </span>
                  {isOptimizing ? "Calculando..." : "Recalcular con IA"}
                </Button>
                <div className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-scada-ink-30 border border-scada-ink-26 shrink-0">
                  <span className="material-symbols-outlined text-scada-ink-43 text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                    verified
                  </span>
                  <div className="text-left">
                    <div className="text-[11px] font-label-mono text-scada-ink-35 uppercase leading-none">Norma Oficial</div>
                    <div className="text-xs font-bold text-scada-ink-32 mt-0.5">NOM-001 SEMARNAT</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Explicación / Razonamiento del Modelo de IA */}
            {aiResult && (
              <div className="p-4 rounded-xl bg-sky-50/70 border border-sky-200 text-sky-950 flex items-start gap-3 text-sm leading-relaxed">
                <span className="material-symbols-outlined text-primary text-[22px] shrink-0 mt-0.5">insights</span>
                <div className="space-y-1">
                  <div className="font-bold flex items-center gap-2">
                    Diagnóstico Predictivo de Inferencia
                    <span className="px-2 py-0.2 rounded bg-primary text-white text-[10px] font-label-mono">
                      Confianza {aiResult.confidencePct}%
                    </span>
                  </div>
                  <p className="text-sky-900 text-xs sm:text-sm">{aiResult.reasoning}</p>
                </div>
              </div>
            )}

            {/* Métricas Principales: Dosis Campo vs Simulada vs Ahorro */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
              <div className="rounded-lg p-6 bg-scada-ink-30 border border-scada-ink-26 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between text-xs font-label-mono text-scada-ink-35 uppercase font-semibold">
                    <span>{isLive ? "Dosis Medida en Campo (Edge)" : "Dosis de referencia"}</span>
                    <span className={`material-symbols-outlined text-[18px] ${isLive ? "text-emerald-500 animate-pulse" : ""}`}>
                      {isLive ? "sensors" : "lock"}
                    </span>
                  </div>
                  <div className="mt-4 flex items-baseline gap-2">
                    <span className="text-4xl font-extrabold text-scada-ink-86 font-data-metric-lg">
                      {isLive ? (data?.pacDosePpm?.toFixed(1) ?? "28") : "28"}
                    </span>
                    <span className="text-lg font-bold text-scada-ink-35">ppm</span>
                    {isLive && (
                      <span className="ml-2 text-[10px] font-label-mono font-bold text-emerald-800 bg-emerald-100 px-1.5 py-0.5 rounded">
                        VIVO
                      </span>
                    )}
                  </div>
                </div>
                <div className="mt-4 pt-3 border-t border-scada-ink-26 text-xs text-scada-ink-35">
                  {isLive ? (
                    `Afluente: ${data?.inflowTurbidityNtu.toFixed(2)} NTU · DQO: ${data?.inflowDqoMgL.toFixed(1)} mg/L · Caudal: ${data?.inflowRateM3h.toFixed(1)} m³/h`
                  ) : (
                    <>
                      Costo PAC de referencia: <strong className="text-scada-ink-86 font-label-mono">$0.58 / m³</strong>
                    </>
                  )}
                </div>
              </div>

              <div className="rounded-lg p-6 bg-scada-ink-70/70 border-2 border-scada-ink-87 flex flex-col justify-between relative shadow-sm">
                <div className="absolute -top-3 right-5 px-2.5 py-0.5 rounded-full bg-primary text-scada-ink-10 text-[10px] font-label-mono font-bold tracking-normal uppercase">
                  Recomendada por IA
                </div>
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-label-mono text-primary uppercase font-bold">
                    <span className="material-symbols-outlined text-[18px]">auto_mode</span>
                    <span>Consigna Optimizada</span>
                  </div>
                  <div className="mt-4 flex items-baseline gap-2">
                    <span className="text-4xl font-extrabold text-primary font-data-metric-lg" id="target-ppm-display">
                      {ppm}
                    </span>
                    <span className="text-lg font-bold text-scada-ink-88">ppm</span>
                    <span className="ml-2 text-xs font-label-mono font-bold text-scada-ink-51 bg-scada-ink-54 px-2 py-0.5 rounded-md">
                      {projection.doseReduction >= 0 ? "−" : "+"}
                      {Math.abs(projection.doseReduction).toFixed(1)}% dosis
                    </span>
                  </div>
                </div>
                <div className="mt-4 pt-3 border-t border-scada-ink-71/80 text-xs text-scada-ink-34">
                  Costo proyectado:{" "}
                  <strong className="text-primary font-label-mono font-bold">{formatDemoMoney(projection.projectedCost, 3)} / m³</strong>
                </div>
              </div>

              <div className="rounded-lg p-6 bg-scada-ink-36/70 border border-scada-ink-37 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between text-xs font-label-mono text-scada-ink-39 uppercase font-bold">
                    <span>Ahorro Estimado Reactor</span>
                    <span className="material-symbols-outlined text-[20px] text-scada-ink-51">trending_down</span>
                  </div>
                  <div className="mt-4 flex items-baseline gap-1">
                    <span className="text-4xl font-extrabold text-scada-ink-51 font-data-metric-lg">
                      {formatDemoMoney(aiResult?.prediction.monthlySavingUsd ?? projection.monthlySaving)}
                    </span>
                    <span className="text-xs font-semibold text-scada-ink-39 font-sans">USD/mes</span>
                  </div>
                </div>
                <div className="mt-4 pt-3 border-t border-scada-ink-37/80 text-xs text-scada-ink-34">
                  Ahorro unitario:{" "}
                  <strong className="text-scada-ink-51 font-label-mono font-bold">
                    {formatDemoMoney(aiResult?.prediction.unitSavingUsd ?? projection.unitSaving, 3)} / m³
                  </strong>{" "}
                  tratado
                </div>
              </div>
            </div>

            {/* Ajuste Fino / Scrubber */}
            <div className="rounded-lg p-6 bg-scada-ink-30/80 border border-scada-ink-26/90 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary text-[20px]">tune</span>
                  <label className="text-sm font-bold text-scada-ink-33" htmlFor="dosing-scrubber">
                    Ajuste fino manual del punto de consigna (Human-in-the-Loop)
                  </label>
                </div>
                <div className="text-xs font-label-mono text-scada-ink-34">
                  Consigna seleccionada:{" "}
                  <span className="font-bold text-primary text-sm px-2 py-0.5 rounded bg-scada-ink-89 border border-scada-ink-71" id="scrubber-value">
                    {ppm} ppm
                  </span>
                </div>
              </div>

              <input
                className="w-full h-2.5 bg-scada-ink-26 rounded-lg appearance-none cursor-pointer accent-primary focus:outline-none"
                id="dosing-scrubber"
                max="32"
                min="15"
                type="range"
                value={ppm}
                onChange={(event) => {
                  setPpm(Number(event.target.value));
                }}
                aria-label="Consigna PAC"
              />

              <div className="flex items-center justify-between text-xs font-label-mono text-scada-ink-35 pt-1">
                <span className="text-scada-ink-40 font-medium">15 ppm (Límite bajo)</span>
                <span className="text-scada-ink-51 font-bold bg-scada-ink-54/70 px-2.5 py-0.5 rounded-full border border-scada-ink-37 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-scada-ink-17"></span>
                  Rango óptimo IA: 18–21 ppm
                </span>
                <span className="text-scada-ink-35">32 ppm (Histórico sobredosificado)</span>
              </div>
            </div>

            {/* Curva de Sensibilidad del Modelo IA */}
            {aiResult?.doseSensitivityCurve && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-label-mono uppercase tracking-normal text-scada-ink-35 font-bold flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px] text-primary">stacked_line_chart</span>
                    Curva de Sensibilidad de Dosis (Gemelo Digital)
                  </h3>
                  <span className="text-xs text-scada-ink-35">Haz clic en un punto para seleccionar dosis</span>
                </div>
                <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white p-2">
                  <div className="flex items-stretch gap-2 min-w-[650px]">
                    {aiResult.doseSensitivityCurve.map((point) => {
                      const isSelected = point.dosePpm === ppm;
                      return (
                        <button
                          key={point.dosePpm}
                          type="button"
                          onClick={() => setPpm(point.dosePpm)}
                          className={`flex-1 p-2.5 rounded-lg border text-left transition-all ${
                            isSelected
                              ? "bg-primary text-white border-primary shadow-sm"
                              : point.isOptimal
                              ? "bg-emerald-50 text-emerald-950 border-emerald-300"
                              : "bg-slate-50 hover:bg-slate-100 text-slate-800 border-slate-200"
                          }`}
                        >
                          <div className="flex items-center justify-between text-xs font-bold font-label-mono">
                            <span>{point.dosePpm} ppm</span>
                            {point.isOptimal && (
                              <span className={`text-[9px] px-1 py-0.2 rounded font-bold ${isSelected ? "bg-white text-primary" : "bg-emerald-600 text-white"}`}>
                                OPT
                              </span>
                            )}
                          </div>
                          <div className={`text-[11px] font-label-mono mt-1 ${isSelected ? "text-white/90" : "text-slate-500"}`}>
                            {point.turbidityNtu} NTU
                          </div>
                          <div className={`text-[10px] font-semibold mt-0.5 ${isSelected ? "text-emerald-200" : "text-emerald-700"}`}>
                            +${Math.round(point.monthlySavingUsd / 1000)}k/m
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Calidad Estimada del Efluente */}
            <div className="space-y-3">
              <h3 className="text-xs font-label-mono uppercase tracking-normal text-scada-ink-35 font-bold">
                Calidad Estimada del Efluente · Validación NOM-001
              </h3>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                <div className="p-4 rounded-lg border border-scada-ink-26 bg-scada-ink-10 flex items-center justify-between">
                  <div className="space-y-1">
                    <span className="text-xs text-scada-ink-35 font-label-mono">Turbidez Proyectada</span>
                    <div className="flex items-baseline gap-2">
                      <span className="text-xl font-bold text-scada-ink-32 font-data-metric-md" id="val-turbidity">
                        {projection.turbidity.toFixed(2)} NTU
                      </span>
                      <span className="text-xs text-scada-ink-51 font-semibold font-label-mono">(Límite: &lt; 4.0 NTU)</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-scada-ink-36 border border-scada-ink-37 text-scada-ink-39 text-xs font-semibold">
                    <span className="material-symbols-outlined text-[16px]">check_circle</span>
                    <span>{projection.turbidity < 4 ? "Cumple Norma Oficial" : "Supera Límite Legal"}</span>
                  </div>
                </div>

                <div className="p-4 rounded-lg border border-scada-ink-26 bg-scada-ink-10 flex items-center justify-between">
                  <div className="space-y-1">
                    <span className="text-xs text-scada-ink-35 font-label-mono">DQO Efluente Proyectada</span>
                    <div className="flex items-baseline gap-2">
                      <span className="text-xl font-bold text-scada-ink-32 font-data-metric-md" id="val-dqo">
                        {projection.dqo.toFixed(1)} mg/L
                      </span>
                      <span className="text-xs text-scada-ink-51 font-semibold font-label-mono">(Límite: &lt; 60 mg/L)</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-scada-ink-36 border border-scada-ink-37 text-scada-ink-39 text-xs font-semibold">
                    <span className="material-symbols-outlined text-[16px]">check_circle</span>
                    <span>{projection.dqo < 60 ? `Margen de seguridad ${projection.dqoMargin.toFixed(1)}%` : "Supera Límite Legal"}</span>
                  </div>
                </div>
              </div>
            </div>

            <p role={check.ok ? undefined : "alert"} className={`text-sm font-semibold ${check.ok ? "text-scada-ink-34" : "text-destructive"}`}>
              {check.ok
                ? `Rango seguro de aprobación técnica: ${SAFE_DOSE_MIN}–${SAFE_DOSE_MAX} ppm. Se pedirá confirmación del operador.`
                : `No se puede registrar: ${check.reason}`}
            </p>

            {/* Acciones de Operación */}
            <div className="pt-4 border-t border-scada-ink-31 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-xs font-label-mono text-scada-ink-35">
                <span className="material-symbols-outlined text-scada-ink-43 text-[18px]">verified_user</span>
                <span>Audit Trail NOM-001 Activo · Registro firmado en Base de Datos</span>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleAction("btn-stress-test")}
                  className="px-5 py-2.5 rounded-lg border border-scada-ink-3 hover:bg-scada-ink-31 text-scada-ink-86 text-sm font-semibold transition-colors flex items-center gap-2 shadow-xs active:scale-95"
                  id="btn-stress-test"
                  data-action="btn-stress-test"
                  disabled={Boolean(completed["btn-stress-test"]) && !"btn-stress-test".startsWith("filter-")}
                >
                  {stress ? (
                    "Escenario Estrés Activo (+30% DQO)"
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-[18px] text-scada-ink-34">science</span>
                      Simular Sobrecarga (+30% DQO)
                    </>
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleAction("btn-apply-pac")}
                  className="px-6 py-2.5 rounded-lg bg-primary hover:bg-scada-ink-90 text-scada-ink-10 text-sm font-bold transition-all flex items-center gap-2 shadow-md shadow-primary/20 hover:shadow-lg active:scale-95"
                  id="btn-apply-pac"
                  data-action="btn-apply-pac"
                  disabled={applied || !check.ok}
                >
                  {applied ? (
                    `Consigna Aplicada: ${ppm} ppm`
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                        send
                      </span>
                      Aprobar Consigna IA ({ppm} ppm)
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>

          {/* Otras Recomendaciones */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-scada-ink-33 font-headline-sm">Otras Recomendaciones de Eficiencia Energética</h3>
              <span className="text-xs font-label-mono text-scada-ink-35">2 escenarios complementarios</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="p-6 rounded-lg bg-scada-ink-10 border border-scada-ink-26 shadow-sm flex flex-col justify-between space-y-5 hover:border-scada-ink-3 transition-all">
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-label-mono uppercase font-semibold text-scada-ink-35">Biorreactor MBR · Tren 2</span>
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-label-mono font-bold bg-scada-ink-54 text-scada-ink-39">
                      +$3,120 USD/m
                    </span>
                  </div>
                  <h4 className="text-base font-bold text-scada-ink-33 font-headline-sm">Modulación de Frecuencia Soplador BLW-02</h4>
                  <p className="text-xs text-scada-ink-34 font-body-sm leading-relaxed">
                    Ajuste de velocidad a 42 Hz durante la ventana de baja carga nocturna manteniendo el oxígeno disuelto en 2.0 mg/L constante.
                  </p>
                  <div className="p-3 rounded-lg bg-scada-ink-30 border border-scada-ink-31 flex items-center justify-between text-xs font-label-mono">
                    <span className="text-scada-ink-35">
                      Consumo Específico: <strong className="text-scada-ink-32">1.84 → 1.72 kWh/m³</strong>
                    </span>
                    <span className="text-scada-ink-51 font-bold">-6.5% Energía</span>
                  </div>
                </div>
                <div className="pt-2 flex items-center justify-between">
                  <span className="text-xs font-label-mono text-scada-ink-35">
                    VFD: 48 Hz → <strong>42 Hz</strong>
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleAction("action-2")}
                    className="px-4 py-2 rounded-lg bg-scada-ink-31 hover:bg-primary hover:text-scada-ink-10 text-primary text-xs font-bold transition-all flex items-center gap-1.5 shadow-xs"
                    data-action="action-2"
                    disabled={Boolean(completed["action-2"]) && !"action-2".startsWith("filter-")}
                  >
                    {completed["action-2"] || (
                      <>
                        <span>Aprobar consigna 42 Hz</span>
                        <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>

              <div className="p-6 rounded-lg bg-scada-ink-10 border border-scada-ink-26 shadow-sm flex flex-col justify-between space-y-5 hover:border-scada-ink-3 transition-all">
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-label-mono uppercase font-semibold text-scada-ink-35">Ósmosis Inversa RO-03</span>
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-label-mono font-bold bg-scada-ink-54 text-scada-ink-39">
                      +$1,400 USD/m
                    </span>
                  </div>
                  <h4 className="text-base font-bold text-scada-ink-33 font-headline-sm">Ajuste de Anti-incrustante Químico</h4>
                  <p className="text-xs text-scada-ink-34 font-body-sm leading-relaxed">
                    Índice LSI indica sobredosificación innecesaria. Reducción a 2.4 ppm protege la membrana y prolonga su vida útil 3 meses más.
                  </p>
                  <div className="p-3 rounded-lg bg-scada-ink-30 border border-scada-ink-31 flex items-center justify-between text-xs font-label-mono">
                    <span className="text-scada-ink-35">
                      Presión Transmembrana: <strong className="text-scada-ink-32">2.1 bar (Estable)</strong>
                    </span>
                    <span className="text-scada-ink-51 font-bold">+3 meses vida útil</span>
                  </div>
                </div>
                <div className="pt-2 flex items-center justify-between">
                  <span className="text-xs font-label-mono text-scada-ink-35">
                    Dosis: 3.6 → <strong>2.4 ppm</strong>
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleAction("action-3")}
                    className="px-4 py-2 rounded-lg bg-scada-ink-31 hover:bg-primary hover:text-scada-ink-10 text-primary text-xs font-bold transition-all flex items-center gap-1.5 shadow-xs"
                    data-action="action-3"
                    disabled={Boolean(completed["action-3"]) && !"action-3".startsWith("filter-")}
                  >
                    {completed["action-3"] || (
                      <>
                        <span>Aprobar ajuste ósmosis</span>
                        <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>

      <Dialog
        open={detail !== null}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resultado de Operación</DialogTitle>
            <DialogDescription>{detail}</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Aprobar y transmitir consigna de {ppm} ppm al SCADA?</AlertDialogTitle>
            <AlertDialogDescription>
              Turbidez estimada: {projection.turbidity.toFixed(2)} NTU (Límite NOM-001: 4.0 NTU) · DQO estimada: {projection.dqo.toFixed(0)} mg/L (Límite: 60 mg/L) · Ahorro estimado: {formatDemoMoney(aiResult?.prediction.monthlySavingUsd ?? projection.monthlySaving)}/mes.
              <br />
              <br />
              Esta consigna quedará registrada con firma digital del operador en la base de datos industrial para auditoría ambiental.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmApply}>Confirmar y Transmitir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ScadaShell>
  );
}

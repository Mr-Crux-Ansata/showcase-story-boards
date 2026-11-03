import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import {
  Activity,
  BadgeCheck,
  ClipboardList,
  Download,
  FileClock,
  FlaskConical,
  ListFilter,
} from "lucide-react";
import { ScadaShell } from "./ScadaShell";
import { Button } from "@/components/ui/button";
import { useApiData } from "@/hooks/use-api-data";
import {
  api,
  selectedPlantCode,
  type HandoverRecord,
  type OperationsLogRecord,
  type Page,
} from "@/lib/api-client";
import { useAppContext } from "@/lib/app-context-store";
import { toCsv } from "@/lib/csv";
import { downloadText } from "@/lib/download";

type HandoverForm = {
  date: string;
  volume: string;
  flow: string;
  turbidity: string;
  dqo: string;
  sst: string;
  compliance: string;
};
const today = () => new Date().toISOString().slice(0, 10);
const initialForm = (): HandoverForm => ({
  date: today(),
  volume: "",
  flow: "",
  turbidity: "",
  dqo: "",
  sst: "",
  compliance: "",
});
const dateTime = (value: string) => new Date(value).toLocaleString("es-MX");

function applicationStatusLabel(status: string) {
  const labels: Record<string, string> = {
    ACK_OK: "Registrado",
    APPROVED_NOT_APPLIED: "Aprobado para la simulación",
    NOT_APPLIED: "No aplicado",
    NOT_APPLICABLE: "No aplica",
    SIMULATED_APPROVAL_REVOKED: "Aprobación retirada en la simulación",
  };
  return labels[status] ?? "Registrado";
}

function eventKindPresentation(kind: string) {
  const presentation: Record<string, { label: string; className: string }> = {
    consigna: { label: "Consigna", className: "bg-violet-100 text-violet-800 ring-violet-200" },
    alerta: { label: "Alerta", className: "bg-rose-100 text-rose-800 ring-rose-200" },
    datos: { label: "Datos", className: "bg-sky-100 text-sky-800 ring-sky-200" },
    turno: { label: "Turno", className: "bg-teal-100 text-teal-800 ring-teal-200" },
    sistema: { label: "Sistema", className: "bg-slate-100 text-slate-700 ring-slate-200" },
  };
  return (
    presentation[kind] ?? {
      label: "Evento",
      className: "bg-muted text-muted-foreground ring-border",
    }
  );
}

function applicationStatusTone(status: string) {
  if (status === "ACK_OK") return "bg-emerald-50 text-emerald-800 ring-emerald-200";
  if (status === "APPROVED_NOT_APPLIED") return "bg-violet-50 text-violet-800 ring-violet-200";
  if (status === "SIMULATED_APPROVAL_REVOKED" || status === "NOT_APPLIED")
    return "bg-amber-50 text-amber-800 ring-amber-200";
  return "bg-slate-50 text-slate-700 ring-slate-200";
}

function handoverStatusLabel(status: string) {
  return status === "FIRMADO" ? "Firmado" : "Pendiente";
}

export function BitacoraScreen() {
  const plant = useAppContext((state) => state.plant);
  const shift = useAppContext((state) => state.shift);
  const plantCode = selectedPlantCode(plant);
  const [refresh, setRefresh] = useState(0);
  const [form, setForm] = useState(initialForm);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [filter, setFilter] = useState("all");
  const [formError, setFormError] = useState<string | null>(null);
  const pageParams = new URLSearchParams({ plantCode, limit: "200" });
  const logs = useApiData<Page<OperationsLogRecord>>(`/api/operations-log?${pageParams}`, refresh);
  const handovers = useApiData<Page<HandoverRecord>>(`/api/shift-handovers?${pageParams}`, refresh);
  const entries =
    logs.data?.data.filter((item) => filter === "all" || item.eventKind === filter) ?? [];

  async function signHandover(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const result = await api.createHandover({
        plantCode,
        shiftCode: shift,
        handoverDate: form.date,
        volumeTreatedM3: Number(form.volume),
        averageFlowRateM3h: Number(form.flow),
        averageTurbidityNtu: Number(form.turbidity),
        averageDqoMgL: Number(form.dqo),
        averageSstMgL: Number(form.sst),
        nom001CompliancePct: Number(form.compliance),
      });
      toast.success(`Entrega guardada. Estado: ${result.handover.status}.`);
      setForm(initialForm());
      setRefresh((value) => value + 1);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "No se pudo guardar el cierre.";
      setFormError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  async function exportLog() {
    setExporting(true);
    try {
      const total = logs.data?.total ?? 0;
      const records: OperationsLogRecord[] = [];
      for (let offset = 0; offset < total; offset += 200) {
        const page = await api.operationsLog(plantCode, 200, offset);
        records.push(...page.data);
      }
      const columns = [
        "fecha",
        "turno",
        "tipo",
        "evento",
        "detalle",
        "operador",
        "rol",
        "estado_aplicacion",
      ];
      const rows = records.map((item) => [
        item.loggedAt,
        item.shiftCode,
        item.eventKind,
        item.title,
        item.detail,
        item.operatorName,
        item.operatorRole,
        applicationStatusLabel(item.plcAckStatus),
      ]);
      downloadText(`bitacora_${plantCode}_${today()}.csv`, toCsv(columns, rows));
      toast.success(`Exportados ${records.length} registros.`);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "No se pudo exportar la bitácora.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <ScadaShell>
      <main className="min-h-screen space-y-6 px-8 pb-16 pt-24">
        <header className="relative overflow-hidden rounded-2xl border border-cyan-200 bg-gradient-to-br from-cyan-50 via-background to-violet-50 p-6 shadow-sm">
          <div className="pointer-events-none absolute -right-8 -top-12 h-48 w-48 rounded-full bg-cyan-300/20 blur-3xl" />
          <div className="relative flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <span className="rounded-2xl bg-gradient-to-br from-cyan-600 to-blue-700 p-3 text-white shadow-lg shadow-cyan-900/20">
                <ClipboardList aria-hidden="true" className="h-7 w-7" />
              </span>
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-800">
                  Registro de operación
                </p>
                <h1 className="mt-1 text-2xl font-bold text-scada-ink-33">
                  Bitácora de operaciones
                </h1>
                <p className="mt-1 text-sm text-scada-ink-35">
                  Eventos y cierres registrados para {plant}.
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              className="border-cyan-300 bg-white/80 text-cyan-900 hover:bg-cyan-100"
              onClick={() => void exportLog()}
              disabled={!logs.data || exporting}
            >
              <Download aria-hidden="true" className="mr-2 h-4 w-4" />
              {exporting ? "Exportando…" : "Exportar bitácora CSV"}
            </Button>
          </div>
        </header>

        <section className="grid gap-3 sm:grid-cols-2" aria-label="Resumen de bitácora">
          <article className="flex items-center gap-3 rounded-xl border border-blue-200 bg-gradient-to-r from-blue-50 to-background p-4">
            <span className="rounded-lg bg-blue-100 p-2 text-blue-700">
              <Activity aria-hidden="true" className="h-5 w-5" />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-800">
                Eventos registrados
              </p>
              <p className="text-2xl font-bold tabular-nums text-blue-950">
                {logs.data?.total ?? "—"}
              </p>
            </div>
          </article>
          <article className="flex items-center gap-3 rounded-xl border border-teal-200 bg-gradient-to-r from-teal-50 to-background p-4">
            <span className="rounded-lg bg-teal-100 p-2 text-teal-700">
              <FileClock aria-hidden="true" className="h-5 w-5" />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-teal-800">
                Cierres de turno
              </p>
              <p className="text-2xl font-bold tabular-nums text-teal-950">
                {handovers.data?.total ?? "—"}
              </p>
            </div>
          </article>
        </section>

        {logs.error && (
          <p
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
          >
            No se pudo cargar la bitácora. Intenta de nuevo más tarde.
          </p>
        )}
        {logs.loading && <p role="status">Cargando eventos…</p>}
        <section className="space-y-4 rounded-xl border border-blue-200 bg-gradient-to-br from-background via-background to-blue-50/70 p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="rounded-lg bg-blue-100 p-2 text-blue-700">
                <Activity aria-hidden="true" className="h-4 w-4" />
              </span>
              <h2 className="text-lg font-bold">Eventos ({logs.data?.total ?? "—"})</h2>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <ListFilter aria-hidden="true" className="h-4 w-4 text-blue-700" />
              <span className="font-medium">Tipo</span>
              <select
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                className="rounded-md border border-blue-200 bg-background px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <option value="all">Todos</option>
                <option value="consigna">Consignas</option>
                <option value="alerta">Alertas</option>
                <option value="datos">Datos</option>
                <option value="turno">Turnos</option>
                <option value="sistema">Sistema</option>
              </select>
            </label>
          </div>
          {entries.length === 0 && !logs.loading && (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-blue-200 bg-blue-50/60 px-4 py-8 text-center">
              <ClipboardList aria-hidden="true" className="h-8 w-8 text-blue-400" />
              <p className="text-sm font-medium text-blue-900">No hay eventos para mostrar.</p>
              <p className="text-xs text-muted-foreground">
                Los eventos de la planta aparecerán aquí.
              </p>
            </div>
          )}
          <ol className="space-y-3">
            {entries.map((entry) => (
              <li
                key={entry.logId}
                className="grid gap-3 rounded-xl border border-slate-200 border-l-4 border-l-blue-500 bg-white/80 p-4 shadow-sm transition-shadow hover:shadow-md md:grid-cols-[190px_1fr_auto]"
              >
                <div className="space-y-2">
                  <time className="block text-xs font-medium text-slate-600">
                    {dateTime(entry.loggedAt)}
                  </time>
                  <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-700">
                    Turno {entry.shiftCode}
                  </span>
                </div>
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-slate-900">{entry.title}</h3>
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ring-1 ring-inset ${eventKindPresentation(entry.eventKind).className}`}
                    >
                      {eventKindPresentation(entry.eventKind).label}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-600">
                    {entry.detail}
                  </p>
                  <p className="text-xs text-slate-500">
                    {entry.operatorName} · {entry.operatorRole}
                  </p>
                </div>
                <span
                  className={`inline-flex h-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${applicationStatusTone(entry.plcAckStatus)}`}
                >
                  <BadgeCheck aria-hidden="true" className="h-3.5 w-3.5" />
                  {applicationStatusLabel(entry.plcAckStatus)}
                </span>
              </li>
            ))}
          </ol>
        </section>

        <section className="grid gap-5 xl:grid-cols-2">
          <form
            onSubmit={signHandover}
            className="space-y-4 rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50/80 via-background to-background p-5 shadow-sm"
          >
            <div className="flex items-start gap-3">
              <span className="rounded-xl bg-violet-100 p-2.5 text-violet-700">
                <FlaskConical aria-hidden="true" className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-lg font-bold text-violet-950">Registrar entrega de turno</h2>
                <p className="text-sm text-muted-foreground">
                  Ingresa los valores medidos al cierre del turno.
                </p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                Fecha
                <input
                  required
                  type="date"
                  value={form.date}
                  onChange={(event) => setForm({ ...form, date: event.target.value })}
                  className="mt-1 w-full rounded-md border border-violet-200 bg-background px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                />
              </label>
              <label className="text-sm">
                Volumen tratado (m³)
                <input
                  required
                  min="0"
                  step="0.01"
                  type="number"
                  value={form.volume}
                  onChange={(event) => setForm({ ...form, volume: event.target.value })}
                  className="mt-1 w-full rounded-md border border-violet-200 bg-background px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                />
              </label>
              <label className="text-sm">
                Caudal promedio (m³/h)
                <input
                  required
                  min="0"
                  step="0.01"
                  type="number"
                  value={form.flow}
                  onChange={(event) => setForm({ ...form, flow: event.target.value })}
                  className="mt-1 w-full rounded-md border border-violet-200 bg-background px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                />
              </label>
              <label className="text-sm">
                Turbidez promedio (NTU)
                <input
                  required
                  min="0"
                  step="0.01"
                  type="number"
                  value={form.turbidity}
                  onChange={(event) => setForm({ ...form, turbidity: event.target.value })}
                  className="mt-1 w-full rounded-md border border-violet-200 bg-background px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                />
              </label>
              <label className="text-sm">
                DQO promedio (mg/L)
                <input
                  required
                  min="0"
                  step="0.01"
                  type="number"
                  value={form.dqo}
                  onChange={(event) => setForm({ ...form, dqo: event.target.value })}
                  className="mt-1 w-full rounded-md border border-violet-200 bg-background px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                />
              </label>
              <label className="text-sm">
                SST promedio (mg/L)
                <input
                  required
                  min="0"
                  step="0.01"
                  type="number"
                  value={form.sst}
                  onChange={(event) => setForm({ ...form, sst: event.target.value })}
                  className="mt-1 w-full rounded-md border border-violet-200 bg-background px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                />
              </label>
              <label className="text-sm sm:col-span-2">
                Cumplimiento NOM-001 (%)
                <input
                  required
                  min="0"
                  max="100"
                  step="0.01"
                  type="number"
                  value={form.compliance}
                  onChange={(event) => setForm({ ...form, compliance: event.target.value })}
                  className="mt-1 w-full rounded-md border border-violet-200 bg-background px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                />
              </label>
            </div>
            {formError && (
              <p role="alert" className="text-sm text-destructive">
                {formError}
              </p>
            )}
            <p className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-900">
              El registro incluye el operador y una marca de integridad. Esta no sustituye una firma
              legal ni verifica la identidad.
            </p>
            <Button
              type="submit"
              disabled={saving}
              className="bg-violet-700 text-white hover:bg-violet-800"
            >
              {saving ? "Guardando…" : "Guardar cierre de turno"}
            </Button>
          </form>

          <div className="space-y-3 rounded-xl border border-teal-200 bg-gradient-to-br from-teal-50/70 via-background to-background p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="rounded-lg bg-teal-100 p-2 text-teal-700">
                <FileClock aria-hidden="true" className="h-4 w-4" />
              </span>
              <h2 className="text-lg font-bold text-teal-950">Entregas registradas</h2>
            </div>
            {handovers.error && (
              <p role="alert" className="text-sm text-destructive">
                No se pudieron cargar los cierres de turno. Intenta de nuevo más tarde.
              </p>
            )}
            {handovers.loading && <p role="status">Cargando cierres…</p>}
            {!handovers.loading && (handovers.data?.data.length ?? 0) === 0 && (
              <p className="rounded-xl border border-dashed border-teal-200 bg-teal-50/60 px-4 py-8 text-center text-sm text-teal-900">
                No hay cierres registrados.
              </p>
            )}
            {handovers.data?.data.map((handover) => (
              <article
                key={handover.handoverId}
                className="rounded-xl border border-teal-200 bg-white/80 p-4 text-sm shadow-sm"
              >
                <div className="flex justify-between gap-2">
                  <strong>
                    {handover.handoverDate} · Turno {handover.shiftCode}
                  </strong>
                  <span
                    className={`inline-flex h-fit rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${handover.signedBy === "Demostración AquaSense" ? "bg-amber-50 text-amber-800 ring-amber-200" : "bg-emerald-50 text-emerald-800 ring-emerald-200"}`}
                  >
                    {handover.signedBy === "Demostración AquaSense"
                      ? "Ejemplo"
                      : handoverStatusLabel(handover.status)}
                  </span>
                </div>
                <p className="mt-1 text-muted-foreground">
                  {handover.volumeTreatedM3} m³ · caudal {handover.averageFlowRateM3h} m³/h ·
                  cumplimiento {handover.nom001CompliancePct}%
                </p>
                <p className="text-xs text-muted-foreground">
                  Registro {dateTime(handover.signedAt)} · {handover.signedBy}
                </p>
              </article>
            ))}
          </div>
        </section>
      </main>
    </ScadaShell>
  );
}

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
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
        "estado_plc",
      ];
      const rows = records.map((item) => [
        item.loggedAt,
        item.shiftCode,
        item.eventKind,
        item.title,
        item.detail,
        item.operatorName,
        item.operatorRole,
        item.plcAckStatus,
      ]);
      downloadText(`bitacora_${plantCode}_${today()}.csv`, toCsv(columns, rows));
      toast.success(`Exportados ${records.length} registros persistidos.`);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "No se pudo exportar la bitácora.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <ScadaShell>
      <main className="min-h-screen space-y-6 px-8 pb-16 pt-24">
        <header className="flex flex-wrap items-end justify-between gap-3 border-b border-scada-ink-26 pb-4">
          <div>
            <h1 className="text-2xl font-bold text-scada-ink-33">Bitácora de operaciones</h1>
            <p className="mt-1 text-sm text-scada-ink-35">
              Eventos persistidos y cierres registrados para {plant}.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => void exportLog()}
            disabled={!logs.data || exporting}
          >
            {exporting ? "Exportando…" : "Exportar bitácora CSV"}
          </Button>
        </header>

        {logs.error && (
          <p
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
          >
            No se pudo leer la bitácora: {logs.error}
          </p>
        )}
        {logs.loading && <p role="status">Cargando eventos…</p>}
        <section className="space-y-4 rounded-xl border bg-background p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold">Eventos ({logs.data?.total ?? "—"})</h2>
            <label className="flex items-center gap-2 text-sm">
              Tipo
              <select
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                className="rounded-md border bg-background px-2 py-1"
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
            <p className="text-sm text-muted-foreground">No hay eventos para mostrar.</p>
          )}
          <ol className="divide-y">
            {entries.map((entry) => (
              <li key={entry.logId} className="grid gap-2 py-3 md:grid-cols-[180px_1fr_auto]">
                <time className="text-xs text-muted-foreground">
                  {dateTime(entry.loggedAt)} · Turno {entry.shiftCode}
                </time>
                <div>
                  <h3 className="font-semibold">{entry.title}</h3>
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                    {entry.detail}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {entry.operatorName} · {entry.operatorRole}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground">{entry.plcAckStatus}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="grid gap-5 xl:grid-cols-2">
          <form onSubmit={signHandover} className="space-y-4 rounded-xl border bg-background p-5">
            <div>
              <h2 className="text-lg font-bold">Registrar entrega de turno</h2>
              <p className="text-sm text-muted-foreground">
                Ingresa los valores medidos del cierre. La aplicación no los calcula a partir de
                muestras con intervalos desconocidos.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                Fecha
                <input
                  required
                  type="date"
                  value={form.date}
                  onChange={(event) => setForm({ ...form, date: event.target.value })}
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2"
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
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2"
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
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2"
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
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2"
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
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2"
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
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2"
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
                  className="mt-1 w-full rounded-md border bg-background px-3 py-2"
                />
              </label>
            </div>
            {formError && (
              <p role="alert" className="text-sm text-destructive">
                {formError}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              El nombre se toma de OPERATOR_NAME configurado en el servidor. El hash identifica la
              integridad del contenido; no es una firma legal ni autenticación personal.
            </p>
            <Button type="submit" disabled={saving}>
              {saving ? "Guardando…" : "Guardar cierre de turno"}
            </Button>
          </form>

          <div className="space-y-3 rounded-xl border bg-background p-5">
            <h2 className="text-lg font-bold">Entregas persistidas</h2>
            {handovers.error && (
              <p role="alert" className="text-sm text-destructive">
                No se pudieron cargar: {handovers.error}
              </p>
            )}
            {handovers.loading && <p role="status">Cargando cierres…</p>}
            {!handovers.loading && (handovers.data?.data.length ?? 0) === 0 && (
              <p className="text-sm text-muted-foreground">No hay cierres registrados.</p>
            )}
            {handovers.data?.data.map((handover) => (
              <article key={handover.handoverId} className="rounded-lg border p-4 text-sm">
                <div className="flex justify-between gap-2">
                  <strong>
                    {handover.handoverDate} · Turno {handover.shiftCode}
                  </strong>
                  <span>{handover.status}</span>
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

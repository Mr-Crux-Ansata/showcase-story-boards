import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { toast } from "sonner";
import { CircleCheck, CircleX, Download, FileSpreadsheet, Trash2, Upload } from "lucide-react";
import { CSV_COLUMNS, CSV_TEMPLATE, parseCsv, type CsvResult } from "@/lib/csv";
import { downloadText } from "@/lib/download";
import { Button } from "@/components/ui/button";

type ImportSummary = {
  persisted: boolean;
  accepted: number;
  rejected: number;
  errors?: Array<{ row: number; message: string }>;
  error?: string;
};
type LoadedFile = { file: File; text: string; result: CsvResult };
const MAX_BYTES = 5 * 1024 * 1024;

export function CsvReview() {
  const input = useRef<HTMLInputElement>(null);
  const [loaded, setLoaded] = useState<LoadedFile | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  async function selectFile(file?: File) {
    if (!file) return;
    setSummary(null);
    if (!/\.csv$/i.test(file.name)) {
      toast.error("Selecciona un archivo .csv.");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error("El archivo supera el límite de 5 MB.");
      return;
    }
    const text = await file.text();
    const result = parseCsv(text);
    setLoaded({ file, text, result });
    if (result.errors.length)
      toast.warning(
        `${result.errors.length} problemas encontrados; corrige las filas antes de enviar.`,
      );
  }

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    void selectFile(event.currentTarget.files?.[0]);
    event.currentTarget.value = "";
  }
  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void selectFile(event.dataTransfer.files[0]);
  }

  async function ingest() {
    if (!loaded || loaded.result.errors.length) return;
    setBusy(true);
    setSummary(null);
    try {
      const response = await fetch("/api/telemetry/import-csv", {
        method: "POST",
        headers: { "Content-Type": "text/csv; charset=utf-8", Accept: "application/json" },
        body: loaded.text,
      });
      const result = (await response.json()) as ImportSummary;
      setSummary(result);
      if (!response.ok || !result.persisted)
        throw new Error(result.error ?? "No se pudo completar la importación.");
      toast.success(`${result.accepted} filas importadas; ${result.rejected} rechazadas.`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "No se pudo enviar el CSV.";
      setSummary(
        (current) =>
          current ?? {
            persisted: false,
            accepted: 0,
            rejected: loaded.result.rows.length,
            error: message,
          },
      );
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-5 rounded-xl border border-sky-200 bg-gradient-to-br from-background via-background to-sky-50/60 p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="rounded-xl bg-sky-100 p-2.5 text-sky-700">
          <FileSpreadsheet aria-hidden="true" className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-lg font-bold text-sky-950">Importar lecturas CSV</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Cada fila debe incluir una muestra completa del proceso. Las lecturas aisladas de
            sensores no se pueden importar como una muestra completa.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          className="border-sky-300 text-sky-800 hover:bg-sky-50"
          onClick={() => downloadText("plantilla_aquasense_snapshots.csv", CSV_TEMPLATE)}
        >
          <Download aria-hidden="true" className="mr-2 h-4 w-4" />
          Descargar plantilla vacía
        </Button>
        <Button
          type="button"
          variant="outline"
          className="border-indigo-300 text-indigo-800 hover:bg-indigo-50"
          onClick={() => input.current?.click()}
        >
          <Upload aria-hidden="true" className="mr-2 h-4 w-4" />
          Seleccionar CSV
        </Button>
        <input
          ref={input}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={onChange}
        />
      </div>
      <div
        onClick={() => input.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center text-sm transition-colors ${dragging ? "border-sky-500 bg-sky-100 text-sky-900" : "border-sky-200 bg-sky-50/50 text-sky-900 hover:border-sky-400 hover:bg-sky-50"}`}
        role="button"
        tabIndex={0}
        aria-label="Seleccionar o arrastrar archivo CSV"
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            input.current?.click();
          }
        }}
      >
        {loaded ? (
          <>
            <FileSpreadsheet aria-hidden="true" className="mx-auto mb-2 h-8 w-8 text-sky-600" />
            <strong className="text-sky-950">{loaded.file.name}</strong>
            <span className="ml-2 text-slate-600">
              {loaded.result.validRows} filas válidas · {loaded.result.errors.length} errores
            </span>
          </>
        ) : (
          <>
            <Upload aria-hidden="true" className="mx-auto mb-2 h-8 w-8 text-sky-500" />
            Arrastra aquí un CSV o selecciona un archivo. Máximo 5 MB.
          </>
        )}
      </div>

      {!loaded && (
        <p className="text-xs text-muted-foreground">
          Columnas requeridas: {CSV_COLUMNS.join(", ")}. Las opcionales pueden quedar vacías.
        </p>
      )}
      {loaded && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950">
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-800">
                Filas leídas
              </p>
              <strong className="mt-1 block text-2xl tabular-nums">
                {loaded.result.rows.length}
              </strong>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
                Válidas
              </p>
              <strong className="mt-1 block text-2xl tabular-nums">
                {loaded.result.validRows}
              </strong>
            </div>
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-950">
              <p className="text-xs font-semibold uppercase tracking-wide text-rose-800">
                Rechazadas
              </p>
              <strong className="mt-1 block text-2xl tabular-nums">
                {loaded.result.errors.length}
              </strong>
            </div>
          </div>
          {loaded.result.headers.length > 0 && (
            <div className="overflow-auto rounded-xl border border-slate-200 shadow-sm">
              <table className="w-full text-left text-xs">
                <thead className="bg-gradient-to-r from-sky-100 to-indigo-100 text-slate-800">
                  <tr>
                    {loaded.result.headers.map((header) => (
                      <th className="px-2 py-2" key={header}>
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loaded.result.rows.slice(0, 5).map((row, index) => (
                    <tr
                      className="border-t border-slate-100 odd:bg-white even:bg-slate-50/70"
                      key={loaded.result.rowNumbers[index]}
                    >
                      {loaded.result.headers.map((header) => (
                        <td className="whitespace-nowrap px-2 py-1.5" key={header}>
                          {row[header]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {loaded.result.errors.length > 0 && (
            <ul
              className="max-h-40 space-y-2 overflow-auto rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900"
              aria-label="Errores de validación"
            >
              {loaded.result.errors.map((issue, index) => (
                <li className="flex gap-2" key={`${issue.row}-${index}`}>
                  <CircleX aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                  {issue.row ? `Fila ${issue.row}: ` : ""}
                  {issue.message}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={ingest}
              disabled={busy || loaded.result.validRows === 0}
              className="bg-emerald-700 text-white hover:bg-emerald-800"
            >
              <CircleCheck aria-hidden="true" className="mr-2 h-4 w-4" />
              {busy ? "Guardando…" : "Guardar filas válidas"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="text-slate-600 hover:bg-slate-100"
              onClick={() => {
                setLoaded(null);
                setSummary(null);
              }}
            >
              <Trash2 aria-hidden="true" className="mr-2 h-4 w-4" />
              Limpiar
            </Button>
          </div>
        </>
      )}
      {summary && (
        <div
          role="status"
          className={`space-y-2 rounded-xl border p-4 text-sm shadow-sm ${summary.persisted ? "border-emerald-300 bg-emerald-50 text-emerald-950" : "border-rose-300 bg-rose-50 text-rose-950"}`}
        >
          <p className="font-semibold">
            <span className="inline-flex items-center gap-2">
              {summary.persisted ? (
                <CircleCheck className="h-5 w-5 text-emerald-700" />
              ) : (
                <CircleX className="h-5 w-5 text-rose-700" />
              )}
              {summary.persisted ? "Importación completada" : "No se completó la importación"}
            </span>
          </p>
          <p>
            Aceptadas: {summary.accepted} · Rechazadas: {summary.rejected}
          </p>
          {summary.error && <p>{summary.error}</p>}
          {summary.errors?.map((issue, index) => (
            <p key={`${issue.row}-${index}`} className="text-destructive">
              Fila {issue.row}: {issue.message}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

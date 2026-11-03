import { useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { toast } from "sonner";
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
      toast.success(
        `${result.accepted} filas importadas; ${result.rejected} rechazadas.`,
      );
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
    <section className="space-y-4 rounded-xl border bg-background p-5">
      <div>
        <h2 className="text-lg font-bold">Importar lecturas CSV</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Cada fila debe incluir una muestra completa del proceso. Las lecturas aisladas de sensores
          no se pueden importar como una muestra completa.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => downloadText("plantilla_aquasense_snapshots.csv", CSV_TEMPLATE)}
        >
          Descargar plantilla vacía
        </Button>
        <Button type="button" variant="outline" onClick={() => input.current?.click()}>
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
        className={`cursor-pointer rounded-lg border border-dashed p-6 text-center text-sm ${dragging ? "border-primary bg-primary/5" : "border-border"}`}
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
            <strong>{loaded.file.name}</strong>
            <span className="ml-2 text-muted-foreground">
              {loaded.result.validRows} filas válidas · {loaded.result.errors.length} errores
            </span>
          </>
        ) : (
          "Arrastra aquí un CSV o selecciona un archivo. Máximo 5 MB."
        )}
      </div>

      {!loaded && (
        <p className="text-xs text-muted-foreground">
          Columnas requeridas: {CSV_COLUMNS.join(", ")}. Las opcionales pueden quedar vacías.
        </p>
      )}
      {loaded && (
        <>
          <div className="flex flex-wrap gap-4 text-sm">
            <span>
              Filas leídas: <strong>{loaded.result.rows.length}</strong>
            </span>
            <span>
              Válidas: <strong>{loaded.result.validRows}</strong>
            </span>
            <span>
              Rechazadas: <strong>{loaded.result.errors.length}</strong>
            </span>
          </div>
          {loaded.result.headers.length > 0 && (
            <div className="overflow-auto rounded-lg border">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted">
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
                    <tr className="border-t" key={loaded.result.rowNumbers[index]}>
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
              className="max-h-40 space-y-1 overflow-auto text-sm text-destructive"
              aria-label="Errores de validación"
            >
              {loaded.result.errors.map((issue, index) => (
                <li key={`${issue.row}-${index}`}>
                  {issue.row ? `Fila ${issue.row}: ` : ""}
                  {issue.message}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={ingest} disabled={busy || loaded.result.validRows === 0}>
              {busy ? "Guardando…" : "Guardar filas válidas"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setLoaded(null);
                setSummary(null);
              }}
            >
              Limpiar
            </Button>
          </div>
        </>
      )}
      {summary && (
        <div
          role="status"
          className={`space-y-1 rounded-lg border p-4 text-sm ${summary.persisted ? "border-emerald-500/30 bg-emerald-500/5" : "border-destructive/30 bg-destructive/5"}`}
        >
          <p className="font-semibold">
            {summary.persisted ? "Importación completada" : "No se completó la importación"}
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

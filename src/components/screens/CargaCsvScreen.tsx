import { ScadaShell } from "./ScadaShell";
import { CsvReview } from "./CsvReview";
import { FileSpreadsheet } from "lucide-react";

export function CargaCsvScreen() {
  return (
    <ScadaShell>
      <main className="min-h-screen space-y-6 px-8 pb-16 pt-24">
        <header className="relative overflow-hidden rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50 via-background to-indigo-50 p-6 shadow-sm">
          <div className="pointer-events-none absolute -right-8 -top-12 h-48 w-48 rounded-full bg-sky-300/20 blur-3xl" />
          <div className="relative flex items-center gap-4">
            <span className="rounded-2xl bg-gradient-to-br from-sky-600 to-indigo-700 p-3 text-white shadow-lg shadow-sky-900/20">
              <FileSpreadsheet aria-hidden="true" className="h-7 w-7" />
            </span>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-sky-800">
                Ingesta histórica
              </p>
              <h1 className="mt-1 text-2xl font-bold text-scada-ink-33">Carga de telemetría CSV</h1>
              <p className="mt-1 max-w-3xl text-sm text-scada-ink-35">
                Revisa las lecturas del archivo antes de importarlas. Te indicaremos qué filas
                necesitan corrección.
              </p>
            </div>
          </div>
        </header>
        <CsvReview />
      </main>
    </ScadaShell>
  );
}

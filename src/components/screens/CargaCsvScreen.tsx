import { ScadaShell } from "./ScadaShell";
import { CsvReview } from "./CsvReview";

export function CargaCsvScreen() {
  return (
    <ScadaShell>
      <main className="min-h-screen space-y-6 px-8 pb-16 pt-24">
        <header className="border-b border-scada-ink-26 pb-4">
          <p className="text-xs font-semibold uppercase text-primary">Ingesta histórica</p>
          <h1 className="mt-1 text-2xl font-bold text-scada-ink-33">Carga de telemetría CSV</h1>
          <p className="mt-1 max-w-3xl text-sm text-scada-ink-35">
            Las filas válidas se insertan de forma transaccional en TelemetrySnapshots. Si SQL
            Server no está disponible, se informa que no se guardó nada.
          </p>
        </header>
        <CsvReview />
      </main>
    </ScadaShell>
  );
}

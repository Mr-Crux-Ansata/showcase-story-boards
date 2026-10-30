import { EventEmitter } from "node:events";
import type { TelemetrySnapshot } from "../lib/types/telemetry";

class TelemetryBus extends EventEmitter {
  private lastSnapshot: TelemetrySnapshot | null = null;

  public publish(snapshot: TelemetrySnapshot) {
    this.lastSnapshot = snapshot;
    this.emit("telemetry", snapshot);
  }

  public getLatest(): TelemetrySnapshot | null {
    return this.lastSnapshot;
  }
}

// Singleton global para persistencia entre recargas del módulo en desarrollo
const globalKey = Symbol.for("aquasense.telemetryBus");
const globalObj = globalThis as unknown as Record<symbol, TelemetryBus>;

if (!globalObj[globalKey]) {
  globalObj[globalKey] = new TelemetryBus();
}

export const telemetryBus: TelemetryBus = globalObj[globalKey]!;

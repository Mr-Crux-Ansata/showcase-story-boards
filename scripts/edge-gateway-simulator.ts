/**
 * AquaSense AI - Simulador de Gateway Industrial Edge (OT)
 * Simula la adquisición de telemetría sin conexión OPC-UA, Modbus ni PLC real.
 * y transmitiendo paquetes hacia la API de ingesta.
 *
 * Ejecución:
 *   npx tsx scripts/edge-gateway-simulator.ts
 */

const TARGET_URL = process.env["TARGET_URL"] || "http://localhost:3000/api/edge/telemetry";
const GATEWAY_KEY = process.env["EDGE_GATEWAY_KEY"];
const PLANT_CODE = process.env["PLANT_CODE"] || "PL_NORTE";
if (!GATEWAY_KEY)
  throw new Error("EDGE_GATEWAY_KEY must be configured before starting the simulator.");
if (GATEWAY_KEY.length < 32)
  throw new Error("EDGE_GATEWAY_KEY must contain at least 32 characters.");
const target = new URL(TARGET_URL);
if (
  !["http:", "https:"].includes(target.protocol) ||
  target.username ||
  target.password ||
  target.search ||
  target.hash
) {
  throw new Error(
    "TARGET_URL must be an HTTP(S) URL without credentials, query parameters, or a fragment.",
  );
}
const controlUrl = new URL("/api/simulator/pac-setpoint", target);
controlUrl.searchParams.set("plantCode", PLANT_CODE);
const CONTROL_URL = controlUrl.toString();
const INTERVAL_MS = 5000;
let lastDatabaseStatus: string | undefined;
let lastSetpointSource: string | undefined;

console.info(`[Gateway] Setpoint API: ${CONTROL_URL}`);
console.info(`[Gateway] Plant: ${PLANT_CODE}; gateway key is configured (value hidden).`);
console.info(
  "[Gateway] SQL connection is managed by the web API; inspect its terminal for SQL diagnostics.",
);

console.log("=========================================================");
console.log(" AquaSense AI · Gateway Industrial Edge (Modo Emulación) ");
console.log("=========================================================");
console.log(`📡 Destino API:    ${TARGET_URL}`);
console.log(`⏱  Intervalo:      ${INTERVAL_MS / 1000}s`);
console.log("=========================================================\n");

let cycle = 1;

function errorDescription(error: unknown) {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause as { code?: unknown; message?: unknown } | undefined;
  const code = typeof cause?.code === "string" ? ` [${cause.code}]` : "";
  const causeMessage = typeof cause?.message === "string" ? `: ${cause.message}` : "";
  return `${error.message}${code}${causeMessage}`;
}

function reportDatabaseStatus(status: string) {
  if (lastDatabaseStatus === status) return;
  lastDatabaseStatus = status;
  if (status === "connected") {
    console.info(
      `[${new Date().toLocaleTimeString("es-MX")}] SQL status: connected; telemetry persisted.`,
    );
  } else {
    console.warn(
      `[${new Date().toLocaleTimeString("es-MX")}] SQL status: ${status}. Check the SQL diagnostic in the npm run dev terminal.`,
    );
  }
}

function reportSetpointSource(source: string | undefined) {
  if (!source || lastSetpointSource === source) return;
  lastSetpointSource = source;
  console.info(`[${new Date().toLocaleTimeString("es-MX")}] PAC setpoint source: ${source}.`);
}

function randomVariation(base: number, maxPercent: number): number {
  const delta = (Math.random() * 2 - 1) * (maxPercent / 100) * base;
  return Number((base + delta).toFixed(2));
}

async function sendTelemetryPacket() {
  const timestamp = new Date().toISOString();

  let pacDosePpm: number;
  try {
    const controlResponse = await fetch(CONTROL_URL, {
      headers: { "X-Edge-Gateway-Key": GATEWAY_KEY },
      signal: AbortSignal.timeout(5000),
    });
    const controlText = await controlResponse.text();
    if (!controlResponse.ok) {
      throw new Error(
        `Control API returned HTTP ${controlResponse.status}: ${controlText.slice(0, 1000) || controlResponse.statusText}`,
      );
    }
    const control = JSON.parse(controlText) as {
      setpointPpm?: unknown;
      mode?: string;
      source?: string;
      plcAcknowledged?: boolean;
      databaseStatus?: string;
    };
    if (
      typeof control.setpointPpm !== "number" ||
      !Number.isFinite(control.setpointPpm) ||
      control.mode !== "SIMULATION"
    ) {
      throw new Error("Control API did not return a valid simulated setpoint.");
    }
    pacDosePpm = control.setpointPpm;
    reportSetpointSource(control.source);
  } catch (err) {
    console.error(
      `[${new Date().toLocaleTimeString("es-MX")}] Control request failed; packet skipped. ${errorDescription(err)}`,
    );
    cycle++;
    return;
  }

  // Simulación dinámica de proceso
  const inflowRateM3h = randomVariation(142.8, 4); // ~138 - 148 m3/h
  const inflowTurbidityNtu = randomVariation(1.85, 8); // ~1.7 - 2.0 NTU
  const inflowDqoMgL = randomVariation(48.2, 5); // ~46 - 51 mg/L
  const inflowPh = randomVariation(7.42, 1.5); // ~7.3 - 7.5

  const pacPumpFrequencyHz = Number(((pacDosePpm / 32) * 50).toFixed(1));

  const effluentTurbidityNtu = Number((inflowTurbidityNtu * 0.88).toFixed(2));
  const effluentDqoMgL = Number((inflowDqoMgL * 0.91).toFixed(2));

  const payload = {
    plantCode: PLANT_CODE,
    shiftCode: "B",
    timestamp,
    inflowRateM3h,
    inflowTurbidityNtu,
    inflowDqoMgL,
    inflowPh,
    inflowTemperatureC: 22.4,
    pacDosePpm,
    pacPumpFrequencyHz,
    mbrDissolvedOxygenMgL: 2.15,
    blowerFrequencyHz: 42.0,
    effluentTurbidityNtu,
    effluentDqoMgL,
    effluentSstMgL: 11.8,
    effluentPh: 7.38,
    gatewayStatus: "ONLINE" as const,
  };

  try {
    const res = await fetch(TARGET_URL, {
      method: "POST",
      signal: AbortSignal.timeout(5000),
      headers: {
        "Content-Type": "application/json",
        "X-Edge-Gateway-Key": GATEWAY_KEY,
      },
      body: JSON.stringify(payload),
    });

    const timeStr = new Date().toLocaleTimeString("es-MX");

    if (res.ok) {
      const result = (await res.json()) as { snapshotId?: number; persisted?: boolean };
      reportDatabaseStatus(result.persisted ? "connected" : "unavailable");
      const persistence = result.persisted
        ? `SQL snapshot ${result.snapshotId ?? "saved"}`
        : "temporary memory only; not persisted";
      console.log(
        `[${timeStr}] Ciclo #${cycle} SIMULACIÓN transmitida | Caudal: ${inflowRateM3h} m³/h | Turb: ${inflowTurbidityNtu} NTU | PAC simulado: ${pacDosePpm} ppm | ${persistence} | PLC ACK: none`,
      );
    } else {
      const errText = await res.text();
      reportDatabaseStatus(`telemetry-http-${res.status}`);
      console.warn(
        `[${timeStr}] Ciclo #${cycle} ⚠️ Error del servidor (${res.status}): ${errText}`,
      );
    }
  } catch (err) {
    const timeStr = new Date().toLocaleTimeString("es-MX");
    console.error(`[${timeStr}] Network failure details: ${errorDescription(err)}`);
    console.error(
      `[${timeStr}] Ciclo #${cycle} ❌ No se pudo conectar con el servidor web en ${TARGET_URL}. ¿El servidor está corriendo? (${(err as Error).message})`,
    );
  }

  cycle++;
}

// Iniciar ciclo de transmisión
sendTelemetryPacket();
setInterval(sendTelemetryPacket, INTERVAL_MS);

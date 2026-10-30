/**
 * AquaSense AI - Simulador de Gateway Industrial Edge (OT)
 * Emula la adquisición de datos de un IPC en planta conectándose por OPC-UA/Modbus
 * y transmitiendo paquetes hacia la API de ingesta.
 *
 * Ejecución:
 *   npx tsx scripts/edge-gateway-simulator.ts
 */

const TARGET_URL = process.env["TARGET_URL"] || "http://localhost:3000/api/edge/telemetry";
const CONTROL_URL = new URL("/api/simulator/pac-setpoint", TARGET_URL).toString();
const GATEWAY_KEY = process.env["EDGE_GATEWAY_KEY"];
if (!GATEWAY_KEY) throw new Error("EDGE_GATEWAY_KEY must be configured before starting the simulator.");
const INTERVAL_MS = 5000;

console.log("=========================================================");
console.log(" AquaSense AI · Gateway Industrial Edge (Modo Emulación) ");
console.log("=========================================================");
console.log(`📡 Destino API:    ${TARGET_URL}`);
console.log(`⏱  Intervalo:      ${INTERVAL_MS / 1000}s`);
console.log("=========================================================\n");

let cycle = 1;

function randomVariation(base: number, maxPercent: number): number {
  const delta = (Math.random() * 2 - 1) * (maxPercent / 100) * base;
  return Number((base + delta).toFixed(2));
}

async function sendTelemetryPacket() {
  const timestamp = new Date().toISOString();

  let pacDosePpm: number;
  try {
    const controlResponse = await fetch(CONTROL_URL, { headers: { "X-Edge-Gateway-Key": GATEWAY_KEY } });
    if (!controlResponse.ok) throw new Error(`Control API returned ${controlResponse.status}.`);
    const control = await controlResponse.json() as { setpointPpm?: unknown; mode?: string; source?: string; plcAcknowledged?: boolean };
    if (typeof control.setpointPpm !== "number" || !Number.isFinite(control.setpointPpm) || control.mode !== "SIMULATION") {
      throw new Error("Control API did not return a valid simulated setpoint.");
    }
    pacDosePpm = control.setpointPpm;
  } catch (err) {
    console.error(`[${new Date().toLocaleTimeString("es-MX")}] Control simulation unavailable; packet skipped. ${(err as Error).message}`);
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
    plantCode: "PL_NORTE",
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
      headers: {
        "Content-Type": "application/json",
        "X-Edge-Gateway-Key": GATEWAY_KEY,
      },
      body: JSON.stringify(payload),
    });

    const timeStr = new Date().toLocaleTimeString("es-MX");

    if (res.ok) {
      const result = await res.json() as { snapshotId?: number; persisted?: boolean };
      const persistence = result.persisted ? `SQL snapshot ${result.snapshotId ?? "saved"}` : "temporary memory only; not persisted";
      console.log(`[${timeStr}] Ciclo #${cycle} SIMULACIÓN transmitida | Caudal: ${inflowRateM3h} m³/h | Turb: ${inflowTurbidityNtu} NTU | PAC simulado: ${pacDosePpm} ppm | ${persistence} | PLC ACK: none`);
    } else {
      const errText = await res.text();
      console.warn(`[${timeStr}] Ciclo #${cycle} ⚠️ Error del servidor (${res.status}): ${errText}`);
    }
  } catch (err) {
    const timeStr = new Date().toLocaleTimeString("es-MX");
    console.error(`[${timeStr}] Ciclo #${cycle} ❌ No se pudo conectar con el servidor web en ${TARGET_URL}. ¿El servidor está corriendo? (${(err as Error).message})`);
  }

  cycle++;
}

// Iniciar ciclo de transmisión
sendTelemetryPacket();
setInterval(sendTelemetryPacket, INTERVAL_MS);

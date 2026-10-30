import { useSyncExternalStore } from "react";

/** In-memory demonstration state shared across screens. Resets on page reload. */
export type AlertStatus = "abierta" | "pausada" | "resuelta";
export type ShiftCode = "A" | "B" | "C";
export type DemoAlert = { id: string; title: string; status: AlertStatus };
export type LogEntry = { id: number; time: string; kind: "consigna" | "alerta" | "datos" | "turno" | "sistema"; title: string; detail: string };

export type DemoState = {
  plant: string;
  shift: ShiftCode;
  alerts: DemoAlert[];
  log: LogEntry[];
  approvedDose: number | null;
  shiftSigned: boolean;
};

export const PLANTS = ["Planta Norte", "Planta Sur", "Planta Oriente"];
export const SHIFTS = [
  { id: "A", label: "Turno A", hours: "06:00 - 14:00" },
  { id: "B", label: "Turno B", hours: "14:00 - 22:00" },
  { id: "C", label: "Turno C", hours: "22:00 - 06:00" },
];

export function initialState(): DemoState {
  return {
    plant: PLANTS[0] ?? "Planta Norte",
    shift: "B",
    alerts: [
      { id: "pac", title: "Sobredosificación PAC en Reactor MBR", status: "abierta" },
      { id: "filtro", title: "Presión diferencial alta en FILT-DEHYD-02", status: "abierta" },
      { id: "membrana", title: "Deriva química en membrana", status: "abierta" },
    ],
    log: [],
    approvedDose: null,
    shiftSigned: false,
  };
}

let state = initialState();
let nextId = 1;
const listeners = new Set<() => void>();

function set(next: DemoState) { state = next; listeners.forEach((l) => l()); }
function now() { return new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }); }

export const demo = {
  get: () => state,
  reset: () => { nextId = 1; set(initialState()); },
  subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
  log(kind: LogEntry["kind"], title: string, detail: string) {
    const entry = { id: nextId++, time: now(), kind, title, detail };
    set({ ...state, log: [entry, ...state.log] });
    return entry.id;
  },
  removeLog(id: number) { set({ ...state, log: state.log.filter((e) => e.id !== id) }); },
  setAlert(id: string, status: AlertStatus, detail: string) {
    const a = state.alerts.find((x) => x.id === id);
    if (!a || a.status === status) return;
    set({ ...state, alerts: state.alerts.map((x) => (x.id === id ? { ...x, status } : x)) });
    demo.log("alerta", `${a.title}: ${status}`, detail);
  },
  reopenAlert(id: string) { set({ ...state, alerts: state.alerts.map((x) => (x.id === id ? { ...x, status: "abierta" } : x)) }); },
  /** Records an approved dose and closes the PAC alert; returns an undo function. */
  approveDose(ppm: number, detail: string) {
    const previous = state.approvedDose;
    const pacWasOpen = state.alerts.find((a) => a.id === "pac")?.status !== "resuelta";
    set({ ...state, approvedDose: ppm });
    const logId = demo.log("consigna", `Consigna PAC ${ppm} ppm aprobada`, detail);
    if (pacWasOpen) demo.setAlert("pac", "resuelta", `Cerrada por consigna PAC de ${ppm} ppm (demo).`);
    return () => {
      const alertLogs = pacWasOpen ? state.log.filter((e) => e.kind === "alerta" && e.title.startsWith("Sobredosificación")).map((e) => e.id).slice(0, 1) : [];
      set({ ...state, approvedDose: previous, log: state.log.filter((e) => e.id !== logId && !alertLogs.includes(e.id)) });
      if (pacWasOpen) demo.reopenAlert("pac");
    };
  },
  setPlant(plant: string) { set({ ...state, plant }); demo.log("sistema", `Planta seleccionada: ${plant}`, "Cambio de vista en la demostración."); },
  setShift(shift: ShiftCode) { set({ ...state, shift }); },
  signShift() { set({ ...state, shiftSigned: true }); demo.log("turno", `Cierre de Turno ${state.shift} firmado`, "Firma simulada; no tiene validez legal."); },
};

export const openAlertCount = (s: DemoState) => s.alerts.filter((a) => a.status === "abierta").length;

export function useDemo<T>(select: (s: DemoState) => T): T {
  return useSyncExternalStore(demo.subscribe, () => select(state), () => select(state));
}

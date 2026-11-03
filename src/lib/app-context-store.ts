import { useSyncExternalStore } from "react";

export type ShiftCode = "A" | "B" | "C";
export type AppContext = { plant: string; shift: ShiftCode };

export const PLANTS = ["Planta Norte", "Planta Sur", "Planta Oriente"];
export const SHIFTS = [
  { id: "A" as const, label: "Turno A", hours: "06:00 - 14:00" },
  { id: "B" as const, label: "Turno B", hours: "14:00 - 22:00" },
  { id: "C" as const, label: "Turno C", hours: "22:00 - 06:00" },
];

let state: AppContext = { plant: PLANTS[0]!, shift: "B" };
const listeners = new Set<() => void>();
function set(next: AppContext) {
  state = next;
  listeners.forEach((listener) => listener());
}

export const appContext = {
  get: () => state,
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  setPlant: (plant: string) => set({ ...state, plant }),
  setShift: (shift: ShiftCode) => set({ ...state, shift }),
  reset: () => set({ plant: PLANTS[0]!, shift: "B" }),
};

export function useAppContext<T>(select: (context: AppContext) => T) {
  return useSyncExternalStore(
    appContext.subscribe,
    () => select(state),
    () => select(state),
  );
}

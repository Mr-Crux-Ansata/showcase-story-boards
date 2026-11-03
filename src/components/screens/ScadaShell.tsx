import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { TopBar } from "./TopBar";
import { useAppContext } from "@/lib/app-context-store";
import { useLiveTelemetry } from "@/hooks/use-live-telemetry";
import { useApiData } from "@/hooks/use-api-data";
import { selectedPlantCode, type Page, type OperationalAlert } from "@/lib/api-client";

export function ScadaShell({ children }: { children: ReactNode }) {
  const plant = useAppContext((state) => state.plant);
  const alertsUrl = `/api/alerts?${new URLSearchParams({ plantCode: selectedPlantCode(plant), limit: "200" })}`;
  const { data: alertPage } = useApiData<Page<OperationalAlert>>(alertsUrl);
  const open = alertPage?.data.filter((alert) => alert.status === "abierta").length;
  const { isLive, data } = useLiveTelemetry();

  return (
    <div className="scada-import">
      <aside className="fixed left-0 top-0 h-full w-72 bg-scada-ink-1 text-scada-ink-3 z-50 flex flex-col justify-between border-r border-scada-ink-2 shadow-2xl">
        <div className="flex flex-col">
          <div className="h-20 px-5 flex items-center gap-3 bg-scada-ink-4 border-b border-scada-ink-5">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-scada-ink-6 via-scada-ink-7 to-scada-ink-8 flex items-center justify-center text-scada-ink-10 shadow-lg shadow-scada-ink-9/20 shrink-0">
              <span className="material-symbols-outlined text-[24px]">water_drop</span>
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-1.5">
                <span className="font-headline-md font-bold text-scada-ink-10 tracking-normal text-[17px]">
                  AquaSense
                </span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-label-mono font-bold bg-scada-ink-6 text-scada-ink-11 uppercase tracking-normal">
                  AI
                </span>
              </div>
              <span className="font-label-mono text-[10px] text-scada-ink-12/80 tracking-normal uppercase">
                MONITOREO DE PLANTA
              </span>
            </div>
          </div>

          <div className="px-4 pt-4 pb-2">
            <div className="p-3 rounded-lg bg-scada-ink-13/80 border border-scada-ink-9/30 flex items-center justify-between shadow-inner">
              <div className="flex items-center gap-2.5">
                <span className="relative flex h-2.5 w-2.5">
                  <span
                    className={`animate-ping absolute inline-flex h-full w-full rounded-full ${isLive ? "bg-emerald-400" : "bg-scada-ink-14"} opacity-75`}
                  ></span>
                  <span
                    className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isLive ? "bg-emerald-500" : "bg-scada-ink-14"}`}
                  ></span>
                </span>
                <div>
                  <div className="font-label-mono text-[11px] text-scada-ink-10 font-semibold leading-tight">
                    {isLive ? "Telemetría en vivo" : "Sin telemetría en vivo"}
                  </div>
                  <div className="font-label-mono text-[9px] text-scada-ink-15">
                    {isLive ? `Planta: ${data?.plantCode ?? ""}` : "Simulación desconectada"}
                  </div>
                </div>
              </div>
              <span
                className={`font-label-mono text-[11px] font-bold px-2 py-0.5 rounded border ${
                  isLive
                    ? "text-emerald-400 bg-emerald-950/60 border-emerald-500/40"
                    : "text-scada-ink-14 bg-scada-ink-16/60 border-scada-ink-17/40"
                }`}
              >
                {isLive ? "LIVE · SIM" : "OFFLINE"}
              </span>
            </div>
          </div>

          <nav className="flex flex-col gap-1.5 px-3 py-3">
            <Link
              to="/costos"
              activeProps={{ className: "scada-nav-active", "aria-current": "page" }}
              className="scada-nav-link flex items-center justify-between px-3.5 py-2.5 rounded-lg text-[13px]"
              data-path="dashboard"
            >
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-[20px] text-scada-ink-20">
                  monitoring
                </span>
                <span>Tablero de Costos y KPIs</span>
              </div>
              <span className="w-1.5 h-1.5 rounded-full bg-scada-ink-12"></span>
            </Link>
            <Link
              to="/alertas"
              activeProps={{ className: "scada-nav-active", "aria-current": "page" }}
              className="scada-nav-link flex items-center justify-between px-3.5 py-2.5 rounded-lg text-[13px]"
              data-path="anomalies"
            >
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-[20px] text-scada-ink-15 group-hover:text-scada-ink-22 transition-colors">
                  warning
                </span>
                <span>Desviaciones y Alertas</span>
              </div>
              <span className="px-2 py-0.5 rounded-full bg-scada-ink-23/20 text-scada-ink-24 border border-scada-ink-23/40 font-label-mono text-[11px] font-bold">
                {open ?? "—"}
              </span>
            </Link>
            <Link
              to="/recomendaciones"
              activeProps={{ className: "scada-nav-active", "aria-current": "page" }}
              className="scada-nav-link flex items-center justify-between px-3.5 py-2.5 rounded-lg text-[13px]"
              data-path="recommendations"
            >
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-[20px] text-scada-ink-15 group-hover:text-scada-ink-6 transition-colors">
                  auto_mode
                </span>
                <span>Recomendaciones IA</span>
              </div>
              <span className="px-2 py-0.5 rounded-full bg-scada-ink-9/20 text-scada-ink-12 border border-scada-ink-9/30 font-label-mono text-[10px] font-bold">
                ACTIVO
              </span>
            </Link>
            <Link
              to="/bitacora"
              activeProps={{ className: "scada-nav-active", "aria-current": "page" }}
              className="scada-nav-link flex items-center justify-between px-3.5 py-2.5 rounded-lg text-[13px]"
              data-path="tracking"
            >
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-[20px] text-scada-ink-15 group-hover:text-scada-ink-6 transition-colors">
                  verified
                </span>
                <span>Bitácora y Validación</span>
              </div>
            </Link>
            <Link
              to="/carga-csv"
              activeProps={{ className: "scada-nav-active", "aria-current": "page" }}
              className="scada-nav-link flex items-center justify-between px-3.5 py-2.5 rounded-lg text-[13px]"
              data-path="import"
            >
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-[20px] text-scada-ink-15 group-hover:text-scada-ink-6 transition-colors">
                  upload_file
                </span>
                <span>Carga de Datos CSV</span>
              </div>
            </Link>
          </nav>
        </div>

        <div className="p-3 m-3 rounded-lg bg-scada-ink-4/90 border border-scada-ink-25 flex flex-col gap-2.5 shadow-xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-scada-ink-6 text-[18px]">
                precision_manufacturing
              </span>
              <span className="font-label-mono text-[11px] text-scada-ink-26 font-semibold uppercase">
                PAC simulado
              </span>
            </div>
            <span className="px-1.5 py-0.5 rounded font-label-mono text-[9px] bg-scada-ink-9/20 text-scada-ink-12 border border-scada-ink-6/30 font-bold">
              IA simulada
            </span>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between font-label-mono text-[11px]">
              <span className="text-scada-ink-15">Caudal Reactor</span>
              <span className="text-scada-ink-12 font-bold">
                {data ? `${data.inflowRateM3h.toFixed(1)} m³/h` : "—"}
              </span>
            </div>
            <div className="w-full bg-scada-ink-27 h-2 rounded-full overflow-hidden p-0.5 border border-scada-ink-28">
              <div
                className="bg-gradient-to-r from-scada-ink-6 to-scada-ink-7 h-full rounded-full shadow-sm transition-all duration-500"
                style={{
                  width: `${Math.min(100, Math.max(0, ((data?.inflowRateM3h ?? 0) / 200) * 100))}%`,
                }}
              ></div>
            </div>
          </div>
          <div className="pt-2 border-t border-scada-ink-29 flex items-center justify-between text-[10px] font-label-mono text-scada-ink-15">
            <span className="flex items-center gap-1">
              <span className="material-symbols-outlined text-[13px] text-scada-ink-15">
                memory
              </span>
              Fuente simulada
            </span>
            <span className={isLive ? "text-emerald-400 font-bold" : "text-scada-ink-14 font-bold"}>
              {isLive ? "● SIMULACIÓN EN VIVO" : "● SIN CONEXIÓN"}
            </span>
          </div>
        </div>
      </aside>
      <div className="pl-72">
        <TopBar />
        {children}
      </div>
    </div>
  );
}

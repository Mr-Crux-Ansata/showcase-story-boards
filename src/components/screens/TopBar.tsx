import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { appContext, PLANTS, SHIFTS, useAppContext } from "@/lib/app-context-store";
import { useLiveTelemetry } from "@/hooks/use-live-telemetry";
import { api, selectedPlantCode, type Page, type OperationalAlert } from "@/lib/api-client";
import { useApiData } from "@/hooks/use-api-data";
import { useState } from "react";

type OperatorContext = {
  configured: boolean;
  operatorName: string | null;
  operatorRole: string | null;
};

const chip =
  "flex items-center gap-2.5 px-3.5 py-2 rounded-lg bg-scada-ink-31 border border-scada-ink-26 text-scada-ink-32 shadow-xs hover:bg-scada-ink-26 transition-colors focus-visible:outline-2 focus-visible:outline-primary";

export function TopBar() {
  const plant = useAppContext((s) => s.plant);
  const shiftId = useAppContext((s) => s.shift);
  const [refreshAlerts, setRefreshAlerts] = useState(0);
  const alertsUrl = `/api/alerts?${new URLSearchParams({ plantCode: selectedPlantCode(plant), limit: "50" })}`;
  const { data: alertsResult } = useApiData<Page<OperationalAlert>>(
    alertsUrl,
    refreshAlerts,
    30_000,
  );
  const { data: operator } = useApiData<OperatorContext>("/api/operator/context");
  const alerts = alertsResult?.data ?? [];
  const open = alerts.filter((alert) => alert.status === "abierta").length;
  const shift = SHIFTS.find((s) => s.id === shiftId) ?? SHIFTS[1]!;
  const { isLive, data } = useLiveTelemetry();

  async function updateStatus(alertId: number, status: OperationalAlert["status"]) {
    const pausedUntil =
      status === "pausada" ? new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString() : undefined;
    try {
      await api.updateAlert(alertId, selectedPlantCode(plant), status, shiftId, pausedUntil);
      setRefreshAlerts((value) => value + 1);
      toast.success(status === "resuelta" ? "Alerta resuelta." : "Alerta pausada.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo actualizar la alerta.");
    }
  }

  return (
    <header className="fixed top-0 left-72 right-0 min-h-[68px] py-3.5 px-8 bg-scada-ink-10/95 backdrop-blur-md border-b border-scada-ink-26 shadow-xs z-40 flex items-center justify-between transition-all">
      <div className="flex items-center gap-3">
        <DropdownMenu>
          <DropdownMenuTrigger className={chip} aria-label="Cambiar planta">
            <span className="material-symbols-outlined text-primary text-[20px]">factory</span>
            <span className="flex items-center gap-2">
              <span className="text-sm font-bold text-scada-ink-33">{plant}</span>
            </span>
            <span className="material-symbols-outlined text-scada-ink-15 text-[18px]">
              expand_more
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Planta</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={plant}
              onValueChange={(v) => {
                appContext.setPlant(v);
                toast(`Planta seleccionada: ${v}`, {
                  description: "Las consultas operativas usarán esta planta.",
                });
              }}
            >
              {PLANTS.map((p) => (
                <DropdownMenuRadioItem key={p} value={p}>
                  {p}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger
            className={`hidden md:flex ${chip} text-xs font-label-mono`}
            aria-label="Cambiar turno"
          >
            <span className="material-symbols-outlined text-scada-ink-15 text-[16px]">
              schedule
            </span>
            <span className="font-semibold text-scada-ink-33">{shift.label}</span>
            <span className="text-scada-ink-34">({shift.hours})</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Turno</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={shiftId}
              onValueChange={(v) => {
                if (v === "A" || v === "B" || v === "C") appContext.setShift(v);
              }}
            >
              {SHIFTS.map((s) => (
                <DropdownMenuRadioItem key={s.id} value={s.id}>
                  {s.label} · {s.hours}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex items-center gap-3.5">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-scada-ink-36 border border-scada-ink-37 shadow-xs">
          <span
            className={`relative inline-flex rounded-full h-2 w-2 ${isLive ? (data?.nom001Compliant ? "bg-emerald-500" : "bg-destructive") : "bg-scada-ink-17"}`}
          ></span>
          <span className="font-label-mono text-xs font-bold text-scada-ink-39">
            {isLive
              ? `NOM-001: ${data?.nom001Compliant ? "Cumple (En vivo)" : "Alerta Efluente"}`
              : "NOM-001: Sin telemetría"}
          </span>
        </div>
        {isLive && (
          <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-emerald-800 text-xs font-label-mono font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>Edge {data?.gatewayStatus}</span>
          </div>
        )}
        <Popover>
          <PopoverTrigger
            className="relative p-2 rounded-lg bg-scada-ink-31 border border-scada-ink-26 text-scada-ink-34 hover:bg-scada-ink-26 transition-colors"
            aria-label={`Notificaciones: ${open} alertas abiertas`}
          >
            <span className="material-symbols-outlined text-[20px] block">notifications</span>
            {open > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-scada-ink-40 text-scada-ink-10 rounded-full font-label-mono text-[9px] flex items-center justify-center font-bold">
                {open}
              </span>
            )}
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-0">
            <div className="px-4 py-3 border-b border-border font-semibold text-sm">
              Alertas ({alertsResult ? `${open} abiertas` : "sin conexión"})
            </div>
            <ul className="max-h-80 overflow-auto">
              {alerts.map((a) => (
                <li
                  key={a.alertId}
                  className="px-4 py-3 border-b border-border last:border-0 text-sm flex flex-col gap-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium">{a.title}</span>
                    <StatusPill status={a.status} />
                  </div>
                  {a.status !== "resuelta" && (
                    <div className="flex gap-2">
                      <button
                        className="text-xs font-semibold text-primary hover:underline"
                        onClick={() => updateStatus(a.alertId, "resuelta")}
                      >
                        Resolver
                      </button>
                      {a.status === "abierta" && (
                        <button
                          className="text-xs font-semibold text-muted-foreground hover:underline"
                          onClick={() => updateStatus(a.alertId, "pausada")}
                        >
                          Pausar 4h
                        </button>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <Link
              to="/alertas"
              className="block px-4 py-2.5 text-center text-sm font-semibold text-primary border-t border-border hover:bg-muted"
            >
              Ver todas las alertas
            </Link>
          </PopoverContent>
        </Popover>
        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex items-center gap-2.5 pl-3 border-l border-scada-ink-26 text-left"
            aria-label="Menú de usuario"
          >
            <span className="w-9 h-9 rounded-lg bg-gradient-to-tr from-scada-ink-41 to-scada-ink-18 text-scada-ink-10 flex items-center justify-center font-bold font-label-mono text-xs shadow-sm">
              OP
            </span>
            <span className="flex flex-col">
              <span className="text-xs font-bold text-scada-ink-33 leading-tight">
                {operator?.operatorName ?? "Operador sin configurar"}
              </span>
              <span className="text-[10px] font-label-mono text-scada-ink-34 leading-tight mt-0.5">
                {operator?.operatorRole ?? "Sin rol configurado"}
              </span>
            </span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Usuario</DropdownMenuLabel>
            <DropdownMenuItem asChild>
              <Link to="/bitacora">Ver bitácora del turno</Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                appContext.reset();
                toast("Contexto de planta y turno reiniciado");
              }}
            >
              Reiniciar contexto de vista
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

export function StatusPill({ status }: { status: string }) {
  const cls =
    status === "resuelta"
      ? "bg-scada-ink-36 text-scada-ink-39 border-scada-ink-37"
      : status === "pausada"
        ? "bg-muted text-muted-foreground border-border"
        : "bg-destructive/10 text-destructive border-destructive/30";
  return (
    <span
      className={`shrink-0 px-2 py-0.5 rounded-full border text-[11px] font-bold capitalize ${cls}`}
    >
      {status}
    </span>
  );
}

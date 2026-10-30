import { useEffect, useState } from "react";
import type { TelemetrySnapshot } from "../lib/types/telemetry";

export interface LiveTelemetryState {
  data: TelemetrySnapshot | null;
  isLive: boolean;
  gatewayStatus: "ONLINE" | "DISCONNECTED" | "WAITING";
  lastReceivedAt: string | null;
}

export function useLiveTelemetry(): LiveTelemetryState {
  const [data, setData] = useState<TelemetrySnapshot | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [gatewayStatus, setGatewayStatus] = useState<LiveTelemetryState["gatewayStatus"]>("WAITING");
  const [lastReceivedAt, setLastReceivedAt] = useState<string | null>(null);

  useEffect(() => {
    let eventSource: EventSource | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      try {
        eventSource = new EventSource("/api/telemetry/stream");

        eventSource.addEventListener("telemetry", (e: MessageEvent) => {
          try {
            const parsed = JSON.parse(e.data) as TelemetrySnapshot;
            setData(parsed);
            setIsLive(true);
            setGatewayStatus("ONLINE");
            setLastReceivedAt(new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
          } catch (err) {
            console.error("Error parseando telemetría viva:", err);
          }
        });

        eventSource.addEventListener("status", (e: MessageEvent) => {
          try {
            const statusObj = JSON.parse(e.data);
            if (statusObj.state === "WAITING_FOR_GATEWAY") {
              setGatewayStatus("WAITING");
            }
          } catch {
            // Ignore
          }
        });

        eventSource.onerror = () => {
          setIsLive(false);
          setGatewayStatus("DISCONNECTED");
          eventSource?.close();
          // Reintentar conexión tras 5 segundos
          reconnectTimeout = setTimeout(connect, 5000);
        };
      } catch {
        setIsLive(false);
        setGatewayStatus("DISCONNECTED");
      }
    }

    connect();

    return () => {
      eventSource?.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, []);

  return {
    data,
    isLive,
    gatewayStatus,
    lastReceivedAt,
  };
}

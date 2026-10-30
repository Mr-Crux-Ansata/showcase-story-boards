import { telemetryBus } from "../telemetry-bus";
import { getLatestInMemoryTelemetry } from "../db/telemetry-repository";
import type { TelemetrySnapshot } from "../../lib/types/telemetry";

export function handleTelemetryStreamRequest(request: Request): Response {
  if (request.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed. Use GET for SSE stream." }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      // Función auxiliar para enviar eventos SSE
      const sendEvent = (event: string, data: unknown) => {
        try {
          const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(payload));
        } catch {
          // Stream cerrado por el cliente
        }
      };

      // 1. Enviar el último snapshot disponible de inmediato
      const initial = telemetryBus.getLatest() || getLatestInMemoryTelemetry();
      if (initial) {
        sendEvent("telemetry", initial);
      } else {
        // Enviar estado de espera
        sendEvent("status", { state: "WAITING_FOR_GATEWAY", message: "Conectado al bus. Esperando paquetes del Gateway Edge..." });
      }

      // 2. Suscribirse a nuevos paquetes del bus
      const onNewTelemetry = (snapshot: TelemetrySnapshot) => {
        sendEvent("telemetry", snapshot);
      };

      telemetryBus.on("telemetry", onNewTelemetry);

      // 3. Heartbeat periódico cada 15 segundos para mantener la conexión viva
      const heartbeatInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          clearInterval(heartbeatInterval);
        }
      }, 15000);

      cleanup = () => {
        telemetryBus.off("telemetry", onNewTelemetry);
        clearInterval(heartbeatInterval);
      };
    },
    cancel() {
      if (cleanup) {
        cleanup();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no", // Evita buffers intermedios en NGINX/proxies
    },
  });
}

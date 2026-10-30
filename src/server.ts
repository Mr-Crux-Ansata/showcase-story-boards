import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { handleEdgeTelemetryRequest } from "./server/api/edge-telemetry";
import { handleTelemetryStreamRequest } from "./server/api/telemetry-stream";
import { handleAiOptimizeRequest, handleAiApproveRequest, handleAiExpireRequest } from "./server/api/ai-optimize";
import { handleOperationsApi } from "./server/api/operations";
import { handleSimulatorControlRequest } from "./server/api/simulator-control";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const url = new URL(request.url);

      // 1. Endpoint de ingesta de telemetría desde Gateway Edge
      if (url.pathname === "/api/edge/telemetry") {
        return await handleEdgeTelemetryRequest(request);
      }

      // 2. Endpoint de streaming en tiempo real (Server-Sent Events) para la UI
      if (url.pathname === "/api/telemetry/stream") {
        return handleTelemetryStreamRequest(request);
      }

      // 3. Endpoints del Motor de Inferencia y Recomendaciones IA
      if (url.pathname === "/api/ai/optimize") {
        return await handleAiOptimizeRequest(request);
      }

      if (url.pathname === "/api/ai/recommendations/approve") {
        return await handleAiApproveRequest(request);
      }
      if (url.pathname === "/api/ai/recommendations/expire") {
        return await handleAiExpireRequest(request);
      }
      if (url.pathname === "/api/simulator/pac-setpoint") {
        return await handleSimulatorControlRequest(request);
      }

      const operationsResponse = await handleOperationsApi(request);
      if (operationsResponse) return operationsResponse;

      // 4. Flujo normal de renderizado SSR con TanStack Start
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};

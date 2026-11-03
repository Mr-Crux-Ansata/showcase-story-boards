import { useEffect, useState } from "react";

export function useApiData<T>(url: string, refresh = 0, pollIntervalMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const load = async () => {
      try {
        const response = await fetch(url, {
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const message =
            body && typeof body === "object" && "error" in body && typeof body.error === "string"
              ? body.error
              : `Request failed (${response.status}).`;
          throw new Error(message);
        }
        setData(body as T);
        setError(null);
      } catch (cause: unknown) {
        if (cause instanceof Error && cause.name === "AbortError") return;
        setError(cause instanceof Error ? cause.message : "Request failed.");
        setData(null);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    const timer =
      pollIntervalMs > 0
        ? setInterval(() => {
            void load();
          }, pollIntervalMs)
        : undefined;
    return () => {
      controller.abort();
      if (timer) clearInterval(timer);
    };
  }, [url, refresh, pollIntervalMs]);

  return { data, loading, error };
}

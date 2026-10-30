import { useEffect, useState } from "react";

export function useApiData<T>(url: string, refresh = 0) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetch(url, { headers: { Accept: "application/json" }, signal: controller.signal })
      .then(async (response) => {
        const body: unknown = await response.json().catch(() => null);
        if (!response.ok) {
          const message = body && typeof body === "object" && "error" in body && typeof body.error === "string"
            ? body.error : `Request failed (${response.status}).`;
          throw new Error(message);
        }
        return body as T;
      })
      .then((body) => setData(body))
      .catch((cause: unknown) => {
        if (cause instanceof Error && cause.name === "AbortError") return;
        setError(cause instanceof Error ? cause.message : "Request failed.");
        setData(null);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [url, refresh]);

  return { data, loading, error };
}

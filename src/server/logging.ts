type ErrorDetails = {
  name?: unknown;
  message?: unknown;
  code?: unknown;
  number?: unknown;
  state?: unknown;
  class?: unknown;
  lineNumber?: unknown;
  originalError?: unknown;
  cause?: unknown;
};

function asErrorDetails(value: unknown): ErrorDetails | null {
  return value !== null && typeof value === "object" ? (value as ErrorDetails) : null;
}

function safeMessage(value: unknown) {
  if (typeof value !== "string") return undefined;
  return value
    .replace(/((?:password|pwd)\s*[=:]\s*)(?:'[^']*'|"[^"]*"|[^\s;,]+)/gi, "$1[REDACTED]")
    .replace(/login failed for user\s+'[^']*'/gi, "Login failed for configured SQL user");
}

function classifyError(message: string | undefined, code: unknown) {
  const text = `${String(code ?? "")} ${message ?? ""}`.toLowerCase();
  if (/invalid object name|invalid column name/.test(text)) return "DATABASE_SCHEMA_MISMATCH";
  if (/certificate|self[- ]signed|tls|ssl/.test(text)) return "TLS_OR_CERTIFICATE";
  if (/login failed|authentication|elogin/.test(text)) return "LOGIN_REJECTED";
  if (/timeout|etimedout/.test(text)) return "CONNECTION_TIMEOUT";
  if (/econnrefused|esocket|enotfound|ehostunreach/.test(text)) return "SERVER_UNREACHABLE";
  if (/database .*not found|cannot open database/.test(text)) return "DATABASE_UNAVAILABLE";
  return "DATABASE_OR_SERVER_ERROR";
}

export function logServerError(context: string, error: unknown, details?: Record<string, unknown>) {
  const outer = asErrorDetails(error);
  const original = asErrorDetails(outer?.originalError) ?? asErrorDetails(outer?.cause);
  const message = safeMessage(outer?.message ?? original?.message);
  const code = outer?.code ?? original?.code;

  console.error(`[AquaSense] ${context}`, {
    category: classifyError(message, code),
    errorName: typeof outer?.name === "string" ? outer.name : "UnknownError",
    ...(typeof code === "string" || typeof code === "number" ? { code } : {}),
    ...(typeof (outer?.number ?? original?.number) === "number"
      ? { sqlNumber: outer?.number ?? original?.number }
      : {}),
    ...(typeof (outer?.state ?? original?.state) === "number"
      ? { sqlState: outer?.state ?? original?.state }
      : {}),
    ...(typeof (outer?.class ?? original?.class) === "number"
      ? { sqlClass: outer?.class ?? original?.class }
      : {}),
    ...(typeof (outer?.lineNumber ?? original?.lineNumber) === "number"
      ? { sqlLine: outer?.lineNumber ?? original?.lineNumber }
      : {}),
    ...(message ? { message } : {}),
    ...details,
  });
}

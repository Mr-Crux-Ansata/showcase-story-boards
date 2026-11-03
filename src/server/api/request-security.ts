export function isSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function operationalIdentity() {
  const name = process.env["OPERATOR_NAME"]?.trim();
  const role = process.env["OPERATOR_ROLE"]?.trim();
  if (!name || !role) return null;
  return { name, role };
}

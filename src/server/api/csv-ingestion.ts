import { parseCsv } from "../../lib/csv";
import { TelemetryPayloadSchema, type TelemetrySnapshot } from "../../lib/types/telemetry";
import { DatabaseUnavailableError } from "../db/errors";
import { getTelemetryImportCodes, insertTelemetrySnapshotsBatch } from "../db/telemetry-repository";
import { isSameOriginRequest, operationalIdentity } from "./request-security";
import { logServerError } from "../logging";

const MAX_CSV_BYTES = 5 * 1024 * 1024;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

async function readLimitedCsv(request: Request) {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_CSV_BYTES)
    throw new RangeError("CSV exceeds 5 MB.");
  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_CSV_BYTES) {
      await reader.cancel();
      throw new RangeError("CSV exceeds 5 MB.");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

export async function handleCsvIngestionRequest(request: Request) {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!isSameOriginRequest(request))
    return json({ error: "CSV imports must come from this application origin." }, 403);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("text/csv"))
    return json({ error: "El archivo debe tener formato CSV." }, 415);
  try {
    const text = await readLimitedCsv(request);
    const parsed = parseCsv(text);
    const headerErrors = parsed.errors.filter(
      (issue) => issue.row === parsed.headerRow || issue.row === 0,
    );
    if (headerErrors.length || parsed.headers.length === 0) {
      return json(
        {
          error: "Los encabezados del archivo no son válidos.",
          accepted: 0,
          rejected: parsed.rows.length,
          persisted: false,
          errors: headerErrors,
        },
        400,
      );
    }
    const validation = await getTelemetryImportCodes();
    const issues = [...parsed.errors];
    const issueRows = new Set(issues.filter((issue) => issue.row > 0).map((issue) => issue.row));
    const snapshots: TelemetrySnapshot[] = [];
    const names: Record<string, string> = {
      inflowratem3h: "inflowRateM3h",
      inflowturbidityntu: "inflowTurbidityNtu",
      inflowdqomgl: "inflowDqoMgL",
      inflowph: "inflowPh",
      inflowtemperaturec: "inflowTemperatureC",
      pacdoseppm: "pacDosePpm",
      pacpumpfrequencyhz: "pacPumpFrequencyHz",
      mbrdissolvedoxygenmgl: "mbrDissolvedOxygenMgL",
      blowerfrequencyhz: "blowerFrequencyHz",
      effluentturbidityntu: "effluentTurbidityNtu",
      effluentdqomgl: "effluentDqoMgL",
      effluentsstmgl: "effluentSstMgL",
      effluentph: "effluentPh",
    };
    for (let index = 0; index < parsed.rows.length; index++) {
      const row = parsed.rows[index]!;
      const rowNumber = parsed.rowNumbers[index]!;
      if (issueRows.has(rowNumber)) continue;
      const plantCode = row["plantcode"]!;
      const shiftCode = row["shiftcode"]!;
      if (!validation.plantCodes.has(plantCode)) {
        issues.push({ row: rowNumber, message: `Planta desconocida: ${plantCode}.` });
        continue;
      }
      if (!validation.shiftCodes.has(shiftCode)) {
        issues.push({ row: rowNumber, message: `Turno desconocido: ${shiftCode}.` });
        continue;
      }
      const raw: Record<string, unknown> = { plantCode, shiftCode, timestamp: row["timestamp"] };
      for (const [csvName, property] of Object.entries(names)) {
        const value = row[csvName]?.trim();
        if (value !== undefined && value !== "") raw[property] = Number(value);
      }
      const payload = TelemetryPayloadSchema.safeParse(raw);
      if (!payload.success) {
        issues.push({
          row: rowNumber,
          message: "La fila debe incluir una muestra completa con valores válidos.",
        });
        continue;
      }
      const values = payload.data;
      const nom001Compliant = values.effluentTurbidityNtu < 4 && values.effluentDqoMgL < 60;
      const dataQualityFlag = values.inflowPh < 5 || values.inflowPh > 9.5 ? "UNCERTAIN" : "GOOD";
      snapshots.push({
        ...values,
        recordedAt: values.timestamp!,
        nom001Compliant,
        dataQualityFlag,
      });
    }
    if (snapshots.length === 0) {
      return json(
        {
          ok: issues.length === 0,
          persisted: false,
          accepted: 0,
          rejected: parsed.rows.length,
          errors: issues,
        },
        issues.length ? 400 : 200,
      );
    }
    const identity = operationalIdentity();
    if (!identity)
      return json(
        {
          error: "La importación no está disponible. Contacta al administrador del sistema.",
          persisted: false,
          accepted: 0,
          rejected: parsed.rows.length,
          errors: issues,
        },
        503,
      );
    try {
      const snapshotIds = await insertTelemetrySnapshotsBatch(snapshots, identity);
      return json(
        {
          ok: true,
          persisted: true,
          accepted: snapshotIds.length,
          rejected: parsed.rows.length - snapshotIds.length,
          snapshotIds,
          errors: issues,
        },
        201,
      );
    } catch (error) {
      if (error instanceof DatabaseUnavailableError)
        return json(
          {
            error: "No se pudo completar la importación. No se guardaron filas.",
            persisted: false,
            accepted: 0,
            rejected: parsed.rows.length,
            errors: issues,
          },
          503,
        );
      throw error;
    }
  } catch (error) {
    if (error instanceof RangeError)
      return json(
        { error: "El archivo supera el límite de 5 MB.", persisted: false, accepted: 0, rejected: 0 },
        413,
      );
    if (error instanceof DatabaseUnavailableError)
      return json(
        {
          error: "No se pudo completar la importación. No se guardaron filas.",
          persisted: false,
          accepted: 0,
          rejected: 0,
        },
        503,
      );
    logServerError("CSV telemetry import failed.", error);
    return json(
      {
        error: "No se pudo completar la importación. No se guardaron filas.",
        persisted: false,
        accepted: 0,
      },
      500,
    );
  }
}

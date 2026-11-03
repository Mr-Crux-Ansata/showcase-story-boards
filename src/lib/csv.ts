export const CSV_REQUIRED_COLUMNS = [
  "plantcode",
  "shiftcode",
  "timestamp",
  "inflowratem3h",
  "inflowturbidityntu",
  "inflowdqomgl",
  "inflowph",
  "pacdoseppm",
  "effluentturbidityntu",
  "effluentdqomgl",
  "effluentph",
] as const;

export const CSV_OPTIONAL_COLUMNS = [
  "inflowtemperaturec",
  "pacpumpfrequencyhz",
  "mbrdissolvedoxygenmgl",
  "blowerfrequencyhz",
  "effluentsstmgl",
] as const;

export const CSV_COLUMNS = [...CSV_REQUIRED_COLUMNS, ...CSV_OPTIONAL_COLUMNS];
export type CsvRow = Record<string, string>;
export type CsvIssue = { row: number; message: string };
export type CsvResult = {
  headers: string[];
  headerRow: number;
  rows: CsvRow[];
  rowNumbers: number[];
  errors: CsvIssue[];
  validRows: number;
};

const RANGES: Record<string, [number, number]> = {
  inflowratem3h: [0, 1000],
  inflowturbidityntu: [0, 500],
  inflowdqomgl: [0, 2000],
  inflowph: [0, 14],
  inflowtemperaturec: [0, 60],
  pacdoseppm: [5, 50],
  pacpumpfrequencyhz: [0, 60],
  mbrdissolvedoxygenmgl: [0, 15],
  blowerfrequencyhz: [0, 60],
  effluentturbidityntu: [0, 50],
  effluentdqomgl: [0, 200],
  effluentsstmgl: [0, 100],
  effluentph: [0, 14],
};

function recordsFromCsv(text: string, errors: CsvIssue[]) {
  const delimiter = (() => {
    let quoted = false;
    for (const character of text) {
      if (character === '"') quoted = !quoted;
      if (!quoted && (character === "," || character === ";")) return character;
      if (!quoted && (character === "\n" || character === "\r")) break;
    }
    return ",";
  })();
  const records: Array<{ row: number; cells: string[] }> = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let physicalRow = 1;
  let recordStart = 1;
  const source = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < source.length; i++) {
    const character = source[i]!;
    if (character === '"') {
      if (quoted && source[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
      continue;
    }
    if (!quoted && character === delimiter) {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && source[i + 1] === "\n") i++;
      cells.push(cell.trim());
      if (cells.some((value) => value !== "")) records.push({ row: recordStart, cells });
      cells = [];
      cell = "";
      physicalRow++;
      recordStart = physicalRow;
      continue;
    }
    cell += character;
    if (character === "\n") physicalRow++;
  }
  if (quoted) errors.push({ row: recordStart, message: "Campo entre comillas sin cerrar." });
  if (cells.length || cell.trim()) {
    cells.push(cell.trim());
    if (cells.some((value) => value !== "")) records.push({ row: recordStart, cells });
  }
  return records;
}

export function parseCsv(text: string): CsvResult {
  const errors: CsvIssue[] = [];
  if (new TextEncoder().encode(text).byteLength > 5 * 1024 * 1024) {
    return {
      headers: [],
      headerRow: 0,
      rows: [],
      rowNumbers: [],
      errors: [{ row: 0, message: "El archivo excede 5 MB." }],
      validRows: 0,
    };
  }
  const records = recordsFromCsv(text, errors);
  const headerRecord = records[0];
  if (!headerRecord)
    return {
      headers: [],
      headerRow: 0,
      rows: [],
      rowNumbers: [],
      errors: [...errors, { row: 0, message: "El archivo está vacío." }],
      validRows: 0,
    };
  const headers = headerRecord.cells.map((header) => header.trim().toLowerCase());
  const duplicates = headers.filter((header, index) => headers.indexOf(header) !== index);
  if (duplicates.length)
    errors.push({
      row: headerRecord.row,
      message: `Columnas duplicadas: ${[...new Set(duplicates)].join(", ")}.`,
    });
  const missing = CSV_REQUIRED_COLUMNS.filter((column) => !headers.includes(column));
  if (missing.length)
    errors.push({
      row: headerRecord.row,
      message: `Faltan columnas requeridas: ${missing.join(", ")}.`,
    });
  const unknown = headers.filter(
    (column) => !CSV_COLUMNS.includes(column as (typeof CSV_COLUMNS)[number]),
  );
  if (unknown.length)
    errors.push({
      row: headerRecord.row,
      message: `Columnas no reconocidas: ${unknown.join(", ")}.`,
    });
  const rows: CsvRow[] = [];
  const rowNumbers: number[] = [];
  let validRows = 0;
  for (const record of records.slice(1)) {
    const startErrorCount = errors.length;
    if (record.cells.length !== headers.length)
      errors.push({
        row: record.row,
        message: `Se esperaban ${headers.length} columnas y hay ${record.cells.length}.`,
      });
    const row: CsvRow = {};
    headers.forEach((header, index) => {
      row[header] = record.cells[index] ?? "";
    });
    rows.push(row);
    rowNumbers.push(record.row);
    const plant = row["plantcode"] ?? "";
    const shift = row["shiftcode"] ?? "";
    if (!/^[A-Za-z0-9_-]{1,50}$/.test(plant))
      errors.push({ row: record.row, message: "plantCode no es válido." });
    if (!["A", "B", "C"].includes(shift))
      errors.push({ row: record.row, message: "shiftCode debe ser A, B o C." });
    const timestamp = row["timestamp"] ?? "";
    if (Number.isNaN(Date.parse(timestamp)) || !/^\d{4}-\d{2}-\d{2}T/.test(timestamp))
      errors.push({ row: record.row, message: "timestamp debe ser una fecha ISO 8601." });
    for (const column of [...CSV_REQUIRED_COLUMNS, ...CSV_OPTIONAL_COLUMNS]) {
      if (column === "plantcode" || column === "shiftcode" || column === "timestamp") continue;
      const raw = row[column] ?? "";
      if (raw.trim() === "" && (CSV_OPTIONAL_COLUMNS as readonly string[]).includes(column))
        continue;
      const value = Number(raw);
      const range = RANGES[column];
      if (!raw.trim() || !Number.isFinite(value))
        errors.push({ row: record.row, message: `${column} requiere un número válido.` });
      else if (range && (value < range[0] || value > range[1]))
        errors.push({
          row: record.row,
          message: `${column} fuera de rango (${range[0]}–${range[1]}).`,
        });
    }
    if (errors.length === startErrorCount) validRows++;
  }
  if (records.length === 1)
    errors.push({ row: 0, message: "El archivo no contiene filas de telemetría." });
  return { headers, headerRow: headerRecord.row, rows, rowNumbers, errors, validRows };
}

function escapeCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: string[], rows: (string | number)[][]) {
  return [headers, ...rows].map((row) => row.map(escapeCell).join(",")).join("\n");
}

export const CSV_TEMPLATE = toCsv(
  [
    "plantCode",
    "shiftCode",
    "timestamp",
    "inflowRateM3h",
    "inflowTurbidityNtu",
    "inflowDqoMgL",
    "inflowPh",
    "pacDosePpm",
    "effluentTurbidityNtu",
    "effluentDqoMgL",
    "effluentPh",
    "inflowTemperatureC",
    "pacPumpFrequencyHz",
    "mbrDissolvedOxygenMgL",
    "blowerFrequencyHz",
    "effluentSstMgL",
  ],
  [],
);

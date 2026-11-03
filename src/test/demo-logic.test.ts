import { describe, it, expect } from "vitest";
import { validateDose } from "@/lib/dose-validation";
import { parseCsv, CSV_TEMPLATE } from "@/lib/csv";

describe("configured dose safeguard (18–22 ppm)", () => {
  it("accepts 18 and 22", () => {
    expect(validateDose(18).ok).toBe(true);
    expect(validateDose(22).ok).toBe(true);
  });
  it("rejects 17 and 23", () => {
    expect(validateDose(17).ok).toBe(false);
    expect(validateDose(23).ok).toBe(false);
  });
  it("rejects when quality exceeds limits", () => {
    expect(validateDose(20, false).ok).toBe(false);
  });
});

describe("CSV validation", () => {
  const values = "PL_NORTE,B,2026-01-01T12:00:00Z,120,80,300,7.2,20,2,45,7.1,,,,,";
  it("accepts a complete telemetry snapshot row", () => {
    const result = parseCsv(`${CSV_TEMPLATE}\n${values}`);
    expect(result.errors).toEqual([]);
    expect(result.validRows).toBe(1);
  });
  it("reports missing snapshot columns", () => {
    expect(parseCsv("plantCode,shiftCode\nPL_NORTE,B").errors[0]?.message).toMatch(
      /Faltan columnas/,
    );
  });
  it("rejects out-of-range and non-numeric telemetry fields", () => {
    const result = parseCsv(
      `${CSV_TEMPLATE}\nPL_NORTE,B,2026-01-01T12:00:00Z,120,80,300,15,20,2,abc,7.1,,,,,`,
    );
    expect(result.errors.map((issue) => issue.row)).toEqual([2, 2]);
    expect(result.validRows).toBe(0);
  });
  it("supports quoted numeric values and escaped quotes", () => {
    expect(parseCsv(`${CSV_TEMPLATE}\n${values.replace(",20,", ',"20",')}`).validRows).toBe(1);
    const escaped = parseCsv(`${CSV_TEMPLATE}\n${values.replace("PL_NORTE", '"PL_NORTE""x"')}`);
    expect(escaped.rows).toHaveLength(1);
    expect(escaped.errors.some((issue) => issue.message.includes("plantCode"))).toBe(true);
  });
});

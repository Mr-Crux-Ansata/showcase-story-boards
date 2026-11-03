import { describe, expect, it } from "vitest";
import { handleOperationsApi } from "@/server/api/operations";
import { handleAiOptimizeRequest } from "@/server/api/ai-optimize";
import { handleCsvIngestionRequest } from "@/server/api/csv-ingestion";

describe("operational API validation", () => {
  it("rejects invalid pagination before accessing SQL Server", async () => {
    const response = await handleOperationsApi(new Request("http://localhost/api/alerts?limit=0"));
    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toMatchObject({
      error: expect.stringContaining("Invalid"),
    });
  });

  it("rejects invalid handover payloads before accessing SQL Server", async () => {
    const response = await handleOperationsApi(
      new Request("http://localhost/api/shift-handovers", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost" },
        body: JSON.stringify({ shiftCode: "Z" }),
      }),
    );
    expect(response?.status).toBe(400);
    await expect(response?.json()).resolves.toMatchObject({ error: "Invalid handover payload." });
  });

  it("rejects methods that do not match read-only endpoints", async () => {
    const response = await handleOperationsApi(
      new Request("http://localhost/api/operations-log", { method: "POST" }),
    );
    expect(response?.status).toBe(405);
  });

  it("does not calculate an AI recommendation without complete real process conditions", async () => {
    const response = await handleAiOptimizeRequest(
      new Request("http://localhost/api/ai/optimize", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://localhost" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("telemetry"),
    });
  });

  it("rejects CSV requests with the wrong content type", async () => {
    const response = await handleCsvIngestionRequest(
      new Request("http://localhost/api/telemetry/import-csv", {
        method: "POST",
        headers: { Origin: "http://localhost", "Content-Type": "application/json" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(415);
  });

  it("rejects malformed CSV headers before attempting persistence", async () => {
    const response = await handleCsvIngestionRequest(
      new Request("http://localhost/api/telemetry/import-csv", {
        method: "POST",
        headers: { Origin: "http://localhost", "Content-Type": "text/csv" },
        body: "plantCode,shiftCode\nPL_NORTE,B",
      }),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ persisted: false, accepted: 0 });
  });
});

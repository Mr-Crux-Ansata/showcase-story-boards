import { describe, expect, it } from "vitest";
import { aiEngine } from "@/server/ai/surrogate-model";
import type { InflowConditions } from "@/lib/types/telemetry";

const sample: InflowConditions = {
  inflowRateM3h: 142.8,
  inflowTurbidityNtu: 1.85,
  inflowDqoMgL: 48.2,
  inflowPh: 7.42,
  currentDosePpm: 28,
};

describe("surrogate recommendation contract", () => {
  it("uses the prediction at the recommended dose as its source of truth", () => {
    const result = aiEngine.optimize(sample);
    expect(result.prediction).toEqual(aiEngine.predictQuality(sample, result.recommendedDosePpm));
    expect(
      result.doseSensitivityCurve.filter((point) => point.isOptimal).map((point) => point.dosePpm),
    ).toEqual([result.recommendedDosePpm]);
  });

  it("flags out of distribution inputs without fabricating an alternate prediction", () => {
    const stress = { ...sample, inflowPh: 10 };
    const result = aiEngine.optimize(stress);
    expect(result.safetySafeguards.outOfDistributionWarning).toBe(true);
    expect(result.prediction).toEqual(aiEngine.predictQuality(stress, result.recommendedDosePpm));
  });
});

export const SAFE_DOSE_MIN = 18;
export const SAFE_DOSE_MAX = 22;

export type DoseCheck = { ok: true } | { ok: false; reason: string };

export function validateDose(ppm: number, qualityWithinLimits = true): DoseCheck {
  if (!Number.isFinite(ppm)) return { ok: false, reason: "Dosis no válida." };
  if (ppm < SAFE_DOSE_MIN || ppm > SAFE_DOSE_MAX) {
    return {
      ok: false,
      reason: `La dosis ${ppm} ppm está fuera del rango permitido (${SAFE_DOSE_MIN}–${SAFE_DOSE_MAX} ppm).`,
    };
  }
  if (!qualityWithinLimits)
    return { ok: false, reason: "La calidad proyectada supera los límites NOM-001." };
  return { ok: true };
}

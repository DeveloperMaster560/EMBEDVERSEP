/**
 * Línea base SHM (diseño técnico §11.1).
 *
 * Reglas del diseño que se aplican aquí:
 *  - solo cuentan ventanas sin problemas de calidad (E1);
 *  - no se mezclan ventanas con distinta configuración (tasa, rango, filtro, firmware);
 *  - la referencia es POR RÉGIMEN ambiental/operacional (p. ej. banda de temperatura);
 *  - se valida con un periodo retenido independiente.
 *
 * Esto calcula estadísticas de amplitud (RMS, pico, percentiles). La
 * identificación modal (OMA, frecuencias, amortiguamiento) NO está aquí.
 */

import { type AccelWindow, assessQuality, type QualityLimits, DEFAULT_QUALITY_LIMITS } from './events';

export interface WindowStats {
  rms: number;
  peak: number;
  p95: number;
}

/** Estadísticas de un eje, ignorando huecos. `null` si no hay muestras. */
export function axisStats(data: (number | null)[]): WindowStats | null {
  const v = data.filter((x): x is number => x !== null);
  if (!v.length) return null;
  const mean = v.reduce((a, b) => a + b, 0) / v.length;
  // Se quita la media: la gravedad y el offset no son vibración.
  const centered = v.map((x) => x - mean);
  const rms = Math.sqrt(centered.reduce((a, b) => a + b * b, 0) / v.length);
  const abs = centered.map(Math.abs).sort((a, b) => a - b);
  const p95 = abs[Math.min(abs.length - 1, Math.floor(0.95 * (abs.length - 1)))];
  return { rms, peak: abs[abs.length - 1], p95 };
}

function configKey(w: AccelWindow): string {
  const c = w.config;
  return `${c.sampleRateHz}|${c.rangeG}|${c.filterId}|${c.firmwareVersion}`;
}

export interface RegimeBaseline {
  regime: string;
  windows: number;
  /** Media y desviación típica del RMS vertical por ventana. */
  rmsMean: number;
  rmsStd: number;
}

export interface Baseline {
  stationId: string;
  configKey: string;
  regimes: RegimeBaseline[];
  excludedForQuality: number;
}

export class BaselineError extends Error {}

export function buildBaseline(
  windows: AccelWindow[],
  regimeOf: (w: AccelWindow) => string,
  limits: QualityLimits = DEFAULT_QUALITY_LIMITS,
): Baseline {
  if (!windows.length) throw new BaselineError('No hay ventanas.');
  const station = new Set(windows.map((w) => w.stationId));
  if (station.size !== 1) throw new BaselineError('La línea base es por estación: hay ventanas de varias.');
  const keys = new Set(windows.map(configKey));
  if (keys.size !== 1) {
    throw new BaselineError('Hay ventanas con distinta configuración de adquisición; no se mezclan (§11.1).');
  }

  let excluded = 0;
  const byRegime = new Map<string, number[]>();
  for (const w of windows) {
    if (assessQuality(w, limits).level === 'E1') {
      excluded++;
      continue;
    }
    const s = axisStats(w.axes.z);
    if (!s) continue;
    const r = regimeOf(w);
    byRegime.set(r, [...(byRegime.get(r) ?? []), s.rms]);
  }

  const regimes: RegimeBaseline[] = [...byRegime.entries()].map(([regime, rms]) => {
    const mean = rms.reduce((a, b) => a + b, 0) / rms.length;
    const variance = rms.length > 1 ? rms.reduce((a, b) => a + (b - mean) ** 2, 0) / (rms.length - 1) : 0;
    return { regime, windows: rms.length, rmsMean: mean, rmsStd: Math.sqrt(variance) };
  });
  return { stationId: [...station][0], configKey: [...keys][0], regimes, excludedForQuality: excluded };
}

/** Desviación de una ventana, en sigmas, respecto a su régimen. `null` si no es comparable. */
export function deviationSigma(b: Baseline, w: AccelWindow, regime: string): number | null {
  if (w.stationId !== b.stationId || configKey(w) !== b.configKey) return null;
  const r = b.regimes.find((x) => x.regime === regime);
  const s = axisStats(w.axes.z);
  if (!r || !s || r.rmsStd === 0 || r.windows < 2) return null;
  return (s.rms - r.rmsMean) / r.rmsStd;
}

/**
 * Validación con periodo retenido (§11.1, paso 5): fracción de ventanas del
 * periodo independiente que caen dentro de ±k sigmas de su régimen.
 */
export function validateHoldout(b: Baseline, holdout: AccelWindow[], regimeOf: (w: AccelWindow) => string, k: number): {
  compared: number; within: number; fraction: number | null;
} {
  let compared = 0;
  let within = 0;
  for (const w of holdout) {
    const d = deviationSigma(b, w, regimeOf(w));
    if (d === null) continue;
    compared++;
    if (Math.abs(d) <= k) within++;
  }
  return { compared, within, fraction: compared ? within / compared : null };
}

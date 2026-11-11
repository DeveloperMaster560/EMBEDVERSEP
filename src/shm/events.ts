/**
 * Clasificación de eventos SHM (diseño técnico §11.2 y §13).
 *
 * Dos mitades, deliberadamente separadas:
 *
 *  1. CALIDAD DE MEDICIÓN (E1). Sus reglas no dependen del puente: un sensor
 *     saturado, un hueco o un CRC malo lo son en cualquier estructura. Se
 *     evalúan siempre.
 *
 *  2. EVENTOS ESTRUCTURALES (E0, E3, E4). Dependen de umbrales que el diseño
 *     NO fija: salen de la línea base, del análisis modal, del criterio del
 *     propietario y de un ingeniero estructural. Mientras no haya una
 *     configuración APROBADA (quién, cuándo, con qué documento), el
 *     clasificador se niega a emitirlos. Nunca hay un valor por defecto.
 *
 * E2 (operacional) exige correlacionar con tráfico, temperatura u obra; eso lo
 * hace una persona con contexto y aquí no se automatiza.
 *
 * Ningún resultado dice «daño» ni «puente inseguro», y E4 recomienda escalar al
 * responsable del activo: el sistema no decide cierres (§11.2).
 */

import type { StationState } from './data-contract';

export const G = 9.80665;

/* ------------------------------------------------------------------------ */
/* Ventana de datos                                                         */
/* ------------------------------------------------------------------------ */

export interface AccelWindow {
  stationId: string;
  /** Configuración de adquisición: ventanas con distinta configuración no se mezclan (§11.1). */
  config: { sampleRateHz: number; rangeG: number | null; filterId: string; firmwareVersion: string };
  /** Muestras por eje en m/s². Un hueco es `null`, nunca 0. */
  axes: { x: (number | null)[]; y: (number | null)[]; z: (number | null)[] };
  durationS: number;
  timeQuality: 'GNSS_LOCKED' | 'HOLDOVER' | 'INVALID';
  ppsLocked: boolean;
  sensorOk: boolean;
  storageOk: boolean;
  /** CRC declarado por la estación y el recalculado sobre el archivo. */
  crcDeclared: string;
  crcComputed: string;
  /** Temperatura interna del sensor, si la hay. */
  sensorTempC: number | null;
  supplyV: number | null;
}

/** Límites de la estación que NO son umbrales estructurales: los da el hardware. */
export interface QualityLimits {
  /** Rango de temperatura de funcionamiento del sensor, de su hoja de datos. */
  sensorTempRangeC: { min: number; max: number } | null;
  /** Tensión mínima de funcionamiento de la fuente de la estación. */
  minSupplyV: number | null;
  /**
   * Fracción del fondo de escala a partir de la cual se considera saturado.
   * 0,999 es una tolerancia numérica para «en el fondo de escala», no un umbral
   * estructural; con el código crudo del ADC se compararía con el código máximo.
   */
  saturationFraction: number;
  /** Tolerancia de la tasa real de muestreo: ±0,1 % según la aceptación (§13). */
  rateTolerance: number;
}

export const DEFAULT_QUALITY_LIMITS: QualityLimits = {
  sensorTempRangeC: null, // pendiente de la hoja de datos del ADXL355
  minSupplyV: null, // pendiente del diseño de la fuente
  saturationFraction: 0.999,
  rateTolerance: 0.001,
};

export interface QualityFinding {
  state: StationState;
  detail: string;
}

export interface QualityResult {
  /** E1 si hay algún problema de calidad; `null` si la ventana es utilizable. */
  level: 'E1' | null;
  findings: QualityFinding[];
  /** Reglas que no se pudieron evaluar porque falta un dato del hardware. */
  notEvaluated: string[];
}

export function assessQuality(w: AccelWindow, limits: QualityLimits = DEFAULT_QUALITY_LIMITS): QualityResult {
  const findings: QualityFinding[] = [];
  const notEvaluated: string[] = [];

  if (!w.sensorOk) findings.push({ state: 'SENSOR_FAULT', detail: 'El autodiagnóstico del sensor falla.' });
  if (!w.storageOk) findings.push({ state: 'STORAGE_FAULT', detail: 'El almacenamiento local informa error.' });
  if (w.crcDeclared.toLowerCase() !== w.crcComputed.toLowerCase()) {
    findings.push({ state: 'STORAGE_FAULT', detail: `CRC no coincide (${w.crcDeclared} declarado, ${w.crcComputed} calculado): archivo corrupto.` });
  }

  if (w.timeQuality === 'INVALID') {
    findings.push({ state: 'TIME_INVALID', detail: 'Sin referencia de tiempo válida: la fase entre estaciones no es utilizable.' });
  } else if (w.timeQuality === 'HOLDOVER' || !w.ppsLocked) {
    findings.push({ state: 'TIME_HOLDOVER', detail: 'Sin PPS: reloj en holdover, la fase entre estaciones no se presenta como sincronizada (§10).' });
  }

  const n = { x: w.axes.x.length, y: w.axes.y.length, z: w.axes.z.length };
  const expected = w.config.sampleRateHz * w.durationS;
  for (const [axis, count] of Object.entries(n)) {
    if (Math.abs(count - expected) > expected * limits.rateTolerance) {
      findings.push({ state: 'DATA_GAP', detail: `Eje ${axis}: ${count} muestras, se esperaban ${expected} (±${limits.rateTolerance * 100} %).` });
    }
  }
  for (const [axis, data] of Object.entries(w.axes)) {
    const gaps = data.filter((v) => v === null).length;
    if (gaps > 0) findings.push({ state: 'DATA_GAP', detail: `Eje ${axis}: ${gaps} muestras faltantes.` });
  }

  if (w.config.rangeG === null) {
    notEvaluated.push('Saturación: el rango del acelerómetro no está configurado.');
  } else {
    const limit = w.config.rangeG * G * limits.saturationFraction;
    for (const [axis, data] of Object.entries(w.axes)) {
      const sat = data.filter((v) => v !== null && Math.abs(v) >= limit).length;
      if (sat > 0) findings.push({ state: 'SATURATED', detail: `Eje ${axis}: ${sat} muestras en el fondo de escala (±${w.config.rangeG} g).` });
    }
  }

  if (limits.sensorTempRangeC === null) {
    notEvaluated.push('Temperatura del sensor: falta su rango de funcionamiento (hoja de datos).');
  } else if (w.sensorTempC !== null
    && (w.sensorTempC < limits.sensorTempRangeC.min || w.sensorTempC > limits.sensorTempRangeC.max)) {
    findings.push({ state: 'SENSOR_FAULT', detail: `Temperatura del sensor ${w.sensorTempC} °C fuera de rango.` });
  }

  if (limits.minSupplyV === null) {
    notEvaluated.push('Alimentación baja: falta la tensión mínima de la fuente.');
  } else if (w.supplyV !== null && w.supplyV < limits.minSupplyV) {
    findings.push({ state: 'POWER_LOW', detail: `Alimentación ${w.supplyV} V por debajo de ${limits.minSupplyV} V.` });
  }

  return { level: findings.length ? 'E1' : null, findings, notEvaluated };
}

/* ------------------------------------------------------------------------ */
/* Umbrales estructurales: solo con aprobación                              */
/* ------------------------------------------------------------------------ */

export interface ThresholdApproval {
  /** Nombre y matrícula profesional de quien firma. */
  approvedBy: string;
  approvedOn: string;
  /** Documento que justifica los valores (informe de línea base, análisis modal…). */
  document: string;
  /** Referencia a la línea base de la que salen. */
  baselineId: string;
}

export interface StructuralThresholds {
  /** Pico de aceleración que marca un transitorio E0, en m/s². */
  transientPeakMs2: number;
  /** Desviación persistente, en desviaciones típicas de la línea base, para E3. */
  persistentSigma: number;
  /** Ventanas consecutivas que debe durar la desviación para ser persistente. */
  persistentWindows: number;
  /** Estaciones independientes que deben coincidir para E3. */
  minIndependentStations: number;
  /** Indicadores coherentes para escalar a E4. */
  e4MinIndicators: number;
}

export interface ThresholdConfig {
  values: StructuralThresholds | null;
  approval: ThresholdApproval | null;
}

/** Así sale de fábrica: sin valores y sin aprobación. */
export const UNAPPROVED: ThresholdConfig = { values: null, approval: null };

export function thresholdsUsable(cfg: ThresholdConfig): { ok: boolean; reason: string } {
  if (!cfg.values) return { ok: false, reason: 'No hay umbrales estructurales: el diseño no fija ninguno universal (§11.2).' };
  const a = cfg.approval;
  if (!a || !a.approvedBy.trim() || !a.approvedOn.trim() || !a.document.trim() || !a.baselineId.trim()) {
    return { ok: false, reason: 'Los umbrales no están aprobados: falta quién firma, cuándo, el documento o la línea base de la que salen.' };
  }
  const v = cfg.values;
  if (!(v.transientPeakMs2 > 0) || !(v.persistentSigma > 0) || v.persistentWindows < 2
    || v.minIndependentStations < 2 || v.e4MinIndicators <= v.minIndependentStations) {
    return { ok: false, reason: 'Umbrales incoherentes: E3 exige persistencia (≥2 ventanas) y ≥2 estaciones independientes; E4 exige más indicadores que E3 (§11.2).' };
  }
  return { ok: true, reason: '' };
}

/** Desviación de una estación respecto a su línea base, por ventana, en sigmas. */
export interface StationDeviation {
  stationId: string;
  /** Una entrada por ventana consecutiva; `null` si la ventana fue E1 y no cuenta. */
  sigmas: (number | null)[];
  peakMs2: number;
}

export type EventLevel = 'E0' | 'E1' | 'E3' | 'E4';

export interface EventDecision {
  level: EventLevel | null;
  /** Cuando el clasificador se niega a decidir, aquí está el porqué. */
  blocked: string | null;
  stations: string[];
  /** Texto para el operador. Nunca diagnostica: recomienda revisar o escalar. */
  message: string;
}

export function classifyStructural(devs: StationDeviation[], cfg: ThresholdConfig): EventDecision {
  const usable = thresholdsUsable(cfg);
  if (!usable.ok) {
    return { level: null, blocked: usable.reason, stations: [], message: 'Sin clasificación estructural.' };
  }
  const v = cfg.values!;

  const persistent = devs.filter((d) => {
    const tail = d.sigmas.slice(-v.persistentWindows);
    return tail.length === v.persistentWindows && tail.every((s) => s !== null && Math.abs(s) >= v.persistentSigma);
  });

  if (persistent.length >= v.minIndependentStations) {
    const ids = persistent.map((d) => d.stationId);
    if (persistent.length >= v.e4MinIndicators) {
      return {
        level: 'E4', blocked: null, stations: ids,
        message: 'Varios indicadores persistentes y coherentes. Escalar al responsable del activo para inspección prioritaria. El sistema no decide el cierre del puente.',
      };
    }
    return {
      level: 'E3', blocked: null, stations: ids,
      message: 'Cambio persistente confirmado por estaciones independientes. Requiere revisión técnica y recomendación de inspección.',
    };
  }

  const transients = devs.filter((d) => d.peakMs2 >= v.transientPeakMs2).map((d) => d.stationId);
  if (transients.length) {
    return {
      level: 'E0', blocked: null, stations: transients,
      message: 'Transitorio: conservar la forma de onda y correlacionar con tráfico, viento o sismo conocidos. Un pico aislado no indica daño.',
    };
  }
  // Una sola estación persistente no basta para E3: se informa, no se escala.
  const lone = persistent.map((d) => d.stationId);
  return {
    level: null, blocked: null, stations: lone,
    message: lone.length
      ? 'Desviación persistente en una sola estación: sin confirmación independiente no es E3. Revisar calidad e instalación.'
      : 'Sin eventos.',
  };
}

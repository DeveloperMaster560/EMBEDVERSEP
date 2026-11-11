/**
 * Contrato de datos de la estación SHM (interfaces_y_conexiones.md §6–§8).
 *
 * Valida un registro de metadatos/estadísticas tal como lo entregaría una
 * estación. Las reglas que el documento hace explícitas se aplican aquí:
 *
 *  - los estados son una lista cerrada (§7);
 *  - un hueco se etiqueta, nunca se rellena con cero (§6);
 *  - la hora de recepción es un campo distinto de la de muestreo (§8);
 *  - el firmware no etiqueta un pico como daño (§7).
 */

export const STATION_STATES = [
  'NORMAL', 'DATA_GAP', 'SENSOR_FAULT', 'SATURATED', 'TIME_HOLDOVER',
  'TIME_INVALID', 'STORAGE_FAULT', 'POWER_LOW', 'COMM_LOST', 'EVENT_CAPTURE',
] as const;
export type StationState = (typeof STATION_STATES)[number];

/** Niveles de evento del diseño técnico §11.2. Los asigna la plataforma, no el firmware. */
export const EVENT_LEVELS = {
  E0: 'Transitorio',
  E1: 'Calidad de medición (no es anomalía estructural)',
  E2: 'Operacional',
  E3: 'Anomalía estructural potencial: revisión técnica',
  E4: 'Prioridad de inspección: escalar al responsable del activo',
} as const;

/**
 * GNSS_LOCKED (§6) y HOLDOVER (diseño §10) vienen del documento. INVALID NO:
 * se añade por correspondencia con el estado TIME_INVALID, y queda por
 * confirmar con ingeniería.
 */
export const TIME_QUALITIES = ['GNSS_LOCKED', 'HOLDOVER', 'INVALID'] as const;

export interface StationRecord {
  schema_version: string;
  station_id: string;
  sensor_id: string;
  timestamp_utc: string;
  time_quality: string;
  time_uncertainty_us: number | null;
  sample_rate_hz: number;
  axes: string[];
  units: string;
  range_g: number | null;
  filter_id: string;
  firmware_version: string;
  calibration_id: string | null;
  samples_file: string;
  samples_crc32: string;
  states?: string[];
  received_utc?: string;
  health: { sensor_ok: boolean; storage_ok: boolean; pps_locked: boolean; supply_v: number | null };
  [extra: string]: unknown;
}

const REQUIRED = [
  'schema_version', 'station_id', 'sensor_id', 'timestamp_utc', 'time_quality',
  'sample_rate_hz', 'axes', 'units', 'filter_id', 'firmware_version',
  'samples_file', 'samples_crc32', 'health',
] as const;

/** Palabras que el firmware no debe emitir como diagnóstico (§7). */
const DIAGNOSTIC_WORDS = /\b(dano|danio|daño|damage|inseguro|unsafe|colapso|collapse)\b/i;

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export function validateStationRecord(input: unknown): string[] {
  const problems: string[] = [];
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return ['El registro no es un objeto JSON.'];
  }
  const r = input as Record<string, unknown>;

  for (const key of REQUIRED) {
    if (r[key] === undefined || r[key] === null || r[key] === '') {
      problems.push(`Falta el campo obligatorio «${key}».`);
    }
  }

  if (typeof r.timestamp_utc === 'string' && !RFC3339.test(r.timestamp_utc)) {
    problems.push('«timestamp_utc» no está en RFC 3339.');
  }
  if (r.received_utc !== undefined) {
    if (typeof r.received_utc !== 'string' || !RFC3339.test(r.received_utc)) {
      problems.push('«received_utc» no está en RFC 3339.');
    } else if (r.received_utc === r.timestamp_utc) {
      // No es imposible, pero casi siempre delata que se sobrescribió la hora.
      problems.push('La hora de recepción coincide exactamente con la de muestreo: la retransmisión no debe cambiar la marca original (§8).');
    }
  }

  if (typeof r.time_quality === 'string' && !(TIME_QUALITIES as readonly string[]).includes(r.time_quality)) {
    problems.push(`«time_quality» desconocida: ${r.time_quality}.`);
  }
  const health = r.health as Record<string, unknown> | undefined;
  if (r.time_quality === 'GNSS_LOCKED' && health && health.pps_locked === false) {
    problems.push('Se declara GNSS_LOCKED con el PPS sin enganchar.');
  }

  if (typeof r.sample_rate_hz !== 'number' || !(r.sample_rate_hz > 0)) {
    problems.push('«sample_rate_hz» debe ser un número positivo.');
  }
  if (Array.isArray(r.axes) && r.axes.length !== 3) {
    problems.push('El registro crudo exige tres ejes sincronizados (§8).');
  }
  if (typeof r.samples_crc32 === 'string' && !/^[0-9a-f]{8}$/i.test(r.samples_crc32)) {
    problems.push('«samples_crc32» debe ser un CRC-32 en hexadecimal (8 cifras).');
  }

  if (r.states !== undefined) {
    if (!Array.isArray(r.states)) {
      problems.push('«states» debe ser una lista.');
    } else {
      for (const s of r.states) {
        if (!(STATION_STATES as readonly string[]).includes(String(s))) {
          problems.push(`Estado desconocido: ${String(s)}.`);
        }
      }
      if (r.states.includes('NORMAL') && r.states.length > 1) {
        problems.push('NORMAL no puede convivir con otro estado.');
      }
    }
  }

  const text = JSON.stringify(r);
  if (DIAGNOSTIC_WORDS.test(text)) {
    problems.push('El registro contiene un diagnóstico estructural; el firmware no etiqueta daño ni seguridad (§7).');
  }
  return problems;
}

/**
 * Un bloque de muestras con huecos: los huecos son `null` y se marcan como
 * DATA_GAP. Devuelve los problemas si alguien rellenó con ceros.
 */
export function checkGapHandling(samples: (number | null)[], declaredGaps: number[]): string[] {
  const problems: string[] = [];
  for (const i of declaredGaps) {
    if (samples[i] === 0) problems.push(`La muestra ${i} es un hueco declarado y vale 0: los huecos no se rellenan con cero (§6).`);
    else if (samples[i] !== null) problems.push(`La muestra ${i} es un hueco declarado pero tiene valor.`);
  }
  return problems;
}

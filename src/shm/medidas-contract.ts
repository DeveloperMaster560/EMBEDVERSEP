/**
 * Contrato de MEDIDAS (sensores lentos de un valor: temperatura, humedad, luz,
 * humedad de suelo, distancia, gases…). Tópico shm/v1/<estación>/medida.
 *
 * Gemelo de plataforma/servicios/shm_plataforma/contrato_medidas.py; los dos
 * se prueban contra plataforma/contrato/casos-medidas.json y leen el mismo
 * catálogo de magnitudes (magnitudes.json). Las reglas, en el .py.
 */
import catalogo from '../../plataforma/servicios/shm_plataforma/magnitudes.json' with { type: 'json' };
import { DIAGNOSTIC_WORDS, RFC3339, TIME_QUALITIES } from './data-contract';

export interface Magnitud {
  unidades: string[];
  vectorial: boolean;
  min: number | null;
  max: number | null;
  ejemplos: string;
}

export const MAGNITUDES: Readonly<Record<string, Magnitud>> = (catalogo as { magnitudes: Record<string, Magnitud> }).magnitudes;

export interface Medida {
  sensor_id: string;
  quantity: string;
  value: number | null;
  unit: string;
  error?: string;
}

export interface MensajeMedidas {
  schema_version: '1.0';
  station_id: string;
  timestamp_utc: string;
  time_quality: (typeof TIME_QUALITIES)[number];
  firmware_version: string;
  measurements: Medida[];
}

const SCHEMA_VERSIONS = ['1.0'];
const STATION_ID = /^[A-Z0-9][A-Z0-9-]{1,31}$/;
const SENSOR_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/;
export const MAX_MEDIDAS = 64;
const CENTINELAS = new Set([-999, -9999, -99999, 9999, 99999]);
const REQUIRED = ['schema_version', 'station_id', 'timestamp_utc', 'time_quality', 'firmware_version', 'measurements'] as const;

const esNumero = (v: unknown): v is number => typeof v === 'number';

export function validateMeasurementMessage(input: unknown): string[] {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return ['El mensaje no es un objeto JSON.'];
  const r = input as Record<string, unknown>;
  const p: string[] = [];
  for (const k of REQUIRED) {
    if (!(k in r) || r[k] === null || r[k] === '') p.push(`Falta el campo obligatorio «${k}».`);
  }
  const sv = r.schema_version;
  if (typeof sv === 'string' && sv && !SCHEMA_VERSIONS.includes(sv)) p.push(`Versión de esquema no admitida: ${sv}.`);
  const sid = r.station_id;
  if (typeof sid === 'string' && sid && !STATION_ID.test(sid)) {
    p.push('«station_id» solo admite mayúsculas, cifras y guiones (2–32 caracteres).');
  }
  if (typeof r.timestamp_utc === 'string' && !RFC3339.test(r.timestamp_utc)) p.push('«timestamp_utc» no está en RFC 3339.');
  const tq = r.time_quality;
  if (typeof tq === 'string' && !(TIME_QUALITIES as readonly string[]).includes(tq)) p.push(`«time_quality» desconocida: ${tq}.`);

  const ms = r.measurements;
  if ('measurements' in r && !Array.isArray(ms)) {
    p.push('«measurements» debe ser una lista.');
  } else if (Array.isArray(ms)) {
    if (ms.length === 0) p.push('«measurements» está vacía.');
    if (ms.length > MAX_MEDIDAS) p.push(`Demasiadas medidas en un mensaje (${ms.length}; máximo ${MAX_MEDIDAS}).`);
    const vistos = new Set<string>();
    ms.slice(0, MAX_MEDIDAS).forEach((m, i) => p.push(...medida(i, m, vistos)));
  }
  if (DIAGNOSTIC_WORDS.test(JSON.stringify(r))) p.push('El mensaje contiene un diagnóstico; el equipo mide, no diagnostica.');
  return p;
}

function medida(i: number, input: unknown, vistos: Set<string>): string[] {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return [`measurements[${i}] no es un objeto.`];
  const m = input as Record<string, unknown>;
  const p: string[] = [];
  const sid = m.sensor_id;
  const donde = `measurements[${i}]` + (typeof sid === 'string' ? ` (${sid})` : '');
  if (typeof sid !== 'string' || !SENSOR_ID.test(sid)) p.push(`${donde}: «sensor_id» no válido.`);
  else if (vistos.has(sid)) p.push(`${donde}: el sensor aparece dos veces en el mismo mensaje.`);
  else vistos.add(sid);

  const q = m.quantity;
  const u = m.unit;
  const mag = typeof q === 'string' && Object.hasOwn(MAGNITUDES, q) ? MAGNITUDES[q] : undefined;
  if (!mag) p.push(`${donde}: magnitud desconocida «${String(q)}».`);
  else if (mag.vectorial) p.push(`${donde}: ${String(q)} se mide en varios ejes y viaja en ventanas (tópico registro), no como medida suelta.`);
  else if (typeof u !== 'string' || !mag.unidades.includes(u)) {
    p.push(`${donde}: la unidad de ${String(q)} debe ser una de ${mag.unidades.join(', ')} (llegó «${String(u)}»).`);
  }
  if (!('value' in m)) {
    p.push(`${donde}: falta «value» (null si el sensor no leyó).`);
    return p;
  }
  const v = m.value;
  if (v === null) return p;
  if (!esNumero(v) || !Number.isFinite(v)) {
    p.push(`${donde}: «value» debe ser un número o null.`);
    return p;
  }
  if (CENTINELAS.has(v)) {
    p.push(`${donde}: ${v} parece un valor de «sin lectura»; envíe null.`);
  } else if (mag && !mag.vectorial) {
    if (mag.min !== null && v < mag.min) p.push(`${donde}: ${v} ${String(u)} es físicamente imposible (mínimo ${mag.min}).`);
    if (mag.max !== null && v > mag.max) p.push(`${donde}: ${v} ${String(u)} es físicamente imposible (máximo ${mag.max}).`);
  }
  return p;
}

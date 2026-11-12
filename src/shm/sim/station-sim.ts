/**
 * Gemelo funcional de las estaciones SHM de La Novena.
 *
 * QUÉ ES: un modelo, en TypeScript, del comportamiento que el diseño exige al
 * firmware de cada estación dinámica (SD): muestrear tres ejes a 200 Hz,
 * cerrar ventanas, calcular CRC-32, guardar en la microSD, mandar el registro
 * por Ethernet o encolarlo si el enlace cae, y marcar los estados de calidad.
 * Cada ventana pasa por el mismo contrato de datos (`data-contract.ts`), las
 * mismas reglas E1 (`events.ts`) y la misma clasificación estructural que
 * usaría la plataforma con datos reales.
 *
 * QUÉ NO ES:
 *  - No ejecuta código del STM32H743 (el motor solo emula ATmega328P y el
 *    firmware no está escrito).
 *  - La vibración es SINTÉTICA. La frecuencia, el amortiguamiento, el ruido y
 *    la respuesta a los vehículos son valores de un escenario de prueba, no
 *    propiedades del viaducto: no hay análisis modal ni medición. Sirve para
 *    probar la cadena de datos, no para sacar conclusiones del puente.
 *
 * Es determinista: misma semilla y mismos pasos, mismo resultado.
 */

import { mulberry32 } from '../../traffic/simulation';
import { REFERENCE_BRIDGES } from '../../bridge-studio/reference-bridges';
import { validateStationRecord, type StationRecord, type StationState } from '../data-contract';
import {
  DEFAULT_QUALITY_LIMITS, G, UNAPPROVED, assessQuality, classifyStructural,
  type AccelWindow, type EventDecision, type QualityLimits, type ThresholdConfig,
} from '../events';
import { axisStats } from '../baseline';
import { ACQUISITION, SD_SPAN_FRACTIONS } from '../station-design';

/* ------------------------------------------------------------------------ */
/* Escenario: todo lo que NO viene del diseño                                */
/* ------------------------------------------------------------------------ */

export interface SimScenario {
  /** Frecuencia del modo vertical sintético, en Hz. NO es la del viaducto. */
  syntheticModeHz: number;
  /** Amortiguamiento del modo sintético (fracción del crítico). */
  dampingRatio: number;
  /** Ruido de fondo por eje (desviación típica), en m/s². */
  noiseMs2: number;
  /** Vehículos por hora que entran al puente. */
  vehiclesPerHour: number;
  /** Fracción de vehículos pesados. */
  heavyFraction: number;
  /** Velocidad de los vehículos, en km/h. */
  speedKmh: number;
  /** Pico de aceleración que provoca un vehículo pesado al entrar a un vano, en m/s². */
  heavyResponseMs2: number;
  /** Rango configurado del acelerómetro en la simulación, en g. */
  rangeG: number;
  /** Duración de cada ventana de registro, en s. */
  windowS: number;
  /** Capacidad de la microSD, en bytes. */
  storageCapacityBytes: number;
  /** Tensión de alimentación normal y con la falla de alimentación, en V. */
  supplyV: number;
  supplyFaultV: number;
  /**
   * Tensión mínima de la fuente. El diseño no la fija, así que por omisión es
   * `null` y la regla queda «no evaluada», igual que con datos reales.
   */
  minSupplyV: number | null;
  /** Retardo de entrega por Ethernet con el enlace activo, en s. */
  linkLatencyS: number;
}

/**
 * Escenario de PRUEBA. Ninguno de estos números describe La Novena: son
 * valores plausibles elegidos para que la cadena de datos tenga algo que
 * procesar. Se muestran así en la interfaz.
 */
export const TEST_SCENARIO: SimScenario = {
  syntheticModeHz: 1.2,
  dampingRatio: 0.02,
  noiseMs2: 0.003,
  vehiclesPerHour: 900,
  heavyFraction: 0.1,
  speedKmh: 40,
  heavyResponseMs2: 0.05,
  rangeG: 2,
  windowS: 10,
  storageCapacityBytes: 32e9,
  supplyV: 24,
  supplyFaultV: 9,
  minSupplyV: null,
  linkLatencyS: 0.4,
};

/* ------------------------------------------------------------------------ */
/* Fallas inyectables y su sitio en el circuito                              */
/* ------------------------------------------------------------------------ */

export type FaultId = 'sensor' | 'pps' | 'tiempo' | 'sd' | 'ethernet' | 'alimentacion' | 'crc' | 'impacto';

export interface FaultSpec {
  label: string;
  /** Qué se vería en el circuito: componente y, si aplica, solo esas redes. */
  circuit: { part: string; nets?: string[] }[];
  /** Qué debe pasar según el diseño. */
  expected: string;
}

export const FAULTS: Record<FaultId, FaultSpec> = {
  sensor: {
    label: 'Acelerómetro desconectado (J1)',
    circuit: [{ part: 'adxl355' }],
    expected: 'Huecos marcados como faltantes (nunca ceros) y SENSOR_FAULT; la ventana no entra en la línea base.',
  },
  pps: {
    label: 'Sin PPS del GNSS',
    circuit: [{ part: 'gnss', nets: ['GNSS_PPS'] }],
    expected: 'TIME_HOLDOVER: la fase entre estaciones no se presenta como sincronizada (§10).',
  },
  tiempo: {
    label: 'GNSS sin hora válida',
    circuit: [{ part: 'gnss' }],
    expected: 'TIME_INVALID: sin referencia de tiempo válida.',
  },
  sd: {
    label: 'Fallo de la microSD',
    circuit: [{ part: 'microsd' }],
    expected: 'STORAGE_FAULT: no se guarda el crudo de esa ventana.',
  },
  ethernet: {
    label: 'Ethernet caído',
    circuit: [{ part: 'phy' }],
    expected: 'COMM_LOST: los registros se encolan y se entregan al volver el enlace, con su hora de muestreo original (§8).',
  },
  alimentacion: {
    label: 'Alimentación baja',
    circuit: [{ part: 'j6' }],
    expected: 'POWER_LOW, si hay tensión mínima definida. El diseño no la fija: sin ella la regla queda «no evaluada».',
  },
  crc: {
    label: 'Archivo corrupto',
    circuit: [{ part: 'microsd' }],
    expected: 'STORAGE_FAULT por CRC que no coincide.',
  },
  impacto: {
    label: 'Golpe que satura el sensor',
    circuit: [{ part: 'adxl355', nets: ['ACC_MISO'] }],
    expected: 'SATURATED: muestras en el fondo de escala. Un pico aislado no indica daño.',
  },
};

/* ------------------------------------------------------------------------ */
/* Geometría: estaciones en los vanos publicados de La Novena                */
/* ------------------------------------------------------------------------ */

const NOVENA = REFERENCE_BRIDGES.find((b) => b.specification.instrumentationLayout === 'shm-novena-2026-11');
/** Luces publicadas (ficha de referencia). */
export const SPANS_M: number[] = NOVENA?.specification.spanLengthsM ? [...NOVENA.specification.spanLengthsM] : [];

const TAGS = ['Q1', 'M', 'Q3'];

export interface StationGeometry {
  id: string;
  span: number;
  xM: number;
  /** Forma del modo sintético en la estación (seno del primer modo del vano). */
  shape: number;
  torsion: boolean;
}

export function stationGeometry(spans = SPANS_M): StationGeometry[] {
  const out: StationGeometry[] = [];
  let start = 0;
  spans.forEach((len, s) => {
    SD_SPAN_FRACTIONS.forEach((f, i) => {
      out.push({ id: `SD-V${s + 1}-${TAGS[i]}`, span: s, xM: start + f * len, shape: Math.sin(Math.PI * f), torsion: false });
    });
    start += len;
  });
  if (spans.length) {
    // Igual que el modelo 3D: la duplicada va a media luz del vano más largo.
    const main = spans.indexOf(Math.max(...spans));
    const x = spans.slice(0, main).reduce((a, b) => a + b, 0) + spans[main] / 2;
    out.push({ id: `SD-V${main + 1}-M-T`, span: main, xM: x, shape: 1, torsion: true });
  }
  return out;
}

/* ------------------------------------------------------------------------ */
/* CRC-32 (IEEE 802.3), como el que calcularía el firmware                   */
/* ------------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): string {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return ((c ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
}

/* ------------------------------------------------------------------------ */
/* Simulación                                                               */
/* ------------------------------------------------------------------------ */

export interface LogEntry {
  timeS: number;
  utc: string;
  stationId: string;
  states: string[];
  detail: string;
}

export interface StationSnapshot {
  id: string;
  torsion: boolean;
  faults: FaultId[];
  states: string[];
  timeQuality: AccelWindow['timeQuality'];
  windows: number;
  storageUsedBytes: number;
  pendingRecords: number;
  deliveredRecords: number;
  lastRmsZ: number | null;
  lastPeakZ: number | null;
  supplyV: number;
  notEvaluated: string[];
  /** Problemas del último registro según el contrato de datos (vacío = válido). */
  contractProblems: string[];
  lastRecord: StationRecord | null;
}

export interface SimSnapshot {
  timeS: number;
  utc: string;
  vehiclesOnBridge: number;
  vehiclesTotal: number;
  stations: StationSnapshot[];
  log: LogEntry[];
  structural: EventDecision;
}

interface StationState_ {
  geo: StationGeometry;
  faults: Set<FaultId>;
  noise: () => number;
  buf: { x: (number | null)[]; y: (number | null)[]; z: (number | null)[] };
  recentZ: Float32Array;
  recentHead: number;
  states: string[];
  timeQuality: AccelWindow['timeQuality'];
  windows: number;
  storageUsedBytes: number;
  queue: StationRecord[];
  delivered: number;
  lastRmsZ: number | null;
  lastPeakZ: number | null;
  notEvaluated: string[];
  contractProblems: string[];
  lastRecord: StationRecord | null;
  impactPending: boolean;
}

interface Vehicle {
  x: number;
  heavy: boolean;
  span: number;
}

const START_UTC_MS = Date.UTC(2026, 10, 12, 12, 0, 0);
const RECENT_S = 10;
const LOG_MAX = 200;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

export class ShmStationSimulation {
  readonly scenario: SimScenario;
  readonly sampleRateHz = ACQUISITION.sampleRateHz;
  private readonly dt = 1 / ACQUISITION.sampleRateHz;
  private readonly random: () => number;
  private readonly stations: StationState_[];
  private recorder: { id: string; rows: [number | null, number | null, number | null][] } | null = null;
  private readonly spanEdges: number[];
  private readonly limits: QualityLimits;
  private thresholds: ThresholdConfig = UNAPPROVED;
  /** Coordenada modal (desplazamiento, velocidad) por vano. */
  private readonly modal: { q: number; v: number }[];
  private vehicles: Vehicle[] = [];
  private vehiclesTotal = 0;
  private sampleIndex = 0;
  private log: LogEntry[] = [];

  constructor(scenario: SimScenario = TEST_SCENARIO, seed = 2026, spans = SPANS_M) {
    this.scenario = scenario;
    this.random = mulberry32(seed);
    this.spanEdges = spans.reduce<number[]>((acc, l) => [...acc, acc[acc.length - 1] + l], [0]);
    this.modal = spans.map(() => ({ q: 0, v: 0 }));
    this.limits = { ...DEFAULT_QUALITY_LIMITS, minSupplyV: scenario.minSupplyV };
    const recentLen = RECENT_S * this.sampleRateHz;
    this.stations = stationGeometry(spans).map((geo, i) => ({
      geo,
      faults: new Set<FaultId>(),
      noise: gaussian(mulberry32(seed * 31 + i + 1)),
      buf: { x: [], y: [], z: [] },
      recentZ: new Float32Array(recentLen).fill(Number.NaN),
      recentHead: 0,
      states: ['NORMAL'],
      timeQuality: 'GNSS_LOCKED',
      windows: 0,
      storageUsedBytes: 0,
      queue: [],
      delivered: 0,
      lastRmsZ: null,
      lastPeakZ: null,
      notEvaluated: [],
      contractProblems: [],
      lastRecord: null,
      impactPending: false,
    }));
  }

  get timeS(): number {
    return this.sampleIndex * this.dt;
  }

  /**
   * Graba las muestras (m/s², con gravedad) que ve una estación desde ahora.
   * Sirve para alimentar al ADXL355 emulado en Renode con la misma señal.
   */
  startRecording(stationId: string): void {
    this.recorder = { id: stationId, rows: [] };
  }

  stopRecording(): [number | null, number | null, number | null][] {
    const rows = this.recorder?.rows ?? [];
    this.recorder = null;
    return rows;
  }

  stationIds(): string[] {
    return this.stations.map((s) => s.geo.id);
  }

  setFault(stationId: string, fault: FaultId, on: boolean): void {
    for (const s of this.stations) {
      if (stationId !== '*' && s.geo.id !== stationId) continue;
      // El golpe es un evento puntual, no un estado que se quede activo.
      if (fault === 'impacto') {
        if (on) s.impactPending = true;
        continue;
      }
      if (on) s.faults.add(fault);
      else s.faults.delete(fault);
    }
  }

  faultsOf(stationId: string): FaultId[] {
    return [...(this.stations.find((s) => s.geo.id === stationId)?.faults ?? [])];
  }

  /** Para probar el bloqueo: la clasificación usa estos umbrales (por omisión, ninguno). */
  setThresholds(cfg: ThresholdConfig): void {
    this.thresholds = cfg;
  }

  /** Avanza la simulación `seconds` de tiempo simulado, muestra a muestra. */
  step(seconds: number): void {
    const n = Math.round(seconds * this.sampleRateHz);
    for (let i = 0; i < n; i++) this.tick();
  }

  /** Últimos 10 s del eje vertical de una estación (NaN donde hubo hueco). */
  recentZ(stationId: string): Float32Array {
    const s = this.stations.find((x) => x.geo.id === stationId);
    if (!s) return new Float32Array();
    const len = s.recentZ.length;
    const out = new Float32Array(len);
    for (let i = 0; i < len; i++) out[i] = s.recentZ[(s.recentHead + i) % len];
    return out;
  }

  snapshot(): SimSnapshot {
    const devs = this.stations.map((s) => ({ stationId: s.geo.id, sigmas: [] as (number | null)[], peakMs2: s.lastPeakZ ?? 0 }));
    return {
      timeS: this.timeS,
      utc: iso(START_UTC_MS + this.timeS * 1000),
      vehiclesOnBridge: this.vehicles.length,
      vehiclesTotal: this.vehiclesTotal,
      stations: this.stations.map((s) => ({
        id: s.geo.id,
        torsion: s.geo.torsion,
        faults: [...s.faults],
        states: [...s.states],
        timeQuality: s.timeQuality,
        windows: s.windows,
        storageUsedBytes: s.storageUsedBytes,
        pendingRecords: s.queue.length,
        deliveredRecords: s.delivered,
        lastRmsZ: s.lastRmsZ,
        lastPeakZ: s.lastPeakZ,
        supplyV: s.faults.has('alimentacion') ? this.scenario.supplyFaultV : this.scenario.supplyV,
        notEvaluated: [...s.notEvaluated],
        contractProblems: [...s.contractProblems],
        lastRecord: s.lastRecord,
      })),
      log: [...this.log],
      structural: classifyStructural(devs, this.thresholds),
    };
  }

  /* -------------------------------------------------------------------- */

  private tick(): void {
    const sc = this.scenario;
    const dt = this.dt;
    this.moveTraffic(dt);

    // Modo sintético por vano: oscilador amortiguado excitado por impulsos.
    const w = 2 * Math.PI * sc.syntheticModeHz;
    const accel = this.modal.map((m) => {
      const a = -2 * sc.dampingRatio * w * m.v - w * w * m.q;
      m.v += a * dt;
      m.q += m.v * dt;
      return a;
    });

    const limit = sc.rangeG * G;
    for (const s of this.stations) {
      let z: number | null = G + accel[s.geo.span] * s.geo.shape * (s.geo.torsion ? 0.9 : 1) + sc.noiseMs2 * s.noise();
      let x: number | null = 0.1 * accel[s.geo.span] * s.geo.shape + sc.noiseMs2 * s.noise();
      let y: number | null = sc.noiseMs2 * s.noise();
      if (s.impactPending) {
        z = limit * 1.5;
        s.impactPending = false;
      }
      if (s.faults.has('sensor')) {
        x = null;
        y = null;
        z = null;
      }
      // El sensor no puede dar más que su fondo de escala.
      const clip = (v: number | null) => (v === null ? null : Math.max(-limit, Math.min(limit, v)));
      s.buf.x.push(clip(x));
      s.buf.y.push(clip(y));
      s.buf.z.push(clip(z));
      if (this.recorder?.id === s.geo.id) this.recorder.rows.push([clip(x), clip(y), clip(z)]);
      s.recentZ[s.recentHead] = z === null ? Number.NaN : clip(z)! - G;
      s.recentHead = (s.recentHead + 1) % s.recentZ.length;
    }

    this.sampleIndex++;
    const perWindow = Math.round(sc.windowS * this.sampleRateHz);
    if (this.sampleIndex % perWindow === 0) {
      for (const s of this.stations) this.closeWindow(s);
    }
    this.deliver();
  }

  private moveTraffic(dt: number): void {
    const sc = this.scenario;
    const total = this.spanEdges[this.spanEdges.length - 1];
    if (!total) return;
    if (this.random() < (sc.vehiclesPerHour / 3600) * dt) {
      this.vehicles.push({ x: 0, heavy: this.random() < sc.heavyFraction, span: -1 });
      this.vehiclesTotal++;
    }
    const v = sc.speedKmh / 3.6;
    const w = 2 * Math.PI * sc.syntheticModeHz;
    for (const veh of this.vehicles) {
      veh.x += v * dt;
      const span = this.spanEdges.findIndex((edge, i) => i < this.spanEdges.length - 1 && veh.x >= edge && veh.x < this.spanEdges[i + 1]);
      if (span !== veh.span) {
        // Al entrar o salir de un vano, un impulso cuyo pico de aceleración
        // es la respuesta del escenario (un ligero, el 15 %).
        const peak = sc.heavyResponseMs2 * (veh.heavy ? 1 : 0.15);
        if (span >= 0) this.modal[span].v += peak / w;
        if (veh.span >= 0) this.modal[veh.span].v -= (0.5 * peak) / w;
        veh.span = span;
      }
    }
    this.vehicles = this.vehicles.filter((veh) => veh.x < total);
  }

  private closeWindow(s: StationState_): void {
    const sc = this.scenario;
    const startS = this.timeS - sc.windowS;
    const startUtc = iso(START_UTC_MS + startS * 1000);
    const f = s.faults;

    const timeQuality: AccelWindow['timeQuality'] = f.has('tiempo') ? 'INVALID' : f.has('pps') ? 'HOLDOVER' : 'GNSS_LOCKED';
    const bytes = windowBytes(s.buf);
    const crc = crc32(bytes);
    const sdOk = !f.has('sd') && s.storageUsedBytes + bytes.length * ACQUISITION.headerFactor <= sc.storageCapacityBytes;

    const win: AccelWindow = {
      stationId: s.geo.id,
      config: { sampleRateHz: this.sampleRateHz, rangeG: sc.rangeG, filterId: 'sim-f0', firmwareVersion: 'sim-0.1.0' },
      axes: s.buf,
      durationS: sc.windowS,
      timeQuality,
      ppsLocked: timeQuality === 'GNSS_LOCKED',
      sensorOk: !f.has('sensor'),
      storageOk: sdOk,
      crcDeclared: crc,
      crcComputed: f.has('crc') ? flipCrc(crc) : crc,
      sensorTempC: null,
      supplyV: f.has('alimentacion') ? sc.supplyFaultV : sc.supplyV,
    };
    const q = assessQuality(win, this.limits);
    if (sdOk) s.storageUsedBytes += bytes.length * ACQUISITION.headerFactor;

    const states: StationState[] = [...new Set(q.findings.map((x) => x.state))];
    if (f.has('ethernet')) states.push('COMM_LOST');
    const finalStates: string[] = states.length ? states : ['NORMAL'];

    const z = axisStats(s.buf.z);
    s.lastRmsZ = z?.rms ?? null;
    s.lastPeakZ = z?.peak ?? null;
    s.windows++;

    const record: StationRecord = {
      schema_version: '1.0',
      station_id: s.geo.id,
      sensor_id: `ADXL355-SIM-${s.geo.id}`,
      timestamp_utc: startUtc,
      time_quality: timeQuality,
      // Sin hardware no hay incertidumbre medida que declarar.
      time_uncertainty_us: null,
      sample_rate_hz: this.sampleRateHz,
      axes: ['longitudinal', 'transversal', 'vertical'],
      units: 'm/s2',
      range_g: sc.rangeG,
      filter_id: 'sim-f0',
      firmware_version: 'sim-0.1.0',
      calibration_id: null,
      samples_file: `sim/${s.geo.id}/${String(s.windows).padStart(6, '0')}.bin`,
      samples_crc32: crc,
      states: finalStates,
      health: { sensor_ok: win.sensorOk, storage_ok: sdOk, pps_locked: win.ppsLocked, supply_v: win.supplyV },
      simulated: true,
    };
    s.queue.push(record);

    if (finalStates.join() !== s.states.join()) {
      this.pushLog(s.geo.id, finalStates, q.findings.map((x) => x.detail).join(' ') || (f.has('ethernet') ? 'Enlace Ethernet caído: el registro queda en cola.' : 'Vuelve a NORMAL.'));
    }
    s.states = finalStates;
    s.timeQuality = timeQuality;
    s.notEvaluated = q.notEvaluated;
    s.buf = { x: [], y: [], z: [] };
  }

  /** Entrega lo encolado si el enlace está activo, sin tocar la hora de muestreo. */
  private deliver(): void {
    const nowMs = START_UTC_MS + this.timeS * 1000;
    for (const s of this.stations) {
      if (s.faults.has('ethernet') || !s.queue.length) continue;
      const due = s.queue.filter((r) => Date.parse(r.timestamp_utc) + (this.scenario.windowS + this.scenario.linkLatencyS) * 1000 <= nowMs);
      for (const r of due) {
        r.received_utc = iso(nowMs);
        s.contractProblems = validateStationRecord(r);
        s.lastRecord = r;
        s.delivered++;
      }
      if (due.length) s.queue = s.queue.filter((r) => !due.includes(r));
    }
  }

  private pushLog(stationId: string, states: string[], detail: string): void {
    this.log.unshift({ timeS: this.timeS, utc: iso(START_UTC_MS + this.timeS * 1000), stationId, states, detail });
    if (this.log.length > LOG_MAX) this.log.length = LOG_MAX;
  }
}

/** Ruido gaussiano (Box-Muller) a partir de un generador uniforme. */
function gaussian(rand: () => number): () => number {
  return () => {
    const u = Math.max(rand(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  };
}

/** Bytes crudos de la ventana: float32 por muestra y eje; los huecos van como NaN, nunca 0. */
function windowBytes(buf: { x: (number | null)[]; y: (number | null)[]; z: (number | null)[] }): Uint8Array {
  const n = buf.z.length;
  const f = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    f[i * 3] = buf.x[i] ?? Number.NaN;
    f[i * 3 + 1] = buf.y[i] ?? Number.NaN;
    f[i * 3 + 2] = buf.z[i] ?? Number.NaN;
  }
  return new Uint8Array(f.buffer);
}

function flipCrc(crc: string): string {
  return ((parseInt(crc, 16) ^ 0x1) >>> 0).toString(16).padStart(8, '0');
}

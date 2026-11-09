/**
 * Evaluación del estado de mando del alumbrado.
 *
 * ESTO NO ES UNA SIMULACIÓN. No resuelve circuitos, no calcula corrientes, no
 * modela comportamiento térmico ni fallos. Lo que hace es **evaluar la lógica
 * de mando declarada en el modelo**: dado un instante y unas coordenadas,
 * responde qué zonas quedan energizadas y, sobre todo, POR QUÉ.
 *
 * La diferencia importa. Un simulador respondería «la luminaria entrega 11.200
 * lúmenes». Esto responde «el contactor cierra porque el reloj astronómico dice
 * que ya es de noche», que es una afirmación que el modelo sí sostiene.
 *
 * El cálculo de orto y ocaso usa el algoritmo solar de la NOAA, que es
 * determinista y público. No es una aproximación inventada aquí.
 */

import type { GeneratedComponentSummary } from './contracts';

export interface LightingZone {
  zone: string;
  label: string;
  purpose: string;
  circuitId: string | null;
  switchedBy: string | null;
  controllerId: string | null;
  driverId: string | null;
  fixtures: string[];
  fixtureCount: number;
  connectedPowerW: number | null;
  nominalVoltageV: number | null;
  dimmable: boolean;
  colorCapability: string | null;
}

export interface LightingControl {
  cabinetId: string | null;
  sensorId: string | null;
  sensorThresholds: { switchOnLux: number | null; switchOffLux: number | null } | null;
  clockId: string | null;
  latitudeDeg: number | null;
  longitudeDeg: number | null;
  contactorId: string | null;
  zones: LightingZone[];
  totalFixtures: number;
  undetermined: string[];
  notSimulated: string[];
}

/** Adapta el bloque `lighting_control` del generador. */
export function normalizeLightingControl(value: unknown): LightingControl | null {
  if (!value || typeof value !== 'object') return null;
  const r = value as Record<string, unknown>;
  const thresholds = r.sensor_thresholds as Record<string, unknown> | null | undefined;
  return {
    cabinetId: text(r.cabinet_id),
    sensorId: text(r.sensor_id),
    sensorThresholds: thresholds
      ? {
          switchOnLux: number(thresholds.switch_on_lux),
          switchOffLux: number(thresholds.switch_off_lux),
        }
      : null,
    clockId: text(r.clock_id),
    latitudeDeg: number(r.latitude_deg),
    longitudeDeg: number(r.longitude_deg),
    contactorId: text(r.contactor_id),
    zones: Array.isArray(r.zones) ? r.zones.map(normalizeZone) : [],
    totalFixtures: Number(r.total_fixtures ?? 0),
    undetermined: Array.isArray(r.undetermined) ? (r.undetermined as string[]) : [],
    notSimulated: Array.isArray(r.not_simulated) ? (r.not_simulated as string[]) : [],
  };
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeZone(raw: unknown): LightingZone {
  const z = (raw ?? {}) as Record<string, unknown>;
  return {
    zone: String(z.zone ?? 'sin-zona'),
    label: String(z.label ?? z.zone ?? 'Zona'),
    purpose: String(z.purpose ?? ''),
    circuitId: text(z.circuit_id),
    switchedBy: text(z.switched_by),
    controllerId: text(z.controller_id),
    driverId: text(z.driver_id),
    fixtures: Array.isArray(z.fixtures) ? (z.fixtures as string[]) : [],
    fixtureCount: Number(z.fixture_count ?? 0),
    connectedPowerW: number(z.connected_power_w),
    nominalVoltageV: number(z.nominal_voltage_v),
    dimmable: z.dimmable === true,
    colorCapability: text(z.color_capability),
  };
}

// ---------------------------------------------------------------------------
// Posición solar (algoritmo NOAA)
// ---------------------------------------------------------------------------

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

export interface SolarEvents {
  /** Minutos desde medianoche, hora local, o null si no hay orto/ocaso ese día. */
  sunriseMinutes: number | null;
  sunsetMinutes: number | null;
  solarNoonMinutes: number;
  declinationDeg: number;
  /** `polar-day` y `polar-night` ocurren de verdad en latitudes altas. */
  regime: 'normal' | 'polar-day' | 'polar-night';
}

/**
 * Orto y ocaso para una fecha, unas coordenadas y un desfase horario.
 *
 * `dayNumber` es el día del año (1 a 366) y `utcOffsetHours` el desfase del
 * huso. Se devuelve en minutos locales desde medianoche.
 */
export function solarEvents(
  year: number,
  dayNumber: number,
  latitudeDeg: number,
  longitudeDeg: number,
  utcOffsetHours: number,
): SolarEvents {
  // Día juliano del mediodía UTC de la fecha pedida.
  const jd = julianDayOfYear(year, dayNumber);
  const t = (jd - 2451545.0) / 36525.0;

  const meanLong = mod360(280.46646 + t * (36000.76983 + t * 0.0003032));
  const meanAnom = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);

  const center =
    Math.sin(toRad(meanAnom)) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(toRad(2 * meanAnom)) * (0.019993 - 0.000101 * t) +
    Math.sin(toRad(3 * meanAnom)) * 0.000289;

  const trueLong = meanLong + center;
  const omega = 125.04 - 1934.136 * t;
  const apparentLong = trueLong - 0.00569 - 0.00478 * Math.sin(toRad(omega));

  const seconds = 21.448 - t * (46.815 + t * (0.00059 - t * 0.001813));
  const meanObliquity = 23 + (26 + seconds / 60) / 60;
  const obliquity = meanObliquity + 0.00256 * Math.cos(toRad(omega));

  const declination = toDeg(
    Math.asin(Math.sin(toRad(obliquity)) * Math.sin(toRad(apparentLong))),
  );

  const y = Math.tan(toRad(obliquity / 2)) ** 2;
  const equationOfTime =
    4 *
    toDeg(
      y * Math.sin(2 * toRad(meanLong)) -
        2 * eccentricity * Math.sin(toRad(meanAnom)) +
        4 * eccentricity * y * Math.sin(toRad(meanAnom)) * Math.cos(2 * toRad(meanLong)) -
        0.5 * y * y * Math.sin(4 * toRad(meanLong)) -
        1.25 * eccentricity * eccentricity * Math.sin(2 * toRad(meanAnom)),
    );

  // 90.833° incluye la refracción atmosférica y el radio aparente del disco.
  const zenith = 90.833;
  const cosHourAngle =
    Math.cos(toRad(zenith)) / (Math.cos(toRad(latitudeDeg)) * Math.cos(toRad(declination))) -
    Math.tan(toRad(latitudeDeg)) * Math.tan(toRad(declination));

  const solarNoonUtc = 720 - 4 * longitudeDeg - equationOfTime;
  const offsetMinutes = utcOffsetHours * 60;
  const solarNoonMinutes = solarNoonUtc + offsetMinutes;

  if (cosHourAngle > 1) {
    // El sol no llega a salir.
    return {
      sunriseMinutes: null, sunsetMinutes: null, solarNoonMinutes,
      declinationDeg: declination, regime: 'polar-night',
    };
  }
  if (cosHourAngle < -1) {
    // El sol no llega a ponerse.
    return {
      sunriseMinutes: null, sunsetMinutes: null, solarNoonMinutes,
      declinationDeg: declination, regime: 'polar-day',
    };
  }

  const hourAngle = toDeg(Math.acos(cosHourAngle));
  return {
    sunriseMinutes: solarNoonMinutes - 4 * hourAngle,
    sunsetMinutes: solarNoonMinutes + 4 * hourAngle,
    solarNoonMinutes,
    declinationDeg: declination,
    regime: 'normal',
  };
}

function julianDayOfYear(year: number, dayNumber: number): number {
  // Medianoche del 1 de enero del año pedido, más los días transcurridos,
  // más medio día para situarse en el mediodía.
  const jan1 = Date.UTC(year, 0, 1) / 86400000 + 2440587.5;
  return jan1 + (dayNumber - 1) + 0.5;
}

function mod360(value: number): number {
  const r = value % 360;
  return r < 0 ? r + 360 : r;
}

// ---------------------------------------------------------------------------
// Evaluación del mando
// ---------------------------------------------------------------------------

export interface ZoneState {
  zone: string;
  label: string;
  energized: boolean;
  /** Frase que explica la decisión. Nunca está vacía. */
  reason: string;
  fixtures: string[];
  fixtureCount: number;
  connectedPowerW: number | null;
}

export interface LightingEvaluation {
  /** Minutos locales desde medianoche en los que se evaluó. */
  minutesOfDay: number;
  night: boolean;
  sunriseMinutes: number | null;
  sunsetMinutes: number | null;
  utcOffsetHours: number;
  /** Cómo se obtuvo el huso. Hoy siempre es una hipótesis. */
  utcOffsetSource: string;
  zones: ZoneState[];
  litComponents: Set<string>;
  totalPowerW: number | null;
  /** Lo que impide evaluar algo, copiado del modelo y ampliado aquí. */
  undetermined: string[];
  notSimulated: string[];
}

export interface EvaluationOptions {
  minutesOfDay: number;
  year: number;
  dayNumber: number;
  /** Zonas de realce que el operador ha activado en su programa. */
  accentZonesOn?: Set<string>;
}

/**
 * Evalúa la cadena de mando.
 *
 * El alumbrado vial se resuelve solo: el contactor obedece al crepúsculo. El
 * realce NO: depende de un programa que el operador decide y que el modelo no
 * contiene, así que se expone como un conmutador y se dice que es una elección
 * del operador, no una deducción.
 */
export function evaluateLighting(
  control: LightingControl,
  options: EvaluationOptions,
): LightingEvaluation {
  const undetermined = [...control.undetermined];
  const lit = new Set<string>();
  const zones: ZoneState[] = [];

  const { latitudeDeg, longitudeDeg } = control;
  let sunriseMinutes: number | null = null;
  let sunsetMinutes: number | null = null;
  let night = false;
  let utcOffsetHours = 0;
  let utcOffsetSource =
    'Sin coordenadas no hay huso que deducir; se evalúa en UTC.';

  if (latitudeDeg !== null && longitudeDeg !== null) {
    // El reloj declara `timezone` como pendiente, así que el huso se deduce de
    // la longitud. Es una aproximación geográfica: no conoce husos políticos
    // ni horario de verano. Queda dicho, no escondido.
    utcOffsetHours = Math.round(longitudeDeg / 15);
    utcOffsetSource =
      `Huso UTC${utcOffsetHours >= 0 ? '+' : ''}${utcOffsetHours} deducido de la longitud. ` +
      'El reloj declara su zona horaria como pendiente: esta deducción ignora husos políticos y horario de verano.';
    const events = solarEvents(
      options.year, options.dayNumber, latitudeDeg, longitudeDeg, utcOffsetHours,
    );
    sunriseMinutes = events.sunriseMinutes;
    sunsetMinutes = events.sunsetMinutes;
    if (events.regime === 'polar-day') {
      night = false;
      undetermined.push('En esta fecha y latitud el sol no se pone: no hay orden de encendido.');
    } else if (events.regime === 'polar-night') {
      night = true;
      undetermined.push('En esta fecha y latitud el sol no sale: el alumbrado quedaría encendido todo el día.');
    } else {
      night =
        options.minutesOfDay < (sunriseMinutes ?? 0) ||
        options.minutesOfDay >= (sunsetMinutes ?? 0);
    }
  } else {
    undetermined.push(
      'Sin latitud y longitud no se puede decidir si es de día o de noche, ' +
        'y por tanto no se puede evaluar el mando.',
    );
  }

  const accentOn = options.accentZonesOn ?? new Set<string>();

  for (const zone of control.zones) {
    const isRoad = zone.circuitId !== null;
    let energized: boolean;
    let reason: string;

    if (isRoad) {
      if (latitudeDeg === null || longitudeDeg === null) {
        energized = false;
        reason = 'No evaluable: el reloj astronómico no tiene coordenadas cargadas.';
      } else if (!zone.switchedBy) {
        energized = false;
        reason = 'No evaluable: el circuito no tiene contactor que lo maniobre.';
      } else {
        energized = night;
        reason = night
          ? `${zone.switchedBy} cierra: el reloj sitúa el ocaso a las ${clock(sunsetMinutes)}.`
          : `${zone.switchedBy} abre: entre el orto (${clock(sunriseMinutes)}) y el ocaso (${clock(sunsetMinutes)}) es de día.`;
      }
    } else if (!zone.controllerId || !zone.driverId) {
      energized = false;
      reason = 'No evaluable: la cadena controlador → fuente está incompleta.';
    } else if (!night) {
      energized = false;
      reason = 'El realce no se programa de día.';
    } else {
      energized = accentOn.has(zone.zone);
      reason = energized
        ? `${zone.controllerId} activa la zona. Es una elección del operador, no una deducción del modelo.`
        : 'Zona disponible pero no incluida en el programa activo.';
    }

    if (energized) for (const fixture of zone.fixtures) lit.add(fixture);
    zones.push({
      zone: zone.zone, label: zone.label, energized, reason,
      fixtures: zone.fixtures, fixtureCount: zone.fixtureCount,
      connectedPowerW: zone.connectedPowerW,
    });
  }

  // Solo se suma la potencia de lo encendido, y solo si TODAS las zonas
  // encendidas la declaran: una suma con un hueco no es una suma.
  const onZones = zones.filter((z) => z.energized);
  const totalPowerW = onZones.every((z) => z.connectedPowerW !== null)
    ? onZones.reduce((total, z) => total + (z.connectedPowerW ?? 0), 0)
    : null;

  return {
    minutesOfDay: options.minutesOfDay,
    night, sunriseMinutes, sunsetMinutes,
    utcOffsetHours, utcOffsetSource,
    zones, litComponents: lit, totalPowerW,
    undetermined,
    notSimulated: control.notSimulated,
  };
}

/** Minutos desde medianoche a `HH:MM`. */
export function clock(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes)) return '—';
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const m = Math.round(wrapped % 60);
  return `${String(h).padStart(2, '0')}:${String(m === 60 ? 0 : m).padStart(2, '0')}`;
}

/** Día del año (1 a 366) de una fecha. */
export function dayOfYear(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const current = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.floor((current - start) / 86400000) + 1;
}

/** Componentes de iluminación del modelo, para apagar lo que no esté encendido. */
export function lightingComponents(components: GeneratedComponentSummary[]): Set<string> {
  return new Set(
    components.filter((c) => c.discipline === 'lighting').map((c) => c.component_id),
  );
}

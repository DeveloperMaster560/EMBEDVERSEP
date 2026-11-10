/**
 * Circulación de vehículos sobre el tablero del puente.
 *
 * Es determinista: con la misma semilla y la misma secuencia de pasos, el
 * resultado es idéntico. Eso permite que las pruebas comprueben instantes
 * concretos y que dos personas vean lo mismo, en vez de una animación que
 * nunca se repite.
 *
 * ALCANCE. Esto modela el movimiento longitudinal de vehículos en carriles
 * independientes, con el modelo IDM. **No** es un estudio de tráfico: no hay
 * aforos reales, ni cambio de carril, ni intersecciones, ni semáforos, ni
 * cargas sobre la estructura. Los límites completos están en `idm.ts` y la
 * procedencia de las cifras en `vehicles.ts`.
 */

import { idmEquilibriumGap, idmStep, kmhToMs, msToKmh, type IdmParams, type Leader } from './idm';
import {
  DEFAULT_MIX, VEHICLE_CLASSES, VEHICLE_CLASS_IDS, pickClass,
  type VehicleClassId, type VehicleMix,
} from './vehicles';

export interface Lane {
  id: string;
  label: string;
  /** Desplazamiento lateral respecto al eje del tablero, en metros. */
  offsetM: number;
  /** +1 recorre el tablero en el sentido de la abscisa creciente; −1 al revés. */
  direction: 1 | -1;
  /** Intensidad de entrada en vehículos por hora. */
  flowVehPerHour: number;
}

export interface TrafficVehicle {
  id: string;
  classId: VehicleClassId;
  laneId: string;
  /** Abscisa sobre el tablero, en metros desde el estribo de origen. */
  positionM: number;
  speedMs: number;
  accelMs2: number;
  /** Instante de entrada, en segundos de simulación. */
  enteredAtS: number;
}

export interface TrafficOptions {
  /** Longitud del tablero, en metros. */
  deckLengthM: number;
  lanes: Lane[];
  mix?: VehicleMix;
  seed?: number;
  /**
   * Límite de velocidad del puente, en km/h, o null si no se declara.
   *
   * Cuando se da, recorta la velocidad deseada de cada clase: ningún vehículo
   * «quiere» ir más rápido que el límite. Si es null **no se inventa uno**: se
   * usa la velocidad deseada propia de cada clase.
   */
  speedLimitKmh?: number | null;
  /** Paso máximo de integración, en segundos. */
  maxStepS?: number;
}

export interface TrafficStats {
  /** Segundos de simulación transcurridos. */
  elapsedS: number;
  count: number;
  countByClass: Record<VehicleClassId, number>;
  /** Velocidad media de los vehículos presentes, en km/h, o null si no hay. */
  meanSpeedKmh: number | null;
  /** Vehículos que ya han salido del tablero. */
  completed: number;
  /** Densidad en vehículos por kilómetro de carril. */
  densityVehPerKmLane: number | null;
}

/**
 * Generador congruente de 32 bits (mulberry32).
 *
 * Hace falta uno propio porque `Math.random` no es reproducible, y la
 * reproducibilidad es la diferencia entre una simulación y una animación.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Paso de integración por omisión. Por encima de 0,2 s el IDM se desestabiliza. */
const DEFAULT_MAX_STEP_S = 0.1;

export class TrafficSimulation {
  readonly deckLengthM: number;
  readonly lanes: readonly Lane[];
  private readonly mix: VehicleMix;
  private readonly random: () => number;
  private readonly speedLimitMs: number | null;
  private readonly maxStepS: number;
  private readonly pending = new Map<string, number>();
  private vehicles: TrafficVehicle[] = [];
  private elapsedS = 0;
  private completed = 0;
  private nextId = 1;

  constructor(options: TrafficOptions) {
    this.deckLengthM = options.deckLengthM;
    this.lanes = options.lanes;
    this.mix = options.mix ?? DEFAULT_MIX;
    this.random = mulberry32(options.seed ?? 1);
    this.speedLimitMs = options.speedLimitKmh == null ? null : kmhToMs(options.speedLimitKmh);
    this.maxStepS = options.maxStepS ?? DEFAULT_MAX_STEP_S;
    for (const lane of options.lanes) this.pending.set(lane.id, 0);
  }

  get all(): readonly TrafficVehicle[] {
    return this.vehicles;
  }

  /** Parámetros IDM de una clase, con el límite de velocidad ya aplicado. */
  params(classId: VehicleClassId): IdmParams {
    const spec = VEHICLE_CLASSES[classId];
    const desired = kmhToMs(spec.desiredSpeedKmh);
    return {
      desiredSpeedMs: this.speedLimitMs === null ? desired : Math.min(desired, this.speedLimitMs),
      maxAccelMs2: spec.maxAccelMs2,
      comfortDecelMs2: spec.comfortDecelMs2,
      minGapM: spec.minGapM,
      timeHeadwayS: spec.timeHeadwayS,
    };
  }

  /**
   * Avanza la simulación.
   *
   * Un intervalo grande se parte en pasos pequeños: integrar medio segundo de
   * golpe daría oscilaciones que no son físicas.
   */
  advance(seconds: number): void {
    let remaining = Math.max(0, seconds);
    while (remaining > 1e-9) {
      const dt = Math.min(this.maxStepS, remaining);
      this.step(dt);
      remaining -= dt;
    }
  }

  private step(dtS: number): void {
    this.elapsedS += dtS;
    this.spawn(dtS);

    const next: TrafficVehicle[] = [];
    for (const lane of this.lanes) {
      const inLane = this.vehicles
        .filter((vehicle) => vehicle.laneId === lane.id)
        // Se ordena por avance recorrido, no por abscisa: en el sentido
        // contrario el que va delante tiene la abscisa MENOR.
        .sort((a, b) => this.travelled(b, lane) - this.travelled(a, lane));

      for (let index = 0; index < inLane.length; index += 1) {
        const vehicle = inLane[index];
        const spec = VEHICLE_CLASSES[vehicle.classId];
        const ahead = inLane[index - 1];
        let leader: Leader | null = null;
        if (ahead) {
          const aheadSpec = VEHICLE_CLASSES[ahead.classId];
          // Separación libre: distancia entre ejes menos la longitud del de
          // delante. Es la `s` del modelo, parachoques a parachoques.
          const gap = this.travelled(ahead, lane) - this.travelled(vehicle, lane) - aheadSpec.lengthM;
          leader = { gapM: gap, speedMs: ahead.speedMs };
        }
        const result = idmStep(
          this.params(vehicle.classId),
          this.travelled(vehicle, lane),
          vehicle.speedMs,
          leader,
          dtS,
        );
        const positionM = lane.direction === 1
          ? result.positionM
          : this.deckLengthM - result.positionM;

        // Sale del tablero cuando su morro pasa del final.
        if (result.positionM - spec.lengthM > this.deckLengthM) {
          this.completed += 1;
          continue;
        }
        next.push({
          ...vehicle,
          positionM,
          speedMs: result.speedMs,
          accelMs2: result.accelMs2,
        });
      }
    }
    this.vehicles = next;
  }

  /** Distancia recorrida sobre el tablero, siempre creciente en su sentido. */
  private travelled(vehicle: TrafficVehicle, lane: Lane): number {
    return lane.direction === 1 ? vehicle.positionM : this.deckLengthM - vehicle.positionM;
  }

  private spawn(dtS: number): void {
    for (const lane of this.lanes) {
      const expected = (lane.flowVehPerHour / 3600) * dtS;
      const accumulated = (this.pending.get(lane.id) ?? 0) + expected;
      this.pending.set(lane.id, accumulated);
      if (accumulated < 1) continue;

      const classId = pickClass(this.mix, this.random());
      const params = this.params(classId);

      // El último de la cola, que es el que marca si cabe otro.
      const last = this.vehicles
        .filter((vehicle) => vehicle.laneId === lane.id)
        .reduce<TrafficVehicle | null>((closest, vehicle) => {
          if (!closest) return vehicle;
          return this.travelled(vehicle, lane) < this.travelled(closest, lane) ? vehicle : closest;
        }, null);

      // Entra rodando, pero nunca más rápido que quien tiene delante: meter un
      // vehículo a 60 km/h detrás de un bus detenido es un choque garantizado
      // que ningún modelo de seguimiento puede deshacer a tiempo.
      const entrySpeed = last === null
        ? params.desiredSpeedMs
        : Math.min(params.desiredSpeedMs, last.speedMs);

      if (last) {
        // El hueco se mide contra la LONGITUD DEL DE DELANTE, no la propia, y
        // tiene que ser el de equilibrio para esa velocidad de entrada. Con
        // solo la separación mínima el vehículo entraría ya frenando.
        const needed = VEHICLE_CLASSES[last.classId].lengthM
          + Math.max(params.minGapM, idmEquilibriumGap(params, entrySpeed));
        if (!Number.isFinite(needed) || this.travelled(last, lane) < needed) continue;
      }

      this.pending.set(lane.id, accumulated - 1);
      this.vehicles.push({
        id: `V${this.nextId++}`,
        classId,
        laneId: lane.id,
        positionM: lane.direction === 1 ? 0 : this.deckLengthM,
        speedMs: entrySpeed,
        accelMs2: 0,
        enteredAtS: this.elapsedS,
      });
    }
  }

  stats(): TrafficStats {
    const countByClass = VEHICLE_CLASS_IDS.reduce((acc, id) => {
      acc[id] = 0;
      return acc;
    }, {} as Record<VehicleClassId, number>);
    for (const vehicle of this.vehicles) countByClass[vehicle.classId] += 1;

    const meanSpeedKmh = this.vehicles.length === 0
      ? null
      : msToKmh(this.vehicles.reduce((sum, v) => sum + v.speedMs, 0) / this.vehicles.length);

    const laneKm = (this.lanes.length * this.deckLengthM) / 1000;
    return {
      elapsedS: this.elapsedS,
      count: this.vehicles.length,
      countByClass,
      meanSpeedKmh,
      completed: this.completed,
      densityVehPerKmLane: laneKm > 0 ? this.vehicles.length / laneKm : null,
    };
  }
}

/**
 * Carriles de una calzada doble sobre un tablero.
 *
 * Reparte los carriles simétricamente respecto al eje, dejando el ancho de
 * borde que se le indique. No decide cuántos carriles tiene el puente: eso lo
 * dice el modelo, y si no lo dice, lo dice quien llama.
 */
export function laneLayout(
  lanesPerDirection: number,
  laneWidthM: number,
  flowVehPerHour: number,
): Lane[] {
  const lanes: Lane[] = [];
  const total = lanesPerDirection * 2;
  for (let index = 0; index < total; index += 1) {
    const direction: 1 | -1 = index < lanesPerDirection ? 1 : -1;
    const withinSide = direction === 1 ? index : index - lanesPerDirection;
    const sideSign = direction === 1 ? -1 : 1;
    const offsetM = sideSign * ((withinSide + 0.5) * laneWidthM);
    lanes.push({
      id: `C${index + 1}`,
      label: `Carril ${withinSide + 1} · sentido ${direction === 1 ? 'norte' : 'sur'}`,
      offsetM: Number(offsetM.toFixed(3)),
      direction,
      flowVehPerHour,
    });
  }
  return lanes;
}

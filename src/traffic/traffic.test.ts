import { describe, expect, it } from 'vitest';

import { IDM_DELTA, idmAcceleration, idmEquilibriumGap, idmStep, kmhToMs, msToKmh } from './idm';
import { TrafficSimulation, laneLayout, type Lane } from './simulation';
import { DEFAULT_MIX, VEHICLE_CLASSES, pickClass } from './vehicles';

const car = VEHICLE_CLASSES.automovil;
const params = {
  desiredSpeedMs: kmhToMs(car.desiredSpeedKmh),
  maxAccelMs2: car.maxAccelMs2,
  comfortDecelMs2: car.comfortDecelMs2,
  minGapM: car.minGapM,
  timeHeadwayS: car.timeHeadwayS,
};

describe('modelo de seguimiento IDM', () => {
  it('con vía libre y parado, acelera al máximo', () => {
    // v = 0 anula el término de velocidad deseada: queda a · 1.
    expect(idmAcceleration(params, 0, null)).toBeCloseTo(params.maxAccelMs2, 10);
  });

  it('a la velocidad deseada y con vía libre, no acelera', () => {
    expect(idmAcceleration(params, params.desiredSpeedMs, null)).toBeCloseTo(0, 10);
  });

  it('por encima de la deseada, frena', () => {
    expect(idmAcceleration(params, params.desiredSpeedMs * 1.2, null)).toBeLessThan(0);
  });

  it('reproduce el exponente del artículo', () => {
    // A la mitad de la velocidad deseada el término libre vale 1 − (1/2)^4.
    const half = params.desiredSpeedMs / 2;
    const expected = params.maxAccelMs2 * (1 - Math.pow(0.5, IDM_DELTA));
    expect(idmAcceleration(params, half, null)).toBeCloseTo(expected, 10);
    expect(IDM_DELTA).toBe(4);
  });

  it('frena cuando se acerca a quien va más despacio', () => {
    const accel = idmAcceleration(params, kmhToMs(60), { gapM: 8, speedMs: kmhToMs(20) });
    expect(accel).toBeLessThan(-1);
  });

  /**
   * Contraste del modelo contra su propia solución analítica: en el hueco de
   * equilibrio, y con el de delante a la misma velocidad, la aceleración es
   * exactamente cero.
   */
  it('en el hueco de equilibrio no acelera ni frena', () => {
    const v = kmhToMs(50);
    const gap = idmEquilibriumGap(params, v);
    expect(idmAcceleration(params, v, { gapM: gap, speedMs: v })).toBeCloseTo(0, 10);
  });

  it('con el hueco de s₀+v·T todavía frena, que no es el de equilibrio', () => {
    const v = kmhToMs(50);
    const shorter = params.minGapM + v * params.timeHeadwayS;
    // Es un error corriente confundir el intervalo deseado con el equilibrio:
    // el de equilibrio es mayor, porque hay que dejar sitio para el término de
    // velocidad deseada.
    expect(shorter).toBeLessThan(idmEquilibriumGap(params, v));
    expect(idmAcceleration(params, v, { gapM: shorter, speedMs: v })).toBeLessThan(0);
  });

  it('a la velocidad deseada no hay hueco que permita seguir a otro', () => {
    expect(idmEquilibriumGap(params, params.desiredSpeedMs)).toBe(Number.POSITIVE_INFINITY);
  });

  it('un hueco ya cerrado da freno máximo y no un número desbocado', () => {
    const accel = idmAcceleration(params, kmhToMs(50), { gapM: -1, speedMs: 0 });
    expect(Number.isFinite(accel)).toBe(true);
    expect(accel).toBeLessThan(0);
  });

  it('la velocidad nunca baja de cero ni el vehículo retrocede', () => {
    const step = idmStep(params, 100, 0.2, { gapM: 0.5, speedMs: 0 }, 0.1);
    expect(step.speedMs).toBe(0);
    expect(step.positionM).toBeGreaterThanOrEqual(100);
  });

  it('convierte unidades sin perder nada por el camino', () => {
    expect(msToKmh(kmhToMs(60))).toBeCloseTo(60, 10);
    expect(kmhToMs(36)).toBeCloseTo(10, 10);
  });
});

describe('reparto por tipo de vehículo', () => {
  it('respeta los tramos del reparto', () => {
    expect(pickClass(DEFAULT_MIX, 0)).toBe('automovil');
    expect(pickClass(DEFAULT_MIX, 0.99)).toBe('camion');
  });

  it('el reparto por omisión suma uno', () => {
    const total = DEFAULT_MIX.automovil + DEFAULT_MIX.motocicleta
      + DEFAULT_MIX.bus + DEFAULT_MIX.camion;
    expect(total).toBeCloseTo(1, 10);
  });

  it('con un reparto vacío no se cuelga ni devuelve basura', () => {
    const empty = { automovil: 0, motocicleta: 0, bus: 0, camion: 0 };
    expect(pickClass(empty, 0.5)).toBe('automovil');
  });
});

describe('reparto de carriles', () => {
  it('coloca los carriles simétricos y en los dos sentidos', () => {
    const lanes = laneLayout(2, 3.5, 900);
    expect(lanes).toHaveLength(4);
    expect(lanes.filter((lane) => lane.direction === 1)).toHaveLength(2);
    expect(lanes.filter((lane) => lane.direction === -1)).toHaveLength(2);
    // Los dos sentidos quedan a un lado y otro del eje.
    expect(lanes[0].offsetM).toBeLessThan(0);
    expect(lanes[2].offsetM).toBeGreaterThan(0);
    // Y la separación entre carriles contiguos es el ancho de carril.
    expect(Math.abs(lanes[1].offsetM - lanes[0].offsetM)).toBeCloseTo(3.5, 6);
  });
});

const oneLane: Lane[] = [
  { id: 'C1', label: 'Carril único', offsetM: -1.75, direction: 1, flowVehPerHour: 600 },
];

describe('circulación sobre el tablero', () => {
  it('los vehículos entran, avanzan y salen', () => {
    const sim = new TrafficSimulation({ deckLengthM: 550, lanes: oneLane, seed: 7 });
    sim.advance(30);
    expect(sim.all.length).toBeGreaterThan(0);
    for (const vehicle of sim.all) {
      expect(vehicle.positionM).toBeGreaterThanOrEqual(0);
      expect(vehicle.positionM).toBeLessThanOrEqual(600);
      expect(vehicle.speedMs).toBeGreaterThan(0);
    }
    // En 550 m a unos 50 km/h el primero ya debería haber salido pasado un rato.
    sim.advance(90);
    expect(sim.stats().completed).toBeGreaterThan(0);
  });

  it('es reproducible: misma semilla, mismo resultado', () => {
    const a = new TrafficSimulation({ deckLengthM: 550, lanes: oneLane, seed: 42 });
    const b = new TrafficSimulation({ deckLengthM: 550, lanes: oneLane, seed: 42 });
    a.advance(60);
    b.advance(60);
    expect(a.all.map((v) => [v.classId, v.positionM.toFixed(6)]))
      .toEqual(b.all.map((v) => [v.classId, v.positionM.toFixed(6)]));
  });

  it('semillas distintas dan tráficos distintos', () => {
    const a = new TrafficSimulation({ deckLengthM: 550, lanes: oneLane, seed: 1 });
    const b = new TrafficSimulation({ deckLengthM: 550, lanes: oneLane, seed: 2 });
    a.advance(60);
    b.advance(60);
    expect(a.all.map((v) => v.classId).join()).not.toBe(b.all.map((v) => v.classId).join());
  });

  it('nunca se solapan dos vehículos del mismo carril', () => {
    const sim = new TrafficSimulation({
      // Intensidad muy alta y tablero corto: es donde se solaparían si el
      // modelo no respetara la separación.
      deckLengthM: 250, seed: 3,
      lanes: [{ ...oneLane[0], flowVehPerHour: 2200 }],
    });
    for (let i = 0; i < 60; i += 1) {
      sim.advance(2);
      const ordered = [...sim.all].sort((x, y) => x.positionM - y.positionM);
      for (let k = 1; k < ordered.length; k += 1) {
        const behind = ordered[k - 1];
        const ahead = ordered[k];
        const gap = ahead.positionM - behind.positionM - VEHICLE_CLASSES[ahead.classId].lengthM;
        expect(gap).toBeGreaterThan(-0.5);
      }
    }
  });

  it('el sentido contrario recorre el tablero al revés', () => {
    const sim = new TrafficSimulation({
      deckLengthM: 550, seed: 5,
      lanes: [{ id: 'C2', label: 'sur', offsetM: 1.75, direction: -1, flowVehPerHour: 900 }],
    });
    sim.advance(10);
    const vehicle = sim.all[0];
    expect(vehicle).toBeDefined();
    const before = vehicle.positionM;
    sim.advance(5);
    const after = sim.all.find((item) => item.id === vehicle.id);
    if (after) expect(after.positionM).toBeLessThan(before);
  });

  it('el límite de velocidad recorta la velocidad deseada', () => {
    const sim = new TrafficSimulation({
      deckLengthM: 550, lanes: oneLane, seed: 9, speedLimitKmh: 30,
    });
    // La moto quiere ir a 65 km/h, pero con límite de 30 no puede.
    expect(msToKmh(sim.params('motocicleta').desiredSpeedMs)).toBeCloseTo(30, 6);
    sim.advance(40);
    for (const vehicle of sim.all) expect(msToKmh(vehicle.speedMs)).toBeLessThan(31);
  });

  it('sin límite declarado no se inventa uno', () => {
    const sim = new TrafficSimulation({ deckLengthM: 550, lanes: oneLane, seed: 9 });
    expect(msToKmh(sim.params('motocicleta').desiredSpeedMs))
      .toBeCloseTo(VEHICLE_CLASSES.motocicleta.desiredSpeedKmh, 6);
  });

  it('una intensidad nula deja el puente vacío', () => {
    const sim = new TrafficSimulation({
      deckLengthM: 550, seed: 4,
      lanes: [{ ...oneLane[0], flowVehPerHour: 0 }],
    });
    sim.advance(300);
    expect(sim.all).toHaveLength(0);
    expect(sim.stats().meanSpeedKmh).toBeNull();
  });

  it('las estadísticas cuadran con lo que hay en el tablero', () => {
    const sim = new TrafficSimulation({ deckLengthM: 550, lanes: oneLane, seed: 11 });
    sim.advance(60);
    const stats = sim.stats();
    const sum = stats.countByClass.automovil + stats.countByClass.motocicleta
      + stats.countByClass.bus + stats.countByClass.camion;
    expect(sum).toBe(stats.count);
    expect(stats.count).toBe(sim.all.length);
    expect(stats.densityVehPerKmLane)
      .toBeCloseTo(sim.all.length / 0.55, 6);
  });

  it('un paso grande se parte y no desestabiliza el modelo', () => {
    const sim = new TrafficSimulation({ deckLengthM: 550, lanes: oneLane, seed: 13 });
    // Diez segundos de golpe: si se integrara en un solo paso, aparecerían
    // velocidades imposibles.
    sim.advance(10);
    for (const vehicle of sim.all) {
      expect(Number.isFinite(vehicle.positionM)).toBe(true);
      expect(msToKmh(vehicle.speedMs)).toBeLessThan(120);
    }
  });
});

import { describe, expect, it } from 'vitest';

import { ACQUISITION, rawBytesPerDay } from '../station-design';
import { ShmStationSimulation, SPANS_M, TEST_SCENARIO, crc32, stationGeometry } from './station-sim';

const ONE = 'SD-V2-M';

function run(seconds: number, setup?: (sim: ShmStationSimulation) => void) {
  const sim = new ShmStationSimulation();
  setup?.(sim);
  sim.step(seconds);
  return sim;
}
const st = (sim: ShmStationSimulation, id = ONE) => sim.snapshot().stations.find((s) => s.id === id)!;

describe('gemelo funcional de la estación SHM', () => {
  it('usa los vanos publicados de La Novena y los mismos nombres que el modelo 3D', () => {
    expect(SPANS_M).toEqual([129.2, 292.4, 129.2]);
    const ids = stationGeometry().map((g) => g.id);
    expect(ids).toHaveLength(10);
    expect(ids).toContain('SD-V1-Q1');
    expect(ids).toContain('SD-V2-M-T');
  });

  it('sin fallas: todo NORMAL, registros válidos y entregados', () => {
    const sim = run(60);
    for (const s of sim.snapshot().stations) {
      expect(s.states, s.id).toEqual(['NORMAL']);
      expect(s.contractProblems, s.id).toEqual([]);
      expect(s.deliveredRecords, s.id).toBe(5);
      expect(s.windows).toBe(6);
    }
  });

  it('la microSD se llena al ritmo que calcula el diseño (§10)', () => {
    const s = st(run(60));
    const perSecond = rawBytesPerDay() / 86400;
    expect(s.storageUsedBytes).toBeCloseTo(perSecond * 60, 0);
    expect(TEST_SCENARIO.windowS * ACQUISITION.sampleRateHz).toBe(2000);
  });

  it('acelerómetro desconectado: huecos y SENSOR_FAULT, nunca ceros', () => {
    const sim = run(20, (x) => x.setFault(ONE, 'sensor', true));
    expect(st(sim).states).toEqual(expect.arrayContaining(['SENSOR_FAULT', 'DATA_GAP']));
    expect(st(sim).lastRecord?.health.sensor_ok).toBe(false);
    expect(Array.from(sim.recentZ(ONE)).every(Number.isNaN)).toBe(true);
    // Las demás estaciones siguen bien.
    expect(st(sim, 'SD-V1-Q1').states).toEqual(['NORMAL']);
  });

  it('sin PPS: TIME_HOLDOVER; sin hora: TIME_INVALID', () => {
    expect(st(run(10, (x) => x.setFault(ONE, 'pps', true))).states).toContain('TIME_HOLDOVER');
    expect(st(run(10, (x) => x.setFault(ONE, 'tiempo', true))).states).toContain('TIME_INVALID');
  });

  it('Ethernet caído: se encola y al volver se entrega con la hora de muestreo original', () => {
    const sim = run(30, (x) => x.setFault(ONE, 'ethernet', true));
    expect(st(sim).states).toContain('COMM_LOST');
    expect(st(sim).pendingRecords).toBe(3);
    expect(st(sim).deliveredRecords).toBe(0);
    sim.setFault(ONE, 'ethernet', false);
    sim.step(1);
    const s = st(sim);
    expect(s.pendingRecords).toBe(0);
    expect(s.deliveredRecords).toBe(3);
    expect(s.lastRecord!.received_utc).not.toBe(s.lastRecord!.timestamp_utc);
    expect(s.contractProblems).toEqual([]);
  });

  it('archivo corrupto y fallo de SD: STORAGE_FAULT, y sin SD no se guarda', () => {
    expect(st(run(10, (x) => x.setFault(ONE, 'crc', true))).states).toContain('STORAGE_FAULT');
    const s = st(run(10, (x) => x.setFault(ONE, 'sd', true)));
    expect(s.states).toContain('STORAGE_FAULT');
    expect(s.storageUsedBytes).toBe(0);
  });

  it('alimentación baja: sin tensión mínima en el diseño, la regla queda «no evaluada»', () => {
    const s = st(run(10, (x) => x.setFault(ONE, 'alimentacion', true)));
    expect(s.states).not.toContain('POWER_LOW');
    expect(s.notEvaluated.join(' ')).toMatch(/tensión mínima/);
    const withMin = new ShmStationSimulation({ ...TEST_SCENARIO, minSupplyV: 18 });
    withMin.setFault(ONE, 'alimentacion', true);
    withMin.step(10);
    expect(st(withMin).states).toContain('POWER_LOW');
  });

  it('un golpe satura una ventana y la siguiente vuelve a NORMAL', () => {
    const sim = run(10, (x) => x.setFault(ONE, 'impacto', true));
    expect(st(sim).states).toContain('SATURATED');
    expect(st(sim).faults).toEqual([]);
    sim.step(10);
    expect(st(sim).states).toEqual(['NORMAL']);
  });

  it('la clasificación estructural se niega: no hay umbrales firmados', () => {
    const d = run(10).snapshot().structural;
    expect(d.level).toBeNull();
    expect(d.blocked).toMatch(/umbrales/);
  });

  it('es determinista y la vibración sintética no es solo ruido', () => {
    const a = st(run(120));
    const b = st(run(120));
    expect(a.lastRmsZ).toBe(b.lastRmsZ);
    expect(a.lastRmsZ!).toBeGreaterThan(0);
  });

  it('CRC-32 estándar', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe('cbf43926');
  });
});

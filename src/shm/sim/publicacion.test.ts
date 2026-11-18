import { describe, expect, it } from 'vitest';

import { validateStationRecord } from '../data-contract';
import novenaGemelo from '../../../proyectos/novena-gemelo/proyecto.json';
import { aPlataforma } from './publicacion';
import { ShmStationSimulation, TEST_SCENARIO } from './station-sim';

describe('gemelo → plataforma', () => {
  it('la bandeja entrega cada registro una sola vez', () => {
    const sim = new ShmStationSimulation();
    sim.step(TEST_SCENARIO.windowS * 3);
    const primeros = sim.takeDelivered();
    expect(primeros.length).toBeGreaterThan(0);
    expect(sim.takeDelivered()).toEqual([]);
  });

  it('cambia identidad y hora, y sigue cumpliendo el contrato', () => {
    const sim = new ShmStationSimulation();
    sim.step(TEST_SCENARIO.windowS * 3);
    const r = sim.takeDelivered().find((x) => x.station_id === 'SD-V2-M')!;
    const desfase = Date.parse('2026-11-18T18:00:00Z') - Date.parse(r.timestamp_utc);
    const p = aPlataforma(r, desfase);
    expect(p.station_id).toBe('GEM-SD-V2-M');
    expect(p.sensor_id).toBe('ADXL355-GEM-SD-V2-M');
    expect(p.timestamp_utc).toBe('2026-11-18T18:00:00.000Z');
    expect(p.received_utc).toBeUndefined();
    expect(p.samples_file).toContain('/GEM-SD-V2-M/');
    expect(validateStationRecord(p)).toEqual([]);
    expect(r.station_id).toBe('SD-V2-M'); // el original no se toca
  });

  it('todas las estaciones del gemelo existen en proyectos/novena-gemelo con su sensor', () => {
    const sim = new ShmStationSimulation();
    sim.step(TEST_SCENARIO.windowS * 2);
    const declaradas = new Map(novenaGemelo.estaciones.map((e) => [e.id, e.sensores[0].id]));
    const ids = new Set(sim.takeDelivered().map((r) => aPlataforma(r, 0)).map((r) => `${r.station_id}|${r.sensor_id}`));
    expect(ids.size).toBe(10);
    for (const x of ids) {
      const [sid, sensor] = x.split('|');
      expect(declaradas.get(sid), sid).toBe(sensor);
    }
  });
});

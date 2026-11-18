import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { estacionesGemelo, publicarRegistros, variableClave } from './gemeloPublisher';
import type { MensajeMqtt, MqttCredenciales } from './mqttLite';

const RAIZ = join(__dirname, '..');

function registro(station: string, sensor = `ADXL355-${station}`) {
  return {
    schema_version: '1.0', station_id: station, sensor_id: sensor, timestamp_utc: '2026-11-18T18:00:00.000Z',
    time_quality: 'GNSS_LOCKED', time_uncertainty_us: null, sample_rate_hz: 200, axes: ['longitudinal', 'transversal', 'vertical'],
    units: 'm/s2', range_g: 2, filter_id: 'sim-f0', firmware_version: 'sim-0.1.0', calibration_id: null,
    samples_file: `sim/${station}/000001.bin`, samples_crc32: '0a1b2c3d', states: ['NORMAL'],
    health: { sensor_ok: true, storage_ok: true, pps_locked: true, supply_v: 24 }, simulated: true,
  };
}

describe('publicación del gemelo', () => {
  let root: string;
  const enviados: { c: MqttCredenciales; m: MensajeMqtt[] }[] = [];
  const publicador = async (c: MqttCredenciales, m: MensajeMqtt[]) => { enviados.push({ c, m }); return m.length; };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'gem-'));
    cpSync(join(RAIZ, 'proyectos'), join(root, 'proyectos'), { recursive: true });
    mkdirSync(join(root, 'plataforma'));
    writeFileSync(join(root, 'plataforma', '.env'), `DB_PASSWORD=x\n${variableClave('GEM-SD-V2-M')}=clave-gem\nMQTT_SD_V2_M_PASSWORD=clave-real\n`);
    enviados.length = 0;
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('solo las estaciones «gemelo-app» del proyecto novena-gemelo', () => {
    const m = estacionesGemelo(root);
    expect(m.size).toBe(10);
    expect(m.get('GEM-SD-V2-M')).toEqual({ proyecto: 'novena-gemelo', sensorId: 'ADXL355-GEM-SD-V2-M' });
    expect(m.has('SD-V2-M')).toBe(false); // la del firmware en «novena» no se puede suplantar
  });

  it('publica lo válido con la clave de su estación y rechaza lo demás explicando por qué', async () => {
    const r = await publicarRegistros(root, [
      registro('GEM-SD-V2-M'),
      registro('SD-V2-M'),                                   // estación de otro proyecto
      { ...registro('GEM-SD-V2-M'), states: ['INVENTADO'] }, // no cumple el contrato
      registro('GEM-SD-V2-M', 'OTRO-SENSOR'),                // sensor equivocado
      registro('GEM-SD-V1-Q1'),                              // sin usuario en el broker
    ], { env: {}, publicador });
    expect(r.publicados).toBe(1);
    expect(enviados).toHaveLength(1);
    expect(enviados[0].c).toMatchObject({ usuario: 'GEM-SD-V2-M', clave: 'clave-gem', host: '127.0.0.1', port: 1883 });
    expect(enviados[0].m[0].topic).toBe('shm/v1/GEM-SD-V2-M/registro');
    const motivos = r.rechazados.map((x) => `${x.station_id}: ${x.motivo}`).join('\n');
    expect(motivos).toContain('SD-V2-M: No es una estación del gemelo');
    expect(motivos).toContain('No cumple el contrato');
    expect(motivos).toContain('El sensor debe ser «ADXL355-GEM-SD-V2-M»');
    expect(motivos).toContain('GEM-SD-V1-Q1: La estación no tiene usuario en el broker');
  });
});

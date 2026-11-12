/**
 * Compila la lógica del firmware de la estación (C) para este ordenador y
 * pasa cada registro que produce por el contrato de datos de la plataforma.
 * Así el C y el TypeScript no pueden divergir sin que una prueba lo diga.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { validateStationRecord } from './data-contract';

const dir = resolve(__dirname, '../../firmware/shm-station');
const bin = resolve(dir, 'build/host_test');

function hasCompiler(): boolean {
  try {
    execFileSync('cc', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!hasCompiler())('firmware de la estación compilado para el ordenador', () => {
  mkdirSync(resolve(dir, 'build'), { recursive: true });
  execFileSync('cc', [
    '-std=c11', '-Wall', '-Wextra', '-Werror', '-O1', '-Iinclude',
    'src/station.c', 'src/host_test.c', '-lm', '-o', bin,
  ], { cwd: dir });
  const out = execFileSync(bin, { encoding: 'utf8' });
  const records = Object.fromEntries(out.trim().split('\n').map((l) => {
    const [name, json] = l.split('\t');
    return [name, JSON.parse(json)];
  }));

  it('cada registro cumple el contrato de datos', () => {
    expect(Object.keys(records)).toHaveLength(7);
    for (const [name, r] of Object.entries(records)) expect(validateStationRecord(r), name).toEqual([]);
  });

  it('cada falla da el estado que pide el diseño', () => {
    expect(records.normal.states).toEqual(['NORMAL']);
    expect(records.sin_pps.states).toEqual(['TIME_HOLDOVER']);
    expect(records.sin_hora.states).toEqual(['TIME_INVALID']);
    expect(records.sensor.states).toEqual(['SENSOR_FAULT', 'DATA_GAP']);
    expect(records.huecos.states).toEqual(['DATA_GAP']);
    expect(records.saturado.states).toEqual(['SATURATED']);
    expect(records.sin_sd.states).toEqual(['STORAGE_FAULT']);
  });

  it('el firmware completo (app.c) con la placa simulada detecta cada falla', () => {
    execFileSync('make', ['sim'], { cwd: dir, stdio: 'ignore' });
    const out = execFileSync(resolve(dir, 'build/shm-sim'), [
      'renode/feeds/sd-v2-m.csv', '--seconds', '60',
      '--fault', 'sensor@15-25', '--fault', 'pps@32-45', '--fault', 'impacto@52',
    ], { cwd: dir, encoding: 'utf8' });
    const recs = out.split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));
    expect(recs).toHaveLength(6);
    for (const r of recs) expect(validateStationRecord(r)).toEqual([]);
    // Con el sensor fuera del bus, huecos marcados y SENSOR_FAULT; nunca ceros como dato.
    expect(recs[1].states).toEqual(expect.arrayContaining(['SENSOR_FAULT', 'DATA_GAP']));
    expect(recs[1].gaps).toBe(1000);
    expect(recs[2].states).toContain('DATA_GAP');
    expect(recs[3].states).toContain('TIME_HOLDOVER');
    expect(recs[5].states).toContain('SATURATED');
    expect(recs[0].states).toEqual(['STORAGE_FAULT']);
    // El driver de microSD no existe: se declara siempre.
    for (const r of recs) expect(r.states).toContain('STORAGE_FAULT');
  });

  it('la hora sale de la trama RMC del GNSS y el PPS se declara', () => {
    expect(records.normal.timestamp_utc).toBe('2026-11-12T12:00:00.000Z');
    expect(records.normal.health.pps_locked).toBe(true);
    expect(records.sin_pps.health.pps_locked).toBe(false);
  });
});

function hasMono(): boolean {
  try {
    execFileSync('mcs', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!hasMono())('modelo del ADXL355 para Renode', () => {
  it('responde a la secuencia SPI del firmware', () => {
    const out = execFileSync('make', ['model-test'], { cwd: dir, encoding: 'utf8' });
    expect(out).toContain('MODELO OK');
    expect(out).not.toContain('FALLO');
  });
});

/**
 * Señal de prueba para el ADXL355 emulado en Renode: 30 s de la estación
 * SD-V2-M sacados del gemelo funcional (vibración SINTÉTICA), en g.
 *
 * Regenerar: UPDATE_FEED=1 npx vitest run src/shm/sim/renode-feed.test.ts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { G } from '../events';
import { ShmStationSimulation } from './station-sim';

const FILE = resolve(__dirname, '../../../firmware/shm-station/renode/feeds/sd-v2-m.csv');
const SECONDS = 30;

export function renodeFeed(): string {
  const sim = new ShmStationSimulation();
  sim.step(20); // que el tráfico ya esté en el puente
  sim.startRecording('SD-V2-M');
  sim.step(SECONDS);
  const rows = sim.stopRecording();
  const lines = [
    '# Señal SINTÉTICA del gemelo funcional (src/shm/sim/station-sim.ts), estación SD-V2-M.',
    '# No es una medida del viaducto. Columnas: x,y,z en g; 200 muestras por segundo.',
    ...rows.map((r) => r.map((v) => ((v ?? 0) / G).toFixed(6)).join(',')),
  ];
  return `${lines.join('\n')}\n`;
}

describe('señal para Renode', () => {
  it('es la del gemelo y está al día', () => {
    const feed = renodeFeed();
    if (process.env.UPDATE_FEED) writeFileSync(FILE, feed);
    expect(existsSync(FILE)).toBe(true);
    expect(readFileSync(FILE, 'utf8')).toBe(feed);
    const data = feed.split('\n').filter((l) => l && !l.startsWith('#'));
    expect(data).toHaveLength(SECONDS * 200);
    const z = data.map((l) => Number(l.split(',')[2]));
    expect(Math.min(...z)).toBeGreaterThan(0.9);
    expect(Math.max(...z)).toBeLessThan(1.1);
  });
});

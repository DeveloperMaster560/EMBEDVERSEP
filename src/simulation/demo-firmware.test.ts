/**
 * El firmware de demostración que se publica en `public/firmware` tiene que
 * ejecutarse de verdad sobre el circuito de ejemplo del laboratorio.
 *
 * Esta prueba lo ejecuta de principio a fin: si alguien cambia el fuente, el
 * generador o el circuito de ejemplo y el LED deja de conmutar, falla aquí y no
 * delante del usuario.
 *
 * Se carga con `import.meta.glob` y no con `node:fs` para que la prueba viva en
 * el mismo proyecto de TypeScript que la aplicación.
 */

import { describe, expect, it } from 'vitest';

import { createArduinoPracticeCircuit } from '../domain/circuit';
import { SimulationSession } from './session';

const firmware = import.meta.glob('../../public/firmware/*.hex', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const entries = Object.entries(firmware);

describe('firmware de demostración publicado', () => {
  it('hay al menos uno', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it.each(entries)('%s se carga y conmuta el LED del circuito de ejemplo', (_path, hex) => {
    const circuit = createArduinoPracticeCircuit('arduino-uno');
    const session = SimulationSession.fromHex(hex, circuit, { maxStepMillis: 400 });

    // El circuito de ejemplo tiene el LED en una salida digital y el MPU6050
    // en el bus I²C: uno se simula y el otro queda declarado sin simular.
    expect(session.simulable).toBe(true);
    expect(session.unresolved.map((item) => item.reason).join(' ')).toMatch(/MPU6050/);

    // El semiciclo son unos 0,5 s por retardo de bucle. Recorriendo 1,2 s en
    // tramos hay que ver el LED encendido en algún momento y apagado en otro.
    const seen = new Set<boolean>();
    for (let step = 0; step < 6; step += 1) {
      const report = session.advance(200);
      const led = report.readings.find((reading) => reading.kind === 'led');
      expect(led).toBeDefined();
      seen.add(led!.active);
    }
    expect([...seen].sort()).toEqual([false, true]);

    // Y tiene que haber hablado por el puerto serie, que es la otra mitad.
    expect(session.report().serial).toMatch(/[01]/);
  });
});

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

/** Nombre corto del archivo, para que los nombres de las pruebas se lean. */
const basename = (path: string) => path.split('/').pop() ?? path;

describe('firmware publicado', () => {
  it('hay al menos uno', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  /**
   * Afirmación válida para TODOS: cualquier .hex publicado tiene que poder
   * leerse y cargarse. Lo que cada uno hace después es cosa suya, y se
   * comprueba por separado: el del armario del puente, en
   * `bridge-controller.test.ts`.
   */
  it.each(entries)('%s se lee y arranca sin reventar', (_path, hex) => {
    const circuit = createArduinoPracticeCircuit('arduino-uno');
    const session = SimulationSession.fromHex(hex, circuit, { maxStepMillis: 400 });
    expect(session.simulable).toBe(true);
    expect(() => session.advance(50)).not.toThrow();
    // El circuito de ejemplo lleva el MPU6050 en el bus I²C, que no se simula:
    // tiene que quedar declarado, no descartado en silencio.
    expect(session.unresolved.map((item) => item.reason).join(' ')).toMatch(/MPU6050/);
  });
});

describe('firmware de demostración', () => {
  const demo = entries.find(([path]) => basename(path) === 'alumbrado-demo.hex');

  it('está publicado', () => {
    expect(demo).toBeDefined();
  });

  it('conmuta el LED del circuito de ejemplo y habla por el puerto serie', () => {
    if (!demo) throw new Error('No está publicado alumbrado-demo.hex');
    const session = SimulationSession.fromHex(
      demo[1], createArduinoPracticeCircuit('arduino-uno'), { maxStepMillis: 400 },
    );

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
    expect(session.report().serial).toMatch(/[01]/);
  });
});

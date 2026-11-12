/**
 * Genera `firmware/shm-station/include/pinout.h` a partir de los mismos datos
 * que dibujan el circuito (`pinoutTable`, `RMII_PINS_LQFP100`,
 * `DEBUG_INTERFACE`). Así el firmware y la aplicación no pueden discrepar: la
 * prueba `firmware-pinout.test.ts` falla si el archivo C no coincide.
 */

import { pinoutTable } from './engineering-proposal';
import { DEBUG_INTERFACE, RMII_PINS_LQFP100 } from './station-design';

export const PINOUT_HEADER_PATH = 'firmware/shm-station/include/pinout.h';

function parseGpio(gpio: string): { port: string; pin: number } {
  const m = /^P([A-K])(\d{1,2})$/.exec(gpio);
  if (!m) throw new Error(`GPIO no reconocido: ${gpio}`);
  return { port: m[1], pin: Number(m[2]) };
}

function afOf(fn: string): number | null {
  const m = /\bAF(\d{1,2})\b/.exec(fn);
  return m ? Number(m[1]) : null;
}

function cName(signal: string): string {
  return signal.replace(/[^A-Za-z0-9]/g, '_').toUpperCase();
}

export function firmwarePinoutHeader(): string {
  const lines: string[] = [
    '/*',
    ' * pinout.h - GENERADO por src/shm/firmware-pinout.ts. NO EDITAR A MANO.',
    ' * Para regenerarlo: UPDATE_PINOUT=1 npx vitest run src/shm/firmware-pinout.test.ts',
    ' *',
    ' * STM32H743VIT6 (LQFP100). Pinout del diseño de ingenierías con la corrección',
    ' * SPI1 (RV-01/RV-04) y la propuesta técnica SIN FIRMAR para los GPIO libres.',
    ' * MODE: 0 entrada, 1 salida, 2 función alternativa.',
    ' */',
    '#ifndef SHM_PINOUT_H',
    '#define SHM_PINOUT_H',
    '',
  ];
  const rows = pinoutTable();
  for (const r of rows) {
    const n = cName(r.signal);
    if (!r.gpio) {
      lines.push(`/* ${r.signal}: sin GPIO asignado (${r.fn}). */`, '');
      continue;
    }
    const { port, pin } = parseGpio(r.gpio);
    const af = afOf(r.fn);
    const mode = af !== null ? 2 : r.direction === 'salida' ? 1 : 0;
    lines.push(
      `/* ${r.signal}: ${r.gpio}, patilla ${r.lqfp100Pin ?? '?'}, ${r.fn} [${r.origin}] */`,
      `#define PIN_${n}_PORT  GPIO${port}`,
      `#define PIN_${n}_PIN   ${pin}u`,
      `#define PIN_${n}_MODE  ${mode}u`,
      `#define PIN_${n}_AF    ${af ?? 0}u`,
      '',
    );
  }
  lines.push('/* Ethernet RMII: todos en AF11 (DS12110 Rev 11). */');
  for (const [gpio, fn] of Object.entries(RMII_PINS_LQFP100)) {
    const { port, pin } = parseGpio(gpio);
    const n = cName(fn);
    lines.push(`#define PIN_${n}_PORT  GPIO${port}`, `#define PIN_${n}_PIN   ${pin}u`, `#define PIN_${n}_AF    11u`);
  }
  lines.push(
    '',
    `/* Depuración: solo SWD (${DEBUG_INTERFACE.swd.swdio} SWDIO, ${DEBUG_INTERFACE.swd.swclk} SWCLK). Sin JTAG ni SWO: PB3/PB4 quedan libres para SPI1. */`,
    `#define SHM_DEBUG_JTAG  ${DEBUG_INTERFACE.jtag ? 1 : 0}`,
    `#define SHM_DEBUG_SWO   ${DEBUG_INTERFACE.swo ? 1 : 0}`,
    '',
    '#endif /* SHM_PINOUT_H */',
    '',
  );
  return lines.join('\n');
}

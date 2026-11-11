import { describe, expect, it } from 'vitest';

import {
  DESIGN_EXTI_LINES,
  PART_SELECTIONS,
  PROPOSAL,
  PROPOSED_CONNECTORS,
  PROPOSED_SIGNALS,
  fullPinout,
  pinoutTable,
  reservedPins,
} from './engineering-proposal';
import { LQFP100_PIN, LQFP100_PINOUT, MCU_SIGNALS, RMII_PINS_LQFP100, gpioOfPin } from './station-design';

describe('propuesta técnica para lo que el diseño dejó abierto', () => {
  it('se identifica como propuesta sin firmar, no como decisión de ingenierías', () => {
    expect(PROPOSAL.status).toBe('propuesta sin firmar');
    expect(PROPOSAL.author).toMatch(/Claude/);
  });

  it('con la propuesta, todas las señales tienen pin', () => {
    expect(fullPinout().filter((s) => s.gpio === null)).toEqual([]);
  });

  it('ningún GPIO se usa dos veces en el pinout completo', () => {
    const used = fullPinout().map((s) => s.gpio);
    expect(new Set(used).size).toBe(used.length);
  });

  it('nada pisa el RMII ni el SWD', () => {
    const reserved = reservedPins();
    for (const s of fullPinout()) expect(reserved.has(s.gpio!), `${s.signal}@${s.gpio}`).toBe(false);
  });

  it('cada interrupción tiene su propia línea EXTI y coincide con el número de pin', () => {
    const lines = PROPOSED_SIGNALS.filter((p) => p.exti !== undefined).map((p) => p.exti!);
    expect(new Set([...lines, ...DESIGN_EXTI_LINES]).size).toBe(lines.length + DESIGN_EXTI_LINES.length);
    for (const p of PROPOSED_SIGNALS.filter((x) => x.exti !== undefined)) {
      expect(Number(p.gpio!.slice(2)), p.signal).toBe(p.exti);
    }
  });

  it('el pulso de sincronía comparte temporizador con la captura del PPS', () => {
    const sync = PROPOSED_SIGNALS.find((p) => p.signal === 'SENSOR_SYNC')!;
    const pps = MCU_SIGNALS.find((s) => s.signal === 'GNSS_PPS')!;
    expect(sync.fn.split('_')[0]).toBe(pps.fn.split('_')[0]);
  });

  it('cada asignación cita la hoja de datos', () => {
    for (const p of PROPOSED_SIGNALS) expect(p.evidence, p.signal).toMatch(/DS12110/);
  });

  it('los componentes elegidos quedan marcados como no verificados', () => {
    for (const p of PART_SELECTIONS) expect(p.verified, p.role).toBe(false);
  });

  it('a los pines del MCU no llega más de 3,3 V por J7', () => {
    const j7 = PROPOSED_CONNECTORS.find((c) => c.id === 'J7')!;
    const toMcu = new Set(MCU_SIGNALS.map((s) => s.signal));
    for (const p of j7.pins) if (toMcu.has(p.signal)) expect(p.volts, p.signal).toBeLessThanOrEqual(3.6);
  });

  it('cada pin del pinout tiene su patilla física verificada', () => {
    for (const r of pinoutTable()) expect(r.lqfp100Pin, `${r.signal}@${r.gpio}`).not.toBeNull();
    expect(pinoutTable().filter((r) => r.origin === 'corregido').map((r) => r.gpio)).toEqual(['PB3', 'PB4', 'PB5']);
  });

  it('el pinout del encapsulado coincide con cada número de patilla usado', () => {
    expect(LQFP100_PINOUT).toHaveLength(100);
    for (const [gpio, n] of Object.entries(LQFP100_PIN)) expect(gpioOfPin(LQFP100_PINOUT[n - 1]), gpio).toBe(gpio);
    for (const p of PROPOSED_SIGNALS) expect(gpioOfPin(LQFP100_PINOUT[p.lqfp100Pin - 1]), p.signal).toBe(p.gpio);
    // Los RMII de la tabla 9: PB11 47, PB12 51, PB13 52.
    expect(LQFP100_PINOUT[46]).toBe('PB11');
    expect(LQFP100_PINOUT[50]).toBe('PB12');
    expect(LQFP100_PINOUT[51]).toBe('PB13');
    for (const g of Object.keys(RMII_PINS_LQFP100)) expect(LQFP100_PINOUT.some((n) => gpioOfPin(n) === g), g).toBe(true);
  });
});

/**
 * El firmware del armario de mando del puente, ejecutado de verdad contra su
 * circuito.
 *
 * Esto es lo que sostiene la afirmación «el puente tiene un sistema embebido y
 * se puede mandar a mano». Si el firmware, el circuito o el trazado cambian y
 * los modos dejan de comportarse como se documenta, falla aquí.
 */

import { describe, expect, it } from 'vitest';

import { BRIDGE_ZONE_PINS, createBridgeLightingCircuit } from '../domain/bridgeLightingCircuit';
import { SimulationSession } from './session';
import type { PhotocellDevice } from './devices';

const firmware = import.meta.glob('../../public/firmware/puente-alumbrado.hex', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const hex = Object.values(firmware)[0];

function arrancar() {
  const session = SimulationSession.fromHex(hex, createBridgeLightingCircuit(), {
    maxStepMillis: 400,
  });
  const fotocelda = session.photocells[0] as PhotocellDevice;
  const mando = session.buttons[0];
  return { session, fotocelda, mando };
}

/** Estado de las cuatro zonas, en el orden vial, tirantes, torres, barreras. */
function zonas(session: SimulationSession): boolean[] {
  const readings = session.report().readings;
  return BRIDGE_ZONE_PINS.map((zone) => {
    const reading = readings.find((item) => item.id === `led-${zone.zone}`);
    if (!reading) throw new Error(`No se simuló el indicador de la zona ${zone.zone}.`);
    return reading.active;
  });
}

/** Pulsa el mando y deja que el firmware atienda el flanco y el antirrebote. */
function pulsar(session: SimulationSession, mando: { setPressed(v: boolean): void }) {
  mando.setPressed(true);
  session.advance(80);
  mando.setPressed(false);
  session.advance(80);
}

describe('circuito del armario de mando', () => {
  it('se traza por completo: nada queda sin simular', () => {
    const { session } = arrancar();
    expect(session.unresolved).toEqual([]);
    // Cuatro indicadores, la fotocelda y el pulsador.
    expect(session.devices).toHaveLength(6);
  });

  it('la fotocelda entra por el canal 0 y el mando por el pin 2', () => {
    const { fotocelda, mando } = arrancar();
    expect(fotocelda.analogChannel).toBe(0);
    expect(mando.pin).toBe(2);
    expect(mando.activeLow).toBe(true);
  });
});

describe('modo automático', () => {
  it('con luz de día las cuatro zonas quedan apagadas', () => {
    const { session, fotocelda } = arrancar();
    fotocelda.setLight(1);
    session.advance(50);
    expect(zonas(session)).toEqual([false, false, false, false]);
  });

  it('al oscurecer se encienden las cuatro', () => {
    const { session, fotocelda } = arrancar();
    fotocelda.setLight(0.05);
    session.advance(50);
    expect(zonas(session)).toEqual([true, true, true, true]);
  });

  it('y vuelven a apagarse al amanecer', () => {
    const { session, fotocelda } = arrancar();
    fotocelda.setLight(0.05);
    session.advance(50);
    fotocelda.setLight(1);
    session.advance(50);
    expect(zonas(session)).toEqual([false, false, false, false]);
  });
});

describe('el operador manda a mano con el pulsador', () => {
  it('una pulsación fuerza todo encendido aunque sea de día', () => {
    const { session, fotocelda, mando } = arrancar();
    fotocelda.setLight(1);
    session.advance(50);
    expect(zonas(session)).toEqual([false, false, false, false]);

    pulsar(session, mando);
    expect(zonas(session)).toEqual([true, true, true, true]);
  });

  it('dos pulsaciones dejan solo la calzada, y solo si es de noche', () => {
    const { session, fotocelda, mando } = arrancar();
    fotocelda.setLight(0.05);
    session.advance(50);
    pulsar(session, mando);
    pulsar(session, mando);
    expect(zonas(session)).toEqual([true, false, false, false]);

    // De día, en este modo, tampoco se enciende la calzada.
    fotocelda.setLight(1);
    session.advance(50);
    expect(zonas(session)).toEqual([false, false, false, false]);
  });

  it('tres pulsaciones apagan todo, incluida la calzada', () => {
    const { session, fotocelda, mando } = arrancar();
    fotocelda.setLight(0.05);
    session.advance(50);
    pulsar(session, mando);
    pulsar(session, mando);
    pulsar(session, mando);
    expect(zonas(session)).toEqual([false, false, false, false]);
  });

  it('la cuarta pulsación vuelve a automático', () => {
    const { session, fotocelda, mando } = arrancar();
    fotocelda.setLight(0.05);
    session.advance(50);
    for (let i = 0; i < 4; i += 1) pulsar(session, mando);
    expect(zonas(session)).toEqual([true, true, true, true]);
  });

  it('mantener pulsado no recorre los modos: solo cuenta el flanco', () => {
    const { session, fotocelda, mando } = arrancar();
    fotocelda.setLight(1);
    session.advance(50);
    mando.setPressed(true);
    // Medio segundo sin soltar. Si contara niveles en vez de flancos, daría
    // muchas vueltas al ciclo de modos y acabaría en cualquier parte.
    for (let i = 0; i < 5; i += 1) session.advance(100);
    expect(zonas(session)).toEqual([true, true, true, true]);
  });
});

describe('telemetría por el puerto serie', () => {
  it('informa del modo y del estado de las cuatro zonas', () => {
    const { session, fotocelda, mando } = arrancar();
    fotocelda.setLight(0.05);
    session.advance(50);
    // Modo automático de noche: las cuatro encendidas.
    expect(session.report().serial).toMatch(/M0 1111/);

    pulsar(session, mando);
    pulsar(session, mando);
    expect(session.report().serial).toMatch(/M2 1000/);
  });

  it('solo informa cuando algo cambia', () => {
    const { session, fotocelda } = arrancar();
    fotocelda.setLight(1);
    session.advance(200);
    const lineas = session.report().serial.trim().split('\n').filter(Boolean);
    // Un estado estable no debe inundar el puerto serie.
    expect(lineas.length).toBeLessThanOrEqual(2);
  });
});

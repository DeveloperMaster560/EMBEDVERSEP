/**
 * El firmware del armario gobernando las luminarias del modelo del puente.
 *
 * Aquí se comprueba el eslabón final: que al pulsar el mando se enciendan los
 * componentes concretos del puente y no un contador abstracto.
 */

import { describe, expect, it } from 'vitest';

import { FirmwareLightingController, parseReportedMode } from './firmware-lighting';
import type { LightingControl, LightingZone } from './lighting-state';

const firmware = import.meta.glob('../../public/firmware/puente-alumbrado.hex', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const hex = Object.values(firmware)[0];

function zona(zone: string, fixtures: string[], power: number | null): LightingZone {
  return {
    zone, label: `Zona ${zone}`, purpose: 'prueba',
    circuitId: `C-${zone}`, switchedBy: 'K1', controllerId: null, driverId: null,
    fixtures, fixtureCount: fixtures.length,
    connectedPowerW: power, nominalVoltageV: 230,
    dimmable: false, colorCapability: null,
  };
}

/**
 * Mando del Viaducto de la Novena con las potencias REALES que devuelve el
 * generador el 10 de noviembre de 2026: vial 3480 W, tirantes 4800 W,
 * torres 4960 W y barreras 1296 W. Los recuentos de luminarias también.
 */
const control: LightingControl = {
  cabinetId: 'ARM-01', sensorId: 'FOT-01', sensorThresholds: null, clockId: null,
  latitudeDeg: 7.1193, longitudeDeg: -73.1227, contactorId: 'K1',
  zones: [
    zona('vial', ['LUM-001', 'LUM-002'], 3480),
    zona('tirantes', ['PROY-001'], 4800),
    zona('torres', ['FOCO-001'], 4960),
    zona('barreras', ['BAN-001'], 1296),
  ],
  totalFixtures: 5, undetermined: [], notSimulated: [],
};

/** El mismo mando, pero con «barreras» sin potencia declarada. */
const sinPotencia: LightingControl = {
  ...control,
  zones: control.zones.map((zone) => (
    zone.zone === 'barreras' ? { ...zone, connectedPowerW: null } : zone
  )),
};

const arrancar = () => new FirmwareLightingController(hex, control);

describe('lectura del modo informado', () => {
  it('toma el último informe, no el primero', () => {
    expect(parseReportedMode('M0 1111\nM1 1111\nM2 1000\n')).toBe(2);
  });

  it('devuelve null si el firmware aún no ha dicho nada', () => {
    expect(parseReportedMode('')).toBeNull();
    expect(parseReportedMode('basura sin formato')).toBeNull();
  });
});

describe('el firmware enciende las luminarias del puente', () => {
  it('de día no hay ninguna encendida', () => {
    const control = arrancar();
    expect(control.ready).toBe(true);
    control.setLight(1);
    const state = control.advance(50);
    expect(state.litCount).toBe(0);
    expect(state.totalPowerW).toBe(0);
  });

  it('al oscurecer enciende los componentes concretos de cada zona', () => {
    const c = arrancar();
    c.setLight(0.05);
    const state = c.advance(50);
    expect([...state.litComponents.keys()].sort())
      .toEqual(['BAN-001', 'FOCO-001', 'LUM-001', 'LUM-002', 'PROY-001']);
    expect(state.mode).toBe(0);
    expect(state.modeName).toBe('Automático');
    // Las cuatro potencias declaradas del viaducto: 3480+4800+4960+1296.
    expect(state.totalPowerW).toBe(14536);
    expect(state.powerNote).toBeNull();
  });

  it('el operador fuerza todo encendido con una pulsación, aunque sea de día', () => {
    const c = arrancar();
    c.setLight(1);
    c.advance(50);
    c.setPressed(true);
    c.advance(80);
    c.setPressed(false);
    const state = c.advance(80);
    expect(state.mode).toBe(1);
    expect(state.litCount).toBe(5);
  });

  it('en «solo vial» solo quedan encendidas las luminarias de la calzada', () => {
    const c = arrancar();
    c.setLight(0.05);
    c.advance(50);
    for (let i = 0; i < 2; i += 1) {
      c.setPressed(true); c.advance(80);
      c.setPressed(false); c.advance(80);
    }
    const state = c.advance(20);
    expect(state.mode).toBe(2);
    expect([...state.litComponents.keys()].sort()).toEqual(['LUM-001', 'LUM-002']);
    // La potencia de la calzada está declarada, así que la suma es exacta.
    expect(state.totalPowerW).toBe(3480);
  });

  it('en mantenimiento no queda nada encendido', () => {
    const c = arrancar();
    c.setLight(0.05);
    c.advance(50);
    for (let i = 0; i < 3; i += 1) {
      c.setPressed(true); c.advance(80);
      c.setPressed(false); c.advance(80);
    }
    const state = c.advance(20);
    expect(state.mode).toBe(3);
    expect(state.litCount).toBe(0);
  });
});

describe('honestidad de la potencia', () => {
  it('una zona encendida sin potencia declarada anula la suma y lo explica', () => {
    const c = new FirmwareLightingController(hex, sinPotencia);
    c.setLight(0.05);
    const state = c.advance(50);
    // Dar un total parcial como si fuera el total sería engañoso.
    expect(state.totalPowerW).toBeNull();
    expect(state.powerNote).toMatch(/barreras/);
  });

  /**
   * Un puente de vigas no tiene tirantes ni torres, y el generador no crea esas
   * zonas. El firmware las energiza igual, pero no encienden nada: tienen que
   * aportar CERO a la suma, no anularla, y quedar declaradas.
   */
  it('una zona que el modelo no tiene aporta cero, no anula el total', () => {
    const vigas: LightingControl = {
      ...control,
      zones: control.zones.filter((zone) => zone.zone === 'vial' || zone.zone === 'barreras'),
    };
    const c = new FirmwareLightingController(hex, vigas);
    c.setLight(0.05);
    const state = c.advance(50);
    expect(state.totalPowerW).toBe(3480 + 1296);
    expect(state.powerNote).toBeNull();
    expect(state.energizedWithoutModelZone.sort()).toEqual(['tirantes', 'torres']);
    const tirantes = state.zones.find((zone) => zone.zone === 'tirantes');
    expect(tirantes!.energized).toBe(true);
    expect(tirantes!.presentInModel).toBe(false);
  });

  it('avisa de las zonas del modelo que este firmware no gobierna', () => {
    const extendido: LightingControl = {
      ...control,
      zones: [...control.zones, zona('mirador', ['MIR-001'], 300)],
    };
    const c = new FirmwareLightingController(hex, extendido);
    expect(c.advance(20).unmatchedModelZones).toEqual(['mirador']);
  });

  it('funciona aunque el modelo no traiga bloque de mando', () => {
    const c = new FirmwareLightingController(hex, null);
    c.setLight(0.05);
    const state = c.advance(50);
    // Sin zonas en el modelo no hay nada que iluminar, pero el firmware corre
    // y sus salidas se leen igual.
    expect(state.litCount).toBe(0);
    expect(state.zones.every((zone) => zone.energized)).toBe(true);
    expect(state.zones.every((zone) => !zone.presentInModel)).toBe(true);
    expect(state.zones[0].modelLabel).toBeNull();
    // Sin zonas no hay nada encendido, así que la suma es cero, no nula.
    expect(state.totalPowerW).toBe(0);
  });
});

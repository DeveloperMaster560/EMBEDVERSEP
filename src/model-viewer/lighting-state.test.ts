import { describe, expect, it } from 'vitest';

import {
  clock,
  dayOfYear,
  evaluateLighting,
  normalizeLightingControl,
  solarEvents,
  type LightingControl,
} from './lighting-state';

const BGA = { lat: 7.10817, lon: -73.12984, offset: -5 };

function control(overrides: Partial<LightingControl> = {}): LightingControl {
  return {
    cabinetId: 'CTL-GAB-001',
    sensorId: 'CTL-FOT-001',
    sensorThresholds: { switchOnLux: null, switchOffLux: null },
    clockId: 'CTL-RLJ-001',
    latitudeDeg: BGA.lat,
    longitudeDeg: BGA.lon,
    contactorId: 'CTL-CON-001',
    zones: [
      {
        zone: 'vial', label: 'Alumbrado vial', purpose: 'seguridad',
        circuitId: 'ILU-CIR-001', switchedBy: 'CTL-CON-001',
        controllerId: null, driverId: null,
        fixtures: ['ILU-LUM-01', 'ILU-LUM-02'], fixtureCount: 2,
        connectedPowerW: 3480, nominalVoltageV: 208,
        dimmable: false, colorCapability: null,
      },
      {
        zone: 'tirantes', label: 'Realce: tirantes', purpose: 'programa',
        circuitId: null, switchedBy: null,
        controllerId: 'CTL-DMX-01', driverId: 'CTL-FTE-01',
        fixtures: ['ILU-ARQ-TIR-001'], fixtureCount: 1,
        connectedPowerW: 4800, nominalVoltageV: 208,
        dimmable: true, colorCapability: 'RGBW',
      },
    ],
    totalFixtures: 3,
    undetermined: [],
    notSimulated: ['corriente real'],
    ...overrides,
  };
}

const NOV_9 = { year: 2026, dayNumber: dayOfYear(new Date(Date.UTC(2026, 10, 9))) };

describe('cálculo solar', () => {
  it('sitúa orto y ocaso de Bucaramanga donde realmente están', () => {
    const e = solarEvents(2026, NOV_9.dayNumber, BGA.lat, BGA.lon, BGA.offset);
    // Valores reales de noviembre en Bucaramanga: ~05:41 y ~17:31.
    expect(clock(e.sunriseMinutes)).toBe('05:41');
    expect(clock(e.sunsetMinutes)).toBe('17:31');
  });

  it('da la declinación exacta en los solsticios', () => {
    const jun = solarEvents(2026, dayOfYear(new Date(Date.UTC(2026, 5, 21))), 0, 0, 0);
    const dic = solarEvents(2026, dayOfYear(new Date(Date.UTC(2026, 11, 21))), 0, 0, 0);
    expect(jun.declinationDeg).toBeCloseTo(23.44, 1);
    expect(dic.declinationDeg).toBeCloseTo(-23.44, 1);
  });

  it('detecta el día y la noche polares en vez de devolver una hora falsa', () => {
    const invierno = solarEvents(2026, dayOfYear(new Date(Date.UTC(2026, 11, 21))), 69.65, 18.96, 1);
    const verano = solarEvents(2026, dayOfYear(new Date(Date.UTC(2026, 5, 21))), 69.65, 18.96, 1);
    expect(invierno.regime).toBe('polar-night');
    expect(verano.regime).toBe('polar-day');
    expect(invierno.sunsetMinutes).toBeNull();
    expect(verano.sunriseMinutes).toBeNull();
  });
});

describe('evaluación del mando', () => {
  it('enciende el alumbrado vial de noche y lo apaga de día', () => {
    const noche = evaluateLighting(control(), { ...NOV_9, minutesOfDay: 19 * 60 });
    const dia = evaluateLighting(control(), { ...NOV_9, minutesOfDay: 12 * 60 });
    expect(noche.zones.find((z) => z.zone === 'vial')?.energized).toBe(true);
    expect(dia.zones.find((z) => z.zone === 'vial')?.energized).toBe(false);
  });

  it('justifica cada decisión; ninguna razón queda vacía', () => {
    const e = evaluateLighting(control(), { ...NOV_9, minutesOfDay: 19 * 60 });
    for (const zone of e.zones) expect(zone.reason.length, zone.zone).toBeGreaterThan(10);
  });

  it('conmuta exactamente en el ocaso, no antes', () => {
    const antes = evaluateLighting(control(), { ...NOV_9, minutesOfDay: 17 * 60 + 30 });
    const despues = evaluateLighting(control(), { ...NOV_9, minutesOfDay: 17 * 60 + 32 });
    expect(antes.night).toBe(false);
    expect(despues.night).toBe(true);
  });

  it('no enciende el realce de día aunque el operador lo pida', () => {
    const e = evaluateLighting(control(), {
      ...NOV_9, minutesOfDay: 12 * 60, accentZonesOn: new Set(['tirantes']),
    });
    expect(e.zones.find((z) => z.zone === 'tirantes')?.energized).toBe(false);
  });

  it('el realce es una elección del operador y lo dice', () => {
    const encendido = evaluateLighting(control(), {
      ...NOV_9, minutesOfDay: 19 * 60, accentZonesOn: new Set(['tirantes']),
    });
    const zona = encendido.zones.find((z) => z.zone === 'tirantes');
    expect(zona?.energized).toBe(true);
    expect(zona?.reason).toMatch(/elección del operador/i);
  });

  it('sin coordenadas no decide: lo declara no evaluable', () => {
    const e = evaluateLighting(
      control({ latitudeDeg: null, longitudeDeg: null }),
      { ...NOV_9, minutesOfDay: 19 * 60 },
    );
    expect(e.zones.every((z) => !z.energized)).toBe(true);
    expect(e.undetermined.join(' ')).toMatch(/latitud y longitud/i);
    expect(e.zones.find((z) => z.zone === 'vial')?.reason).toMatch(/no evaluable/i);
  });

  it('una cadena incompleta no se da por buena', () => {
    const roto = control();
    roto.zones[1].driverId = null;
    const e = evaluateLighting(roto, { ...NOV_9, minutesOfDay: 19 * 60, accentZonesOn: new Set(['tirantes']) });
    expect(e.zones.find((z) => z.zone === 'tirantes')?.energized).toBe(false);
    expect(e.zones.find((z) => z.zone === 'tirantes')?.reason).toMatch(/incompleta/i);
  });

  it('un circuito sin contactor no se puede maniobrar', () => {
    const roto = control();
    roto.zones[0].switchedBy = null;
    const e = evaluateLighting(roto, { ...NOV_9, minutesOfDay: 19 * 60 });
    expect(e.zones.find((z) => z.zone === 'vial')?.energized).toBe(false);
  });

  it('solo enciende las luminarias de las zonas energizadas', () => {
    const e = evaluateLighting(control(), {
      ...NOV_9, minutesOfDay: 19 * 60, accentZonesOn: new Set(),
    });
    expect([...e.litComponents]).toEqual(['ILU-LUM-01', 'ILU-LUM-02']);
  });

  it('no suma potencias si alguna zona encendida no la declara', () => {
    const parcial = control();
    parcial.zones[0].connectedPowerW = null;
    const e = evaluateLighting(parcial, { ...NOV_9, minutesOfDay: 19 * 60 });
    expect(e.totalPowerW).toBeNull();
  });

  it('arrastra lo no determinable del modelo', () => {
    const e = evaluateLighting(
      control({ undetermined: ['La fotocelda no tiene umbral de lux declarado.'] }),
      { ...NOV_9, minutesOfDay: 19 * 60 },
    );
    expect(e.undetermined.join(' ')).toMatch(/umbral de lux/i);
  });

  it('declara de dónde sale el huso horario en vez de darlo por supuesto', () => {
    const e = evaluateLighting(control(), { ...NOV_9, minutesOfDay: 19 * 60 });
    expect(e.utcOffsetHours).toBe(-5);
    expect(e.utcOffsetSource).toMatch(/pendiente|deducid/i);
  });
});

describe('normalización del bloque del generador', () => {
  it('devuelve null cuando el generador no lo publica', () => {
    expect(normalizeLightingControl(undefined)).toBeNull();
    expect(normalizeLightingControl(null)).toBeNull();
  });

  it('no convierte un nulo en cero', () => {
    const c = normalizeLightingControl({
      sensor_thresholds: { switch_on_lux: null, switch_off_lux: null },
      latitude_deg: null, zones: [],
    });
    expect(c?.sensorThresholds?.switchOnLux).toBeNull();
    expect(c?.latitudeDeg).toBeNull();
  });
});

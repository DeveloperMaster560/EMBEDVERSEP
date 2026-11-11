import { describe, expect, it } from 'vitest';

import { buildBaseline, BaselineError, deviationSigma, validateHoldout } from './baseline';
import {
  type AccelWindow,
  assessQuality,
  classifyStructural,
  type ThresholdConfig,
  UNAPPROVED,
} from './events';

/** Ventana sintética: ruido determinista de amplitud `amp` en m/s² sobre 1 g en Z. */
function ventana(amp: number, over: Partial<AccelWindow> = {}, seed = 1): AccelWindow {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const n = 200 * 10;
  const mk = (base: number) => Array.from({ length: n }, () => base + amp * rnd());
  return {
    stationId: 'SD-V2-M',
    config: { sampleRateHz: 200, rangeG: 2, filterId: 'f1', firmwareVersion: '0.1.0' },
    axes: { x: mk(0), y: mk(0), z: mk(9.80665) },
    durationS: 10,
    timeQuality: 'GNSS_LOCKED', ppsLocked: true, sensorOk: true, storageOk: true,
    crcDeclared: 'abcd1234', crcComputed: 'ABCD1234',
    sensorTempC: 25, supplyV: 24,
    ...over,
  };
}

const aprobado: ThresholdConfig = {
  values: { transientPeakMs2: 1, persistentSigma: 3, persistentWindows: 3, minIndependentStations: 2, e4MinIndicators: 3 },
  approval: { approvedBy: 'Ing. de prueba', approvedOn: '2026-11-11', document: 'informe-prueba', baselineId: 'bl-1' },
};

describe('calidad de medición (E1)', () => {
  it('una ventana limpia no es E1, y dice qué no pudo evaluar', () => {
    const r = assessQuality(ventana(0.01));
    expect(r.level).toBeNull();
    expect(r.notEvaluated.join(' ')).toMatch(/hoja de datos/);
  });

  it('detecta hueco, saturación, CRC y pérdida de PPS, cada uno con su estado', () => {
    const w = ventana(0.01);
    w.axes.x[10] = null;
    w.axes.y[5] = 2 * 9.80665;
    const r = assessQuality({ ...w, crcComputed: 'ffffffff', ppsLocked: false });
    const estados = r.findings.map((f) => f.state);
    expect(r.level).toBe('E1');
    expect(estados).toEqual(expect.arrayContaining(['DATA_GAP', 'SATURATED', 'STORAGE_FAULT', 'TIME_HOLDOVER']));
  });

  it('una tasa real fuera de ±0,1 % es un hueco (§13)', () => {
    const w = ventana(0.01);
    w.axes.z = w.axes.z.slice(0, 1990);
    expect(assessQuality(w).findings.some((f) => f.state === 'DATA_GAP')).toBe(true);
  });

  it('sin rango configurado no se inventa la saturación', () => {
    const r = assessQuality(ventana(0.01, { config: { sampleRateHz: 200, rangeG: null, filterId: 'f1', firmwareVersion: '0.1.0' } }));
    expect(r.notEvaluated.join(' ')).toMatch(/Saturación/);
  });
});

describe('umbrales estructurales', () => {
  const devs = [
    { stationId: 'A', sigmas: [4, 4, 4], peakMs2: 0.2 },
    { stationId: 'B', sigmas: [5, 5, 5], peakMs2: 0.2 },
  ];

  it('sin umbrales aprobados se niega a clasificar, aunque los datos parezcan claros', () => {
    const r = classifyStructural(devs, UNAPPROVED);
    expect(r.level).toBeNull();
    expect(r.blocked).toMatch(/no fija ninguno/);
  });

  it('valores sin firma no sirven', () => {
    const r = classifyStructural(devs, { values: aprobado.values, approval: null });
    expect(r.blocked).toMatch(/no están aprobados/);
  });

  it('E3 exige persistencia en dos estaciones independientes', () => {
    expect(classifyStructural(devs, aprobado).level).toBe('E3');
    const sola = classifyStructural([devs[0]], aprobado);
    expect(sola.level).toBeNull();
    expect(sola.message).toMatch(/una sola estación/);
  });

  it('una ventana E1 en medio rompe la persistencia', () => {
    const r = classifyStructural([{ ...devs[0], sigmas: [4, null, 4] }, devs[1]], aprobado);
    expect(r.level).not.toBe('E3');
  });

  it('E4 recomienda escalar y no decide cierres; nada habla de daño', () => {
    const r = classifyStructural([...devs, { stationId: 'C', sigmas: [6, 6, 6], peakMs2: 0.1 }], aprobado);
    expect(r.level).toBe('E4');
    expect(r.message).toMatch(/no decide el cierre/);
    for (const d of [r, classifyStructural([{ stationId: 'A', sigmas: [0], peakMs2: 3 }], aprobado)]) {
      expect(d.message).not.toMatch(/daño (estructural|confirmado)|inseguro/i);
    }
  });

  it('un pico aislado es E0, no E3', () => {
    expect(classifyStructural([{ stationId: 'A', sigmas: [0, 0, 0], peakMs2: 3 }], aprobado).level).toBe('E0');
  });
});

describe('línea base', () => {
  const regimen = () => 'T20-25';

  it('no mezcla configuraciones distintas', () => {
    const otra = ventana(0.01, { config: { sampleRateHz: 500, rangeG: 2, filterId: 'f1', firmwareVersion: '0.1.0' } });
    expect(() => buildBaseline([ventana(0.01), otra], regimen)).toThrow(BaselineError);
  });

  it('excluye las ventanas con problemas de calidad', () => {
    const mala = ventana(0.01, { sensorOk: false });
    const b = buildBaseline([ventana(0.01, {}, 1), ventana(0.01, {}, 2), mala], regimen);
    expect(b.excludedForQuality).toBe(1);
    expect(b.regimes[0].windows).toBe(2);
  });

  it('una ventana muy distinta se aleja en sigmas, y el periodo retenido valida', () => {
    const train = [1, 2, 3, 4, 5, 6].map((s) => ventana(0.01 + s * 0.0005, {}, s));
    const b = buildBaseline(train, regimen);
    expect(Math.abs(deviationSigma(b, ventana(0.2, {}, 9), 'T20-25')!)).toBeGreaterThan(10);
    const v = validateHoldout(b, [ventana(0.0115, {}, 7), ventana(0.0125, {}, 8)], regimen, 3);
    expect(v.compared).toBe(2);
    expect(v.fraction).toBe(1);
  });
});

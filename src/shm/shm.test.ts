import { describe, expect, it } from 'vitest';

import { checkGapHandling, validateStationRecord } from './data-contract';
import {
  ACQUISITION,
  MCU_SIGNALS,
  NO_5V_SIGNAL_PREFIXES,
  REVIEW_FINDINGS,
  SHM_COMPONENTS,
  STATION_CONNECTORS,
  DEBUG_INTERFACE,
  PROPOSED_ACC_SCK,
  RMII_PINS_LQFP100,
  VERIFIED_AF,
  phaseErrorDeg,
  rawBytesPerDay,
  solarSizing,
} from './station-design';

describe('diseño de estación SHM: coherencia interna', () => {
  it('ningún GPIO asignado se usa dos veces', () => {
    const used = MCU_SIGNALS.filter((s) => s.gpio !== null).map((s) => s.gpio);
    expect(new Set(used).size).toBe(used.length);
  });

  it('cada dispositivo del bus SPI tiene su propio chip select', () => {
    const cs = ['ACC_CS_N', 'TILT_CS_N', 'ADC_CS_N'].map((n) => MCU_SIGNALS.find((s) => s.signal === n)?.gpio);
    expect(cs.every(Boolean)).toBe(true);
    expect(new Set(cs).size).toBe(3);
  });

  it('las señales digitales de los conectores existen en el mapa del MCU', () => {
    const known = new Set(MCU_SIGNALS.map((s) => s.signal));
    for (const c of STATION_CONNECTORS.filter((x) => x.id === 'J1' || x.id === 'J2')) {
      for (const p of c.pins) {
        if (/_(SCK|MISO|MOSI|CS_N)$/.test(p.signal)) expect(known.has(p.signal), `${c.id}-${p.pin}`).toBe(true);
      }
    }
  });

  it('nada de 5 V llega a ADXL355, SCL3300 ni a los raíles de 3,3 V', () => {
    for (const c of STATION_CONNECTORS) {
      for (const p of c.pins) {
        if (NO_5V_SIGNAL_PREFIXES.some((pre) => p.signal.startsWith(pre)) && p.volts !== null) {
          expect(p.volts, `${c.id}-${p.pin} ${p.signal}`).toBeLessThanOrEqual(3.6);
        }
      }
    }
  });

  it('J1 tiene el orden de pines del documento', () => {
    const j1 = STATION_CONNECTORS.find((c) => c.id === 'J1')!;
    expect(j1.pins.map((p) => p.signal)).toEqual(
      ['+3V3_A', 'ACC_SCK', 'ACC_MISO', 'ACC_MOSI', 'ACC_CS_N', 'DGND', 'INT1', 'INT2'],
    );
  });

  it('lo que el documento deja abierto sigue abierto', () => {
    for (const n of ['SENSOR_SYNC', 'WDG_KICK', 'PWR_GOOD']) {
      expect(MCU_SIGNALS.find((s) => s.signal === n)?.gpio, n).toBeNull();
    }
    expect(SHM_COMPONENTS.find((c) => c.id === 'TIME-01')?.partNumber).toBeNull();
    expect(SHM_COMPONENTS.find((c) => c.id === 'DISP-01')?.partNumber).toBeNull();
  });

  it('todo componente dice de dónde sale', () => {
    for (const c of SHM_COMPONENTS) expect(c.source, c.id).toMatch(/\.md|\.csv/);
  });

  it('solo cambian respecto al documento los pines que decidió ingenierías', () => {
    const cambiados = MCU_SIGNALS.filter((s) => s.changedFrom).map((s) => `${s.signal}@${s.gpio}`);
    expect(cambiados).toEqual(['ACC_SCK@PB3', 'ACC_MISO@PB4', 'ACC_MOSI@PB5']);
  });
});

describe('cálculos del documento, recalculados', () => {
  it('almacenamiento: 414,7 MB/día y unos 2,9 GB en 7 días (§10)', () => {
    const perDay = rawBytesPerDay();
    expect(perDay / 1e6).toBeCloseTo(414.72, 2);
    expect((perDay * ACQUISITION.retentionDays) / 1e9).toBeCloseTo(2.9, 1);
  });

  it('100 µs a 50 Hz son 1,8° de fase (§10)', () => {
    expect(phaseErrorDeg(100, 50)).toBeCloseTo(1.8, 6);
  });

  it('dimensionado solar ilustrativo del §8.2', () => {
    const s = solarSizing();
    expect(s.dailyWh).toBe(120);
    expect(s.minBatteryWh).toBeCloseTo(588, 0);
    expect(s.minBatteryAh).toBeCloseTo(23, 0);
    expect(s.usableWh(30)).toBeCloseTo(470, 0);
    expect(s.usableWh(30) / s.dailyWh).toBeCloseTo(3.9, 1);
    expect(s.usableWh(35)).toBeCloseTo(548, 0);
    expect(s.usableWh(35) / s.dailyWh).toBeCloseTo(4.6, 1);
    expect(s.minPanelW).toBeCloseTo(52.7, 1);
  });

  it('200 muestras/s cubren la banda de 40 Hz con margen de Nyquist', () => {
    expect(ACQUISITION.sampleRateHz / 2).toBeGreaterThan(ACQUISITION.analysisBandHz[1]);
    expect(ACQUISITION.sensorOdrMinHz).toBeGreaterThan(ACQUISITION.sampleRateHz);
  });
});

describe('contrato de datos', () => {
  const ok = {
    schema_version: '1.0',
    station_id: 'SD-V2-M',
    sensor_id: 'ADXL355-0001',
    timestamp_utc: '2026-11-11T21:00:00.000Z',
    received_utc: '2026-11-11T21:00:04.120Z',
    time_quality: 'GNSS_LOCKED',
    time_uncertainty_us: 40,
    sample_rate_hz: 200,
    axes: ['longitudinal', 'transversal', 'vertical'],
    units: 'm/s2',
    range_g: 2,
    filter_id: 'f-r1',
    firmware_version: '0.1.0',
    calibration_id: null,
    samples_file: 'blk/000001.bin',
    samples_crc32: '1a2b3c4d',
    states: ['NORMAL'],
    health: { sensor_ok: true, storage_ok: true, pps_locked: true, supply_v: 24.0 },
  };

  it('acepta un registro completo', () => {
    expect(validateStationRecord(ok)).toEqual([]);
  });

  it('rechaza estados que no están en la lista cerrada', () => {
    expect(validateStationRecord({ ...ok, states: ['ALERTA_ROJA'] }).join(' ')).toMatch(/desconocido/);
  });

  it('el firmware no diagnostica daño', () => {
    expect(validateStationRecord({ ...ok, note: 'posible daño en el vano' }).join(' ')).toMatch(/diagnóstico/);
  });

  it('GNSS_LOCKED con el PPS suelto es incoherente', () => {
    const r = { ...ok, health: { ...ok.health, pps_locked: false } };
    expect(validateStationRecord(r).join(' ')).toMatch(/PPS/);
  });

  it('la retransmisión no reescribe la hora de muestreo', () => {
    expect(validateStationRecord({ ...ok, received_utc: ok.timestamp_utc }).join(' ')).toMatch(/§8/);
  });

  it('el registro de ejemplo del documento no pasa tal cual: sus valores son de esquema', () => {
    const doc = { ...ok, timestamp_utc: 'RFC3339', samples_crc32: 'hex' };
    expect(validateStationRecord(doc).length).toBeGreaterThan(0);
  });

  it('un hueco rellenado con cero se detecta', () => {
    expect(checkGapHandling([0.1, 0, 0.2], [1])).toHaveLength(1);
    expect(checkGapHandling([0.1, null, 0.2], [1])).toHaveLength(0);
  });
});

describe('pinout contra la DS12110', () => {
  it('RV-01 resuelto: ninguna señal del diseño pisa un pin RMII del LQFP100', () => {
    const choques = MCU_SIGNALS.filter((s) => s.gpio && RMII_PINS_LQFP100[s.gpio]);
    expect(choques).toEqual([]);
    const rv01 = REVIEW_FINDINGS.find((f) => f.id === 'RV-01')!;
    expect(rv01.status).toBe('resuelto');
    expect(rv01.evidence.length).toBeGreaterThan(0);
  });

  it('el bus de sensores sale entero de un mismo periférico SPI', () => {
    const bus = ['ACC_SCK', 'ACC_MISO', 'ACC_MOSI'].map((n) => MCU_SIGNALS.find((s) => s.signal === n)!.fn.split('_')[0]);
    expect(new Set(bus)).toEqual(new Set(['SPI1']));
  });

  it('los pines de SWD quedan libres; JTAG y SWO no se usan', () => {
    const usados = new Set(MCU_SIGNALS.map((s) => s.gpio));
    expect(usados.has(DEBUG_INTERFACE.swd.swdio)).toBe(false);
    expect(usados.has(DEBUG_INTERFACE.swd.swclk)).toBe(false);
    expect(DEBUG_INTERFACE.jtag).toBe(false);
    expect(DEBUG_INTERFACE.swo).toBe(false);
  });

  it('las funciones alternas que declara el diseño son las de la hoja de datos', () => {
    for (const s of MCU_SIGNALS) {
      if (!s.gpio || !VERIFIED_AF[s.gpio]) continue;
      const m = /AF(\d+)/.exec(s.fn);
      expect(Number(m?.[1]), `${s.signal}@${s.gpio}`).toBe(VERIFIED_AF[s.gpio].af);
    }
  });

  it('las alternativas propuestas no chocan con RMII ni con otra señal del diseño', () => {
    const usados = new Set(MCU_SIGNALS.map((s) => s.gpio));
    for (const p of PROPOSED_ACC_SCK) {
      expect(RMII_PINS_LQFP100[p.gpio], p.gpio).toBeUndefined();
      expect(usados.has(p.gpio), p.gpio).toBe(false);
    }
  });

  it('RV-02 no se marca como verificado sin el manual correcto', () => {
    expect(REVIEW_FINDINGS.find((f) => f.id === 'RV-02')?.status).toBe('sin-verificar');
  });
});

describe('respuesta de ingenierías a RV-01', () => {
  it('RV-04 resuelto con SPI1 en PB3/PB4/PB5', () => {
    const rv04 = REVIEW_FINDINGS.find((f) => f.id === 'RV-04')!;
    expect(rv04.status).toBe('resuelto');
    expect(MCU_SIGNALS.find((s) => s.signal === 'ACC_SCK')?.gpio).toBe('PB3');
  });
});


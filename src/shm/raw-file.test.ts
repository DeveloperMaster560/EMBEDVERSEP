import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { readShmw } from './raw-file';

const dir = resolve(__dirname, '../../firmware/shm-station/pruebas');
const bin = new Uint8Array(readFileSync(resolve(dir, 'ventana-ejemplo.bin')));
const { registro } = JSON.parse(readFileSync(resolve(dir, 'ventana-ejemplo.bin.json'), 'utf8'));

describe('archivo crudo SHMW escrito por el firmware', () => {
  it('se lee y cuadra con su registro JSON', () => {
    const w = readShmw(bin);
    expect(w).toMatchObject({ stationId: registro.station_id, sensorId: registro.sensor_id, sequence: 12345, samples: 2000,
      gaps: registro.gaps, saturated: registro.saturated, timeQuality: registro.time_quality, sampleRateHz: 200,
      firmwareVersion: registro.firmware_version, filterId: registro.filter_id, dataCrc32: registro.samples_crc32 });
    expect(new Date(w.startUtcMs).toISOString()).toBe(registro.timestamp_utc);
    expect(Number.isNaN(w.data[0]) && Number.isNaN(w.data[2])).toBe(true); // muestra 0: hueco
    expect(w.data[3]).not.toBe(0);
  });

  it('rechaza un archivo a medias o alterado', () => {
    expect(() => readShmw(bin.subarray(0, bin.length - 12))).toThrow('incompleto');
    const b = bin.slice();
    b[9000] ^= 0xff;
    expect(() => readShmw(b)).toThrow('CRC de los datos');
  });
});

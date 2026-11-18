/**
 * Lector del archivo crudo de ventana «SHMW» v1
 * (firmware/shm-station/FORMATO_BIN.md). PROPUESTA pendiente de ingeniería.
 * Mismas reglas que shm_plataforma/crudo.py: si algo no cuadra, error; nunca
 * se «arregla» un archivo.
 */

import { crc32 } from './sim/station-sim';

export const SHMW_MAGIC = 'SHMW';
export const SHMW_HEADER_V1 = 160;
const TIME_QUALITY = ['GNSS_LOCKED', 'TIME_HOLDOVER', 'TIME_INVALID'] as const;

export interface ShmwWindow {
  version: number;
  stationId: string;
  sensorId: string;
  firmwareVersion: string;
  filterId: string;
  sequence: number;
  startUtcMs: number;
  timeQuality: (typeof TIME_QUALITY)[number];
  sampleRateHz: number;
  rangeG: number;
  axes: number;
  samples: number;
  gaps: number;
  saturated: number;
  dataCrc32: string;
  sensorOk: boolean;
  ppsLocked: boolean;
  /** Muestras entrelazadas x0 y0 z0 x1 …; huecos como NaN. */
  data: Float32Array;
}

export class ShmwError extends Error {}

const text = (b: Uint8Array) => {
  const end = b.indexOf(0);
  return new TextDecoder('ascii').decode(end < 0 ? b : b.subarray(0, end));
};

export function readShmw(bytes: Uint8Array): ShmwWindow {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 8 || text(bytes.subarray(0, 4)) !== SHMW_MAGIC) throw new ShmwError('No es un archivo SHMW (firma incorrecta).');
  const version = dv.getUint16(4, true);
  const headerLen = dv.getUint16(6, true);
  if (version !== 1) throw new ShmwError(`Versión SHMW ${version} no admitida.`);
  if (headerLen < SHMW_HEADER_V1 || bytes.length < headerLen) throw new ShmwError('Cabecera incompleta: el archivo quedó a medias.');
  if (crc32(bytes.subarray(0, 156)) !== dv.getUint32(156, true).toString(16).padStart(8, '0')) {
    throw new ShmwError('El CRC de la cabecera no coincide: cabecera dañada.');
  }
  const axes = dv.getUint8(8);
  if (dv.getUint8(9) !== 1) throw new ShmwError(`Tipo de muestra ${dv.getUint8(9)} desconocido.`);
  const tq = TIME_QUALITY[dv.getUint8(10)];
  if (!tq) throw new ShmwError(`Calidad de tiempo ${dv.getUint8(10)} desconocida.`);
  const samples = dv.getUint32(28, true);
  const expected = headerLen + samples * axes * 4;
  if (bytes.length !== expected) {
    throw new ShmwError(`Tamaño ${bytes.length} B, se esperaban ${expected} B: archivo incompleto (corte de energía) o alterado.`);
  }
  const dataBytes = bytes.subarray(headerLen);
  const dataCrc32 = dv.getUint32(40, true).toString(16).padStart(8, '0');
  if (crc32(dataBytes) !== dataCrc32) throw new ShmwError('El CRC de los datos no coincide: muestras dañadas.');
  const data = new Float32Array(samples * axes);
  const ddv = new DataView(dataBytes.buffer, dataBytes.byteOffset, dataBytes.byteLength);
  for (let i = 0; i < data.length; i++) data[i] = ddv.getFloat32(i * 4, true);
  const flags = dv.getUint32(44, true);
  return {
    version, axes, samples, dataCrc32, data, timeQuality: tq,
    rangeG: dv.getUint8(11),
    sampleRateHz: dv.getUint32(12, true) / 1000,
    startUtcMs: Number(dv.getBigInt64(16, true)),
    sequence: dv.getUint32(24, true),
    gaps: dv.getUint32(32, true),
    saturated: dv.getUint32(36, true),
    sensorOk: (flags & 1) !== 0,
    ppsLocked: (flags & 2) !== 0,
    stationId: text(bytes.subarray(48, 80)),
    sensorId: text(bytes.subarray(80, 112)),
    firmwareVersion: text(bytes.subarray(112, 128)),
    filterId: text(bytes.subarray(128, 152)),
  };
}

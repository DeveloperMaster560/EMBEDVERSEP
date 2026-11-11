/**
 * Comprueba que las imágenes de ejemplo dan lo que `ejemplos/vision/LEEME.md`
 * promete.
 *
 * Sin esto, esa tabla sería una afirmación sin comprobar, y el documento está
 * ahí justamente para que el usuario distinga un fallo del programa de un
 * problema de su fotografía. Si la tabla miente, no sirve de nada.
 */

import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { analyze, type Bitmap } from './image-analysis';

/**
 * Lector de PNG en escala de grises de 8 bits sin entrelazado.
 *
 * Deliberadamente mínimo: solo tiene que leer los ejemplos que genera este
 * repositorio, no cualquier PNG del mundo. Si algún día dejan de ser de este
 * tipo, falla en voz alta en vez de devolver pixeles equivocados.
 */
function readGrayPng(path: string): Bitmap {
  const buf = readFileSync(path);
  expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');

  let width = 0;
  let height = 0;
  const trozos: Buffer[] = [];
  let i = 8;
  while (i < buf.length) {
    const largo = buf.readUInt32BE(i);
    const tipo = buf.subarray(i + 4, i + 8).toString('ascii');
    const datos = buf.subarray(i + 8, i + 8 + largo);
    if (tipo === 'IHDR') {
      width = datos.readUInt32BE(0);
      height = datos.readUInt32BE(4);
      expect(datos[8]).toBe(8);   // 8 bits por muestra
      expect(datos[9]).toBe(0);   // escala de grises
      expect(datos[12]).toBe(0);  // sin entrelazado
    } else if (tipo === 'IDAT') {
      trozos.push(Buffer.from(datos));
    }
    i += 12 + largo;
  }
  const crudo = inflateSync(Buffer.concat(trozos));
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const fila = y * (width + 1);
    expect(crudo[fila]).toBe(0); // filtro «ninguno»
    for (let x = 0; x < width; x += 1) {
      const v = crudo[fila + 1 + x];
      const p = (y * width + x) * 4;
      data[p] = v;
      data[p + 1] = v;
      data[p + 2] = v;
      data[p + 3] = 255;
    }
  }
  return { width, height, data };
}

const ejemplo = (nombre: string) => analyze(readGrayPng(`ejemplos/vision/${nombre}`));
const porLado = (r: ReturnType<typeof analyze>, s: string) =>
  r.pins.filter((p) => p.side === s).length;

describe('las imágenes de ejemplo dan lo que promete el LEEME', () => {
  it('dip-8.png: 4 arriba y 4 abajo, sin avisos', () => {
    const r = ejemplo('dip-8.png');
    expect([porLado(r, 'top'), porLado(r, 'bottom')]).toEqual([4, 4]);
    expect(r.warnings).toEqual([]);
  });

  it('dip-16.png: 8 y 8, sin avisos', () => {
    const r = ejemplo('dip-16.png');
    expect([porLado(r, 'top'), porLado(r, 'bottom')]).toEqual([8, 8]);
    expect(r.warnings).toEqual([]);
  });

  it('dip-16-girado.png: contadas a izquierda y derecha', () => {
    const r = ejemplo('dip-16-girado.png');
    expect([porLado(r, 'left'), porLado(r, 'right')]).toEqual([8, 8]);
    expect(r.warnings).toEqual([]);
  });

  it('dip-16-pata-perdida.png: 7 y 8, y avisa', () => {
    const r = ejemplo('dip-16-pata-perdida.png');
    expect([porLado(r, 'top'), porLado(r, 'bottom')]).toEqual([7, 8]);
    expect(r.warnings.join(' ')).toMatch(/revise el recuento/i);
  });

  it('fondo-oscuro.png: avisa de que se ha tomado el fondo por la pieza', () => {
    expect(ejemplo('fondo-oscuro.png').warnings.join(' ')).toMatch(/fondo/i);
  });
});

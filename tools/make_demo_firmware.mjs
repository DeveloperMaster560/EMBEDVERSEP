/**
 * Ensambla el firmware de demostración y lo escribe en formato Intel HEX.
 *
 * Existe porque Arduino CLI depende del sistema operativo, y el .hex de
 * ejemplo tiene que poder reconstruirse en cualquier equipo. Usa el
 * ensamblador de avr8js, que ya es una dependencia del proyecto.
 *
 *   node tools/make_demo_firmware.mjs public/firmware/alumbrado-demo.S
 *
 * El .hex resultante se escribe junto al fuente, con la misma raíz de nombre.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { assemble } from 'avr8js/dist/esm/utils/assembler.js';

const source = process.argv[2];
if (!source) {
  console.error('Falta la ruta del fuente .S');
  process.exit(1);
}

const { bytes, errors } = assemble(readFileSync(source, 'utf8'));
if (errors.length) {
  console.error(`No ensambla:\n  ${errors.join('\n  ')}`);
  process.exit(1);
}

/** Suma de comprobación de un registro Intel HEX: complemento a dos de la suma. */
const checksum = (values) =>
  ((~values.reduce((total, value) => total + value, 0) + 1) & 0xff);

const hex = (value, digits) => value.toString(16).toUpperCase().padStart(digits, '0');

const lines = [];
const RECORD_BYTES = 16;
for (let offset = 0; offset < bytes.length; offset += RECORD_BYTES) {
  const chunk = [...bytes.slice(offset, offset + RECORD_BYTES)];
  const header = [chunk.length, (offset >> 8) & 0xff, offset & 0xff, 0x00];
  const body = [...header, ...chunk];
  lines.push(`:${body.map((value) => hex(value, 2)).join('')}${hex(checksum(body), 2)}`);
}
lines.push(':00000001FF');

const target = source.replace(/\.S$/, '.hex');
writeFileSync(target, `${lines.join('\n')}\n`);
console.log(`${target} · ${bytes.length} bytes de programa · ${lines.length} registros`);

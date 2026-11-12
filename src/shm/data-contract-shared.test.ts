/**
 * El contrato de datos tiene dos implementaciones: esta (la app) y la del
 * servidor (plataforma/servicios/shm_plataforma/contrato.py). Las dos se
 * prueban contra los mismos casos, para que no puedan divergir sin que falle algo.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { validateStationRecord } from './data-contract';

interface Caso {
  nombre: string;
  registro: unknown;
  valido: boolean;
  problema_contiene: string | null;
}

const { casos } = JSON.parse(
  readFileSync(resolve(__dirname, '../../plataforma/contrato/casos.json'), 'utf8'),
) as { casos: Caso[] };

describe('contrato de datos compartido con el servidor', () => {
  it.each(casos.map((c) => [c.nombre, c] as const))('%s', (_n, caso) => {
    const problems = validateStationRecord(caso.registro);
    expect(problems.length === 0, problems.join(' | ')).toBe(caso.valido);
    if (caso.problema_contiene) {
      expect(problems.some((p) => p.includes(caso.problema_contiene as string)), problems.join(' | ')).toBe(true);
    }
  });
});

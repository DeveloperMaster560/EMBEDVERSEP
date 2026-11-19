/** Mismos casos que plataforma/servicios/pruebas/test_medidas.py. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { MAGNITUDES, validateMeasurementMessage } from './medidas-contract';

interface Caso {
  nombre: string;
  mensaje: unknown;
  valido: boolean;
  problema_contiene: string | null;
}

const { casos } = JSON.parse(
  readFileSync(resolve(__dirname, '../../plataforma/contrato/casos-medidas.json'), 'utf8'),
) as { casos: Caso[] };

describe('contrato de medidas compartido con el servidor', () => {
  it.each(casos.map((c) => [c.nombre, c] as const))('%s', (_n, caso) => {
    const problems = validateMeasurementMessage(caso.mensaje);
    expect(problems.length === 0, problems.join(' | ')).toBe(caso.valido);
    if (caso.problema_contiene) {
      expect(problems.some((p) => p.includes(caso.problema_contiene as string)), problems.join(' | ')).toBe(true);
    }
  });

  it('el catálogo trae las magnitudes del sketch del cacao', () => {
    for (const q of ['temperatura', 'humedad', 'luz', 'humedad_suelo', 'distancia']) expect(MAGNITUDES[q]?.vectorial).toBe(false);
  });
});

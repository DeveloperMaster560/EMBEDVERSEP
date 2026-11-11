import { describe, expect, it } from 'vitest';

import { validateSpecification } from './contracts';
import { interpretBuildingPrompt, isReadyToGenerate } from './prompt-interpreter';
import { REFERENCE_BUILDINGS, matchReferenceBuilding } from './reference-buildings';

describe('catálogo de edificios de referencia', () => {
  it('reconoce el Bloque A de las UTS por varios nombres', () => {
    for (const prompt of [
      'Bloque A de las UTS',
      'las universitaria tecnologicas de santander',
      'Unidades Tecnológicas de Santander, Bucaramanga',
      'quiero ver la UTS',
    ]) {
      expect(matchReferenceBuilding(prompt)?.id, prompt).toBe('uts-bloque-a-bucaramanga');
    }
  });

  it('no encaja «uts» dentro de otra palabra ni en un edificio cualquiera', () => {
    expect(matchReferenceBuilding('Edificio de 3 niveles con outsourcing de aseo')).toBeNull();
    expect(matchReferenceBuilding('Edificio institucional de 3 niveles, 24 x 18 m')).toBeNull();
  });

  it('carga la planta y los niveles documentados, no los del texto', () => {
    const spec = interpretBuildingPrompt('Bloque A UTS de 9 pisos, 30 x 20 m');
    expect(spec.levels).toBe(4);
    expect(spec.lengthXM).toBeCloseTo(102.9, 5);
    expect(spec.widthYM).toBeCloseTo(19.6, 5);
    expect(spec.buildingUse).toBe('educativo');
  });

  it('sin alturas no se genera y se preguntan', () => {
    const spec = interpretBuildingPrompt('Bloque A de las UTS');
    expect(spec.clearHeightM).toBeNull();
    expect(spec.floorToFloorM).toBeNull();
    expect(isReadyToGenerate(spec)).toBe(false);
    expect(spec.questions[0]).toMatch(/altura libre/i);
  });

  it('las alturas del enunciado se aceptan y se declaran como del usuario', () => {
    const spec = interpretBuildingPrompt('Bloque A UTS, altura libre 2.80 m, entre niveles 3.40 m');
    expect(spec.clearHeightM).toBeCloseTo(2.8, 5);
    expect(spec.floorToFloorM).toBeCloseTo(3.4, 5);
    expect(isReadyToGenerate(spec)).toBe(true);
    expect(validateSpecification(spec)).toEqual([]);
    expect(spec.assumptions.join(' ')).toMatch(/DECLARADA POR EL USUARIO/);
  });

  it('toda ficha declara fuentes y límites, y las alturas nunca vienen inventadas', () => {
    for (const b of REFERENCE_BUILDINGS) {
      expect(b.sources.length, b.id).toBeGreaterThan(0);
      expect(b.caveats.length, b.id).toBeGreaterThan(0);
      expect(b.specification.clearHeightM, b.id).toBeNull();
      expect(b.specification.floorToFloorM, b.id).toBeNull();
    }
  });
});

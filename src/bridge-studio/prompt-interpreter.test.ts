import { describe, expect, it } from 'vitest';

import {
  describeSpecification,
  interpretBridgePrompt,
  isReadyToGenerate,
} from './prompt-interpreter';
import { ALL_BRIDGE_DISCIPLINES, toGeneratorSpec, validateSpecification } from './contracts';

describe('interpretBridgePrompt', () => {
  it('extrae tipología, dimensiones, vanos, vigas y carriles', () => {
    const spec = interpretBridgePrompt(
      'Puente de vigas de 90 m de longitud, 10 m de ancho de tablero, tablero a 7 m sobre el terreno, 3 vanos, 4 vigas principales y 2 carriles con aceras.',
    );
    expect(spec.bridgeType).toBe('beam');
    expect(spec.lengthM).toBe(90);
    expect(spec.widthM).toBe(10);
    expect(spec.deckHeightM).toBe(7);
    expect(spec.spanCount).toBe(3);
    expect(spec.girderCount).toBe(4);
    expect(spec.lanes).toBe(2);
    expect(spec.sidewalks).toBe(true);
    expect(spec.questions).toEqual([]);
    expect(isReadyToGenerate(spec)).toBe(true);
    expect(validateSpecification(spec)).toEqual([]);
  });

  it('reconoce la losa y el atirantado', () => {
    expect(interpretBridgePrompt('Puente de losa de 24 m').bridgeType).toBe('slab');
    expect(interpretBridgePrompt('Puente atirantado de 240 m').bridgeType).toBe('cable_stayed');
    expect(interpretBridgePrompt('Viaducto de 240 m con tirantes').bridgeType).toBe('cable_stayed');
  });

  it('declara la tipología asumida cuando el enunciado no la nombra', () => {
    const spec = interpretBridgePrompt('Puente de 40 m de longitud y 8 m de ancho.');
    expect(spec.bridgeType).toBe('beam');
    expect(spec.assumptions.some((a) => a.includes('puente de vigas'))).toBe(true);
  });

  it('no inventa dimensiones: las pregunta', () => {
    const spec = interpretBridgePrompt('Quiero un puente bonito.');
    expect(spec.lengthM).toBeNull();
    expect(spec.widthM).toBeNull();
    expect(spec.deckHeightM).toBeNull();
    expect(spec.questions).toHaveLength(3);
    expect(isReadyToGenerate(spec)).toBe(false);
  });

  it('no confunde el ancho del tablero con el de una viga', () => {
    const spec = interpretBridgePrompt(
      'Puente con vigas de 0.45 m de ancho, ancho de tablero 12 m, 60 m de longitud, tablero a 8 m sobre el cauce.',
    );
    expect(spec.widthM).toBe(12);
  });

  it('no confunde la cota del tablero con la altura de una barrera', () => {
    const spec = interpretBridgePrompt(
      'Puente de 60 m, 10 m de ancho de tablero, barreras de altura 1.10 m, altura del tablero 9 m.',
    );
    expect(spec.deckHeightM).toBe(9);
  });

  it('no cuenta vigas cuando lo que se da es su canto', () => {
    const spec = interpretBridgePrompt(
      'Puente de vigas de 60 m, 10 m de ancho de tablero, tablero a 7 m, con vigas de 1.20 m de canto.',
    );
    expect(spec.girderCount).toBeNull();
  });

  it('convierte unidades a metros', () => {
    const spec = interpretBridgePrompt(
      'Puente de 4500 cm de longitud y 900 cm de ancho de tablero, tablero a 600 cm sobre el terreno.',
    );
    expect(spec.lengthM).toBe(45);
    expect(spec.widthM).toBe(9);
    expect(spec.deckHeightM).toBe(6);
  });

  it('distingue sin aceras de con aceras y deja null si no se dice', () => {
    expect(interpretBridgePrompt('Puente de 30 m sin aceras').sidewalks).toBe(false);
    expect(interpretBridgePrompt('Puente de 30 m con aceras').sidewalks).toBe(true);
    expect(interpretBridgePrompt('Puente de 30 m').sidewalks).toBeNull();
  });

  it('genera todas las disciplinas cuando no se nombra ninguna', () => {
    const spec = interpretBridgePrompt('Puente de 40 m de longitud y 8 m de ancho de tablero.');
    expect(spec.disciplines).toEqual(ALL_BRIDGE_DISCIPLINES);
  });

  it('respeta las disciplinas que sí se nombran', () => {
    const spec = interpretBridgePrompt(
      'Puente de 40 m con estructura, drenaje e iluminación únicamente.',
    );
    expect(spec.disciplines.sort()).toEqual(['drainage', 'lighting', 'structure']);
  });

  it('declara las tipologías que no modela en vez de sustituirlas en silencio', () => {
    const spec = interpretBridgePrompt('Puente en arco de 80 m de longitud.');
    expect(spec.unrecognized).toContain('puentes en arco');
    expect(spec.questions.some((q) => q.includes('puentes en arco'))).toBe(true);
  });

  it('redirige a Edificación cuando el enunciado describe un edificio', () => {
    const spec = interpretBridgePrompt(
      'Edificio institucional de 3 niveles, longitud 24 m, ancho 18 m, altura libre 3.20 m.',
    );
    expect(spec.questions.some((q) => q.includes('describe un edificio'))).toBe(true);
  });

  it('no se desvía cuando el texto menciona un edificio pero pide un puente', () => {
    const spec = interpretBridgePrompt(
      'Puente peatonal de 30 m de longitud y 4 m de ancho de tablero para acceder al edificio norte, tablero a 6 m.',
    );
    expect(spec.questions.some((q) => q.includes('describe un edificio'))).toBe(false);
  });
});

describe('validateSpecification', () => {
  function specWith(partial: Partial<ReturnType<typeof interpretBridgePrompt>>) {
    return { ...interpretBridgePrompt('Puente de vigas de 60 m y 10 m de ancho de tablero, tablero a 7 m.'), ...partial };
  }

  it('rechaza dimensiones fuera del rango que resuelve el generador', () => {
    expect(validateSpecification(specWith({ lengthM: 5 }))).toHaveLength(1);
    expect(validateSpecification(specWith({ lengthM: 900 }))).toHaveLength(1);
    expect(validateSpecification(specWith({ widthM: 2 }))).toHaveLength(1);
    expect(validateSpecification(specWith({ widthM: 60 }))).toHaveLength(1);
    expect(validateSpecification(specWith({ deckHeightM: 0.5 }))).toHaveLength(1);
  });

  it('rechaza conteos imposibles', () => {
    expect(validateSpecification(specWith({ spanCount: 0 }))).toHaveLength(1);
    expect(validateSpecification(specWith({ spanCount: 40 }))).toHaveLength(1);
    expect(validateSpecification(specWith({ girderCount: 1 }))).toHaveLength(1);
    expect(validateSpecification(specWith({ lanes: 0 }))).toHaveLength(1);
    expect(validateSpecification(specWith({ disciplines: [] }))).toHaveLength(1);
  });

  it('acepta valores nulos: lo que falta se pregunta, no se rechaza', () => {
    expect(
      validateSpecification(specWith({ lengthM: null, widthM: null, deckHeightM: null })),
    ).toEqual([]);
  });
});

describe('toGeneratorSpec', () => {
  it('produce exactamente el JSON que acepta el generador', () => {
    const spec = interpretBridgePrompt(
      'Puente de vigas de 90 m de longitud, 10 m de ancho de tablero, tablero a 7 m sobre el terreno, 3 vanos, 4 vigas principales y 2 carriles con aceras.',
    );
    expect(toGeneratorSpec(spec)).toEqual({
      // El enunciado pasa de 80 caracteres, así que el nombre cae en la
      // etiqueta de la tipología en vez de truncar la frase a medias.
      project_name: 'Puente de vigas',
      bridge_type: 'beam',
      length_m: 90,
      width_m: 10,
      deck_height_m: 7,
      span_count: 3,
      girder_count: 4,
      lanes: 2,
      sidewalks: true,
      disciplines: [
        'structure', 'deck', 'barriers', 'drainage', 'lighting', 'signage',
        'instrumentation', 'control',
      ],
    });
  });

  it('omite lo desconocido en vez de enviarlo como cero', () => {
    const sent = toGeneratorSpec(interpretBridgePrompt('Puente de losa de 24 m de longitud.'));
    for (const key of ['width_m', 'deck_height_m', 'span_count', 'girder_count', 'lanes', 'sidewalks']) {
      expect(sent, `${key} no debería viajar`).not.toHaveProperty(key);
    }
    expect(sent.length_m).toBe(24);
  });
});

describe('describeSpecification', () => {
  it('resume lo entendido sin afirmar lo que no se sabe', () => {
    const lines = describeSpecification(interpretBridgePrompt('Puente de losa de 24 m de longitud.'));
    expect(lines[0]).toBe('Puente de losa');
    expect(lines.some((l) => l.includes('dimensiones sin definir'))).toBe(true);
  });
});

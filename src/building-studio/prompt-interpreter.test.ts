import { describe, expect, it } from 'vitest';

import { ALL_DISCIPLINES, toGeneratorSpec, validateSpecification } from './contracts';
import {
  describeSpecification,
  interpretBuildingPrompt,
  isReadyToGenerate,
} from './prompt-interpreter';

describe('interpretBuildingPrompt', () => {
  it('extrae niveles, dimensiones y alturas de un enunciado completo', () => {
    const spec = interpretBuildingPrompt(
      'Edificio institucional de 3 niveles, longitud 24 m, ancho 18 m, altura libre 3.20 m y altura entre niveles 3.60 m.',
    );
    expect(spec.levels).toBe(3);
    expect(spec.lengthXM).toBeCloseTo(24, 5);
    expect(spec.widthYM).toBeCloseTo(18, 5);
    expect(spec.clearHeightM).toBeCloseTo(3.2, 5);
    expect(spec.floorToFloorM).toBeCloseTo(3.6, 5);
    expect(spec.buildingUse).toBe('institucional-administrativo');
    expect(isReadyToGenerate(spec)).toBe(true);
    expect(spec.questions).toHaveLength(0);
  });

  it('acepta niveles escritos con palabra', () => {
    const spec = interpretBuildingPrompt('Bloque de oficinas de cinco pisos de 30 por 20 metros, altura libre 2.90 m');
    expect(spec.levels).toBe(5);
    expect(spec.lengthXM).toBeCloseTo(30, 5);
    expect(spec.widthYM).toBeCloseTo(20, 5);
    expect(spec.buildingUse).toBe('oficinas');
  });

  it('convierte unidades a metros', () => {
    const spec = interpretBuildingPrompt('Edificio de 2 niveles, longitud 2400 cm, ancho 1800 cm, altura libre 320 cm');
    expect(spec.lengthXM).toBeCloseTo(24, 5);
    expect(spec.widthYM).toBeCloseTo(18, 5);
    expect(spec.clearHeightM).toBeCloseTo(3.2, 5);
  });

  it('pregunta en vez de inventar cuando falta informacion', () => {
    const spec = interpretBuildingPrompt('Quiero un edificio bonito.');
    expect(spec.levels).toBeNull();
    expect(spec.lengthXM).toBeNull();
    expect(spec.clearHeightM).toBeNull();
    expect(isReadyToGenerate(spec)).toBe(false);
    expect(spec.questions.length).toBeGreaterThanOrEqual(3);
  });

  it('nunca rellena una dimension ausente con un valor por defecto', () => {
    const spec = interpretBuildingPrompt('Edificio de 4 niveles con altura libre de 3 m');
    expect(spec.levels).toBe(4);
    expect(spec.lengthXM).toBeNull();
    expect(spec.widthYM).toBeNull();
  });

  it('reconoce el programa de recintos pedido explicitamente', () => {
    const spec = interpretBuildingPrompt(
      'Edificio educativo de 3 niveles de 40 x 20 m, altura libre 3 m, con 4 aulas y 2 laboratorios',
    );
    expect(spec.buildingUse).toBe('educativo');
    expect(spec.roomsByBand.SOUTH?.aula).toBe(4);
    expect(spec.roomsByBand.EAST?.laboratorio).toBe(2);
  });

  it('genera las siete disciplinas cuando no se nombra ninguna', () => {
    const spec = interpretBuildingPrompt('Edificio de 3 niveles de 24 x 18 m, altura libre 3.2 m');
    expect(spec.disciplines).toEqual(ALL_DISCIPLINES);
    expect(spec.assumptions.some((a) => a.includes('siete'))).toBe(true);
  });

  it('respeta la seleccion de disciplinas del enunciado', () => {
    const spec = interpretBuildingPrompt(
      'Edificio de 3 niveles de 24 x 18 m, altura libre 3.2 m. Solo estructura e iluminacion.',
    );
    expect(spec.disciplines).toContain('structure');
    expect(spec.disciplines).toContain('electrical');
    expect(spec.disciplines).not.toContain('hvac');
  });

  it('avisa de lo que el generador no modela en vez de ignorarlo', () => {
    const spec = interpretBuildingPrompt(
      'Edificio de 3 niveles de 24 x 18 m, altura libre 3.2 m, con dos sotanos y ascensor',
    );
    expect(spec.unrecognized).toContain('sótanos');
    expect(spec.unrecognized).toContain('ascensores');
    expect(spec.questions.some((q) => q.includes('no modela'))).toBe(true);
  });

  it('declara siempre que la interpretacion es local y sin IA externa', () => {
    const spec = interpretBuildingPrompt('Edificio de 3 niveles de 24 x 18 m');
    expect(spec.assumptions[0]).toMatch(/no se uso un modelo de IA|no se usó un modelo de IA/i);
  });

  it('es determinista: el mismo texto produce la misma especificacion', () => {
    const prompt = 'Edificio institucional de 3 niveles, 24 x 18 m, altura libre 3.20 m';
    expect(interpretBuildingPrompt(prompt)).toEqual(interpretBuildingPrompt(prompt));
  });
});

describe('contrato de especificacion', () => {
  const base = interpretBuildingPrompt(
    'Edificio institucional de 3 niveles, longitud 24 m, ancho 18 m, altura libre 3.20 m, altura entre niveles 3.60 m',
  );

  it('convierte a la forma que consume el generador', () => {
    const payload = toGeneratorSpec(base);
    expect(payload.levels).toBe(3);
    expect(payload.length_x_m).toBeCloseTo(24, 5);
    expect(payload.width_y_m).toBeCloseTo(18, 5);
    expect(payload.clear_height_m).toBeCloseTo(3.2, 5);
    expect(payload.floor_to_floor_m).toBeCloseTo(3.6, 5);
  });

  it('omite del payload lo que no se conoce, en vez de enviar un cero', () => {
    const partial = interpretBuildingPrompt('Edificio de 3 niveles de 24 x 18 m');
    const payload = toGeneratorSpec(partial);
    expect(payload).not.toHaveProperty('clear_height_m');
    expect(payload).not.toHaveProperty('floor_to_floor_m');
  });

  it('rechaza una altura libre incompatible con la altura entre niveles', () => {
    const bad = { ...base, clearHeightM: 3.5, floorToFloorM: 3.6 };
    expect(validateSpecification(bad)).toContain(
      'Entre la altura libre y la altura entre niveles deben quedar al menos 0.20 m para viga y losa.',
    );
  });

  it('rechaza un numero de niveles fuera de rango', () => {
    expect(validateSpecification({ ...base, levels: 0 }).length).toBeGreaterThan(0);
    expect(validateSpecification({ ...base, levels: 30 }).length).toBeGreaterThan(0);
  });

  it('acepta una especificacion completa', () => {
    expect(validateSpecification(base)).toHaveLength(0);
  });

  it('resume lo entendido de forma legible', () => {
    const lines = describeSpecification(base);
    expect(lines[0]).toContain('3 niveles');
    expect(lines.join(' ')).toContain('24.00 x 18.00 m');
  });
});

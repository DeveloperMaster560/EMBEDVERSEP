import { describe, expect, it } from 'vitest';
import { canGenerateBridge } from './ai-contracts';
import { interpretBridgePromptLocally } from './local-bridge-interpreter';

describe('local bridge description interpreter', () => {
  it('extracts measurements, total supports per side, and height reference without network services', () => {
    const result = interpretBridgePromptLocally(
      'Puente de vigas de 30 metros de longitud y 8 m de ancho, tablero a 15 m sobre el terreno, dos apoyos a cada lado.',
    );

    expect(result.structureType).toBe('beam');
    expect(result.overallDimensions).toMatchObject({
      lengthM: 30,
      widthM: 8,
      heightM: 15,
      heightMeaning: 'deck_above_ground',
      heightReference: 'Terreno indicado por el usuario',
    });
    expect(result.supports).toMatchObject({ quantity: 4, distribution: 'paired_across_width' });
    expect(canGenerateBridge(result)).toBe(true);
    expect(result.assumptions[0]).toContain('no se usó un modelo de IA');
  });

  it('interprets the full bridge prompt with an explicit deck elevation and support dimensions', () => {
    const result = interpretBridgePromptLocally(
      'Diseña un puente conceptual de vigas de 30 m de longitud y 8 m de ancho. El tablero está a 12 m sobre el terreno y tiene un espesor de 0,30 m. Incluye cuatro apoyos de concreto, distribuidos en dos pares a ambos lados; cada apoyo mide 1,2 m de ancho y 1 m de profundidad. Añade estribos, vigas transversales y barandas.',
    );

    expect(result.overallDimensions).toMatchObject({
      lengthM: 30,
      widthM: 8,
      heightM: 12,
      heightMeaning: 'deck_above_ground',
      heightReference: 'Terreno indicado por el usuario',
    });
    expect(result.deck.thicknessM).toBe(0.3);
    expect(result.supports).toMatchObject({
      quantity: 4,
      distribution: 'paired_across_width',
      material: 'concrete',
      widthM: 1.2,
      depthM: 1,
    });
    expect(result.unresolvedQuestions).toEqual([]);
    expect(canGenerateBridge(result)).toBe(true);
  });

  it('creates an approval-ready, explicitly assumed cable-stayed bridge proposal', () => {
    const result = interpretBridgePromptLocally(
      'Diseña un puente atirantado de gran escala con tablero longitudinal, dos torres inclinadas, cables simétricos, vigas principales y transversales, apoyos, cimentaciones y barandas. Generar 40 cables en total. Primero presenta la propuesta y espera mi aprobación.',
    );

    expect(result.structureType).toBe('cable_stayed');
    expect(result.overallDimensions).toMatchObject({
      lengthM: 300,
      widthM: 30,
      heightM: 25,
      heightMeaning: 'deck_above_ground',
      heightReference: 'Supuesto conceptual; confirmar antes de aprobar',
    });
    expect(result.stayCableCount).toBe(40);
    expect(result.supports.quantity).toBe(0);
    expect(result.unresolvedQuestions).toEqual([]);
    expect(result.assumptions.some((item) => item.includes('Longitud inicial de 300 m asumida'))).toBe(true);
    expect(result.assumptions.some((item) => item.includes('40 tirantes cilíndricos'))).toBe(true);
    expect(canGenerateBridge(result)).toBe(true);
  });

  it('does not confuse cable-tower height or deck width with deck elevation', () => {
    const result = interpretBridgePromptLocally(
      `Genera un modelo de un PUENTE ATIRANTADO.
### 1. DIMENSIONES GENERALES
- Longitud total: 180 m.
- Ancho del tablero: 12 m.
### 2. TABLERO
- Espesor del tablero: 1.20 m.
- Incorporar barandas laterales de 1.20 m de altura.
### 3. TORRES PRINCIPALES
- Altura: 45 m sobre el tablero.
- Separación longitudinal entre torres: 60 m.
- Sección transversal: 3 × 4 m.
### 4. SISTEMA DE ATIRANTAMIENTO
- Generar 40 cables en total.
- Diámetro conceptual: 0.12 m.
### 5. VIGAS
 - Dos vigas longitudinales principales de 180 m.
- Altura de sección: 2 m.
- Ancho de sección: 0.80 m.
- Vigas transversales cada 6 m.
- Ancho de cada viga transversal: 0.60 m.
- Altura de cada viga transversal: 1 m.
### 6. CIMENTACIONES Y APOYOS
- Dimensiones de cada zapata: 10 × 10 × 3 m.`,
    );

    expect(result.overallDimensions.widthM).toBe(12);
    expect(result.overallDimensions.heightM).toBe(25);
    expect(result.overallDimensions.heightReference).toBe('Supuesto conceptual; confirmar antes de aprobar');
    expect(result.stayCableCount).toBe(40);
    expect(result.cableStayed).toEqual({
      towerHeightM: 45,
      towerSpacingM: 60,
      towerSectionWidthM: 3,
      towerSectionDepthM: 4,
      stayCableDiameterM: 0.12,
      mainGirderCount: 2,
      mainGirderHeightM: 2,
      mainGirderWidthM: 0.8,
      crossBeamSpacingM: 6,
      crossBeamWidthM: 0.6,
      crossBeamHeightM: 1,
      foundationLengthM: 10,
      foundationWidthM: 10,
      foundationDepthM: 3,
      guardrailHeightM: 1.2,
    });
    expect(result.unresolvedQuestions).toEqual([]);
    expect(canGenerateBridge(result)).toBe(true);
  });

  it('converts centimetres and requests clarification for an ambiguous height and support layout', () => {
    const result = interpretBridgePromptLocally(
      'Puente de losa, longitud de 2500 cm, ancho de 600 cm, altura 500 cm, cuatro apoyos.',
    );

    expect(result.structureType).toBe('slab');
    expect(result.overallDimensions).toMatchObject({ lengthM: 25, widthM: 6, heightM: 5, heightMeaning: 'unknown' });
    expect(result.unresolvedQuestions).toContain(
      '¿La altura indicada corresponde al tablero sobre el terreno, a la altura total o a otra referencia?',
    );
    expect(result.unresolvedQuestions).toContain(
      '¿Cómo se distribuyen los apoyos: en una fila a lo largo del puente o en pares a ambos lados?',
    );
    expect(canGenerateBridge(result)).toBe(false);
  });

  it('does not silently replace an unsupported bridge typology', () => {
    const result = interpretBridgePromptLocally(
      'Puente colgante de 100 m de longitud y 12 m de ancho, tablero a 10 m sobre el terreno, sin apoyos.',
    );

    expect(result.structureType).toBe('beam');
    expect(result.warnings).toContain(
      'La tipología solicitada no se puede generar localmente; no se sustituirá silenciosamente por otra.',
    );
    expect(canGenerateBridge(result)).toBe(false);
  });

  it('recognizes an explicit no-supports description', () => {
    const result = interpretBridgePromptLocally(
      'Puente de vigas de 40 m de longitud y 10 m de ancho, tablero a 8 m sobre el terreno, sin apoyos.',
    );

    expect(result.supports.quantity).toBe(0);
    expect(result.components.find(({ type }) => type === 'support')?.included).toBe(false);
    expect(result.unresolvedQuestions).not.toContain('¿Cuántos apoyos necesitas?');
  });

  it('asks for fields whose measurements are absent instead of inventing them', () => {
    const result = interpretBridgePromptLocally('Quiero diseñar un puente de vigas.');

    expect(result.overallDimensions.lengthM).toBeNull();
    expect(result.overallDimensions.widthM).toBeNull();
    expect(result.supports.quantity).toBeNull();
    expect(result.generationStatus).toBe('needs_clarification');
    expect(canGenerateBridge(result)).toBe(false);
  });
});

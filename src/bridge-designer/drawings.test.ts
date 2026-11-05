import { describe, expect, it } from 'vitest';
import { createAiBridgeObjects, createScene } from './scene';
import { parseBridgeSpecification } from './ai-contracts';
import { createBridgeDrawingSvg, createPrintableBridgeDrawingHtml } from './drawings';

describe('bridge technical drawing export', () => {
  it('exports printable orthographic views from editable bridge objects with explicit conceptual limits', () => {
    const specification = parseBridgeSpecification({
      schemaVersion: 1,
      structureType: 'cable_stayed',
      bridgeName: 'Puente de prueba',
      units: 'm',
      overallDimensions: {
        lengthM: 180,
        widthM: 12,
        heightM: 25,
        heightMeaning: 'deck_above_ground',
        heightReference: 'Supuesto conceptual',
      },
      stayCableCount: 40,
      deck: { thicknessM: 1.2 },
      supports: {
        type: 'column',
        orientation: 'vertical',
        distribution: 'unknown',
        quantity: 0,
        widthM: null,
        depthM: null,
        material: 'unknown',
      },
      components: [
        { id: 'deck', type: 'deck', included: true },
        { id: 'tower', type: 'tower', included: true },
        { id: 'cables', type: 'stay_cable', included: true },
        { id: 'foundations', type: 'foundation', included: true },
      ],
      assumptions: [],
      unresolvedQuestions: [],
      warnings: [],
      generationStatus: 'ready_for_approval',
      conceptualModel: true,
    });
    const scene = createScene('project', 'Puente <demo>');
    scene.bridgeType = 'cable-stayed';
    scene.objects = createAiBridgeObjects(specification, 'm');

    const svg = createBridgeDrawingSvg(scene);
    const html = createPrintableBridgeDrawingHtml(scene);

    expect(svg).toContain('ALZADO LONGITUDINAL');
    expect(svg).toContain('PLANTA');
    expect(svg).toContain('SECCIÓN TRANSVERSAL');
    expect(svg).toContain('180.00 m');
    expect(svg).toContain('NO USAR PARA CONSTRUCCIÓN');
    expect(svg).toContain('Puente &lt;demo&gt;');
    expect(svg).toContain('<line');
    expect(html).toContain('@page{size:A3 landscape;margin:0}');
    expect(html).toContain('window.print()');
  });

  it('reports an actionable error when there are no visible structural objects', () => {
    const scene = createScene('project', 'Vacío');
    expect(() => createBridgeDrawingSvg(scene)).toThrow(/No hay geometría visible/);
  });
});

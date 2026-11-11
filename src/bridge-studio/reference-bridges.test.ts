import { describe, expect, it } from 'vitest';

import { toGeneratorSpec } from './contracts';
import { interpretBridgePrompt } from './prompt-interpreter';
import { REFERENCE_BRIDGES, matchReferenceBridge, specificationFor } from './reference-bridges';

describe('catálogo de obras de referencia', () => {
  it('reconoce la obra por varios nombres de uso corriente', () => {
    for (const prompt of [
      'Viaducto de la Novena, Bucaramanga.',
      'quiero el viaducto la novena',
      'VIADUCTO PROVINCIAL',
      'modela el Viaducto Alejandro Galvis',
    ]) {
      expect(matchReferenceBridge(prompt)?.id, prompt).toBe('viaducto-provincial-bucaramanga');
    }
  });

  it('no confunde un puente cualquiera con una obra del catálogo', () => {
    expect(matchReferenceBridge('Puente de vigas de 90 m de longitud.')).toBeNull();
  });

  it('carga el reparto real de vanos en vez de repartir en partes iguales', () => {
    const spec = interpretBridgePrompt('Viaducto de la Novena, Bucaramanga.');
    expect(spec.spanLengthsM).toEqual([129.2, 292.4, 129.2]);
    const iguales = 550.8 / 3;
    expect(spec.spanLengthsM?.every((v) => v === iguales)).toBe(false);
  });

  it('los vanos suman la longitud declarada', () => {
    for (const bridge of REFERENCE_BRIDGES) {
      const { spanLengthsM, lengthM } = bridge.specification;
      if (!spanLengthsM || lengthM === null) continue;
      const suma = spanLengthsM.reduce((total, v) => total + v, 0);
      expect(Math.abs(suma - lengthM), bridge.id).toBeLessThan(0.05);
    }
  });

  it('toda obra declara la fuente de sus dimensiones', () => {
    for (const bridge of REFERENCE_BRIDGES) {
      expect(bridge.sources.length, bridge.id).toBeGreaterThan(0);
      expect(bridge.caveats.length, bridge.id).toBeGreaterThan(0);
    }
  });

  it('las fuentes viajan como supuestos y los límites como advertencias', () => {
    const spec = interpretBridgePrompt('Viaducto de la Novena, Bucaramanga.');
    expect(spec.assumptions.length).toBeGreaterThan(1);
    expect(spec.questions.length).toBeGreaterThan(0);
    expect(spec.questions.join(' ')).toMatch(/no procede de planos|levantamiento/i);
  });

  it('ninguna coordenada se declara sin decir de dónde sale', () => {
    for (const bridge of REFERENCE_BRIDGES) {
      const site = bridge.specification.site;
      if (!site || site.latitudeDeg === undefined) continue;
      expect(site.provenance?.latitude_deg, bridge.id).toBeTruthy();
      expect(site.provenance?.longitude_deg, bridge.id).toBeTruthy();
    }
  });

  it('no inventa lo que las fuentes no dicen', () => {
    const site = specificationFor(REFERENCE_BRIDGES[0]).site;
    // Sismo, viento, lluvia y suelo exigen norma y estudio geotécnico.
    expect(site?.seismicHazardZone).toBeUndefined();
    expect(site?.designWindSpeedKmh).toBeUndefined();
    expect(site?.soilProfileType).toBeUndefined();
  });

  it('produce una solicitud que el generador acepta', () => {
    const sent = toGeneratorSpec(interpretBridgePrompt('Viaducto de la Novena, Bucaramanga.'));
    expect(sent.span_lengths).toEqual([129.2, 292.4, 129.2]);
    expect(sent.tower_height_m).toBe(60);
    expect(sent.length_m).toBe(550.8);
    expect((sent.site as Record<string, unknown>).latitude_deg).toBeCloseTo(7.10817, 5);
    expect(sent.disciplines).toContain('control');
  });

  it('La Novena se genera con las estaciones del diseño SHM, y lo dice', () => {
    const spec = interpretBridgePrompt('Viaducto de la Novena, Bucaramanga.');
    expect(toGeneratorSpec(spec).instrumentation_layout).toBe('shm-novena-2026-11');
    expect(spec.assumptions.join(' ')).toMatch(/Diseno_SHM_Viaducto_Novena/);
    expect(spec.questions.join(' ')).toMatch(/hipótesis/);
  });

  it('un puente cualquiera no recibe el diseño SHM de La Novena', () => {
    const spec = interpretBridgePrompt('Puente de vigas de 90 m de longitud y 3 vanos.');
    expect(toGeneratorSpec(spec).instrumentation_layout).toBeUndefined();
  });
});

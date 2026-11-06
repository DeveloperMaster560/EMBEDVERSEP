import { describe, expect, it } from 'vitest';

import { MATERIAL_PRESETS, presetFor, DEFAULT_PRESET, DISCIPLINE_COLOR } from './materials';
import { bridgeTier, explodeOffset, levelOrder, parseNodeName, zoneOrder } from './scene-graph';
import { ALL_DISCIPLINES } from '../building-studio/contracts';
import { ALL_BRIDGE_DISCIPLINES } from '../bridge-studio/contracts';

describe('parseNodeName', () => {
  it('separa disciplina, nivel e identificador', () => {
    expect(parseNodeName('structure__N2__STR-COL-N2-1A')).toEqual({
      discipline: 'structure',
      level: 'N2',
      componentId: 'STR-COL-N2-1A',
    });
  });

  it('lee igual un nodo de puente', () => {
    expect(parseNodeName('drainage__TAB__DRE-SUM-004')).toEqual({
      discipline: 'drainage',
      level: 'TAB',
      componentId: 'DRE-SUM-004',
    });
  });

  it('trata la marca SIN como componente sin nivel', () => {
    expect(parseNodeName('electrical__SIN__ELE-MON-001')?.level).toBe('');
  });

  it('conserva identificadores que contienen el separador', () => {
    const parsed = parseNodeName('hvac__N1__CLI-UNI__ESPECIAL');
    expect(parsed?.componentId).toBe('CLI-UNI__ESPECIAL');
  });

  it('devuelve null ante nombres que no siguen el convenio', () => {
    expect(parseNodeName('')).toBeNull();
    expect(parseNodeName('malla_suelta')).toBeNull();
    expect(parseNodeName('structure__N1')).toBeNull();
    expect(parseNodeName('__N1__ALGO')).toBeNull();
  });
});

describe('orden y explosión de niveles de edificio', () => {
  it('ordena cimentación, niveles y cubierta', () => {
    expect(levelOrder('NF')).toBeLessThan(levelOrder('N1'));
    expect(levelOrder('N1')).toBeLessThan(levelOrder('N2'));
    expect(levelOrder('N2')).toBeLessThan(levelOrder('NC'));
  });

  it('el primer nivel no se desplaza y los siguientes suben de forma uniforme', () => {
    expect(explodeOffset('N1', 4, 3)).toBe(0);
    expect(explodeOffset('N2', 4, 3)).toBe(4);
    expect(explodeOffset('N3', 4, 3)).toBe(8);
  });

  it('la cubierta queda por encima y la cimentación por debajo', () => {
    expect(explodeOffset('NC', 4, 3)).toBe(12);
    expect(explodeOffset('NF', 4, 3)).toBe(-4);
  });

  it('un nivel desconocido no se mueve en vez de saltar a una cota absurda', () => {
    expect(explodeOffset('XX', 4, 3)).toBe(0);
  });

  it('con separación cero nada se desplaza', () => {
    for (const level of ['NF', 'N1', 'N2', 'NC']) {
      expect(explodeOffset(level, 0, 3)).toBe(0);
    }
  });
});

describe('orden y explosión de zonas de puente', () => {
  it('agrupa las zonas por estrato constructivo', () => {
    expect(bridgeTier('CIM')).toBe(-1);
    for (const zone of ['EA', 'EB', 'P1', 'P7', 'T1', 'T2']) {
      expect(bridgeTier(zone), `${zone} debería ser subestructura`).toBe(0);
    }
    expect(bridgeTier('V1')).toBe(1);
    expect(bridgeTier('V3')).toBe(1);
    expect(bridgeTier('TAB')).toBe(2);
  });

  it('baja la cimentación, deja quietas pilas y torres y sube el tablero', () => {
    expect(explodeOffset('CIM', 3, 1, 'bridge')).toBe(-3);
    expect(explodeOffset('P1', 3, 1, 'bridge')).toBe(0);
    expect(explodeOffset('T1', 3, 1, 'bridge')).toBe(0);
    expect(explodeOffset('V2', 3, 1, 'bridge')).toBe(3);
    expect(explodeOffset('TAB', 3, 1, 'bridge')).toBe(6);
  });

  it('con separación cero nada se desplaza', () => {
    for (const zone of ['CIM', 'EA', 'P1', 'V1', 'TAB', 'T1']) {
      expect(explodeOffset(zone, 0, 1, 'bridge')).toBe(0);
    }
  });

  it('ordena las zonas de abajo arriba y de principio a fin del puente', () => {
    const zonas = ['TAB', 'P2', 'EB', 'V1', 'CIM', 'EA', 'P1', 'V2', 'T1'];
    const ordenadas = [...zonas].sort((a, b) => zoneOrder('bridge', a) - zoneOrder('bridge', b));
    expect(ordenadas).toEqual(['CIM', 'EA', 'P1', 'P2', 'EB', 'V1', 'V2', 'TAB', 'T1']);
  });

  it('ordena las pilas por número, no alfabéticamente', () => {
    expect(zoneOrder('bridge', 'P2')).toBeLessThan(zoneOrder('bridge', 'P10'));
  });

  it('en dominio edificio delega en el orden de niveles', () => {
    expect(zoneOrder('building', 'NF')).toBeLessThan(zoneOrder('building', 'N1'));
    expect(zoneOrder('building', 'N1')).toBeLessThan(zoneOrder('building', 'NC'));
  });
});

describe('presentación de materiales', () => {
  it('devuelve un preset por cada material que declara el generador de edificios', () => {
    const declarados = [
      'concreto_estructural', 'acero_refuerzo', 'muro_mamposteria', 'vidrio',
      'aluminio', 'madera_puerta', 'cobre', 'pvc', 'pvc_sanitario', 'cpvc',
      'acero_galvanizado', 'equipo_generico', 'luminaria',
    ];
    for (const key of declarados) {
      expect(MATERIAL_PRESETS[key], `falta preset para ${key}`).toBeDefined();
      expect(presetFor(key)).not.toBe(DEFAULT_PRESET);
    }
  });

  it('devuelve un preset por cada material que declara el generador de puentes', () => {
    const declarados = [
      'concreto_estructural', 'concreto_pretensado', 'acero_estructural',
      'acero_tirante', 'neopreno', 'asfalto', 'acero_galvanizado', 'pvc',
      'pintura_vial', 'senal_vial', 'luminaria', 'equipo_generico',
      'junta_dilatacion',
    ];
    for (const key of declarados) {
      expect(MATERIAL_PRESETS[key], `falta preset para ${key}`).toBeDefined();
      expect(presetFor(key)).not.toBe(DEFAULT_PRESET);
    }
  });

  it('usa un preset neutro cuando el material no está declarado', () => {
    expect(presetFor(null)).toBe(DEFAULT_PRESET);
    expect(presetFor('material_inventado')).toBe(DEFAULT_PRESET);
  });

  it('el vidrio es el único con transmisión', () => {
    expect(MATERIAL_PRESETS.vidrio.transmission).toBeGreaterThan(0.5);
    const conTransmision = Object.entries(MATERIAL_PRESETS)
      .filter(([, preset]) => preset.transmission)
      .map(([key]) => key);
    expect(conTransmision).toEqual(['vidrio']);
  });

  it('los metales tienen metalness alto y el concreto no', () => {
    expect(MATERIAL_PRESETS.cobre.metalness).toBeGreaterThan(0.8);
    expect(MATERIAL_PRESETS.aluminio.metalness).toBeGreaterThan(0.8);
    expect(MATERIAL_PRESETS.acero_tirante.metalness).toBeGreaterThan(0.8);
    expect(MATERIAL_PRESETS.concreto_estructural.metalness).toBe(0);
    expect(MATERIAL_PRESETS.asfalto.metalness).toBe(0);
  });

  it('cada disciplina de edificación tiene color propio y todos son distintos', () => {
    for (const key of ALL_DISCIPLINES) {
      expect(DISCIPLINE_COLOR[key], `falta color para ${key}`).toMatch(/^#[0-9a-f]{6}$/i);
    }
    const colores = ALL_DISCIPLINES.map((k) => DISCIPLINE_COLOR[k]);
    expect(new Set(colores).size).toBe(colores.length);
  });

  it('cada disciplina de puente tiene color propio y todos son distintos', () => {
    for (const key of ALL_BRIDGE_DISCIPLINES) {
      expect(DISCIPLINE_COLOR[key], `falta color para ${key}`).toMatch(/^#[0-9a-f]{6}$/i);
    }
    const colores = ALL_BRIDGE_DISCIPLINES.map((k) => DISCIPLINE_COLOR[k]);
    expect(new Set(colores).size).toBe(colores.length);
  });
});

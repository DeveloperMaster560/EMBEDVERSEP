import { describe, expect, it } from 'vitest';
import { createLibraryCircuitComponent, findLibraryComponent, parseComponentLibrary } from './componentLibrary';
import { getCircuitPins, validateCircuit } from './circuit';
import type { CircuitLibraryPackage, ElectronicCircuit } from './types';
import starterLibrary from '../../public/libraries/EMBEDVERSE-Basicos.evcl.json?raw';

describe('EMBEDVERSE component library packages', () => {
  it('accepts the downloadable starter library', () => {
    expect(parseComponentLibrary(starterLibrary).components.map(({ id }) => id))
      .toEqual(['dht22', 'hc-sr04', 'ssd1306-i2c', 'sg90-servo']);
  });

  it('creates a pin-aware custom part and validates required connections', () => {
    const library = parseComponentLibrary(JSON.stringify({
      schemaVersion: 1,
      id: 'test-library',
      name: 'Test library',
      version: '1.0.0',
      license: 'CC0-1.0',
      components: [{
        id: 'dht22',
        name: 'DHT22',
        manufacturer: 'Aosong',
        reference: 'AM2302',
        category: 'Sensors',
        description: 'Temperature and humidity sensor.',
        compatibleBoards: ['arduino-uno', 'esp32-devkit'],
        operatingVoltage: { min: 3.3, max: 5 },
        interfaces: ['Single-wire'],
        pins: [
          { id: 'vcc', label: 'VCC', type: 'power', x: -40, y: -10, required: true },
          { id: 'data', label: 'DATA', type: 'signal', x: -40, y: 10, required: true },
          { id: 'gnd', label: 'GND', type: 'ground', x: 40, y: 10, required: true },
        ],
      }],
    }));
    const definition = library.components.find(({ id }) => id === 'dht22');
    if (!definition) throw new Error('DHT22 starter definition is missing.');

    const component = createLibraryCircuitComponent(definition, 4);
    const circuit: ElectronicCircuit = {
      name: 'Test',
      boardId: 'arduino-uno',
      components: [component],
      connections: [],
      componentLibraries: [library],
    };

    expect(component.kind).toBe('custom');
    expect(getCircuitPins(component, circuit.boardId, circuit.componentLibraries).map(({ id }) => id))
      .toEqual(['vcc', 'data', 'gnd']);
    expect(validateCircuit(circuit).issues).toEqual([
      'AM2302 · 4 requiere conexiones en: VCC, DATA, GND.',
    ]);
    expect(findLibraryComponent(circuit.componentLibraries, component.libraryComponentId)).toEqual(definition);
  });

  it('rejects unsafe URLs, duplicate pin IDs, and oversized packages', () => {
    const valid: CircuitLibraryPackage = {
      schemaVersion: 1,
      id: 'test-library',
      name: 'Test library',
      version: '1.0.0',
      license: 'CC0-1.0',
      components: [{
        id: 'test-part',
        name: 'Test part',
        manufacturer: 'Test',
        reference: 'TP1',
        category: 'Test',
        description: 'A package fixture.',
        compatibleBoards: ['arduino-uno'],
        operatingVoltage: null,
        interfaces: [],
        pins: [
          { id: 'vcc', label: 'VCC', type: 'power', x: -20, y: 0 },
          { id: 'gnd', label: 'GND', type: 'ground', x: 20, y: 0 },
        ],
      }],
    };

    expect(() => parseComponentLibrary(JSON.stringify({
      ...valid,
      components: [{ ...valid.components[0], datasheetUrl: 'http://example.test/data.pdf' }],
    }))).toThrow(/formato EMBEDVERSE/);
    expect(() => parseComponentLibrary(JSON.stringify({
      ...valid,
      components: [{ ...valid.components[0], pins: [valid.components[0].pins[0], valid.components[0].pins[0]] }],
    }))).toThrow(/formato EMBEDVERSE/);
    expect(() => parseComponentLibrary(' '.repeat(1024 * 1024 + 1))).toThrow(/1 MiB/);
  });
});

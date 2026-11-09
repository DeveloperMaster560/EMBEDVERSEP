import { describe, expect, it } from 'vitest';

import type {
  CircuitComponent, CircuitConnection, CircuitLibraryPackage, ElectronicCircuit,
} from '../domain/types';
import { analogChannelOf, bindCircuit, boardPinNumber } from './binding';
import { ButtonDevice, InvertedLed, LedDevice, PhotocellDevice, RelayDevice } from './devices';

const board: CircuitComponent = {
  id: 'board', kind: 'board', label: 'Arduino Uno R3', description: '',
};

function circuit(
  components: CircuitComponent[],
  connections: CircuitConnection[],
  libraries?: CircuitLibraryPackage[],
): ElectronicCircuit {
  return {
    name: 'prueba',
    boardId: 'arduino-uno',
    components: [board, ...components],
    connections,
    componentLibraries: libraries,
  };
}

const led: CircuitComponent = { id: 'd1', kind: 'led', label: 'D1', description: '' };
const resistor: CircuitComponent = { id: 'r1', kind: 'resistor', label: 'R1', description: '' };
const button: CircuitComponent = { id: 'sw1', kind: 'button', label: 'SW1', description: '' };

/** Módulo de fotocelda con las dos salidas, como el LM393 real. */
const photocellLibrary: CircuitLibraryPackage = {
  schemaVersion: 1, id: 'lib', name: 'prueba', version: '1', license: 'CC0',
  components: [{
    id: 'fotocelda', name: 'Fotocelda LM393', manufacturer: '-', reference: 'LM393',
    category: 'optical', description: '', compatibleBoards: ['arduino-uno'],
    operatingVoltage: { min: 3.3, max: 5 }, interfaces: ['analog', 'digital'],
    pins: [
      { id: 'VCC', label: 'VCC', type: 'power', x: 0, y: 0 },
      { id: 'GND', label: 'GND', type: 'ground', x: 0, y: 0 },
      { id: 'DO', label: 'DO', type: 'signal', x: 0, y: 0 },
      { id: 'AO', label: 'AO', type: 'signal', x: 0, y: 0 },
    ],
  }],
};

const relayLibrary: CircuitLibraryPackage = {
  schemaVersion: 1, id: 'lib2', name: 'prueba', version: '1', license: 'CC0',
  components: [{
    id: 'rele', name: 'Módulo de relé', manufacturer: '-', reference: 'SRD-05VDC',
    category: 'actuators', description: '', compatibleBoards: ['arduino-uno'],
    operatingVoltage: { min: 5, max: 5 }, interfaces: ['digital'],
    pins: [
      { id: 'VCC', label: 'VCC', type: 'power', x: 0, y: 0 },
      { id: 'GND', label: 'GND', type: 'ground', x: 0, y: 0 },
      { id: 'IN', label: 'IN', type: 'signal', x: 0, y: 0 },
    ],
  }],
};

describe('numeración de los pines de la placa', () => {
  it('traduce las etiquetas digitales y analógicas', () => {
    expect(boardPinNumber('D13')).toBe(13);
    expect(boardPinNumber('D2')).toBe(2);
    // A0 es el pin 14 en la numeración de Arduino, no el 0.
    expect(boardPinNumber('A0')).toBe(14);
    expect(boardPinNumber('A5/SCL')).toBe(19);
    expect(boardPinNumber('A4/SDA')).toBe(18);
  });

  it('rechaza lo que no es un pin numerable', () => {
    expect(boardPinNumber('5V')).toBeNull();
    expect(boardPinNumber('GND')).toBeNull();
    expect(boardPinNumber('3V3')).toBeNull();
    expect(boardPinNumber('GPIO21/SDA')).toBeNull();
    // El ATmega328P no tiene D14 ni A6.
    expect(boardPinNumber('D14')).toBeNull();
    expect(boardPinNumber('A6')).toBeNull();
  });

  it('sitúa los canales del ADC', () => {
    expect(analogChannelOf(18)).toBe(4);
    expect(analogChannelOf(14)).toBe(0);
    expect(analogChannelOf(13)).toBeNull();
  });
});

describe('trazado de un LED', () => {
  it('lo sigue a través de la resistencia en serie hasta el pin', () => {
    const result = bindCircuit(circuit([resistor, led], [
      { from: 'board', fromPin: 'D13', to: 'r1', toPin: '1' },
      { from: 'r1', fromPin: '2', to: 'd1', toPin: 'A' },
      { from: 'd1', fromPin: 'K', to: 'board', toPin: 'GND' },
    ]));
    expect(result.unresolved).toEqual([]);
    expect(result.devices).toHaveLength(1);
    const device = result.devices[0] as LedDevice;
    expect(device).toBeInstanceOf(LedDevice);
    expect(device.pin).toBe(13);
    expect(result.watchPins).toEqual([13]);
  });

  it('no lo conecta si el cátodo no tiene retorno a masa', () => {
    const result = bindCircuit(circuit([led], [
      { from: 'board', fromPin: 'D13', to: 'd1', toPin: 'A' },
    ]));
    expect(result.devices).toEqual([]);
    expect(result.unresolved[0].reason).toMatch(/no llega a masa/);
  });

  it('reconoce el montaje invertido contra alimentación', () => {
    const result = bindCircuit(circuit([led], [
      { from: 'board', fromPin: '5V', to: 'd1', toPin: 'A' },
      { from: 'd1', fromPin: 'K', to: 'board', toPin: 'D13' },
    ]));
    expect(result.devices[0]).toBeInstanceOf(InvertedLed);
  });

  it('no atraviesa un condensador en serie, que bloquea la continua', () => {
    const capacitor: CircuitComponent = { id: 'c1', kind: 'capacitor', label: 'C1', description: '' };
    const result = bindCircuit(circuit([capacitor, led], [
      { from: 'board', fromPin: 'D13', to: 'c1', toPin: '1' },
      { from: 'c1', fromPin: '2', to: 'd1', toPin: 'A' },
      { from: 'd1', fromPin: 'K', to: 'board', toPin: 'GND' },
    ]));
    expect(result.devices).toEqual([]);
    expect(result.unresolved[0].reason).toMatch(/Ninguna de sus patas/);
  });
});

describe('trazado de un pulsador', () => {
  it('deduce que es activo a nivel bajo si el otro contacto va a masa', () => {
    const result = bindCircuit(circuit([button], [
      { from: 'board', fromPin: 'D2', to: 'sw1', toPin: '1' },
      { from: 'sw1', fromPin: '2', to: 'board', toPin: 'GND' },
    ]));
    const device = result.devices[0] as ButtonDevice;
    expect(device).toBeInstanceOf(ButtonDevice);
    expect(device.pin).toBe(2);
    expect(device.activeLow).toBe(true);
  });

  it('deduce que es activo a nivel alto si el otro contacto va a 5 V', () => {
    const result = bindCircuit(circuit([button], [
      { from: 'board', fromPin: 'D2', to: 'sw1', toPin: '1' },
      { from: 'sw1', fromPin: '2', to: 'board', toPin: '5V' },
    ]));
    expect((result.devices[0] as ButtonDevice).activeLow).toBe(false);
  });

  it('avisa si el otro contacto está al aire', () => {
    const result = bindCircuit(circuit([button], [
      { from: 'board', fromPin: 'D2', to: 'sw1', toPin: '1' },
    ]));
    expect(result.devices).toEqual([]);
    expect(result.unresolved[0].reason).toMatch(/ni a masa ni a alimentación/);
  });
});

describe('trazado de módulos de biblioteca', () => {
  it('reconoce la fotocelda por sus salidas y le asigna el canal del ADC', () => {
    const module: CircuitComponent = {
      id: 'ldr', kind: 'custom', label: 'Fotocelda', description: '',
      libraryComponentId: 'fotocelda',
    };
    const result = bindCircuit(circuit([module], [
      { from: 'ldr', fromPin: 'AO', to: 'board', toPin: 'A4/SDA' },
      { from: 'ldr', fromPin: 'DO', to: 'board', toPin: 'D2' },
    ], [photocellLibrary]));
    const device = result.devices[0] as PhotocellDevice;
    expect(device).toBeInstanceOf(PhotocellDevice);
    expect(device.analogChannel).toBe(4);
    expect(device.digitalPin).toBe(2);
    expect(result.analogChannels).toEqual([4]);
  });

  it('rechaza la salida analógica cableada a un pin digital', () => {
    const module: CircuitComponent = {
      id: 'ldr', kind: 'custom', label: 'Fotocelda', description: '',
      libraryComponentId: 'fotocelda',
    };
    const result = bindCircuit(circuit([module], [
      { from: 'ldr', fromPin: 'AO', to: 'board', toPin: 'D13' },
    ], [photocellLibrary]));
    expect(result.devices).toEqual([]);
    expect(result.unresolved[0].reason).toMatch(/El ADC solo lee A0 a A5/);
  });

  it('reconoce el relé por su entrada de mando', () => {
    const module: CircuitComponent = {
      id: 'k1', kind: 'custom', label: 'Relé', description: '',
      libraryComponentId: 'rele',
    };
    const result = bindCircuit(circuit([module], [
      { from: 'k1', fromPin: 'IN', to: 'board', toPin: 'D13' },
    ], [relayLibrary]));
    const device = result.devices[0] as RelayDevice;
    expect(device).toBeInstanceOf(RelayDevice);
    expect(device.pin).toBe(13);
    expect(device.activeLow).toBe(true);
  });

  it('declara sin simular el módulo cuya definición no está cargada', () => {
    const module: CircuitComponent = {
      id: 'x', kind: 'custom', label: 'Desconocido', description: '',
      libraryComponentId: 'no-existe',
    };
    const result = bindCircuit(circuit([module], [], [photocellLibrary]));
    expect(result.unresolved[0].reason).toMatch(/no está cargada/);
  });
});

describe('límites declarados', () => {
  it('no simula el ESP32 y lo dice', () => {
    const result = bindCircuit({
      name: 'esp', boardId: 'esp32-devkit',
      components: [{ id: 'b', kind: 'esp32', label: 'ESP32', description: '' }],
      connections: [],
    });
    expect(result.devices).toEqual([]);
    expect(result.unresolved[0].reason).toMatch(/otra arquitectura/);
  });

  it('no simula el MPU6050 en vez de inventar aceleraciones', () => {
    const imu: CircuitComponent = { id: 'u1', kind: 'mpu6050', label: 'U1', description: '' };
    const result = bindCircuit(circuit([imu], [
      { from: 'u1', fromPin: 'SDA', to: 'board', toPin: 'A4/SDA' },
    ]));
    expect(result.devices).toEqual([]);
    expect(result.unresolved[0].reason).toMatch(/no hay modelo del MPU6050/);
  });

  it('avisa cuando el circuito no tiene placa', () => {
    const result = bindCircuit({
      name: 'sin placa', boardId: 'arduino-uno',
      components: [led], connections: [],
    });
    expect(result.unresolved[0].reason).toMatch(/no tiene placa/);
  });
});

import { describe, expect, it } from 'vitest';
import { changeCircuitBoard, createArduinoPracticeCircuit, normalizeElectronicCircuit, validateCircuit } from './circuit';

describe('electronic circuit validation', () => {
  it('creates a fully wired vibration-monitoring circuit for Arduino and ESP32 pinouts', () => {
    const circuit = createArduinoPracticeCircuit('arduino-uno');
    const espCircuit = createArduinoPracticeCircuit('esp32-devkit');

    expect(validateCircuit(circuit)).toMatchObject({ valid: true });
    expect(espCircuit.components.find((component) => component.kind === 'esp32')).toBeDefined();
    expect(espCircuit.connections).toContainEqual(expect.objectContaining({ fromPin: 'GPIO21/SDA', toPin: 'SDA' }));
    expect(validateCircuit(espCircuit)).toMatchObject({ valid: true });
  });

  it('reports an MPU6050 whose I2C lines are not fully connected', () => {
    const circuit = createArduinoPracticeCircuit('arduino-uno');
    circuit.connections = circuit.connections.filter((connection) => connection.toPin !== 'SDA');

    const result = validateCircuit(circuit);

    expect(result.valid).toBe(false);
    expect(result.issues.some((issue) => issue.includes('SDA'))).toBe(true);
  });

  it('rejects endpoints that reference pins not present on their components', () => {
    const circuit = createArduinoPracticeCircuit('esp32-devkit');
    circuit.connections[0].fromPin = 'GPIO99';

    expect(validateCircuit(circuit).issues.some((issue) => issue.includes('pin no disponible'))).toBe(true);
  });

  it('preserves circuit components and remaps board pins when changing the target board', () => {
    const uno = createArduinoPracticeCircuit('arduino-uno');
    const esp32 = changeCircuitBoard(uno, 'esp32-devkit');

    expect(esp32.components.map((component) => component.id)).toEqual(uno.components.map((component) => component.id));
    expect(esp32.connections).toContainEqual(expect.objectContaining({ fromPin: 'GPIO21/SDA', toPin: 'SDA' }));
    expect(validateCircuit(esp32).valid).toBe(true);
  });

  it('upgrades the old fixed demo into an editable, positioned circuit', () => {
    const previousCircuit = createArduinoPracticeCircuit('arduino-uno');
    previousCircuit.components = previousCircuit.components.map(({ x: _x, y: _y, ...component }) => component);
    previousCircuit.components[0].id = 'uno-5v';
    previousCircuit.components[1].id = 'resistor';
    previousCircuit.components[2].id = 'led';
    previousCircuit.components.push({ id: 'uno-gnd', kind: 'ground', label: 'GND', description: 'Tierra' });

    const upgraded = normalizeElectronicCircuit(previousCircuit, 'esp32-devkit');

    expect(upgraded.components.some((component) => component.kind === 'mpu6050')).toBe(true);
    expect(upgraded.components.every((component) => Number.isFinite(component.x) && Number.isFinite(component.y))).toBe(true);
  });
});

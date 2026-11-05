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

  it('warns when a custom module is connected to a known supply outside its declared voltage range', () => {
    const circuit = createArduinoPracticeCircuit('arduino-uno');
    const board = circuit.components.find((component) => component.kind === 'board');
    if (!board) throw new Error('Test circuit is missing its board.');
    circuit.components.push({
      id: 'servo',
      kind: 'custom',
      libraryComponentId: 'servo',
      label: 'Servo SG90',
      description: 'Servo module.',
      x: 800,
      y: 300,
    });
    circuit.componentLibraries = [{
      schemaVersion: 1,
      id: 'test',
      name: 'Test',
      version: '1.0',
      license: 'CC0-1.0',
      components: [{
        id: 'servo',
        name: 'Servo',
        manufacturer: 'Test',
        reference: 'SG90',
        category: 'Actuator',
        description: 'Servo module.',
        compatibleBoards: ['arduino-uno'],
        operatingVoltage: { min: 4.8, max: 6 },
        interfaces: ['PWM'],
        pins: [
          { id: 'vcc', label: 'VCC', type: 'power', x: -40, y: -10, required: true },
          { id: 'signal', label: 'PWM', type: 'signal', x: -40, y: 10 },
        ],
      }],
    }];
    circuit.connections.push(
      { from: board.id, fromPin: '3V3', to: 'servo', toPin: 'vcc' },
      { from: board.id, fromPin: 'D13', to: 'servo', toPin: 'signal' },
    );

    const result = validateCircuit(circuit);

    expect(result.warnings).toContain('Servo SG90: 3.3 V está fuera del rango declarado (4.8–6 V).');
  });

  it('warns when 3.3 V and 5 V board outputs are wired together', () => {
    const circuit = createArduinoPracticeCircuit('arduino-uno');
    circuit.connections.push({ from: 'board', fromPin: '3V3', to: 'board', toPin: '5V' });

    expect(validateCircuit(circuit).warnings).toContain(
      'Hay un posible cortocircuito entre salidas de alimentación de distinto voltaje (3.3 V y 5 V).',
    );
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

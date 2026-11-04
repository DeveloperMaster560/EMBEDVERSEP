import type { BoardId, ElectronicCircuit } from './types';

export function createArduinoPracticeCircuit(boardId: BoardId): ElectronicCircuit {
  const isEsp32 = boardId === 'esp32-devkit';
  const boardKind = isEsp32 ? 'esp32' : 'board';
  const signalPin = isEsp32 ? 'GPIO18' : 'D13';
  const sdaPin = isEsp32 ? 'GPIO21/SDA' : 'A4/SDA';
  const sclPin = isEsp32 ? 'GPIO22/SCL' : 'A5/SCL';
  return {
    name: 'Sistema de monitoreo de vibraciones',
    boardId,
    components: [
      { id: 'board', kind: boardKind, label: isEsp32 ? 'ESP32 DevKit V1' : 'Arduino Uno R3', description: 'Placa de desarrollo · conexiones mostradas como pines lógicos.', x: 190, y: 300 },
      { id: 'mpu6050', kind: 'mpu6050', label: 'U1 · MPU6050', description: 'IMU de 6 ejes · interfaz I²C. No se simula el comportamiento del sensor.', x: 440, y: 205, value: '0x68' },
      { id: 'capacitor', kind: 'capacitor', label: 'C1 · 100 nF', description: 'Condensador de desacoplo representativo.', x: 650, y: 205, value: '100 nF' },
      { id: 'resistor', kind: 'resistor', label: 'R1 · 220 Ω', description: 'Resistencia limitadora de corriente del LED.', x: 440, y: 410, value: '220 Ω' },
      { id: 'led', kind: 'led', label: 'D1 · LED rojo', description: 'Indicador conectado a una salida digital.', x: 650, y: 410, value: 'Rojo' },
    ],
    connections: [
      { from: 'board', fromPin: '3V3', to: 'mpu6050', toPin: 'VCC', color: '#e8a353' },
      { from: 'board', fromPin: 'GND', to: 'mpu6050', toPin: 'GND', color: '#8394a8' },
      { from: 'board', fromPin: sdaPin, to: 'mpu6050', toPin: 'SDA', color: '#4b9ce2' },
      { from: 'board', fromPin: sclPin, to: 'mpu6050', toPin: 'SCL', color: '#6fbd8b' },
      { from: 'mpu6050', fromPin: 'VCC', to: 'capacitor', toPin: '1', color: '#e8a353' },
      { from: 'capacitor', fromPin: '2', to: 'mpu6050', toPin: 'GND', color: '#8394a8' },
      { from: 'board', fromPin: signalPin, to: 'resistor', toPin: '1', color: '#d184c6' },
      { from: 'resistor', fromPin: '2', to: 'led', toPin: 'A', color: '#e55562' },
      { from: 'led', fromPin: 'K', to: 'board', toPin: 'GND', color: '#8394a8' },
    ],
  };
}

export interface CircuitPin {
  id: string;
  label: string;
  x: number;
  y: number;
  type: 'power' | 'ground' | 'signal' | 'passive';
}

export function getCircuitPins(component: ElectronicCircuit['components'][number], boardId: BoardId): CircuitPin[] {
  switch (component.kind) {
    case 'board':
    case 'esp32': {
      const inputs = component.kind === 'esp32'
        ? [['GND', 'ground'], ['3V3', 'power'], ['5V/VIN', 'power'], ['GPIO21/SDA', 'signal'], ['GPIO22/SCL', 'signal'], ['GPIO18', 'signal'], ['GPIO19', 'signal']]
        : boardId === 'arduino-uno'
        ? [['GND', 'ground'], ['5V', 'power'], ['3V3', 'power'], ['D2', 'signal'], ['D13', 'signal'], ['A4/SDA', 'signal'], ['A5/SCL', 'signal']]
        : [['GND', 'ground'], ['3V3', 'power'], ['5V/VIN', 'power'], ['GPIO21/SDA', 'signal'], ['GPIO22/SCL', 'signal'], ['GPIO18', 'signal'], ['GPIO19', 'signal']];
      return inputs.map(([label, type], index) => ({
        id: label,
        label,
        x: index < 3 ? -76 : 76,
        y: -35 + (index < 3 ? index : index - 3) * 14,
        type: type as CircuitPin['type'],
      }));
    }
    case 'resistor':
    case 'capacitor':
      return [
        { id: '1', label: '1', x: -49, y: 0, type: 'passive' },
        { id: '2', label: '2', x: 49, y: 0, type: 'passive' },
      ];
    case 'led':
      return [
        { id: 'A', label: 'A', x: -38, y: 0, type: 'passive' },
        { id: 'K', label: 'K', x: 38, y: 0, type: 'passive' },
      ];
    case 'button':
      return [
        { id: '1', label: '1', x: -31, y: 0, type: 'passive' },
        { id: '2', label: '2', x: 31, y: 0, type: 'passive' },
      ];
    case 'mpu6050':
      return [
        { id: 'VCC', label: 'VCC', x: -45, y: -24, type: 'power' },
        { id: 'GND', label: 'GND', x: -45, y: -8, type: 'ground' },
        { id: 'SCL', label: 'SCL', x: -45, y: 8, type: 'signal' },
        { id: 'SDA', label: 'SDA', x: -45, y: 24, type: 'signal' },
        { id: 'AD0', label: 'AD0', x: 45, y: 8, type: 'signal' },
        { id: 'INT', label: 'INT', x: 45, y: 24, type: 'signal' },
      ];
    case 'power':
      return [{ id: 'VCC', label: 'VCC', x: 0, y: -14, type: 'power' }];
    case 'ground':
      return [{ id: 'GND', label: 'GND', x: 0, y: -14, type: 'ground' }];
  }
}

export function validateCircuit(circuit: ElectronicCircuit): { valid: boolean; summary: string; issues: string[] } {
  const issues: string[] = [];
  const pinConnectionCounts = new Map<string, number>();
  const key = (componentId: string, pinId: string) => `${componentId}:${pinId}`;

  for (const connection of circuit.connections) {
    const from = circuit.components.find((component) => component.id === connection.from);
    const to = circuit.components.find((component) => component.id === connection.to);
    if (!from || !to) {
      issues.push('Hay un cable conectado a un componente que ya no existe.');
      continue;
    }
    if (!connection.fromPin || !connection.toPin) continue;
    const fromPin = getCircuitPins(from, circuit.boardId).find((pin) => pin.id === connection.fromPin);
    const toPin = getCircuitPins(to, circuit.boardId).find((pin) => pin.id === connection.toPin);
    if (!fromPin || !toPin) {
      issues.push(`El cable entre ${from.label} y ${to.label} usa un pin no disponible.`);
      continue;
    }
    for (const endpoint of [key(from.id, fromPin.id), key(to.id, toPin.id)]) {
      pinConnectionCounts.set(endpoint, (pinConnectionCounts.get(endpoint) ?? 0) + 1);
    }
  }

  for (const component of circuit.components) {
    const pins = getCircuitPins(component, circuit.boardId);
    if (!pins.length || component.kind === 'board' || component.kind === 'esp32') continue;
    const connected = pins.filter((pin) => (pinConnectionCounts.get(key(component.id, pin.id)) ?? 0) > 0);
    if (connected.length === 0) {
      issues.push(`${component.label} no tiene pines conectados.`);
    } else if (['resistor', 'capacitor', 'led', 'button'].includes(component.kind) && connected.length < pins.length) {
      const missing = pins.filter((pin) => (pinConnectionCounts.get(key(component.id, pin.id)) ?? 0) === 0).map((pin) => pin.label).join(', ');
      const kindName = component.kind === 'button' ? 'pulsador' : component.kind === 'led' ? 'LED' : component.kind === 'resistor' ? 'resistencia' : 'condensador';
      issues.push(`Al ${kindName} ${component.label} le faltan conexiones en: ${missing}.`);
    } else if (component.kind === 'mpu6050') {
      const requiredPins = ['VCC', 'GND', 'SDA', 'SCL'];
      const missing = requiredPins.filter((pinId) => !connected.some((pin) => pin.id === pinId));
      if (missing.length) issues.push(`Al MPU6050 ${component.label} le faltan conexiones en: ${missing.join(', ')}.`);
    }
  }

  const uniqueIssues = [...new Set(issues)];
  return {
    valid: uniqueIssues.length === 0,
    summary: uniqueIssues.length === 0
      ? 'No se detectaron errores estructurales de cableado. Esto no sustituye un análisis eléctrico ni una simulación.'
      : 'Se encontraron problemas de conectividad que requieren revisión.',
    issues: uniqueIssues,
  };
}

export function createCircuitComponent(kind: ElectronicCircuit['components'][number]['kind'], index: number) {
  const defaults: Record<ElectronicCircuit['components'][number]['kind'], { label: string; description: string; value?: string }> = {
    board: { label: 'Arduino Uno R3', description: 'Placa de desarrollo.' },
    esp32: { label: 'ESP32 DevKit V1', description: 'Placa ESP32 · pines lógicos documentados.' },
    mpu6050: { label: 'MPU6050 · U1', description: 'Módulo IMU de 6 ejes · interfaz I2C.', value: '0x68' },
    resistor: { label: `R${index} · 220 Ω`, description: 'Resistencia axial.', value: '220 Ω' },
    capacitor: { label: `C${index} · 100 nF`, description: 'Condensador cerámico.', value: '100 nF' },
    led: { label: `D${index} · LED rojo`, description: 'Diodo emisor de luz.', value: 'Rojo' },
    button: { label: `SW${index} · Pulsador`, description: 'Pulsador momentáneo normalmente abierto.' },
    power: { label: 'Alimentación · 3V3', description: 'Terminal de alimentación ideal.' },
    ground: { label: 'GND', description: 'Referencia de tierra.' },
  };
  const defaultsForKind = defaults[kind];
  return {
    id: crypto.randomUUID(),
    kind,
    ...defaultsForKind,
    x: 270 + ((index * 73) % 600),
    y: 130 + ((index * 61) % 340),
    rotation: 0,
  };
}

export function normalizeElectronicCircuit(circuit: ElectronicCircuit, boardId: BoardId): ElectronicCircuit {
  const isLegacyDemo = circuit.components.some((component) => component.id === 'uno-5v')
    && circuit.components.some((component) => component.id === 'uno-gnd')
    && circuit.components.every((component) => component.x === undefined);
  if (isLegacyDemo) return createArduinoPracticeCircuit(boardId);
  return {
    ...circuit,
    boardId,
    components: circuit.components.map((component, index) => ({
      ...component,
      x: component.x ?? 220 + (index % 5) * 165,
      y: component.y ?? 160 + Math.floor(index / 5) * 180,
    })),
  };
}

export function changeCircuitBoard(circuit: ElectronicCircuit, boardId: BoardId): ElectronicCircuit {
  if (circuit.boardId === boardId) return circuit;
  const pinMap: Record<string, string> = boardId === 'esp32-devkit'
    ? { '5V': '5V/VIN', D2: 'GPIO19', D13: 'GPIO18', 'A4/SDA': 'GPIO21/SDA', 'A5/SCL': 'GPIO22/SCL' }
    : { '5V/VIN': '5V', GPIO19: 'D2', GPIO18: 'D13', 'GPIO21/SDA': 'A4/SDA', 'GPIO22/SCL': 'A5/SCL' };
  const boardComponent = circuit.components.find((component) => component.kind === 'board' || component.kind === 'esp32');
  const components = circuit.components.map((component) => component.id !== boardComponent?.id ? component : {
    ...component,
    kind: boardId === 'esp32-devkit' ? 'esp32' as const : 'board' as const,
    label: boardId === 'esp32-devkit' ? 'ESP32 DevKit V1' : 'Arduino Uno R3',
    description: 'Placa de desarrollo · conexiones mostradas como pines lógicos.',
  });
  const boardIdValue = boardComponent?.id;
  return {
    ...circuit,
    boardId,
    components,
    connections: circuit.connections.map((connection) => ({
      ...connection,
      fromPin: connection.from === boardIdValue && connection.fromPin ? pinMap[connection.fromPin] ?? connection.fromPin : connection.fromPin,
      toPin: connection.to === boardIdValue && connection.toPin ? pinMap[connection.toPin] ?? connection.toPin : connection.toPin,
    })),
  };
}

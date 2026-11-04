# Catálogo de componentes

## Esquema inicial

Las definiciones están tipadas en `src/domain/types.ts` y se mantienen en `src/domain/catalog.ts`.

```ts
interface ComponentDefinition {
  id: string;
  name: string;
  manufacturer: string;
  reference: string;
  category: ComponentCategory;
  description: string;
  operatingVoltage: { min: number; max: number } | null;
  interfaces: string[];
  pins: { name: string; type: string }[];
  compatibleBoards: BoardId[];
  implementation: 'visual' | 'configurable' | 'functional' | 'firmware' | 'physics';
}
```

Cada entrada del catálogo descriptivo declara `implementation: 'visual'`. El Electronics Lab tiene un modelo independiente de terminales para Arduino Uno, ESP32 DevKit, MPU6050, resistencias, condensadores, LEDs, pulsadores, alimentación y tierra (`getCircuitPins` en `src/domain/circuit.ts`). Estos pines permiten crear cables persistentes entre terminales. La validación es estructural, no calcula voltajes, corrientes, polaridad efectiva ni seguridad.

## Entradas iniciales

- Placas: Arduino Uno R3, ESP32 DevKit.
- Inercial: MPU6050.
- Ambiental: DHT22.
- Distancia: HC-SR04.
- Actuador: micro servo SG90.
- Pantalla: OLED SSD1306 128x64.

El catálogo general tiene búsqueda por nombre/referencia y filtro por categoría. La biblioteca interactiva actual es pequeña y declarativa dentro de `src/electronics-lab/ElectronicsLab.tsx`; todavía no existe un cargador de plugins.

## Próximos campos

Antes de habilitar análisis eléctrico o simulación, definir validación de esquema, tolerancias eléctricas, hoja de datos versionada, licencia de assets, requisitos de biblioteca, nivel de fidelidad, capacidades por placa y pruebas del modelo. No heredar soporte de simulación desde una mera definición visual.

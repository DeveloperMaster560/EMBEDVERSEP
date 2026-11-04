# Integración de EMBEDVERSE BRIDGE DESIGNER

## Electronics Lab

El espacio de trabajo monta `ElectronicsLab` con `circuit`, `boardId`, `saveState`, `onChange` y `onReset`. El DTO `ElectronicCircuit` se almacena en `EmbeddedProject.electronicLab`; su lista `connections` referencia IDs persistentes de componente y terminal (`from`, `fromPin`, `to`, `toPin`). Los cambios pasan por el guardado automático del proyecto principal. `getCircuitPins` es el contrato interno de pines y `changeCircuitBoard` actualiza el tipo de placa/remapea los pines compatibles.

La integración no proporciona API de ejecución ni resultados de simulación. Firmware compilado, señales, medidas y telemetría no se conectan al circuito aún.

## Modo independiente

Con `npm run dev`, abrir `http://localhost:5174/?bridge-designer=1`. Se aceptan `projectId` y `projectName` como parámetros de URL para recuperar/nombrar la escena. El módulo usa `standalone-bridge-designer` como ID local cuando no se especifica uno.

## Montaje en React

```tsx
import { lazy, Suspense } from 'react';

const BridgeDesigner = lazy(() =>
  import('./bridge-designer/BridgeDesigner').then((module) => ({
    default: module.BridgeDesigner,
  })),
);

<Suspense fallback={<div>Cargando editor 3D…</div>}>
  <BridgeDesigner projectId={project.id} projectName={project.name} />
</Suspense>
```

El workspace actual monta este componente en **Modelos 3D**. El componente no requiere ni modifica `EmbeddedProject`; `projectId` funciona como clave de asociación local. La base `embedverse-bridge-designer` es deliberadamente separada de `embedverse-studio`.

## Contrato de datos

`src/bridge-designer/types.ts` define `BridgeSceneDocument`, `BridgeObject`, `BridgeParameters` y asociaciones de dispositivo. El documento `.evbridge` tiene `schemaVersion: 1`; debe pasar por `parseBridgeScene` antes de importarse. Guardado y recuperación usan `loadBridgeScene(projectId)` / `saveBridgeScene(document)`.

Una asociación IoT conserva `bridgeComponentId`, `deviceId`, `sensorId`, `sensorType`, `status` y transformación del objeto en la escena. `status` comienza como `unconnected`. El contrato no declara conectividad física ni datos de telemetría.

## Integración futura con monitoreo

Se recomienda añadir adaptadores fuera de `BridgeViewport`:

1. Convertir eventos externos a mensajes tipados `{ projectId, deviceId, sensorId, timestamp, values }`.
2. Resolver el mensaje a `BridgeObject.association`; aceptar solo IDs que existan en la escena activa.
3. Mantener el transporte (MQTT/HTTP/Node-RED/InfluxDB) desacoplado de Three.js y de la interfaz.
4. Marcar visualmente datos reales, simulados y ausentes de forma distinta y conservar la marca temporal.
5. No transformar un estado de telemetría en resultado estructural certificado.

El módulo no incluye en esta versión cliente MQTT, acceso a red, análisis estructural ni sincronización cloud.

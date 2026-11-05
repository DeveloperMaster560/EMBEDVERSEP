# EMBEDVERSE Electronics Lab — biblioteca actual

## Modelo

`CircuitComponent` representa un elemento colocado; `CircuitConnection` une dos pares `(componentId, pinId)`. `getCircuitPins` define pinouts disponibles y posiciones gráficas. Componentes, transformaciones y cables se guardan dentro de `EmbeddedProject.electronicLab`.

Las imágenes son dibujos SVG propios aproximados; no son recursos del fabricante ni sustituyen footprints, planos dimensionales o datasheets. La vista esquemática es una proyección básica del mismo circuito lógico.

| Componente | Dibujo de montaje | Pines definidos | Propiedad editable | Validación | Modelo eléctrico / simulación |
|---|---|---|---|---|---|
| Arduino Uno R3 | PCB, MCU, USB, headers | GND, 5V, 3V3, D2, D13, A4/SDA, A5/SCL | Referencia, posición, rotación | Pines válidos | Ninguno |
| ESP32 DevKit V1 | PCB, MCU, USB, headers | GND, 3V3, 5V/VIN, GPIO21/SDA, GPIO22/SCL, GPIO18, GPIO19 | Referencia, posición, rotación | Pines válidos | Ninguno; sin simulación de ESP32 |
| MPU6050 | Módulo PCB y encapsulado | VCC, GND, SDA, SCL, AD0, INT | Referencia, dirección textual | VCC/GND/SDA/SCL requeridos | Ninguno; no responde a transacciones I2C |
| Resistencia axial | Cuerpo y bandas ilustrativas | 1, 2 | Valor nominal textual | Ambos terminales conectados | Ninguno |
| Condensador cerámico | Símbolo/placas | 1, 2 | Valor nominal textual | Ambos terminales conectados | Ninguno |
| LED | Encapsulado/lente o símbolo | A, K | Color textual | Ambos terminales conectados | Sin cálculo de polaridad/corriente |
| Pulsador | Cuerpo o contacto esquemático | 1, 2 | Referencia, posición, rotación | Ambos terminales conectados | Contacto no interactivo |
| Fuente y GND | Símbolos de terminal | VCC o GND | Referencia | Endpoint válido | No son fuentes SPICE |

El panel de propiedades permite cambiar nombre, valor, posición, rotación y orientación visual. La selección de board cambia el pinout del componente de placa y mapea los pines comunes. La validación también avisa cuando un componente importado se conecta directamente a una salida conocida de 3,3 V o 5 V fuera de su rango declarado, y cuando se unen ambas salidas de la placa. Es una comprobación parcial: no infiere el voltaje en redes intermedias ni calcula corriente, polaridad, caída de tensión, potencia o capacidad de suministro.

## Extensión

Para ampliar la biblioteca, añadir un tipo explícito en `CircuitComponent['kind']`, definir sus pines y posiciones en `getCircuitPins`, dibujarlo en `ComponentGraphic` y añadir propiedades/validación específicas con pruebas. No debe inferirse soporte de simulación a partir del dibujo o de la presencia de pines.

## Bibliotecas de componentes importables

El laboratorio admite paquetes declarativos `.evcl` (JSON, esquema v1). En la barra lateral se puede descargar `public/libraries/EMBEDVERSE-Basicos.evcl.json` o importar otro archivo. Los paquetes describen metadatos, compatibilidad declarada, rango de alimentación, pines, posición gráfica, pines requeridos, licencia y enlaces de referencia a bibliotecas Arduino. El paquete se guarda dentro del circuito/proyecto y sus componentes se pueden colocar, mover, cablear y validar en el editor. Los paquetes instalados se pueden exportar; solo se pueden quitar cuando no tienen componentes colocados en el circuito.

El importador limita el archivo a 1 MiB, 500 componentes, 100 pines por componente, IDs únicos y enlaces HTTPS. Los paquetes se tratan como datos; no ejecutan JavaScript ni instalan código. Las dependencias Arduino se muestran como referencias, pero todavía deben instalarse/configurarse por separado en Arduino CLI: el editor no descarga código Arduino ni lo incorpora automáticamente a la compilación.

Una biblioteca Arduino de Arduino IDE contiene código C/C++ usado al compilar firmware. Un modelo de Proteus (por ejemplo, VSM/SPICE y sus símbolos/footprints) no es un formato de componente interoperable que el simulador propio pueda ejecutar. La importación `.evcl` solo habilita representación, pines y validación de conectividad básica; no equivale a simulación eléctrica, SPICE o emulación de Proteus. El navegador conserva paquetes en el proyecto local (IndexedDB), no escribe arbitrariamente en una carpeta del sistema.

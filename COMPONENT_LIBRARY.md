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

El panel de propiedades permite cambiar nombre, valor, posición, rotación y orientación visual. La selección de board cambia el pinout del componente de placa y mapea los pines comunes; no valida compatibilidad eléctrica.

## Extensión

Para ampliar la biblioteca, añadir un tipo explícito en `CircuitComponent['kind']`, definir sus pines y posiciones en `getCircuitPins`, dibujarlo en `ComponentGraphic` y añadir propiedades/validación específicas con pruebas. No debe inferirse soporte de simulación a partir del dibujo o de la presencia de pines.


# Instrumentación SHM del Viaducto de la Novena

El área de ingenierías entregó el diseño preliminar de sensores el 11/11/2026.
La copia literal está en `Planos/Diseno_SHM_Viaducto_Novena/`. Este documento
explica qué partes del diseño están ya en el sistema y cuáles todavía no.

## Qué está construido

| Fase | Dónde | Qué hace |
|---|---|---|
| 1. Diseño como datos | `src/shm/station-design.ts` | Componentes, mapa de pines del MCU, conectores J1–J6, reglas de colocación, adquisición y dimensionado. Cada dato cita su sección del documento. |
| 1. Catálogo | `src/domain/catalog.ts` | ADXL355, SCL3300-D01, ADS1262, STM32H743VIT6 y Pt100, en la categoría «Adquisición y control SHM» o en la que les corresponde. |
| 2. Estaciones en 3D | `bridge_model.build_instrumentation_shm` | Se activa con `instrumentation_layout: "shm-novena-2026-11"`, que la ficha de La Novena ya declara. |
| 3. Alarmas | `src/shm/events.ts` | Las reglas de calidad (E1) se evalúan siempre. E0, E3 y E4 **se niegan a clasificar** mientras no haya umbrales con firma, fecha, documento y línea base. E3 exige persistencia confirmada por ≥2 estaciones; E4 recomienda escalar y no decide cierres. |
| 3. Línea base | `src/shm/baseline.ts` | RMS, pico y p95 por régimen, sin mezclar configuraciones, excluyendo ventanas E1 y con validación sobre un periodo retenido. No hace análisis modal (OMA). |
| 4. Propuesta técnica | `src/shm/engineering-proposal.ts` | Cierra lo que el diseño dejaba abierto: GPIO de interrupciones, SENSOR_SYNC, WDG_KICK, PWR_GOOD, PHY, GNSS, RS-485 y LoRa. **Sin firmar**: la redactó un asistente de IA y la debe revisar un ingeniero. Circuito: `Planos/circuito_estacion_SHM.html`. |
| 3. Contrato de datos | `src/shm/data-contract.ts` | Valida registros de estación: estados cerrados, huecos sin rellenar, hora de recepción separada de la de muestreo y ningún diagnóstico de daño desde el firmware. |

### Estaciones que se generan en La Novena

- **9 SD** (ADXL355 + gabinete STM32H743): en L/4, L/2 y 3L/4 de cada uno de los tres vanos.
- **1 SD-T**: duplicada a media luz del vano principal, en otra viga, para estimar la torsión.
- **4 SS** (Pt100 de 4 hilos): una en cada apoyo (EA, P1, P2, EB). No se colocan inclinómetro, galgas ni desplazamiento, porque el diseño los condiciona a una justificación.
- **SR** (antena GNSS) sobre la acera y **GW** (gateway) junto al estribo inicial, unidos por un backhaul Ethernet.

Resultado comprobado por el endpoint real: 27 elementos de instrumentación,
0 errores de consistencia y 0 colisiones accionables.

## Qué es hipótesis y no viene del diseño

- **La viga instrumentada.** El diseño pide «la de mayor observabilidad del modo vertical»; aquí se usa la exterior.
- **El vano de la SD duplicada.** El diseño pide el «de mayor demanda modal o de interés»; aquí se usa el más largo.
- **Las ubicaciones de SR y GW, y el tamaño de bases y gabinetes.**
- **Todas las posiciones.** Son la regla aplicada a los vanos **publicados**. El diseño exige planos conforme a obra y análisis modal antes de fijarlas.

## Lo que el sistema NO hace

- **No ejecuta el firmware del STM32H743.** El motor solo emula ATmega328P.
- **No hay modelo de registros del ADXL355.** El diseño no pudo verificar la hoja de datos, y el modelo no se escribe sin ella.
- **No hay umbrales de alarma.** El diseño no fija ninguno universal (§11.2). El mecanismo está construido; los valores los debe aprobar un ingeniero estructural a partir de la línea base.
- **Tres reglas de calidad quedan sin evaluar** hasta tener datos del hardware: el rango de temperatura del ADXL355, la tensión mínima de la fuente y el rango configurado del acelerómetro. El sistema informa de cada una como «no evaluada».

## Hallazgos de revisión del diseño

Están en `REVIEW_FINDINGS` y deben confirmarse con la documentación del fabricante.

**Verificación del 11/11/2026, contra la DS12110 Rev 11** (enero de 2026), aportada por el usuario:

- **RV-01 CONFIRMADO.**
  - El LQFP100 no tiene puerto G (figura 5).
  - ETH_RMII_TXD1 solo puede salir por PB13, porque sus alternativas PG12 y PG14 no existen en ese encapsulado (tabla 9). Lo mismo pasa con PB11 (TX_EN) y PB12 (TXD0).
  - En PB13, SPI2_SCK es AF5 y RMII_TXD1 es AF11 (tabla 10).
  - Alternativas verificadas para ACC_SCK: **PB10 (pin 46)** y **PD3 (pin 84)**, ambas en AF5 y sin función RMII.
- **Todos los AF que declara el diseño son correctos:** TIM2_CH1 en AF1, USART1 en AF7, SPI2 en AF5 y SDMMC1 en AF12. El problema no es un AF mal puesto, sino un pin compartido con el Ethernet.
- **RV-02 SIN VERIFICAR.** El manual recibido es la UM2408 (placa MB1363: H745ZI-Q, H755ZI-Q y H7A3ZI-Q), no la UM2407 de la NUCLEO-H743ZI2.

Las pruebas de `src/shm/shm.test.ts` comprueban el choque, los AF y que las alternativas propuestas no pisan RMII ni otra señal. Tras la decisión de ingenierías, el pinout del sistema usa SPI1 en PB3/PB4/PB5; el resto es el del documento.

- **RV-01 (resuelto: bus en SPI1 PB3/PB4/PB5).** El STM32H743**V**IT6 viene en LQFP100, que no tiene puerto G. Con Ethernet RMII, ETH_TXD1 queda obligatoriamente en **PB13**, que es justo el ACC_SCK propuesto. El documento dice haber elegido SPI2 precisamente para evitar ese choque. Se puede mover SPI2_SCK a PB10 o PD3 (verificado). Nota para ingenierías: `Planos/Nota_RV-01_pinout_SHM_Novena.md`.
- **RV-02.** En la NUCLEO-H743ZI2 del bring-up, PB13 es el Ethernet de la placa y PB0 y PB14 llevan LED de usuario.
- **RV-04 (resuelto).** Ingenierías eligió PB3 para ACC_SCK, pero PB3 no tiene SPI2_SCK (DS12110, tabla 10). Funciona solo si el bus pasa a SPI1 en PB3/PB4/PB5 (AF5), con lo que se pierden JTAG y SWO. Ingenierías confirmó SPI1 y la renuncia a JTAG/SWO el 11/11/2026; el pinout del sistema ya lo refleja (`changedFrom` en `MCU_SIGNALS`).
- **RV-03.** Los valores del ejemplo JSON (`range_g: 2`, `time_uncertainty_us: 100`) son de esquema, no configuración.

## Cálculos del documento recalculados

Las pruebas de `src/shm/shm.test.ts` recalculan todos los cálculos del documento y coinciden con él:

- **Almacenamiento:** 414,7 MB/día y 2,9 GB en 7 días.
- **Sincronización:** 1,8° de fase con 100 µs a 50 Hz.
- **Envolvente solar:** 588 Wh, 23 Ah, 470 Wh útiles con 30 Ah (3,9 días), 548 Wh con 35 Ah (4,6 días) y panel de 52,7 W.

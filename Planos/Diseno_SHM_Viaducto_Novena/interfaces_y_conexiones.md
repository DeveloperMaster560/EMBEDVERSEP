# Interfaces, conexiones y contrato de datos de estación

## 1. Convenciones y estado del pinout

Este pinout fija los **conectores de estación y las señales** para revisión de ingeniería. El controlador de referencia es STM32H743VIT6 en PCB propia. Los nombres GPIO propuestos (PAx/PBx/PCx) son multiplexados de referencia, no números de patilla del encapsulado. Antes de fabricar se debe comprobar el multiplexado, encapsulado exacto, límites eléctricos, conflictos de arranque/depuración y restricciones de la revisión vigente de datasheet/reference manual; congelar el número físico de cada patilla en el esquemático. No se asigna un número de patilla física que no haya sido comprobado.

Todos los niveles de señal digital se fijan en 3,3 V solo para los dispositivos que lo admitan. No aplicar 5 V a pines STM32/ADXL355/SCL3300. Las longitudes de SPI y pistas analógicas son internas a la PCB; no usar SPI como bus de campo. Cada conector de sensor debe llevar etiqueta, llave mecánica, número de pin, nombre de señal, tensión y revisión de cable.

## 2. Mapa lógico propuesto del MCU

| Señal del nodo | GPIO de referencia STM32H743VIT6 | Función/mux previsto | Dirección | Notas de verificación |
|---|---|---|---|---|
| ACC_SCK | PB13 | SPI2_SCK, AF5 | Salida | Bus SPI sensores; evita compartir señales con RMII Ethernet |
| ACC_MISO | PB14 | SPI2_MISO, AF5 | Entrada | Bus SPI sensores |
| ACC_MOSI | PB15 | SPI2_MOSI, AF5 | Salida | Bus SPI sensores |
| ACC_CS_N | PA4 | GPIO | Salida | Chip select ADXL355, activo bajo |
| TILT_CS_N | PB0 | GPIO | Salida | Chip select SCL3300-D01, activo bajo |
| ADC_CS_N | PB1 | GPIO | Salida | Chip select ADS1262, activo bajo |
| ADC_DRDY_N | PE2 | GPIO/EXTI | Entrada | Data-ready ADS1262; evitar PC4 si se usa RMII Ethernet |
| GNSS_TX | PA9 | USART1_TX, AF7 | Salida MCU→GNSS | Nivel lógico acorde al módulo |
| GNSS_RX | PA10 | USART1_RX, AF7 | Entrada MCU←GNSS | UART recibe hora/estado; no sustituye PPS |
| GNSS_PPS | PA0 | TIM2_CH1, AF1 o GPIO/EXTI según pin mux validado | Entrada | Capturar flanco PPS con timer; medir latencia y jitter |
| SDMMC_D0 | PC8 | SDMMC1_D0, AF12 | Bidireccional | Tarjeta SD en 1-bit o 4-bit según diseño |
| SDMMC_D1 | PC9 | SDMMC1_D1, AF12 | Bidireccional | Solo modo 4-bit |
| SDMMC_D2 | PC10 | SDMMC1_D2, AF12 | Bidireccional | Solo modo 4-bit |
| SDMMC_D3 | PC11 | SDMMC1_D3, AF12 | Bidireccional | Solo modo 4-bit |
| SDMMC_CK | PC12 | SDMMC1_CK, AF12 | Salida | Impedancia/ruta según especificación SD |
| SDMMC_CMD | PD2 | SDMMC1_CMD, AF12 | Bidireccional | Pull-up según diseño de tarjeta |
| ADC_RESET_N | PE3 | GPIO | Salida | Reset dedicado de ADS1262; evitar PC5 si se usa RMII Ethernet |
| SENSOR_SYNC | GPIO libre sin función de arranque | GPIO/timer | Salida | Asignar tras revisión del pinout; pulso común solo si se instala trigger cableado |
| WDG_KICK | GPIO libre | GPIO | Salida | Asignar tras revisión completa de pinout |
| PWR_GOOD | GPIO libre | GPIO/EXTI | Entrada | Supervisor de alimentación |

El mapa anterior es un **pinout de diseño preliminar**, no una afirmación de que la placa/PCB ya exista. Se propone SPI2 para no chocar con señales RMII Ethernet que pueden ocupar PA7/PC4/PC5; el PHY y el multiplexado completo se deben congelar juntos. Los GPIO marcados “libre” se asignan al congelar el esquemático, evitando pines de boot/depuración. La ruta PPS y el trigger de sincronía no deben compartir una línea sin análisis de aislamiento y estados de arranque.

## 3. Tabla completa de conexiones de referencia

### 3.1 Acelerómetro digital ADXL355

Se instala el IC o carrier homologado sobre PCB de estación, no cableado en protoboard. La interfaz seleccionada es SPI; el carrier debe operar con lógica de 3,3 V y exponer las señales nombradas.

| Origen | Pin | Destino | Pin | Interfaz | Tensión | Dirección | Función | Cable/conector | Protección |
|---|---|---|---|---|---|---|---|---|---|
| STM32 | PB13 / ACC_SCK | Carrier ADXL355 | SCLK | SPI2 | 3,3 V | MCU→sensor | Reloj SPI | Pista PCB corta; J1-2 para módulo | Resistencia serie cerca del MCU si análisis de flanco lo requiere |
| STM32 | PB14 / ACC_MISO | Carrier ADXL355 | MISO/SDO | SPI2 | 3,3 V | Sensor→MCU | Datos | Pista PCB corta; J1-3 | No elevar por encima de VDDIO |
| STM32 | PB15 / ACC_MOSI | Carrier ADXL355 | MOSI/SDI | SPI2 | 3,3 V | MCU→sensor | Comandos/datos | Pista PCB corta; J1-4 | No elevar por encima de VDDIO |
| STM32 | PA4 / ACC_CS_N | Carrier ADXL355 | CS | SPI/GPIO | 3,3 V | MCU→sensor | Selección SPI | Pista PCB corta; J1-5 | Pull-up de estado inactivo según datasheet |
| Rail digital | +3V3_A | Carrier ADXL355 | VDD/VDDIO, según carrier | DC | 3,3 V regulados | Alimentación | Alimentar sensor | Plano/pista; J1-1 | Desacoplo y ruido de fuente según datasheet |
| Retorno | DGND | Carrier ADXL355 | GND | — | 0 V | Retorno | Referencia | Plano local; J1-6 | Unión de tierra según diseño EMC |

J1 conector definido para este diseño: pin 1 `+3V3_A`, pin 2 `ACC_SCK`, pin 3 `ACC_MISO`, pin 4 `ACC_MOSI`, pin 5 `ACC_CS_N`, pin 6 `DGND`, pin 7 `INT1`, pin 8 `INT2`. Si el ADXL355 se monta en la PCB, J1 puede ser pads de prueba y no conector. No usar simultáneamente SPI e I²C; fijar modo según diseño y resistencias/pines del carrier. El pinout físico del IC y sus condensadores no se reproducen aquí: consultar datasheet ADXL355 vigente antes de elaborar footprint.

### 3.2 Inclinómetro Murata SCL3300-D01

| Origen | Pin | Destino | Pin | Interfaz | Tensión | Dirección | Función | Cable/conector | Protección |
|---|---|---|---|---|---|---|---|---|---|
| STM32 | PB13 / ACC_SCK | Carrier SCL3300 | SCK | SPI2 compartido | 3,3 V | MCU→sensor | Reloj | Pista PCB corta; J2-2 | Verificar tiempos SPI de datasheet |
| STM32 | PB14 / ACC_MISO | Carrier SCL3300 | MISO/SDO | SPI2 compartido | 3,3 V | Sensor→MCU | Datos | Pista PCB corta; J2-3 | Bus compartido solo con CS independiente |
| STM32 | PB15 / ACC_MOSI | Carrier SCL3300 | MOSI/SDI | SPI2 compartido | 3,3 V | MCU→sensor | Comandos | Pista PCB corta; J2-4 | Nivel 3,3 V |
| STM32 | PB0 / TILT_CS_N | Carrier SCL3300 | CSB | SPI/GPIO | 3,3 V | MCU→sensor | Selección | Pista PCB corta; J2-5 | Pull-up inactivo |
| Rail | +3V3_S | Carrier SCL3300 | VDD | DC | 3,0–3,6 V según fabricante | Alimentación | Sensor | J2-1 | Fuente limpia; desacoplo |
| Retorno | DGND | Carrier SCL3300 | GND | — | 0 V | Retorno | Referencia | J2-6 | Tierra según diseño |

J2: pin 1 `+3V3_S`, 2 `SCK`, 3 `MISO`, 4 `MOSI`, 5 `TILT_CS_N`, 6 `DGND`, 7 `DRDY/INT` si el modo/carrier lo ofrece, 8 `NC/ID`. No asumir que todas las señales de la placa de evaluación Murata corresponden a los pads de la pieza SMD; usar la documentación del carrier elegido.

### 3.3 Módulo strain con ADS1262

El puente se conecta a módulo analógico dedicado. El pinout de entrada se define como canal de seis hilos para puente completo con sense remoto; galga/puente y excitación exactos se seleccionan por material, resistencia y rango.

| Origen | Pin | Destino | Pin | Interfaz | Tensión | Dirección | Función | Cable/conector | Protección |
|---|---|---|---|---|---|---|---|---|---|
| ADS1262 | AINP configurado | Puente | SIG+ | Diferencial | Dentro del rango de entrada ADC | Sensor→ADC | Salida diferencial positiva | Par trenzado apantallado; J3-3 | Filtro RC simétrico, protección de baja fuga |
| ADS1262 | AINN configurado | Puente | SIG− | Diferencial | Dentro del rango de entrada ADC | Sensor→ADC | Salida diferencial negativa | Par trenzado; J3-4 | Protección simétrica |
| Fuente de excitación | EXC+ | Puente | EXC+ | Excitación DC | Nivel calculado por puente | Fuente→sensor | Excitar puente | Par trenzado; J3-1 | Limitación de corriente/fusible |
| Fuente de excitación | EXC− | Puente | EXC− | Excitación/retorno | Según diseño ratiométrico | Fuente→sensor | Retorno excitación | Par trenzado; J3-2 | Retorno analógico dedicado |
| ADC/reference | SENSE+ | Puente | SENSE+ | Sense remoto | Señal de sense | Sensor→ADC/reference | Medir excitación real | J3-5 | Entrada de alta impedancia |
| ADC/reference | SENSE− | Puente | SENSE− | Sense remoto | Señal de sense | Sensor→ADC/reference | Medir retorno excitación | J3-6 | Entrada de alta impedancia |
| Chasis | SHIELD | Malla cable | Drenaje | Blindaje | No es señal | Un extremo según EMC | EMI | Prensaestopa EMC; J3-7 | Unión de chasis, no a SIG− por defecto |

J3: 1 `EXC+`, 2 `EXC−`, 3 `SIG+`, 4 `SIG−`, 5 `SENSE+`, 6 `SENSE−`, 7 `SHIELD`, 8 `NC/ID`. Excitación y rango deben limitar autocalentamiento. No conectar un puente directamente a MCU ni al ADC sin evaluar tensión común, filtros, entradas de protección y referencia.

### 3.4 PT100 clase A, 4 hilos

| Origen | Pin | Destino | Pin | Interfaz | Tensión/corriente | Dirección | Función | Cable/conector | Protección |
|---|---|---|---|---|---|---|---|---|---|
| Excitación RTD/ADS1262 | I+ | Pt100 | R1 | Medida 4 hilos | Corriente baja definida en cálculo térmico | Fuente→RTD | Corriente de excitación | Par trenzado apantallado; J4-1 | Limitar corriente; protección de entrada |
| Sense ADC | S+ | Pt100 | R2 | Sense | mV diferencial | RTD→ADC | Sense extremo 1 | J4-2 | Filtro simétrico |
| Sense ADC | S− | Pt100 | R3 | Sense | mV diferencial | RTD→ADC | Sense extremo 2 | J4-3 | Filtro simétrico |
| Retorno de medida | I− | Pt100 | R4 | Retorno corriente | Según excitación | RTD→retorno | Retorno de excitación | J4-4 | Retorno analógico dedicado |
| Chasis | Shield | Malla cable | Drenaje | Blindaje | — | — | EMI | J4-5 | Terminar según esquema EMC |

J4 pin 1 `I+`, pin 2 `S+`, pin 3 `S−`, pin 4 `I−`, pin 5 `SHIELD`. Los cuatro conductores llegan al sensor; consultar la convención del fabricante y medir continuidad antes de energizar.

### 3.5 Transductor de desplazamiento industrial 4–20 mA (opción)

Para transmisor de dos hilos, el lazo se alimenta por 24 V; receptor aislado industrial entrega señal acondicionada al ADC. Si el diseño utiliza resistencia de precisión de shunt, sus valores, potencia, tolerancia y rango se calculan y verifican contra compliance y modo común del ADC. No se cablea la salida del sensor directamente a un pin del MCU.

| Origen | Pin | Destino | Pin | Interfaz | Tensión | Dirección | Función | Cable/conector | Protección |
|---|---|---|---|---|---|---|---|---|---|
| Fuente protegida | +24V_LOOP | Transductor | LOOP+ | Lazo 4–20 mA | 24 VDC nominal | Fuente→sensor | Alimentación lazo | Par trenzado apantallado; J5-1 | Fusible por lazo |
| Transductor | LOOP− | Receptor aislado | IN+ | 4–20 mA | Caída según receptor | Sensor→receptor | Señal | J5-2 | Aislamiento y protección transientes |
| Receptor | OUT+/OUT− | ADS1262 | AIN diferencial | Analógica | Rango de receptor | Receptor→ADC | Valor escalado | En PCB | Filtro de entrada |
| Chasis | Shield | Malla | Drenaje | Blindaje | — | — | EMI | J5-3 | Unión en entrada de gabinete |
| Retorno | Loop return | J5-4 | Retorno | Lazo | 24 VDC | Retorno | Cierre de lazo | Cable | Separado de señales diferenciales |

J5: 1 `+24V_LOOP`, 2 `LOOP_RETURN`, 3 `SHIELD`, 4 `NC`. Confirmar polaridad en manual del transductor y continuidad del lazo antes de conectar el ADC.

### 3.6 Entrada de alimentación y conectividad

| Conector | Pin | Señal | Especificación de sistema | Protección |
|---|---:|---|---|---|
| J6 | 1 | VIN+ | 12/24 VDC nominal según diseño de fuente; seleccionar un único rango en PCB final | Fusible, inversión, TVS, filtro EMI |
| J6 | 2 | VIN−/RTN | Retorno DC | Protección y monitoreo |
| J6 | 3 | PE/CHASSIS | Chasis/puesta a tierra según diseño | Unión equipotencial; no usar como retorno analógico |
| J6 | 4 | PWR_GOOD | Estado opcional de fuente | Aislar/limitar hacia GPIO |
| J7 | 1–8 | GNSS | UART TX/RX, PPS, alimentación y retorno según receptor seleccionado | Antena GNSS externa; coaxial y descargador según montaje |
| J8 | RJ45 | Ethernet | 10/100BASE-T por MAC RMII del STM32H743 y PHY externo seleccionado | Magnetics, aislamiento, protección surge |
| J9 | A/B/GND | RS-485 | Par diferencial, bus, 120 Ω en extremos | Aislador, TVS de bus, común de referencia controlado |
| J10 | RF | LTE/LoRa | Coaxial y antena según banda/ganancia aprobadas | Descargador RF y tierra/latiguillo adecuado |

## 4. Topologías, terminación y aislamiento

- **SPI:** un master, bus local en PCB, cada dispositivo con CS separado. La velocidad se decide al leer hojas de datos; iniciar baja, verificar forma de onda y aumentar solo tras prueba de integridad.
- **I²C:** no se propone como bus de sensor remoto; solo en PCB para periféricos cortos. Verificar pull-ups y capacitancia total.
- **RS-485:** bus lineal con derivaciones cortas, par trenzado de 120 Ω; una terminación en cada extremo físico y polarización en un solo punto. Aislar si nodos tienen diferencias de potencial/recorridos al exterior.
- **Ethernet:** usar transformador/magnetics según PHY; no pasar conductores PoE salvo que el diseño esté hecho para ello.
- **GNSS PPS:** cable coaxial o diferencial conforme a receptor, con longitud documentada; PPS entra a captura hardware; NMEA/UART no sustituye PPS.
- **Galgas/RTD:** entradas diferenciales locales; separar de convertidores y transmisores RF. Blindaje terminado al chasis en punto definido.
- **Alimentación:** dominios de radio, lógica y señal analógica filtrados; retornos unidos en punto y forma definidos por análisis EMC, no por conveniencia en campo.

## 5. Diagrama eléctrico funcional

```text
  12/24 VDC
      |
 [Fusible + inversión + TVS + filtro]
      +--------------------+--------------------+
      |                    |                    |
 [DC/DC 5 V]         [DC/DC 3V3 digital]  [DC/DC analógico]
      |                    |                    |
  GNSS/Modem         STM32H743              ADS1262/excitación
                           | SPI2                 |
             +-------------+-----------+         +-- J3 puente galgas
             |             |           |         +-- J4 Pt100 4 hilos
          ADXL355       SCL3300     ADS1262       +-- J5 receptor aislado
             |
          SDMMC -> microSD/eMMC
             |
          Ethernet/LTE -> archivos y telemetría
          LoRaWAN -> resumen/estado solamente
```

## 6. Formato de datos para integración

La estación debe poder exportar archivos crudos en un formato con versión documentada. Formato JSON Lines de ejemplo para metadatos/estadísticas (no necesariamente cada muestra):

```json
{
  "schema_version": "1.0",
  "station_id": "SD-spanXX-midspan",
  "sensor_id": "ADXL355-serial",
  "timestamp_utc": "RFC3339",
  "time_quality": "GNSS_LOCKED",
  "time_uncertainty_us": 100,
  "sample_rate_hz": 200,
  "axes": ["longitudinal", "transversal", "vertical"],
  "units": "m/s2",
  "range_g": 2,
  "filter_id": "configured-filter-revision",
  "firmware_version": "semantic-version",
  "calibration_id": "certificate-or-verification-id",
  "samples_file": "relative/path/to/block",
  "samples_crc32": "hex",
  "health": {
    "sensor_ok": true,
    "storage_ok": true,
    "pps_locked": true,
    "supply_v": 24.0
  }
}
```

Los valores de ejemplo son de esquema, no telemetría real. Archivos crudos deben almacenar códigos ADC o valores escalados con escala, endianess, saturación, filtro, ODR, orientación, timestamp inicial y contador de muestras. No reemplazar huecos por cero; etiquetarlos como faltantes.

## 7. Campos mínimos y estados entregados al software

`station_id`, `sensor_id`, número de serie, coordenadas relativas del puente, orientación, ejes, variable/unidad, timestamp UTC, calidad/error temporal, tasa real, rango, estado de filtro, versión de firmware/configuración, calibración, secuencia de muestra, flags de saturación, salud de alimentación/sensor/storage, checksum y estado de comunicación.

Estados: `NORMAL`, `DATA_GAP`, `SENSOR_FAULT`, `SATURATED`, `TIME_HOLDOVER`, `TIME_INVALID`, `STORAGE_FAULT`, `POWER_LOW`, `COMM_LOST`, `EVENT_CAPTURE`. La plataforma deberá distinguir estados de sensor y eventos estructurales potenciales; el firmware no etiquetará un pico como “daño” o “puente inseguro”.

## 8. Requisitos de almacenamiento y transporte

- Crudo: mínimo tres ejes sincronizados, metadatos de configuración y checksum por bloque; escribir localmente aun si no hay conectividad.
- Resumen: por ventana configurable, media/RMS/pico/percentiles por eje, PSD o frecuencias estimadas con versión del algoritmo, límites de validez y bandera de calidad.
- Transferencia: descarga/replicación de archivos crudos por Ethernet/LTE o extracción local. LoRaWAN solo para estados, alarmas compactas y estadísticas.
- Retransmisión no debe cambiar la marca de tiempo original; la hora de recepción se conserva como campo distinto.

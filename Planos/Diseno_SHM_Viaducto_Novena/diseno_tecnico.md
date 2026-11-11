# Diseño técnico preliminar de instrumentación SHM

**Caso:** Viaducto de La Novena, Bucaramanga, Santander  
**Disciplina:** instrumentación civil/estructural, electrónica, eléctrica y mecatrónica  
**Estado:** arquitectura de referencia para ingeniería de detalle; no es plano IFC ni autorización de intervención  
**Fecha de elaboración:** 11 de noviembre de 2026

## 1. Resumen y límites

Se propone una red de adquisición sincronizada, con acelerómetros triaxiales de bajo ruido en el tablero, inclinómetros en puntos estáticos seleccionados, medición de temperatura y canales de deformación/desplazamiento solo donde el modelo estructural y el objetivo de mantenimiento los justifiquen. Cada estación dinámica registra señal cruda localmente; Ethernet o LTE se reservan para transferencia de archivos y administración; LoRaWAN, si se autoriza y hay cobertura, transporta únicamente estado y características resumidas. El sistema es de observación y apoyo a inspección, no de certificación automática de seguridad ni diagnóstico autónomo de daño.

No se han proporcionado planos, memorias, inventario de apoyos, geometría, materiales, restricciones de acceso, disponibilidad eléctrica ni estudio modal del viaducto. La carpeta existente aporta un prototipo de dos ESP32/MPU6050 y registros de telemetría, pero no esos datos de diseño. Por tanto, las posiciones y cantidades siguientes son paramétricas y las potencias son un presupuesto provisional, no resultados del puente. No se asigna al viaducto una longitud, número de luces, sistema estructural ni material.

## 2. Base de diseño y evidencia

### 2.1 Información del proyecto inspeccionada

- `Capitulo_4_Desarrollo_Trabajo_Grado.md` describe dos nodos ESP32/MPU6050, denominados Punta A y Punta B; MQTT hacia EMQX, procesamiento con Node-RED y almacenamiento en InfluxDB, con despliegue reportado en AWS EC2. El capítulo advierte que no es un instrumento certificado y que los datos disponibles son resúmenes.
- `nuevoCodigoProyect/nuevoCodigoProyect.ino` contiene una versión distinta: lectura aproximada cada 10 ms, reporte de 1 s, MPU6050 con filtro configurado a 21 Hz y magnitud dinámica respecto a línea base. Esta frecuencia de ejecución no verifica el ODR efectivo ni la frecuencia real de adquisición.
- `ESP32_A/ESP32_A.ino` y `ESP32_B/ESP32_B.ino` reflejan un firmware de menor tasa de muestreo/reporte; se observó que el archivo A tenía identificador/tópicos de B. El contrato de datos y la implementación no son uniformes entre archivos.
- Los flujos `nodered.json` y `flujo_monitoreo_puente.json` documentan el acoplamiento MQTT con la plataforma existente. Se respetan como interfaz heredada, pero quedan fuera del diseño físico y no se exige su uso en la solución SHM propuesta.
- `INFORME_ANALISIS_DATOS_REAL_2026-10-28.md` y el borrador de grado describen problemas de cobertura, latencia y consistencia de estados. Son hallazgos del prototipo y no parámetros universales de diseño.

**Consecuencia técnica:** el MPU6050/ESP32 sirve para demostrar conectividad y adquisición básica, no como solución seleccionada para identificación modal cuantitativa sin evaluación metrológica, sincronización entre nodos, caracterización de ruido y trazabilidad del montaje. Los umbrales de firmware existentes (0,5/1,0/2,5 m/s²) no se trasladan al sistema SHM.

### 2.2 Datos del Viaducto de La Novena

| Categoría | Estado en esta entrega | Acción |
|---|---|---|
| Identidad del caso | Confirmada por el encargo: Viaducto de La Novena, Bucaramanga | Confirmar identificación y límites del activo con el propietario |
| Longitud, luces, apoyos y geometría | No confirmados con planos verificables en el material inspeccionado | Solicitar planos conforme a obra y hacer levantamiento |
| Materiales y detalles de vigas/tablero | No confirmados | Revisar planos, inspección y ensayos si hay discrepancias |
| Condición de juntas, apoyos, pilas y cimentación | No evaluada en esta tarea | Inspección visual especializada y registro de condición |
| Modos, frecuencias, amortiguamiento | No disponibles | Modelo estructural y campaña de vibración ambiental/modal |
| Energía, cobertura celular y acceso | No disponibles | Estudio en sitio; medir RSSI/SINR y disponibilidad |
| Ambiente, temperatura de tablero y exposición | No caracterizados | Registro estacional; definir protección y rango térmico |

No se pudo corroborar durante esta investigación en una fuente pública oficial accesible una geometría detallada o planos del viaducto. Se evita repetir cifras de fuentes secundarias como si fueran datos de diseño. La documentación pública que se obtenga posteriormente deberá archivarse con emisor, fecha, revisión y enlace.

## 3. Variables objetivo y estrategias de observación

| Fenómeno | Medición directa propuesta | Estimación/procesamiento | Lo que no se debe inferir directamente |
|---|---|---|---|
| Vibración del tablero | Aceleración triaxial en m/s² con marca temporal | PSD, RMS por banda, picos, frecuencia modal y formas modales mediante análisis modal operacional (OMA) | Daño estructural a partir de un pico aislado |
| Inclinación lenta | Ángulo biaxial/triaxial en estaciones seleccionadas | Deriva, inclinación estática/ cuasiestática compensada térmicamente | Desplazamiento absoluto sin referencia geométrica |
| Deformación | Microdeformación con galga y puente completo/medio puente compensado | Deformación unitaria; esfuerzo solo con propiedades y estado de esfuerzo validados | Capacidad residual o fisura solo por una lectura |
| Desplazamiento relativo | Carrera de LVDT/transductor lineal entre dos puntos de referencia | Apertura de junta y recorrido térmico | Desplazamiento global si el marco de referencia también se mueve |
| Temperatura | RTD de contacto en elemento y sensor de aire protegido | Gradiente térmico y covariación con respuesta | Temperatura interna de toda la sección con un único sensor superficial |
| Tránsito | Conteo/clasificación con sensor de terceros o cámara aprobada | Correlación de respuesta con carga/velocidad | Peso por vehículo sin sistema calibrado de pesaje dinámico |
| Viento/lluvia/nivel de agua | Estación ambiental local o datos oficiales cercanos | Correlación de condiciones ambientales y respuesta | Exposición real local a partir de una estación distante |
| Socavación | Sensor/procedimiento geotécnico específico en pilas expuestas | Tendencia del lecho y alertas de inspección | Estado de cimentación por acelerometría del tablero |

### 3.1 Resolución de frecuencia y muestreo

La banda de interés se fijará después del modelo modal y de una campaña piloto. Como base de diseño, iniciar con una banda de análisis de 0,1–40 Hz para vibración ambiental del tablero y muestreo simultáneo de 200 muestras/s por eje. Esto cubre hasta 40 Hz con margen de Nyquist y deja margen para filtro antialias; el límite no se presume como banda modal real del viaducto. El sensor ADXL355 puede configurarse a ODR mayor y filtro interno; seleccionar ODR 500 Hz o superior y filtrar/decimar a 200 Hz solo después de comprobar respuesta, fase y atenuación. Alternativamente registrar a 500 Hz y conservar los datos crudos de la campaña piloto.

Para un evento de tránsito o sismo que requiera contenido por encima de 40 Hz, aumentar ODR y ancho de banda con base en el estudio; aplicar filtro analógico/antialias apropiado y no solo un filtro digital posterior. El acelerómetro digital ya integra conversión A/D interna y no requiere ADC externo; su reloj interno no sincroniza por sí solo estaciones distintas.

## 4. Arquitectura física del sistema

### 4.1 Estaciones propuestas

1. **SD — estación dinámica de tablero:** ADXL355 triaxial firmemente acoplado a viga principal o diafragma, adquisición simultánea, controlador STM32H743, almacenamiento local industrial y GNSS-PPS/RTC. Módulos de expansión para temperatura o inclinómetro según ubicación.
2. **SS — estación cuasiestática:** inclinómetro digital, PT100 de contacto y entradas de deformación/desplazamiento si se requieren en el punto. Adquisición lenta (1–10 Hz para tilt/strain/temp, ajustable) y acceso a los mismos metadatos de tiempo.
3. **SR — referencia ambiental/tiempo:** antena GNSS en zona con cielo despejado y sensor de aire/viento donde sea accesible. Puede compartir gabinete con nodo de adquisición si el PPS se lleva por coaxial de longitud y retardo conocidos.
4. **GW — gateway/backhaul:** concentrador LoRaWAN únicamente para telemetría pequeña y, de ser posible, enlace Ethernet/LTE para archivos crudos. Debe estar fuera de zonas de sombra RF y con antena adecuada.

No se instala sensor de corrosión, socavación, pesaje, GNSS de desplazamiento ni sensores en cables/tirantes hasta confirmar que esos elementos existen y que responden al objetivo de gestión.

### 4.2 Distribución paramétrica por luz

En cada luz estructural identificada en planos, proponer inicialmente estaciones dinámicas en L/4, L/2 y 3L/4 sobre la viga longitudinal que, según modelo/inspección, tenga mayor observabilidad del modo vertical. En la luz de mayor demanda modal o de interés, duplicar estación en otra viga principal a media luz para estimar torsión. La selección final se optimiza por formas modales, correlación espacial, acceso y cableado; tres puntos no garantizan observabilidad de todos los modos.

En apoyos y extremos: medir temperatura de tablero/junta; considerar sensor de desplazamiento relativo de junta si su movimiento es un indicador de mantenimiento; inclinómetro en pila o elemento de apoyo solo si el objetivo incluye rotación lenta y se dispone de referencia estable. En pilas se prioriza inspección y sensor específico de inclinación/desplazamiento cuando el análisis lo justifique. La instrumentación de cimentación/socavación requiere estudio geotécnico e hidráulico independiente.

**Cantidad de nodos:** no definitiva. Mínimo de campaña piloto: tres puntos dinámicos en una luz representativa más un punto duplicado transversal en la luz de interés, es decir, cuatro ubicaciones dinámicas, sujetas a acceso y revisión del modelo. Red permanente: `3 × número de luces seleccionadas + duplicados transversales + estaciones estáticas justificadas`, no un conteo fijo antes de conocer la estructura.

### 4.3 Esquema de ubicación (no a escala)

```text
Eje longitudinal; repetir el patrón en cada luz L_i confirmada

 Estribo       Apoyo/Pila              Apoyo/Pila        Estribo
   |---------------|---------------------|----------------|
       SD-i-1          SD-i-2              SD-i-3
       x=L_i/4         x=L_i/2             x=3L_i/4
                     SD-i-2T (opcional, viga paralela para torsión)

 En cada apoyo/junta: SS-i (temperatura y/o desplazamiento relativo,
 solo donde la hipótesis estructural y el acceso lo justifiquen).
 SR: referencia GNSS/ambiental en zona despejada; GW: backhaul en ubicación
 con cobertura comprobada. Cada ubicación debe asociarse a plano conforme a obra.
```

Los ejes de cada sensor se documentan respecto de un marco común: X longitudinal, Y transversal y Z vertical. La orientación final del paquete ADXL355 se registra en placa/estación y se verifica con gravedad y una prueba de excitación controlada. Si el montaje exige girar el sensor, registrar matriz de rotación aplicada; no renombrar ejes sin conservar datos originales.

## 5. Componentes y selección

Los modelos con estado **seleccionado preliminar** son referencias de ingeniería para el prototipo avanzado. Compra e instalación requieren revisar la revisión vigente de hoja de datos, disponibilidad, temperatura, encapsulado, ensayos de recepción y calibración.

| Variable | Componente/candidato | Estado | Rango/función y razones | Limitaciones/alternativa |
|---|---|---|---|---|
| Aceleración | Analog Devices ADXL355, IC ADXL355BCCZ (confirmar sufijo/paquete y condición de compra en fabricante) | Seleccionado preliminar | MEMS triaxial digital de bajo ruido; rangos seleccionables ±2/±4/±8 g; SPI/I²C; adecuado para vibración ambiental, registro simultáneo y montaje compacto. El fabricante publica ruido típico del orden de decenas de µg/√Hz; usar valores de la revisión de datasheet vigente en cálculo de ruido. | No es acelerómetro sísmico/metrológico certificado por defecto; sensor digital con filtro/retardo de grupo que debe incluirse en la fase; para alto rango o calibración trazable evaluar acelerómetro IEPE/force-balance (modelo y acondicionador se seleccionan tras campaña y presupuesto). |
| Inclinación | Murata SCL3300-D01 | Candidato seleccionado para piloto | Inclinómetro MEMS de 3 ejes con SPI, 3,0–3,6 V, -40 a +125 °C; fabricante indica ruido hasta 0,001°/√Hz y modos de rango/ respuesta distintos. Útil para rotación lenta, no reemplaza acelerómetro para vibración modal. | Verificar rango, modo, error térmico, calibración e integración mecánica con hoja completa. Usar SCL3300-D01-PCB solo para evaluación; producto final requiere PCB/carrier robusto. |
| Deformación | Galga foil adherible, puente completo preferido, complementada con TI ADS1262 | Candidato de adquisición; galga por definir | ADS1262 ofrece ADC delta-sigma de 32 bit, 38 kSPS máx., entradas diferenciales, PGA, SPI, sensores de temperatura y referencia interna; dispone de fuentes de corriente que pueden ayudar en RTD. Usar excitación de puente estable, medida ratiométrica y acondicionamiento diseñado. | 32 bits nominales no significan 32 bits efectivos. Deben dimensionarse excitación, filtro, rango, deriva, aislamiento, cableado y autocalentamiento. Galga, adhesivo y compensación térmica dependen del material y ambiente. Alternativa: acondicionador industrial de puente con certificado/calibración. |
| Desplazamiento/junta | LVDT o transductor lineal industrial de salida diferencial/4–20 mA | Candidato; modelo no seleccionado | Medición directa de carrera entre puntos estructurales independientes; seleccionar carrera a partir de movimiento térmico y recorrido admisible, resolución y protección. | No se fija P/N ni rango sin carrera real, montaje y punto fijo. Longitudinal de junta puede requerir ±25–100 mm como envolvente de selección, no especificación del viaducto. |
| Temperatura de elemento | Pt100 IEC 60751 clase A, 4 hilos, sonda de contacto industrial | Seleccionado como clase, no P/N | Compensación térmica; cuatro conductores eliminan gran parte del error de resistencia de línea. Asegurar contacto térmico, aislamiento eléctrico y protección UV/humedad del cable. | La tolerancia depende de temperatura; usar relación IEC 60751 y hoja del fabricante. Una sonda en superficie no da temperatura de núcleo/gradiente completo. Para distancias largas: transmisor 4–20 mA calibrable o acondicionador local. |
| Temperatura de aire | Sonda Pt100/Pt1000 en abrigo ventilado, sin radiación directa | Candidato | Contextualiza respuesta térmica; montar separada del calor de gabinete/tablero. | Un punto no representa microclima de toda la estructura. |
| Controlador | STM32H743VIT6 (ST) en PCB industrial propia; NUCLEO-H743ZI2 únicamente para bring-up en laboratorio | Seleccionado preliminar | MCU Cortex-M7 de alto rendimiento; interfaces SPI, SDMMC, UART, temporizadores y watchdog permiten adquisición, buffer y almacenamiento local. | No es un SBC certificado ni sustituye aisladores, ADC o protección. La elección final depende de carga, stack y soporte largo plazo. |
| ADC de precisión | TI ADS1262 | Candidato seleccionado para módulo strain/RTD | ADC externo SPI de precisión; diez entradas, PGA y hasta 38 kSPS publicados. | No conectarlo a puente sin excitación/filtrado/referencia diseñados; evaluar ruido efectivo a la tasa baja objetivo. |
| Tiempo | Receptor GNSS multiconstelación con PPS y salida UART, modelo a seleccionar por disponibilidad | Requisito funcional | PPS disciplina el reloj del nodo; UART entrega hora y estado GNSS. Antena fuera de gabinete/obstrucción. | Bajo tablero puede no recibir satélites; llevar antena a zona abierta y verificar fijación/retardo. RTC con TCXO mantiene hora durante pérdida, no precisión de fase sin re-sincronización. |
| Almacenamiento | microSD industrial de alta resistencia/endurance o eMMC industrial, especificación por temperatura y ciclo de escritura | Requisito seleccionado | Señal cruda local, buffer ante caída de backhaul y registro circular. | microSD removible requiere control de corrupción, journaling, CRC, rotación y protección contra manipulación; valorar eMMC soldada. |
| Estación ambiental | Anemómetro/viento y pluviómetro de salida industrial | Opcional | Solo si correlación de viento/lluvia es objetivo y hay emplazamiento representativo. | No se dimensiona sin estudio de exposición; proteger mástil y cumplir seguridad eléctrica. |
| IEPE | Acelerómetro piezoeléctrico IEPE de bajo ruido | Alternativa de alta confianza | Adecuado si el MEMS no satisface ruido/rango o se requiere referencia de calibración. | Requiere acondicionador de corriente constante, cable coaxial, calibración y consumo adicional; seleccionar modelo tras especificación. |

#### Comparación de acelerómetros

| Criterio | ADXL355 digital MEMS | IEPE piezoeléctrico industrial |
|---|---|---|
| Mejor aplicación | Nodos distribuidos de vibración ambiental y tendencias de baja frecuencia | Ensayos de vibración/dinámica, alto rango o canal de referencia de mayor robustez |
| Conversión | Digital dentro del sensor; SPI/I²C | Salida analógica de carga/voltaje con alimentación IEPE y ADC externo |
| Banda/ruido | Consultar ruido, ODR, filtro y retardo en revisión de hoja de datos del componente; datos exactos deben validarse antes de congelar el filtro | Depende de modelo, sensibilidad y acondicionador; seleccionar con certificado, ruido y banda requeridos |
| Medición estática | Puede observar aceleración gravitacional y cambios lentos, pero inclinación/deriva requieren caracterización | Piezoeléctrico no mide DC; no reemplaza inclinómetro |
| Implementación | Menor consumo/cableado y facilita arrays; sensible al montaje y configuración de reloj/filtro | Mayor consumo, coaxial, acondicionador y ADC; buena alternativa para validación independiente |
| Decisión | Base preliminar del nodo permanente sujeto a prueba con referencia | Mantener como alternativa piloto o usar como referencia si el presupuesto y acceso lo permiten |

### 5.1 Pinout eléctrico del sensor/CI versus módulo

ADXL355 y SCL3300 son circuitos integrados SMD; no son dispositivos de campo con bornera. La placa de estación debe exponer conectores de sensor con nombres de señal documentados y no cablear al aire el paquete del IC. El pinout de paquete, condensadores, alimentación y requisitos de arranque se incorporarán desde la revisión vigente del datasheet y el footprint oficial durante el esquemático. La tabla de señales de sistema está en `interfaces_y_conexiones.md`.

## 6. Nodo de adquisición y electrónica

### 6.1 Bloques funcionales por estación dinámica

1. Entrada protegida 12/24 VDC nominal.
2. Protección contra polaridad inversa, fusible reemplazable, TVS escogido para el nivel de aislamiento y protección por transientes.
3. Convertidores DC/DC separados: dominio digital 5 V/3,3 V; dominio analógico/puente de bajo ruido si existe; filtrado de radiofrecuencia.
4. STM32H743VIT6, oscilador principal adecuado, watchdog externo o independiente y monitor de alimentación.
5. ADXL355 sobre PCB rígida de bajo ruido montada en contacto mecánico al elemento; no sobre placa madre con reguladores, relés o conectores flexibles.
6. ADS1262 + excitación/medida ratiométrica para galgas y entrada RTD cuando haya canal de strain.
7. Interfaz GNSS: UART + PPS; RTC de respaldo con batería/capacitor de vida útil documentada.
8. MicroSD industrial/eMMC, buffer de escritura, recuperación ante pérdida de energía y checksum por bloque.
9. Puerto de servicio aislado; comunicación Ethernet/RS-485/LTE/LoRa mediante módulos aprobados y separados de adquisición.
10. Conectores con alivio de tensión, barrera a humedad y blindajes terminados según plan de tierra.

### 6.2 Dominios de señal

- **Digital de baja tensión:** SPI/UART/SDIO en la PCB, longitud corta, 3,3 V solo donde lo admita cada dispositivo. Confirmar límites absolutos y secuencia.
- **Puentes/strain:** cable de 4 o 6 conductores más malla hasta el acondicionador cercano; pares trenzados separados para excitación y señal, medición diferencial, excitación estable, limitación de corriente y protección ESD/transientes. No llevar salida bruta de puente largas distancias sin evaluación de EMI.
- **RTD:** 4 hilos para Pt100 pasiva; sensor de corriente de excitación/medición dedicado. Si el tramo es largo/expuesto, transmisor industrial local 4–20 mA aislado.
- **LVDT:** excitación y demodulación en acondicionador compatible, o transmisor con salida estándar; no conectar la bobina directamente a ADC/MCU.
- **4–20 mA:** resistencia de precisión y protección/aislamiento de lazo calculados para tensión de compliance, o receptor industrial; nunca asumir entrada de 3,3 V directa.
- **IEPE:** fuente de corriente constante y acoplamiento/ADC dedicado. No conectar al pin ADC/MCU.

## 7. Ensamble mecánico y protección

### 7.1 Montaje del acelerómetro

- Elegir la viga/diafragma mediante inspección y formas modales previstas. Evitar chapa delgada local, tapas, elementos con resonancia propia y superficies corroídas no preparadas.
- Mantener la cara de montaje plana, rígida y limpiada; preferir montaje atornillado a una pequeña base metálica rígida y de baja masa, con rosca/tornillo compatible con el carrier del sensor. Adhesivo estructural solo si no se puede perforar y con calificación térmica/creep; documentar procedimiento y espesor.
- No perforar, soldar ni remover recubrimientos del elemento principal sin aprobación de diseño y método de reparación. En concreto, usar anclaje adhesivo o mecánico solo tras localizar armaduras, justificar profundidad y sellar; nunca perforar tendones/armaduras. Para acero, usar abrazadera/soporte aprobado o accesorio existente; evitar soldadura de campo en elementos cargados.
- El gabinete se fija aparte, en soporte que no transmita vibración al acelerómetro. Cable sensor protegido, con bucle de servicio pequeño, alivio de tracción y ruta que no cargue el sensor.
- Registrar posición XYZ, elemento, orientación, tipo/torque de fijación, fotos, temperatura, número de serie, firmware/calibración, operador y fecha.

### 7.2 Gabinete, cableado y conectores

- Gabinete UV-resistente de policarbonato estabilizado o aluminio marino/anodizado con junta reemplazable; IP66/67 solo como requisito de compra a ensayar/verificar, no como cumplimiento asumido. Preferir respiradero de membrana para reducir condensación; bolsa desecante solo como mantenimiento complementario.
- Dimensionar volumen para curva de disipación solar y temperatura interna; separar placa analógica de radio/DC/DC por partición y distancia.
- Prensaestopas EMC/IP con retención y compatibilidad de diámetro. Para sensores digitales internos: cable corto apantallado/conectores con traba. Para campo: M12 A-coded de 4/5 pines solo para señales de baja tensión definidas o conectores circulares industriales equivalentes; no transportar potencia y señales sensibles en el mismo pinout sin análisis.
- Ethernet: Cat 6A apantallado si el tendido y el transceptor lo permiten, con supresor de sobretensión y aislamiento Ethernet. RS-485: par trenzado apantallado 120 Ω, topología bus, terminación solo en extremos.
- Antenas LTE/LoRa/GNSS externas con coaxial de baja pérdida, conectores SMA/TNC de panel, alivio mecánico y descargador/coaxial apropiado según sistema de tierra y protección contra rayos.
- Malla de sensor termina al chasis en punto definido; no crear lazo de tierra entre analógico/digital y estructura. La estrategia de tierra se define en esquemático, prueba EMC y coordinación de protección.

## 8. Alimentación y dimensionamiento preliminar

### 8.1 Arquitectura

Alimentación primaria de 24 VDC aislada/protegida cuando exista red; DC/DC industriales para 5 V y 3,3 V. Instalar fusible por ramal, protección de inversión, TVS, filtro EMI, medición de entrada/salidas y brownout log. Definir unión a tierra/chasis según estudio eléctrico y equipotencialidad del sitio. La protección contra rayos y sobretensiones debe coordinarse con el sistema de protección del puente; la TVS de PCB no sustituye descargadores de acometida ni evaluación de riesgo.

### 8.2 Ejemplo solar paramétrico (no medición del viaducto)

Supuesto para nodo con MCU, ADXL355, almacenamiento, GNSS intermitente y telemetría/backhaul no continuo: **potencia media presupuestada 5 W**, que debe medirse con prototipo. Por tanto:

- Energía diaria `E_d = 5 W × 24 h = 120 Wh/día`.
- Autonomía objetivo de cálculo: 3 días; eficiencia total de conversión/cableado 0,85; fracción de descarga útil 0,80; factor conservador de temperatura/envejecimiento 0,90.
- Energía nominal mínima `E_bat = 120 × 3 / (0,85 × 0,80 × 0,90) = 588 Wh`.
- Banco LiFePO4 25,6 V × 30 Ah = 768 Wh nominal; energía utilizable de cálculo `768 × 0,80 × 0,90 × 0,85 = 470 Wh`, aproximadamente 3,9 días a 120 Wh/día. La capacidad mínima matemática para tres días es `588 Wh / 25,6 V = 23 Ah`; elegir 30 Ah deja margen limitado, mientras que 35 Ah (~896 Wh nominal, ~548 Wh útiles según los factores anteriores) da aproximadamente 4,6 días. El margen final se define con envejecimiento y temperatura del emplazamiento.
- Para un recurso solar provisional de 3,5 horas sol pico/día y PR=0,65, panel mínimo `120/(3,5×0,65)=52,7 W`. Aplicando factor 1,5 por suciedad, sombras, estación desfavorable y recarga, seleccionar provisionalmente 100 W; 120 W da margen de recuperación, sujeto a estudio de sombras y recurso mensual local.
- Controlador MPPT compatible con química y tensión de batería, perfil LiFePO4 y temperatura. Dimensionar corriente de panel/batería y desconexión de baja tensión según hoja del fabricante.

El cálculo es una envolvente ilustrativa, no selección de compra. Medir potencia promedio/pico, TX LTE, ciclos de adquisición y temperatura; obtener irradiancia mensual y sombras del emplazamiento; comprobar autoconsumo MPPT y pérdidas reales. Si LTE transmite continuamente, el consumo puede exceder ampliamente 5 W. Con red, no dimensionar batería solar salvo que continuidad lo requiera.

## 9. Comunicaciones

| Medio | Uso propuesto | Parámetros de diseño | Restricciones |
|---|---|---|---|
| SPI | ADXL355, SCL3300 y ADS1262 en placa | Corto, punto a punto, nivel lógico según datasheet, reloj/bordes según señal | No tender como cable externo largo |
| SDMMC/SPI | eMMC/microSD local | Buffer y control de integridad | Las tarjetas removibles son punto de falla y manipulación |
| UART | GNSS y consola de servicio | UART con nivel 3,3 V o transceptor apropiado; GNSS entrega mensajes y PPS | No sincronizar solo con hora NMEA |
| RS-485 | Bus cableado de sensores auxiliares/telemetría | Par trenzado, bus lineal, 120 Ω en dos extremos, polarización en un solo punto, aislador y protección | Distancia/velocidad se confirma por cable, terminación y EMC |
| Ethernet | Transferencia de datos crudos y administración | 10/100BASE-T por MAC RMII del STM32H743 con PHY externo, Cat 5e o superior y protección | Rayos/transientes y rutas compartidas con potencia |
| LTE/4G | Backhaul IP donde haya cobertura | Router/modem industrial; SIM/APN y antena externa; buffer local ante pérdida | Medir cobertura y consumo; no sustituye almacenamiento |
| LoRaWAN | Estado, estadísticas, salud y alarmas comprimidas | Paquetes pequeños, baja tasa y ciclo de transmisión restringido | Nunca transportar waveform continuo; banda/plan, potencia, duty-cycle y canal se confirman con ANE/CRC vigentes |
| Wi-Fi/MQTT | Solo compatibilidad o puesta en marcha del prototipo | La arquitectura física nueva es independiente de MQTT | No se selecciona como enlace primario de adquisición de precisión |

La selección de LoRaWAN no fija una frecuencia/canal hasta confirmar la regulación colombiana vigente, clase de dispositivo, límites de potencia y máscara/canales admitidos. No se usa LoRaWAN como reloj ni fuente de fase.

## 10. Sincronización, adquisición y almacenamiento

- Muestreo de cada eje desde temporizador de hardware; lectura SPI con DMA, no muestreo gobernado por `delay()`/bucle de red.
- GNSS-PPS captura en temporizador de hardware para corregir reloj y asociar marcas UTC. El timestamp de cada muestra se deriva del contador disciplinado y del índice de muestra, no de latencia de transporte.
- Objetivo inicial entre estaciones: error de fase temporal menor que 100 µs en banda modal hasta 50 Hz (aprox. 1,8° a 50 Hz). Este es requisito de diseño a validar, no rendimiento garantizado por GNSS/MCU sin diseño de reloj. Para banda superior, reducir proporcionalmente el error; registrar incertidumbre de sincronización.
- Si no hay visibilidad GNSS, RTC TCXO conserva continuidad de hora y el nodo marca el estado `time_quality=HOLDOVER` y error estimado; no presentar fase entre nodos como sincronizada. Ethernet PTP es alternativa solo con hardware timestamping, grandmaster y red evaluada.
- Filtros: configurar ancho de banda del sensor y filtro digital/analógico con documentación de ganancia, fase y retardo. Aplicar antialias antes de decimar. Conservar señal cruda no filtrada o filtrar sin destruir archivo origen; versionar procesamiento.
- Registro local binario o CSV/binary compacto con timestamp por bloque, tasa, escala, orientación, serial, temperatura, salud, CRC, estado PPS y versión de firmware. Escritura por bloques y doble buffer.
- Retención: anillo local de al menos 7 días al caudal nominal, más transferencia de eventos y ventanas programadas. Dimensionar por `bytes/día = canales × muestras/s × bytes/muestra × 86400 × factor de cabecera`; por ejemplo 3 ejes, 200 Hz, 4 bytes, 2,0 de margen = 414,7 MB/día; siete días ≈2,9 GB. Incluir espacio para filesystem y desgaste; una microSD de 32 GB industrial deja margen razonable en este ejemplo.
- Trigger de evento: conservar circularmente 30 s anteriores y 120 s posteriores al evento configurado; los tiempos son parámetros de piloto. Guardar además registros continuos resumidos para tendencias.

## 11. Línea base, análisis y alarmas

### 11.1 Línea base

1. Verificar instalación, orientación, ruido propio, calibración y sincronización.
2. Registrar datos ambientales y operacionales (temperatura, hora, tránsito/clase si está autorizado) y condición visual inicial.
3. Obtener una campaña de varios días/semanas con cobertura representativa; documentar cambios de sensores y cortes.
4. Estimar modos con OMA/PSD, coherencia, formas modales y amortiguamiento con método y bandas declarados. Comparar por condiciones térmicas y masa/uso; no mezclar ventanas con distinta configuración.
5. Establecer distribución de referencia por régimen ambiental y operacional; validarla con periodo retenido independiente.

### 11.2 Niveles de evento (reglas configurables)

- **E0 — Transitorio:** pico aislado o impulso; conservar waveform, revisar saturación/calidad y correlacionar con tráfico/viento/sismo conocido.
- **E1 — Calidad de medición:** sensor saturado, desconectado, drift abrupto, PPS inválido, autodiagnóstico fallido, huecos, clipping, temperatura fuera de rango o archivo corrupto. No clasificar como anomalía estructural.
- **E2 — Operacional:** variación reproducible asociada a tráfico, temperatura, operación de junta u obra; requiere correlación y seguimiento, no diagnóstico.
- **E3 — Anomalía estructural potencial:** cambio persistente y estadísticamente relevante en frecuencia/modo/amortiguamiento o deformación/desplazamiento bajo condiciones comparables, confirmado por sensores independientes y evaluación de calidad. Genera revisión técnica y recomendación de inspección.
- **E4 — Prioridad de inspección:** evento de demanda excepcional o múltiples indicadores persistentes coherentes, tras descartar error y correlacionar fuentes. Escalar al responsable del activo para inspección prioritaria; el sistema no decide cierre del puente.

No hay un umbral universal propuesto. Los límites de disparo se ajustan tras línea base, análisis de incertidumbre, objetivos del propietario y evaluación estructural. Un pico de aceleración no prueba daño; una frecuencia cambiante puede deberse a temperatura, masa, humedad, condición de apoyo, instrumentación o procesamiento.

## 12. Instalación, calibración y mantenimiento

### 12.1 Secuencia de instalación

1. Recibir planos y autorización de acceso/intervención; inspección conjunta, permiso de trabajo y plan de rescate/altura/tránsito.
2. Levantar geometría real, ejes, elementos, armaduras/tendones, juntas, apoyos, rutas de cables, tierra, sombra y cobertura.
3. Revisar modelo/análisis modal preliminar y aprobar coordenadas por estación.
4. Banco de prueba: verificación de ruido, escala, filtro, PPS, carga de storage, brownout, comunicaciones y recuperación de energía.
5. Preparar montaje sin dañar recubrimiento/elemento; verificar fijación y sellado; colocar sensor con orientación; documentar foto y coordenadas.
6. Tender cable con protección mecánica, radios de curvatura, sujeción y separación de potencia; instalar gabinetes y antenas; verificar puesta a tierra/descargadores.
7. Energizar por ramales, validar tensión y corriente; confirmar sensor, identidad, timestamp, waveform, archivo local y transmisión.
8. Prueba de excitación controlada no dañina (golpe instrumentado/ shaker pequeño aprobado) y comparación de canales; no impactar el puente sin procedimiento.
9. Prueba de aceptación conjunta, inventario y entrega del paquete de datos de interface.

### 12.2 Calibración/verificación

- Acelerómetro: certificado trazable si se requiere exactitud absoluta; antes/después, prueba en mesa vibratoria o calibrador con frecuencia/amplitud conocidas. Para piloto, comparar ruido y respuesta relativa con sensor de referencia calibrado.
- Inclinómetro: mesa angular nivelada, puntos de cero y ±ángulos de verificación, ciclos térmicos si la precisión requerida lo exige.
- Galgas/ADS1262: shunt calibration, resistencia patrón, puente simulado, verificación de excitación/linealidad; calibración de campo del adhesivo y compensación por material.
- LVDT: patrón de desplazamiento en varios puntos del rango y verificación del cero/linealidad.
- PT100: calibrador de resistencia o baño térmico; registrar 4 hilos y clase/tolerancia.
- GNSS-PPS: medir diferencia de PPS entre nodos con osciloscopio/contador de tiempo y registrar holdover/deriva.
- Repetir verificaciones tras montaje, mantenimiento, impacto/obra o cambio de firmware y en periodo definido por criticidad.

### 12.3 Mantenimiento

Mensual en piloto: salud de alimentación, sincronía, cobertura, almacenamiento, gaps, errores, condensación/corrosión y fijaciones visibles. Trimestral/semestral según acceso: reapriete controlado donde sea aplicable, sellos, antena, protección, revisión de cable y test funcional. Anual: verificación metrológica y evaluación de deriva, batería/solar, desecante/respiradero y revisión de condición del puente correlacionada con resultados.

## 13. Plan de pruebas y aceptación

| Prueba | Criterio preliminar | Evidencia |
|---|---|---|
| Identidad y configuración | Serial, estación, ejes, escalas, ODR, filtro y firmware únicos y legibles | Ficha de estación/configuración |
| Ruido/estabilidad | Ruido medido por eje y banda por debajo del umbral derivado del objetivo modal; no se fija valor universal sin modelo y sensor real | PSD en reposo y referencia |
| Muestreo | Tasa real dentro de ±0,1% a lo largo de 1 h; ausencia de overrun | Contador de muestras/timestamps |
| Sincronización | Diferencia entre nodos <100 µs en modo de operación nominal para banda hasta 50 Hz; documentar degradación holdover | Medición PPS y log |
| Antialias/filtro | Respuesta de magnitud/fase caracterizada; alias fuera de banda bajo el criterio del análisis | Barrido/certificado/ensayo |
| Canales estáticos | Calibración/verificación dentro de tolerancia requerida por caso de uso | Certificados y shunt/patrón |
| Memoria | 7 días de datos calculados sin pérdida y recuperación tras pérdida de energía | Ensayo de escritura/CRC |
| Energía | Arranque y operación a tensión mínima/máxima; autonomía solar medida/proyectada con carga real | Curvas de corriente y prueba |
| EMC/ambiente | Sin reset/datos corruptos en transientes previstos; prueba de gabinete y conectores contra requisito de compra | Protocolos de prueba |
| Mecánica | Fijación firme, orientación repetible y sin cable que precargue sensor; inspección visual | Fotos, torque y acta |
| Transporte | Paquetes resumidos/archivos llegan con checksum; si falla backhaul el nodo conserva y reenvía | Prueba de desconexión |
| Alarmas | Calidad, transitorio, operación, potencial estructural y prioridad se etiquetan separadamente | Casos sintéticos/ensayo y acta |

Los valores de aceptación se deben elevar o ajustar en el diseño detallado mediante especificación del propietario, tolerancia del sensor y análisis modal. No equivalen a límites de seguridad.

## 14. Riesgos y decisiones abiertas

| ID | Riesgo/incertidumbre | Mitigación/decisión requerida |
|---|---|---|
| R1 | Geometría/materiales/apoyos no comprobados | Planos conforme a obra, levantamiento y revisión civil antes de coordenadas |
| R2 | Selección modal sin modelo ni campaña | Modelado, OMA piloto y optimización de ubicación |
| R3 | Montaje puede dañar estructura o generar resonancia local | Método aprobado por responsable del activo, prueba de rigidez y no perforar/soldar sin diseño |
| R4 | Sincronía insuficiente por GNSS bajo tablero | Antena en cielo abierto, PPS de hardware, medición independiente; holdover marcado |
| R5 | Señal strain vulnerable a temperatura/EMI | Puente completo/compensación, acondicionador local, cableado apantallado y shunt cal |
| R6 | Corrosión, condensación y vandalismo | Gabinete adecuado, drenaje/respiradero, fijación protegida y programa de inspección |
| R7 | Solar/cobertura desconocidos | Medir consumo real, sombra, radiación y cobertura; buffer local obligatorio |
| R8 | Radiofrecuencia no confirmada | Verificar banda/canales/potencia en fuentes vigentes ANE/CRC antes de comprar LoRa |
| R9 | Falsas alarmas por temperatura/tráfico | Baseline condicional, sensor ambiental, clasificación de calidad y revisión humana |
| R10 | Diferencias entre firmware/documentación del prototipo | Versionar por estación, registrar hashes/configuración y no reutilizar umbrales antiguos |

## 15. Normativa y criterios de cumplimiento

La aplicabilidad y versión vigente deben validarse para el alcance real de obra, propietario y fecha de contratación:

- **Puentes Colombia:** consultar especificaciones vigentes de INVÍAS, Código Colombiano de Diseño Sísmico de Puentes/CCP vigente y documentos contractuales del propietario. No se cita artículo específico porque no se obtuvo en esta consulta una copia oficial accesible que permita verificar edición y apartado. La instrumentación no reemplaza inspecciones y evaluación estructural reglamentarias.
- **Electricidad:** revisar RETIE vigente del Ministerio de Minas y Energía y normas de instalación/protección a tierra aplicables al sistema de alimentación en sitio; el alcance depende de si se conecta a instalación eléctrica pública, solar o circuito existente. Diseños y certificaciones deben corresponder al profesional/organismo con competencia aplicable.
- **Radio:** verificar Plan Nacional de Frecuencias, cuadro de atribución y resoluciones vigentes de ANE/CRC antes de seleccionar canal, potencia, antena y ciclo de transmisión LoRaWAN/LTE. No fijar aquí una frecuencia colombiana por falta de verificación oficial accesible.
- **Calibración:** mantener trazabilidad metrológica y registrar incertidumbre. ISO/IEC 17025 aplica al laboratorio acreditado de calibración; no implica que el montaje de campo esté certificado.
- **Ambiente/conectores:** exigir ensayos de grado IP, UV, corrosión, temperatura y EMC como especificación de compra; una etiqueta de producto no demuestra que la instalación completa cumpla.

## 16. Fuentes técnicas consultadas

1. Murata, **SCL3300 Inclinometers / SCL3300-D01**. Página de producto consultada: https://www.murata.com/en-us/products/sensor/inclinometer/overview/lineup/scl3300 . Publica interfaz SPI, alimentación 3,0–3,6 V, consumo típico 1,2 mA, rango de temperatura -40 a +125 °C, modos seleccionables y ruido de inclinación hasta 0,001°/√Hz. Datasheet enlazado desde la misma página: `datasheet_scl3300-d01.ashx`; verificar revisión y condiciones antes de diseño.
2. Texas Instruments, **ADS1262**, página de producto y hoja de datos Rev. C: https://www.ti.com/product/ADS1262 y https://www.ti.com/lit/gpn/ADS1262 . La ficha consultada publica ADC delta-sigma de 32 bits, hasta 38 kSPS, 10 entradas, SPI, PGA, rango de temperatura -40 a +125 °C y rechazo 50/60 Hz. Verificar ENOB/ruido para la tasa real.
3. Analog Devices, **ADXL354/ADXL355 Data Sheet**: https://www.analog.com/media/en/technical-documentation/data-sheets/adxl354_355.pdf . La descarga no fue accesible en la consulta web de esta sesión; se incluye como referencia primaria a verificar antes de congelar escala, filtro, ruido, pines y tiempos.
4. STMicroelectronics, **STM32H743xI datasheet**: https://www.st.com/resource/en/datasheet/stm32h743vi.pdf . La descarga no quedó verificada por timeout; confirmar los multiplexados GPIO, tensión, temporizadores, memoria y límites con datasheet y reference manual oficiales de la revisión seleccionada.
5. IEC 60751, **Industrial platinum resistance thermometers and platinum temperature sensors**. Usar edición vigente y hoja de fabricante de la sonda para tolerancia exacta; confirmar requisitos de calibración y montaje.
6. INVÍAS, portal institucional: https://www.invias.gov.co/ . Se consultó el portal general, pero no se obtuvo un manual vigente de puentes aplicable al diseño SHM. Solicitar al propietario las normas de diseño/inspección que gobiernan el activo y verificar edición antes de citar un capítulo.
7. Ministerio de Minas y Energía, página oficial RETIE: https://www.minenergia.gov.co/es/misional/energia-electrica-2/reglamentos-tecnicos/reglamento-t%C3%A9cnico-de-instalaciones-el%C3%A9ctricas-retie/ . El resultado de búsqueda institucional identificó la página de reglamento, pero su contenido no pudo recuperarse en esta consulta; confirmar el texto consolidado y modificaciones vigentes antes de emitir diseño eléctrico.
8. Agencia Nacional del Espectro (ANE), portal institucional: https://www.ane.gov.co/ . El portal general es accesible; el Plan Nacional de Frecuencias/cuadro vigente no quedó recuperado. Consultar el documento y reglas CRC/ANE aplicables antes de fijar LoRaWAN, frecuencia, potencia o ciclo de transmisión.

## 17. Paquete para el equipo de software

Las señales, metadatos, marcas temporales, unidades, salud y formato orientativo se especifican en `interfaces_y_conexiones.md`. La estación puede entregar archivos crudos por Ethernet/LTE/medio de servicio y paquetes resumidos por un transporte IP o LoRaWAN aprobado. El firmware de adquisición no depende de Node-RED, MQTT, AWS, InfluxDB ni dashboard.

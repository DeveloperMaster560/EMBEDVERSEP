# Viaducto de la Novena — obra de referencia

Reproducción paramétrica del **Viaducto Provincial Alejandro Galvis Ramírez**
(Bucaramanga, Santander, Colombia), incorporada al EMBEDVERSE BRIDGE STUDIO
como primera obra del catálogo de referencias documentadas.

---

## 1. Qué es esto, y qué no es

**Qué es.** Un modelo paramétrico multidisciplinario de 643 componentes que
reproduce la **geometría publicada** de la obra: su reparto real de vanos, la
posición real de sus dos pilonos, su ancho y sus seis carriles, más las
instalaciones que lleva un viaducto de este tipo —drenaje, alumbrado vial,
realce arquitectónico, señalización, instrumentación estructural y el sistema
embebido que gobierna el encendido.

**Qué no es, y conviene decirlo antes que nada:**

- **No procede de planos de proyecto ni de un levantamiento.** Todas las
  dimensiones salen de fuentes públicas citadas una a una en el apartado 3.
  Son verificables, no contrastadas en campo.
- **No está revisado por un profesional.** El modelo se marca a sí mismo
  `professional_review: not_reviewed` y no existe forma de cambiarlo desde la
  aplicación.
- **No hay cálculo estructural.** No se han calculado esfuerzos, flechas,
  tensión de tirantes ni cimentación. Quedan **2.382 parámetros en nulo** y
  **3.371 declaraciones de cálculo pendiente**, contados por el propio
  generador.
- **No hay simulación.** El motor de simulación del sistema sigue sin
  integrar, y este modelo no lo cambia. Nada de lo que se ve aquí está
  simulado eléctrica, térmica ni estructuralmente.
- **No hay entrenamiento ni IA.** El enunciado se interpreta con reglas
  locales. No se envía nada a ningún servicio externo.

---

## 2. Cómo reproducirlo

1. `npm run dev`
2. Pestaña **Puentes**.
3. Escribir: `Viaducto de la Novena, Bucaramanga.`

Nombrar la obra carga su ficha documentada en lugar de interpretar el texto.
Las fuentes de cada dato aparecen en pantalla como supuestos, y los límites de
la reproducción como advertencias, **antes** de generar.

También responde a «viaducto la novena», «viaducto provincial» o «viaducto
Alejandro Galvis».

---

## 3. Geometría adoptada y su procedencia

| Dato | Valor | Fuente |
|---|---|---|
| Tipología | Atirantado, tablero de cajón postesado | Carlos Fernández Casado S.L. |
| Reparto de vanos | **129,20 + 292,40 + 129,20 m** | CFCSL / Wikipedia |
| Longitud total | 550,80 m | Suma de los vanos; coincide con El Tiempo |
| Ancho de tablero | 30,00 m | El Tiempo |
| Carriles | 6 | El Tiempo |
| Pilonos | 112 y 132 m totales; 52 y 72 m hasta el tablero | Prensa técnica |
| Altura de torre sobre tablero | **60,00 m** | Derivada: 112−52 = 132−72 = 60 |
| Cota del tablero | 72,00 m | Adoptada: pilono más desfavorable |
| Coordenadas | 7,10817 N / −73,12984 W | Structurae |

**Dos comprobaciones que cierran.** Primera: los vanos suman 550,80 m, que es
exactamente la longitud publicada por fuente independiente. Segunda: restando
la altura hasta el tablero de la altura total de cada pilono se obtiene **60 m
en los dos**, lo cual es coherente —los pilonos son iguales por encima del
tablero y difieren por debajo porque el terreno cae. Dos fuentes distintas
encajan sin forzar nada.

### Lo que hubo que construir para conseguirlo

El generador **solo sabía hacer vanos iguales** (`longitud / nº de vanos`) y
colocaba las torres en los tercios de la longitud. Con ese reparto, las torres
del viaducto habrían caído en x = 183,6 y 367,2 m: **46 metros fuera de su
sitio real**. Se añadió reparto explícito de vanos, altura de torre de
proyecto y la regla de que en un atirantado **las torres flanquean el vano
principal**, que es donde van porque son ellas las que lo sostienen.

### Discrepancias, dichas y no escondidas

- Las fuentes dan 130 o 132 m de altura según el medio. Se adopta el par
  112/132 porque es el único acompañado de la altura hasta el tablero.
- El modelo usa **un solo plano de terreno** a cota 0. En la obra el terreno
  cae y por eso los pilonos miden distinto por debajo del tablero.
- El tablero real es un **cajón hueco postesado con eje central de tirantes**.
  Este generador construye vigas y **dos planos laterales** de tirantes: la
  silueta, el reparto y la posición de torres son los de la obra; la sección
  transversal no.

---

## 4. Contenido del modelo

643 componentes, 220 conexiones, 643 operaciones registradas.

| Disciplina | Componentes |
|---|---|
| Estructura | 206 |
| Iluminación | 194 |
| Drenaje | 190 |
| Señalización | 26 |
| Control y sistemas embebidos | 11 |
| Instrumentación | 8 |
| Tablero | 4 |
| Barreras | 4 |

---

## 5. Iluminación y sistemas embebidos

El realce arquitectónico se separa del alumbrado vial porque responden a
criterios distintos: el vial es seguridad y se enciende entero; el realce es un
programa de color y se direcciona por zonas. **No comparten circuito ni mando.**

- Un proyector lineal RGBW **por cada tirante**, situado en el anclaje real del
  cable al tablero.
- Proyectores de gran alcance al pie de cada fuste de torre, **por fuera** del
  abanico de tirantes.
- Bañadores lineales a lo largo de las barreras.

### La cadena de mando, declarada de principio a fin

```
fotocelda ──► contactor ──► circuito de alumbrado vial
          └─► controlador ──► fuente/driver ──► proyectores de realce
```

Más un **reloj astronómico** en paralelo con la fotocelda, porque una fotocelda
sucia o sombreada deja el puente a oscuras. Es el único equipo del puente cuyo
comportamiento depende literalmente de dónde está el puente: **hereda
automáticamente la latitud y longitud del emplazamiento declarado**, y si no
hay emplazamiento, declara la coordenada como pendiente en vez de inventarla.

### Lo que el sistema se niega a inventar

- **Ninguna dirección DMX.** Se asignan en puesta en marcha.
- **Ningún recuento de nodos LED por proyector.** Las ~7.820 luminarias
  publicadas no se modelan una a una: cada proyector del modelo es una
  **unidad direccionable**, y cuántos nodos lleva dentro depende del producto
  que se seleccione. Agrupar no es contar.
- **Ningún calibre de contactor.** Se advierte expresamente que debe elegirse
  con la corriente de **arranque** del circuito, no con la nominal —error
  frecuente— y que ese dato no está calculado.
- **Ningún umbral de lux** para la fotocelda: depende del criterio del operador.

El paquete `public/libraries/EMBEDVERSE-Control-Alumbrado.evcl.json` lleva los
cuatro componentes de esa cadena (fotocelda LM393, RTC DS3231, módulo de relé y
transceptor RS-485 MAX485) al Laboratorio de electrónica, donde se pueden
colocar, cablear y validar. **Sus pines están marcados PENDIENTE DE
VERIFICACIÓN contra hoja de datos**, acorde con la política del catálogo.

---

## 6. Emplazamiento

Bucaramanga, Santander, Colombia. Cruza las cañadas de La Rosita y El Loro;
conecta la Calle 45 con la Carrera 9 y la Ciudadela Real de Minas.

Cinco datos del sitio quedan **declarados como pendientes** porque exigen norma
y estudio, no búsqueda en internet:

`seismic_hazard_zone` · `design_wind_speed_kmh` · `rainfall_intensity_mm_h` ·
`soil_profile_type` · `ground_elevation_m`

El de sismo es el más sensible: Bucaramanga está junto al nido sísmico del
mismo nombre y la zona de amenaza debe tomarse de la norma colombiana
aplicable, no de una fuente periodística.

---

## 7. Verificación realizada

| Comprobación | Resultado |
|---|---|
| Errores de consistencia | **0** |
| Avisos de consistencia | **0** |
| Colisiones estructurales | **0** |
| Interferencias accionables | 1 (preexistente, de trazado) |
| Tipos sin clasificar en el cálculo de secciones | **0** |
| Pruebas TypeScript | 177 pasan |
| Pruebas Python del generador | 40 pasan (19 previas + 21 nuevas) |
| Pruebas del núcleo geométrico | todas correctas |
| Tipos, lint y compilación | limpios |

Queda **un fallo preexistente** en `test_build_arch` («hay ventanas en
fachada»), del generador de edificación. Se comprobó revirtiendo los cambios
que ya fallaba antes de este trabajo; no lo ha causado el viaducto y no lo he
tocado.

Durante el desarrollo aparecieron **168 colisiones estructurales** entre los
proyectores nuevos y los tirantes. Se diagnosticaron y se corrigieron hasta
cero moviendo los proyectores a donde irían físicamente: fuera del fuste y por
debajo del punto más bajo del abanico.

### Una advertencia sobre la masa

Desde el 11/11/2026 la propia interfaz lo advierte: la cifra se rotula **«Masa
de lo modelado»**, nunca «masa estructural», y lleva pegada la salvedad. Antes
se mostraba el número a secas, que ante un comité se lee como el peso del
puente.

El modelo reporta **23.287 t**. La prensa publica **7.536 t** para la obra real.
**No son comparables y no debe presentarse esa cifra como el peso del
viaducto.** El modelo construye vigas macizas y fustes macizos; la obra tiene un
cajón hueco postesado. Nuestra cifra es la masa de *nuestra* geometría
hipotética, calculada como volumen real × densidad declarada. Es correcta como
aritmética y no es una medición de la obra.

---

## 8. Lo que falta

- **Armadura, tendones de postensado, anclajes y pernos**: no existen en el
  generador. Exigen diámetros, separaciones y recubrimiento que son decisiones
  de diseño.
- **Sección de cajón** y **eje central de tirantes**: el generador no los hace.
- **Terreno con relieve**: hoy hay un único plano a cota 0.
- **Verificación visual en navegador**: no se ha hecho. El GLB se genera y pesa
  957 KB, pero nadie ha mirado todavía el resultado en pantalla.
- **Motor de simulación**: sigue sin integrar.

---

## 9. Fuentes

- Carlos Fernández Casado S.L. — <https://www.cfcsl.com/en/viaduct-carrera-novena-bucaramanga-colombia/>
- Structurae, Viaducto Provincial — <https://structurae.net/structures/viaducto-provincial>
- El Tiempo — <https://www.eltiempo.com/archivo/documento/CMS-15539478>
- El Universal — <https://www.eluniversal.com.co/colombia/2021/02/12/el-viaducto-de-la-novena-en-bucaramanga-desde-hoy-se-llama-alejandro-galvis-ramirez/>
- Color Kinetics (iluminación) — <https://www.colorkinetics.com/global/showcase/viaducto-de-la-novena>
- Wikipedia, Viaducto Provincial Alejandro Galvis Ramírez — <https://es.wikipedia.org/wiki/Viaducto_Provincial_Alejandro_Galvis_Ram%C3%ADrez>

Ninguna de estas fuentes es un documento de proyecto. Para cualquier uso
técnico, las cifras deben contrastarse contra la documentación oficial de la
obra.

---

## 10. Encender las luces: evaluación del mando

**Esto no es el motor de simulación**, que sigue sin integrar. Es otra cosa, y
conviene saber distinguirlas ante el comité:

| | Simulador | Evaluador de mando |
|---|---|---|
| Respondería | «la luminaria entrega 11.200 lm» | «el contactor cierra **porque** el reloj dice que ya es de noche» |
| Necesita | modelo físico y eléctrico | la lógica declarada en el modelo |
| Existe hoy | **no** | **sí** |

### Cómo se usa

Pestaña **Puentes** → generar el viaducto → panel **«Mando del alumbrado»**.
Un control de hora recorre el día; las luminarias se encienden en el visor
cuando su zona queda energizada.

### Qué decide, y con qué

- **Alumbrado vial**: lo manda el crepúsculo. El orto y el ocaso se calculan
  con el **algoritmo solar de la NOAA** a partir de las coordenadas que el
  reloj astronómico heredó del emplazamiento. Para Bucaramanga el 9 de
  noviembre: **orto 05:41, ocaso 17:31**, que son los valores reales. No se
  puede conmutar a mano, porque obedecer al crepúsculo es su razón de existir.
- **Realce (tirantes, torres, barreras)**: no se deduce. Depende de un programa
  que decide el operador y que el modelo no contiene. Se expone como
  conmutador y cada zona lo dice: *«es una elección del operador, no una
  deducción del modelo»*.

### Lo que se niega a decidir

- **La fotocelda no se puede evaluar**: sus umbrales de lux están pendientes.
  El sistema lo dice y resuelve el mando por el reloj astronómico. Esta es
  justamente la clase de respuesta que distingue al sistema: señala qué parte
  del diseño es determinable y cuál no.
- **Sin coordenadas no decide nada**: declara el mando no evaluable en vez de
  suponer un horario.
- **El huso horario se deduce de la longitud** porque el reloj lo declara
  pendiente. Queda dicho que esa deducción ignora husos políticos y horario
  de verano.
- **No suma potencias si alguna zona encendida no la declara.** Una suma con
  un hueco no es una suma.

### Fuera de su alcance

Corriente y caída de tensión reales, flujo luminoso, iluminancia y
uniformidad, comportamiento térmico, fallos y transitorios. Nada de eso se
simula ni se insinúa.

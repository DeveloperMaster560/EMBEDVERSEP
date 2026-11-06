# EMBEDVERSE BRIDGE STUDIO

Módulo que convierte un enunciado en español en un **modelo multidisciplinario
de puente**, explorable en 3D dentro de la aplicación.

Se abre desde **un proyecto → pestaña Puentes**.

> No confundir con la pestaña **Modelos 3D** (`src/bridge-designer`), que dibuja
> un puente conceptual de visualización a partir de una propuesta. Esta pestaña
> genera el modelo paramétrico con siete disciplinas y detección de
> interferencias entre ellas.

---

## 1. Qué hace, en una frase

Un prompt como

> «Puente de vigas de 90 m de longitud, 10 m de ancho de tablero, tablero a 7 m
> sobre el terreno, 3 vanos, 4 vigas principales y 2 carriles con aceras.»

produce **138 componentes** de siete disciplinas —estructura, tablero, barreras,
drenaje, iluminación, señalización e instrumentación— con geometría
tridimensional real, conexiones entre componentes y validación geométrica, en
poco más de un segundo.

Cifras medidas sobre el endpoint real, en los tres ejemplos que trae el módulo:

| Enunciado | Componentes | Conexiones | GLB | Errores | Interferencias accionables | Tiempo |
|---|---:|---:|---:|---:|---:|---:|
| Vigas, 90 × 10 m, 3 vanos | 138 | 58 | 202 KiB | 0 | 0 | 1,1 s |
| Losa, 24 × 9 m | 71 | 19 | 87 KiB | 0 | 0 | 0,8 s |
| Atirantado, 240 × 16 m | 298 | 147 | 450 KiB | 0 | 0 | 1,8 s |

## 2. Cómo funciona

```text
Prompt en español
   │
   ▼  src/bridge-studio/prompt-interpreter.ts       reglas deterministas, sin IA externa
BridgeSpecification  ──► preguntas de lo que falta, supuestos declarados
   │
   ▼  POST /api/bridge/generate                     server/bridgeGenerator.ts
Validación y acotado de la solicitud
   │
   ▼  tools/building_generator/generate_bridge_scene.py     spawn, sin shell
bridge_params.apply_spec()  ──► recalcula vanos, pilas, vigas y calzada
   │
   ▼  siete módulos de disciplina (bridge_model.py)
Modelo: componentes + conexiones + sólidos paramétricos + operaciones
   │
   ├──► GLB con un nodo por componente (`disciplina__zona__component_id`)
   └──► catálogo, validación geométrica e informe de interferencias
   │
   ▼  src/model-viewer/ModelViewport.tsx
Visor: capas por disciplina, aislar zona, corte, despiece, inspector
```

### Sistema de coordenadas

```text
X  eje longitudinal, de estribo a estribo (0 … longitud)
Y  eje transversal, centrado en el eje de calzada (−ancho/2 … +ancho/2)
Z  cota; 0,00 es el terreno bajo el puente
```

### Las tres tipologías

| Tipología | Qué construye | Luz máxima conceptual |
|---|---|---:|
| `beam` — vigas | vigas longitudinales + diafragmas + losa | 45 m |
| `slab` — losa | losa maciza continua | 25 m |
| `cable_stayed` — atirantado | torres en H, tirantes en abanico a ambos lados, anclajes | 300 m |

Las tres comparten cimentación, pilas, estribos con aletas, apoyos de neopreno y
juntas de dilatación.

### El prompt no inventa datos

El intérprete solo reconoce un vocabulario acotado. Lo que no puede deducir lo
**pregunta**:

| Enunciado | Resultado |
|---|---|
| «Puente de vigas de 90 m, 10 m de ancho de tablero, tablero a 7 m» | genera |
| «Puente de 40 m de longitud» | pregunta ancho y cota del tablero |
| «Quiero un puente bonito» | pregunta longitud, ancho y cota |
| «Puente en arco de 80 m» | avisa de que no modela puentes en arco |
| «Edificio de 3 niveles de 24 × 18 m» | redirige a la pestaña Edificación |

Nunca rellena una dimensión ausente con un valor por defecto silencioso.

Dos trampas del lenguaje que el intérprete resuelve a propósito, porque el
vocabulario de dimensiones se solapa con el de componentes:

- «vigas de 0.45 m de **ancho**, **ancho de tablero** 12 m» → el ancho del
  puente es 12 m, no 0,45. La etiqueta específica se prueba antes que la
  genérica.
- «vigas de 1.20 m de canto» → **no** cuenta una viga. Solo se acepta la forma
  «N vigas», porque contar mal es peor que preguntar.

Y una del alcance: mencionar «tablero» al dar una medida **no** significa pedir
solo la disciplina de tablero. La lista de disciplinas solo se recorta si el
enunciado lo pide explícitamente («solo», «únicamente»).

### El generador rechaza lo imposible

`apply_spec()` no degrada el modelo en silencio: o produce geometría coherente o
explica por qué no puede.

| Solicitud | Respuesta |
|---|---|
| puente de losa de 600 m | «exigiría 24 vanos para no superar la luz máxima conceptual de 25 m, por encima del límite de 20» |
| ancho de 4 m con aceras | «con 4,00 m de ancho no queda calzada útil tras aceras y bordillos» |
| tablero a 1,8 m | «el fondo de la estructura queda a 0,88 m y no deja espacio para apoyos, cabezal y pila» |

Cuando sí puede resolverlo pero tiene que adaptar algo, lo **declara como
ajuste** y la interfaz lo muestra:

> «Vanos ajustados de 2 a 3: con 2 la luz sería de 50,00 m, por encima de la luz
> máxima conceptual de 45 m para un puente de vigas.» *(100 m en 2 vanos)*
>
> «Se suprimieron las aceras: con 5,40 m de ancho total no quedaba calzada útil.»
> «Carriles ajustados de 2 a 1: la calzada útil mide 2,50 m.»

### Las disciplinas se completan solas

Pedir drenaje sin tablero no tiene sentido geométrico. El generador añade las
dependencias que faltan y lo dice:

```text
deck, barriers, drainage, lighting, signage  ──► necesitan structure
barriers, drainage, lighting, signage        ──► necesitan deck
instrumentation                              ──► necesita structure
```

## 3. Qué se ve en el visor

Es **el mismo visor** que usa el Building Studio (`src/model-viewer/`), con las
zonas del puente en el papel que allí hacen los niveles:

| Zona | Qué agrupa |
|---|---|
| `CIM` | zapatas y pilotes |
| `EA`, `EB` | estribo inicial y final, con aletas |
| `P1`…`Pn` | pilas y cabezales |
| `V1`…`Vn` | superestructura de cada vano |
| `TAB` | losa de tablero, calzada, aceras y acabados |
| `T1`, `T2` | torres y tirantes (solo atirantado) |

- **Capas por disciplina** — encender y apagar cada una de las siete.
- **Aislar zonas** — ver un vano, una pila o solo el tablero.
- **Corte del volumen** — tres planos de recorte ajustables; el interior se lee
  macizo porque los materiales se renderizan a doble cara.
- **Despiece por conjuntos** — la cimentación baja, pilas y torres se quedan
  quietas como referencia, la superestructura sube y el tablero sube el doble.
- **Color por material o por disciplina**.
- **Inspector** — al hacer clic en un elemento muestra su `component_id`,
  disciplina, tipo, zona, material y cuántos parámetros tiene pendientes.

El aspecto se consigue con iluminación por imagen (IBL), mapeo tonal ACES y
materiales físicos por material declarado. **No hay texturas ni entorno**: lo
que se ve es la geometría real del modelo.

## 4. Instalación

La misma que el Building Studio. Una vez:

```bash
./tools/setup_generator.sh
npm run dev
```

El script crea `tools/venv` con lo que el Studio necesita (numpy, shapely,
trimesh, scipy, networkx, mapbox-earcut). La app lo detecta sola.

Si prefieres otro entorno:

```bash
EMBEDVERSE_PYTHON=/ruta/al/python npm run dev
```

## 5. Seguridad del endpoint

`/api/bridge/generate` comparte el núcleo con `/api/building/generate`
(`server/generatorRuntime.ts`), por la misma razón: **ejecuta un proceso en el
host**.

- Solo acepta solicitudes locales del mismo origen (403 en caso contrario).
- Exige `application/json` (415).
- Valida y acota cada campo; rechaza cualquier propiedad que no reconoce.
- `spawn` sin shell, con argumentos fijos.
- Límites: 64 KiB de petición, 180 s de ejecución, 80 MiB de salida.
- Una generación a la vez **en todo el servidor** (429): el candado es
  compartido con el generador de edificios, porque los dos compiten por la
  misma CPU.

**No es un servicio de producción.** No tiene sandbox del sistema operativo ni
cuota de memoria del proceso. No debe publicarse en una red.

## 6. Alcance y límites

Esto es lo que el módulo **sí** calcula, medido sobre el modelo:

- Geometría tridimensional de todos los componentes.
- Longitud real de cada recorrido (colectores de drenaje, alimentación de
  luminarias, troncal de instrumentación), medida sobre su polilínea 3D.
- Interferencias geométricas, clasificadas entre esperadas (pases, encuentros
  constructivos, recorridos compartidos) y accionables.

Esto es lo que **no**:

- No hay cálculo estructural, hidráulico, de tráfico ni de iluminación.
- Cantos de viga, dimensiones de pila, zapata, cabezal y tirante son
  **hipótesis geométricas** (`HYP_*`), no resultados de análisis.
- Áreas de armadura, fuerza de pretensado, tensión de tirantes, caudales de
  drenaje y niveles de iluminancia quedan en `null` a propósito, con su motivo
  declarado.
- No hay revisión profesional. El campo `professionalReview` vale siempre
  `not_reviewed`.
- No modela puentes colgantes, en arco, en celosía ni móviles, ni trazados
  curvos, esviados o con rasante inclinada.
- Rango admitido: longitud 10 a 600 m, ancho de tablero 4 a 40 m, cota del
  tablero desde 1,50 m, 1 a 20 vanos.

**El modelo no es apto para construir, licenciar ni certificar nada.**

## 7. Archivos

```text
src/bridge-studio/
  contracts.ts            BridgeSpecification, límites y conversión a solicitud
  prompt-interpreter.ts   intérprete determinista en español
  BridgeStudio.tsx        configuración del dominio puente
src/model-viewer/         compartido con el Building Studio
  ModelStudio.tsx         armazón de la interfaz, dirigido por configuración
  ModelViewport.tsx       escena Three.js, capas, corte, despiece
  scene-graph.ts          convenio de nombres del GLB y orden de zonas
  materials.ts            presentación física por material declarado
  contracts.ts            resultado de generación, común a los dos dominios
server/
  generatorRuntime.ts     transporte, aislamiento del proceso y límites
  bridgeGenerator.ts      validación de la solicitud de puente
tools/building_generator/
  generate_bridge_scene.py  punto de entrada del modo escena
  bridge_params.py          solicitud, hipótesis y todo lo derivado
  bridge_model.py           los siete módulos de disciplina
```

El núcleo paramétrico (`catalog.py`, `solids.py`, `routing.py`, `validate.py`,
`export_model.py`) es el mismo que usa la edificación. No sabe de puentes ni de
edificios: recibe las disciplinas, los materiales y los roles de interferencia
del dominio que lo invoca.

Pruebas: `npm test` cubre el intérprete, el contrato, el convenio de nombres de
zonas, la presentación de materiales y la validación del endpoint.

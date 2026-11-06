# EMBEDVERSE BUILDING STUDIO

Módulo que convierte un enunciado en español en un **modelo multidisciplinario
de edificio**, explorable en 3D dentro de la aplicación.

Se abre desde **un proyecto → pestaña Edificación**.

---

## 1. Qué hace, en una frase

Un prompt como

> «Edificio institucional de 3 niveles, longitud 24 m, ancho 18 m, altura libre 3.20 m
> y altura entre niveles 3.60 m.»

produce **1.341 componentes** de siete disciplinas —estructura, arquitectura,
eléctrico, telecomunicaciones, hidrosanitario, climatización y seguridad— con
geometría tridimensional real, conexiones entre componentes y validación
geométrica, en unos 7 segundos.

## 2. Cómo funciona

```text
Prompt en español
   │
   ▼  src/building-studio/prompt-interpreter.ts      reglas deterministas, sin IA externa
BuildingSpecification  ──► preguntas de lo que falta, supuestos declarados
   │
   ▼  POST /api/building/generate                     server/buildingGenerator.ts
Validación y acotado de la solicitud
   │
   ▼  tools/building_generator/generate_scene.py      spawn, sin shell
params.apply_spec()  ──► recalcula rejilla, niveles, zonificación y programa
   │
   ▼  siete módulos de disciplina
Modelo: componentes + conexiones + sólidos paramétricos + operaciones
   │
   ├──► GLB con un nodo por componente (`disciplina__nivel__component_id`)
   └──► catálogo, validación geométrica e informe de interferencias
   │
   ▼  src/model-viewer/ModelViewport.tsx
Visor: capas por disciplina, aislar nivel, corte, despiece, inspector
```

### El prompt no inventa datos

El intérprete solo reconoce un vocabulario acotado. Lo que no puede deducir
lo **pregunta**:

| Enunciado | Resultado |
|---|---|
| «Edificio de 3 niveles, 24 x 18 m, altura libre 3.20 m» | genera |
| «Edificio de 4 niveles con altura libre de 3 m» | pregunta por las dimensiones en planta |
| «Quiero un edificio bonito» | pregunta niveles, dimensiones y alturas |
| «…con dos sótanos y ascensor» | avisa de que no modela sótanos ni ascensores |

Nunca rellena una dimensión ausente con un valor por defecto silencioso.

### El generador rechaza lo imposible

`apply_spec()` no degrada el modelo en silencio: o produce geometría coherente
o explica por qué no puede.

| Solicitud | Respuesta |
|---|---|
| planta de 10 × 10 m | «no admite núcleo central, anillo de circulación y bandas de recintos a la vez» |
| 20 niveles | «este generador cubre hasta 12 niveles» |
| altura libre 3.50 m con 3.60 m entre niveles | «solo quedan 0.10 m para viga y losa» |

Cuando sí puede resolverlo pero tiene que adaptar algo, lo **declara como
ajuste** y la interfaz lo muestra. Por ejemplo, con 3.40 m entre niveles:

> «Escalera ajustada a 9 contrahuellas por tramo de 0.189 m para cerrar
> exactamente los 3.40 m entre niveles.»

### El programa de recintos es procedural

No hay tablas fijas. Las bandas perimetrales se reparten por reglas: los
núcleos húmedos se repiten en la misma posición en todos los niveles para que
los montantes queden alineados, los cuartos técnicos van en el nivel de acceso
y el resto se rellena con recintos del ancho de referencia del tipo.

Si un recinto pedido no cabe, se omite **y se dice**:

> «No cabe laboratorio en la banda EAST del nivel 4; se omite.»

## 3. Qué se ve en el visor

- **Capas por disciplina** — encender y apagar cada una de las siete.
- **Aislar niveles** — ver una planta o un subconjunto.
- **Corte del volumen** — tres planos de recorte ajustables; el interior se lee
  macizo porque los materiales se renderizan a doble cara.
- **Despiece por niveles** — separar las plantas en vertical.
- **Color por material o por disciplina**.
- **Inspector** — al hacer clic en un elemento muestra su `component_id`,
  disciplina, tipo, nivel, material y cuántos parámetros tiene pendientes.

El aspecto se consigue con iluminación por imagen (IBL), mapeo tonal ACES y
materiales físicos por material declarado. **No hay texturas ni mobiliario**:
lo que se ve es la geometría real del modelo.

## 4. Instalación

El generador necesita Python. Una vez:

```bash
./tools/setup_generator.sh
npm run dev
```

El script crea `tools/venv` con lo que el Studio necesita (numpy, shapely,
trimesh, scipy, networkx, mapbox-earcut). La app lo detecta sola.

Con `--full` añade además `ifcopenshell`, `ezdxf`, `reportlab` y `cadquery`,
que son las que usa el paquete de planos (`tools/building_generator/build.py`),
no el Studio.

Si prefieres otro entorno:

```bash
EMBEDVERSE_PYTHON=/ruta/al/python npm run dev
```

> Nota: el Python del sistema en macOS es 3.9, y `reportlab` 5 exige 3.10+. Por
> eso el script fija `reportlab<4.1`, que sí soporta 3.9.

## 5. Seguridad del endpoint

`/api/building/generate` tiene la misma postura que el compilador Arduino, por
la misma razón: **ejecuta un proceso en el host**.

- Solo acepta solicitudes locales del mismo origen (403 en caso contrario).
- Exige `application/json` (415).
- Valida y acota cada campo; rechaza cualquier propiedad que no reconoce.
- `spawn` sin shell, con argumentos fijos.
- Límites: 64 KiB de petición, 180 s de ejecución, 80 MiB de salida.
- Una generación a la vez **en todo el servidor** (429 si hay otra en curso):
  el candado es compartido con `/api/bridge/generate`, porque los dos compiten
  por la misma CPU.

**No es un servicio de producción.** No tiene sandbox del sistema operativo ni
cuota de memoria del proceso. No debe publicarse en una red.

## 6. Alcance y límites

Esto es lo que el módulo **sí** calcula, medido sobre el modelo:

- Geometría tridimensional de todos los componentes.
- Longitud real de cada recorrido (circuitos, tuberías, ductos, cableado),
  medida sobre su polilínea 3D.
- Áreas y perímetros de recinto.
- Interferencias geométricas, clasificadas entre esperadas (pases de muro y
  losa, encuentros constructivos, recorridos compartidos) y accionables.

Esto es lo que **no**:

- No hay cálculo estructural, eléctrico, hidráulico ni térmico.
- Secciones de columna, viga, losa y cimentación son **hipótesis geométricas**,
  no resultados de análisis.
- Calibres, protecciones, capacidades de refrigeración y caudales quedan en
  `null` a propósito, con su motivo declarado.
- No hay revisión profesional. El campo `professionalReview` vale siempre
  `not_reviewed`.
- No modela sótanos, ascensores, cubiertas inclinadas, muros cortina ni
  plantas no rectangulares.
- Rango admitido: 1 a 12 niveles, lados de 15 a 120 m.

**El modelo no es apto para construir, licenciar ni certificar nada.**

## 7. Relación con el paquete de planos

El mismo motor paramétrico alimenta dos salidas:

| Salida | Comando | Qué produce |
|---|---|---|
| Building Studio | pestaña Edificación | GLB + catálogo, para explorar en pantalla |
| Paquete de planos | `python tools/building_generator/build.py <salida>` | IFC4, GLB, OBJ, STEP, 84 láminas DXF/PDF/SVG, dataset |

Son la misma geometría. Un cambio en `params.py` se propaga a ambas.

## 8. Archivos

```text
src/building-studio/
  contracts.ts            BuildingSpecification y conversión a la solicitud
  prompt-interpreter.ts   intérprete determinista en español
  BuildingStudio.tsx      configuración del dominio edificio
src/model-viewer/         compartido con el Bridge Studio
  contracts.ts            resultado de generación, común a los dos dominios
  scene-graph.ts          convenio de nombres del GLB y orden de zonas
  materials.ts            presentación física por material declarado
  ModelViewport.tsx       escena Three.js, capas, corte, despiece
  ModelStudio.tsx         armazón de la interfaz, dirigido por configuración
  model-studio.css        estilos encapsulados
server/
  generatorRuntime.ts     transporte, aislamiento del proceso y límites
  buildingGenerator.ts    validación de la solicitud de edificio
tools/
  setup_generator.sh      preparación del entorno de Python
  building_generator/
    generate_scene.py     punto de entrada del modo escena
    params.py             solicitud, hipótesis y todo lo derivado
```

El visor, el armazón de la interfaz y el núcleo del endpoint son los mismos que
usa el [Bridge Studio](BRIDGE_STUDIO.md). Lo propio de cada dominio es el
vocabulario, el intérprete y la validación de la solicitud.

Pruebas: `npm test` cubre el intérprete, el contrato, el convenio de nombres,
la presentación de materiales y la validación del endpoint.

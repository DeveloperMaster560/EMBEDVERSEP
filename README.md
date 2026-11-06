# EMBEDVERSE STUDIO

Aplicación local-first en etapa inicial para organizar proyectos de sistemas embebidos. En esta versión los proyectos y el código se guardan en IndexedDB del navegador.

## Requisitos

- Node.js 24 o compatible con Vite 8.
- npm.

## Ejecutar en desarrollo

```powershell
npm install
npm run dev
```

Abre la URL local que imprime Vite. Los proyectos no se sincronizan con otros navegadores o dispositivos.

## Comprobaciones

```powershell
npm test
npm run lint
npm run build
npm audit
```

## Arduino Uno y 3D

En Windows, instala el toolchain AVR gratuito si aún no está presente:

```powershell
.\scripts\setup-arduino.ps1
```

Inicia la aplicación con `npm run dev`, abre un proyecto Arduino Uno y pulsa **Compilar**. El `.hex` aparece como descarga en la consola. La API local debe permanecer ligada a localhost; no publiques el servidor Vite en redes no confiables.

En la vista **Gemelo digital 3D**, genera el puente ilustrativo o importa un `.glb`, `.gltf`, `.obj` o `.stl`. Para `.gltf`, selecciona el archivo y sus `.bin`/texturas externos en el mismo selector. Es una visualización; no calcula física estructural.

## Estado de capacidades

El núcleo incluye dashboard, gestión local de proyectos, editor Monaco, compilación real para Arduino Uno, importación/visualización 3D y un laboratorio electrónico editable. El laboratorio permite colocar y mover componentes, conectar pines definidos, editar referencias/valores y validar integridad básica de conexiones. No ejecuta simulación eléctrica ni firmware. ESP32 permanece como placa lógica: su firmware no se compila en este entorno. Consulta [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md), [COMPONENT_LIBRARY.md](COMPONENT_LIBRARY.md) y [SIMULATION_COMPATIBILITY.md](SIMULATION_COMPATIBILITY.md).

El ejemplo Blink está en `examples/arduino-blink/arduino-blink.ino`. El toolchain AVR local se guarda en `.tools/` y no se versiona.

## EMBEDVERSE BUILDING STUDIO

En un proyecto, abre la pestaña **Edificación**. Describe el edificio en español y el
sistema genera un modelo multidisciplinario completo:

```text
Edificio institucional de 3 niveles, longitud 24 m, ancho 18 m,
altura libre 3.20 m y altura entre niveles 3.60 m.
```

produce unos 1.300 componentes de siete disciplinas —estructura, arquitectura, eléctrico,
telecomunicaciones, hidrosanitario, climatización y seguridad— con geometría 3D real,
conexiones entre componentes y validación geométrica.

Requiere Python una sola vez:

```bash
./tools/setup_generator.sh
npm run dev
```

El visor permite encender y apagar disciplinas, aislar niveles, cortar el volumen,
separar las plantas y consultar cualquier componente por su identificador.

El intérprete del enunciado es determinista y local: no usa un modelo de IA ni envía
nada a un servicio externo. Lo que no puede deducir lo pregunta, y lo que no cabe lo
dice en vez de omitirlo en silencio.

El modelo es **geometría conceptual**: no contiene cálculo estructural, eléctrico,
hidráulico ni térmico, no está revisado por un profesional y no es apto para construir.
Alcance y límites completos en [BUILDING_STUDIO.md](BUILDING_STUDIO.md).

El mismo motor produce el expediente de planos (IFC4, GLB, OBJ, STEP y 84 láminas en
DXF/PDF/SVG) con `python tools/building_generator/build.py <directorio>`.

## EMBEDVERSE BRIDGE STUDIO

En un proyecto, abre la pestaña **Puentes**. Es el mismo flujo del Building Studio
aplicado al dominio puente:

```text
Puente de vigas de 90 m de longitud, 10 m de ancho de tablero,
tablero a 7 m sobre el terreno, 3 vanos, 4 vigas principales
y 2 carriles con aceras.
```

produce 138 componentes de siete disciplinas —estructura, tablero, barreras, drenaje,
iluminación, señalización e instrumentación— en poco más de un segundo, con cero errores
de consistencia y cero interferencias que requieran coordinación.

Cubre tres tipologías: vigas, losa y atirantado. Comparte visor, armazón de interfaz y
núcleo del endpoint con la edificación; lo propio del dominio es el vocabulario, el
intérprete y la validación de la solicitud. Requiere el mismo `./tools/setup_generator.sh`.

Igual que en edificación, el modelo es **geometría conceptual**: no contiene cálculo
estructural, hidráulico ni de tráfico, no está revisado por un profesional y no es apto
para construir. Alcance y límites completos en [BRIDGE_STUDIO.md](BRIDGE_STUDIO.md).

## EMBEDVERSE BRIDGE DESIGNER

El módulo de modelado de puentes está organizado en `src/bridge-designer/` y usa Three.js ya incluido en el proyecto. Se abre desde **un proyecto → Modelos 3D** o de forma independiente desde la misma aplicación:

```text
http://localhost:5174/?bridge-designer=1&projectId=bridge-demo&projectName=Puente%20urbano
```

Incluye geometrías paramétricas editables para diez tipologías de puente, primitivas, selección y transformaciones, jerarquía/colecciones, materiales PBR básicos, unidades métricas, nodos ESP32/MPU6050 sin telemetría, importación GLB/glTF/OBJ/STL, exportación GLB, proyectos `.evbridge` y guardado automático en una base IndexedDB separada. No ejecuta análisis estructural ni se conecta a hardware. La escena se puede recuperar al reabrir el mismo ID de proyecto; el `.evbridge` permite respaldo y traslado manual.

Documentación específica: [ARCHITECTURE.md](ARCHITECTURE.md), [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md), [LICENSE_AUDIT.md](LICENSE_AUDIT.md) y [TEST_REPORT.md](TEST_REPORT.md).

## EMBEDVERSE ELECTRONICS LAB

En un proyecto, abre la pestaña **Sistema embebido** para diseñar el montaje editable. La biblioteca incluye placas Arduino Uno/ESP32, MPU6050, resistencia, condensador, LED, pulsador, alimentación y GND. Cablea seleccionando dos terminales; los cables se mantienen unidos al mover o girar componentes. El montaje y la vista esquemática comparten componentes, pines y conexiones, y los cambios se guardan automáticamente en el proyecto local.

El circuito inicial presenta un sistema de monitoreo de vibraciones de referencia con MPU6050 por I²C. Sus dibujos son ilustraciones vectoriales propias, no modelos oficiales ni verificación de diseño. La validación comprueba endpoints/pines, conexiones obligatorias y conflictos básicos de tensión en salidas conocidas de la placa; no calcula corrientes, seguridad ni comportamiento. La simulación permanece deshabilitada.

El laboratorio permite importar paquetes declarativos `.evcl` de componentes, guardados con el proyecto. Incluye una biblioteca básica descargable en la barra lateral y muestra referencias a bibliotecas Arduino cuando están declaradas. Estas referencias no instalan automáticamente código C/C++ ni habilitan simulación: consulta [COMPONENT_LIBRARY.md](COMPONENT_LIBRARY.md) para el alcance y formato.
# EMBEDVERSEP

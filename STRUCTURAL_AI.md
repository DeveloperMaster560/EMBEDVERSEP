# Asistente de diseño estructural — base y límites

## Estado actual

El contrato general sigue siendo independiente del proveedor y contempla la ampliación futura a otras familias, incluidas catedrales. El asistente local genera propuestas conceptuales de puentes de vigas, de losa y atirantados. No se afirma que la aplicación calcule o valide diseños estructurales.

El contrato inicial está en `src/structural-ai/contracts.ts`. Una solicitud separa la descripción del usuario, parámetros y unidades, restricciones y referencias. Los parámetros procedentes de documentos deben identificar una referencia. La propuesta distingue datos especificados, inferidos y desconocidos; permite preguntas pendientes, supuestos, limitaciones y citas con página o sección. El proveedor futuro se conecta mediante `StructuralGenerationProvider`.

Los primeros seis PDF recibidos en `Planos/` están inventariados en [`Planos/LECTURA_DOCUMENTOS.md`](Planos/LECTURA_DOCUMENTOS.md). Es un primer triaje para arquitectura de datos, no una base ya ingerida ni una transcripción verificada. Las fuentes combinan proyectos de México, Colombia, Bolivia y España, además de planos arquitectónicos y material experimental; no son un conjunto de normas universal.

## Flujo previsto

1. El usuario describe la estructura en lenguaje natural o completa parámetros estructurados.
2. El sistema detecta datos faltantes y hace preguntas; no inventa dimensiones ausentes.
3. Las referencias aportadas se registran con atribución y licencia, y se extraen con procedencia hasta página, tabla o detalle.
4. La recuperación de fuentes pertinentes precede a la generación. Las respuestas deben vincular afirmaciones y parámetros a las fuentes o marcarlos como inferidos.
5. El usuario revisa y modifica una propuesta conceptual antes de crear geometría editable.
6. Validadores deterministas separados comprueban unidades, geometría, consistencia y, cuando se implemente, criterios de ingeniería explícitos y versionados.
7. El análisis normativo o estructural requiere motores y revisión de profesionales competentes; una respuesta de un modelo de lenguaje no certifica seguridad ni sirve por sí sola como plano de construcción.

## No entrenar “con todo” sin curación

No es necesario entrenar un modelo desde cero para empezar. Primero conviene un modelo de lenguaje con recuperación aumentada (RAG) sobre un corpus curado y autorizado, más generadores paramétricos deterministas y validadores independientes. Las fuentes deben registrar autoría, entidad, jurisdicción, fecha/versión, licencia, alcance y tipo de evidencia. Planos, normas, artículos y manuales no son intercambiables ni automáticamente reutilizables para entrenamiento.

El repositorio ya contiene un corpus inicial en `Planos/`. [`Planos/LECTURA_DOCUMENTOS.md`](Planos/LECTURA_DOCUMENTOS.md) registra el inventario, el tipo de fuente y sus cautelas: incluye una guía de puentes de concreto, un proyecto de puente metálico, planos de un estudio de infraestructura, un anexo de modelos experimentales y documentación arquitectónica. Este inventario sirve para organizar la ingesta, pero todavía no es un conjunto de parámetros extraídos y verificados. Antes de incorporar un dato hay que confirmar la página, la unidad, el elemento al que aplica, el contexto del proyecto y los permisos de uso. No se deben cargar planos protegidos a un servicio externo sin revisar permisos y privacidad; se conserva la atribución y se evita reproducir documentos completos.

## Evaluación antes de ampliar

- Casos de referencia revisados por profesionales de puentes y arquitectura/estructuras.
- Exactitud de extracción de dimensiones, unidades y citas; medición por documento y tipo de dato.
- Pruebas adversariales para datos contradictorios, faltantes, escalas ambiguas y documentos ilegibles.
- Verificación geométrica y dimensional determinista contra resultados esperados.
- Evaluación de cobertura de preguntas y tasa de afirmaciones sin respaldo.
- Registro de versión de modelo, prompt, corpus, reglas y resultados para reproducibilidad.
- Umbrales de abstención: pedir aclaración o declarar incompatibilidad cuando no hay fuentes suficientes.

## Asistente local sin IA externa

El Bridge Designer usa `src/bridge-designer/local-bridge-interpreter.ts` para reconocer un conjunto explícito de expresiones en español sobre tipología, dimensiones y apoyos. Convierte unidades métricas, valida el resultado mediante `BridgeSpecification` y pregunta por los datos que faltan o son ambiguos. Esta implementación es un intérprete determinista de reglas; no es un modelo entrenado, no aprende automáticamente y no envía texto a ningún proveedor. El endpoint Gemini anterior ya no forma parte del flujo de la aplicación.

El vocabulario reconocido es intencionalmente limitado. Por ejemplo, reconoce medidas acompañadas por unidades (`30 m`, `800 cm`, `2500 mm`), referencias de longitud/ancho/altura, puentes de vigas o losa, puentes atirantados y cantidades sencillas de apoyos. Para las solicitudes atirantadas reconoce además altura y separación de torres, secciones, cantidad/diámetro de tirantes, número y sección de vigas, separación y sección de vigas transversales, dimensiones de zapatas y altura de barandas. Los valores explícitos se presentan en el formulario y alimentan el generador paramétrico; los ausentes quedan como supuestos geométricos editables, no como datos extraídos de `Planos/` ni como diseño de ingeniería.

La geometría se genera localmente en `src/bridge-designer/scene.ts` como objetos editables organizados por componentes. El puente atirantado usa torres, cables cilíndricos, tablero, vigas, apoyos y cimentaciones con materiales cian semitransparentes; el viewport mantiene el fondo oscuro y la cuadrícula, y ofrece wireframe. El modelador puede exportar vistas vectoriales conceptuales (planta, alzado y sección) a SVG o imprimirlas/guardarlas como PDF. Estas láminas no incluyen cotas verificadas, armaduras, cálculos, notas constructivas ni aprobación profesional. Las dimensiones de piezas no especificadas usan proporciones heurísticas; se muestran como supuestos, no como cálculos. El análisis documental automático, RAG y las citas de páginas de `Planos/` no están implementados. Toda salida sigue siendo conceptual y no apta para construcción sin diseño y revisión profesional.

## Fuera de alcance actualmente

No hay ingesta automatizada ni gestión de planos dentro de la aplicación, RAG, entrenamiento de modelos, generación de catedrales, análisis por elementos finitos, cumplimiento normativo ni planos ejecutivos. La carpeta `Planos/` es una fuente local sin procesar por el asistente. Las tipologías colgante, en arco y de cercha no forman parte del asistente local aunque existan opciones manuales heredadas. El motor y la UI deben mostrar esta distinción sin presentar geometría ilustrativa como diseño validado.

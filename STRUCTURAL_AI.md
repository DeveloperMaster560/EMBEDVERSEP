# Asistente de diseño estructural — base y límites

## Estado actual

El contrato general sigue siendo independiente del proveedor y contempla la ampliación futura a otras familias, incluidas catedrales. El MVP conectado actualmente se limita a puentes conceptuales de vigas y de losa. No se incorporó un corpus documental y no se afirma que la aplicación genere o valide diseños estructurales.

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

Los documentos del usuario aún no están disponibles. Cuando se entreguen, se podrán inventariar, clasificar, extraer y citar antes de incorporarlos. No se deben cargar planos protegidos a un servicio externo sin revisar permisos y privacidad. El sistema debe conservar la fuente original y su atribución, y evitar reproducir documentos completos.

## Evaluación antes de ampliar

- Casos de referencia revisados por profesionales de puentes y arquitectura/estructuras.
- Exactitud de extracción de dimensiones, unidades y citas; medición por documento y tipo de dato.
- Pruebas adversariales para datos contradictorios, faltantes, escalas ambiguas y documentos ilegibles.
- Verificación geométrica y dimensional determinista contra resultados esperados.
- Evaluación de cobertura de preguntas y tasa de afirmaciones sin respaldo.
- Registro de versión de modelo, prompt, corpus, reglas y resultados para reproducibilidad.
- Umbrales de abstención: pedir aclaración o declarar incompatibilidad cuando no hay fuentes suficientes.

## MVP de generación de puentes

`src/bridge-designer/ai-contracts.ts` valida la especificación `BridgeSpecification`; `server/bridgeAi.ts` conecta Gemini mediante `@google/genai` y el modelo `gemini-3.8-flash` en el backend Vite. El endpoint `POST /api/ai/bridge/interpret` devuelve interpretación, preguntas, supuestos y advertencias; la clave se lee solo desde `GEMINI_API_KEY` del proceso servidor. `GET /api/ai/bridge/status` informa únicamente si la clave está configurada, no prueba conectividad con Google. Las solicitudes de interpretación están limitadas a origen local y el usuario solo genera después de revisar y aprobar los parámetros.

La geometría se genera localmente en `src/bridge-designer/scene.ts` como objetos independientes y editables, reutilizando el viewport existente. El MVP permite puentes de vigas y de losa; pregunta si faltan dimensiones, referencia de altura o distribución de apoyos. Los componentes sin dimensiones indicadas pueden recibir dimensiones geométricas proporcionales heurísticas, que se muestran como supuestos y no equivalen a dimensiones calculadas.

Para configurar Gemini, copia `.env.example` a `.env.local`, establece `GEMINI_API_KEY` allí y reinicia Vite. No uses el prefijo `VITE_` ni compartas la clave. Inicia el servidor con `npm run dev`. Sin la clave, el backend devuelve un error explícito y no genera una interpretación de sustitución.

## Fuera de alcance actualmente

No hay gestión de planos, RAG, generación de catedrales, análisis por elementos finitos, cumplimiento normativo ni planos ejecutivos. Las tipologías atirantadas, colgantes, en arco y de cercha no forman parte del generador de IA aunque existan opciones manuales heredadas. El motor y la UI deben mostrar esta distinción sin presentar geometría ilustrativa como diseño validado.

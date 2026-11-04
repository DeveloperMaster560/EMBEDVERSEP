# Primera lectura del corpus de Planos

Inventario local para la preparación del asistente de diseño estructural. La revisión identifica el tipo de fuente y su posible uso; no es una extracción certificada de planos, transcripción completa, ni evaluación de cumplimiento. Los números de página indicados son páginas PDF, salvo indicación expresa.

## Fuentes recibidas

| Archivo | Identificación y alcance observado | Posible uso | Cautelas |
|---|---|---|---|
| `Guia_de_Puentes.pdf` | 279 páginas. *Guía de detalles de Proyectos de Puentes y Estructuras similares de Concreto*, asociada a SICOM/Guanajuato; el PDF presenta detalles, láminas, materiales, super/subestructura, refuerzo, apoyos y cantidades. | Referencia principal para estructurar categorías de datos de proyectos de puentes de concreto y localizar ejemplos de láminas/detalles. | Documento de una jurisdicción y edición concretas; no tratar sus criterios como código universal vigente. Varias páginas son gráficos con poco texto extraíble. Confirmar edición, autoridad y licencia. |
| `Planos puente peñas.pdf` | 17 páginas. Proyecto Puente Peñas en Colombia; índice y especificaciones, proceso constructivo, geometría, estribos/anclajes, vigas metálicas, conexiones, tablero y detalles. | Caso de estudio de puente metálico, composición de láminas y relaciones entre geometría, materiales y elementos. | Diseño de un proyecto específico; no generalizar sus valores a otros sitios o códigos. Verificar permisos y vigencia de especificaciones citadas. |
| `11780608_01.pdf` | 22 páginas. Planos del estudio de diseño básico de equipamiento para desarrollo rural en La Paz, Bolivia (JICA / Pacific Consultants International, diciembre de 2004). El índice combina caminos, obras de arte, canales y planos de varios puentes. | Ejemplos de organización de un juego de planos de infraestructura y de cómo localizar hojas de puentes dentro de un paquete mixto. | Muchas páginas son láminas gráficas sin texto extraíble; fecha y contexto antiguos. No asumir que todas las hojas del paquete son puentes. |
| `12hsr12de21.pdf` | 16 páginas; anexo impreso 179–194, “Planos de modelos de puente”. Describe vigas de hormigón armado/pretensado, secciones, pórticos de carga, instrumentación y ensayos. | Fuente experimental útil para relacionar espécimen, geometría, condiciones de carga e instrumentación; potencialmente para validar extracción de datos de ensayos. | Son modelos de laboratorio, no un puente de servicio ni una receta de diseño. Mantener por separado dato experimental y detalle constructivo. |
| `PLANOS 1.pdf` | 67 páginas. Juego de planos de arquitectura/conservación de patrimonio del Ayuntamiento de Madrid, con índice que separa referencias, estado actual, arquitectura, instalaciones y estructura; se observan también detalles estructurales. | Ejemplo de documentación arquitectónica y coordinación entre disciplina, vistas, niveles y detalles de edificio. | Jurisdicción y tipo de intervención específicos (patrimonio); no asumir permisos, licencia de reproducción ni aplicación a edificios nuevos. |
| `PLANO 3 35-12.pdf` | 32 páginas. Juego de planos con levantamiento/topografía y planos arquitectónicos y de acabados de un complejo/asilo; incluye áreas y detalles de espacios. | Ejemplo de extracción de plantas, secciones, niveles, usos y elementos espaciales arquitectónicos. | El sello “Autodesk Educational Product” aparece en las láminas; aclarar procedencia y derechos antes de uso en corpus o entrenamiento. No asumir que contiene cálculo estructural verificable. |

**Extensión conocida:** 433 páginas PDF en total. Cinco archivos tienen recuento verificado por extracción PDF; `PLANOS 1.pdf` se identificó con 67 páginas. La lectura de texto extraíble confirma que hay fuentes mixtas: algunas digitales, otras principalmente rasterizadas/vectoriales. La extracción textual no recupera de manera fiable todas las cotas ni notas de CAD.

## Hallazgos para el diseño del sistema

1. El corpus no es homogéneo: contiene normas/guías de una administración, proyectos ejecutivos, diseños básicos, documentación arquitectónica y esquemas de experimentos. Cada fuente debe etiquetarse por jurisdicción, disciplina, estado del diseño, fecha, unidad, tipo de estructura y nivel de autoridad.
2. No todas las fuentes aportan las mismas clases de datos. Una planta arquitectónica ayuda a reconocer espacios y relaciones; una lámina de armado contiene detalles materiales y de refuerzo; un ensayo de laboratorio aporta condiciones medidas. No mezclar estos datos como si fueran intercambiables.
3. Las cotas recuperadas por OCR o extracción se deben conservar como candidatos con página, región, unidad, método y confianza; nunca convertir automáticamente una cota ambigua en un parámetro de diseño definitivo.
4. Antes de indexar cada PDF se debe revisar origen, autoría, licencia y permiso de uso. La posesión de una copia no implica permiso para entrenar un modelo con su contenido.
5. El corpus actual es mayoritariamente de puentes y edificios generales; no contiene una base suficiente para generar catedrales, ni para afirmar cobertura de todas las estructuras civiles.

## Siguiente ingestión recomendada

- Mantener los originales intactos y generar derivados por página con identificadores de fuente estables.
- Extraer texto y metadatos primero; aplicar OCR/render de alta resolución solo a páginas que lo requieran y conservar el número de página original.
- Registrar cada observación con cita verificable (archivo, página PDF y, si difiere, página impresa), región de la lámina, unidad, disciplina, procedencia y confianza.
- Separar extracción documental, recuperación RAG, propuesta de parámetros y generador geométrico. No “entrenar con todo” ni convertir directamente medidas OCR en geometría.
- Validar cualquier esquema extraído con revisión humana y un conjunto de ejemplos anotados antes de usarlo para generación. La guía y los proyectos aquí listados no sustituyen códigos locales, estudio de sitio, análisis ni firma profesional.

## Límite de esta lectura

Esta primera pasada usó metadatos, índices/texto seleccionados y vistas previas de algunas hojas. La baja legibilidad y páginas escaneadas exigen una revisión hoja por hoja antes de recopilar parámetros. No se calcularon dimensiones de diseño, cargas, capacidades ni cumplimiento normativo a partir de estos documentos.

"""Generacion del README del expediente.

El README se escribe desde los datos reales del paquete (conteos, volumenes,
resultados de validacion), no desde texto fijo, para que no pueda afirmar algo
distinto de lo que contienen los archivos.
"""

from __future__ import annotations

import os
from typing import Any, Dict, List, Sequence

import params as P


def write_readme(model, sheets: Sequence, geo: Dict[str, Any], clash: Dict[str, Any],
                 cons: Dict[str, Any], rev: Dict[str, Any], fmt: Dict[str, Any],
                 manifest: Dict[str, Any], generation_date: str, path: str) -> str:
    L: List[str] = []
    A = L.append

    counts = model.counts()
    by_type = model.counts_by_type()
    pend_total = sum(len(c.requires_calculation) for c in model.components.values())
    nulls = sum(1 for c in model.components.values()
                for v in c.parameters.values() if v is None)

    A("# %s" % P.PROJECT_ID)
    A("")
    A("**%s**" % P.PROJECT_NAME)
    A("")
    A("Version %s · Generado el %s · Unidades: metros" % (P.PROJECT_VERSION, generation_date))
    A("")
    A("---")
    A("")
    A("## 0. Advertencia de alcance (leer antes de usar el paquete)")
    A("")
    A("Este expediente es **geometria conceptual generada automaticamente**. Sirve como")
    A("conjunto de datos y como caso de prueba. **No es un proyecto de ingenieria.**")
    A("")
    A("- No contiene calculo estructural, electrico, hidraulico ni termico.")
    A("- No ha sido revisado ni aprobado por un profesional competente.")
    A("- No verifica ninguna norma de ninguna jurisdiccion.")
    A("- **No es apto para construir, licenciar ni certificar nada.**")
    A("")
    A("Donde falta un dato, el paquete escribe `null` y lo enumera en")
    A("`requires_calculation`. **`null` significa \"no determinado\", nunca \"cero\".**")
    A("Hay %s parametros nulos conservados y %s declaraciones de parametro pendiente."
      % ("{:,}".format(nulls), "{:,}".format(pend_total)))
    A("")
    A("## 1. Descripcion del edificio")
    A("")
    A("| Parametro | Valor | Procedencia |")
    A("|---|---|---|")
    A("| Uso | %s | solicitud |" % P.REQ_BUILDING_USE)
    A("| Niveles | %d | solicitud |" % P.REQ_LEVEL_COUNT)
    A("| Longitud (X) | %.2f m | solicitud |" % P.REQ_LENGTH_X)
    A("| Ancho (Y) | %.2f m | solicitud |" % P.REQ_WIDTH_Y)
    A("| Altura libre por piso | %.2f m | solicitud |" % P.REQ_CLEAR_HEIGHT)
    A("| Altura entre niveles | %.2f m | solicitud |" % P.REQ_FLOOR_TO_FLOOR)
    A("| Area por nivel | %.2f m2 | solicitud |" % P.REQ_AREA_PER_LEVEL)
    A("| Area construida | %.2f m2 | solicitud |" % P.REQ_TOTAL_AREA)
    A("| Sistema estructural | %s | hipotesis conceptual |" % P.REQ_STRUCTURAL_SYSTEM)
    A("| Cubierta | %s | solicitud |" % P.REQ_ROOF)
    A("| Escaleras | %s | solicitud |" % P.REQ_STAIR_POSITION)
    A("| Rejilla | %d x %d ejes, vanos de 6.00 m | derivada |"
      % (len(P.GRID_X), len(P.GRID_Y)))
    A("| Canto viga+losa | %.2f m | hipotesis |" % P.HYP_STRUCTURAL_DEPTH)
    A("| Nucleo central | %.2f x %.2f m centrado | hipotesis |" % P.HYP_CORE_SIZE)
    A("")
    A("La altura libre es coherente por construccion: `%.2f - %.2f = %.2f m`."
      % (P.REQ_FLOOR_TO_FLOOR, P.HYP_STRUCTURAL_DEPTH, P.REQ_CLEAR_HEIGHT))
    A("La escalera cierra exacto: `%d contrahuellas x %.3f m x %d tramos = %.2f m`."
      % (P.HYP_STAIR_RISERS_PER_FLIGHT, P.HYP_STAIR_RISER,
         P.HYP_STAIR_FLIGHTS_PER_LEVEL, P.REQ_FLOOR_TO_FLOOR))
    A("")
    A("### Niveles")
    A("")
    A("| Nivel | Cota | Altura libre |")
    A("|---|---|---|")
    for lv in P.ALL_LEVELS:
        A("| %s %s | %+0.2f m | %s |"
          % (lv["level_id"], lv["name"], lv["elevation"],
             ("%.2f m" % lv["clear_height"]) if lv.get("clear_height") else "-"))
    A("")
    A("## 2. Disciplinas incluidas")
    A("")
    A("| Disciplina | Componentes | Conexiones |")
    A("|---|---:|---:|")
    for d in sorted(counts):
        A("| %s | %d | %d |" % (d, counts[d], len(model.connections_of_discipline(d))))
    A("| **Total** | **%d** | **%d** |" % (len(model.components), len(model.connections)))
    A("")
    A("Espacios: %d · Solidos: %d · Operaciones registradas: %d"
      % (len(model.spaces), len(model.solids), len(model.oplog)))
    A("")
    A("<details><summary>Desglose por tipo de componente</summary>")
    A("")
    A("| Disciplina / tipo | Cantidad |")
    A("|---|---:|")
    for k in sorted(by_type):
        A("| %s | %d |" % (k, by_type[k]))
    A("")
    A("</details>")
    A("")
    A("## 3. Archivos entregados")
    A("")
    A("| Formato | Archivos | Tamano | Verificados |")
    A("|---|---:|---:|---:|")
    for ext, d in fmt["delivered"].items():
        A("| %s | %d | %.1f MB | %d |"
          % (ext.upper(), d["files"], d["bytes"] / 1e6, d["verified"]))
    A("")
    A("### Modelo 3D")
    A("")
    A("- `02_3D_MODEL/building.ifc` — IFC4. %d productos con geometria en %d niveles."
      % (_f(manifest, "building.ifc", "products_with_geometry"),
         _f(manifest, "building.ifc", "storeys")))
    A("  Prismas como `IfcExtrudedAreaSolid`; tuberias, ductos y revoluciones como")
    A("  `IfcTriangulatedFaceSet`. Cada producto lleva un `Pset` con sus parametros y")
    A("  sus pendientes.")
    A("- `02_3D_MODEL/building.glb` — glTF 2.0 binario, %d nodos, %s triangulos, con"
      % (_f(manifest, "building.glb", "nodes_written"),
         "{:,}".format(_f(manifest, "building.glb", "triangles") or 0)))
    A("  jerarquia `disciplina__nivel__componente` para mostrar y ocultar capas.")
    A("- `02_3D_MODEL/building.obj` — malla unica concatenada.")
    A("- `02_3D_MODEL/building.step` — B-rep exacto de estructura y arquitectura")
    A("  (%d componentes, %d solidos al releer, %.2f m3). En STEP los cilindros son"
      % (_f(manifest, "building.step", "components_written"),
         _f(manifest, "building.step", "solids_on_reopen"),
         _f(manifest, "building.step", "volume_on_reopen_m3") or 0.0))
    A("  superficies exactas, no teseladas.")
    A("- `02_3D_MODEL/geometry/*.glb` — una malla por disciplina.")
    A("- `02_3D_MODEL/geometry/solids.json` — receta parametrica de cada solido.")
    A("")
    A("### Planos")
    A("")
    A("%d laminas, cada una en **DXF + PDF + SVG**, en `11_DRAWINGS/`." % len(sheets))
    A("Los archivos de dibujo se guardan **una sola vez** en `11_DRAWINGS/`; cada carpeta")
    A("de disciplina incluye un `drawings.json` que apunta a ellos. Asi no hay bytes")
    A("duplicados en el dataset.")
    A("")
    A("| Disciplina | Laminas |")
    A("|---|---:|")
    per_disc: Dict[str, int] = {}
    for sh in sheets:
        per_disc[sh.discipline] = per_disc.get(sh.discipline, 0) + 1
    for k in sorted(per_disc):
        A("| %s | %d |" % (k, per_disc[k]))
    A("")
    A("Convenio de unidades por formato:")
    A("")
    A("- **DXF** R2018, **1 unidad = 1 metro**: el plano es medible a tamano real en CAD.")
    A("  El marco y el cajetin se convierten a metros segun la escala de la lamina.")
    A("- **PDF** vectorial a tamano real de lamina (A1, 841 x 594 mm).")
    A("- **SVG** vectorial en milimetros de lamina.")
    A("")
    A("Las tres salidas de una lamina proceden de la **misma lista de primitivas**, con las")
    A("cotas ya expandidas a geometria. Por eso coinciden entidad a entidad; el manifiesto")
    A("registra ese contraste en `MANIFEST.json` → `verification[].entities_match`.")
    A("")
    A("### DWG")
    A("")
    A("**No se entrega DWG.** %s" % fmt["formats"]["DWG"]["reason"])
    A("")
    A("Alternativa entregada: %s" % fmt["formats"]["DWG"]["alternative"])
    A("")
    A("Para habilitarlo: %s" % fmt["formats"]["DWG"]["how_to_enable"])
    A("")
    A("## 4. Estructura del dataset")
    A("")
    A("```text")
    A("%s/" % P.PROJECT_ID)
    A("  01_INPUT/              solicitud, especificaciones e hipotesis declaradas")
    A("  02_3D_MODEL/           IFC4, GLB, OBJ, STEP y mallas por disciplina")
    A("  03_ARCHITECTURE/       espacios por planta, alzados y cortes")
    A("  04_STRUCTURE/          plantas estructurales, componentes y conexiones")
    A("  05_ELECTRICAL/         iluminacion, tomacorrientes, circuitos y diagramas")
    A("  06_TELECOMMUNICATIONS/ red, wifi y topologia")
    A("  07_HYDROSANITARY/      agua, desagues e isometricos")
    A("  08_HVAC/               ductos, equipos y ventilacion")
    A("  09_SECURITY/           camaras, alarmas y proteccion contra incendios")
    A("  10_PROCEDURES/         operaciones geometricas, creacion y relaciones")
    A("  11_DRAWINGS/           pdf, dxf, svg y metadatos por lamina")
    A("  12_VALIDATION/         geometria, consistencia, colisiones y revision")
    A("  13_DATASET/            anotaciones, etiquetas, grafo y metadatos de entrenamiento")
    A("  MANIFEST.json          inventario con verificacion archivo a archivo")
    A("  README.md              este documento")
    A("```")
    A("")
    A("La clave de union entre todas las modalidades es **`component_id`**: aparece en el")
    A("IFC (`Tag` y `Pset`), en los nombres de nodo del GLB, en los CSV, en las")
    A("anotaciones, en el grafo y en los procedimientos.")
    A("")
    A("## 5. Procedimientos utilizados")
    A("")
    A("El paquete no guarda solo el resultado. `10_PROCEDURES/` conserva la cadena")
    A("completa para cada componente:")
    A("")
    A("```text")
    A("SOLICITUD -> PARAMETROS -> PROCEDIMIENTO -> GEOMETRIA -> PLANOS")
    A("```")
    A("")
    A("- `geometry_operations.json` — %d operaciones en orden, cada una con sus entradas,"
      % len(model.oplog))
    A("  sus salidas, la constante de `params.py` de la que deriva y como se ejecuto.")
    A("- `component_creation.json` — la cadena anterior agrupada por componente.")
    A("- `relationships.json` — grafo de relaciones y conexiones.")
    A("")
    A("Operaciones por categoria:")
    A("")
    A("| Categoria | Cantidad |")
    A("|---|---:|")
    for k, v in model.oplog.counts_by_category().items():
        A("| %s | %d |" % (k, v))
    A("")
    A("Operaciones por tipo:")
    A("")
    A("| Operacion | Cantidad |")
    A("|---|---:|")
    for k, v in model.oplog.counts_by_operation().items():
        A("| %s | %d |" % (k, v))
    A("")
    A("### Como se generan los planos desde el modelo")
    A("")
    A("No hay planos independientes del modelo. Cada vista se **calcula** sobre los mismos")
    A("solidos parametricos:")
    A("")
    A("| Vista | Como se obtiene |")
    A("|---|---|")
    A("| Planta | seccion horizontal a 1.20 m + proyeccion de lo que queda por encima |")
    A("| Alzado | silueta ortografica sobre un plano vertical |")
    A("| Corte | interseccion con un plano vertical |")
    A("| Isometrico | proyeccion axonometrica de aristas (elev. 30, azimut 45) |")
    A("| Detalle | la misma planta o corte restringido a una ventana |")
    A("| Diagramas | recorrido del grafo de conexiones del catalogo |")
    A("")
    A("Un cambio en `params.py` se propaga a la vez al modelo 3D y a todas las laminas.")
    A("")
    A("## 6. Validaciones realizadas")
    A("")
    A("El paquete distingue tres niveles y solo puede afirmar el primero:")
    A("")
    A("| Nivel | Estado | Quien |")
    A("|---|---|---|")
    A("| Validacion geometrica | **realizada** | automatica (`12_VALIDATION/`) |")
    A("| Revision tecnica | no realizada | requiere calculo de ingenieria |")
    A("| Aprobacion profesional | no realizada | requiere profesional competente |")
    A("")
    A("### Geometria")
    A("")
    A("- Solidos: %d · Volumen de materia: %.2f m3 · Volumen de referencia (espacios): %.2f m3"
      % (geo["solid_count"], geo["material_volume_m3"], geo["reference_volume_m3"]))
    A("- Concreto estructural medido sobre el modelo: %.2f m3"
      % geo["structural_concrete_volume_m3"])
    A("- Envolvente: de %s a %s"
      % (geo["bounding_box_min"], geo["bounding_box_max"]))
    A("- Solidos degenerados: %d" % len(geo["degenerate_solids"]))
    A("")
    A("### Consistencia")
    A("")
    A("%d comprobaciones, **%d errores** y %d avisos."
      % (cons["checks_run"], cons["errors"], cons["warnings"]))
    A("")
    A("| Comprobacion | Resultado |")
    A("|---|---|")
    for r in cons["results"]:
        A("| %s | %s |" % (r["check"], "OK" if r["passed"] else r["severity"].upper()))
    A("")
    A("### Colisiones geometricas")
    A("")
    A("%d interferencias detectadas entre %d solidos (%s pares candidatos)."
      % (clash["clash_count"], clash["solids_analyzed"],
         "{:,}".format(clash["candidate_pairs_tested"])))
    A("")
    A("| Clasificacion | Cantidad | Interpretacion |")
    A("|---|---:|---|")
    for k, v in clash["by_severity"].items():
        A("| %s | %d | %s |" % (k, v, clash["interpretation"].get(k, "")))
    A("")
    A("Los **pases de muro** y los **encuentros constructivos** son esperados. Las")
    A("**colisiones estructurales**, si las hay, señalan trazados que habria que")
    A("recoordinar antes de cualquier uso real.")
    A("")
    A("## 7. Limitaciones")
    A("")
    for lim in [
        "Una sola muestra de edificio: sin variacion tipologica, climatica ni normativa.",
        "Las secciones de columna, viga, losa y cimentacion son hipotesis geometricas, "
        "no resultados de analisis estructural.",
        "Las instalaciones siguen trazados ortogonales simples en el vacio tecnico; no son "
        "soluciones optimizadas de obra.",
        "No hay refuerzo, despiece, acabados, texturas ni detalle constructivo.",
        "Los isometricos no eliminan lineas ocultas.",
        "En GLB y OBJ las superficies curvas estan teseladas a %d segmentos; solo el STEP "
        "las conserva exactas." % 16,
        "Las clases del dataset estan muy desbalanceadas.",
        "La carpeta `Planos/` del repositorio NO se ha leido ni incorporado.",
    ]:
        A("- %s" % lim)
    A("")
    A("## 8. Parametros pendientes")
    A("")
    A("%d componentes declaran al menos un parametro pendiente; en total %d declaraciones."
      % (sum(1 for c in model.components.values() if c.requires_calculation), pend_total))
    A("El listado completo esta en `12_VALIDATION/pending_parameters.csv`.")
    A("")
    A("| Disciplina | Parametros distintos pendientes |")
    A("|---|---:|")
    for d in sorted(rev["by_discipline"]):
        A("| %s | %d |" % (d, rev["by_discipline"][d]["distinct_pending_parameters"]))
    A("")
    A("### Bloqueos de proyecto")
    A("")
    A("| Parametro | Disciplina | Bloqueado por |")
    A("|---|---|---|")
    for p in P.PENDING_PARAMETERS:
        A("| %s | %s | %s |" % (p["parameter"], p["discipline"], p["blocked_by"]))
    A("")
    A("### Que si esta calculado")
    A("")
    A("Para que la distincion quede clara, esto **si** son valores reales derivados del")
    A("modelo y no hipotesis:")
    A("")
    A("- Todas las longitudes de recorrido (circuitos, tuberias, ductos, cableado), medidas")
    A("  sobre la polilinea 3D de cada trazado.")
    A("- Todas las areas y perimetros de recinto, medidos sobre la geometria.")
    A("- Todos los volumenes de material, medidos sobre la malla.")
    A("- La potencia conectada por circuito, por suma aritmetica de potencias nominales")
    A("  declaradas como hipotesis de seleccion.")
    A("- La corriente de los circuitos de alumbrado y tomacorrientes, derivada de")
    A("  `P / (V x fp)` con `fp = %.2f` declarado. **No es una medicion.**" % P.HYP_POWER_FACTOR)
    A("- Las cotas de llegada de los desagues, deducidas de la longitud horizontal y la")
    A("  pendiente adoptada del %.1f %%." % (P.HYP_DRAIN_SLOPE * 100))
    A("")
    A("## 9. Dependencias y licencias")
    A("")
    A("| Herramienta | Version | Licencia | Uso |")
    A("|---|---|---|---|")
    for t in fmt.get("tooling", []) or []:
        A("| %s | %s | %s | %s |" % (t["name"], t["version"], t["license"], t["use"]))
    A("")
    A("Todo el contenido geometrico y de datos fue generado por el codigo de")
    A("`tools/building_generator/`. No se copio contenido de normas ni de documentos de")
    A("terceros.")
    A("")
    A("## 10. Como importar los datos en EMBEDVERSE AI")
    A("")
    A("1. **Catalogo e etiquetas**: cargar `13_DATASET/annotations.json` (un registro por")
    A("   componente, con etiquetas, envolvente, volumen, parametros y nulos) y")
    A("   `13_DATASET/component_labels.json` (espacios de etiquetas y conteos).")
    A("2. **Grafo**: cargar `13_DATASET/relationships.json`. Los arcos `connected_to`")
    A("   llevan medio, tecnologia, longitud y sentido de flujo.")
    A("3. **Procedimientos**: cargar `10_PROCEDURES/component_creation.json` para la")
    A("   supervision de la cadena solicitud → parametros → procedimiento → geometria.")
    A("4. **Geometria**: `02_3D_MODEL/building.glb` para visualizar y rasterizar vistas;")
    A("   `building.ifc` para la semantica BIM; `geometry/solids.json` si se quiere")
    A("   aprender la receta parametrica en lugar de la malla.")
    A("5. **Planos**: `11_DRAWINGS/metadata/sheet_index.json` lista cada lamina con su")
    A("   escala, su tipo de vista y sus tres archivos. El SVG es el mas comodo para")
    A("   rasterizar o para aprender primitivas vectoriales.")
    A("6. **Union**: todas las modalidades comparten `component_id`. Las laminas se")
    A("   relacionan con los componentes mediante `drawing_reference` en el catalogo y")
    A("   `referenced_solids` en los metadatos de lamina.")
    A("")
    A("### Lo que este dataset NO puede ensenar")
    A("")
    A("- Criterios de diseno estructural, electrico, hidraulico o termico: no estan en los datos.")
    A("- Cumplimiento normativo: no se ha verificado ninguna norma.")
    A("- Calibres, protecciones, capacidades o caudales: son `null` a proposito.")
    A("")
    A("Un modelo entrenado con esto puede aprender **como se organiza y se describe** un")
    A("edificio y **como se construye su geometria**. No puede aprender a dimensionarlo.")
    A("")
    A("## 11. Reproducir el paquete")
    A("")
    A("```bash")
    A("cd tools/building_generator")
    A("python build.py <directorio_de_salida>")
    A("```")
    A("")
    A("La generacion es determinista: sin reloj ni aleatoriedad en la geometria. Dos")
    A("ejecuciones producen los mismos archivos salvo el campo `generated_on`.")
    A("")
    A("---")
    A("")
    A("*Generado automaticamente por el generador parametrico EMBEDVERSE el %s.*"
      % generation_date)
    A("*Estado: %s.*" % rev["status"])
    A("")

    text = "\n".join(L)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)
    return path


def _f(manifest: Dict[str, Any], filename: str, key: str) -> Any:
    for f in manifest.get("files", []):
        if f.get("path", "").endswith(filename):
            return f.get(key)
    return None

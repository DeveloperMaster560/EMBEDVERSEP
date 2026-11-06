"""Exportacion de informacion estructurada: JSON, CSV y dataset de entrenamiento.

Criterios aplicados en todos los archivos:

  * Los valores None se CONSERVAN en JSON como null y en CSV como la cadena
    vacia, con una columna adicional que enumera los parametros pendientes.
    Nunca se sustituyen por ceros ni por valores inventados.
  * Cada registro declara su procedencia (`provenance`) y su estado de
    validacion, y repite que no existe revision profesional.
  * Los archivos son deterministas salvo el campo de fecha de generacion.
"""

from __future__ import annotations

import csv
import json
import os
from typing import Any, Dict, Iterable, List, Optional, Sequence

import params as P

JSON_KW = {"ensure_ascii": False, "indent": 2, "sort_keys": False}


def _json_default(o: Any) -> Any:
    """Convierte tipos de numpy y shapely a tipos nativos de Python.

    La geometria se calcula con numpy, de modo que muchos valores son
    numpy.float64 o numpy.bool_. Sin esta conversion el volcado a JSON falla.
    """
    import numpy as _np

    if isinstance(o, (_np.bool_,)):
        return bool(o)
    if isinstance(o, _np.integer):
        return int(o)
    if isinstance(o, _np.floating):
        return float(o)
    if isinstance(o, _np.ndarray):
        return o.tolist()
    if isinstance(o, (set, frozenset)):
        return sorted(o)
    if hasattr(o, "item"):
        try:
            return o.item()
        except Exception:
            pass
    raise TypeError("no serializable a JSON: %r" % type(o))


def write_json(path: str, data: Any) -> Dict[str, Any]:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(data, fh, default=_json_default, **JSON_KW)
        fh.write("\n")
    with open(path, "r", encoding="utf-8") as fh:
        json.load(fh)                      # verificacion por relectura
    return {"path": path, "bytes": os.path.getsize(path), "verified_by_reload": True}


def write_csv(path: str, headers: Sequence[str], rows: Iterable[Sequence[Any]]) -> Dict[str, Any]:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    n = 0
    with open(path, "w", encoding="utf-8", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(headers)
        for r in rows:
            w.writerow(["" if v is None else v for v in r])
            n += 1
    with open(path, "r", encoding="utf-8", newline="") as fh:
        back = list(csv.reader(fh))
    ok = len(back) == n + 1 and back[0] == list(headers)
    return {"path": path, "rows": n, "bytes": os.path.getsize(path),
            "verified_by_reload": ok}


def _flat(v: Any) -> Any:
    if isinstance(v, (list, tuple)):
        return "; ".join(str(x) for x in v)
    if isinstance(v, dict):
        return json.dumps(v, ensure_ascii=False)
    return v


# ---------------------------------------------------------------------------
# 01_INPUT
# ---------------------------------------------------------------------------


def project_request(generation_date: str) -> Dict[str, Any]:
    return {
        "schema": "embedverse-project-request/1.0",
        "project_id": P.PROJECT_ID,
        "generated_on": generation_date,
        "requested_by": "Administracion",
        "request_summary": (
            "Expediente tecnico digital completo de una edificacion institucional de "
            "referencia, con planos multidisciplinarios, modelo tridimensional, componentes, "
            "conexiones, propiedades y procedimientos geometricos, para usarse como conjunto "
            "de datos inicial de EMBEDVERSE AI."),
        "requested_parameters": {
            "building_use": P.REQ_BUILDING_USE,
            "levels": P.REQ_LEVEL_COUNT,
            "length_x_m": P.REQ_LENGTH_X,
            "width_y_m": P.REQ_WIDTH_Y,
            "clear_height_m": P.REQ_CLEAR_HEIGHT,
            "floor_to_floor_m": P.REQ_FLOOR_TO_FLOOR,
            "area_per_level_m2": P.REQ_AREA_PER_LEVEL,
            "total_area_m2": P.REQ_TOTAL_AREA,
            "structural_system": P.REQ_STRUCTURAL_SYSTEM,
            "roof": P.REQ_ROOF,
            "stair_position": P.REQ_STAIR_POSITION,
            "required_spaces": ["oficinas", "salas de reuniones", "banos", "recepcion",
                                "circulaciones", "cuarto electrico",
                                "cuarto de telecomunicaciones", "zonas tecnicas"],
        },
        "requested_disciplines": ["arquitectura", "estructura", "electrico",
                                  "telecomunicaciones", "hidrosanitario",
                                  "mecanico y climatizacion", "seguridad y proteccion"],
        "explicit_constraints_from_request": [
            "No inventar disenos de cimentacion, secciones estructurales definitivas ni "
            "armados constructivos sin calculo y validacion profesional.",
            "No presentar dimensiones preliminares como resultados de diseno calculado.",
            "No asumir que todos los circuitos son de 220 V; diferenciar tensiones.",
            "No inventar calibres, protecciones ni capacidades; registrar lo que falte como "
            "pendiente.",
            "No inventar capacidades de refrigeracion ni caudales sin calculo de carga termica.",
            "No entregar unicamente imagenes ni archivos vacios o ficticios.",
            "No afirmar que un plano esta aprobado si no ha sido revisado.",
            "No convertir formatos cambiando solo la extension.",
        ],
        "interpretation_note": (
            "Las dimensiones entregadas se tratan como parametros de un modelo conceptual. "
            "Todo lo que no se entrego y no puede deducirse geometricamente se registra como "
            "hipotesis declarada o como parametro pendiente."),
    }


def specifications(generation_date: str) -> Dict[str, Any]:
    return {
        "schema": "embedverse-specifications/1.0",
        "project_id": P.PROJECT_ID,
        "version": P.PROJECT_VERSION,
        "generated_on": generation_date,
        "units": {"length": P.UNITS_LENGTH, "angle": P.UNITS_ANGLE,
                  "coordinate_system": "cartesiano local, origen en la esquina suroeste",
                  "north_angle_deg": P.NORTH_ANGLE_DEG},
        "provenance_vocabulary": {
            "request": "valor entregado por la administracion",
            "hypothesis": "hipotesis conceptual adoptada para poder modelar",
            "derived": "obtenido por aritmetica o geometria desde los anteriores",
            "measured": "medido sobre la geometria del modelo",
            "pending": "no determinado; requiere calculo o decision",
        },
        "requested_parameters": {
            "length_x_m": P.REQ_LENGTH_X, "width_y_m": P.REQ_WIDTH_Y,
            "levels": P.REQ_LEVEL_COUNT, "clear_height_m": P.REQ_CLEAR_HEIGHT,
            "floor_to_floor_m": P.REQ_FLOOR_TO_FLOOR,
        },
        "adopted_hypotheses": {
            "structural_depth_m": P.HYP_STRUCTURAL_DEPTH,
            "slab_thickness_m": P.HYP_SLAB_THICKNESS,
            "beam_section_m": [P.HYP_BEAM_WIDTH, P.HYP_BEAM_DEPTH],
            "column_section_m": list(P.HYP_COLUMN_SIZE),
            "footing_plan_m": list(P.HYP_FOOTING_PLAN),
            "footing_thickness_m": P.HYP_FOOTING_THICKNESS,
            "wall_exterior_m": P.HYP_WALL_EXTERIOR,
            "wall_interior_m": P.HYP_WALL_INTERIOR,
            "wall_core_m": P.HYP_WALL_CORE,
            "core_size_m": list(P.HYP_CORE_SIZE),
            "corridor_width_m": P.HYP_CORRIDOR_WIDTH,
            "stair_riser_m": P.HYP_STAIR_RISER,
            "stair_tread_m": P.HYP_STAIR_TREAD,
            "ceiling_height_m": P.HYP_CEILING_HEIGHT,
            "plenum_routing_z_m": P.HYP_PLENUM_ROUTING_Z,
            "luminaire": P.HYP_LUMINAIRE,
            "outlet": P.HYP_OUTLET,
            "system_voltages": P.HYP_SYSTEM_VOLTAGES,
            "power_factor_assumed": P.HYP_POWER_FACTOR,
            "pipe_diameters_m": P.HYP_PIPE_DIAMETERS,
            "drain_slope": P.HYP_DRAIN_SLOPE,
            "conduit_diameters_m": P.HYP_CONDUIT_DIAMETERS,
            "duct_sections_m": {k: list(v) for k, v in P.HYP_DUCT_SECTIONS.items()},
            "cable_tray_m": P.HYP_CABLE_TRAY,
        },
        "grid": {"x_labels": list(P.GRID_X_LABELS), "x_m": list(P.GRID_X),
                 "y_labels": list(P.GRID_Y_LABELS), "y_m": list(P.GRID_Y)},
        "levels": [dict(lv) for lv in P.ALL_LEVELS],
        "materials": P.MATERIALS,
        "pending_parameters": P.PENDING_PARAMETERS,
        "scope_statement": (
            "Este expediente es geometria conceptual generada automaticamente. No contiene "
            "calculo estructural, electrico, hidraulico ni termico, no ha sido revisado por "
            "un profesional competente y no es apto para construccion."),
    }


# ---------------------------------------------------------------------------
# Catalogo, conexiones y espacios
# ---------------------------------------------------------------------------


def components_payload(model, discipline: Optional[str] = None) -> Dict[str, Any]:
    comps = (model.by_discipline(discipline) if discipline
             else list(model.components.values()))
    comps.sort(key=lambda c: c.component_id)
    return {
        "schema": "embedverse-component-catalog/1.0",
        "project_id": P.PROJECT_ID,
        "discipline": discipline or "all",
        "count": len(comps),
        "null_policy": ("Los parametros sin determinar se conservan como null y se enumeran "
                        "en requires_calculation. No se sustituyen por valores inventados."),
        "components": [c.to_dict() for c in comps],
    }


COMPONENT_CSV_HEADERS = [
    "component_id", "discipline", "type", "name", "level_id", "space_id", "material",
    "ifc_class", "pos_x", "pos_y", "pos_z", "geometry_reference", "drawing_reference",
    "connection_count", "relationship_count", "operation_count", "provenance",
    "validation_status", "professional_review", "requires_calculation", "null_parameters",
]


def components_rows(model, discipline: Optional[str] = None) -> List[List[Any]]:
    comps = (model.by_discipline(discipline) if discipline
             else list(model.components.values()))
    comps.sort(key=lambda c: c.component_id)
    rows: List[List[Any]] = []
    for c in comps:
        pos = c.position or [None, None, None]
        nulls = [k for k, v in c.parameters.items() if v is None]
        rows.append([
            c.component_id, c.discipline, c.type, c.name, c.level_id, c.space_id,
            c.material, c.ifc_class, pos[0], pos[1], pos[2], c.geometry_reference,
            _flat(c.drawing_reference), len(c.connections), len(c.relationships),
            len(c.operations), c.provenance, c.validation_status, c.professional_review,
            _flat(c.requires_calculation), _flat(nulls),
        ])
    return rows


CONNECTION_CSV_HEADERS = [
    "connection_id", "discipline", "type", "origin", "destination", "medium",
    "technology", "length_m", "flow_direction", "geometry_reference", "provenance",
    "validation_status", "requires_calculation", "parameters",
]


def connections_rows(model, discipline: Optional[str] = None) -> List[List[Any]]:
    cxs = (model.connections_of_discipline(discipline) if discipline
           else list(model.connections.values()))
    cxs.sort(key=lambda c: c.connection_id)
    return [[
        c.connection_id, c.discipline, c.type, c.origin, c.destination, c.medium,
        c.technology, c.length_m, c.flow_direction, c.geometry_reference, c.provenance,
        c.validation_status, _flat(c.requires_calculation),
        json.dumps(c.parameters, ensure_ascii=False),
    ] for c in cxs]


def connections_payload(model, discipline: Optional[str] = None) -> Dict[str, Any]:
    cxs = (model.connections_of_discipline(discipline) if discipline
           else list(model.connections.values()))
    cxs.sort(key=lambda c: c.connection_id)
    media = sorted({c.medium for c in cxs})
    return {
        "schema": "embedverse-connection-registry/1.0",
        "project_id": P.PROJECT_ID,
        "discipline": discipline or "all",
        "count": len(cxs),
        "distinct_media": media,
        "note": ("Cada conexion declara origen, destino, medio fisico o inalambrico y "
                 "tecnologia. La longitud, cuando existe, se mide sobre la polilinea 3D."),
        "connections": [c.to_dict() for c in cxs],
    }


SPACE_CSV_HEADERS = ["space_id", "code", "name", "use", "level_id", "x0", "y0", "x1", "y1",
                     "area_m2", "perimeter_m", "clear_height_m", "shape",
                     "geometry_reference", "requires_calculation"]


def spaces_rows(model, level_id: Optional[str] = None) -> List[List[Any]]:
    sps = (model.spaces_of_level(level_id) if level_id else list(model.spaces.values()))
    sps.sort(key=lambda s: (s.level_id, s.code))
    return [[s.space_id, s.code, s.name, s.use, s.level_id, s.rect[0], s.rect[1],
             s.rect[2], s.rect[3], s.area_m2, s.perimeter_m, s.clear_height, s.shape,
             s.geometry_reference, _flat(s.requires_calculation)] for s in sps]


# ---------------------------------------------------------------------------
# 10_PROCEDURES
# ---------------------------------------------------------------------------


def component_creation_payload(model) -> Dict[str, Any]:
    """Cadena SOLICITUD -> PARAMETROS -> PROCEDIMIENTO -> GEOMETRIA -> PLANOS."""
    records = []
    for cid in sorted(model.components):
        c = model.components[cid]
        ops = model.oplog.for_component(cid)
        solid = model.solids.get(c.geometry_reference) if c.geometry_reference else None
        params_used = sorted({d for o in ops for d in o.derived_from})
        records.append({
            "component_id": cid,
            "discipline": c.discipline,
            "type": c.type,
            "chain": {
                "request": {
                    "driving_requirements": [
                        k for k in ("REQ_LENGTH_X", "REQ_WIDTH_Y", "REQ_LEVEL_COUNT",
                                    "REQ_CLEAR_HEIGHT", "REQ_FLOOR_TO_FLOOR")
                        if k in params_used],
                },
                "parameters": {
                    "source_constants": params_used,
                    "values": {k: _const(k) for k in params_used},
                },
                "procedure": [
                    {"op_id": o.op_id, "operation": o.operation, "category": o.category,
                     "description": o.description, "inputs": o.inputs,
                     "outputs": o.outputs, "implementation": o.implementation}
                    for o in ops],
                "geometry": (solid.describe() if solid is not None else None),
                "drawings": c.drawing_reference,
            },
            "relationships": c.relationships,
            "connections": c.connections,
            "validation_status": c.validation_status,
            "professional_review": c.professional_review,
            "requires_calculation": c.requires_calculation,
        })
    return {
        "schema": "embedverse-component-creation/1.0",
        "project_id": P.PROJECT_ID,
        "purpose": ("Permitir que un modelo aprenda la relacion SOLICITUD -> PARAMETROS -> "
                    "PROCEDIMIENTO -> GEOMETRIA -> PLANOS para cada componente."),
        "count": len(records),
        "records": records,
    }


def _const(name: str) -> Any:
    v = getattr(P, name, None)
    if isinstance(v, tuple):
        return list(v)
    if isinstance(v, (int, float, str, bool)) or v is None:
        return v
    if isinstance(v, dict):
        return v
    return str(v)


def relationships_payload(model) -> Dict[str, Any]:
    edges = []
    for cid in sorted(model.components):
        c = model.components[cid]
        for r in c.relationships:
            edges.append({"source": cid, "relation": r["relation"], "target": r["target"],
                          "source_discipline": c.discipline,
                          "target_discipline": model.components[r["target"]].discipline
                          if r["target"] in model.components else None})
    for cxid in sorted(model.connections):
        cx = model.connections[cxid]
        edges.append({"source": cx.origin, "relation": "connected_to",
                      "target": cx.destination, "connection_id": cxid,
                      "medium": cx.medium, "technology": cx.technology,
                      "length_m": cx.length_m, "flow_direction": cx.flow_direction,
                      "source_discipline": cx.discipline, "target_discipline": cx.discipline})
    kinds: Dict[str, int] = {}
    for e in edges:
        kinds[e["relation"]] = kinds.get(e["relation"], 0) + 1
    return {
        "schema": "embedverse-relationship-graph/1.0",
        "project_id": P.PROJECT_ID,
        "edge_count": len(edges),
        "by_relation": dict(sorted(kinds.items())),
        "node_count": len(model.components),
        "edges": edges,
    }


# ---------------------------------------------------------------------------
# 13_DATASET
# ---------------------------------------------------------------------------


def annotations_payload(model, sheet_index: Dict[str, List[str]]) -> Dict[str, Any]:
    records = []
    for cid in sorted(model.components):
        c = model.components[cid]
        solid = model.solids.get(c.geometry_reference) if c.geometry_reference else None
        bbox = None
        volume = None
        if solid is not None:
            lo, hi = solid.bbox()
            bbox = {"min": [round(v, 4) for v in lo], "max": [round(v, 4) for v in hi]}
            volume = round(solid.volume(), 6)
        records.append({
            "component_id": cid,
            "labels": {
                "discipline": c.discipline,
                "type": c.type,
                "ifc_class": c.ifc_class,
                "material": c.material,
                "level": c.level_id,
                "space": c.space_id,
                "tags": c.tags,
            },
            "geometry": {
                "solid_id": c.geometry_reference,
                "bbox": bbox,
                "volume_m3": volume,
                "primitive_kinds": sorted({p.kind for p in solid.primitives})
                if solid is not None else [],
            },
            "drawings": sheet_index.get(cid, []),
            "parameters": c.parameters,
            "null_parameters": [k for k, v in c.parameters.items() if v is None],
            "requires_calculation": c.requires_calculation,
            "provenance": c.provenance,
            "validation_status": c.validation_status,
            "professional_review": c.professional_review,
            "operation_ids": c.operations,
        })
    return {
        "schema": "embedverse-annotations/1.0",
        "project_id": P.PROJECT_ID,
        "count": len(records),
        "null_policy": "Los nulos se conservan; null significa 'no determinado', no 'cero'.",
        "annotations": records,
    }


def component_labels_payload(model) -> Dict[str, Any]:
    disc: Dict[str, int] = {}
    types: Dict[str, int] = {}
    ifc: Dict[str, int] = {}
    mats: Dict[str, int] = {}
    tags: Dict[str, int] = {}
    for c in model.components.values():
        disc[c.discipline] = disc.get(c.discipline, 0) + 1
        types["%s/%s" % (c.discipline, c.type)] = types.get("%s/%s" % (c.discipline, c.type), 0) + 1
        if c.ifc_class:
            ifc[c.ifc_class] = ifc.get(c.ifc_class, 0) + 1
        if c.material:
            mats[c.material] = mats.get(c.material, 0) + 1
        for t in c.tags:
            tags[t] = tags.get(t, 0) + 1
    return {
        "schema": "embedverse-component-labels/1.0",
        "project_id": P.PROJECT_ID,
        "label_spaces": {
            "discipline": {"values": sorted(disc), "counts": dict(sorted(disc.items()))},
            "discipline_type": {"values": sorted(types),
                                "counts": dict(sorted(types.items()))},
            "ifc_class": {"values": sorted(ifc), "counts": dict(sorted(ifc.items()))},
            "material": {"values": sorted(mats), "counts": dict(sorted(mats.items()))},
            "tag": {"values": sorted(tags), "counts": dict(sorted(tags.items()))},
            "provenance": {"values": list(["request", "hypothesis", "derived",
                                           "measured", "pending"])},
            "validation_status": {"values": ["pending", "geometry_checked",
                                             "geometry_failed"]},
        },
        "class_imbalance_note": (
            "Las clases estan muy desbalanceadas (por ejemplo, luminarias y tomacorrientes "
            "frente a tanques o routers). Un entrenamiento directo sin reponderar aprendera "
            "sobre todo las clases frecuentes."),
    }


def training_metadata_payload(model, generation_date: str, exports: Dict[str, Any],
                              validation: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "schema": P.DATASET_SCHEMA_VERSION,
        "project_id": P.PROJECT_ID,
        "version": P.PROJECT_VERSION,
        "generated_on": generation_date,
        "generator": "EMBEDVERSE building generator (tools/building_generator)",
        "determinism": ("La generacion es determinista: sin reloj ni aleatoriedad en la "
                        "geometria. Dos ejecuciones producen los mismos archivos salvo el "
                        "campo generated_on."),
        "sample_count": {
            "buildings": 1,
            "components": len(model.components),
            "connections": len(model.connections),
            "spaces": len(model.spaces),
            "solids": len(model.solids),
            "operations": len(model.oplog),
            "drawings": exports.get("sheet_count"),
        },
        "modalities": {
            "geometry_3d": ["IFC4", "GLB", "OBJ", "STEP"],
            "drawings_2d": ["DXF", "PDF", "SVG"],
            "structured": ["JSON", "CSV"],
            "procedures": ["geometry_operations.json", "component_creation.json"],
            "graph": ["relationships.json"],
        },
        "intended_tasks": [
            "aprender la relacion solicitud -> parametros -> procedimiento -> geometria -> planos",
            "reconocer disciplina, tipo y material de un componente",
            "predecir relaciones y conexiones entre componentes",
            "generar vistas 2D coherentes con un modelo 3D",
            "distinguir un parametro determinado de uno pendiente",
        ],
        "not_suitable_for": [
            "aprender criterios de diseno estructural, electrico, hidraulico o termico",
            "aprender cumplimiento normativo",
            "inferir calibres, protecciones, capacidades o caudales (no estan en los datos)",
            "generalizar a otras tipologias: el dataset contiene UN edificio",
        ],
        "known_limitations": [
            "Una sola muestra de edificio; sin variacion tipologica, climatica ni normativa.",
            "La geometria es conceptual y no esta validada por ingenieria.",
            "Las instalaciones siguen trazados ortogonales simples, no soluciones "
            "optimizadas de obra.",
            "No hay texturas, acabados ni detalle constructivo.",
            "Las clases estan desbalanceadas.",
        ],
        "null_semantics": {
            "null": "parametro no determinado; requiere calculo o decision profesional",
            "never_means": ["cero", "no aplica", "valor por defecto"],
        },
        "validation_summary": {
            "geometric_validation": validation.get("consistency", {}).get("passed"),
            "consistency_errors": validation.get("consistency", {}).get("errors"),
            "consistency_warnings": validation.get("consistency", {}).get("warnings"),
            "clash_count": validation.get("clash", {}).get("clash_count"),
            "technical_review": False,
            "professional_approval": False,
        },
        "license_and_provenance": {
            "content": ("Geometria y datos generados por software propio a partir de los "
                        "parametros de la solicitud. No se ha copiado contenido de los "
                        "documentos de la carpeta Planos/ ni de ninguna norma."),
            "third_party_sources_used": "ninguna",
            "tooling": exports.get("tooling", []),
        },
        "how_to_load": {
            "catalog": "13_DATASET/annotations.json",
            "labels": "13_DATASET/component_labels.json",
            "graph": "13_DATASET/relationships.json",
            "procedures": "10_PROCEDURES/component_creation.json",
            "geometry": "02_3D_MODEL/building.glb (visual) y building.ifc (semantico)",
            "drawings": "11_DRAWINGS/metadata/sheet_index.json",
            "join_key": "component_id, presente en todas las modalidades",
        },
    }

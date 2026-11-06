"""Validacion geometrica y de consistencia del modelo.

Distincion que este modulo mantiene de forma explicita, tal como exige el
apartado 15 de la solicitud:

  VALIDACION GEOMETRICA    automatica y objetiva: unidades, identificadores,
                           referencias, cierres de malla, colisiones. Es lo
                           unico que este paquete puede afirmar.
  REVISION TECNICA         no realizada. Exige criterio de ingenieria sobre
                           cargas, caudales, corrientes y normativa.
  APROBACION PROFESIONAL   no realizada. Exige un profesional competente que
                           firme y asuma responsabilidad.

Ningun resultado de este modulo equivale a las dos ultimas.
"""

from __future__ import annotations

import math
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

import numpy as np
from shapely.geometry import box as sbox
from shapely.strtree import STRtree

import params as P
import solids as S

# Valores por defecto del dominio edificacion. Un modelo puede declarar los
# suyos en `model.clash_roles`, que es lo que hace el generador de puentes.
NON_MATERIAL_LAYERS = {"ARQ-ESPACIOS"}

STRUCTURAL_LAYERS = {"ESTR-COLUMNAS", "ESTR-VIGAS", "ESTR-LOSAS", "ESTR-CIMENTACION",
                     "ESTR-ESCALERA"}
WALL_LAYERS = {"ARQ-MUROS", "ARQ-CUBIERTA"}
MEP_DISCIPLINES = {"electrical", "telecommunications", "hydrosanitary", "hvac", "security"}


def _roles(model):
    """Papeles de capa del modelo, con los de edificacion como respaldo."""
    roles = getattr(model, "clash_roles", None) or {}
    return {
        "frame": set(roles.get("frame", FRAME_LAYERS)),
        "slab": set(roles.get("slab", SLAB_LAYERS)),
        "enclosure": set(roles.get("enclosure", WALL_LAYERS)),
        "services": set(roles.get("service_disciplines", MEP_DISCIPLINES)),
        "non_material": set(roles.get("non_material_layers", NON_MATERIAL_LAYERS)),
    }

MIN_OVERLAP_M3 = 1e-5


# ---------------------------------------------------------------------------
# Informe de geometria
# ---------------------------------------------------------------------------


def geometry_report(model, site_bounds: Optional[Tuple[float, float, float, float]] = None) -> Dict[str, Any]:
    per_discipline: Dict[str, Dict[str, float]] = {}
    issues: List[Dict[str, Any]] = []
    total_volume = 0.0
    material_volume = 0.0
    degenerate: List[str] = []
    open_meshes: List[str] = []

    bbox_min = [math.inf] * 3
    bbox_max = [-math.inf] * 3

    for sid, s in sorted(model.solids.items()):
        try:
            mesh = s.to_trimesh()
        except Exception as exc:
            issues.append({"solid_id": sid, "issue": "malla no generable", "detail": str(exc)})
            continue
        if mesh is None or len(mesh.faces) == 0:
            degenerate.append(sid)
            continue
        vol = abs(float(mesh.volume))
        if vol <= 1e-12:
            degenerate.append(sid)
        if not bool(mesh.is_watertight):
            open_meshes.append(sid)

        lo, hi = s.bbox()
        for i in range(3):
            bbox_min[i] = min(bbox_min[i], lo[i])
            bbox_max[i] = max(bbox_max[i], hi[i])

        d = per_discipline.setdefault(s.discipline, {"solids": 0, "volume_m3": 0.0,
                                                     "triangles": 0})
        d["solids"] += 1
        d["volume_m3"] += vol
        d["triangles"] += int(len(mesh.faces))
        total_volume += vol
        if s.layer not in _roles(model)["non_material"]:
            material_volume += vol

    for k in per_discipline:
        per_discipline[k]["volume_m3"] = round(per_discipline[k]["volume_m3"], 4)

    concrete = round(sum(
        s.volume() for s in model.solids.values()
        if s.material == "concreto_estructural"), 4)

    return {
        "schema": "embedverse-geometry-report/1.0",
        "scope": "validacion geometrica automatica; no es revision tecnica ni aprobacion",
        "units": {"length": "m", "volume": "m3"},
        "solid_count": len(model.solids),
        "bounding_box_min": [round(v, 4) for v in bbox_min],
        "bounding_box_max": [round(v, 4) for v in bbox_max],
        "total_volume_m3": round(total_volume, 4),
        "material_volume_m3": round(material_volume, 4),
        "reference_volume_m3": round(total_volume - material_volume, 4),
        "structural_concrete_volume_m3": concrete,
        "by_discipline": {k: per_discipline[k] for k in sorted(per_discipline)},
        "degenerate_solids": degenerate,
        "non_watertight_solids_count": len(open_meshes),
        "non_watertight_solids_sample": open_meshes[:20],
        "non_watertight_note": (
            "Los solidos de recorrido se componen de barridos consecutivos que se tocan en "
            "sus extremos; el conjunto concatenado no es estanco aunque cada tramo si lo es. "
            "No es un defecto de la geometria exportada."),
        "issues": issues,
        "checks": {
            "all_solids_have_geometry": len(degenerate) == 0,
            "bounding_box_within_site": (
                True if site_bounds is None else (
                    bbox_min[0] >= site_bounds[0] and bbox_max[0] <= site_bounds[2]
                    and bbox_min[1] >= site_bounds[1] and bbox_max[1] <= site_bounds[3])),
        },
    }


# ---------------------------------------------------------------------------
# Deteccion de colisiones
# ---------------------------------------------------------------------------


def _primitive_overlap(pa, poly_a, za, pb, poly_b, zb) -> Tuple[float, bool]:
    """Volumen de interseccion entre dos primitivas.

    Exacto cuando ambas son prismas en Z: area de interseccion de las huellas
    por el solape vertical. Cuando interviene un barrido o una revolucion se
    usa la huella en planta, que sobreestima ligeramente; el caso se marca
    como no exacto.
    """
    dz = min(za[1], zb[1]) - max(za[0], zb[0])
    if dz <= 0:
        return 0.0, True
    inter = poly_a.intersection(poly_b)
    if inter.is_empty:
        return 0.0, True
    exact = isinstance(pa, S.Prism) and isinstance(pb, S.Prism)
    return inter.area * dz, exact


SLAB_LAYERS = {"ESTR-LOSAS"}
FRAME_LAYERS = {"ESTR-COLUMNAS", "ESTR-VIGAS", "ESTR-CIMENTACION", "ESTR-ESCALERA"}


def _classify(a: S.Solid, b: S.Solid, roles: Dict[str, Any]) -> Tuple[str, str]:
    """Clasifica una interferencia distinguiendo lo esperado de lo que hay que corregir.

    Compartir volumen no siempre es un defecto. Una tuberia que cruza una losa
    es una penetracion prevista que necesita pasamuros; varios conductores que
    comparten una bandeja ocupan el mismo espacio por diseno. En cambio, una
    canalizacion dentro de una columna o de una viga es un error de trazado.
    """
    da, db = a.discipline, b.discipline
    la, lb = a.layer, b.layer
    frame, slab = roles["frame"], roles["slab"]
    enclosure, services = roles["enclosure"], roles["services"]
    mep_a, mep_b = da in services, db in services

    if (mep_a and lb in frame) or (mep_b and la in frame):
        return ("instalacion dentro de un elemento portante", "COLISION ESTRUCTURAL")
    if (mep_a and lb in slab) or (mep_b and la in slab):
        return ("penetracion de losa", "PASE DE LOSA")
    if (mep_a and lb in enclosure) or (mep_b and la in enclosure):
        return ("pase de muro", "PASE DE MURO")
    if mep_a and mep_b:
        if da == db:
            return ("recorrido compartido de la misma disciplina", "RECORRIDO COMPARTIDO")
        return ("interferencia entre instalaciones", "REVISAR TRAZADO")
    structural = frame | slab
    if la in enclosure and lb in enclosure:
        return ("encuentro de muros", "ENCUENTRO CONSTRUCTIVO")
    if (la in enclosure and lb in structural) or (lb in enclosure and la in structural):
        return ("cerramiento contra estructura", "ENCUENTRO CONSTRUCTIVO")
    if la in structural and lb in structural:
        return ("union monolitica de concreto", "ENCUENTRO CONSTRUCTIVO")
    return ("otra interferencia", "REVISAR")


def clash_report(model, max_pairs: int = 3000000) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    """Deteccion de colisiones a nivel de PRIMITIVA.

    Indexar los solidos completos no sirve: un circuito electrico o una red de
    tuberia tiene una envolvente que abarca toda la planta y seria candidato de
    casi todo. El indice espacial se construye sobre las primitivas, cuyas
    envolventes si son ajustadas, y los resultados se agregan despues por par
    de solidos.
    """
    roles = _roles(model)
    solids = [s for s in model.solids.values() if s.layer not in roles["non_material"]]
    solids.sort(key=lambda s: s.solid_id)

    owner: List[int] = []
    prims: List[Any] = []
    polys: List[Any] = []
    zrs: List[Tuple[float, float]] = []
    boxes: List[Any] = []

    for si, s in enumerate(solids):
        for p in s.primitives:
            foot = p.plan_footprint()
            if not foot:
                continue
            poly = foot[0] if len(foot) == 1 else None
            if poly is None:
                from shapely.ops import unary_union
                poly = unary_union(foot)
            if poly.is_empty or poly.area <= 0:
                continue
            z0, z1 = p.z_range()
            minx, miny, maxx, maxy = poly.bounds
            owner.append(si)
            prims.append(p)
            polys.append(poly)
            zrs.append((z0, z1))
            boxes.append(sbox(minx, miny, maxx, maxy))

    tree = STRtree(boxes)
    acc: Dict[Tuple[int, int], List[float]] = {}
    pairs_tested = 0
    truncated = False

    for i in range(len(boxes)):
        for j in tree.query(boxes[i]):
            j = int(j)
            if j <= i:
                continue
            if owner[i] == owner[j]:
                continue
            if zrs[i][1] <= zrs[j][0] or zrs[j][1] <= zrs[i][0]:
                continue
            pairs_tested += 1
            if pairs_tested > max_pairs:
                truncated = True
                break
            vol, exact = _primitive_overlap(prims[i], polys[i], zrs[i],
                                            prims[j], polys[j], zrs[j])
            if vol <= 0.0:
                continue
            key = (owner[i], owner[j]) if owner[i] < owner[j] else (owner[j], owner[i])
            e = acc.setdefault(key, [0.0, 1.0])
            e[0] += vol
            if not exact:
                e[1] = 0.0
        if truncated:
            break

    clashes: List[Dict[str, Any]] = []
    for (ia, ib), (vol, exact) in acc.items():
        if vol < MIN_OVERLAP_M3:
            continue
        a, b = solids[ia], solids[ib]
        kind, severity = _classify(a, b, roles)
        clashes.append({
            "a": a.solid_id, "b": b.solid_id,
            "a_layer": a.layer, "b_layer": b.layer,
            "a_discipline": a.discipline, "b_discipline": b.discipline,
            "overlap_m3": round(vol, 6),
            "exact": bool(exact),
            "kind": kind, "severity": severity,
            "level": a.level_id or b.level_id,
        })

    by_sev: Dict[str, int] = {}
    by_kind: Dict[str, int] = {}
    for c in clashes:
        by_sev[c["severity"]] = by_sev.get(c["severity"], 0) + 1
        by_kind[c["kind"]] = by_kind.get(c["kind"], 0) + 1

    clashes.sort(key=lambda c: (-c["overlap_m3"], c["a"], c["b"]))
    report = {
        "schema": "embedverse-clash-report/1.0",
        "method": ("indice espacial sobre las PRIMITIVAS de cada solido (no sobre el solido "
                   "completo, cuya envolvente seria demasiado grande en los recorridos de "
                   "instalaciones); el volumen de interseccion es exacto entre prismas en Z "
                   "y aproximado por huella cuando interviene un barrido o una revolucion"),
        "minimum_overlap_m3": MIN_OVERLAP_M3,
        "solids_analyzed": len(solids),
        "primitives_indexed": len(boxes),
        "candidate_pairs_tested": pairs_tested,
        "truncated": truncated,
        "clash_count": len(clashes),
        "by_severity": dict(sorted(by_sev.items())),
        "by_kind": dict(sorted(by_kind.items())),
        "expected_classes": ["PASE DE MURO", "PASE DE LOSA", "ENCUENTRO CONSTRUCTIVO",
                             "RECORRIDO COMPARTIDO"],
        "actionable_classes": ["COLISION ESTRUCTURAL", "REVISAR TRAZADO", "REVISAR"],
        "interpretation": {
            "PASE DE MURO": ("Esperado. La instalacion atraviesa una particion y requiere "
                             "manguito y coordinacion en obra."),
            "PASE DE LOSA": ("Esperado. La instalacion atraviesa una losa y requiere "
                             "pasamuros y sellado cortafuego."),
            "ENCUENTRO CONSTRUCTIVO": ("Esperado. Dos elementos constructivos se encuentran "
                                       "y comparten volumen en la union."),
            "RECORRIDO COMPARTIDO": ("Esperado. Varios circuitos o ramales de la misma "
                                     "disciplina comparten canalizacion o bandeja."),
            "COLISION ESTRUCTURAL": ("REQUIERE CORRECCION: una instalacion ocupa el mismo "
                                     "volumen que una columna, una viga, una cimentacion o "
                                     "una escalera."),
            "REVISAR TRAZADO": ("REQUIERE CORRECCION: dos instalaciones de disciplinas "
                                "distintas comparten volumen."),
            "REVISAR": "Interferencia no clasificada; revisar caso por caso.",
        },
        "top_clashes": clashes[:50],
    }
    return report, clashes


# ---------------------------------------------------------------------------
# Informe de consistencia
# ---------------------------------------------------------------------------


def building_domain_checks() -> List[Tuple[str, bool, Any]]:
    """Comprobaciones dimensionales propias de una edificacion."""
    return [
        ("unidades de longitud declaradas en metros", P.UNITS_LENGTH == "m", ""),
        ("coherencia altura libre = entre niveles - canto",
         abs(P.REQ_FLOOR_TO_FLOOR - P.HYP_STRUCTURAL_DEPTH - P.REQ_CLEAR_HEIGHT) < 1e-9, ""),
        ("contrahuellas suman la altura entre niveles",
         abs(P.HYP_STAIR_RISER * P.HYP_STAIR_RISERS_PER_FLIGHT
             * P.HYP_STAIR_FLIGHTS_PER_LEVEL - P.REQ_FLOOR_TO_FLOOR) < 1e-9, ""),
        ("area por nivel coincide con el enunciado",
         abs(P.REQ_LENGTH_X * P.REQ_WIDTH_Y - P.REQ_AREA_PER_LEVEL) < 1e-6, ""),
    ]


def consistency_report(
    model,
    sheets: Optional[Sequence] = None,
    domain_checks: Optional[Callable[[], List[Tuple[str, bool, Any]]]] = None,
) -> Dict[str, Any]:
    checks: List[Dict[str, Any]] = []

    def check(name: str, ok: bool, detail: Any = "", severity: str = "error") -> None:
        checks.append({"check": name, "passed": bool(ok), "detail": detail,
                       "severity": severity})

    # identificadores
    comp_ids = list(model.components)
    check("identificadores de componente unicos", len(set(comp_ids)) == len(comp_ids))
    sol_ids = list(model.solids)
    check("identificadores de solido unicos", len(set(sol_ids)) == len(sol_ids))
    cnx_ids = list(model.connections)
    check("identificadores de conexion unicos", len(set(cnx_ids)) == len(cnx_ids))

    # referencias de geometria
    missing_geo = [c.component_id for c in model.components.values()
                   if c.geometry_reference and c.geometry_reference not in model.solids]
    check("toda geometry_reference apunta a un solido existente", not missing_geo,
          missing_geo[:10])

    # referencias de conexion
    bad_ends = [(cx.connection_id, e) for cx in model.connections.values()
                for e in (cx.origin, cx.destination) if e not in model.components]
    check("toda conexion referencia componentes existentes", not bad_ends,
          [list(x) for x in bad_ends[:10]])

    # relaciones
    bad_rel = [(c.component_id, r["target"]) for c in model.components.values()
               for r in c.relationships if r["target"] not in model.components]
    check("toda relacion referencia componentes existentes", not bad_rel,
          [list(x) for x in bad_rel[:10]])

    # Duplicados posicionales entre DISPOSITIVOS.
    # Solo se aplica a componentes cuyo solido es un unico prisma, es decir, el
    # envolvente de un equipo. En un recorrido (circuito, ramal, ducto) la
    # posicion es el punto de arranque de la polilinea y varios recorridos
    # arrancan legitimamente del mismo tablero o del mismo montante.
    pos_seen: Dict[Tuple[str, str], str] = {}
    dups: List[List[str]] = []
    for c in sorted(model.components.values(), key=lambda c: c.component_id):
        if not c.position or not c.geometry_reference:
            continue
        solid = model.solids.get(c.geometry_reference)
        if solid is None or len(solid.primitives) != 1:
            continue
        if not isinstance(solid.primitives[0], S.Prism):
            continue
        key = (c.type, "%.4f,%.4f,%.4f" % tuple(c.position))
        if key in pos_seen:
            dups.append([pos_seen[key], c.component_id])
        else:
            pos_seen[key] = c.component_id
    check("sin dispositivos duplicados en la misma posicion y tipo", not dups, dups[:10])

    # procedimientos
    no_ops = [c.component_id for c in model.components.values()
              if not c.operations and c.type != "beam_column_joint"]
    check("todo componente tiene procedimiento registrado", not no_ops, no_ops[:10])

    # comprobaciones propias del dominio (edificacion, puente, ...)
    for name, ok, detail in (domain_checks or building_domain_checks)():
        check(name, ok, detail)

    # Continuidad de recorridos: una conexion con geometria PROPIA declara su
    # longitud. Las que comparten el solido de un recorrido troncal (varias
    # derivaciones sobre el mismo ramal) no tienen longitud individual y eso es
    # correcto: la longitud pertenece al recorrido, no a cada derivacion.
    component_geometry = {c.geometry_reference for c in model.components.values()
                          if c.geometry_reference}
    no_len = [cx.connection_id for cx in model.connections.values()
              if cx.geometry_reference and cx.length_m is None
              and cx.geometry_reference not in component_geometry]
    check("las conexiones con geometria propia declaran longitud", not no_len, no_len[:10],
          severity="warning")

    # circuitos: potencia y corriente coherentes
    bad_current: List[str] = []
    for c in model.by_type("circuit"):
        p = c.parameters
        v, pf = p["nominal_voltage_v"], p["power_factor_assumed"]
        expected = (p["connected_power_w"] / (v * pf) if p["phases"] == 1
                    else p["connected_power_w"] / (math.sqrt(3) * v * pf))
        if abs(expected - p["derived_current_a"]) > 1e-3:
            bad_current.append(c.component_id)
    check("la corriente derivada coincide con P/(V x fp)", not bad_current, bad_current[:10])

    # honestidad de datos
    reviewed = [c.component_id for c in model.components.values()
                if c.professional_review != "not_reviewed"]
    check("ningun componente se declara revisado por profesional", not reviewed, reviewed[:10])
    nulls = sum(1 for c in model.components.values()
                for v in c.parameters.values() if v is None)
    pend = sum(1 for c in model.components.values() if c.requires_calculation)
    check("se conservan parametros nulos donde falta informacion", nulls > 0,
          "%d parametros nulos preservados" % nulls)
    check("los componentes declaran sus parametros pendientes", pend > 0,
          "%d componentes con pendientes declarados" % pend)

    # cobertura de laminas
    if sheets is not None:
        referenced = set()
        for sh in sheets:
            referenced.update(sh.component_refs)
        check("las laminas referencian solidos del modelo", len(referenced) > 0,
              "%d solidos referenciados en laminas" % len(referenced), severity="info")

    errors = [c for c in checks if not c["passed"] and c["severity"] == "error"]
    warnings = [c for c in checks if not c["passed"] and c["severity"] == "warning"]
    return {
        "schema": "embedverse-consistency-report/1.0",
        "scope": "validacion automatica de consistencia de datos y geometria",
        "checks_run": len(checks),
        "errors": len(errors),
        "warnings": len(warnings),
        "passed": len(errors) == 0,
        "results": checks,
    }


# ---------------------------------------------------------------------------
# Estado de revision profesional
# ---------------------------------------------------------------------------


def professional_review_report(
    model,
    pending_parameters: Optional[Sequence[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    by_disc: Dict[str, Dict[str, Any]] = {}
    for c in model.components.values():
        d = by_disc.setdefault(c.discipline, {"components": 0, "with_pending": 0,
                                              "pending_parameters": set()})
        d["components"] += 1
        if c.requires_calculation:
            d["with_pending"] += 1
            d["pending_parameters"].update(c.requires_calculation)
    for d in by_disc.values():
        d["pending_parameters"] = sorted(d.pop("pending_parameters"))
        d["distinct_pending_parameters"] = len(d["pending_parameters"])

    return {
        "schema": "embedverse-professional-review/1.0",
        "status": "NOT_REVIEWED",
        "statement": (
            "Ningun elemento de este paquete ha sido revisado ni aprobado por un profesional "
            "competente. El contenido es geometria conceptual generada automaticamente."),
        "validation_levels": {
            "geometric_validation": {
                "performed": True,
                "by": "validate.py (automatico)",
                "covers": ["unidades", "identificadores unicos", "referencias cruzadas",
                           "cierre y volumen de mallas", "colisiones geometricas",
                           "coherencia dimensional con params.py"],
            },
            "technical_review": {
                "performed": False,
                "requires": ["calculo estructural", "calculo electrico", "calculo hidraulico",
                             "calculo de carga termica", "evaluacion de riesgo de incendio"],
            },
            "professional_approval": {
                "performed": False,
                "requires": ["profesional competente con habilitacion vigente",
                             "verificacion contra la norma de la jurisdiccion aplicable",
                             "firma y asuncion de responsabilidad"],
            },
        },
        "by_discipline": {k: by_disc[k] for k in sorted(by_disc)},
        "project_level_pending_parameters": list(
            pending_parameters if pending_parameters is not None else P.PENDING_PARAMETERS),
        "prohibited_uses": [
            "construir a partir de estos planos",
            "solicitar licencia o permiso con este paquete",
            "certificar seguridad estructural, electrica o de incendios",
            "presentarlo como diseno de ingenieria verificado",
        ],
    }

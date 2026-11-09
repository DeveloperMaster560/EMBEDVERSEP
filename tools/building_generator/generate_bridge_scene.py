"""Genera un modelo de puente desde una especificacion y lo devuelve como escena.

Uso:
    python generate_bridge_scene.py     # lee la spec JSON por stdin, escribe JSON por stdout

Entrada (JSON):
    {"bridge_type": "beam", "length_m": 60.0, "width_m": 10.0,
     "deck_height_m": 7.0, "span_count": 3, "girder_count": 4,
     "lanes": 2, "sidewalks": true,
     "disciplines": ["structure", "deck", ...]}

Salida: misma forma que `generate_scene.py` para edificios, de modo que el
visor de la aplicacion sirve para los dos dominios sin cambios.

Si la solicitud no admite geometria coherente se devuelve
`{"ok": false, "spec_rejected": true, ...}`: es un rechazo, no un fallo.
"""

from __future__ import annotations

import base64
import importlib
import json
import sys
import time
from typing import Any, Dict, List

MAX_COMPONENTS = 20000


def build_scene(spec: Dict[str, Any]) -> Dict[str, Any]:
    t0 = time.time()

    import bridge_params as B

    importlib.reload(B)
    report = B.apply_spec(spec)

    for name in ("catalog", "oplog", "solids", "routing", "mepkit",
                 "validate", "export_model", "bridge_model", "engineering"):
        if name in sys.modules:
            importlib.reload(sys.modules[name])

    import bridge_model as BM
    import export_model as XM
    import validate as VAL
    from catalog import ParametricModel
    from oplog import OperationLog

    requested = spec.get("disciplines") or list(B.DISCIPLINES)
    chosen = BM.expand_disciplines(list(requested))
    added = sorted(set(chosen) - set(requested))

    model = ParametricModel(
        OperationLog(),
        disciplines=B.DISCIPLINES,
        materials=B.MATERIALS,
        project={"id": B.PROJECT_ID, "name": B.PROJECT_NAME, "domain": "bridge"},
        clash_roles=B.CLASH_ROLES,
    )
    BM.build(model, chosen)

    # Propiedades que se deducen de la geometria ya construida (seccion y peso
    # propio). No sustituyen al diseno: lo pendiente sigue declarado.
    import engineering as ENG

    engineering_report = ENG.enrich_structural(model, B.MATERIALS)

    if len(model.components) > MAX_COMPONENTS:
        raise ValueError(
            "La solicitud produce %d componentes, por encima del limite de %d de este "
            "generador en linea." % (len(model.components), MAX_COMPONENTS))

    scene, nodes, _failed = XM._build_scene(model)
    glb = scene.export(file_type="glb")

    clash, _clashes = VAL.clash_report(model)
    cons = VAL.consistency_report(model, domain_checks=B.domain_checks)
    actionable = sum(
        v for k, v in clash["by_severity"].items()
        if k in ("COLISION ESTRUCTURAL", "REVISAR TRAZADO", "REVISAR"))

    nulls = sum(1 for c in model.components.values()
                for v in c.parameters.values() if v is None)
    declarations = sum(len(c.requires_calculation) for c in model.components.values())

    # Las "zonas" del puente hacen en el visor el papel de los niveles de un
    # edificio: permiten aislar un vano, una pila o un estribo.
    #
    # `elevation` se conserva por compatibilidad de contrato, pero en un puente
    # no siempre es una cota: en pilas, vanos, estribos y torres es la abscisa
    # longitudinal. Por eso cada zona lleva `caption`, que dice con qué unidad y
    # con qué significado hay que leer el numero.
    def zone(level_id: str, name: str, value: float, caption: str) -> Dict[str, Any]:
        return {"level_id": level_id, "name": name,
                "elevation": round(value, 3), "caption": caption}

    zones: List[Dict[str, Any]] = [
        zone("CIM", "Cimentacion", -B.HYP_FOOTING_DEPTH,
             "cota %.2f m" % -B.HYP_FOOTING_DEPTH),
        zone("EA", "Estribo inicial", 0.0, "x = 0.00 m"),
    ]
    for i, x in enumerate(B.PIER_AXES, start=1):
        zones.append(zone("P%d" % i, "Pila %d" % i, x, "x = %.2f m" % x))
    for i in range(B.REQ_SPAN_COUNT):
        start, end = B.SPAN_EDGES[i], B.SPAN_EDGES[i + 1]
        zones.append(zone("V%d" % (i + 1), "Vano %d" % (i + 1), start,
                          "x %.2f a %.2f m" % (start, end)))
    zones.append(zone("EB", "Estribo final", B.REQ_LENGTH,
                      "x = %.2f m" % B.REQ_LENGTH))
    zones.append(zone("TAB", "Tablero", B.DECK_TOP, "cota %.2f m" % B.DECK_TOP))
    for i, x in enumerate(B.TOWER_AXES, start=1):
        zones.append(zone("T%d" % i, "Torre %d" % i, x, "x = %.2f m" % x))

    return {
        "ok": True,
        "domain": "bridge",
        "project_id": B.PROJECT_ID,
        "glb_base64": base64.b64encode(glb).decode("ascii"),
        "applied": report["applied"],
        "adjustments": report["adjustments"]
        + (["Se anadieron las disciplinas %s porque las pedidas dependen de ellas."
            % ", ".join(added)] if added else []),
        "counts": {
            "components": len(model.components),
            "connections": len(model.connections),
            "spaces": 0,
            "solids": len(model.solids),
            "operations": len(model.oplog),
            "nodes": nodes,
            "by_discipline": model.counts(),
        },
        "levels": zones,
        "spaces": [],
        "components": [
            {"component_id": c.component_id, "discipline": c.discipline,
             "type": c.type, "name": c.name, "level_id": c.level_id,
             "space_id": None, "material": c.material,
             "pending_count": len(c.requires_calculation)}
            for c in sorted(model.components.values(), key=lambda c: c.component_id)
        ],
        "validation": {
            "consistency_errors": cons["errors"],
            "consistency_warnings": cons["warnings"],
            "clash_count": clash["clash_count"],
            "clashes_by_severity": clash["by_severity"],
            "actionable_clashes": actionable,
        },
        "site": dict(B.SITE),
        "site_pending": B.site_pending(),
        "pending": {"null_parameters": nulls, "declarations": declarations},
        "engineering": engineering_report,
        "professional_review": "not_reviewed",
        "generation_ms": int((time.time() - t0) * 1000),
    }


def main() -> int:
    raw = sys.stdin.read()
    try:
        spec = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as exc:
        json.dump({"ok": False, "spec_rejected": False,
                   "error": "La especificacion no es JSON valido.",
                   "detail": str(exc)}, sys.stdout)
        return 2

    try:
        result = build_scene(spec)
    except Exception as exc:  # noqa: BLE001 - se reporta tal cual al cliente local
        import bridge_params as B

        rejected = isinstance(exc, (B.SpecError, ValueError))
        json.dump({
            "ok": False,
            "spec_rejected": bool(rejected),
            "error": ("La solicitud no admite una geometria de puente coherente."
                      if rejected else "El generador no pudo completar el modelo."),
            "detail": str(exc)[:600],
        }, sys.stdout)
        return 1

    json.dump(result, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())

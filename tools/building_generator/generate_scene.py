"""Genera un modelo de edificio desde una especificacion y lo devuelve como escena.

Uso:
    python generate_scene.py            # lee la spec JSON por stdin, escribe JSON por stdout

Entrada (JSON):
    {"levels": 3, "length_x_m": 24.0, "width_y_m": 18.0,
     "clear_height_m": 3.2, "floor_to_floor_m": 3.6,
     "disciplines": ["architecture", "structure", ...],
     "rooms_by_band": {"SOUTH": {"aula": 2}}}

Salida (JSON):
    {"ok": true, "glb_base64": "...", "applied": {...}, "counts": {...},
     "spaces": [...], "components": [...], "validation": {...}}

El GLB lleva un nodo por componente, nombrado
`disciplina__nivel__component_id`, de modo que el visor puede encender y
apagar disciplinas y niveles sin volver a generar.

Si la solicitud no admite geometria coherente se devuelve
`{"ok": false, "spec_rejected": true, ...}`: es un rechazo, no un fallo.
"""

from __future__ import annotations

import base64
import importlib
import io
import json
import sys
import time
from typing import Any, Dict, List

DISCIPLINE_MODULES = [
    ("structure", "discipline_structure"),
    ("architecture", "discipline_architecture"),
    ("electrical", "discipline_electrical"),
    ("telecommunications", "discipline_telecom"),
    ("hydrosanitary", "discipline_hydrosanitary"),
    ("hvac", "discipline_hvac"),
    ("security", "discipline_security"),
]

# La arquitectura necesita la estructura (escalera, ductos, rejilla) y todas
# las instalaciones necesitan los recintos. Estas dependencias se anaden solas.
REQUIRED_BY = {
    "architecture": {"structure"},
    "electrical": {"structure", "architecture"},
    "telecommunications": {"structure", "architecture"},
    "hydrosanitary": {"structure", "architecture"},
    "hvac": {"structure", "architecture"},
    "security": {"structure", "architecture"},
}

MAX_COMPONENTS = 20000


def _fresh_modules():
    """Recarga los modulos para que lean los parametros recien aplicados.

    Los modulos de disciplina leen `params` en tiempo de llamada, pero algunos
    valores se capturan al importar. Recargar garantiza que una segunda
    generacion en el mismo proceso no arrastre la solicitud anterior.
    """
    import params as P

    importlib.reload(P)
    return P


def _load_disciplines(names: List[str]):
    mods = {}
    for key, mod_name in DISCIPLINE_MODULES:
        if key not in names:
            continue
        if mod_name in sys.modules:
            mods[key] = importlib.reload(sys.modules[mod_name])
        else:
            mods[key] = importlib.import_module(mod_name)
    return mods


def expand_disciplines(requested: List[str]) -> List[str]:
    """Anade las disciplinas de las que dependen las pedidas."""
    chosen = set(requested or [])
    changed = True
    while changed:
        changed = False
        for key in list(chosen):
            for dep in REQUIRED_BY.get(key, ()):  # type: ignore[arg-type]
                if dep not in chosen:
                    chosen.add(dep)
                    changed = True
    order = [k for k, _ in DISCIPLINE_MODULES]
    return [k for k in order if k in chosen]


def build_scene(spec: Dict[str, Any]) -> Dict[str, Any]:
    t0 = time.time()
    P = _fresh_modules()
    report = P.apply_spec(spec)

    requested = spec.get("disciplines") or [k for k, _ in DISCIPLINE_MODULES]
    disciplines = expand_disciplines(list(requested))
    added = sorted(set(disciplines) - set(requested))

    mods = _load_disciplines(disciplines)

    for name in ("catalog", "oplog", "solids", "routing", "mepkit",
                 "validate", "export_model"):
        if name in sys.modules:
            importlib.reload(sys.modules[name])

    from catalog import BuildingModel
    from oplog import OperationLog

    model = BuildingModel(OperationLog())
    for key in disciplines:
        mods[key].build(model)
    if "electrical" in mods:
        mods["electrical"].build_equipment_circuits(model)

    if len(model.components) > MAX_COMPONENTS:
        raise ValueError(
            "La solicitud produce %d componentes, por encima del limite de %d de este "
            "generador en linea. Reduce niveles o superficie."
            % (len(model.components), MAX_COMPONENTS))

    import export_model as XM
    import validate as VAL

    scene, nodes, failed = XM._build_scene(model)
    glb = scene.export(file_type="glb")

    clash, clashes = VAL.clash_report(model)
    cons = VAL.consistency_report(model)

    actionable = sum(
        v for k, v in clash["by_severity"].items()
        if k in ("COLISION ESTRUCTURAL", "REVISAR TRAZADO", "REVISAR"))

    nulls = sum(1 for c in model.components.values()
                for v in c.parameters.values() if v is None)
    declarations = sum(len(c.requires_calculation) for c in model.components.values())

    return {
        "ok": True,
        "project_id": P.PROJECT_ID,
        "glb_base64": base64.b64encode(glb).decode("ascii"),
        "applied": report["applied"],
        "adjustments": report["adjustments"]
        + (["Se anadieron las disciplinas %s porque las pedidas dependen de ellas."
            % ", ".join(added)] if added else []),
        "counts": {
            "components": len(model.components),
            "connections": len(model.connections),
            "spaces": len(model.spaces),
            "solids": len(model.solids),
            "operations": len(model.oplog),
            "nodes": nodes,
            "by_discipline": model.counts(),
        },
        "levels": [{"level_id": lv["level_id"], "name": lv["name"],
                    "elevation": lv["elevation"],
                    "caption": "cota %.2f m" % lv["elevation"]}
                   for lv in P.ALL_LEVELS],
        "spaces": [
            {"space_id": s.space_id, "code": s.code, "name": s.name, "use": s.use,
             "level_id": s.level_id, "area_m2": s.area_m2}
            for s in sorted(model.spaces.values(), key=lambda s: (s.level_id, s.code))
        ],
        "components": [
            {"component_id": c.component_id, "discipline": c.discipline,
             "type": c.type, "name": c.name, "level_id": c.level_id,
             "space_id": c.space_id, "material": c.material,
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
        "pending": {"null_parameters": nulls, "declarations": declarations},
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
        import params as P

        rejected = isinstance(exc, (P.SpecError, ValueError))
        json.dump({
            "ok": False,
            "spec_rejected": bool(rejected),
            "error": ("La solicitud no admite una geometria coherente."
                      if rejected else "El generador no pudo completar el modelo."),
            "detail": str(exc)[:600],
        }, sys.stdout)
        return 1

    json.dump(result, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())

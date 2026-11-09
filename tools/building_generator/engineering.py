"""Propiedades de ingenieria derivadas de la geometria, calculadas con embedlib.

QUE HACE Y QUE NO
-----------------
Este modulo rellena UNICAMENTE lo que se deduce de la geometria ya modelada y
de una densidad declarada:

  * propiedades de seccion  (area, inercias, modulos resistentes)
  * peso propio             (volumen real del solido x densidad del material)
  * area nominal de barra   (cuando se entrega un diametro)

NO calcula esfuerzos, flechas, armadura, pretensado ni combinaciones de carga.
Eso exige f'c, modulo elastico, cargas y factores de norma que el generador no
conoce: siguen en `requires_calculation` y sus parametros siguen en None. Un
valor calculado aqui nunca sustituye a un diseno estructural.

Los numeros provienen de `embedlib` (biblioteca propia del proyecto), de modo
que la formula, su unidad y su referencia quedan trazadas en un solo sitio. Si
embedlib no esta disponible no se inventa nada: se declara por que falta.
"""

from __future__ import annotations

import math
import os
import sys
from typing import Any, Dict, List, Optional, Tuple

# Unico punto donde este paquete depende de embedlib.
_EMBEDLIB_ERROR: Optional[str] = None
_EMBEDLIB_VERSION: Optional[str] = None


def _candidate_paths() -> List[str]:
    """Rutas donde buscar `embedlib/src`, de la mas explicita a la mas general."""
    here = os.path.dirname(os.path.abspath(__file__))
    project = os.path.abspath(os.path.join(here, "..", ".."))
    downloads = os.path.abspath(os.path.join(project, ".."))
    out = []
    env = os.environ.get("EMBEDVERSE_EMBEDLIB")
    if env:
        out.append(env)
    out.append(os.path.join(project, "vendor", "embedlib", "src"))
    out.append(os.path.join(downloads, "embedlib", "src"))
    return out


def _load_embedlib():
    """Importa embedlib si se puede. Devuelve el modulo o None."""
    global _EMBEDLIB_ERROR, _EMBEDLIB_VERSION
    try:
        import embedlib  # noqa: F401
    except ImportError:
        for path in _candidate_paths():
            if os.path.isdir(path) and path not in sys.path:
                sys.path.insert(0, path)
        try:
            import embedlib  # noqa: F401
        except ImportError as exc:
            _EMBEDLIB_ERROR = (
                "No se encontro embedlib (%s). Define EMBEDVERSE_EMBEDLIB con la "
                "ruta de su carpeta `src` o colocala en vendor/embedlib/src."
                % exc)
            return None
    try:
        from embedlib.calc import structures  # noqa: F401
    except ImportError as exc:
        _EMBEDLIB_ERROR = "embedlib esta presente pero sin calc.structures: %s" % exc
        return None
    _EMBEDLIB_VERSION = getattr(sys.modules["embedlib"], "__version__", "desconocida")
    return sys.modules["embedlib"]


_EMBEDLIB = _load_embedlib()


def availability() -> Dict[str, Any]:
    """Estado de la dependencia, para que el informe no lo oculte."""
    return {
        "embedlib_available": _EMBEDLIB is not None,
        "embedlib_version": _EMBEDLIB_VERSION,
        "reason_unavailable": _EMBEDLIB_ERROR,
    }


# ---------------------------------------------------------------------------
# Propiedades de seccion
# ---------------------------------------------------------------------------
#
# La seccion se decide por TIPO de componente, nunca adivinando a partir de los
# nombres de las dimensiones: una losa de 24x18x0.12 m tiene tres medidas y
# ninguna pareja de ellas es "su seccion". Lo que no este en estos mapas no
# recibe propiedades y se cuenta como no cubierto.

#: Piezas prismaticas donde una seccion transversal si significa algo.
#: valor = (clave_ancho, clave_canto) para seccion rectangular,
#:         (clave_diametro,)          para seccion circular.
LINEAR_SECTIONS = {
    # edificacion
    "beam": ("width", "web_depth"),
    "column": ("width", "depth"),
    "pedestal": ("width", "depth"),
    # puentes
    "main_girder": ("width", "depth"),
    "diaphragm": ("width", "depth"),
    "pier_cap": ("width", "depth"),
    "tower": ("width", "depth"),
    "pier_column": ("diameter",),
    "stay_cable": ("diameter",),
}

#: Piezas laminares: el canto manda y las propiedades se dan POR METRO DE ANCHO,
#: que es como se maneja realmente una losa o una zapata.
PLATE_THICKNESS = {
    # edificacion
    "floor_slab": "thickness",
    "roof_slab": "thickness",
    "slab_on_grade": "thickness",
    "stair_landing": "thickness",
    "stair_flight": "waist",
    "footing": "thickness",
    # puentes
    "deck_slab": "thickness",
    "solid_slab_span": "depth",
    "wearing_course": "thickness",
    "wingwall": "thickness",
    "abutment": "thickness",
    "sidewalk": "height",
}

#: Piezas sin seccion resistente util: nudos sin geometria propia, juntas que
#: son un hueco y apoyos laminados de neopreno.
NO_SECTION = {"beam_column_joint", "expansion_joint", "bearing"}

_T_BEAM_NOTE = ("Seccion rectangular del alma; no considera el ancho eficaz de "
                "losa que colabora en una seccion en T.")


def _rect_properties(width_m, height_m, note=None):
    from embedlib.calc.structures import rectangle_inertia

    ix = rectangle_inertia(width_m, height_m)
    iy = rectangle_inertia(height_m, width_m)
    out = {
        "shape": "rectangular",
        "width_m": round(width_m, 6),
        "height_m": round(height_m, 6),
        "area_m2": round(width_m * height_m, 8),
        "inertia_x_m4": round(ix.value, 10),
        "inertia_y_m4": round(iy.value, 10),
        "section_modulus_x_m3": round(ix.value / (height_m / 2.0), 10),
        "section_modulus_y_m3": round(iy.value / (width_m / 2.0), 10),
        "reference": ix.reference,
    }
    if note:
        out["note"] = note
    return out


def _circle_properties(diameter_m):
    from embedlib.calc.structures import circle_inertia

    inertia = circle_inertia(diameter_m)
    return {
        "shape": "circular",
        "diameter_m": round(diameter_m, 6),
        "area_m2": round(math.pi * diameter_m ** 2 / 4.0, 8),
        "inertia_x_m4": round(inertia.value, 10),
        "inertia_y_m4": round(inertia.value, 10),
        "section_modulus_x_m3": round(inertia.value / (diameter_m / 2.0), 10),
        "section_modulus_y_m3": round(inertia.value / (diameter_m / 2.0), 10),
        "reference": inertia.reference,
    }


def _plate_properties(thickness_m, dimensions):
    """Propiedades por metro de ancho de una pieza laminar."""
    from embedlib.calc.structures import rectangle_inertia

    inertia = rectangle_inertia(1.0, thickness_m)
    out = {
        "shape": "placa",
        "thickness_m": round(thickness_m, 6),
        "inertia_per_m_width_m4_per_m": round(inertia.value, 10),
        "section_modulus_per_m_width_m3_per_m": round(
            inertia.value / (thickness_m / 2.0), 10),
        "reference": inertia.reference,
        "note": ("Propiedades por metro de ancho de franja. Una placa no tiene "
                 "una unica seccion resistente; el reparto real depende del "
                 "analisis, que este generador no hace."),
    }
    largo = dimensions.get("length")
    ancho = dimensions.get("width")
    if isinstance(largo, (int, float)) and isinstance(ancho, (int, float)):
        out["plan_area_m2"] = round(float(largo) * float(ancho), 6)
    return out


def _value(dimensions, key):
    v = dimensions.get(key)
    return float(v) if isinstance(v, (int, float)) and v > 0 else None


def section_properties(component_type, dimensions):
    """Propiedades de seccion segun el TIPO de pieza.

    Devuelve None cuando el tipo no tiene una seccion que signifique algo o
    cuando faltan las medidas: es preferible no declarar nada a declarar una
    seccion que no corresponde.
    """
    if _EMBEDLIB is None or not isinstance(dimensions, dict):
        return None
    if component_type in NO_SECTION:
        return None

    claves = LINEAR_SECTIONS.get(component_type)
    if claves is not None:
        if len(claves) == 1:
            diametro = _value(dimensions, claves[0])
            return _circle_properties(diametro) if diametro else None
        ancho = _value(dimensions, claves[0])
        canto = _value(dimensions, claves[1])
        if ancho is None or canto is None:
            return None
        nota = _T_BEAM_NOTE if component_type == "beam" else None
        return _rect_properties(ancho, canto, nota)

    clave = PLATE_THICKNESS.get(component_type)
    if clave is not None:
        espesor = _value(dimensions, clave)
        return _plate_properties(espesor, dimensions) if espesor else None

    return None


# ---------------------------------------------------------------------------
# Peso propio
# ---------------------------------------------------------------------------

def self_weight(volume_m3: float, density_kg_m3: float) -> Optional[Dict[str, Any]]:
    """Peso propio a partir del volumen real del solido y la densidad declarada."""
    if not (isinstance(volume_m3, (int, float)) and volume_m3 > 0):
        return None
    if not (isinstance(density_kg_m3, (int, float)) and density_kg_m3 > 0):
        return None
    mass = float(volume_m3) * float(density_kg_m3)
    return {
        "volume_m3": round(float(volume_m3), 6),
        "density_kg_m3": float(density_kg_m3),
        "mass_kg": round(mass, 3),
        "weight_kN": round(mass * 9.80665 / 1000.0, 4),
        "reference": "Peso propio = volumen del solido x densidad declarada del material.",
    }


def rebar_nominal_area_mm2(diameter_mm: float) -> Optional[float]:
    """Area nominal de una barra. Solo geometria; no decide cuantas barras hay."""
    if _EMBEDLIB is None or not (isinstance(diameter_mm, (int, float)) and diameter_mm > 0):
        return None
    from embedlib.calc.structures import rebar_area

    return round(rebar_area(float(diameter_mm)).value, 4)


# ---------------------------------------------------------------------------
# Enriquecimiento del modelo
# ---------------------------------------------------------------------------

#: Lo que estas propiedades NO resuelven y sigue siendo trabajo de diseno.
STILL_PENDING = [
    "specified_concrete_strength_fc",
    "elastic_modulus",
    "design_loads",
    "load_combinations",
    "reinforcement_layout",
    "code_compliance_check",
]

#: Disciplinas cuyas piezas son portantes y merecen estas propiedades.
STRUCTURAL_DISCIPLINES = {"structure"}


def enrich_structural(model, materials: Dict[str, Any]) -> Dict[str, Any]:
    """Anade seccion y peso propio a las piezas estructurales del modelo.

    No modifica geometria ni elimina ningun pendiente: solo rellena lo que ya
    era deducible y estaba sin declarar. Devuelve un informe de lo hecho.
    """
    report: Dict[str, Any] = dict(availability())
    report.update({
        "components_examined": 0,
        "section_properties_added": 0,
        "self_weight_added": 0,
        "skipped_no_section": 0,
        "skipped_no_volume": 0,
        "uncovered_types": {},
        "total_mass_kg": 0.0,
        "still_pending": list(STILL_PENDING),
    })
    if _EMBEDLIB is None:
        report["note"] = (
            "Sin embedlib no se calcula seccion ni peso propio; los parametros "
            "quedan en None y se declaran como pendientes.")
        return report

    for comp in model.components.values():
        if comp.discipline not in STRUCTURAL_DISCIPLINES:
            continue
        report["components_examined"] += 1

        props = section_properties(comp.type, comp.dimensions or {})
        if props is not None:
            comp.parameters["section_properties"] = props
            report["section_properties_added"] += 1
        else:
            report["skipped_no_section"] += 1
            # Un tipo sin clasificar no se calcula a ojo: se deja anotado para
            # que se vea que falta cubrirlo.
            if comp.type not in NO_SECTION:
                report["uncovered_types"][comp.type] = (
                    report["uncovered_types"].get(comp.type, 0) + 1)

        weight = None
        solid = model.solids.get(comp.geometry_reference) if comp.geometry_reference else None
        density = (materials.get(comp.material) or {}).get("density_kg_m3")
        if solid is not None and density:
            try:
                weight = self_weight(solid.volume(), float(density))
            except Exception:  # noqa: BLE001 - una malla invalida no debe romper el modelo
                weight = None
        if weight is not None:
            comp.parameters["self_weight"] = weight
            report["self_weight_added"] += 1
            report["total_mass_kg"] += weight["mass_kg"]
        else:
            report["skipped_no_volume"] += 1

        if props is not None or weight is not None:
            comp.parameters["derived_properties_source"] = (
                "embedlib %s" % (_EMBEDLIB_VERSION or "desconocida"))
            for key in STILL_PENDING:
                if key not in comp.requires_calculation:
                    comp.requires_calculation.append(key)

    report["total_mass_kg"] = round(report["total_mass_kg"], 2)
    report["total_weight_kN"] = round(report["total_mass_kg"] * 9.80665 / 1000.0, 2)
    return report

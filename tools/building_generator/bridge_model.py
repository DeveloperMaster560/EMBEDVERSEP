"""Modelo paramétrico multidisciplinario de puente.

Construye, desde `bridge_params`, las siete disciplinas del puente:

    structure        vigas, diafragmas, pilas, estribos, cimentación,
                     apoyos de neopreno, juntas, torres y tirantes
    deck             losa, carpeta de rodadura, aceras y bordillos
    barriers         barreras y barandas
    drainage         sumideros, bajantes y colector
    lighting         postes, luminarias, canalización y circuito
    signage          señales verticales y marcas viales
    instrumentation  sensores estructurales, gabinete y cableado

ADVERTENCIA DE ALCANCE
----------------------
Todas las secciones son HIPÓTESIS GEOMÉTRICAS CONCEPTUALES. No provienen de
análisis estructural, no están verificadas frente a ninguna norma de puentes y
no incluyen refuerzo ni pretensado. Cada componente registra en
`requires_calculation` lo que un diseño real debe determinar.

Reparto vertical adoptado (sin solapes):

    carpeta de rodadura   DECK_TOP .. DECK_TOP + espesor de carpeta
    losa del tablero      DECK_BOTTOM .. DECK_TOP
    vigas principales     STRUCTURE_BOTTOM .. DECK_BOTTOM
    apoyos                bajo el fondo de viga
    cabezal de pila       bajo los apoyos
    columnas de pila      hasta la cimentación
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Sequence, Tuple

import bridge_params as B
import mepkit as K
import solids as S
from catalog import Component, Connection

CONCRETE_PENDING = [
    "specified_concrete_strength_fc",
    "reinforcement_layout",
    "design_loads",
    "load_combinations",
    "code_compliance_check",
]

Point3 = Tuple[float, float, float]


def _register(model, comp: Component, solid: Optional[S.Solid], op: Optional[str]) -> Component:
    if solid is not None:
        model.add_solid(solid)
        comp.geometry_reference = solid.solid_id
    if op:
        comp.operations.append(op)
    model.add_component(comp)
    return comp


def _solid(sid: str, prims, material: str, discipline: str, zone: str, layer: str) -> S.Solid:
    return S.Solid(sid, list(prims), material, discipline, zone, layer)


def support_axes() -> List[Tuple[str, float]]:
    """Ejes de apoyo: estribo inicial, pilas intermedias y estribo final."""
    axes: List[Tuple[str, float]] = [("EA", 0.0)]
    for i, x in enumerate(B.PIER_AXES, start=1):
        axes.append(("P%d" % i, x))
    axes.append(("EB", B.REQ_LENGTH))
    return axes


def girder_bottom() -> float:
    return B.STRUCTURE_BOTTOM


def bearing_top() -> float:
    """Cota superior del apoyo: justo bajo el fondo de la estructura."""
    return round(girder_bottom() - 0.01, 4)


def cap_top() -> float:
    return round(bearing_top() - B.HYP_BEARING_SIZE[2], 4)


# ---------------------------------------------------------------------------
# Cimentación
# ---------------------------------------------------------------------------


def build_foundations(model) -> None:
    fw, fl = B.HYP_FOOTING_PLAN
    ft = B.HYP_FOOTING_THICKNESS
    top = -B.HYP_FOOTING_DEPTH
    base = round(top - ft, 4)

    for tag, x in support_axes():
        cid = "EST-ZAP-%s" % tag
        sid = "SOL-%s" % cid
        prism = S.box_prism(x - fl / 2, -fw / 2, x + fl / 2, fw / 2, base, top)
        solid = _solid(sid, [prism], "concreto_estructural", "structure", "CIM",
                       "EST-CIMENTACION")
        op = model.oplog.record(
            "extrude", "creation",
            "Zapata conceptual del eje %s: %.2f x %.2f m, espesor %.2f m, cara superior "
            "a %.2f m bajo el terreno." % (tag, fl, fw, ft, B.HYP_FOOTING_DEPTH),
            component_id=cid, solid_id=sid,
            inputs={"axis": tag, "x": x, "plan": [fl, fw], "thickness": ft,
                    "z_base": base, "z_top": top},
            outputs={"volume_m3": round(fl * fw * ft, 4)},
            derived_from=["HYP_FOOTING_PLAN", "HYP_FOOTING_THICKNESS", "HYP_FOOTING_DEPTH"],
            implementation="solids.Prism (extrusion en Z)",
        )
        _register(model, Component(
            component_id=cid, discipline="structure", type="footing",
            name="Zapata conceptual %s" % tag, level_id="CIM",
            material="concreto_estructural", ifc_class="IfcFooting",
            position=[x, 0.0, base],
            dimensions={"length": fl, "width": fw, "thickness": ft},
            parameters={
                "support_axis": tag, "plan_dimensions_m": [fl, fw],
                "thickness_m": ft, "embedment_depth_m": B.HYP_FOOTING_DEPTH,
                "bearing_capacity_kPa": None, "soil_study_reference": None,
                "scour_depth_m": None, "pile_design": None,
                "specified_concrete_strength_fc": None, "reinforcement_layout": None,
                "settlement_check": None,
            },
            requires_calculation=CONCRETE_PENDING + [
                "bearing_capacity_kPa", "soil_study_reference", "scour_depth_m",
                "pile_design", "settlement_check"],
            provenance="hypothesis", tags=["cimentacion", "conceptual"],
            validation_notes=[
                "Dimension adoptada sin estudio geotecnico ni de socavacion.",
                "En un cauce, la cimentacion de pila exige estudio hidraulico.",
            ],
        ), solid, op)


# ---------------------------------------------------------------------------
# Subestructura: pilas y estribos
# ---------------------------------------------------------------------------


def build_piers(model) -> None:
    d = B.HYP_PIER_COLUMN_DIAMETER
    n = B.HYP_PIER_COLUMNS_PER_AXIS
    cap_z1 = cap_top()
    cap_z0 = round(cap_z1 - B.HYP_PIER_CAP_DEPTH, 4)
    foot_top = -B.HYP_FOOTING_DEPTH

    usable = B.REQ_WIDTH - 2.0
    offsets = [round(-usable / 2 + usable * i / max(1, n - 1), 4) for i in range(n)] \
        if n > 1 else [0.0]

    for i, x in enumerate(B.PIER_AXES, start=1):
        tag = "P%d" % i
        # --- cabezal ---
        cid = "EST-CAB-%s" % tag
        sid = "SOL-%s" % cid
        prism = S.box_prism(x - B.HYP_PIER_CAP_WIDTH / 2, -B.REQ_WIDTH / 2,
                            x + B.HYP_PIER_CAP_WIDTH / 2, B.REQ_WIDTH / 2,
                            cap_z0, cap_z1)
        solid = _solid(sid, [prism], "concreto_estructural", "structure", tag, "EST-PILAS")
        op = model.oplog.record(
            "extrude", "creation",
            "Cabezal de la pila %s: %.2f m de ancho por %.2f m de canto, bajo los apoyos."
            % (tag, B.HYP_PIER_CAP_WIDTH, B.HYP_PIER_CAP_DEPTH),
            component_id=cid, solid_id=sid,
            inputs={"axis": tag, "x": x, "cap_width": B.HYP_PIER_CAP_WIDTH,
                    "cap_depth": B.HYP_PIER_CAP_DEPTH, "z0": cap_z0, "z1": cap_z1},
            outputs={"length_m": B.REQ_WIDTH},
            derived_from=["HYP_PIER_CAP_WIDTH", "HYP_PIER_CAP_DEPTH", "REQ_WIDTH"],
            implementation="solids.Prism (extrusion en Z)",
        )
        _register(model, Component(
            component_id=cid, discipline="structure", type="pier_cap",
            name="Cabezal de pila %s" % tag, level_id=tag,
            material="concreto_estructural", ifc_class="IfcBeam",
            position=[x, 0.0, cap_z0],
            dimensions={"width": B.HYP_PIER_CAP_WIDTH, "depth": B.HYP_PIER_CAP_DEPTH,
                        "length": B.REQ_WIDTH},
            parameters={
                "support_axis": tag, "section_m": [B.HYP_PIER_CAP_WIDTH, B.HYP_PIER_CAP_DEPTH],
                "length_m": B.REQ_WIDTH, "specified_concrete_strength_fc": None,
                "reinforcement_layout": None, "design_shear_kN": None,
                "bearing_reactions_kN": None,
            },
            requires_calculation=CONCRETE_PENDING + ["design_shear_kN", "bearing_reactions_kN"],
            provenance="hypothesis", tags=["pila", "conceptual"],
        ), solid, op)

        # --- columnas ---
        for k, off in enumerate(offsets, start=1):
            ccid = "EST-PIL-%s-C%d" % (tag, k)
            csid = "SOL-%s" % ccid
            column = S.pipe((x, off, foot_top), (x, off, cap_z0), d)
            csolid = _solid(csid, [column], "concreto_estructural", "structure", tag,
                            "EST-PILAS")
            cop = model.oplog.record(
                "sweep_polyline", "creation",
                "Columna %d de la pila %s: fuste circular de %.2f m de diametro desde la "
                "zapata (%.2f) hasta el cabezal (%.2f)." % (k, tag, d, foot_top, cap_z0),
                component_id=ccid, solid_id=csid,
                inputs={"axis": tag, "x": x, "y": off, "diameter": d,
                        "z0": foot_top, "z1": cap_z0},
                outputs={"height_m": round(cap_z0 - foot_top, 4)},
                derived_from=["HYP_PIER_COLUMN_DIAMETER", "HYP_PIER_COLUMNS_PER_AXIS"],
                implementation="solids.pipe (barrido circular vertical)",
            )
            _register(model, Component(
                component_id=ccid, discipline="structure", type="pier_column",
                name="Columna %d de pila %s" % (k, tag), level_id=tag,
                material="concreto_estructural", ifc_class="IfcColumn",
                position=[x, off, foot_top],
                dimensions={"diameter": d, "height": round(cap_z0 - foot_top, 4)},
                parameters={
                    "support_axis": tag, "diameter_m": d,
                    "height_m": round(cap_z0 - foot_top, 4),
                    "specified_concrete_strength_fc": None,
                    "longitudinal_reinforcement": None, "transverse_reinforcement": None,
                    "axial_load_kN": None, "slenderness_check": None,
                    "scour_protection": None,
                },
                requires_calculation=CONCRETE_PENDING + [
                    "axial_load_kN", "slenderness_check", "scour_protection"],
                provenance="hypothesis", tags=["pila", "conceptual"],
            ), csolid, cop)
            model.relate(ccid, "supported_by", "EST-ZAP-%s" % tag)
            model.relate(cid, "supported_by", ccid)
            K.link(model, connection_id="CNX-EST-%s-C%d-CAB" % (tag, k),
                   discipline="structure", type="structural_joint",
                   origin=ccid, destination=cid, medium="monolitico_concreto",
                   technology="nudo columna-cabezal",
                   parameters={"joint_type": "monolitica", "rebar_continuity": None},
                   requires_calculation=["rebar_continuity"], provenance="hypothesis")


def build_abutments(model) -> None:
    t = B.HYP_ABUTMENT_THICKNESS
    wl = B.HYP_ABUTMENT_WINGWALL_LENGTH
    wt = B.HYP_ABUTMENT_WINGWALL_THICKNESS
    top = cap_top()
    base = -B.HYP_FOOTING_DEPTH

    for tag, x, sign in (("EA", 0.0, 1.0), ("EB", B.REQ_LENGTH, -1.0)):
        # --- muro frontal ---
        cid = "EST-EST-%s" % tag
        sid = "SOL-%s" % cid
        x0 = x - t / 2
        prism = S.box_prism(x0, -B.REQ_WIDTH / 2, x0 + t, B.REQ_WIDTH / 2, base, top)
        solid = _solid(sid, [prism], "concreto_estructural", "structure", tag,
                       "EST-ESTRIBOS")
        op = model.oplog.record(
            "extrude", "creation",
            "Estribo %s: muro frontal de %.2f m de espesor y %.2f m de altura."
            % (tag, t, top - base),
            component_id=cid, solid_id=sid,
            inputs={"axis": tag, "x": x, "thickness": t, "z0": base, "z1": top},
            outputs={"height_m": round(top - base, 4), "length_m": B.REQ_WIDTH},
            derived_from=["HYP_ABUTMENT_THICKNESS", "HYP_FOOTING_DEPTH", "REQ_WIDTH"],
            implementation="solids.Prism (extrusion en Z)",
        )
        _register(model, Component(
            component_id=cid, discipline="structure", type="abutment",
            name="Estribo %s" % tag, level_id=tag,
            material="concreto_estructural", ifc_class="IfcWall",
            position=[x0, -B.REQ_WIDTH / 2, base],
            dimensions={"thickness": t, "height": round(top - base, 4),
                        "length": B.REQ_WIDTH},
            parameters={
                "support_axis": tag, "thickness_m": t,
                "height_m": round(top - base, 4),
                "earth_pressure_kPa": None, "backfill_specification": None,
                "specified_concrete_strength_fc": None, "reinforcement_layout": None,
                "sliding_check": None, "overturning_check": None,
            },
            requires_calculation=CONCRETE_PENDING + [
                "earth_pressure_kPa", "backfill_specification",
                "sliding_check", "overturning_check"],
            provenance="hypothesis", tags=["estribo", "conceptual"],
            validation_notes=["Empuje de tierras y estabilidad sin verificar."],
        ), solid, op)
        model.relate(cid, "supported_by", "EST-ZAP-%s" % tag)

        # --- aletas ---
        for side, y in (("L", -B.REQ_WIDTH / 2), ("R", B.REQ_WIDTH / 2)):
            wcid = "EST-ALE-%s-%s" % (tag, side)
            wsid = "SOL-%s" % wcid
            wx0 = min(x, x + sign * wl)
            wx1 = max(x, x + sign * wl)
            wprism = S.box_prism(wx0, y - wt / 2, wx1, y + wt / 2, base, top)
            wsolid = _solid(wsid, [wprism], "concreto_estructural", "structure", tag,
                            "EST-ESTRIBOS")
            wop = model.oplog.record(
                "extrude", "creation",
                "Aleta %s del estribo %s: %.2f m de desarrollo y %.2f m de espesor."
                % (side, tag, wl, wt),
                component_id=wcid, solid_id=wsid,
                inputs={"axis": tag, "side": side, "x0": wx0, "x1": wx1,
                        "thickness": wt, "z0": base, "z1": top},
                outputs={"length_m": wl},
                derived_from=["HYP_ABUTMENT_WINGWALL_LENGTH",
                              "HYP_ABUTMENT_WINGWALL_THICKNESS"],
                implementation="solids.Prism (extrusion en Z)",
            )
            _register(model, Component(
                component_id=wcid, discipline="structure", type="wingwall",
                name="Aleta %s del estribo %s" % (side, tag), level_id=tag,
                material="concreto_estructural", ifc_class="IfcWall",
                position=[wx0, y, base],
                dimensions={"length": wl, "thickness": wt, "height": round(top - base, 4)},
                parameters={"support_axis": tag, "side": side, "length_m": wl,
                            "thickness_m": wt, "earth_pressure_kPa": None,
                            "specified_concrete_strength_fc": None,
                            "reinforcement_layout": None},
                requires_calculation=CONCRETE_PENDING + ["earth_pressure_kPa"],
                provenance="hypothesis", tags=["estribo", "aleta", "conceptual"],
            ), wsolid, wop)
            model.relate(wcid, "connected_to", cid)


# ---------------------------------------------------------------------------
# Apoyos y juntas
# ---------------------------------------------------------------------------


def bearing_offsets() -> List[float]:
    if B.REQ_TYPE == "beam":
        return list(B.GIRDER_OFFSETS)
    usable = B.REQ_WIDTH - 2.0
    return [round(-usable / 2, 4), 0.0, round(usable / 2, 4)]


def build_bearings(model) -> None:
    bw, bl, bh = B.HYP_BEARING_SIZE
    z1 = bearing_top()
    z0 = round(z1 - bh, 4)

    for tag, x in support_axes():
        for k, off in enumerate(bearing_offsets(), start=1):
            cid = "EST-APO-%s-%02d" % (tag, k)
            sid = "SOL-%s" % cid
            prism = S.box_prism(x - bl / 2, off - bw / 2, x + bl / 2, off + bw / 2, z0, z1)
            solid = _solid(sid, [prism], "neopreno", "structure", tag, "EST-APOYOS")
            op = model.oplog.record(
                "extrude", "creation",
                "Apoyo de neopreno %s en el eje %s: %.2f x %.2f x %.3f m."
                % (cid, tag, bl, bw, bh),
                component_id=cid, solid_id=sid,
                inputs={"axis": tag, "x": x, "y": off, "size": [bl, bw, bh],
                        "z0": z0, "z1": z1},
                outputs={}, derived_from=["HYP_BEARING_SIZE"],
                implementation="solids.Prism (extrusion en Z)",
            )
            _register(model, Component(
                component_id=cid, discipline="structure", type="bearing",
                name="Apoyo de neopreno %s-%02d" % (tag, k), level_id=tag,
                material="neopreno", ifc_class="IfcDiscreteAccessory",
                position=[x, off, z0],
                dimensions={"length": bl, "width": bw, "height": bh},
                parameters={
                    "support_axis": tag, "bearing_type": "elastomerico (hipotesis)",
                    "plan_dimensions_m": [bl, bw], "thickness_m": bh,
                    "vertical_reaction_kN": None, "horizontal_movement_mm": None,
                    "rotation_capacity_rad": None, "allowable_pressure_MPa": None,
                },
                requires_calculation=["vertical_reaction_kN", "horizontal_movement_mm",
                                      "rotation_capacity_rad", "allowable_pressure_MPa"],
                provenance="hypothesis", tags=["apoyo", "conceptual"],
                validation_notes=["Dimension adoptada sin calculo de reacciones."],
            ), solid, op)
            support = ("EST-CAB-%s" % tag) if tag.startswith("P") else ("EST-EST-%s" % tag)
            if support in model.components:
                model.relate(cid, "supported_by", support)


def build_joints(model) -> None:
    gap = B.HYP_JOINT_GAP
    depth = B.HYP_JOINT_DEPTH
    z1 = B.DECK_TOP
    z0 = round(z1 - depth, 4)

    for tag, x in (("EA", 0.0), ("EB", B.REQ_LENGTH)):
        cid = "EST-JUN-%s" % tag
        sid = "SOL-%s" % cid
        prism = S.box_prism(x - gap / 2, -B.REQ_WIDTH / 2, x + gap / 2,
                            B.REQ_WIDTH / 2, z0, z1)
        solid = _solid(sid, [prism], "junta_dilatacion", "structure", tag, "EST-JUNTAS")
        op = model.oplog.record(
            "extrude", "creation",
            "Junta de dilatacion en el eje %s: abertura adoptada de %.0f mm."
            % (tag, gap * 1000),
            component_id=cid, solid_id=sid,
            inputs={"axis": tag, "x": x, "gap": gap, "depth": depth},
            outputs={"length_m": B.REQ_WIDTH},
            derived_from=["HYP_JOINT_GAP", "HYP_JOINT_DEPTH", "REQ_WIDTH"],
            implementation="solids.Prism (extrusion en Z)",
        )
        _register(model, Component(
            component_id=cid, discipline="structure", type="expansion_joint",
            name="Junta de dilatacion %s" % tag, level_id=tag,
            material="junta_dilatacion", ifc_class="IfcDiscreteAccessory",
            position=[x, 0.0, z0],
            dimensions={"gap": gap, "depth": depth, "length": B.REQ_WIDTH},
            parameters={
                "support_axis": tag, "nominal_gap_m": gap,
                "movement_range_mm": None, "thermal_range_C": None,
                "joint_type": None, "waterproofing": None,
            },
            requires_calculation=["movement_range_mm", "thermal_range_C",
                                  "joint_type", "waterproofing"],
            provenance="hypothesis", tags=["junta", "conceptual"],
            validation_notes=["La abertura depende del rango termico y del acortamiento, "
                              "que no se han calculado."],
        ), solid, op)


# ---------------------------------------------------------------------------
# Superestructura
# ---------------------------------------------------------------------------


def build_superstructure(model) -> None:
    if B.REQ_TYPE == "slab":
        _build_solid_slab(model)
    else:
        _build_girders(model)
        _build_diaphragms(model)


def _build_girders(model) -> None:
    gw = B.HYP_GIRDER_WIDTH
    gd = B.GIRDER_DEPTH
    z1 = B.DECK_BOTTOM
    z0 = round(z1 - gd, 4)
    material = "concreto_pretensado" if B.SPAN_LENGTH > 18.0 else "concreto_estructural"

    for s in range(B.REQ_SPAN_COUNT):
        x0, x1 = _span_limits(s)
        zone = "V%d" % (s + 1)
        for k, off in enumerate(B.GIRDER_OFFSETS, start=1):
            cid = "EST-VIG-%s-G%d" % (zone, k)
            sid = "SOL-%s" % cid
            prism = S.box_prism(x0, off - gw / 2, x1, off + gw / 2, z0, z1)
            solid = _solid(sid, [prism], material, "structure", zone, "EST-VIGAS")
            op = model.oplog.record(
                "extrude", "creation",
                "Viga principal %d del vano %d: luz %.2f m, seccion %.2f x %.2f m. "
                "El canto se adopta como luz x %.3f, acotado entre %.2f y %.2f m."
                % (k, s + 1, x1 - x0, gw, gd, B.HYP_GIRDER_DEPTH_RATIO,
                   B.HYP_GIRDER_DEPTH_MIN, B.HYP_GIRDER_DEPTH_MAX),
                component_id=cid, solid_id=sid,
                inputs={"span": s + 1, "girder": k, "x0": x0, "x1": x1, "y": off,
                        "section": [gw, gd], "z0": z0, "z1": z1,
                        "depth_rule": "luz x HYP_GIRDER_DEPTH_RATIO acotado"},
                outputs={"span_m": round(x1 - x0, 4),
                         "volume_m3": round(gw * gd * (x1 - x0), 4)},
                derived_from=["HYP_GIRDER_WIDTH", "HYP_GIRDER_DEPTH_RATIO",
                              "REQ_GIRDER_COUNT", "SPAN_LENGTH"],
                implementation="solids.Prism (extrusion en Z)",
            )
            _register(model, Component(
                component_id=cid, discipline="structure", type="main_girder",
                name="Viga principal %d, vano %d" % (k, s + 1), level_id=zone,
                material=material, ifc_class="IfcBeam",
                position=[x0, off, z0],
                dimensions={"span": round(x1 - x0, 4), "width": gw, "depth": gd},
                parameters={
                    "span_index": s + 1, "girder_index": k,
                    "span_m": round(x1 - x0, 4), "section_m": [gw, gd],
                    "transverse_offset_m": off,
                    "specified_concrete_strength_fc": None,
                    "prestress_force_kN": None, "tendon_layout": None,
                    "reinforcement_layout": None,
                    "design_moment_kNm": None, "design_shear_kN": None,
                    "camber_mm": None, "deflection_check": None,
                },
                requires_calculation=CONCRETE_PENDING + [
                    "prestress_force_kN", "tendon_layout", "design_moment_kNm",
                    "design_shear_kN", "camber_mm", "deflection_check"],
                provenance="hypothesis", tags=["superestructura", "viga", "conceptual"],
                validation_notes=["El canto procede de una relacion geometrica, no de "
                                  "un calculo de flexion."],
            ), solid, op)

            for tag in (_axis_tag(x0), _axis_tag(x1)):
                bearing = "EST-APO-%s-%02d" % (tag, k)
                if bearing in model.components:
                    model.relate(cid, "supported_by", bearing)
                    K.link(model, connection_id="CNX-%s-%s" % (cid, tag),
                           discipline="structure", type="bearing_connection",
                           origin=bearing, destination=cid,
                           medium="apoyo_elastomerico",
                           technology="transmision de reaccion vertical",
                           parameters={"vertical_reaction_kN": None,
                                       "movement_allowed": "longitudinal y rotacion"},
                           requires_calculation=["vertical_reaction_kN"],
                           provenance="hypothesis")


def service_corridor_y() -> float:
    """Eje transversal por el que pueden discurrir los servicios bajo el tablero.

    En vigas y atirantado queda entre la viga exterior y el borde: ahi no hay
    diafragmas y se pasa por encima de los cabezales de pila. En la tipologia
    de losa no existe ese hueco (el cabezal queda a 9 cm de la losa), asi que
    los servicios se cuelgan por fuera del borde del tablero.
    """
    if B.REQ_TYPE == "slab" or not B.GIRDER_OFFSETS:
        return round(B.REQ_WIDTH / 2 + B.HYP_ABUTMENT_WINGWALL_THICKNESS / 2 + 0.25, 4)
    outer = abs(B.GIRDER_OFFSETS[-1]) + B.HYP_GIRDER_WIDTH / 2
    return round((outer + B.REQ_WIDTH / 2) / 2.0, 4)


def services_outside_deck() -> bool:
    return B.REQ_TYPE == "slab" or not B.GIRDER_OFFSETS


def service_x_range() -> Tuple[float, float]:
    """Tramo longitudinal util para un servicio continuo.

    Cuando el servicio va por fuera del borde hay que esquivar las aletas del
    estribo, que sobresalen de ese mismo plano.
    """
    if services_outside_deck():
        margin = B.HYP_ABUTMENT_WINGWALL_LENGTH + 0.6
    else:
        margin = 0.4
    lo = round(margin, 4)
    hi = round(B.REQ_LENGTH - margin, 4)
    if hi - lo < 2.0:
        mid = B.REQ_LENGTH / 2.0
        lo, hi = round(mid - 1.0, 4), round(mid + 1.0, 4)
    return lo, hi


def _clear_of_supports(x: float, clearance: float = 1.4) -> float:
    """Aparta una abscisa de los ejes de apoyo.

    Un sumidero o un gabinete en el eje de una pila cae sobre el cabezal y los
    apoyos. Se desplaza al lado con mas holgura dentro del vano.
    """
    for _tag, ax in support_axes():
        if abs(x - ax) < clearance:
            left = ax - clearance
            right = ax + clearance
            if left < 1.0:
                return round(min(right, B.REQ_LENGTH - 1.0), 4)
            if right > B.REQ_LENGTH - 1.0:
                return round(max(left, 1.0), 4)
            return round(left if (x <= ax) else right, 4)
    return round(x, 4)


def _span_limits(index: int) -> Tuple[float, float]:
    """Extremos del vano, retranqueados media junta en los estribos.

    La junta de dilatacion es una discontinuidad real de la superestructura:
    si el vano llegara hasta el eje del estribo, junta y tablero ocuparian el
    mismo volumen.
    """
    x0, x1 = B.SPAN_EDGES[index], B.SPAN_EDGES[index + 1]
    half = B.HYP_JOINT_GAP / 2.0
    if index == 0:
        x0 = round(x0 + half, 4)
    if index == B.REQ_SPAN_COUNT - 1:
        x1 = round(x1 - half, 4)
    return x0, x1


def _axis_tag(x: float) -> str:
    tol = B.HYP_JOINT_GAP + 1e-6
    for tag, ax in support_axes():
        if abs(ax - x) <= tol:
            return tag
    return "EA"


def _build_diaphragms(model) -> None:
    dw = B.HYP_DIAPHRAGM_WIDTH
    gd = B.GIRDER_DEPTH
    z1 = B.DECK_BOTTOM
    z0 = round(z1 - gd * 0.72, 4)
    y0, y1 = B.GIRDER_OFFSETS[0], B.GIRDER_OFFSETS[-1]

    for s in range(B.REQ_SPAN_COUNT):
        x0, x1 = B.SPAN_EDGES[s], B.SPAN_EDGES[s + 1]
        zone = "V%d" % (s + 1)
        count = max(2, int(math.ceil((x1 - x0) / B.HYP_DIAPHRAGM_SPACING)) + 1)
        for k in range(count):
            x = x0 + (x1 - x0) * k / (count - 1)
            # Se retranquean los extremos para no invadir la junta ni el apoyo.
            x = min(max(x, x0 + dw), x1 - dw)
            cid = "EST-DIA-%s-D%02d" % (zone, k + 1)
            sid = "SOL-%s" % cid
            prism = S.box_prism(x - dw / 2, y0, x + dw / 2, y1, z0, z1)
            solid = _solid(sid, [prism], "concreto_estructural", "structure", zone,
                           "EST-DIAFRAGMAS")
            op = model.oplog.record(
                "extrude", "creation",
                "Diafragma %d del vano %d: arriostra las vigas, separacion maxima "
                "adoptada %.2f m." % (k + 1, s + 1, B.HYP_DIAPHRAGM_SPACING),
                component_id=cid, solid_id=sid,
                inputs={"span": s + 1, "x": round(x, 4), "width": dw,
                        "y0": y0, "y1": y1, "z0": z0, "z1": z1},
                outputs={"length_m": round(y1 - y0, 4)},
                derived_from=["HYP_DIAPHRAGM_WIDTH", "HYP_DIAPHRAGM_SPACING"],
                implementation="solids.Prism (extrusion en Z)",
            )
            _register(model, Component(
                component_id=cid, discipline="structure", type="diaphragm",
                name="Diafragma %d, vano %d" % (k + 1, s + 1), level_id=zone,
                material="concreto_estructural", ifc_class="IfcBeam",
                position=[round(x, 4), y0, z0],
                dimensions={"width": dw, "depth": round(z1 - z0, 4),
                            "length": round(y1 - y0, 4)},
                parameters={"span_index": s + 1, "width_m": dw,
                            "spacing_rule_m": B.HYP_DIAPHRAGM_SPACING,
                            "specified_concrete_strength_fc": None,
                            "reinforcement_layout": None,
                            "lateral_distribution_check": None},
                requires_calculation=CONCRETE_PENDING + ["lateral_distribution_check"],
                provenance="hypothesis", tags=["superestructura", "diafragma"],
            ), solid, op)


def _build_solid_slab(model) -> None:
    """Tipologia de losa: la superestructura es la propia losa maciza."""
    depth = B.GIRDER_DEPTH
    z1 = B.DECK_TOP
    z0 = round(z1 - depth, 4)
    for s in range(B.REQ_SPAN_COUNT):
        x0, x1 = _span_limits(s)
        zone = "V%d" % (s + 1)
        cid = "EST-LOS-%s" % zone
        sid = "SOL-%s" % cid
        prism = S.box_prism(x0, -B.REQ_WIDTH / 2, x1, B.REQ_WIDTH / 2, z0, z1)
        solid = _solid(sid, [prism], "concreto_estructural", "structure", zone,
                       "EST-LOSA-MACIZA")
        op = model.oplog.record(
            "extrude", "creation",
            "Losa maciza del vano %d: luz %.2f m, canto adoptado %.2f m (luz x %.3f, "
            "minimo %.2f m)." % (s + 1, x1 - x0, depth, B.HYP_SLAB_DEPTH_RATIO,
                                 B.HYP_SLAB_DEPTH_MIN),
            component_id=cid, solid_id=sid,
            inputs={"span": s + 1, "x0": x0, "x1": x1, "depth": depth,
                    "z0": z0, "z1": z1},
            outputs={"span_m": round(x1 - x0, 4),
                     "volume_m3": round(B.REQ_WIDTH * depth * (x1 - x0), 4)},
            derived_from=["HYP_SLAB_DEPTH_RATIO", "HYP_SLAB_DEPTH_MIN", "SPAN_LENGTH"],
            implementation="solids.Prism (extrusion en Z)",
        )
        _register(model, Component(
            component_id=cid, discipline="structure", type="solid_slab_span",
            name="Losa maciza, vano %d" % (s + 1), level_id=zone,
            material="concreto_estructural", ifc_class="IfcSlab",
            position=[x0, -B.REQ_WIDTH / 2, z0],
            dimensions={"span": round(x1 - x0, 4), "width": B.REQ_WIDTH, "depth": depth},
            parameters={"span_index": s + 1, "span_m": round(x1 - x0, 4),
                        "depth_m": depth, "width_m": B.REQ_WIDTH,
                        "specified_concrete_strength_fc": None,
                        "reinforcement_layout": None, "design_moment_kNm": None,
                        "deflection_check": None},
            requires_calculation=CONCRETE_PENDING + ["design_moment_kNm", "deflection_check"],
            provenance="hypothesis", tags=["superestructura", "losa", "conceptual"],
        ), solid, op)


# ---------------------------------------------------------------------------
# Torres y tirantes (atirantado)
# ---------------------------------------------------------------------------


def build_towers_and_stays(model) -> None:
    if B.REQ_TYPE != "cable_stayed":
        return
    tw, td = B.HYP_TOWER_SECTION
    base = cap_top()
    top = round(B.DECK_TOP + B.TOWER_HEIGHT, 4)
    # El fuste se aparta tambien del colector de drenaje, que cuelga por fuera
    # del borde del tablero.
    anchor_y = B.REQ_WIDTH / 2 + 0.55
    leg_offset = round(anchor_y + tw / 2 + 0.35, 4)

    for i, x in enumerate(B.TOWER_AXES, start=1):
        zone = "T%d" % i
        legs: List[str] = []
        for side, y in (("L", -leg_offset), ("R", leg_offset)):
            cid = "EST-TOR-%s-%s" % (zone, side)
            sid = "SOL-%s" % cid
            prism = S.box_prism(x - td / 2, y - tw / 2, x + td / 2, y + tw / 2, base, top)
            solid = _solid(sid, [prism], "concreto_estructural", "structure", zone,
                           "EST-TORRES")
            op = model.oplog.record(
                "extrude", "creation",
                "Fuste %s de la torre %d: seccion %.2f x %.2f m, desde %.2f hasta %.2f m."
                % (side, i, td, tw, base, top),
                component_id=cid, solid_id=sid,
                inputs={"tower": i, "side": side, "x": x, "y": y,
                        "section": [td, tw], "z0": base, "z1": top},
                outputs={"height_m": round(top - base, 4)},
                derived_from=["HYP_TOWER_SECTION", "HYP_TOWER_HEIGHT_RATIO"],
                implementation="solids.Prism (extrusion en Z)",
            )
            _register(model, Component(
                component_id=cid, discipline="structure", type="tower",
                name="Torre %d, fuste %s" % (i, side), level_id=zone,
                material="concreto_estructural", ifc_class="IfcColumn",
                position=[x, y, base],
                dimensions={"width": tw, "depth": td, "height": round(top - base, 4)},
                parameters={"tower_index": i, "side": side, "section_m": [td, tw],
                            "height_above_deck_m": B.TOWER_HEIGHT,
                            "specified_concrete_strength_fc": None,
                            "reinforcement_layout": None, "axial_load_kN": None,
                            "anchorage_design": None},
                requires_calculation=CONCRETE_PENDING + ["axial_load_kN", "anchorage_design"],
                provenance="hypothesis", tags=["atirantado", "torre", "conceptual"],
            ), solid, op)
            legs.append(cid)

        # --- tirantes en abanico a ambos lados de cada torre ---
        pairs = B.HYP_STAY_PAIRS_PER_TOWER
        # El anclaje va POR FUERA de la barrera, sobre una viga de anclaje en
        # el borde: sobre la calzada atravesaria la carpeta y sobre la barrera
        # chocaria con los postes de alumbrado.
        anchor_y = round(B.REQ_WIDTH / 2 + 0.55, 4)
        for side, y_leg, y_deck in (("L", -leg_offset, -anchor_y),
                                    ("R", leg_offset, anchor_y)):
            for k in range(1, pairs + 1):
                anchor_z = top - (top - B.DECK_TOP) * (k - 0.5) / pairs
                for direction in (-1, 1):
                    dx = direction * B.HYP_STAY_DECK_SPACING * k
                    deck_x = x + dx
                    if deck_x <= 0.5 or deck_x >= B.REQ_LENGTH - 0.5:
                        continue
                    cid = "EST-TIR-%s-%s%s%02d" % (zone, side, "A" if direction < 0 else "B", k)
                    sid = "SOL-%s" % cid
                    # Termina en el bloque de anclaje, sobre el tablero.
                    anchor_deck_z = round(B.DECK_TOP + 0.30, 4)
                    stay = S.pipe((x, y_leg, round(anchor_z, 4)),
                                  (deck_x, y_deck, anchor_deck_z), B.HYP_STAY_DIAMETER)
                    solid = _solid(sid, [stay], "acero_tirante", "structure", zone,
                                   "EST-TIRANTES")
                    length = math.dist((x, y_leg, anchor_z), (deck_x, y_deck, anchor_deck_z))
                    op = model.oplog.record(
                        "sweep_polyline", "creation",
                        "Tirante %s: de la torre (cota %.2f) al tablero en x=%.2f, "
                        "longitud %.2f m." % (cid, anchor_z, deck_x, length),
                        component_id=cid, solid_id=sid,
                        inputs={"tower": i, "side": side, "anchor_z": round(anchor_z, 4),
                                "deck_x": round(deck_x, 4), "deck_y": y_deck,
                                "diameter": B.HYP_STAY_DIAMETER},
                        outputs={"length_m": round(length, 4)},
                        derived_from=["HYP_STAY_PAIRS_PER_TOWER", "HYP_STAY_DECK_SPACING",
                                      "HYP_STAY_DIAMETER"],
                        implementation="solids.pipe (barrido circular inclinado)",
                    )
                    _register(model, Component(
                        component_id=cid, discipline="structure", type="stay_cable",
                        name="Tirante %s" % cid, level_id=zone,
                        material="acero_tirante", ifc_class="IfcMember",
                        position=[x, y_leg, round(anchor_z, 4)],
                        dimensions={"length": round(length, 4),
                                    "diameter": B.HYP_STAY_DIAMETER},
                        parameters={
                            "tower_index": i, "length_m": round(length, 4),
                            "nominal_diameter_m": B.HYP_STAY_DIAMETER,
                            # El punto de anclaje al tablero es un dato del
                            # tirante, no solo de la operacion que lo creo: el
                            # realce y el mantenimiento lo necesitan.
                            "deck_anchor_x_m": round(deck_x, 4),
                            "deck_anchor_y_m": round(y_deck, 4),
                            "deck_anchor_z_m": anchor_deck_z,
                            "strand_count": None, "design_tension_kN": None,
                            "breaking_load_kN": None, "fatigue_check": None,
                            "corrosion_protection": None, "vibration_damping": None,
                        },
                        requires_calculation=["strand_count", "design_tension_kN",
                                              "breaking_load_kN", "fatigue_check",
                                              "corrosion_protection", "vibration_damping"],
                        provenance="hypothesis", tags=["atirantado", "tirante", "conceptual"],
                        validation_notes=["Diametro adoptado; la tension de diseno no esta "
                                          "calculada."],
                    ), solid, op)
                    model.relate(cid, "anchored_to", legs[0] if side == "L" else legs[-1])
                    K.link(model, connection_id="CNX-%s-TOR" % cid,
                           discipline="structure", type="stay_anchorage",
                           origin=cid, destination=legs[0] if side == "L" else legs[-1],
                           medium="anclaje_de_tirante", technology="anclaje activo o pasivo",
                           parameters={"design_tension_kN": None, "anchorage_type": None},
                           length_m=round(length, 4),
                           requires_calculation=["design_tension_kN", "anchorage_type"],
                           provenance="hypothesis")


# ---------------------------------------------------------------------------
# Arco (tablero superior)
# ---------------------------------------------------------------------------


def arch_z_at(x: float) -> float:
    """Cota del eje del arco en la abscisa x.

    Parabola de segundo grado entre los dos arranques, con la clave en el
    centro del vano. Se usa parabola y no circunferencia porque es la
    directriz que sigue la linea de presiones bajo carga uniforme repartida:
    con ella el arco trabaja a compresion casi pura, que es la razon de ser de
    un arco.
    """
    x0, x1 = B.ARCH_SPAN
    luz = x1 - x0
    centro = (x0 + x1) / 2.0
    t = (2.0 * (x - centro)) / luz          # -1 en un arranque, +1 en el otro
    return B.HYP_ARCH_SPRINGING_Z + B.ARCH_RISE * (1.0 - t * t)


def build_arch(model) -> None:
    """Dos nervios de arco bajo los bordes del tablero, con sus montantes.

    Se construye UN arco, sobre el vano mayor; los demas vanos conservan sus
    vigas y hacen de viaductos de acceso. Es la disposicion habitual: el arco
    salva el obstaculo y el resto se resuelve con vigas.
    """
    if B.REQ_TYPE != "arch" or not B.ARCH_SPAN:
        return

    x0, x1 = B.ARCH_SPAN
    luz = x1 - x0
    ancho, canto = B.HYP_ARCH_RIB_SECTION
    tramos = max(8, int(B.HYP_ARCH_SEGMENTS))
    # El fondo del tablero: es hasta donde suben los montantes.
    fondo_tablero = round(B.DECK_BOTTOM - B.GIRDER_DEPTH, 4)

    for lado, y in (("L", B.ARCH_RIB_OFFSETS[0]), ("R", B.ARCH_RIB_OFFSETS[1])):
        puntos = []
        for i in range(tramos + 1):
            x = x0 + luz * i / tramos
            puntos.append((round(x, 4), round(y, 4), round(arch_z_at(x), 4)))
        cid = "EST-ARC-%s" % lado
        sid = "SOL-%s" % cid
        barridos = S.polyline_duct(puntos, ancho, canto)
        solid = _solid(sid, barridos, "concreto_estructural", "structure", "ARC",
                       "EST-ARCO")
        desarrollo = S.polyline_length(puntos)
        op = model.oplog.record(
            "sweep", "creation",
            "Nervio %s del arco: luz %.2f m, flecha %.2f m (relacion 1:%.1f), "
            "seccion %.2f x %.2f m, aproximado con %d tramos rectos. La directriz "
            "es parabolica, que es la linea de presiones bajo carga repartida."
            % (lado, luz, B.ARCH_RISE, luz / B.ARCH_RISE, ancho, canto, tramos),
            component_id=cid, solid_id=sid,
            inputs={"span": [x0, x1], "rise_m": B.ARCH_RISE, "y": y,
                    "section": [ancho, canto], "segments": tramos,
                    "directrix": "parabola de 2o grado"},
            outputs={"developed_length_m": round(desarrollo, 4),
                     "crown_z_m": B.ARCH_CROWN_Z},
            derived_from=["ARCH_SPAN", "ARCH_RISE", "HYP_ARCH_RIB_SECTION",
                          "HYP_ARCH_SEGMENTS"],
            implementation="solids.polyline_duct (barridos rectos consecutivos)",
        )
        _register(model, Component(
            component_id=cid, discipline="structure", type="arch_rib",
            name="Nervio %s del arco" % lado, level_id="ARC",
            material="concreto_estructural", ifc_class="IfcMember",
            position=[x0, y, B.HYP_ARCH_SPRINGING_Z],
            dimensions={"span": round(luz, 4), "rise": B.ARCH_RISE,
                        "width": ancho, "depth": canto},
            parameters={
                "span_m": round(luz, 4), "rise_m": B.ARCH_RISE,
                "rise_to_span": round(B.ARCH_RISE / luz, 5),
                "section_m": [ancho, canto],
                "transverse_offset_m": y,
                "directrix": "parabolica",
                "segments": tramos,
                "developed_length_m": round(desarrollo, 4),
                # Un arco se dimensiona por pandeo y por la excentricidad de la
                # linea de presiones. Nada de eso se calcula aqui.
                "specified_concrete_strength_fc": None,
                "axial_thrust_kN": None, "buckling_check": None,
                "springing_reaction_kN": None, "reinforcement_layout": None,
            },
            requires_calculation=CONCRETE_PENDING + [
                "axial_thrust_kN", "buckling_check", "springing_reaction_kN"],
            provenance="hypothesis", tags=["superestructura", "arco", "conceptual"],
            validation_notes=[
                "La directriz es parabolica por hipotesis, no por un calculo de la "
                "linea de presiones con las cargas reales.",
                "La flecha la impone la cota del tablero; no se ha comprobado el "
                "pandeo del arco, que es lo que suele dimensionarlo."],
        ), solid, op)

        # --- montantes entre el arco y el tablero ---
        cw, cd = B.HYP_ARCH_COLUMN_SECTION
        # Separacion real: se reparte el vano en un numero entero de huecos
        # para que los montantes queden simetricos respecto a la clave.
        huecos = max(2, int(round(luz / B.HYP_ARCH_COLUMN_SPACING)))
        for k in range(1, huecos):
            x = x0 + luz * k / huecos
            base = round(arch_z_at(x) + canto / 2.0, 4)
            if fondo_tablero - base < 0.60:
                # Cerca de la clave no cabe montante: el arco toca el tablero.
                continue
            ccid = "EST-ARM-%s-%02d" % (lado, k)
            csid = "SOL-%s" % ccid
            prisma = S.box_prism(x - cd / 2, y - cw / 2, x + cd / 2, y + cw / 2,
                                 base, fondo_tablero)
            csolid = _solid(csid, [prisma], "concreto_estructural", "structure",
                            "ARC", "EST-ARCO")
            cop = model.oplog.record(
                "extrude", "creation",
                "Montante %d del nervio %s: desde el arco en z=%.2f hasta el fondo "
                "del tablero en z=%.2f, seccion %.2f x %.2f m."
                % (k, lado, base, fondo_tablero, cw, cd),
                component_id=ccid, solid_id=csid,
                inputs={"x": round(x, 4), "y": y, "z0": base, "z1": fondo_tablero,
                        "section": [cw, cd]},
                outputs={"height_m": round(fondo_tablero - base, 4)},
                derived_from=["ARCH_SPAN", "ARCH_RISE",
                              "HYP_ARCH_COLUMN_SECTION", "HYP_ARCH_COLUMN_SPACING"],
                implementation="solids.Prism (extrusion en Z)",
            )
            _register(model, Component(
                component_id=ccid, discipline="structure", type="spandrel_column",
                name="Montante %d, nervio %s" % (k, lado), level_id="ARC",
                material="concreto_estructural", ifc_class="IfcColumn",
                position=[round(x, 4), y, base],
                dimensions={"height": round(fondo_tablero - base, 4),
                            "width": cw, "depth": cd},
                parameters={
                    "height_m": round(fondo_tablero - base, 4),
                    "section_m": [cw, cd], "transverse_offset_m": y,
                    "specified_concrete_strength_fc": None,
                    "axial_load_kN": None, "buckling_check": None,
                    "reinforcement_layout": None,
                },
                requires_calculation=CONCRETE_PENDING + [
                    "axial_load_kN", "buckling_check"],
                provenance="hypothesis",
                tags=["superestructura", "arco", "montante", "conceptual"],
            ), csolid, cop)


# ---------------------------------------------------------------------------
# Tablero
# ---------------------------------------------------------------------------


def build_deck(model) -> None:
    side = B.HYP_SIDEWALK_WIDTH if B.REQ_SIDEWALKS else 0.0
    half = B.REQ_WIDTH / 2

    # --- losa del tablero (solo si no es losa maciza estructural) ---
    if B.REQ_TYPE != "slab":
        cid = "TAB-LOS"
        sid = "SOL-%s" % cid
        hj = B.HYP_JOINT_GAP / 2.0
        prism = S.box_prism(hj, -half, B.REQ_LENGTH - hj, half,
                            B.DECK_BOTTOM, B.DECK_TOP)
        solid = _solid(sid, [prism], "concreto_estructural", "deck", "TAB", "TAB-LOSA")
        op = model.oplog.record(
            "extrude", "creation",
            "Losa del tablero: %.2f x %.2f m, espesor %.2f m."
            % (B.REQ_LENGTH, B.REQ_WIDTH, B.HYP_SLAB_THICKNESS),
            component_id=cid, solid_id=sid,
            inputs={"length": B.REQ_LENGTH, "width": B.REQ_WIDTH,
                    "thickness": B.HYP_SLAB_THICKNESS,
                    "z0": B.DECK_BOTTOM, "z1": B.DECK_TOP},
            outputs={"area_m2": round(B.REQ_LENGTH * B.REQ_WIDTH, 2)},
            derived_from=["REQ_LENGTH", "REQ_WIDTH", "HYP_SLAB_THICKNESS"],
            implementation="solids.Prism (extrusion en Z)",
        )
        _register(model, Component(
            component_id=cid, discipline="deck", type="deck_slab",
            name="Losa del tablero", level_id="TAB",
            material="concreto_estructural", ifc_class="IfcSlab",
            position=[0.0, -half, B.DECK_BOTTOM],
            dimensions={"length": B.REQ_LENGTH, "width": B.REQ_WIDTH,
                        "thickness": B.HYP_SLAB_THICKNESS},
            parameters={
                "length_m": B.REQ_LENGTH, "width_m": B.REQ_WIDTH,
                "thickness_m": B.HYP_SLAB_THICKNESS,
                "area_m2": round(B.REQ_LENGTH * B.REQ_WIDTH, 2),
                "crossfall_adopted": B.HYP_CROSSFALL,
                "specified_concrete_strength_fc": None, "reinforcement_layout": None,
                "live_load_model": None, "fatigue_check": None,
            },
            requires_calculation=CONCRETE_PENDING + ["live_load_model", "fatigue_check"],
            provenance="hypothesis", tags=["tablero", "conceptual"],
        ), solid, op)

    # --- carpeta de rodadura ---
    cw = B.CARRIAGEWAY_WIDTH / 2 + B.HYP_CURB_WIDTH
    cid = "TAB-CAR"
    sid = "SOL-%s" % cid
    prism = S.box_prism(0.0, -cw, B.REQ_LENGTH, cw, B.DECK_TOP,
                        round(B.DECK_TOP + B.HYP_WEARING_THICKNESS, 4))
    solid = _solid(sid, [prism], "asfalto", "deck", "TAB", "TAB-CARPETA")
    op = model.oplog.record(
        "extrude", "creation",
        "Carpeta de rodadura: %.2f m de ancho y %.3f m de espesor adoptado."
        % (2 * cw, B.HYP_WEARING_THICKNESS),
        component_id=cid, solid_id=sid,
        inputs={"width": 2 * cw, "thickness": B.HYP_WEARING_THICKNESS,
                "z0": B.DECK_TOP},
        outputs={"area_m2": round(B.REQ_LENGTH * 2 * cw, 2)},
        derived_from=["HYP_WEARING_THICKNESS", "CARRIAGEWAY_WIDTH"],
        implementation="solids.Prism (extrusion en Z)",
    )
    _register(model, Component(
        component_id=cid, discipline="deck", type="wearing_course",
        name="Carpeta de rodadura", level_id="TAB",
        material="asfalto", ifc_class="IfcCovering",
        position=[0.0, -cw, B.DECK_TOP],
        dimensions={"length": B.REQ_LENGTH, "width": round(2 * cw, 4),
                    "thickness": B.HYP_WEARING_THICKNESS},
        parameters={"thickness_m": B.HYP_WEARING_THICKNESS,
                    "width_m": round(2 * cw, 4),
                    "mix_specification": None, "skid_resistance": None,
                    "waterproofing_membrane": None},
        requires_calculation=["mix_specification", "skid_resistance",
                              "waterproofing_membrane"],
        provenance="hypothesis", tags=["tablero", "pavimento"],
    ), solid, op)

    if not B.REQ_SIDEWALKS:
        return

    # --- aceras y bordillos ---
    for label, y_out in (("L", -half), ("R", half)):
        sign = 1.0 if y_out < 0 else -1.0
        y0 = min(y_out, y_out + sign * side)
        y1 = max(y_out, y_out + sign * side)
        cid = "TAB-ACE-%s" % label
        sid = "SOL-%s" % cid
        prism = S.box_prism(0.0, y0, B.REQ_LENGTH, y1, B.DECK_TOP,
                            round(B.DECK_TOP + B.HYP_SIDEWALK_RISE, 4))
        solid = _solid(sid, [prism], "concreto_estructural", "deck", "TAB", "TAB-ACERAS")
        op = model.oplog.record(
            "extrude", "creation",
            "Acera %s: %.2f m de ancho, resalte de %.2f m sobre la calzada."
            % (label, side, B.HYP_SIDEWALK_RISE),
            component_id=cid, solid_id=sid,
            inputs={"side": label, "y0": y0, "y1": y1, "rise": B.HYP_SIDEWALK_RISE},
            outputs={"area_m2": round(B.REQ_LENGTH * side, 2)},
            derived_from=["HYP_SIDEWALK_WIDTH", "HYP_SIDEWALK_RISE"],
            implementation="solids.Prism (extrusion en Z)",
        )
        _register(model, Component(
            component_id=cid, discipline="deck", type="sidewalk",
            name="Acera %s" % label, level_id="TAB",
            material="concreto_estructural", ifc_class="IfcSlab",
            position=[0.0, y0, B.DECK_TOP],
            dimensions={"length": B.REQ_LENGTH, "width": side,
                        "height": B.HYP_SIDEWALK_RISE},
            parameters={"side": label, "width_m": side,
                        "rise_m": B.HYP_SIDEWALK_RISE,
                        "accessibility_check": None, "pedestrian_load_kPa": None},
            requires_calculation=["accessibility_check", "pedestrian_load_kPa"],
            provenance="hypothesis", tags=["tablero", "acera"],
        ), solid, op)


# ---------------------------------------------------------------------------
# Barreras y barandas
# ---------------------------------------------------------------------------


def build_barriers(model) -> None:
    half = B.REQ_WIDTH / 2
    side = B.HYP_SIDEWALK_WIDTH if B.REQ_SIDEWALKS else 0.0
    bw = B.HYP_BARRIER_WIDTH
    base = round(B.DECK_TOP + (B.HYP_SIDEWALK_RISE if B.REQ_SIDEWALKS else 0.0), 4)

    for label, y_out in (("L", -half), ("R", half)):
        sign = 1.0 if y_out < 0 else -1.0
        y_in = y_out + sign * bw
        y0, y1 = min(y_out, y_in), max(y_out, y_in)

        cid = "BAR-BAR-%s" % label
        sid = "SOL-%s" % cid
        prism = S.box_prism(0.0, y0, B.REQ_LENGTH, y1, base,
                            round(base + B.HYP_BARRIER_HEIGHT, 4))
        solid = _solid(sid, [prism], "concreto_estructural", "barriers", "TAB",
                       "BAR-BARRERAS")
        op = model.oplog.record(
            "extrude", "creation",
            "Barrera %s: %.2f m de altura y %.2f m de ancho, en todo el desarrollo."
            % (label, B.HYP_BARRIER_HEIGHT, bw),
            component_id=cid, solid_id=sid,
            inputs={"side": label, "y0": y0, "y1": y1, "z0": base,
                    "height": B.HYP_BARRIER_HEIGHT},
            outputs={"length_m": B.REQ_LENGTH},
            derived_from=["HYP_BARRIER_HEIGHT", "HYP_BARRIER_WIDTH"],
            implementation="solids.Prism (extrusion en Z)",
        )
        _register(model, Component(
            component_id=cid, discipline="barriers", type="safety_barrier",
            name="Barrera de seguridad %s" % label, level_id="TAB",
            material="concreto_estructural", ifc_class="IfcRailing",
            position=[0.0, y0, base],
            dimensions={"length": B.REQ_LENGTH, "width": bw,
                        "height": B.HYP_BARRIER_HEIGHT},
            parameters={
                "side": label, "height_m": B.HYP_BARRIER_HEIGHT, "width_m": bw,
                "containment_level": None, "impact_load_kN": None,
                "anchorage_design": None, "crash_test_standard": None,
            },
            requires_calculation=["containment_level", "impact_load_kN",
                                  "anchorage_design", "crash_test_standard"],
            provenance="hypothesis", tags=["barrera", "conceptual"],
            validation_notes=["El nivel de contencion exige ensayo normalizado; aqui "
                              "solo hay geometria."],
        ), solid, op)

        if B.REQ_SIDEWALKS:
            # Baranda peatonal en el borde interior de la acera.
            ry = y_out + sign * (side - 0.08)
            rcid = "BAR-RAI-%s" % label
            rsid = "SOL-%s" % rcid
            posts = []
            n = max(2, int(B.REQ_LENGTH // 2.5) + 1)
            for k in range(n):
                px = B.REQ_LENGTH * k / (n - 1)
                px = min(max(px, 0.1), B.REQ_LENGTH - 0.1)
                posts.append(S.pipe((px, ry, base), (px, ry, round(base + B.HYP_RAILING_HEIGHT, 4)), 0.06))
            posts.append(S.pipe((0.1, ry, round(base + B.HYP_RAILING_HEIGHT, 4)),
                                (B.REQ_LENGTH - 0.1, ry, round(base + B.HYP_RAILING_HEIGHT, 4)), 0.05))
            rsolid = _solid(rsid, posts, "acero_galvanizado", "barriers", "TAB",
                            "BAR-BARRERAS")
            rop = model.oplog.record(
                "sweep_polyline", "creation",
                "Baranda peatonal %s: %d montantes cada %.2f m y pasamanos continuo."
                % (label, n, B.REQ_LENGTH / max(1, n - 1)),
                component_id=rcid, solid_id=rsid,
                inputs={"side": label, "y": ry, "post_count": n,
                        "height": B.HYP_RAILING_HEIGHT},
                outputs={"length_m": B.REQ_LENGTH},
                derived_from=["HYP_RAILING_HEIGHT", "HYP_SIDEWALK_WIDTH"],
                implementation="solids.pipe (montantes verticales y pasamanos)",
            )
            _register(model, Component(
                component_id=rcid, discipline="barriers", type="pedestrian_railing",
                name="Baranda peatonal %s" % label, level_id="TAB",
                material="acero_galvanizado", ifc_class="IfcRailing",
                position=[0.0, ry, base],
                dimensions={"length": B.REQ_LENGTH, "height": B.HYP_RAILING_HEIGHT},
                parameters={"side": label, "height_m": B.HYP_RAILING_HEIGHT,
                            "post_count": n, "horizontal_load_kN_m": None,
                            "opening_limit_mm": None, "code_compliance_check": None},
                requires_calculation=["horizontal_load_kN_m", "opening_limit_mm",
                                      "code_compliance_check"],
                provenance="hypothesis", tags=["baranda", "conceptual"],
            ), rsolid, rop)


# ---------------------------------------------------------------------------
# Drenaje
# ---------------------------------------------------------------------------


def build_drainage(model) -> None:
    half_c = B.CARRIAGEWAY_WIDTH / 2
    n = max(2, int(math.ceil(B.REQ_LENGTH / B.HYP_DRAIN_SPACING)) + 1)
    # El colector se cuelga POR FUERA del borde del tablero. Bajo la losa
    # cruzaria los cabezales de pila, que ocupan todo el ancho; por fuera del
    # borde queda libre en cualquier tipologia.
    structure_ref = B.DECK_BOTTOM if B.REQ_TYPE != "slab" else B.STRUCTURE_BOTTOM
    collector_z = round(structure_ref - 0.20, 4)
    collector_y = service_corridor_y()
    x_lo, x_hi = service_x_range()
    # Cota del tramo transversal, dentro del canto de la losa.
    slab_run_z = round((B.DECK_BOTTOM + 0.08) if B.REQ_TYPE != "slab"
                       else (B.STRUCTURE_BOTTOM + 0.12), 4)
    drains: List[Tuple[str, float, float]] = []

    for label, y in (("L", -half_c + 0.25), ("R", half_c - 0.25)):
        y_col = -collector_y if label == "L" else collector_y
        # --- colector longitudinal bajo el tablero ---
        ccid = "DRE-COL-%s" % label
        csid = "SOL-%s" % ccid
        path = [(x_lo, y_col, collector_z), (x_hi, y_col, collector_z)]
        _, clen = K.add_route(
            model, component_id=ccid, discipline="drainage", type="drain_collector",
            name="Colector de drenaje %s" % label,
            polylines=[path], diameter=B.HYP_DRAIN_COLLECTOR_DIAMETER,
            material="pvc", ifc_class="IfcPipeSegment", layer="DRE-TUBERIA",
            level_id="TAB",
            parameters={"side": label,
                        "nominal_diameter_m": B.HYP_DRAIN_COLLECTOR_DIAMETER,
                        "design_flow_lps": None, "verified_diameter_m": None,
                        "slope_verified": None, "discharge_point": None},
            requires_calculation=["design_flow_lps", "verified_diameter_m",
                                  "slope_verified", "discharge_point"],
            tags=["drenaje", "colector"],
            op_description=("Colector longitudinal %s colgado por fuera del borde del "
                            "tablero (y=%.2f) a la cota %.2f, que recoge los sumideros "
                            "de ese lado." % (label, y_col, collector_z)),
            derived_from=["HYP_DRAIN_COLLECTOR_DIAMETER", "STRUCTURE_BOTTOM"],
            flow_direction="hacia_el_punto_de_descarga",
            validation_notes=["El punto de descarga no esta definido: depende del "
                              "entorno del puente."],
        )

        for k in range(n):
            x = B.REQ_LENGTH * k / (n - 1)
            x = min(max(x, x_lo + 0.3), x_hi - 0.3)
            x = _clear_of_supports(x)
            x = min(max(x, x_lo + 0.3), x_hi - 0.3)
            dcid = "DRE-SUM-%s%02d" % (label, k + 1)
            K.add_device(
                model, component_id=dcid, discipline="drainage", type="deck_drain",
                name="Sumidero %s-%02d" % (label, k + 1), level_id="TAB",
                xyz=(x, y, round(B.DECK_TOP - 0.06, 4)), box=(0.30, 0.30, 0.08),
                material="acero_galvanizado", ifc_class="IfcWasteTerminal",
                layer="DRE-SUMIDEROS",
                parameters={"side": label,
                            "nominal_diameter_m": B.HYP_DRAIN_DIAMETER,
                            "spacing_rule_m": B.HYP_DRAIN_SPACING,
                            "contributing_area_m2": round(
                                B.REQ_LENGTH * B.CARRIAGEWAY_WIDTH / (2 * n), 2),
                            "design_flow_lps": None, "verified_capacity_lps": None},
                requires_calculation=["design_flow_lps", "verified_capacity_lps"],
                tags=["drenaje", "sumidero"],
                op_description=("Sumidero %s en x=%.2f. Reparto geometrico de %d unidades "
                                "por lado cada %.2f m como maximo; no procede de calculo "
                                "de escorrentia." % (dcid, x, n, B.HYP_DRAIN_SPACING)),
                derived_from=["HYP_DRAIN_SPACING", "CARRIAGEWAY_WIDTH"],
            )
            # --- bajante del sumidero al colector ---
            pcid = "DRE-BAJ-%s%02d" % (label, k + 1)
            _, plen = K.add_route(
                model, component_id=pcid, discipline="drainage", type="drain_downpipe",
                name="Bajante de sumidero %s-%02d" % (label, k + 1),
                # La derivacion transversal discurre DENTRO de la losa y solo
                # baja al colector ya en el corredor de servicio: si bajara en
                # vertical desde la cuneta atravesaria la viga exterior en los
                # tableros estrechos.
                polylines=[[(x, y, round(B.DECK_TOP - 0.10, 4)),
                             (x, y, slab_run_z),
                             (x, y_col, slab_run_z),
                             (x, y_col, collector_z)]],
                diameter=B.HYP_DRAIN_DIAMETER, material="pvc",
                ifc_class="IfcPipeSegment", layer="DRE-TUBERIA", level_id="TAB",
                parameters={"nominal_diameter_m": B.HYP_DRAIN_DIAMETER,
                            "verified_diameter_m": None},
                requires_calculation=["verified_diameter_m", "design_flow_lps"],
                tags=["drenaje", "bajante"],
                op_description=("Bajante del sumidero %s: bajada dentro de la losa, "
                                "derivacion transversal hasta el corredor de servicio "
                                "y caida al colector." % dcid),
                derived_from=["HYP_DRAIN_DIAMETER"],
                flow_direction="descendente_por_gravedad",
            )
            K.link(model, connection_id="CNX-%s-COL" % dcid, discipline="drainage",
                   type="pipe_connection", origin=dcid, destination=ccid,
                   medium="tuberia_pvc", technology="recoleccion de aguas de calzada",
                   parameters={"via": pcid, "nominal_diameter_m": B.HYP_DRAIN_DIAMETER},
                   geometry_reference="SOL-%s" % pcid, length_m=plen,
                   flow_direction="sumidero_hacia_colector",
                   requires_calculation=["design_flow_lps"])
            drains.append((dcid, x, y))


# ---------------------------------------------------------------------------
# Iluminación
# ---------------------------------------------------------------------------


def build_lighting(model) -> None:
    half = B.REQ_WIDTH / 2
    base = round(B.DECK_TOP + (B.HYP_SIDEWALK_RISE if B.REQ_SIDEWALKS else 0.0), 4)
    n = max(2, int(math.ceil(B.REQ_LENGTH / B.HYP_LIGHT_SPACING)) + 1)
    lum = B.HYP_LUMINAIRE
    # El poste se monta sobre la barrera: en la calzada invadiria la carpeta.
    y_pole = round(half - B.HYP_BARRIER_WIDTH / 2, 4)
    pole_base = round(base + B.HYP_BARRIER_HEIGHT, 4)
    luminaires: List[str] = []

    # --- canalización en la barrera ---
    conduit_path = [(0.5, y_pole, round(base + 0.15, 4)),
                    (B.REQ_LENGTH - 0.5, y_pole, round(base + 0.15, 4))]
    _, conduit_len = K.add_route(
        model, component_id="ILU-CAN", discipline="lighting", type="conduit",
        name="Canalizacion de alumbrado",
        polylines=[conduit_path], diameter=B.HYP_CONDUIT_DIAMETER,
        material="pvc", ifc_class="IfcCableCarrierSegment", layer="ILU-CANALIZACION",
        level_id="TAB",
        parameters={"nominal_diameter_m": B.HYP_CONDUIT_DIAMETER,
                    "conductor_gauge": None, "insulation_type": None},
        requires_calculation=["conductor_gauge", "insulation_type"],
        tags=["iluminacion", "canalizacion"],
        op_description="Canalizacion de alumbrado alojada en la barrera, en todo el desarrollo.",
        derived_from=["HYP_CONDUIT_DIAMETER", "HYP_BARRIER_WIDTH"],
    )

    for k in range(n):
        x = B.REQ_LENGTH * k / (n - 1)
        x = min(max(x, 1.5), B.REQ_LENGTH - 1.5)
        side = "L" if k % 2 == 0 else "R"
        y = -y_pole if side == "L" else y_pole
        top = round(pole_base + B.HYP_LIGHT_POLE_HEIGHT, 4)

        pcid = "ILU-POS-%02d" % (k + 1)
        psid = "SOL-%s" % pcid
        pole = S.pipe((x, y, pole_base), (x, y, top), B.HYP_LIGHT_POLE_DIAMETER)
        psolid = _solid(psid, [pole], "acero_galvanizado", "lighting", "TAB", "ILU-POSTES")
        pop = model.oplog.record(
            "sweep_polyline", "creation",
            "Poste de alumbrado %d en x=%.2f, lado %s, altura %.2f m. Separacion "
            "adoptada %.2f m, alternando lados." % (k + 1, x, side,
                                                    B.HYP_LIGHT_POLE_HEIGHT,
                                                    B.HYP_LIGHT_SPACING),
            component_id=pcid, solid_id=psid,
            inputs={"x": round(x, 4), "y": y, "height": B.HYP_LIGHT_POLE_HEIGHT,
                    "diameter": B.HYP_LIGHT_POLE_DIAMETER, "side": side,
                    "base_z": pole_base, "mounted_on": "barrera"},
            outputs={}, derived_from=["HYP_LIGHT_SPACING", "HYP_LIGHT_POLE_HEIGHT"],
            implementation="solids.pipe (barrido circular vertical)",
        )
        _register(model, Component(
            component_id=pcid, discipline="lighting", type="light_pole",
            name="Poste de alumbrado %d" % (k + 1), level_id="TAB",
            material="acero_galvanizado", ifc_class="IfcColumn",
            position=[round(x, 4), y, pole_base],
            dimensions={"height": B.HYP_LIGHT_POLE_HEIGHT,
                        "diameter": B.HYP_LIGHT_POLE_DIAMETER},
            parameters={"side": side, "height_m": B.HYP_LIGHT_POLE_HEIGHT,
                        "spacing_rule_m": B.HYP_LIGHT_SPACING,
                        "wind_load_kN": None, "anchorage_design": None,
                        "breakaway_requirement": None},
            requires_calculation=["wind_load_kN", "anchorage_design",
                                  "breakaway_requirement"],
            provenance="hypothesis", tags=["iluminacion", "poste"],
        ), psolid, pop)

        lcid = "ILU-LUM-%02d" % (k + 1)
        K.add_device(
            model, component_id=lcid, discipline="lighting", type="luminaire",
            name="Luminaria vial %d" % (k + 1), level_id="TAB",
            # El brazo vuela hacia la calzada; hacia fuera invadiria el borde
            # y, en atirantado, la zona de anclaje de los tirantes.
            xyz=(round(x, 4), y + (-0.6 if side == "R" else 0.6), round(top - 0.1, 4)),
            box=(0.70, 0.30, 0.14), material="luminaria",
            ifc_class="IfcLightFixture", layer="ILU-LUMINARIAS",
            parameters={"model_reference": lum["model_ref"],
                        "nominal_power_w": lum["nominal_power_w"],
                        "nominal_voltage_v": lum["nominal_voltage_v"],
                        "phases": lum["phases"], "mounted_on": pcid,
                        "luminous_flux_lm": None, "illuminance_lux": None,
                        "uniformity_ratio": None, "photometric_file": None},
            requires_calculation=["luminous_flux_lm", "illuminance_lux",
                                  "uniformity_ratio", "photometric_file"],
            tags=["iluminacion", "luminaria"],
            op_description=("Luminaria %d sobre el poste %s. La separacion es un reparto "
                            "geometrico, no un calculo fotometrico." % (k + 1, pcid)),
            derived_from=["HYP_LUMINAIRE", "HYP_LIGHT_SPACING"],
            validation_notes=["Sin calculo fotometrico no hay iluminancia asignable."],
        )
        model.relate(lcid, "mounted_on", pcid)
        luminaires.append(lcid)

    # --- circuito de alumbrado ---
    connected = round(len(luminaires) * lum["nominal_power_w"], 2)
    current = round(connected / (lum["nominal_voltage_v"] * B.HYP_POWER_FACTOR), 3)
    cid = "ILU-CIR-001"
    K.add_device(
        model, component_id=cid, discipline="lighting", type="lighting_circuit",
        name="Circuito de alumbrado del puente", level_id="TAB",
        xyz=(0.5, y_pole, round(base + 0.2, 4)), box=(0.30, 0.20, 0.40),
        material="equipo_generico", ifc_class="IfcElectricDistributionBoard",
        layer="ILU-CANALIZACION",
        parameters={
            "luminaire_count": len(luminaires),
            "connected_power_w": connected,
            "nominal_voltage_v": lum["nominal_voltage_v"],
            "phases": lum["phases"],
            "derived_current_a": current,
            "current_derivation": "P/(V*fp)",
            "power_factor_assumed": B.HYP_POWER_FACTOR,
            "route_length_m": conduit_len,
            "conductor_material": "cobre",
            "conductor_gauge": None, "insulation_type": None,
            "protection_rating": None, "voltage_drop_percent": None,
            "supply_point": None,
        },
        requires_calculation=["conductor_gauge", "insulation_type", "protection_rating",
                              "voltage_drop_percent", "supply_point"],
        tags=["iluminacion", "circuito"],
        op_description=("Circuito de alumbrado con %d luminarias. Potencia conectada por "
                        "suma de potencias nominales declaradas; corriente derivada de "
                        "P/(V x fp) con fp=%.2f." % (len(luminaires), B.HYP_POWER_FACTOR)),
        derived_from=["HYP_LUMINAIRE", "HYP_POWER_FACTOR"],
        validation_notes=["La corriente es una derivacion aritmetica de hipotesis, no "
                          "una medicion. El punto de alimentacion no esta definido."],
    )
    for lcid in luminaires:
        K.link(model, connection_id="CNX-%s-CIR" % lcid, discipline="lighting",
               type="power_feed", origin=cid, destination=lcid,
               medium="conductor_cobre_en_canalizacion", technology="circuito de alumbrado",
               parameters={"nominal_voltage_v": lum["nominal_voltage_v"],
                           "declared_power_w": lum["nominal_power_w"],
                           "conductor_gauge": None},
               flow_direction="circuito_hacia_luminaria",
               requires_calculation=["conductor_gauge"])


# ---------------------------------------------------------------------------
# Señalización
# ---------------------------------------------------------------------------


def build_signage(model) -> None:
    half_c = B.CARRIAGEWAY_WIDTH / 2
    base = round(B.DECK_TOP + B.HYP_WEARING_THICKNESS, 4)

    # --- marcas viales: bordes y separadores de carril ---
    lane_lines = [-half_c, half_c]
    for i in range(1, B.REQ_LANES):
        lane_lines.append(round(-half_c + B.CARRIAGEWAY_WIDTH * i / B.REQ_LANES, 4))
    for idx, y in enumerate(sorted(lane_lines), start=1):
        edge = abs(abs(y) - half_c) < 1e-6
        cid = "SEN-MAR-%02d" % idx
        sid = "SOL-%s" % cid
        w = B.HYP_LANE_MARK_WIDTH
        prism = S.box_prism(0.0, y - w / 2, B.REQ_LENGTH, y + w / 2,
                            base, round(base + 0.004, 4))
        solid = _solid(sid, [prism], "pintura_vial", "signage", "TAB", "SEN-MARCAS")
        op = model.oplog.record(
            "extrude", "creation",
            "Marca vial %s en y=%.2f, ancho %.2f m."
            % ("de borde" if edge else "de separacion de carril", y, w),
            component_id=cid, solid_id=sid,
            inputs={"y": y, "width": w, "edge": edge},
            outputs={"length_m": B.REQ_LENGTH},
            derived_from=["HYP_LANE_MARK_WIDTH", "REQ_LANES", "CARRIAGEWAY_WIDTH"],
            implementation="solids.Prism (extrusion en Z)",
        )
        _register(model, Component(
            component_id=cid, discipline="signage", type="road_marking",
            name="Marca vial %s %d" % ("de borde" if edge else "de carril", idx),
            level_id="TAB", material="pintura_vial", ifc_class="IfcCovering",
            position=[0.0, y, base],
            dimensions={"length": B.REQ_LENGTH, "width": w},
            parameters={"marking_type": "continua de borde" if edge else "separacion de carril",
                        "width_m": w, "transverse_position_m": y,
                        "pattern_standard": None, "retroreflectivity": None,
                        "material_specification": None},
            requires_calculation=["pattern_standard", "retroreflectivity",
                                  "material_specification"],
            provenance="hypothesis", tags=["senalizacion", "marca vial"],
            validation_notes=["El patron y la retrorreflectividad dependen del manual de "
                              "senalizacion aplicable."],
        ), solid, op)

    # --- señales verticales ---
    n = max(2, int(math.ceil(B.REQ_LENGTH / B.HYP_SIGN_SPACING)))
    sw, st, sh = B.HYP_SIGN_SIZE
    # Se montan sobre la barrera, como los postes: en la calzada invadirian la
    # carpeta de rodadura.
    barrier_base = round(B.DECK_TOP + (B.HYP_SIDEWALK_RISE if B.REQ_SIDEWALKS else 0.0), 4)
    sign_base = round(barrier_base + B.HYP_BARRIER_HEIGHT, 4)
    y_sign = round(B.REQ_WIDTH / 2 - B.HYP_BARRIER_WIDTH / 2, 4)

    for k in range(n):
        x = B.REQ_LENGTH * (k + 0.5) / n
        # Desfasadas media separacion respecto a los postes de alumbrado, que
        # comparten la coronacion de la barrera.
        x = _clear_of_supports(min(max(x + B.HYP_LIGHT_SPACING / 2.0, 1.5),
                                   B.REQ_LENGTH - 1.5), clearance=1.0)
        side = "L" if k % 2 == 0 else "R"
        y = -y_sign if side == "L" else y_sign
        top = round(sign_base + B.HYP_SIGN_POST_HEIGHT, 4)

        cid = "SEN-SEN-%02d" % (k + 1)
        sid = "SOL-%s" % cid
        post = S.pipe((x, y, sign_base), (x, y, top), 0.08)
        panel = S.box_prism(x - sw / 2, y - st / 2, x + sw / 2, y + st / 2,
                            round(top - sh, 4), top)
        solid = _solid(sid, [post, panel], "senal_vial", "signage", "TAB", "SEN-SENALES")
        op = model.oplog.record(
            "extrude", "creation",
            "Senal vertical %d en x=%.2f, lado %s: poste de %.2f m y panel de %.2f x %.2f m."
            % (k + 1, x, side, B.HYP_SIGN_POST_HEIGHT, sw, sh),
            component_id=cid, solid_id=sid,
            inputs={"x": round(x, 4), "y": y, "side": side,
                    "post_height": B.HYP_SIGN_POST_HEIGHT, "panel": [sw, sh]},
            outputs={}, derived_from=["HYP_SIGN_SPACING", "HYP_SIGN_SIZE",
                                      "HYP_SIGN_POST_HEIGHT"],
            implementation="solids.pipe (poste) + solids.Prism (panel)",
        )
        _register(model, Component(
            component_id=cid, discipline="signage", type="traffic_sign",
            name="Senal vertical %d" % (k + 1), level_id="TAB",
            material="senal_vial", ifc_class="IfcDiscreteAccessory",
            position=[round(x, 4), y, sign_base],
            dimensions={"panel_width": sw, "panel_height": sh,
                        "post_height": B.HYP_SIGN_POST_HEIGHT},
            parameters={"side": side, "panel_size_m": [sw, sh],
                        "mounting_height_m": B.HYP_SIGN_POST_HEIGHT,
                        "sign_code": None, "message": None,
                        "retroreflective_class": None, "wind_load_kN": None},
            requires_calculation=["sign_code", "message", "retroreflective_class",
                                  "wind_load_kN"],
            provenance="hypothesis", tags=["senalizacion", "senal"],
            validation_notes=["El codigo y el mensaje de la senal no estan definidos: "
                              "dependen del manual aplicable y del uso de la via."],
        ), solid, op)


# ---------------------------------------------------------------------------
# Instrumentación estructural
# ---------------------------------------------------------------------------


def build_instrumentation(model) -> None:
    # El gabinete y el troncal van bajo la losa, en una franja sin vigas:
    # arriba competirian con los postes de alumbrado y la baranda, y al fondo
    # de las vigas cruzarian los cabezales de pila.
    x_lo, x_hi = service_x_range()
    cabinet_x = min(max(_clear_of_supports(round(B.REQ_LENGTH * 0.5, 4), clearance=2.0),
                        x_lo + 0.5), x_hi - 0.5)
    # Corredor de servicio desplazado respecto al del drenaje, y mas abajo:
    # el gabinete es un volumen de 0.60 m de alto y compartiendo vertical con
    # el colector se solaparian.
    cabinet_y = -round(service_corridor_y() + 0.45, 4)
    structure_ref = B.DECK_BOTTOM if B.REQ_TYPE != "slab" else B.STRUCTURE_BOTTOM
    trunk_z = round(structure_ref - 0.70, 4)
    cabinet_z = trunk_z

    K.add_device(
        model, component_id="INS-GAB-001", discipline="instrumentation",
        type="acquisition_cabinet", name="Gabinete de adquisicion", level_id="TAB",
        xyz=(cabinet_x, cabinet_y, cabinet_z), box=(0.40, 0.25, 0.60),
        material="acero_galvanizado", ifc_class="IfcCommunicationsAppliance",
        layer="INS-SENSORES",
        parameters={"channel_count": None, "sampling_rate_hz": None,
                    "power_supply": None, "data_link": None,
                    "alarm_thresholds": None, "storage_policy": None},
        requires_calculation=["channel_count", "sampling_rate_hz", "power_supply",
                              "data_link", "alarm_thresholds", "storage_policy"],
        tags=["instrumentacion", "adquisicion"],
        op_description="Gabinete de adquisicion de datos en el centro del puente.",
        derived_from=["REQ_LENGTH", "REQ_WIDTH"],
        validation_notes=["No hay plan de monitoreo: sin el, el numero de canales y los "
                          "umbrales de alarma no se pueden definir."],
    )

    sensors: List[Tuple[str, Point3]] = []
    kinds = [("acelerometro", "accelerometer"), ("extensometro", "strain_gauge")]
    for s in range(B.REQ_SPAN_COUNT):
        x0, x1 = B.SPAN_EDGES[s], B.SPAN_EDGES[s + 1]
        zone = "V%d" % (s + 1)
        for j in range(B.HYP_SENSOR_PER_SPAN):
            label, kind = kinds[j % len(kinds)]
            x = x0 + (x1 - x0) * (j + 1) / (B.HYP_SENSOR_PER_SPAN + 1)
            y = B.GIRDER_OFFSETS[0] if B.GIRDER_OFFSETS else 0.0
            # Bajo la cara inferior de la viga; dentro de ella no es instalable.
            z = round(B.STRUCTURE_BOTTOM - B.HYP_SENSOR_BOX[2] / 2 - 0.02, 4)
            cid = "INS-SEN-%s-%02d" % (zone, j + 1)
            K.add_device(
                model, component_id=cid, discipline="instrumentation",
                type=kind, name="%s %s-%02d" % (label.capitalize(), zone, j + 1),
                level_id=zone, xyz=(round(x, 4), y, z), box=B.HYP_SENSOR_BOX,
                material="equipo_generico", ifc_class="IfcSensor",
                layer="INS-SENSORES",
                parameters={"sensor_kind": label, "span_index": s + 1,
                            "mounting": "cara inferior de viga",
                            "measurement_range": None, "sampling_rate_hz": None,
                            "accuracy": None, "calibration_reference": None,
                            "alarm_threshold": None},
                requires_calculation=["measurement_range", "sampling_rate_hz",
                                      "accuracy", "calibration_reference",
                                      "alarm_threshold"],
                tags=["instrumentacion", label],
                op_description=("%s en el vano %d, bajo la viga exterior. La posicion es "
                                "un reparto geometrico: %d sensores por vano."
                                % (label.capitalize(), s + 1, B.HYP_SENSOR_PER_SPAN)),
                derived_from=["HYP_SENSOR_PER_SPAN", "STRUCTURE_BOTTOM"],
                validation_notes=["La ubicacion optima depende del modo estructural que "
                                  "se quiera medir, que no esta definido."],
            )
            sensors.append((cid, (round(x, 4), y, z)))

    if sensors:
        # Recorrido ortogonal: del sensor al lateral, se sube al troncal bajo
        # la losa y se recorre hasta el gabinete. Un tramo diagonal cruzaria
        # los cabezales de pila.
        routes = [[pos,
                   (min(max(pos[0], x_lo), x_hi), pos[1], pos[2]),
                   (min(max(pos[0], x_lo), x_hi), cabinet_y, pos[2]),
                   (min(max(pos[0], x_lo), x_hi), cabinet_y, trunk_z),
                   (cabinet_x, cabinet_y, trunk_z)]
                  for _cid, pos in sensors]
        _, length = K.add_route(
            model, component_id="INS-CAB-001", discipline="instrumentation",
            type="sensor_cabling", name="Cableado de instrumentacion",
            polylines=routes, diameter=0.012, material="pvc",
            ifc_class="IfcCableCarrierSegment", layer="INS-CABLEADO", level_id="TAB",
            parameters={"sensor_count": len(sensors), "cable_type": None,
                        "shielding": None, "max_run_m": None},
            requires_calculation=["cable_type", "shielding", "max_run_m"],
            tags=["instrumentacion", "cableado"],
            op_description=("Cableado de %d sensores hasta el gabinete de adquisicion, "
                            "por la cara inferior del tablero." % len(sensors)),
            derived_from=["HYP_SENSOR_PER_SPAN"],
            flow_direction="sensor_hacia_adquisicion",
        )
        for cid, _pos in sensors:
            K.link(model, connection_id="CNX-%s-GAB" % cid,
                   discipline="instrumentation", type="signal_link",
                   origin=cid, destination="INS-GAB-001",
                   medium="cable_de_instrumentacion", technology="senal analogica o digital",
                   parameters={"cable_type": None, "sampling_rate_hz": None},
                   geometry_reference="SOL-INS-CAB-001",
                   flow_direction="sensor_hacia_adquisicion",
                   requires_calculation=["cable_type", "sampling_rate_hz"])


# ---------------------------------------------------------------------------
# Orquestador
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Iluminacion arquitectonica (realce)
# ---------------------------------------------------------------------------


def build_architectural_lighting(model) -> None:
    """Realce nocturno: tirantes, torres y barreras.

    Es iluminacion de color, no de calzada. No sustituye al alumbrado vial ni
    comparte su mando: el vial responde a seguridad y se enciende entero; el
    realce responde a un programa y se direcciona por zonas.

    Cada proyector se modela como una UNIDAD DIRECCIONABLE. El numero de nodos
    LED que contiene cada unidad depende del producto que se seleccione y aqui
    queda como pendiente: agrupar no es contar.
    """
    if not B.HYP_ARCH_LIGHTING:
        return

    half = B.REQ_WIDTH / 2
    base = round(B.DECK_TOP + (B.HYP_SIDEWALK_RISE if B.REQ_SIDEWALKS else 0.0), 4)
    fixtures: List[Tuple[str, str, float]] = []   # (id, zona de control, W)

    # --- 1. un proyector lineal por tirante, en su anclaje al tablero -------
    stays = sorted(c for c in model.components
                   if model.components[c].type == "stay_cable")
    for n, stay_id in enumerate(stays, start=1):
        stay = model.components[stay_id]
        # El tirante guarda su punto de anclaje; no se vuelve a calcular.
        anchor_x = stay.parameters.get("deck_anchor_x_m")
        anchor_y = stay.parameters.get("deck_anchor_y_m")
        if anchor_x is None or anchor_y is None:
            continue
        dx, dy, dz = B.HYP_STAY_FIXTURE["body_m"]
        # El proyector se separa del anclaje hacia AFUERA del abanico: dentro
        # del anclaje estaria en el paso del propio cable, y un cable con
        # viento se mueve. Apunta al tirante desde detras de su anclaje.
        tower_index = stay.parameters.get("tower_index")
        tower_x = (B.TOWER_AXES[tower_index - 1]
                   if tower_index and tower_index <= len(B.TOWER_AXES) else anchor_x)
        away = math.copysign(1.0, anchor_x - tower_x) if anchor_x != tower_x else 1.0
        fixture_x = round(anchor_x + away * (dx / 2 + 0.35), 4)
        cid = "ILU-ARQ-TIR-%03d" % n
        K.add_device(
            model, component_id=cid, discipline="lighting", type="accent_luminaire",
            name="Proyector de tirante %d" % n, level_id=stay.level_id,
            # Apoyado sobre el tablero junto al anclaje, apuntando al cable.
            # Sobre la viga de anclaje, a cota de tablero y no de acera: asi
            # su coronacion queda por debajo del punto mas bajo del abanico
            # y el cable pasa limpio por encima.
            xyz=(fixture_x, round(anchor_y, 4), round(B.DECK_TOP + dz / 2, 4)),
            box=(dx, dy, dz), material="luminaria",
            ifc_class="IfcLightFixture", layer="ILU-REALCE",
            parameters={"model_reference": B.HYP_STAY_FIXTURE["model_ref"],
                        "nominal_power_w": B.HYP_STAY_FIXTURE["nominal_power_w"],
                        "nominal_voltage_v": B.HYP_STAY_FIXTURE["nominal_voltage_v"],
                        "control_zone": "tirantes", "aims_at": stay_id,
                        "color_capability": "RGBW",
                        "led_node_count": None, "dmx_address": None,
                        "beam_angle_deg": None, "luminous_flux_lm": None,
                        "ip_rating": None, "photometric_file": None},
            requires_calculation=["led_node_count", "dmx_address", "beam_angle_deg",
                                  "luminous_flux_lm", "ip_rating", "photometric_file"],
            tags=["iluminacion", "realce", "tirante"],
            op_description=("Proyector de realce apuntando al tirante %s. Posicion "
                            "tomada del anclaje real del cable." % stay_id),
            derived_from=["HYP_STAY_FIXTURE"],
            validation_notes=["La direccion DMX se asigna en puesta en marcha; sin "
                              "ella el proyector no es gobernable."],
        )
        model.relate(cid, "illuminates", stay_id)
        fixtures.append((cid, "tirantes", B.HYP_STAY_FIXTURE["nominal_power_w"]))

    # --- 2. proyectores de gran alcance al pie de cada fuste de torre ------
    towers = sorted(c for c in model.components
                    if model.components[c].type == "tower")
    dx, dy, dz = B.HYP_TOWER_FLOODLIGHT["body_m"]
    tower_width = B.HYP_TOWER_SECTION[0]
    for tower_id in towers:
        tower = model.components[tower_id]
        tx, ty, tz = tower.position
        # POR FUERA del fuste, nunca entre fuste y tablero: ahi esta el abanico
        # de tirantes y el proyector quedaria dentro del paso de los cables.
        # Fuera del fuste hay plataforma de mantenimiento y el haz sube limpio.
        y_fl = round(ty + math.copysign(tower_width / 2 + 0.40, ty), 4)
        for j in range(B.HYP_FLOODLIGHTS_PER_LEG):
            # Repartidos a lo largo del fuste, alternando delante y detras,
            # para que el bañado no deje la torre medio apagada.
            offset = (j - (B.HYP_FLOODLIGHTS_PER_LEG - 1) / 2) * 2.6
            cid = "ILU-ARQ-TOR-%s-%02d" % (tower.level_id + tower.parameters.get("side", "X"), j + 1)
            K.add_device(
                model, component_id=cid, discipline="lighting", type="floodlight",
                name="Proyector de torre %s-%d" % (tower.level_id, j + 1),
                level_id=tower.level_id,
                xyz=(round(tx + offset, 4), y_fl, round(B.DECK_TOP + dz / 2, 4)),
                box=(dx, dy, dz), material="luminaria",
                ifc_class="IfcLightFixture", layer="ILU-REALCE",
                parameters={"model_reference": B.HYP_TOWER_FLOODLIGHT["model_ref"],
                            "nominal_power_w": B.HYP_TOWER_FLOODLIGHT["nominal_power_w"],
                            "nominal_voltage_v": B.HYP_TOWER_FLOODLIGHT["nominal_voltage_v"],
                            "control_zone": "torres", "aims_at": tower_id,
                            "color_capability": "RGBW",
                            "led_node_count": None, "dmx_address": None,
                            "beam_angle_deg": None, "throw_distance_m": None,
                            "luminous_flux_lm": None, "ip_rating": None},
                requires_calculation=["led_node_count", "dmx_address", "beam_angle_deg",
                                      "throw_distance_m", "luminous_flux_lm", "ip_rating"],
                tags=["iluminacion", "realce", "torre"],
                op_description=("Proyector al pie del fuste %s. El alcance necesario "
                                "depende de la altura de torre (%.2f m sobre tablero) y "
                                "no esta calculado." % (tower_id, B.TOWER_HEIGHT)),
                derived_from=["HYP_TOWER_FLOODLIGHT", "HYP_FLOODLIGHTS_PER_LEG"],
                validation_notes=["Sin estudio fotometrico no se puede afirmar que el "
                                  "proyector alcance la cabeza de la torre."],
            )
            model.relate(cid, "illuminates", tower_id)
            fixtures.append((cid, "torres", B.HYP_TOWER_FLOODLIGHT["nominal_power_w"]))

    # --- 3. bañadores lineales a lo largo de la barrera --------------------
    dx, dy, dz = B.HYP_BARRIER_ACCENT["body_m"]
    count = max(2, int(B.REQ_LENGTH // B.HYP_BARRIER_ACCENT_SPACING))
    for k in range(count):
        x = round(min(max(B.REQ_LENGTH * (k + 0.5) / count, 1.0), B.REQ_LENGTH - 1.0), 4)
        for side, y in (("L", -round(half - B.HYP_BARRIER_WIDTH - 0.08, 4)),
                        ("R", round(half - B.HYP_BARRIER_WIDTH - 0.08, 4))):
            cid = "ILU-ARQ-BAR-%s-%03d" % (side, k + 1)
            K.add_device(
                model, component_id=cid, discipline="lighting", type="accent_luminaire",
                name="Bañador de barrera %s-%d" % (side, k + 1), level_id="TAB",
                xyz=(x, y, round(base + dz / 2, 4)), box=(dx, dy, dz),
                material="luminaria", ifc_class="IfcLightFixture", layer="ILU-REALCE",
                parameters={"model_reference": B.HYP_BARRIER_ACCENT["model_ref"],
                            "nominal_power_w": B.HYP_BARRIER_ACCENT["nominal_power_w"],
                            "nominal_voltage_v": B.HYP_BARRIER_ACCENT["nominal_voltage_v"],
                            "control_zone": "barreras", "side": side,
                            "color_capability": "RGB", "spacing_rule_m":
                                B.HYP_BARRIER_ACCENT_SPACING,
                            "led_node_count": None, "dmx_address": None,
                            "luminous_flux_lm": None, "ip_rating": None,
                            "glare_check": None},
                requires_calculation=["led_node_count", "dmx_address", "luminous_flux_lm",
                                      "ip_rating", "glare_check"],
                tags=["iluminacion", "realce", "barrera"],
                op_description=("Bañador de barrera en x=%.2f, lado %s. Reparto "
                                "geometrico cada %.2f m." % (x, side,
                                                             B.HYP_BARRIER_ACCENT_SPACING)),
                derived_from=["HYP_BARRIER_ACCENT", "HYP_BARRIER_ACCENT_SPACING"],
                validation_notes=["Un bañador a la altura del conductor exige "
                                  "comprobacion de deslumbramiento; no esta hecha."],
            )
            fixtures.append((cid, "barreras", B.HYP_BARRIER_ACCENT["nominal_power_w"]))

    model.arch_fixtures = fixtures   # lo consume build_control


# ---------------------------------------------------------------------------
# Control y sistemas embebidos
# ---------------------------------------------------------------------------


def build_control(model) -> None:
    """El mando del alumbrado: lo que decide CUANDO y DE QUE COLOR se enciende.

    Cadena de causa declarada, de principio a fin:

        fotocelda  ->  controlador  ->  contactor  ->  circuito vial
                   ->  controlador  ->  fuente DMX ->  proyectores de realce

    Nada aqui esta dimensionado. El numero de universos, la direccion de cada
    proyector y la potencia de cada fuente dependen del producto que se
    seleccione y del programa de iluminacion, y quedan declarados pendientes.
    """
    cfg = B.HYP_CONTROL
    fixtures = getattr(model, "arch_fixtures", [])
    base = round(B.DECK_TOP + (B.HYP_SIDEWALK_RISE if B.REQ_SIDEWALKS else 0.0), 4)
    half = B.REQ_WIDTH / 2
    y_cab = round(half - B.HYP_BARRIER_WIDTH - 0.9, 4)

    # --- gabinete principal, en el estribo inicial -------------------------
    dx, dy, dz = cfg["cabinet_box_m"]
    cab = "CTL-GAB-001"
    K.add_device(
        model, component_id=cab, discipline="control", type="control_cabinet",
        name="Gabinete de control de alumbrado", level_id="EA",
        xyz=(2.5, -y_cab, round(base + dz / 2, 4)), box=(dx, dy, dz),
        material="acero_galvanizado", ifc_class="IfcElectricDistributionBoard",
        layer="CTL-GABINETES",
        parameters={"nominal_voltage_v": cfg["nominal_voltage_v"],
                    "data_protocol": cfg["data_protocol"],
                    "zones_served": list(B.HYP_CONTROL_ZONES),
                    "short_circuit_rating_kA": None, "ip_rating": None,
                    "thermal_dissipation_w": None, "ups_autonomy_min": None,
                    "supply_point": None},
        requires_calculation=["short_circuit_rating_kA", "ip_rating",
                              "thermal_dissipation_w", "ups_autonomy_min",
                              "supply_point"],
        tags=["control", "gabinete"],
        op_description="Gabinete de control en el estribo inicial, accesible sin cortar trafico.",
        derived_from=["HYP_CONTROL"],
        validation_notes=["El punto de acometida no esta definido: sin el no hay "
                          "proteccion de cabecera ni calculo de corto."],
    )

    # --- fotocelda: el sensor que dispara el encendido ---------------------
    dx, dy, dz = cfg["photocell_box_m"]
    photocell = "CTL-FOT-001"
    K.add_device(
        model, component_id=photocell, discipline="control", type="photocell",
        name="Fotocelda crepuscular", level_id="EA",
        # Sobre el gabinete y mirando al cielo: junto a una luminaria se
        # realimentaria con su propia luz y oscilaria al anochecer.
        xyz=(2.5, -y_cab, round(base + dz + cfg["cabinet_box_m"][2], 4)),
        box=(dx, dy, dz), material="equipo_generico", ifc_class="IfcSensor",
        layer="CTL-SENSORES",
        parameters={"sensor_kind": "fotocelda", "mounting": "sobre gabinete, vista al cielo",
                    "switch_on_lux": None, "switch_off_lux": None,
                    "response_delay_s": None, "output_type": None,
                    "nominal_voltage_v": None},
        requires_calculation=["switch_on_lux", "switch_off_lux", "response_delay_s",
                              "output_type", "nominal_voltage_v"],
        tags=["control", "sensor", "embebido"],
        op_description=("Fotocelda que ordena el encendido. Los umbrales de lux no "
                        "estan definidos: dependen del criterio del operador."),
        derived_from=["HYP_CONTROL"],
        validation_notes=["Sin umbrales declarados el encendido no es reproducible.",
                          "Conviene redundarla con reloj astronomico: una fotocelda "
                          "sucia o sombreada deja el puente a oscuras."],
    )
    model.relate(photocell, "housed_in", cab)

    # --- reloj astronomico: redundancia del anterior -----------------------
    dx, dy, dz = cfg["controller_box_m"]
    clock = "CTL-RLJ-001"
    K.add_device(
        model, component_id=clock, discipline="control", type="astronomical_timer",
        name="Reloj astronomico", level_id="EA",
        xyz=(2.5, -y_cab + 0.05, round(base + 0.30, 4)), box=(dx, dy, dz),
        material="equipo_generico", ifc_class="IfcController", layer="CTL-EQUIPOS",
        # Si el emplazamiento esta declarado, el reloj ya nace con sus
        # coordenadas: es el unico equipo del puente cuyo comportamiento
        # depende literalmente de donde esta el puente.
        parameters={"function": "calcula orto y ocaso para la latitud del sitio",
                    "latitude_deg": B.SITE.get("latitude_deg"),
                    "longitude_deg": B.SITE.get("longitude_deg"),
                    "coordinate_source": (B.SITE.get("provenance", {}).get("latitude_deg")
                                          if B.SITE.get("latitude_deg") is not None
                                          else None),
                    "timezone": None,
                    "backup_autonomy_h": None, "time_sync_source": None},
        requires_calculation=(
            ["timezone", "backup_autonomy_h", "time_sync_source"]
            + ([] if B.SITE.get("latitude_deg") is not None
               else ["latitude_deg", "longitude_deg"])),
        tags=["control", "embebido", "redundancia"],
        op_description=("Reloj astronomico en paralelo con la fotocelda. La latitud "
                        "y longitud se cargan en puesta en marcha."),
        derived_from=["HYP_CONTROL"],
        validation_notes=(
            ["Coordenadas tomadas del emplazamiento declarado; verificar contra "
             "levantamiento antes de la puesta en marcha."]
            if B.SITE.get("latitude_deg") is not None
            else ["Sin coordenadas cargadas el reloj no calcula el ocaso."]),
    )
    model.relate(clock, "housed_in", cab)

    # --- contactor del alumbrado vial --------------------------------------
    contactor = "CTL-CON-001"
    K.add_device(
        model, component_id=contactor, discipline="control", type="contactor",
        name="Contactor del alumbrado vial", level_id="EA",
        xyz=(2.5, -y_cab - 0.05, round(base + 0.70, 4)), box=(0.18, 0.14, 0.22),
        material="equipo_generico", ifc_class="IfcProtectiveDevice", layer="CTL-EQUIPOS",
        parameters={"controls": "ILU-CIR-001", "command_source": photocell,
                    "rated_current_a": None, "coil_voltage_v": None,
                    "utilization_category": None, "making_capacity_a": None},
        requires_calculation=["rated_current_a", "coil_voltage_v",
                              "utilization_category", "making_capacity_a"],
        tags=["control", "maniobra"],
        op_description=("Contactor que abre y cierra el circuito vial por orden de la "
                        "fotocelda. Su calibre depende de la corriente de arranque del "
                        "circuito, que no esta calculada."),
        derived_from=["HYP_CONTROL"],
        validation_notes=["Dimensionar un contactor con la corriente nominal y no con "
                          "la de arranque es un error frecuente; falta el dato."],
    )
    model.relate(contactor, "housed_in", cab)
    K.link(model, connection_id="CNX-FOT-CTL", discipline="control",
           type="signal", origin=photocell, destination=contactor,
           medium="señal_de_mando", technology="contacto seco o salida digital",
           parameters={"signal_type": None, "nominal_voltage_v": None},
           flow_direction="sensor_hacia_maniobra",
           requires_calculation=["signal_type", "nominal_voltage_v"])
    if "ILU-CIR-001" in model.components:
        K.link(model, connection_id="CNX-CTL-CIR", discipline="control",
               type="power_switching", origin=contactor, destination="ILU-CIR-001",
               medium="conductor_de_potencia", technology="maniobra de circuito",
               parameters={"switched_power_w":
                           model.components["ILU-CIR-001"].parameters.get("connected_power_w"),
                           "rated_current_a": None},
               flow_direction="contactor_hacia_circuito",
               requires_calculation=["rated_current_a"])

    # --- un controlador y una fuente por zona de realce --------------------
    by_zone: Dict[str, List[Tuple[str, float]]] = {}
    for fid, zone, watts in fixtures:
        by_zone.setdefault(zone, []).append((fid, watts))

    # Troncal de datos a lo largo del tablero: sin el, el gabinete del estribo
    # no alcanza a los proyectores del vano central.
    if by_zone:
        y_data = round(half - B.HYP_BARRIER_WIDTH - 0.30, 4)
        _, data_len = K.add_route(
            model, component_id="CTL-RED", discipline="control", type="data_conduit",
            name="Troncal de datos de iluminacion",
            polylines=[[(2.5, -y_data, round(base + 0.10, 4)),
                        (B.REQ_LENGTH - 2.5, -y_data, round(base + 0.10, 4))]],
            diameter=B.HYP_DATA_CONDUIT_DIAMETER, material="pvc",
            ifc_class="IfcCableCarrierSegment", layer="CTL-RED", level_id="TAB",
            parameters={"protocol": cfg["data_protocol"],
                        "segregation_from_power": "canalizacion independiente",
                        "cable_type": None, "max_segment_length_m": None,
                        "shielding": None},
            requires_calculation=["cable_type", "max_segment_length_m", "shielding"],
            tags=["control", "red"],
            op_description=("Troncal de datos separado de la canalizacion de potencia: "
                            "compartir tubo con el alumbrado induce ruido en el bus."),
            derived_from=["HYP_DATA_CONDUIT_DIAMETER"],
        )
    else:
        data_len = 0.0

    for i, zone in enumerate(B.HYP_CONTROL_ZONES, start=1):
        group = by_zone.get(zone, [])
        if not group:
            continue
        x = round(B.REQ_LENGTH * i / (len(B.HYP_CONTROL_ZONES) + 1), 4)
        connected = round(sum(w for _, w in group), 2)
        current = round(connected / (cfg["nominal_voltage_v"] * B.HYP_POWER_FACTOR), 3)

        dx, dy, dz = cfg["controller_box_m"]
        ctrl = "CTL-DMX-%02d" % i
        K.add_device(
            model, component_id=ctrl, discipline="control", type="lighting_controller",
            name="Controlador de iluminacion, zona %s" % zone, level_id="TAB",
            xyz=(x, -y_cab, round(base + 0.35, 4)), box=(dx, dy, dz),
            material="equipo_generico", ifc_class="IfcController", layer="CTL-EQUIPOS",
            parameters={"control_zone": zone, "fixture_count": len(group),
                        "data_protocol": cfg["data_protocol"],
                        "universes_required": None, "addresses_assigned": None,
                        "scene_program": None, "network_address": None,
                        "failover_behaviour": None},
            requires_calculation=["universes_required", "addresses_assigned",
                                  "scene_program", "network_address",
                                  "failover_behaviour"],
            tags=["control", "embebido", "dmx"],
            op_description=("Controlador de la zona %s, con %d proyectores a su cargo. "
                            "El numero de universos depende de los nodos LED por "
                            "proyector, que no esta definido." % (zone, len(group))),
            derived_from=["HYP_CONTROL"],
            validation_notes=["Un universo DMX512 direcciona 512 canales; sin saber "
                              "los canales por proyector no se puede repartir."],
        )
        model.relate(ctrl, "commanded_by", cab)

        dx, dy, dz = cfg["driver_box_m"]
        psu = "CTL-FTE-%02d" % i
        K.add_device(
            model, component_id=psu, discipline="control", type="led_driver",
            name="Fuente y driver, zona %s" % zone, level_id="TAB",
            xyz=(round(x + 0.6, 4), -y_cab, round(base + 0.35, 4)), box=(dx, dy, dz),
            material="equipo_generico", ifc_class="IfcElectricDistributionBoard",
            layer="CTL-EQUIPOS",
            parameters={"control_zone": zone, "fixture_count": len(group),
                        "connected_power_w": connected,
                        "nominal_voltage_v": cfg["nominal_voltage_v"],
                        "derived_current_a": current,
                        "current_derivation": "P/(V*fp)",
                        "power_factor_assumed": B.HYP_POWER_FACTOR,
                        "output_voltage_v": None, "efficiency": None,
                        "dimming_curve": None, "thermal_derating": None},
            requires_calculation=["output_voltage_v", "efficiency", "dimming_curve",
                                  "thermal_derating"],
            tags=["control", "fuente"],
            op_description=("Fuente de la zona %s. Potencia conectada por suma de "
                            "potencias nominales declaradas; corriente derivada de "
                            "P/(V x fp) con fp=%.2f." % (zone, B.HYP_POWER_FACTOR)),
            derived_from=["HYP_CONTROL", "HYP_POWER_FACTOR"],
            validation_notes=["La corriente es aritmetica sobre hipotesis, no una "
                              "medicion. Sin rendimiento declarado no hay consumo real."],
        )
        K.link(model, connection_id="CNX-%s-%s" % (ctrl, psu), discipline="control",
               type="signal", origin=ctrl, destination=psu,
               medium="bus_de_datos", technology=cfg["data_protocol"],
               parameters={"protocol": cfg["data_protocol"], "cable_type": None},
               flow_direction="controlador_hacia_fuente",
               requires_calculation=["cable_type"])
        for fid, _w in group:
            model.relate(fid, "driven_by", psu)


def lighting_control_report(model) -> Dict[str, Any]:
    """Describe la cadena de mando del alumbrado para que se pueda EVALUAR.

    No simula nada. Expone qué gobierna a qué, de modo que un evaluador
    determinista pueda responder "a esta hora, este circuito esta energizado,
    y por esta razon". Lo que no se puede determinar se dice en `undetermined`
    en vez de resolverse con un valor por defecto.
    """
    comps = model.components

    def ids_of(predicate) -> List[str]:
        return sorted(c.component_id for c in comps.values() if predicate(c))

    sensor = next(iter(ids_of(lambda c: c.type == "photocell")), None)
    clock = next(iter(ids_of(lambda c: c.type == "astronomical_timer")), None)
    contactor = next(iter(ids_of(lambda c: c.type == "contactor")), None)
    cabinet = next(iter(ids_of(lambda c: c.type == "control_cabinet")), None)

    zones: List[Dict[str, Any]] = []
    undetermined: List[str] = []

    # --- zona vial: la gobierna el contactor, no un controlador DMX --------
    road_circuit = next(iter(ids_of(lambda c: c.type == "lighting_circuit")), None)
    if road_circuit:
        circuit = comps[road_circuit]
        fixtures = ids_of(lambda c: c.type == "luminaire")
        zones.append({
            "zone": "vial",
            "label": "Alumbrado vial",
            "purpose": "seguridad de la circulacion",
            "circuit_id": road_circuit,
            "switched_by": contactor,
            "controller_id": None,
            "driver_id": None,
            "fixtures": fixtures,
            "fixture_count": len(fixtures),
            "connected_power_w": circuit.parameters.get("connected_power_w"),
            "nominal_voltage_v": circuit.parameters.get("nominal_voltage_v"),
            "dimmable": False,
            "color_capability": None,
        })

    # --- zonas de realce: cada una con su controlador y su fuente ----------
    for controller in ids_of(lambda c: c.type == "lighting_controller"):
        ctrl = comps[controller]
        zone = ctrl.parameters.get("control_zone")
        driver = next(iter(ids_of(
            lambda c: c.type == "led_driver"
            and c.parameters.get("control_zone") == zone)), None)
        fixtures = ids_of(lambda c: c.parameters.get("control_zone") == zone
                          and c.discipline == "lighting")
        zones.append({
            "zone": zone,
            "label": "Realce: %s" % zone,
            "purpose": "programa de iluminacion arquitectonica",
            "circuit_id": None,
            "switched_by": None,
            "controller_id": controller,
            "driver_id": driver,
            "fixtures": fixtures,
            "fixture_count": len(fixtures),
            "connected_power_w": (comps[driver].parameters.get("connected_power_w")
                                  if driver else None),
            "nominal_voltage_v": (comps[driver].parameters.get("nominal_voltage_v")
                                  if driver else None),
            "dimmable": True,
            "color_capability": next(
                (comps[f].parameters.get("color_capability") for f in fixtures
                 if comps[f].parameters.get("color_capability")), None),
        })

    # --- que se puede evaluar y que no ------------------------------------
    sensor_thresholds = None
    if sensor:
        sensor_thresholds = {
            "switch_on_lux": comps[sensor].parameters.get("switch_on_lux"),
            "switch_off_lux": comps[sensor].parameters.get("switch_off_lux"),
        }
        if sensor_thresholds["switch_on_lux"] is None:
            undetermined.append(
                "La fotocelda %s no tiene umbral de lux declarado, asi que su "
                "estado no se puede evaluar. El mando se resuelve por el reloj "
                "astronomico." % sensor)

    latitude = longitude = None
    if clock:
        latitude = comps[clock].parameters.get("latitude_deg")
        longitude = comps[clock].parameters.get("longitude_deg")
        if latitude is None or longitude is None:
            undetermined.append(
                "El reloj astronomico %s no tiene coordenadas cargadas: sin ellas "
                "no hay orto ni ocaso que calcular." % clock)

    for z in zones:
        if z["controller_id"] and not z["driver_id"]:
            undetermined.append(
                "La zona %s tiene controlador pero no fuente: la cadena esta "
                "incompleta." % z["zone"])

    return {
        "cabinet_id": cabinet,
        "sensor_id": sensor,
        "sensor_thresholds": sensor_thresholds,
        "clock_id": clock,
        "latitude_deg": latitude,
        "longitude_deg": longitude,
        "contactor_id": contactor,
        "zones": zones,
        "total_fixtures": sum(z["fixture_count"] for z in zones),
        "undetermined": undetermined,
        # Deja constancia de lo que esto NO es, dentro del propio dato.
        "not_simulated": [
            "corriente y caida de tension reales",
            "flujo luminoso, iluminancia y uniformidad",
            "comportamiento termico de fuentes y proyectores",
            "fallos, arranque y transitorios",
        ],
    }


BUILDERS = {
    "structure": [build_foundations, build_piers, build_abutments, build_bearings,
                  build_superstructure, build_towers_and_stays, build_arch,
                  build_joints],
    "deck": [build_deck],
    "barriers": [build_barriers],
    "drainage": [build_drainage],
    "lighting": [build_lighting, build_architectural_lighting],
    "signage": [build_signage],
    "instrumentation": [build_instrumentation],
    "control": [build_control],
}

# La estructura y el tablero son la base geometrica del resto.
REQUIRED_BY = {
    "deck": {"structure"},
    "barriers": {"structure", "deck"},
    "drainage": {"structure", "deck"},
    "lighting": {"structure", "deck"},
    "signage": {"structure", "deck"},
    "instrumentation": {"structure"},
    # El control manda sobre el alumbrado: sin luminarias no hay nada que mandar.
    "control": {"structure", "deck", "lighting"},
}


def expand_disciplines(requested: Sequence[str]) -> List[str]:
    chosen = set(requested or B.DISCIPLINES)
    changed = True
    while changed:
        changed = False
        for key in list(chosen):
            for dep in REQUIRED_BY.get(key, ()):
                if dep not in chosen:
                    chosen.add(dep)
                    changed = True
    return [d for d in B.DISCIPLINES if d in chosen]


def build(model, disciplines: Optional[Sequence[str]] = None) -> List[str]:
    chosen = expand_disciplines(list(disciplines or B.DISCIPLINES))
    for key in chosen:
        for fn in BUILDERS[key]:
            fn(model)
    return chosen

"""Paquete estructural: columnas, vigas, losas, escaleras, cimentacion y nudos.

ADVERTENCIA DE ALCANCE
----------------------
Todas las secciones de este modulo son HIPOTESIS GEOMETRICAS CONCEPTUALES
adoptadas para poder construir un modelo coherente. No provienen de analisis
estructural, no estan verificadas frente a ninguna norma y no incluyen
refuerzo. Cada componente registra en `requires_calculation` los parametros
que un diseno real debe determinar.

Reparto vertical adoptado por nivel (sin solapes, suma exacta 3.60 m):

    piso del nivel            z = E
    columna                   z = E        .. E + 3.20     (altura libre)
    alma de viga              z = E + 3.20 .. E + 3.48     (0.28)
    losa                      z = E + 3.48 .. E + 3.60     (0.12)
    piso del nivel siguiente  z = E + 3.60

El canto total viga+losa es 0.40 m, que es el valor HYP_STRUCTURAL_DEPTH.
"""

from __future__ import annotations

from typing import Dict, List, Optional, Tuple

import params as P
import solids as S
from catalog import (
    Component,
    Connection,
    VALIDATION_PENDING,
)

CONCRETE_PENDING = [
    "specified_concrete_strength_fc",
    "reinforcement_layout",
    "design_loads",
    "load_combinations",
    "code_compliance_check",
]


def _axis_label(ix: int, iy: int) -> str:
    return "%s%s" % (P.GRID_X_LABELS[ix], P.GRID_Y_LABELS[iy])


def _register(model, comp: Component, solid: Optional[S.Solid], op_id: Optional[str]) -> Component:
    if solid is not None:
        model.add_solid(solid)
        comp.geometry_reference = solid.solid_id
    if op_id:
        comp.operations.append(op_id)
    model.add_component(comp)
    return comp


# ---------------------------------------------------------------------------
# Cimentacion conceptual
# ---------------------------------------------------------------------------


def build_foundations(model) -> None:
    fw, fl = P.HYP_FOOTING_PLAN
    ft = P.HYP_FOOTING_THICKNESS
    top = P.HYP_FOOTING_TOP_LEVEL
    base = round(top - ft, 3)
    pw, pl = P.HYP_PEDESTAL_SIZE

    for iy in range(len(P.GRID_Y)):
        for ix in range(len(P.GRID_X)):
            gx, gy = P.GRID_X[ix], P.GRID_Y[iy]
            tag = _axis_label(ix, iy)

            # --- zapata ---
            sid = "SOL-STR-ZAP-%s" % tag
            prism = S.box_prism(gx - fw / 2, gy - fl / 2, gx + fw / 2, gy + fl / 2, base, top)
            solid = S.Solid(sid, [prism], "concreto_estructural", "structure", "NF", "ESTR-CIMENTACION")
            op = model.oplog.record(
                "extrude", "creation",
                "Zapata conceptual aislada %s: rectangulo %.2fx%.2f extruido %.2f m en Z." % (tag, fw, fl, ft),
                component_id="STR-ZAP-%s" % tag, solid_id=sid,
                inputs={"center": [gx, gy], "plan": [fw, fl], "thickness": ft, "z_base": base, "z_top": top},
                outputs={"volume_m3": round(fw * fl * ft, 6)},
                derived_from=["HYP_FOOTING_PLAN", "HYP_FOOTING_THICKNESS", "HYP_FOOTING_TOP_LEVEL", "GRID_X", "GRID_Y"],
                implementation="solids.Prism (extrusion en Z)",
            )
            comp = Component(
                component_id="STR-ZAP-%s" % tag,
                discipline="structure", type="footing",
                name="Zapata conceptual %s" % tag,
                level_id="NF", material="concreto_estructural",
                ifc_class="IfcFooting",
                position=[gx, gy, base],
                dimensions={"length": fl, "width": fw, "thickness": ft},
                parameters={
                    "plan_dimensions_m": [fw, fl],
                    "thickness_m": ft,
                    "top_level_m": top,
                    "bearing_capacity_kPa": None,
                    "soil_study_reference": None,
                    "specified_concrete_strength_fc": None,
                    "reinforcement_layout": None,
                    "settlement_check": None,
                },
                requires_calculation=CONCRETE_PENDING + ["bearing_capacity_kPa", "soil_study_reference", "settlement_check"],
                provenance="hypothesis",
                tags=["cimentacion", "conceptual"],
                validation_notes=["Dimension adoptada sin estudio geotecnico. No apta para construccion."],
            )
            _register(model, comp, solid, op)

            # --- pedestal ---
            sid = "SOL-STR-PED-%s" % tag
            prism = S.box_prism(gx - pw / 2, gy - pl / 2, gx + pw / 2, gy + pl / 2, top, 0.0)
            solid = S.Solid(sid, [prism], "concreto_estructural", "structure", "NF", "ESTR-CIMENTACION")
            op = model.oplog.record(
                "extrude", "creation",
                "Pedestal %s desde cota de zapata %.2f hasta nivel 0.00." % (tag, top),
                component_id="STR-PED-%s" % tag, solid_id=sid,
                inputs={"center": [gx, gy], "plan": [pw, pl], "z0": top, "z1": 0.0},
                outputs={"volume_m3": round(pw * pl * abs(top), 6)},
                derived_from=["HYP_PEDESTAL_SIZE", "HYP_FOOTING_TOP_LEVEL"],
                implementation="solids.Prism (extrusion en Z)",
            )
            comp = Component(
                component_id="STR-PED-%s" % tag,
                discipline="structure", type="pedestal",
                name="Pedestal %s" % tag,
                level_id="NF", material="concreto_estructural",
                ifc_class="IfcColumn",
                position=[gx, gy, top],
                dimensions={"width": pw, "depth": pl, "height": round(abs(top), 3)},
                parameters={
                    "section_m": [pw, pl],
                    "height_m": round(abs(top), 3),
                    "specified_concrete_strength_fc": None,
                    "reinforcement_layout": None,
                },
                requires_calculation=CONCRETE_PENDING,
                provenance="hypothesis",
                tags=["cimentacion", "conceptual"],
            )
            _register(model, comp, solid, op)

            model.relate("STR-PED-%s" % tag, "supported_by", "STR-ZAP-%s" % tag)
            model.add_connection(Connection(
                connection_id="CNX-STR-%s-ZAP-PED" % tag,
                discipline="structure", type="structural_joint",
                origin="STR-ZAP-%s" % tag, destination="STR-PED-%s" % tag,
                medium="monolitico_concreto", technology="junta de construccion",
                parameters={"joint_type": "monolitica", "dowel_detail": None, "rebar_continuity": None},
                requires_calculation=["dowel_detail", "rebar_continuity"],
                provenance="hypothesis",
            ))


# ---------------------------------------------------------------------------
# Columnas
# ---------------------------------------------------------------------------


def build_columns(model) -> None:
    cw, cd = P.HYP_COLUMN_SIZE
    for level in P.LEVELS:
        lid = level["level_id"]
        e = level["elevation"]
        z1 = round(e + P.REQ_CLEAR_HEIGHT, 3)
        for iy in range(len(P.GRID_Y)):
            for ix in range(len(P.GRID_X)):
                gx, gy = P.GRID_X[ix], P.GRID_Y[iy]
                tag = _axis_label(ix, iy)
                cid = "STR-COL-%s-%s" % (lid, tag)
                sid = "SOL-%s" % cid
                prism = S.box_prism(gx - cw / 2, gy - cd / 2, gx + cw / 2, gy + cd / 2, e, z1)
                solid = S.Solid(sid, [prism], "concreto_estructural", "structure", lid, "ESTR-COLUMNAS")
                op = model.oplog.record(
                    "extrude", "creation",
                    "Columna %s del %s: seccion %.2fx%.2f extruida desde %.2f hasta %.2f." % (tag, lid, cw, cd, e, z1),
                    component_id=cid, solid_id=sid,
                    inputs={"grid": tag, "center": [gx, gy], "section": [cw, cd], "z0": e, "z1": z1},
                    outputs={"height_m": round(z1 - e, 6), "volume_m3": round(cw * cd * (z1 - e), 6)},
                    derived_from=["HYP_COLUMN_SIZE", "GRID_X", "GRID_Y", "REQ_CLEAR_HEIGHT", "REQ_FLOOR_TO_FLOOR"],
                    implementation="solids.Prism (extrusion en Z)",
                )
                comp = Component(
                    component_id=cid, discipline="structure", type="column",
                    name="Columna %s %s" % (tag, lid),
                    level_id=lid, material="concreto_estructural", ifc_class="IfcColumn",
                    position=[gx, gy, e],
                    dimensions={"width": cw, "depth": cd, "height": round(z1 - e, 3)},
                    parameters={
                        "grid_intersection": tag,
                        "section_m": [cw, cd],
                        "clear_height_m": P.REQ_CLEAR_HEIGHT,
                        "specified_concrete_strength_fc": None,
                        "longitudinal_reinforcement": None,
                        "transverse_reinforcement": None,
                        "axial_load_kN": None,
                        "slenderness_check": None,
                    },
                    requires_calculation=CONCRETE_PENDING + ["axial_load_kN", "slenderness_check"],
                    provenance="hypothesis",
                    tags=["portico", "conceptual"],
                )
                _register(model, comp, solid, op)

                if lid == "N1":
                    model.relate(cid, "supported_by", "STR-PED-%s" % tag)
                    model.add_connection(Connection(
                        connection_id="CNX-STR-%s-PED-COL" % tag,
                        discipline="structure", type="structural_joint",
                        origin="STR-PED-%s" % tag, destination=cid,
                        medium="monolitico_concreto", technology="arranque de columna",
                        parameters={"joint_type": "monolitica", "anchorage_length": None},
                        requires_calculation=["anchorage_length"], provenance="hypothesis",
                    ))
                else:
                    prev = "STR-COL-N%d-%s" % (level["index"] - 1, tag)
                    model.relate(cid, "continues_from", prev)
                    model.add_connection(Connection(
                        connection_id="CNX-STR-%s-%s-SPLICE" % (lid, tag),
                        discipline="structure", type="structural_joint",
                        origin=prev, destination=cid,
                        medium="monolitico_concreto", technology="empalme de columna en nudo",
                        parameters={"joint_type": "nudo viga-columna", "splice_length": None},
                        requires_calculation=["splice_length"], provenance="hypothesis",
                    ))


# ---------------------------------------------------------------------------
# Vigas
# ---------------------------------------------------------------------------


def build_beams(model) -> None:
    bw = P.HYP_BEAM_WIDTH
    stem = round(P.HYP_BEAM_DEPTH - P.HYP_SLAB_THICKNESS, 3)   # 0.28
    half_col = P.HYP_COLUMN_SIZE[0] / 2.0

    for level in P.LEVELS:
        lid = level["level_id"]
        e = level["elevation"]
        z0 = round(e + P.REQ_CLEAR_HEIGHT, 3)
        z1 = round(z0 + stem, 3)

        # Vigas en direccion X: recorren completo el vano entre ejes.
        for iy, yl in enumerate(P.GRID_Y_LABELS):
            gy = P.GRID_Y[iy]
            for ix in range(len(P.GRID_X) - 1):
                x0, x1 = P.GRID_X[ix], P.GRID_X[ix + 1]
                tag = "X-%s-%s%s" % (yl, P.GRID_X_LABELS[ix], P.GRID_X_LABELS[ix + 1])
                cid = "STR-VIG-%s-%s" % (lid, tag)
                sid = "SOL-%s" % cid
                prism = S.box_prism(x0, gy - bw / 2, x1, gy + bw / 2, z0, z1)
                solid = S.Solid(sid, [prism], "concreto_estructural", "structure", lid, "ESTR-VIGAS")
                span = round(x1 - x0, 3)
                op = model.oplog.record(
                    "extrude", "creation",
                    "Viga %s del %s en direccion X, luz %.2f m, alma %.2fx%.2f." % (tag, lid, span, bw, stem),
                    component_id=cid, solid_id=sid,
                    inputs={"direction": "X", "grid_line": yl, "x0": x0, "x1": x1, "y": gy,
                            "web_section": [bw, stem], "z0": z0, "z1": z1},
                    outputs={"span_m": span, "volume_m3": round(bw * stem * span, 6)},
                    derived_from=["HYP_BEAM_WIDTH", "HYP_BEAM_DEPTH", "HYP_SLAB_THICKNESS", "GRID_X", "GRID_Y"],
                    implementation="solids.Prism (extrusion en Z)",
                )
                comp = Component(
                    component_id=cid, discipline="structure", type="beam",
                    name="Viga %s %s" % (tag, lid),
                    level_id=lid, material="concreto_estructural", ifc_class="IfcBeam",
                    position=[x0, gy, z0],
                    dimensions={"span": span, "width": bw, "web_depth": stem,
                                "total_depth_with_slab": P.HYP_BEAM_DEPTH},
                    parameters={
                        "direction": "X", "grid_line": yl, "span_m": span,
                        "web_section_m": [bw, stem],
                        "total_depth_m": P.HYP_BEAM_DEPTH,
                        "specified_concrete_strength_fc": None,
                        "longitudinal_reinforcement": None,
                        "stirrups": None,
                        "design_moment_kNm": None,
                        "design_shear_kN": None,
                        "deflection_check": None,
                    },
                    requires_calculation=CONCRETE_PENDING + ["design_moment_kNm", "design_shear_kN", "deflection_check"],
                    provenance="hypothesis", tags=["portico", "conceptual"],
                )
                _register(model, comp, solid, op)
                for k in (ix, ix + 1):
                    model.relate(cid, "framed_into", "STR-COL-%s-%s" % (lid, _axis_label(k, iy)))

        # Vigas en direccion Y: luz libre entre caras de columna.
        for ix, xl in enumerate(P.GRID_X_LABELS):
            gx = P.GRID_X[ix]
            for iy in range(len(P.GRID_Y) - 1):
                y0 = round(P.GRID_Y[iy] + half_col, 3)
                y1 = round(P.GRID_Y[iy + 1] - half_col, 3)
                tag = "Y-%s-%s%s" % (xl, P.GRID_Y_LABELS[iy], P.GRID_Y_LABELS[iy + 1])
                cid = "STR-VIG-%s-%s" % (lid, tag)
                sid = "SOL-%s" % cid
                prism = S.box_prism(gx - bw / 2, y0, gx + bw / 2, y1, z0, z1)
                solid = S.Solid(sid, [prism], "concreto_estructural", "structure", lid, "ESTR-VIGAS")
                span = round(y1 - y0, 3)
                op = model.oplog.record(
                    "extrude", "creation",
                    "Viga %s del %s en direccion Y, luz libre %.2f m entre caras de columna." % (tag, lid, span),
                    component_id=cid, solid_id=sid,
                    inputs={"direction": "Y", "grid_line": xl, "x": gx, "y0": y0, "y1": y1,
                            "web_section": [bw, stem], "z0": z0, "z1": z1,
                            "clear_span_rule": "eje a eje menos media columna en cada apoyo"},
                    outputs={"span_m": span, "volume_m3": round(bw * stem * span, 6)},
                    derived_from=["HYP_BEAM_WIDTH", "HYP_BEAM_DEPTH", "HYP_COLUMN_SIZE", "GRID_X", "GRID_Y"],
                    implementation="solids.Prism (extrusion en Z)",
                )
                comp = Component(
                    component_id=cid, discipline="structure", type="beam",
                    name="Viga %s %s" % (tag, lid),
                    level_id=lid, material="concreto_estructural", ifc_class="IfcBeam",
                    position=[gx, y0, z0],
                    dimensions={"span": span, "width": bw, "web_depth": stem,
                                "total_depth_with_slab": P.HYP_BEAM_DEPTH},
                    parameters={
                        "direction": "Y", "grid_line": xl, "span_m": span,
                        "web_section_m": [bw, stem],
                        "total_depth_m": P.HYP_BEAM_DEPTH,
                        "specified_concrete_strength_fc": None,
                        "longitudinal_reinforcement": None,
                        "stirrups": None,
                        "design_moment_kNm": None,
                        "design_shear_kN": None,
                        "deflection_check": None,
                    },
                    requires_calculation=CONCRETE_PENDING + ["design_moment_kNm", "design_shear_kN", "deflection_check"],
                    provenance="hypothesis", tags=["portico", "conceptual"],
                )
                _register(model, comp, solid, op)
                for k in (iy, iy + 1):
                    model.relate(cid, "framed_into", "STR-COL-%s-%s" % (lid, _axis_label(ix, k)))


# ---------------------------------------------------------------------------
# Nudos viga-columna
# ---------------------------------------------------------------------------


def build_joints(model) -> None:
    for level in P.LEVELS:
        lid = level["level_id"]
        for iy in range(len(P.GRID_Y)):
            for ix in range(len(P.GRID_X)):
                tag = _axis_label(ix, iy)
                col = "STR-COL-%s-%s" % (lid, tag)
                incident = [
                    c.component_id for c in model.by_discipline("structure")
                    if c.type == "beam" and c.level_id == lid
                    and {"relation": "framed_into", "target": col} in c.relationships
                ]
                cid = "STR-NUD-%s-%s" % (lid, tag)
                op = model.oplog.record(
                    "define_connection", "connection",
                    "Nudo viga-columna %s del %s con %d vigas incidentes." % (tag, lid, len(incident)),
                    component_id=cid,
                    inputs={"column": col, "beams": incident},
                    outputs={"incident_beams": len(incident)},
                    derived_from=["GRID_X", "GRID_Y"],
                    implementation="grafo de relaciones framed_into del catalogo",
                )
                comp = Component(
                    component_id=cid, discipline="structure", type="beam_column_joint",
                    name="Nudo %s %s" % (tag, lid),
                    level_id=lid, material="concreto_estructural", ifc_class="IfcDiscreteAccessory",
                    position=[P.GRID_X[ix], P.GRID_Y[iy], round(level["elevation"] + P.REQ_CLEAR_HEIGHT, 3)],
                    parameters={
                        "column": col, "incident_beams": incident,
                        "joint_type": "monolitico de concreto (conceptual)",
                        "confinement_reinforcement": None,
                        "joint_shear_check": None,
                        "anchorage_detail": None,
                    },
                    requires_calculation=["confinement_reinforcement", "joint_shear_check", "anchorage_detail"],
                    provenance="derived", tags=["nudo", "conceptual"],
                )
                comp.operations.append(op)
                model.add_component(comp)
                model.relate(cid, "joins", col)
                for b in incident:
                    model.relate(cid, "joins", b)
                    model.add_connection(Connection(
                        connection_id="CNX-%s-%s" % (cid, b.split("-")[-1]),
                        discipline="structure", type="structural_joint",
                        origin=b, destination=col, medium="monolitico_concreto",
                        technology="nudo viga-columna",
                        parameters={"joint_id": cid, "continuity": "monolitica", "rebar_anchorage": None},
                        requires_calculation=["rebar_anchorage"], provenance="derived",
                    ))


# ---------------------------------------------------------------------------
# Escalera del nucleo central
# ---------------------------------------------------------------------------


def stair_geometry() -> Dict[str, float]:
    """Geometria del tramo de escalera, centrada en el interior del nucleo."""
    wc = P.HYP_WALL_CORE
    int_x0 = round(P.CORE_X0 + wc, 3)
    int_x1 = round(P.CORE_X1 - wc, 3)
    int_y0 = round(P.CORE_Y0 + wc, 3)
    int_y1 = round(P.CORE_Y1 - wc, 3)

    run = round(P.HYP_STAIR_TREAD * (P.HYP_STAIR_RISERS_PER_FLIGHT - 1), 3)   # 9 x 0.28 = 2.52
    envelope_y = round(run + P.HYP_STAIR_LANDING_DEPTH, 3)                    # 3.92
    # El ojo entre tramos se fija en 0.40 m para que la viga del eje 3 (ancho
    # 0.30 centrado en x = 12.00) quede dentro del ojo y no invada los tramos.
    gap = 0.40
    total_w = round(2 * P.HYP_STAIR_FLIGHT_WIDTH + gap, 3)                    # 3.40

    y0 = round(int_y0 + (int_y1 - int_y0 - envelope_y) / 2.0, 3)
    xa0 = round(int_x0 + (int_x1 - int_x0 - total_w) / 2.0, 3)
    xa1 = round(xa0 + P.HYP_STAIR_FLIGHT_WIDTH, 3)
    xb0 = round(xa1 + gap, 3)
    xb1 = round(xb0 + P.HYP_STAIR_FLIGHT_WIDTH, 3)

    return {
        "int_x0": int_x0, "int_x1": int_x1, "int_y0": int_y0, "int_y1": int_y1,
        "run": run, "envelope_y": envelope_y, "gap": gap, "total_w": total_w,
        "y0": y0, "y_top_flight": round(y0 + run, 3),
        "y_landing_end": round(y0 + envelope_y, 3),
        "xa0": xa0, "xa1": xa1, "xb0": xb0, "xb1": xb1,
    }


def build_stairs(model) -> None:
    g = stair_geometry()
    riser = P.HYP_STAIR_RISER
    tread = P.HYP_STAIR_TREAD
    nr = P.HYP_STAIR_RISERS_PER_FLIGHT
    waist = P.HYP_STAIR_SLAB_THICKNESS

    for level in P.LEVELS:
        lid = level["level_id"]
        e = level["elevation"]
        mid_z = round(e + riser * nr, 3)              # cota del descanso
        prims_all: List[S.Primitive] = []

        for flight, (fx0, fx1, direction) in enumerate(
            ((g["xa0"], g["xa1"], +1), (g["xb0"], g["xb1"], -1)), start=1
        ):
            base_z = e if flight == 1 else mid_z
            if direction > 0:
                sy, ey = g["y0"], g["y_top_flight"]
            else:
                sy, ey = g["y_top_flight"], g["y0"]

            cid = "STR-ESC-%s-T%d" % (lid, flight)
            sid = "SOL-%s" % cid

            # Losa inclinada: perfil rectangular barrido por el eje inclinado.
            # El eje se situa MEDIO CANTO POR ENCIMA del arranque para que la
            # cara inferior de la losa no baje del nivel de piso; de lo
            # contrario el tramo penetraria en la losa del nivel inferior.
            rise = round(riser * (nr - 1), 3)
            axis_p0 = (round((fx0 + fx1) / 2, 3), sy, round(base_z + waist / 2, 4))
            axis_p1 = (round((fx0 + fx1) / 2, 3), ey, round(base_z + rise + waist / 2, 4))
            waist_sweep = S.Sweep(
                p0=axis_p0, p1=axis_p1, profile="rect",
                width=P.HYP_STAIR_FLIGHT_WIDTH, height_p=waist,
            )
            prims: List[S.Primitive] = [waist_sweep]

            # Peldanos sobre la losa inclinada.
            for i in range(nr - 1):
                if direction > 0:
                    sy_i = round(sy + i * tread, 3)
                    ey_i = round(sy_i + tread, 3)
                else:
                    ey_i = round(sy - i * tread, 3)
                    sy_i = round(ey_i - tread, 3)
                ztop = round(base_z + (i + 1) * riser, 4)
                zbot = round(ztop - riser, 4)
                prims.append(S.box_prism(fx0, min(sy_i, ey_i), fx1, max(sy_i, ey_i), zbot, ztop))

            solid = S.Solid(sid, prims, "concreto_estructural", "structure", lid, "ESTR-ESCALERA")
            op = model.oplog.record(
                "sweep_and_extrude", "creation",
                ("Tramo %d de escalera del %s: losa inclinada de %.2f m barrida en direccion %+d sobre Y, "
                 "mas %d peldanos de huella %.3f y contrahuella %.3f.")
                % (flight, lid, waist, direction, nr - 1, tread, riser),
                component_id=cid, solid_id=sid,
                inputs={"flight": flight, "x_range": [fx0, fx1], "y_start": sy, "y_end": ey,
                        "base_z": base_z, "risers": nr, "riser": riser, "tread": tread,
                        "waist_thickness": waist, "run_m": g["run"]},
                outputs={"rise_m": round(riser * nr, 4), "step_count": nr - 1},
                derived_from=["HYP_STAIR_RISER", "HYP_STAIR_TREAD", "HYP_STAIR_RISERS_PER_FLIGHT",
                              "HYP_STAIR_FLIGHT_WIDTH", "HYP_STAIR_SLAB_THICKNESS", "HYP_CORE_SIZE"],
                implementation="solids.Sweep rectangular inclinado + solids.Prism por peldano",
            )
            comp = Component(
                component_id=cid, discipline="structure", type="stair_flight",
                name="Tramo %d escalera %s" % (flight, lid),
                level_id=lid, material="concreto_estructural", ifc_class="IfcStairFlight",
                position=[fx0, min(sy, ey), base_z],
                dimensions={"width": P.HYP_STAIR_FLIGHT_WIDTH, "run": g["run"],
                            "rise": round(riser * nr, 4), "waist": waist},
                parameters={
                    "riser_m": riser, "tread_m": tread, "riser_count": nr,
                    "flight_width_m": P.HYP_STAIR_FLIGHT_WIDTH,
                    "waist_thickness_m": waist,
                    "handrail_height_m": None,
                    "required_egress_width_m": None,
                    "occupancy_load": None,
                    "code_compliance_check": None,
                    "specified_concrete_strength_fc": None,
                    "reinforcement_layout": None,
                },
                requires_calculation=["required_egress_width_m", "occupancy_load",
                                      "code_compliance_check", "handrail_height_m"] + CONCRETE_PENDING,
                provenance="hypothesis", tags=["escalera", "nucleo", "conceptual"],
                validation_notes=["Huella/contrahuella son geometria conceptual; su validez depende de la norma aplicable."],
            )
            _register(model, comp, solid, op)
            prims_all.extend(prims)

        # Descanso intermedio
        cid = "STR-ESC-%s-DESCANSO" % lid
        sid = "SOL-%s" % cid
        prism = S.box_prism(g["xa0"], g["y_top_flight"], g["xb1"], g["y_landing_end"],
                            round(mid_z - waist, 4), mid_z)
        solid = S.Solid(sid, [prism], "concreto_estructural", "structure", lid, "ESTR-ESCALERA")
        op = model.oplog.record(
            "extrude", "creation",
            "Descanso intermedio del %s a cota %.3f, %.2f m de profundidad." % (lid, mid_z, P.HYP_STAIR_LANDING_DEPTH),
            component_id=cid, solid_id=sid,
            inputs={"x_range": [g["xa0"], g["xb1"]], "y_range": [g["y_top_flight"], g["y_landing_end"]],
                    "z_top": mid_z, "thickness": waist},
            outputs={"area_m2": round((g["xb1"] - g["xa0"]) * P.HYP_STAIR_LANDING_DEPTH, 4)},
            derived_from=["HYP_STAIR_LANDING_DEPTH", "HYP_STAIR_SLAB_THICKNESS", "HYP_STAIR_RISER"],
            implementation="solids.Prism (extrusion en Z)",
        )
        comp = Component(
            component_id=cid, discipline="structure", type="stair_landing",
            name="Descanso escalera %s" % lid,
            level_id=lid, material="concreto_estructural", ifc_class="IfcSlab",
            position=[g["xa0"], g["y_top_flight"], round(mid_z - waist, 4)],
            dimensions={"width": round(g["xb1"] - g["xa0"], 3), "depth": P.HYP_STAIR_LANDING_DEPTH,
                        "thickness": waist},
            parameters={"elevation_m": mid_z, "thickness_m": waist,
                        "specified_concrete_strength_fc": None, "reinforcement_layout": None},
            requires_calculation=CONCRETE_PENDING, provenance="hypothesis",
            tags=["escalera", "nucleo", "conceptual"],
        )
        _register(model, comp, solid, op)
        model.relate("STR-ESC-%s-T1" % lid, "lands_on", cid)
        model.relate("STR-ESC-%s-T2" % lid, "starts_from", cid)
        model.add_connection(Connection(
            connection_id="CNX-STR-ESC-%s" % lid,
            discipline="structure", type="structural_joint",
            origin="STR-ESC-%s-T1" % lid, destination="STR-ESC-%s-T2" % lid,
            medium="monolitico_concreto", technology="continuidad por descanso",
            parameters={"via": cid, "rebar_continuity": None},
            requires_calculation=["rebar_continuity"], provenance="derived",
        ))


def stair_void() -> Tuple[float, float, float, float]:
    """Rectangulo del vacio que la escalera exige en la losa superior."""
    g = stair_geometry()
    return (g["xa0"], g["y0"], g["xb1"], g["y_landing_end"])


# ---------------------------------------------------------------------------
# Losas
# ---------------------------------------------------------------------------


def build_slabs(model) -> None:
    th = P.HYP_SLAB_THICKNESS
    void = stair_void()
    shafts = _shaft_rects()

    # Losa de piso sobre terreno (conceptual). Lleva un hueco en cada pedestal:
    # el pedestal de concreto ya ocupa ese volumen hasta el nivel 0.00.
    pw, pl = P.HYP_PEDESTAL_SIZE
    pedestal_holes = [S.rect_points(gx - pw / 2, gy - pl / 2, gx + pw / 2, gy + pl / 2)
                      for gx in P.GRID_X for gy in P.GRID_Y]
    sid = "SOL-STR-LOS-N1-PISO"
    prism = S.Prism(outer=S.rect_points(0, 0, P.REQ_LENGTH_X, P.REQ_WIDTH_Y),
                    holes=pedestal_holes, z0=-0.15, z1=0.0)
    solid = S.Solid(sid, [prism], "concreto_estructural", "structure", "N1", "ESTR-LOSAS")
    op = model.oplog.record(
        "extrude", "creation",
        "Losa de piso sobre terreno del N1, %0.2f x %0.2f, espesor 0.15 (conceptual)." % (P.REQ_LENGTH_X, P.REQ_WIDTH_Y),
        component_id="STR-LOS-N1-PISO", solid_id=sid,
        inputs={"outline": [0, 0, P.REQ_LENGTH_X, P.REQ_WIDTH_Y], "z0": -0.15, "z1": 0.0},
        outputs={"area_m2": P.REQ_AREA_PER_LEVEL},
        derived_from=["REQ_LENGTH_X", "REQ_WIDTH_Y"],
        implementation="solids.Prism (extrusion en Z)",
    )
    comp = Component(
        component_id="STR-LOS-N1-PISO", discipline="structure", type="slab_on_grade",
        name="Losa de piso sobre terreno N1", level_id="N1",
        material="concreto_estructural", ifc_class="IfcSlab",
        position=[0, 0, -0.15],
        dimensions={"length": P.REQ_LENGTH_X, "width": P.REQ_WIDTH_Y, "thickness": 0.15},
        parameters={"area_m2": P.REQ_AREA_PER_LEVEL, "thickness_m": 0.15,
                    "subgrade_preparation": None, "specified_concrete_strength_fc": None,
                    "reinforcement_layout": None},
        requires_calculation=CONCRETE_PENDING + ["subgrade_preparation"],
        provenance="hypothesis", tags=["losa", "conceptual"],
    )
    _register(model, comp, solid, op)

    # Losas de entrepiso y cubierta.
    for level in P.LEVELS:
        lid = level["level_id"]
        e = level["elevation"]
        z1 = round(e + P.REQ_FLOOR_TO_FLOOR, 3)
        z0 = round(z1 - th, 3)
        upper = P.ALL_LEVELS[level["index"]]      # nivel al que pertenece el piso creado
        upper_id = upper["level_id"]
        is_roof = upper_id == "NC"

        # El vacio de escalera se mantiene en todas las losas, incluida la de
        # cubierta, porque el acceso a cubierta se resuelve con el caseton del
        # nucleo (ver discipline_architecture.build_penthouse).
        holes = [S.rect_points(*void)] + [S.rect_points(*r) for r in shafts]

        cid = "STR-LOS-%s" % upper_id
        sid = "SOL-%s" % cid
        prism = S.Prism(outer=S.rect_points(0, 0, P.REQ_LENGTH_X, P.REQ_WIDTH_Y),
                        holes=holes, z0=z0, z1=z1)
        solid = S.Solid(sid, [prism], "concreto_estructural", "structure", upper_id, "ESTR-LOSAS")
        gross = P.REQ_AREA_PER_LEVEL
        hole_area = sum((h[2] - h[0]) * (h[3] - h[1]) for h in [void] + list(shafts))
        op = model.oplog.record(
            "extrude_with_voids", "boolean",
            ("Losa %s a cota %.2f: rectangulo %0.2fx%0.2f extruido %.2f m con %d vacios "
             "(escalera y ductos). El vacio se obtiene por sustraccion del contorno interior.")
            % (upper_id, z1, P.REQ_LENGTH_X, P.REQ_WIDTH_Y, th, len(holes)),
            component_id=cid, solid_id=sid,
            inputs={"outline": [0, 0, P.REQ_LENGTH_X, P.REQ_WIDTH_Y], "z0": z0, "z1": z1,
                    "voids": [[round(v, 3) for v in h] for h in ([void] + list(shafts))]},
            outputs={"gross_area_m2": gross, "void_area_m2": round(hole_area, 4),
                     "net_area_m2": round(gross - hole_area, 4)},
            derived_from=["REQ_LENGTH_X", "REQ_WIDTH_Y", "HYP_SLAB_THICKNESS", "HYP_CORE_SIZE"],
            implementation="solids.Prism con anillos interiores (equivale a diferencia booleana)",
        )
        comp = Component(
            component_id=cid, discipline="structure",
            type="roof_slab" if is_roof else "floor_slab",
            name="Losa de cubierta" if is_roof else "Losa de entrepiso %s" % upper_id,
            level_id=upper_id, material="concreto_estructural", ifc_class="IfcSlab",
            position=[0, 0, z0],
            dimensions={"length": P.REQ_LENGTH_X, "width": P.REQ_WIDTH_Y, "thickness": th},
            parameters={
                "elevation_m": z1, "thickness_m": th,
                "gross_area_m2": gross, "net_area_m2": round(gross - hole_area, 4),
                "void_count": len(holes),
                "slab_system": "losa maciza (hipotesis conceptual)",
                "specified_concrete_strength_fc": None,
                "reinforcement_layout": None,
                "design_loads": None,
                "deflection_check": None,
            },
            requires_calculation=CONCRETE_PENDING + ["deflection_check"],
            provenance="hypothesis", tags=["losa", "conceptual"],
        )
        _register(model, comp, solid, op)
        for iy in range(len(P.GRID_Y)):
            for ix in range(len(P.GRID_X)):
                model.relate(cid, "supported_by", "STR-COL-%s-%s" % (lid, _axis_label(ix, iy)))


SHAFT_TECH_SIZE = (1.40, 0.80)
SHAFT_SANITARY_SIZE = (0.80, 0.80)


def shaft_tech() -> Tuple[float, float, float, float]:
    """Ducto tecnico: esquina suroeste del anillo de circulacion.

    Se situa en la circulacion, no dentro del nucleo, para que los montantes y
    los tableros sean accesibles sin atravesar los muros de la escalera. La
    posicion se deriva del anillo, de modo que acompana a cualquier tamano de
    planta.
    """
    w, d = SHAFT_TECH_SIZE
    x0 = round(P.RING_X0 + 0.20, 3)
    y0 = round(P.RING_Y0 + 0.20, 3)
    return (x0, y0, round(x0 + w, 3), round(y0 + d, 3))


def shaft_sanitary() -> Tuple[float, float, float, float]:
    """Ducto sanitario: dentro del segundo bano, contra el muro de fachada.

    Se deriva del recinto humedo real del nivel de acceso, de modo que queda
    alineado en vertical en todos los niveles aunque cambie el programa.
    """
    w, d = SHAFT_SANITARY_SIZE
    entry = P.find_space("N1", "bano", 1) or P.find_space("N1", "bano", 0)
    if entry is None:
        cx, cy = P.REQ_LENGTH_X * 0.55, P.REQ_WIDTH_Y - 1.60
        x0, y0 = round(cx, 3), round(cy, 3)
        return (x0, y0, round(x0 + w, 3), round(y0 + d, 3))
    bx0, by0, bx1, by1 = P.space_rect_of(entry)
    x0 = round(min(bx0 + 0.10, bx1 - w - 0.10), 3)
    y0 = round(by1 - d - 0.40, 3)
    return (x0, y0, round(x0 + w, 3), round(y0 + d, 3))


def _shaft_rects() -> Tuple[Tuple[float, float, float, float], ...]:
    """Ductos verticales de instalaciones, derivados de la geometria del nivel."""
    return (shaft_tech(), shaft_sanitary())


def riser_positions() -> Dict[str, Tuple[float, float]]:
    """Posicion de cada montante dentro de su ducto vertical."""
    tx0, ty0, tx1, ty1 = shaft_tech()
    sx0, sy0, sx1, sy1 = shaft_sanitary()
    tw, td = tx1 - tx0, ty1 - ty0
    sw, sd = sx1 - sx0, sy1 - sy0
    r = lambda v: round(v, 4)
    return {
        "electrical":        (r(tx0 + tw * 0.18), r(ty0 + td * 0.31)),
        "telecom":           (r(tx0 + tw * 0.39), r(ty0 + td * 0.31)),
        "hvac_refrigerant":  (r(tx0 + tw * 0.18), r(ty0 + td * 0.69)),
        "hvac_duct":         (r(tx0 + tw * 0.39), r(ty0 + td * 0.69)),
        "rain_leader_2":     (r(tx0 + tw * 0.75), r(ty0 + td * 0.50)),
        "water_supply":      (r(sx0 + sw * 0.25), r(sy0 + sd * 0.25)),
        "drain_stack":       (r(sx0 + sw * 0.75), r(sy0 + sd * 0.25)),
        "vent_stack":        (r(sx0 + sw * 0.75), r(sy0 + sd * 0.75)),
        "rain_leader":       (r(sx0 + sw * 0.25), r(sy0 + sd * 0.75)),
    }


def riser_at(key: str) -> Tuple[float, float]:
    """Posicion (x, y) de un montante por su clave."""
    return riser_positions()[key]


# ---------------------------------------------------------------------------
# Orquestador
# ---------------------------------------------------------------------------


def build(model) -> None:
    build_foundations(model)
    build_columns(model)
    build_beams(model)
    build_joints(model)
    build_stairs(model)
    build_slabs(model)

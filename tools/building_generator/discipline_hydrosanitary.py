"""Paquete hidrosanitario conceptual.

Datos calculados: geometria, trazado y longitud real de cada tramo medida
sobre su polilinea 3D. En los desagues la cota de llegada NO se elige a mano:
se deduce de la longitud horizontal y de la pendiente adoptada
(HYP_DRAIN_SLOPE), mediante routing.sloped_run.

Diametros: los valores de HYP_PIPE_DIAMETERS son diametros nominales
ADOPTADOS para poder trazar la red. No proceden de calculo hidraulico. El
dimensionamiento por unidades de consumo y de descarga, la presion
disponible, la capacidad del tanque y la curva de la bomba quedan como None.
"""

from __future__ import annotations

from typing import Any, Dict, List, Tuple

import mepkit as K
import params as P
import routing as R
import solids as S
from catalog import Component
from discipline_structure import riser_at, shaft_sanitary, shaft_tech

HYDRAULIC_PENDING = ["design_flow_lps", "fixture_units", "pressure_required_kPa",
                     "verified_diameter_m", "head_loss_kPa"]
DRAIN_PENDING = ["discharge_units", "verified_diameter_m", "verified_slope",
                 "peak_flow_lps"]

def pump_room():
    """Recinto del equipo de bombeo, localizado por uso."""
    return P.find_space_any("N1", ("zona_tecnica", "archivo", "deposito",
                                   "cuarto_electrico", "oficina"))


def pump_position():
    entry = pump_room()
    x0, y0, x1, y1 = P.space_rect_of(entry)
    return (round(x0 + (x1 - x0) * 0.5, 3), round(y0 + 0.60, 3))


def tank_low_center():
    """Tanque enterrado, fuera de la huella para no invadir las zapatas."""
    half = max(P.HYP_FOOTING_PLAN) / 2.0
    return (round(-(half + 2.70), 3), round(P.REQ_WIDTH_Y * 0.58, 3))


def tank_high_center():
    """Tanque elevado en cubierta, separado de las condensadoras."""
    return (round(P.REQ_LENGTH_X * 0.30, 3), round(P.REQ_WIDTH_Y * 0.80, 3))


def meter_position():
    """Medidor de agua en la fachada oeste, entre ejes."""
    return (round(P.HYP_WALL_EXTERIOR / 2.0, 4), round(P.REQ_WIDTH_Y * 0.58, 3))

# Aparatos por recinto humedo. (tipo, cantidad, cara de montaje)
FIXTURES_BY_USE = {
    "bano_mujeres": [("inodoro", 2), ("lavamanos", 2)],
    "bano_hombres": [("inodoro", 2), ("orinal", 1), ("lavamanos", 2)],
    "aseo": [("lavadero", 1)],
}

FIXTURE_SPEC = {
    "inodoro": {"box": (0.38, 0.62, 0.78), "z": 0.39, "supply": "ramal_agua",
                "drain": "ramal_inodoro", "ifc": "IfcSanitaryTerminal",
                "name": "Inodoro"},
    "lavamanos": {"box": (0.52, 0.42, 0.20), "z": 0.85, "supply": "ramal_agua",
                  "drain": "ramal_sanitario", "ifc": "IfcSanitaryTerminal",
                  "name": "Lavamanos"},
    "orinal": {"box": (0.36, 0.32, 0.60), "z": 0.95, "supply": "ramal_agua",
               "drain": "ramal_sanitario", "ifc": "IfcSanitaryTerminal",
               "name": "Orinal"},
    "lavadero": {"box": (0.60, 0.50, 0.30), "z": 0.80, "supply": "ramal_agua",
                 "drain": "ramal_sanitario", "ifc": "IfcSanitaryTerminal",
                 "name": "Lavadero"},
}


def _wet_rooms(lid: str) -> List[Tuple[str, str, List[float]]]:
    """Devuelve (codigo, clave de aparatos, rectangulo) de los recintos humedos."""
    out = []
    for code, name, use, band, start, end in P.SPACE_PROGRAM[lid]:
        if use == "bano":
            key = "bano_mujeres" if "mujeres" in name.lower() else "bano_hombres"
        elif use == "aseo":
            key = "aseo"
        else:
            continue
        out.append((code, key, list(P.space_rect(band, start, end))))
    return out


# ---------------------------------------------------------------------------
# Acometida, medidor, tanques y bombeo
# ---------------------------------------------------------------------------


def build_source(model) -> None:
    mx, my = meter_position()
    d_aco = P.HYP_PIPE_DIAMETERS["acometida_agua"]

    path = [(-5.00, my, -1.00), (mx, my, -1.00), (mx, my, 0.60)]
    K.add_route(
        model, component_id="HID-ACO-001", discipline="hydrosanitary",
        type="water_service", name="Acometida de agua potable",
        polylines=[path], diameter=d_aco, material="pvc",
        ifc_class="IfcPipeSegment", layer="HID-AGUA", level_id="N1",
        parameters={"nominal_diameter_m": d_aco, "nominal_diameter_in": 1.5,
                    "material_declared": "PVC presion",
                    "available_pressure_kPa": None, "design_flow_lps": None,
                    "fixture_units": None, "verified_diameter_m": None},
        requires_calculation=HYDRAULIC_PENDING,
        tags=["hidraulico", "acometida"], provenance="hypothesis",
        op_description=("Acometida de agua enterrada desde el lindero hasta el medidor, "
                        "diametro nominal adoptado %.1f pulgadas." % 1.5),
        derived_from=["HYP_PIPE_DIAMETERS"], flow_direction="red_hacia_edificio",
        validation_notes=["Presion disponible en el punto de entrega no verificada."],
    )

    K.add_device(
        model, component_id="HID-MED-001", discipline="hydrosanitary",
        type="water_meter", name="Medidor de agua", level_id="N1",
        xyz=(mx, my, 0.60), box=(0.20, 0.30, 0.25), material="equipo_generico",
        ifc_class="IfcFlowMeter", layer="HID-EQUIPOS",
        parameters={"nominal_diameter_m": d_aco, "meter_type": None,
                    "rated_flow_lps": None, "head_loss_kPa": None},
        requires_calculation=["meter_type", "rated_flow_lps", "head_loss_kPa"],
        tags=["hidraulico", "medicion"],
        op_description="Medidor de agua en la entrada, sobre la acometida.",
        derived_from=["HYP_WALL_EXTERIOR", "REQ_WIDTH_Y"],
    )
    K.link(model, connection_id="CNX-HID-ACO-MED", discipline="hydrosanitary",
           type="pipe_connection", origin="HID-ACO-001", destination="HID-MED-001",
           medium="tuberia_pvc_presion", technology="union roscada o soldada",
           parameters={"nominal_diameter_m": d_aco}, flow_direction="red_hacia_medidor",
           requires_calculation=["verified_diameter_m"], provenance="hypothesis")

    # Tanque de reserva enterrado (conceptual)
    tx, ty = tank_low_center()
    K.add_device(
        model, component_id="HID-TAN-BAJO", discipline="hydrosanitary",
        type="water_tank", name="Tanque de reserva enterrado (conceptual)",
        level_id=None, xyz=(tx, ty, -1.20), box=(3.00, 2.00, 2.00),
        material="concreto_estructural", ifc_class="IfcTank", layer="HID-EQUIPOS",
        parameters={"geometric_volume_m3": 12.0, "usable_volume_m3": None,
                    "required_reserve_m3": None, "daily_demand_lpd": None,
                    "occupancy_basis": None, "structural_design": None},
        requires_calculation=["usable_volume_m3", "required_reserve_m3", "daily_demand_lpd",
                              "occupancy_basis", "structural_design"],
        tags=["hidraulico", "tanque", "conceptual"],
        op_description=("Tanque de reserva enterrado conceptual de 3.00 x 2.00 x 2.00 m. "
                        "El volumen geometrico no equivale a reserva requerida."),
        derived_from=["HYP_FOOTING_PLAN", "REQ_WIDTH_Y"],
        validation_notes=["Volumen requerido no calculado: depende de dotacion y ocupacion."],
    )
    K.link(model, connection_id="CNX-HID-MED-TANBAJO", discipline="hydrosanitary",
           type="pipe_connection", origin="HID-MED-001", destination="HID-TAN-BAJO",
           medium="tuberia_pvc_presion", technology="llenado por gravedad desde la red",
           parameters={"nominal_diameter_m": d_aco},
           flow_direction="medidor_hacia_tanque", requires_calculation=["verified_diameter_m"],
           provenance="hypothesis")

    # Equipo de bombeo
    px, py = pump_position()
    room = pump_room()
    K.add_device(
        model, component_id="HID-BOM-001", discipline="hydrosanitary",
        type="pump", name="Equipo de bombeo", level_id="N1",
        space_id=P.space_id_of(room), xyz=(px, py, 0.45),
        box=(0.80, 0.50, 0.90), material="equipo_generico", ifc_class="IfcPump",
        layer="HID-EQUIPOS",
        parameters={"room": P.space_code(room), "configuration": "bomba con tanque hidroacumulador",
                    "electrical_supply": P.HYP_SYSTEM_VOLTAGES["bombeo"]["system"],
                    "nominal_voltage_v": P.HYP_SYSTEM_VOLTAGES["bombeo"]["voltage_v"],
                    "phases": P.HYP_SYSTEM_VOLTAGES["bombeo"]["phases"],
                    "flow_lps": None, "head_m": None, "power_kW": None,
                    "pump_curve": None, "npsh_required_m": None},
        requires_calculation=["flow_lps", "head_m", "power_kW", "pump_curve",
                              "npsh_required_m"],
        tags=["hidraulico", "bombeo"],
        op_description="Equipo de bombeo en el N1 (recinto %s)." % P.space_code(room),
        derived_from=["SPACE_PROGRAM", "HYP_SYSTEM_VOLTAGES"],
        validation_notes=["Caudal, altura y potencia requieren calculo hidraulico."],
    )

    # Succion tanque bajo -> bomba
    suction = R.manhattan((tx, ty, -0.60), (px, py, 0.45), -0.60)
    _, slen = K.add_route(
        model, component_id="HID-SUC-001", discipline="hydrosanitary",
        type="suction_pipe", name="Succion del tanque al equipo de bombeo",
        polylines=[suction], diameter=P.HYP_PIPE_DIAMETERS["montante_agua"],
        material="pvc", ifc_class="IfcPipeSegment", layer="HID-AGUA", level_id="N1",
        parameters={"nominal_diameter_m": P.HYP_PIPE_DIAMETERS["montante_agua"],
                    "verified_diameter_m": None, "npsh_available_m": None},
        requires_calculation=HYDRAULIC_PENDING + ["npsh_available_m"],
        tags=["hidraulico", "succion"],
        op_description="Tuberia de succion del tanque enterrado al equipo de bombeo.",
        derived_from=["SPACE_PROGRAM", "HYP_FOOTING_PLAN"], flow_direction="tanque_hacia_bomba",
    )
    K.link(model, connection_id="CNX-HID-TANBAJO-BOM", discipline="hydrosanitary",
           type="pipe_connection", origin="HID-TAN-BAJO", destination="HID-BOM-001",
           medium="tuberia_pvc_presion", technology="succion",
           parameters={"nominal_diameter_m": P.HYP_PIPE_DIAMETERS["montante_agua"]},
           geometry_reference="SOL-HID-SUC-001", length_m=slen,
           flow_direction="tanque_hacia_bomba", requires_calculation=["verified_diameter_m"])

    # Tanque elevado en cubierta
    hx, hy = tank_high_center()
    zbase = round(P.ROOF_LEVEL["elevation"] + 0.30, 3)
    sid = "SOL-HID-TAN-ALTO"
    solid = S.Solid(sid, [S.Revolve(profile=[(1.20, zbase), (1.20, round(zbase + 2.00, 3))],
                                    center=(hx, hy))],
                    "pvc", "hydrosanitary", "NC", "HID-EQUIPOS")
    op = model.oplog.record(
        "revolve", "creation",
        ("Tanque elevado en cubierta: perfil (r=1.20, z) revolucionado 360 grados "
         "alrededor del eje vertical en (%.2f, %.2f), de cota %.2f a %.2f." %
         (hx, hy, zbase, zbase + 2.00)),
        component_id="HID-TAN-ALTO", solid_id=sid,
        inputs={"center": [hx, hy], "profile_rz": [[1.20, zbase], [1.20, round(zbase + 2.0, 3)]],
                "angle_deg": 360.0, "segments": S.CIRCLE_SEGMENTS},
        outputs={"geometric_volume_m3": round(3.141592653589793 * 1.44 * 2.00, 4)},
        derived_from=["REQ_LENGTH_X", "REQ_WIDTH_Y", "ROOF_LEVEL"],
        implementation="solids.Revolve (revolucion de perfil alrededor de eje Z)",
    )
    comp = Component(
        component_id="HID-TAN-ALTO", discipline="hydrosanitary", type="water_tank",
        name="Tanque elevado de distribucion", level_id="NC", material="pvc",
        ifc_class="IfcTank", position=[hx, hy, zbase],
        dimensions={"diameter": 2.40, "height": 2.00},
        parameters={"geometric_volume_m3": round(3.141592653589793 * 1.44 * 2.00, 4),
                    "usable_volume_m3": None, "required_reserve_m3": None,
                    "static_head_m": None, "support_structure_design": None,
                    "distribution_mode": "gravedad"},
        requires_calculation=["usable_volume_m3", "required_reserve_m3", "static_head_m",
                              "support_structure_design"],
        provenance="hypothesis", tags=["hidraulico", "tanque"],
        validation_notes=["La carga estatica disponible por gravedad no esta verificada."],
    )
    comp.operations.append(op)
    comp.geometry_reference = sid
    model.add_solid(solid)
    model.add_component(comp)

    # Impulsion bomba -> tanque elevado por el ducto sanitario
    wx, wy = riser_at("water_supply")
    impulsion = R.manhattan((px, py, 0.90), (wx, wy, 0.90), R.plenum_z(P.LEVELS[0], "hydrosanitary"))
    riser = R.riser(wx, wy, 0.90, round(zbase + 1.90, 3))
    top = R.manhattan((wx, wy, round(zbase + 1.90, 3)), (hx, hy, round(zbase + 1.90, 3)),
                      round(zbase + 1.90, 3))
    _, ilen = K.add_route(
        model, component_id="HID-IMP-001", discipline="hydrosanitary",
        type="pumping_main", name="Impulsion al tanque elevado",
        polylines=[impulsion, riser, top],
        diameter=P.HYP_PIPE_DIAMETERS["montante_agua"], material="pvc",
        ifc_class="IfcPipeSegment", layer="HID-AGUA",
        parameters={"nominal_diameter_m": P.HYP_PIPE_DIAMETERS["montante_agua"],
                    "static_lift_m": round(zbase + 1.90 - 0.90, 3),
                    "verified_diameter_m": None, "head_loss_kPa": None},
        requires_calculation=HYDRAULIC_PENDING,
        tags=["hidraulico", "impulsion"],
        op_description=("Impulsion desde el equipo de bombeo al tanque elevado: tramo "
                        "horizontal en N1, montante por el ducto sanitario y tramo en "
                        "cubierta. Elevacion estatica geometrica %.2f m."
                        % (zbase + 1.90 - 0.90)),
        derived_from=["SPACE_PROGRAM", "HYP_CORRIDOR_WIDTH", "REQ_LENGTH_X"],
        flow_direction="bomba_hacia_tanque_elevado",
    )
    K.link(model, connection_id="CNX-HID-BOM-TANALTO", discipline="hydrosanitary",
           type="pipe_connection", origin="HID-BOM-001", destination="HID-TAN-ALTO",
           medium="tuberia_pvc_presion", technology="impulsion",
           parameters={"nominal_diameter_m": P.HYP_PIPE_DIAMETERS["montante_agua"],
                       "static_lift_m": round(zbase + 1.90 - 0.90, 3)},
           geometry_reference="SOL-HID-IMP-001", length_m=ilen,
           flow_direction="bomba_hacia_tanque_elevado",
           requires_calculation=["verified_diameter_m", "head_loss_kPa"])


# ---------------------------------------------------------------------------
# Distribucion de agua potable
# ---------------------------------------------------------------------------


def build_water_distribution(model) -> Dict[str, List[Dict[str, Any]]]:
    wx, wy = riser_at("water_supply")
    zbase = round(P.ROOF_LEVEL["elevation"] + 0.30, 3)
    hx, hy = tank_high_center()

    # Montante descendente de distribucion por gravedad.
    down = [R.manhattan((hx, hy, zbase), (wx, wy, zbase), zbase),
            R.riser(wx, wy, zbase, round(P.LEVELS[0]["elevation"] + 0.30, 3))]
    _, dlen = K.add_route(
        model, component_id="HID-MON-DIST", discipline="hydrosanitary",
        type="water_riser", name="Montante de distribucion por gravedad",
        polylines=down, diameter=P.HYP_PIPE_DIAMETERS["montante_agua"],
        material="cpvc", ifc_class="IfcPipeSegment", layer="HID-AGUA",
        parameters={"nominal_diameter_m": P.HYP_PIPE_DIAMETERS["montante_agua"],
                    "shaft": "ducto sanitario", "supply_mode": "gravedad",
                    "verified_diameter_m": None, "residual_pressure_kPa": None},
        requires_calculation=HYDRAULIC_PENDING + ["residual_pressure_kPa"],
        tags=["hidraulico", "montante"],
        op_description=("Montante de distribucion desde el tanque elevado, descendente por "
                        "el ducto sanitario hasta el N1."),
        derived_from=["HYP_CORRIDOR_WIDTH", "REQ_LENGTH_X"],
        flow_direction="tanque_hacia_niveles",
    )
    K.link(model, connection_id="CNX-HID-TANALTO-MON", discipline="hydrosanitary",
           type="pipe_connection", origin="HID-TAN-ALTO", destination="HID-MON-DIST",
           medium="tuberia_cpvc", technology="salida de tanque por gravedad",
           parameters={"nominal_diameter_m": P.HYP_PIPE_DIAMETERS["montante_agua"]},
           length_m=dlen, flow_direction="tanque_hacia_montante",
           requires_calculation=["verified_diameter_m"])

    fixtures_by_level: Dict[str, List[Dict[str, Any]]] = {}

    for level in P.LEVELS:
        lid = level["level_id"]
        e = level["elevation"]
        via = R.plenum_z(level, "hydrosanitary")
        rooms = _wet_rooms(lid)
        created: List[Dict[str, Any]] = []

        # valvula de corte del nivel
        K.add_device(
            model, component_id="HID-VAL-%s" % lid, discipline="hydrosanitary",
            type="valve", name="Valvula de corte %s" % lid, level_id=lid,
            xyz=(wx, wy, round(e + 1.20, 3)), box=(0.12, 0.12, 0.14),
            material="equipo_generico", ifc_class="IfcValve", layer="HID-AGUA",
            parameters={"valve_type": "compuerta", "nominal_diameter_m":
                        P.HYP_PIPE_DIAMETERS["montante_agua"],
                        "kv_value": None, "pressure_rating": None},
            requires_calculation=["kv_value", "pressure_rating"],
            tags=["hidraulico", "valvula"],
            op_description="Valvula de corte del %s sobre el montante de distribucion." % lid,
            derived_from=["SPACE_PROGRAM", "HYP_CORRIDOR_WIDTH"],
        )
        K.link(model, connection_id="CNX-HID-MON-VAL-%s" % lid, discipline="hydrosanitary",
               type="pipe_connection", origin="HID-MON-DIST",
               destination="HID-VAL-%s" % lid, medium="tuberia_cpvc",
               technology="derivacion de nivel", parameters={},
               flow_direction="montante_hacia_nivel", requires_calculation=["verified_diameter_m"])

        for code, key, rect in rooms:
            x0, y0, x1, y1 = rect
            specs = FIXTURES_BY_USE[key]
            # posiciones: inodoros y orinales contra el muro norte, lavamanos al sur
            north_y = round(y1 - 0.45, 3)
            south_y = round(y0 + 0.35, 3)
            cursor_n = round(x0 + 0.60, 3)
            cursor_s = round(x0 + 0.60, 3)
            room_fixtures: List[Dict[str, Any]] = []

            for ftype, count in specs:
                spec = FIXTURE_SPEC[ftype]
                for i in range(1, count + 1):
                    if ftype == "lavamanos":
                        fx, fy = cursor_s, south_y
                        cursor_s = round(cursor_s + 0.75, 3)
                    else:
                        fx, fy = cursor_n, north_y
                        cursor_n = round(cursor_n + 0.85, 3)
                    fz = round(e + spec["z"], 3)
                    cid = "HID-APA-%s-%s-%s%d" % (lid, code, ftype[:3].upper(), i)
                    K.add_device(
                        model, component_id=cid, discipline="hydrosanitary",
                        type="sanitary_fixture", name="%s %s-%d" % (spec["name"], code, i),
                        level_id=lid, space_id="ARQ-ESP-%s" % code,
                        xyz=(fx, fy, fz), box=spec["box"], material="pvc",
                        ifc_class=spec["ifc"], layer="HID-APARATOS",
                        parameters={"fixture_type": ftype,
                                    "supply_diameter_m": P.HYP_PIPE_DIAMETERS[spec["supply"]],
                                    "drain_diameter_m": P.HYP_PIPE_DIAMETERS[spec["drain"]],
                                    "fixture_units_supply": None,
                                    "discharge_units": None,
                                    "flow_rate_lps": None,
                                    "trap_seal_mm": None,
                                    "accessibility_check": None},
                        requires_calculation=["fixture_units_supply", "discharge_units",
                                              "flow_rate_lps", "trap_seal_mm",
                                              "accessibility_check"],
                        tags=["hidraulico", "aparato", ftype],
                        op_description=("%s %s-%d en el recinto %s, a cota %.2f. Reparto "
                                        "geometrico contra muro." %
                                        (spec["name"], code, i, code, fz)),
                        derived_from=["FIXTURES_BY_USE", "SPACE_PROGRAM"],
                    )
                    model.relate(cid, "serves_space", "ARQ-ESP-%s" % code)
                    rec = {"component_id": cid, "xyz": (fx, fy, fz), "type": ftype,
                           "room": code, "spec": spec}
                    room_fixtures.append(rec)
                    created.append(rec)

            # ramal de agua del montante a los aparatos del recinto
            if room_fixtures:
                pts = [(f["xyz"][0], f["xyz"][1], round(f["xyz"][2] + 0.10, 3))
                       for f in room_fixtures]
                branch = R.trunk_and_drops((wx, wy, round(e + 1.20, 3)), pts, via)
                bid = "HID-RAM-AGUA-%s-%s" % (lid, code)
                _, blen = K.add_route(
                    model, component_id=bid, discipline="hydrosanitary",
                    type="water_branch", name="Ramal de agua %s" % code,
                    polylines=branch, diameter=P.HYP_PIPE_DIAMETERS["ramal_agua"],
                    material="cpvc", ifc_class="IfcPipeSegment", layer="HID-AGUA",
                    level_id=lid, space_id="ARQ-ESP-%s" % code,
                    parameters={"nominal_diameter_m": P.HYP_PIPE_DIAMETERS["ramal_agua"],
                                "served_fixtures": [f["component_id"] for f in room_fixtures],
                                "fixture_count": len(room_fixtures),
                                "fixture_units": None, "design_flow_lps": None,
                                "verified_diameter_m": None, "residual_pressure_kPa": None},
                    requires_calculation=HYDRAULIC_PENDING + ["residual_pressure_kPa"],
                    tags=["hidraulico", "ramal", "agua"],
                    op_description=("Ramal de agua potable del recinto %s en %s: troncal por el "
                                    "vacio tecnico a cota %.2f y bajada a %d aparatos."
                                    % (code, lid, via, len(room_fixtures))),
                    derived_from=["HYP_PIPE_DIAMETERS", "HYP_PLENUM_ROUTING_Z"],
                    flow_direction="montante_hacia_aparatos",
                )
                for f in room_fixtures:
                    K.link(model, connection_id="CNX-AGUA-%s" % f["component_id"],
                           discipline="hydrosanitary", type="pipe_connection",
                           origin=bid, destination=f["component_id"],
                           medium="tuberia_cpvc", technology="alimentacion de aparato",
                           parameters={"nominal_diameter_m":
                                       P.HYP_PIPE_DIAMETERS[f["spec"]["supply"]],
                                       "verified_diameter_m": None},
                           geometry_reference="SOL-%s" % bid,
                           flow_direction="ramal_hacia_aparato",
                           requires_calculation=["verified_diameter_m", "design_flow_lps"])
        fixtures_by_level[lid] = created
    return fixtures_by_level


# ---------------------------------------------------------------------------
# Desagues, ventilacion y red pluvial
# ---------------------------------------------------------------------------


def build_drainage(model, fixtures: Dict[str, List[Dict[str, Any]]]) -> None:
    sx, sy = riser_at("drain_stack")
    vx, vy = riser_at("vent_stack")

    # Bajante sanitaria
    stack = R.riser(sx, sy, -0.60, round(P.LEVELS[-1]["elevation"] + 2.80, 3))
    _, stlen = K.add_route(
        model, component_id="HID-BAJ-SAN", discipline="hydrosanitary",
        type="drain_stack", name="Bajante sanitaria",
        polylines=[stack], diameter=P.HYP_PIPE_DIAMETERS["bajante_sanitaria"],
        material="pvc_sanitario", ifc_class="IfcPipeSegment", layer="HID-DESAGUE",
        parameters={"nominal_diameter_m": P.HYP_PIPE_DIAMETERS["bajante_sanitaria"],
                    "nominal_diameter_in": 4.0, "shaft": "ducto sanitario",
                    "discharge_units": None, "verified_diameter_m": None,
                    "peak_flow_lps": None},
        requires_calculation=DRAIN_PENDING,
        tags=["sanitario", "bajante"],
        op_description="Bajante sanitaria en el ducto sanitario, de cota -0.60 a cubierta.",
        derived_from=["SPACE_PROGRAM", "HYP_PIPE_DIAMETERS"],
        flow_direction="descendente_por_gravedad",
    )

    # Ventilacion sanitaria
    vent = R.riser(vx, vy, 0.20, round(P.ROOF_LEVEL["elevation"] + 1.20, 3))
    _, vlen = K.add_route(
        model, component_id="HID-VEN-SAN", discipline="hydrosanitary",
        type="vent_stack", name="Ventilacion sanitaria",
        polylines=[vent], diameter=P.HYP_PIPE_DIAMETERS["ventilacion_sanitaria"],
        material="pvc_sanitario", ifc_class="IfcPipeSegment", layer="HID-VENTILACION",
        parameters={"nominal_diameter_m": P.HYP_PIPE_DIAMETERS["ventilacion_sanitaria"],
                    "terminal": "sombrerete sobre cubierta",
                    "termination_height_above_roof_m": 1.20,
                    "verified_diameter_m": None, "required_vent_area": None},
        requires_calculation=["verified_diameter_m", "required_vent_area"],
        tags=["sanitario", "ventilacion"],
        op_description=("Ventilacion sanitaria desde el N1 hasta 1.20 m sobre la losa de "
                        "cubierta."),
        derived_from=["SPACE_PROGRAM", "HYP_CORRIDOR_WIDTH"], flow_direction="ascendente_aire",
    )
    K.link(model, connection_id="CNX-HID-BAJ-VEN", discipline="hydrosanitary",
           type="pipe_connection", origin="HID-BAJ-SAN", destination="HID-VEN-SAN",
           medium="tuberia_pvc_sanitario", technology="ventilacion de columna",
           parameters={"nominal_diameter_m": P.HYP_PIPE_DIAMETERS["ventilacion_sanitaria"]},
           length_m=vlen, flow_direction="bidireccional_aire",
           requires_calculation=["verified_diameter_m"])

    for level in P.LEVELS:
        lid = level["level_id"]
        e = level["elevation"]
        # El plano de desague de un nivel va en la franja hidrosanitaria del
        # vacio tecnico del nivel INFERIOR. Asi queda por debajo del fondo de
        # viga (E - 0.40) y no invade la franja de ductos ni la bandeja
        # electrica. En el N1 va enterrado bajo la losa de piso.
        if level["index"] == 1:
            drain_z = -0.30
        else:
            drain_z = round(P.LEVELS[level["index"] - 2]["elevation"]
                            + P.HYP_ROUTING_Z["hydrosanitary"], 3)
        by_room: Dict[str, List[Dict[str, Any]]] = {}
        for f in fixtures[lid]:
            by_room.setdefault(f["room"], []).append(f)

        for code, items in sorted(by_room.items()):
            polylines: List[List[Tuple[float, float, float]]] = []
            arrival: List[float] = []
            radius = P.HYP_PIPE_DIAMETERS["ramal_sanitario"] / 2.0
            for f in items:
                fx, fy, fz = f["xyz"]
                # bajada del aparato al plano de desague. Si el aparato esta
                # sobre una viga (muros sobre ejes), la bajada se corre a un
                # lado de la viga con un tramo corto sobre el piso.
                px, py = _off_frame(fx, fy, radius)
                head = [(fx, fy, round(fz - 0.10, 3))]
                if (px, py) != (round(fx, 3), round(fy, 3)):
                    head.append((px, py, round(fz - 0.10, 3)))
                polylines.append(head + [(px, py, drain_z)])
                # tramo con pendiente hacia la bajante: la cota de llegada se deduce
                run = R.sloped_run((px, py, drain_z), (sx, sy), P.HYP_DRAIN_SLOPE)
                polylines.append(run)
                arrival.append(run[-1][2])

            did = "HID-RAM-DES-%s-%s" % (lid, code)
            _, dlen = K.add_route(
                model, component_id=did, discipline="hydrosanitary",
                type="drain_branch", name="Ramal de desague %s" % code,
                polylines=polylines, diameter=P.HYP_PIPE_DIAMETERS["ramal_sanitario"],
                material="pvc_sanitario", ifc_class="IfcPipeSegment", layer="HID-DESAGUE",
                level_id=lid, space_id="ARQ-ESP-%s" % code,
                parameters={"nominal_diameter_m": P.HYP_PIPE_DIAMETERS["ramal_sanitario"],
                            "adopted_slope": P.HYP_DRAIN_SLOPE,
                            "served_fixtures": [f["component_id"] for f in items],
                            "fixture_count": len(items),
                            "drain_plane_elevation_m": drain_z,
                            "lowest_arrival_elevation_m": round(min(arrival), 4),
                            "discharge_units": None, "verified_diameter_m": None,
                            "verified_slope": None, "peak_flow_lps": None},
                requires_calculation=DRAIN_PENDING,
                tags=["sanitario", "ramal"],
                op_description=("Ramal de desague del recinto %s en %s: bajada de %d aparatos al "
                                "plano de desague en cota %.2f y tramos con pendiente adoptada "
                                "%.1f%% hacia la bajante. La cota de llegada se deduce de la "
                                "longitud horizontal, no se elige."
                                % (code, lid, len(items), drain_z, P.HYP_DRAIN_SLOPE * 100)),
                derived_from=["HYP_DRAIN_SLOPE", "HYP_PIPE_DIAMETERS", "HYP_ROUTING_Z"],
                flow_direction="aparatos_hacia_bajante",
                validation_notes=["Pendiente adoptada para el trazado; no verificada por calculo."],
            )
            for f in items:
                K.link(model, connection_id="CNX-DES-%s" % f["component_id"],
                       discipline="hydrosanitary", type="pipe_connection",
                       origin=f["component_id"], destination=did,
                       medium="tuberia_pvc_sanitario", technology="descarga de aparato",
                       parameters={"nominal_diameter_m":
                                   P.HYP_PIPE_DIAMETERS[f["spec"]["drain"]],
                                   "verified_diameter_m": None},
                       geometry_reference="SOL-%s" % did,
                       flow_direction="aparato_hacia_ramal",
                       requires_calculation=["verified_diameter_m", "discharge_units"])
            K.link(model, connection_id="CNX-%s-BAJ" % did, discipline="hydrosanitary",
                   type="pipe_connection", origin=did, destination="HID-BAJ-SAN",
                   medium="tuberia_pvc_sanitario", technology="conexion a bajante",
                   parameters={"adopted_slope": P.HYP_DRAIN_SLOPE},
                   length_m=dlen, flow_direction="ramal_hacia_bajante",
                   requires_calculation=DRAIN_PENDING)


def _drains_near(leader: Tuple[float, float], reach: float = 2.60) -> List[Tuple[float, float]]:
    """Sumideros proximos a una bajante, dentro de la huella de cubierta.

    La proximidad no es estetica: con el vacio tecnico ocupado por ductos,
    tuberia de agua y bandeja electrica, a la red pluvial solo le queda la
    franja hidrosanitaria. Un recorrido corto mantiene la tuberia dentro de esa
    franja con la pendiente adoptada.
    """
    rx, ry = leader
    margin = 1.20
    out: List[Tuple[float, float]] = []
    for dx, dy in ((reach, -reach * 0.7), (-reach, reach * 0.7)):
        x = min(max(rx + dx, margin), P.REQ_LENGTH_X - margin)
        y = min(max(ry + dy, margin), P.REQ_WIDTH_Y - margin)
        out.append((round(x, 3), round(y, 3)))
    return out


def _off_frame(x: float, y: float, radius: float,
               toward: Tuple[float, float] = None) -> Tuple[float, float]:
    """Saca de la franja de las vigas el punto por donde una tuberia vertical
    atraviesa la losa.

    El pase de losa es previsto; el paso por una viga no. Si el punto cae
    sobre un eje de la reticula se desplaza lo justo: hacia `toward` (la
    bajante) si se indica, o hacia el lado en que ya estaba.
    """
    need = P.HYP_BEAM_WIDTH / 2.0 + radius + 0.05

    def shift(v, g, t):
        if abs(v - g) >= need:
            return v
        ref = t if t is not None else v
        if abs(ref - g) < 1e-9:
            ref = g + 1.0
        return g + need if ref >= g else g - need

    for gx in P.GRID_X:
        x = shift(x, gx, toward[0] if toward else None)
    for gy in P.GRID_Y:
        y = shift(y, gy, toward[1] if toward else None)
    return (round(x, 3), round(y, 3))


def _rain_run_plan(start: Tuple[float, float], end: Tuple[float, float],
                   radius: float) -> List[Tuple[float, float]]:
    """Vertices en planta del ramal pluvial del sumidero a la bajante.

    Se prefiere el tramo recto (es el mas corto y mantiene la tuberia dentro
    de la franja hidrosanitaria con la pendiente adoptada). Si el tramo recto
    pasa por una columna, se prueba un recorrido en L por cada lado; si ambos
    tambien la cruzan se deja el recto y la colision se reporta.
    """
    from shapely.geometry import LineString, box

    cols = [box(*r) for r in R.column_obstacles(clearance=radius + 0.03)]

    def clear(pts):
        line = LineString([start] + list(pts))
        return not any(line.intersects(c) for c in cols)

    (sx, sy), (ex, ey) = start, end
    options = [[(ex, ey)], [(ex, sy), (ex, ey)], [(sx, ey), (ex, ey)]]
    for opt in options:
        if clear(opt):
            return opt
    return options[0]


def build_rainwater(model) -> None:
    """Red pluvial de cubierta.

    Se emplean DOS bajantes, una por ducto vertical, con sumideros proximos a
    cada una. El motivo es geometrico y esta documentado: el vacio tecnico del
    ultimo nivel ya esta ocupado por ductos, tuberia de agua, bandeja electrica
    y cableados, y solo deja a la red pluvial la franja hidrosanitaria
    (+-0.05 m). Con recorridos cortos la pendiente adoptada no saca la tuberia
    de esa franja.

    El NUMERO y la POSICION de los sumideros quedan condicionados por la
    posicion de los ductos, no por un calculo de areas tributarias. La
    verificacion hidraulica es un parametro pendiente declarado.
    """
    rz = P.ROOF_LEVEL["elevation"]
    collector_z = round(P.LEVELS[-1]["elevation"] + P.HYP_ROUTING_Z["hydrosanitary"], 3)
    slope = 0.01   # 1% en el colector de cubierta, para no salir de la franja

    leaders = [
        ("HID-BAJ-PLU-01", riser_at("rain_leader"), _drains_near(riser_at("rain_leader"))),
        ("HID-BAJ-PLU-02", riser_at("rain_leader_2"), _drains_near(riser_at("rain_leader_2"))),
    ]
    total_drains = sum(len(d) for _, _, d in leaders)
    k = 0

    radius = P.HYP_PIPE_DIAMETERS["bajante_pluvial"] / 2.0
    leaders = [(code, pos, [_off_frame(dx, dy, radius, toward=pos) for dx, dy in drains])
               for code, pos, drains in leaders]

    for lid_code, (rx, ry), drains in leaders:
        leader = R.riser(rx, ry, -0.60, collector_z)
        _, llen = K.add_route(
            model, component_id=lid_code, discipline="hydrosanitary",
            type="rain_leader", name="Bajante pluvial %s" % lid_code[-2:],
            polylines=[leader], diameter=P.HYP_PIPE_DIAMETERS["bajante_pluvial"],
            material="pvc_sanitario", ifc_class="IfcPipeSegment", layer="HID-PLUVIAL",
            parameters={"nominal_diameter_m": P.HYP_PIPE_DIAMETERS["bajante_pluvial"],
                        "served_drains": len(drains),
                        "design_rainfall_intensity_mm_h": None,
                        "contributing_area_m2": round(P.REQ_AREA_PER_LEVEL / len(leaders), 2),
                        "verified_diameter_m": None, "peak_flow_lps": None},
            requires_calculation=["design_rainfall_intensity_mm_h", "verified_diameter_m",
                                  "peak_flow_lps"],
            tags=["pluvial", "bajante"],
            op_description=("Bajante pluvial en el ducto vertical, desde la cota del colector "
                            "%.2f m hasta la cota de descarga." % collector_z),
            derived_from=["SPACE_PROGRAM", "HYP_PIPE_DIAMETERS"],
            flow_direction="descendente_por_gravedad",
            validation_notes=["Intensidad de lluvia de diseno no definida."],
        )

        for dx, dy in drains:
            k += 1
            cid = "HID-SUM-%02d" % k
            K.add_device(
                model, component_id=cid, discipline="hydrosanitary", type="roof_drain",
                name="Sumidero de cubierta %d" % k, level_id="NC",
                xyz=(dx, dy, round(rz - 0.03, 3)), box=(0.30, 0.30, 0.06),
                material="equipo_generico", ifc_class="IfcWasteTerminal", layer="HID-PLUVIAL",
                parameters={"nominal_diameter_m": P.HYP_PIPE_DIAMETERS["bajante_pluvial"],
                            "contributing_area_m2": round(P.REQ_AREA_PER_LEVEL / total_drains, 2),
                            "served_leader": lid_code,
                            "design_flow_lps": None, "verified_capacity_lps": None,
                            "position_criterion": "proximidad al ducto vertical disponible"},
                requires_calculation=["design_flow_lps", "verified_capacity_lps"],
                tags=["pluvial", "sumidero"],
                op_description=("Sumidero de cubierta %d asociado a %s. Area tributaria "
                                "geometrica %.2f m2 por reparto del area de cubierta entre %d "
                                "sumideros; no procede de calculo de escorrentia."
                                % (k, lid_code, P.REQ_AREA_PER_LEVEL / total_drains,
                                   total_drains)),
                derived_from=["REQ_AREA_PER_LEVEL", "SPACE_PROGRAM"],
                validation_notes=["La posicion responde a la geometria de los ductos, no a "
                                  "un reparto hidraulico verificado."],
            )
            drop = [(dx, dy, round(rz - 0.12, 3)), (dx, dy, collector_z)]
            run = R.sloped_polyline((dx, dy, collector_z),
                                    _rain_run_plan((dx, dy), (rx, ry), radius), slope)
            path = [drop[0]] + run
            pid = "HID-RAM-PLU-%02d" % k
            _, plen = K.add_route(
                model, component_id=pid, discipline="hydrosanitary", type="rain_branch",
                name="Ramal pluvial %d" % k,
                polylines=[path], diameter=P.HYP_PIPE_DIAMETERS["bajante_pluvial"],
                material="pvc_sanitario", ifc_class="IfcPipeSegment", layer="HID-PLUVIAL",
                level_id="NC",
                parameters={"adopted_slope": slope,
                            "collector_elevation_m": collector_z,
                            "arrival_elevation_m": run[-1][2],
                            "served_leader": lid_code,
                            "verified_diameter_m": None, "verified_slope": None},
                requires_calculation=["verified_diameter_m", "verified_slope"],
                tags=["pluvial", "ramal"],
                op_description=("Ramal pluvial del sumidero %d a %s, con pendiente adoptada "
                                "%.1f%%. Cota de llegada deducida de la longitud: %.3f m."
                                % (k, lid_code, slope * 100, run[-1][2])),
                derived_from=["SPACE_PROGRAM", "HYP_ROUTING_Z"],
                flow_direction="sumidero_hacia_bajante",
            )
            K.link(model, connection_id="CNX-%s-BAJPLU" % cid, discipline="hydrosanitary",
                   type="pipe_connection", origin=cid, destination=lid_code,
                   medium="tuberia_pvc_sanitario", technology="recoleccion pluvial",
                   parameters={"via": pid, "adopted_slope": slope},
                   geometry_reference="SOL-%s" % pid, length_m=plen,
                   flow_direction="sumidero_hacia_bajante",
                   requires_calculation=["verified_diameter_m", "design_flow_lps"])


# ---------------------------------------------------------------------------
# Vivienda (casa unifamiliar)
# ---------------------------------------------------------------------------
# La red de oficinas (tanque enterrado, bombeo, tanque elevado, banos
# colectivos con orinales) no corresponde a una casa. En vivienda se modela:
#
#   acometida enterrada -> medidor en la fachada oeste -> red de agua fria a la
#   vista bajo el fondo de viga -> montante en el ducto sanitario -> ramal por
#   recinto humedo -> aparatos (ducha, inodoro, lavamanos, lavaplatos, lavadero)
#
#   aparatos -> ramales de desague -> bajante sanitaria con ventilacion
#   primaria sobre cubierta -> colector enterrado -> caja de inspeccion ->
#   salida hacia la red o el sistema de disposicion (sin definir)
#
#   sumidero de cubierta -> gargola por el pretil -> bajante pluvial exterior
#   -> caja de inspeccion pluvial -> salida
#
# Ningun dato hidraulico se fija: diametros, pendientes, caudales, unidades
# de consumo y de descarga, presion disponible e intensidad de lluvia quedan
# en None y declarados en `requires_calculation`. Para poder DIBUJAR la red
# se usan un diametro de representacion (los de HYP_PIPE_DIAMETERS) y una
# pendiente de trazado (HYP_DRAIN_SLOPE); ambos se registran como
# hipotesis geometricas de representacion, no como valores de diseno.

RES_FIXTURES_BY_USE = {
    "bano": ("ducha", "inodoro", "lavamanos"),
    "cocina": ("lavaplatos",),
    "lavanderia": ("lavadero",),
}

# Envolvente geometrica de referencia de cada aparato: largo a lo largo del
# muro, fondo perpendicular al muro, alto y cota del centro sobre el piso.
# Son tamanos de representacion, no fichas de producto.
RES_FIXTURE_SPEC = {
    "ducha": {"along": 0.90, "perp": 0.90, "h": 0.05, "z": 0.025, "supply_z": 1.10,
              "drain": "ramal_sanitario", "supply": "ramal_agua",
              "ifc": "IfcSanitaryTerminal", "name": "Ducha", "tag": "DUC"},
    "inodoro": {"along": 0.38, "perp": 0.62, "h": 0.78, "z": 0.39, "supply_z": None,
                "drain": "ramal_inodoro", "supply": "ramal_agua",
                "ifc": "IfcSanitaryTerminal", "name": "Inodoro", "tag": "INO"},
    "lavamanos": {"along": 0.52, "perp": 0.42, "h": 0.20, "z": 0.85, "supply_z": None,
                  "drain": "ramal_sanitario", "supply": "ramal_agua",
                  "ifc": "IfcSanitaryTerminal", "name": "Lavamanos", "tag": "LAM"},
    "lavaplatos": {"along": 0.80, "perp": 0.50, "h": 0.20, "z": 0.85, "supply_z": None,
                   "drain": "ramal_sanitario", "supply": "ramal_agua",
                   "ifc": "IfcSanitaryTerminal", "name": "Lavaplatos", "tag": "LAP"},
    "lavadero": {"along": 0.60, "perp": 0.50, "h": 0.30, "z": 0.80, "supply_z": None,
                 "drain": "ramal_sanitario", "supply": "ramal_agua",
                 "ifc": "IfcSanitaryTerminal", "name": "Lavadero", "tag": "LAD"},
}
RES_FIXTURE_GAP = 0.20          # separacion geometrica entre aparatos sobre el muro

RES_SUPPLY_PENDING = ["nominal_diameter_m", "design_flow_lps", "fixture_units",
                      "available_pressure_kPa", "head_loss_kPa"]
RES_DRAIN_PENDING = ["nominal_diameter_m", "design_slope", "discharge_units",
                     "peak_flow_lps"]
RES_RAIN_PENDING = ["nominal_diameter_m", "design_rainfall_intensity_mm_h",
                    "peak_flow_lps", "verified_capacity_lps"]

_REPRESENTATION_NOTE = ("El diametro del solido es de representacion grafica (%.0f mm), "
                        "no un diametro de diseno: nominal_diameter_m queda pendiente.")


def _res_rep(key: str) -> float:
    """Diametro de representacion del solido (no de diseno)."""
    return P.HYP_PIPE_DIAMETERS[key]


def _res_wet_rooms(lid: str) -> List[Tuple[str, str, List[float], str]]:
    """(codigo, uso, rectangulo, banda) de los recintos con aparatos."""
    out = []
    for code, _name, use, band, start, end in P.SPACE_PROGRAM.get(lid, ()):
        if use in RES_FIXTURES_BY_USE:
            out.append((code, use, list(P.space_rect(band, start, end)), band))
    return out


def _buried_obstacles(radius: float) -> List[Tuple[float, float, float, float]]:
    """Pedestales (bajo la losa de piso) inflados por el radio del tubo."""
    pw, pl = P.HYP_PEDESTAL_SIZE
    c = radius + 0.05
    return [(gx - pw / 2 - c, gy - pl / 2 - c, gx + pw / 2 + c, gy + pl / 2 + c)
            for gx in P.GRID_X for gy in P.GRID_Y]


def _sloped_route(start: Tuple[float, float, float], end_xy: Tuple[float, float],
                  slope: float, obstacles, order: str = "xy") -> List[Tuple[float, float, float]]:
    """Recorrido ortogonal en planta que rodea obstaculos, con pendiente constante."""
    sx, sy, sz = start
    ex, ey = end_xy
    mid = (ex, sy) if order == "xy" else (sx, ey)
    flat = R.avoid_obstacles([(sx, sy, sz), (mid[0], mid[1], sz), (ex, ey, sz)], obstacles)
    return R.sloped_polyline((sx, sy, sz), [(p[0], p[1]) for p in flat[1:]], slope)


def _clear_y_on_west_facade(avoid_y: List[float], radius: float, half: float,
                            lo: float, hi: float) -> float:
    """Cota Y sobre la fachada oeste libre de columnas, pedestales y otros equipos."""
    pw = max(P.HYP_PEDESTAL_SIZE[1], P.HYP_COLUMN_SIZE[1])
    need = pw / 2.0 + max(radius, half) + 0.05
    y = lo
    while y <= hi + 1e-9:
        if all(abs(y - gy) >= need for gy in P.GRID_Y) and \
                all(abs(y - a) >= 0.60 for a in avoid_y):
            return round(y, 3)
        y += 0.05
    return round((lo + hi) / 2.0, 3)


def _place_fixtures(lid: str, e: float, code: str, use: str, rect: List[float],
                    band: str, toward_x: float) -> List[Dict[str, Any]]:
    """Posiciones de los aparatos de un recinto, en fila contra un muro lateral.

    Los recintos de vivienda abren al pasillo por su lado largo; los muros
    laterales (este u oeste del recinto) no tienen puertas ni ventanas. Los
    aparatos se alinean contra el muro lateral mas proximo a la bajante,
    empezando por el extremo de fachada y saltando el ducto sanitario. Si no
    caben, siguen en el muro opuesto. Es un reparto geometrico, no un diseno
    de bano o de cocina.
    """
    x0, y0, x1, y1 = rect
    wall_off = P.HYP_WALL_INTERIOR / 2.0
    sides = [x0, x1] if abs(toward_x - x0) <= abs(toward_x - x1) else [x1, x0]
    facade_end = y0 if band == "SOUTH" else y1
    door_end = y1 if band == "SOUTH" else y0
    direction = 1.0 if band == "SOUTH" else -1.0
    out = []
    start = facade_end + direction * (wall_off + 0.05)
    cursors = [start, start]
    side_i = 0
    sx0, sy0, sx1, sy1 = shaft_sanitary()
    counts: Dict[str, int] = {}

    def slot(side, cur, sp):
        """Centro del aparato en el lado `side` a partir de `cur`, saltando el ducto."""
        wall_x = sides[side]
        inward = 1.0 if wall_x == x0 else -1.0
        cx = wall_x + inward * (wall_off + 0.02 + sp["perp"] / 2.0)
        for _ in range(3):
            cy = cur + direction * sp["along"] / 2.0
            hx, hy = sp["perp"] / 2.0 + 0.05, sp["along"] / 2.0 + 0.05
            if cx - hx < sx1 and cx + hx > sx0 and cy - hy < sy1 and cy + hy > sy0:
                # El ducto sanitario ocupa ese tramo del muro: se salta.
                cur = (sy1 if direction > 0 else sy0) + direction * 0.05
                continue
            break
        return wall_x, inward, cx, cy, cur

    for ftype in RES_FIXTURES_BY_USE[use]:
        sp = RES_FIXTURE_SPEC[ftype]
        wall_x, inward, cx, cy, cur = slot(side_i, cursors[side_i], sp)
        if side_i == 0 and (cur + direction * sp["along"] - door_end) * direction > -0.15:
            side_i = 1
            wall_x, inward, cx, cy, cur = slot(side_i, cursors[side_i], sp)
        cursors[side_i] = cur + direction * (sp["along"] + RES_FIXTURE_GAP)
        cx, cy = R.clear_of_columns(cx, cy, sp["perp"] / 2.0, sp["along"] / 2.0,
                                    within=rect, axis="y")
        counts[ftype] = counts.get(ftype, 0) + 1
        fz = round(e + sp["z"], 3)
        if sp["supply_z"] is not None:
            # La griferia de la ducha esta en el muro, a la altura de uso.
            sxw = round(wall_x + inward * (wall_off + 0.05), 3)
            supply = (sxw, round(cy, 3), round(e + sp["supply_z"], 3))
        else:
            supply = (round(cx, 3), round(cy, 3), round(fz + 0.10, 3))
        out.append({
            "type": ftype, "spec": sp, "room": code, "index": counts[ftype],
            "xyz": (round(cx, 3), round(cy, 3), fz),
            "box": (sp["perp"], sp["along"], sp["h"]),
            "supply_xyz": supply,
        })
    return out


def build_residential_source(model) -> Tuple[float, float, float]:
    """Acometida y medidor de agua de la vivienda. Devuelve el punto de salida."""
    import discipline_electrical as EL  # solo para no superponer los medidores

    ele_y = EL.meter_position()[1] if "ELE-MED-001" in model.components else None
    lo, hi = P.INNER_Y0 + 0.40, P.INNER_Y1 - 0.40
    radius = _res_rep("acometida_agua") / 2.0
    my = _clear_y_on_west_facade([ele_y] if ele_y is not None else [], radius, 0.15, lo, hi)
    mx = round(P.HYP_WALL_EXTERIOR / 2.0, 4)
    mz = 0.60

    path = [(-3.00, my, -0.60), (mx, my, -0.60), (mx, my, round(mz - 0.125, 3))]
    _, alen = K.add_route(
        model, component_id="HID-ACO-001", discipline="hydrosanitary",
        type="water_service", name="Acometida de agua potable",
        polylines=[path], diameter=_res_rep("acometida_agua"), material="pvc",
        ifc_class="IfcPipeSegment", layer="HID-AGUA", level_id="N1",
        parameters={"nominal_diameter_m": None,
                    "representation_diameter_m": _res_rep("acometida_agua"),
                    "available_pressure_kPa": None, "design_flow_lps": None,
                    "fixture_units": None, "head_loss_kPa": None,
                    "utility_connection_point": None},
        requires_calculation=RES_SUPPLY_PENDING + ["utility_connection_point"],
        tags=["hidraulico", "acometida", "vivienda"], provenance="hypothesis",
        op_description=("Acometida de agua enterrada a -0.60 m desde el lindero oeste hasta "
                        "el medidor en la fachada, en una franja libre de pedestales y del "
                        "medidor electrico."),
        derived_from=["HYP_WALL_EXTERIOR", "HYP_PEDESTAL_SIZE", "GRID_Y"],
        flow_direction="red_hacia_vivienda",
        validation_notes=["Punto de entrega y presion disponible sin definir.",
                          _REPRESENTATION_NOTE % (_res_rep("acometida_agua") * 1000)],
    )
    K.add_device(
        model, component_id="HID-MED-001", discipline="hydrosanitary",
        type="water_meter", name="Medidor de agua", level_id="N1",
        xyz=(mx, my, mz), box=(0.20, 0.30, 0.25), material="equipo_generico",
        ifc_class="IfcFlowMeter", layer="HID-EQUIPOS",
        parameters={"nominal_diameter_m": None, "meter_type": None,
                    "rated_flow_lps": None, "head_loss_kPa": None},
        requires_calculation=["nominal_diameter_m", "meter_type", "rated_flow_lps",
                              "head_loss_kPa"],
        tags=["hidraulico", "medicion", "vivienda"],
        op_description=("Medidor de agua empotrado en la fachada oeste a %.2f m, apartado "
                        "de columnas y del medidor electrico." % mz),
        derived_from=["HYP_WALL_EXTERIOR", "GRID_Y"],
    )
    K.link(model, connection_id="CNX-HID-ACO-MED", discipline="hydrosanitary",
           type="pipe_connection", origin="HID-ACO-001", destination="HID-MED-001",
           medium="tuberia_pvc_presion", technology="union al medidor",
           parameters={"nominal_diameter_m": None}, geometry_reference="SOL-HID-ACO-001",
           length_m=alen, flow_direction="red_hacia_medidor",
           requires_calculation=["nominal_diameter_m"], provenance="hypothesis")
    return (mx, my, mz)


def build_residential_supply(model, meter_xyz) -> Dict[str, List[Dict[str, Any]]]:
    """Red de agua fria: medidor -> montante -> ramales -> aparatos."""
    mx, my, mz = meter_xyz
    wx, wy = riser_at("water_supply")
    sx, _sy = riser_at("drain_stack")
    first = P.LEVELS[0]
    via1 = R.plenum_z(first, "hydrosanitary")
    rep_main = _res_rep("distribucion_agua")

    # Red principal: atraviesa el muro de fachada a la cota del medidor, sube
    # a la vista bajo el fondo de viga y va al ducto sanitario rodeando
    # columnas y escalera.
    inside_x = round(P.INNER_X0 + 0.25, 3)
    main = [(mx, my, mz), (inside_x, my, mz), (inside_x, my, via1)]
    main += R.manhattan((inside_x, my, via1), (wx, wy, via1), via1, avoid=True)[1:]
    polys = [R._dedupe(main)]
    top = P.LEVELS[-1]
    if len(P.LEVELS) > 1:
        polys.append(R.riser(wx, wy, via1, R.plenum_z(top, "hydrosanitary")))
    _, mlen = K.add_route(
        model, component_id="HID-RED-AF", discipline="hydrosanitary",
        type="water_main", name="Red de agua fria y montante",
        polylines=polys, diameter=rep_main, material="cpvc",
        ifc_class="IfcPipeSegment", layer="HID-AGUA", level_id="N1",
        parameters={"nominal_diameter_m": None, "representation_diameter_m": rep_main,
                    "shaft": "ducto sanitario", "supply_mode": "presion de red (hipotesis)",
                    "design_flow_lps": None, "fixture_units": None,
                    "available_pressure_kPa": None, "head_loss_kPa": None,
                    "hot_water": "no modelada"},
        requires_calculation=RES_SUPPLY_PENDING,
        tags=["hidraulico", "agua fria", "vivienda"],
        op_description=("Red de agua fria desde el medidor: pase por el muro de fachada, "
                        "subida a %.2f m (a la vista bajo el fondo de viga) y recorrido "
                        "ortogonal hasta el ducto sanitario; montante hasta el %s."
                        % (via1, top["level_id"])),
        derived_from=["HYP_ROUTING_Z", "SHAFT_SANITARY_SIZE"],
        flow_direction="medidor_hacia_aparatos",
        validation_notes=["Suministro directo de la red: sin tanque ni bombeo. Depende de "
                          "la presion disponible, que no se conoce.",
                          "El agua caliente no se modela.",
                          _REPRESENTATION_NOTE % (rep_main * 1000)],
    )
    K.link(model, connection_id="CNX-HID-MED-RED", discipline="hydrosanitary",
           type="pipe_connection", origin="HID-MED-001", destination="HID-RED-AF",
           medium="tuberia_cpvc", technology="salida del medidor",
           parameters={"nominal_diameter_m": None}, geometry_reference="SOL-HID-RED-AF",
           length_m=mlen, flow_direction="medidor_hacia_red",
           requires_calculation=["nominal_diameter_m"])

    by_level: Dict[str, List[Dict[str, Any]]] = {}
    for level in P.LEVELS:
        lid, e = level["level_id"], level["elevation"]
        via = R.plenum_z(level, "hydrosanitary")
        created: List[Dict[str, Any]] = []
        for code, use, rect, band in _res_wet_rooms(lid):
            fixtures = _place_fixtures(lid, e, code, use, rect, band, sx)
            for f in fixtures:
                sp = f["spec"]
                cid = "HID-APA-%s-%s-%s%d" % (lid, code, sp["tag"], f["index"])
                f["component_id"] = cid
                K.add_device(
                    model, component_id=cid, discipline="hydrosanitary",
                    type="sanitary_fixture", name="%s %s-%d" % (sp["name"], code, f["index"]),
                    level_id=lid, space_id="ARQ-ESP-%s" % code,
                    xyz=f["xyz"], box=f["box"], material="pvc",
                    ifc_class=sp["ifc"], layer="HID-APARATOS",
                    parameters={"fixture_type": f["type"],
                                "supply_diameter_m": None, "drain_diameter_m": None,
                                "fixture_units_supply": None, "discharge_units": None,
                                "flow_rate_lps": None, "trap_seal_mm": None,
                                "supply_point": list(f["supply_xyz"])},
                    requires_calculation=["supply_diameter_m", "drain_diameter_m",
                                          "fixture_units_supply", "discharge_units",
                                          "flow_rate_lps", "trap_seal_mm"],
                    tags=["hidraulico", "aparato", f["type"], "vivienda"],
                    op_description=("%s en el recinto %s (%s), contra el muro lateral, a "
                                    "cota %.2f. Envolvente geometrica de referencia; no es "
                                    "una ficha de producto."
                                    % (sp["name"], code, use, f["xyz"][2])),
                    derived_from=["RES_FIXTURES_BY_USE", "RES_FIXTURE_SPEC", "SPACE_PROGRAM"],
                )
                model.relate(cid, "serves_space", "ARQ-ESP-%s" % code)
                created.append(f)
            if not fixtures:
                continue
            branch = R.trunk_and_drops((wx, wy, via), [f["supply_xyz"] for f in fixtures], via)
            bid = "HID-RAM-AGUA-%s-%s" % (lid, code)
            rep = _res_rep("ramal_agua")
            _, blen = K.add_route(
                model, component_id=bid, discipline="hydrosanitary",
                type="water_branch", name="Ramal de agua fria %s" % code,
                polylines=branch, diameter=rep, material="cpvc",
                ifc_class="IfcPipeSegment", layer="HID-AGUA",
                level_id=lid, space_id="ARQ-ESP-%s" % code,
                parameters={"nominal_diameter_m": None, "representation_diameter_m": rep,
                            "served_fixtures": [f["component_id"] for f in fixtures],
                            "fixture_count": len(fixtures),
                            "design_flow_lps": None, "fixture_units": None,
                            "available_pressure_kPa": None, "head_loss_kPa": None},
                requires_calculation=RES_SUPPLY_PENDING,
                tags=["hidraulico", "ramal", "agua fria", "vivienda"],
                op_description=("Ramal de agua fria del recinto %s en %s: troncal a %.2f m "
                                "desde el montante y bajada a %d aparatos."
                                % (code, lid, via, len(fixtures))),
                derived_from=["HYP_ROUTING_Z", "RES_FIXTURE_SPEC"],
                flow_direction="montante_hacia_aparatos",
                validation_notes=[_REPRESENTATION_NOTE % (rep * 1000)],
            )
            K.link(model, connection_id="CNX-HID-RED-%s" % bid, discipline="hydrosanitary",
                   type="pipe_connection", origin="HID-RED-AF", destination=bid,
                   medium="tuberia_cpvc", technology="derivacion de recinto",
                   parameters={"nominal_diameter_m": None},
                   geometry_reference="SOL-%s" % bid, length_m=blen,
                   flow_direction="montante_hacia_ramal",
                   requires_calculation=["nominal_diameter_m"])
            for f in fixtures:
                K.link(model, connection_id="CNX-AGUA-%s" % f["component_id"],
                       discipline="hydrosanitary", type="pipe_connection",
                       origin=bid, destination=f["component_id"],
                       medium="tuberia_cpvc", technology="alimentacion de aparato",
                       parameters={"nominal_diameter_m": None},
                       flow_direction="ramal_hacia_aparato",
                       requires_calculation=["nominal_diameter_m", "design_flow_lps"])
        by_level[lid] = created
    return by_level


def build_residential_drainage(model, fixtures: Dict[str, List[Dict[str, Any]]]) -> None:
    """Desagues -> bajante con ventilacion -> colector -> caja de inspeccion -> salida."""
    sx, sy = riser_at("drain_stack")
    slope = P.HYP_DRAIN_SLOPE      # pendiente de TRAZADO; la de diseno queda pendiente
    above = R.route_obstacles()
    buried = _buried_obstacles(_res_rep("ramal_inodoro") / 2.0)
    arrivals: List[float] = []
    branches = []

    for level in P.LEVELS:
        lid, e, idx = level["level_id"], level["elevation"], level["index"]
        if idx == 1:
            drain_z, obstacles = -0.30, buried
        else:
            # Bajo la losa del nivel, en la franja hidrosanitaria del nivel
            # inferior y por debajo del fondo de viga.
            drain_z = R.plenum_z(P.LEVELS[idx - 2], "hydrosanitary")
            obstacles = above
        by_room: Dict[str, List[Dict[str, Any]]] = {}
        for f in fixtures.get(lid, []):
            by_room.setdefault(f["room"], []).append(f)
        for code, items in sorted(by_room.items()):
            polylines = []
            arr = []
            for f in items:
                fx, fy, fz = f["xyz"]
                radius = _res_rep(f["spec"]["drain"]) / 2.0
                px, py = _off_frame(fx, fy, radius)
                top_z = round(fz - f["spec"]["h"] / 2.0, 3)
                head = [(fx, fy, top_z)]
                if (px, py) != (round(fx, 3), round(fy, 3)):
                    head.append((px, py, top_z))
                polylines.append(head + [(px, py, drain_z)])
                run = _sloped_route((px, py, drain_z), (sx, sy), slope, obstacles)
                polylines.append(run)
                arr.append(run[-1][2])
            arrivals.extend(arr)
            did = "HID-RAM-DES-%s-%s" % (lid, code)
            rep = _res_rep("ramal_inodoro" if any(f["type"] == "inodoro" for f in items)
                           else "ramal_sanitario")
            _, dlen = K.add_route(
                model, component_id=did, discipline="hydrosanitary",
                type="drain_branch", name="Ramal de desague %s" % code,
                polylines=polylines, diameter=rep, material="pvc_sanitario",
                ifc_class="IfcPipeSegment", layer="HID-DESAGUE",
                level_id=lid, space_id="ARQ-ESP-%s" % code,
                parameters={"nominal_diameter_m": None, "representation_diameter_m": rep,
                            "design_slope": None, "drawing_slope": slope,
                            "served_fixtures": [f["component_id"] for f in items],
                            "fixture_count": len(items),
                            "drain_plane_elevation_m": drain_z,
                            "lowest_arrival_elevation_m": round(min(arr), 4),
                            "discharge_units": None, "peak_flow_lps": None},
                requires_calculation=RES_DRAIN_PENDING,
                tags=["sanitario", "ramal", "vivienda"],
                op_description=("Ramal de desague del recinto %s en %s: bajada de %d aparatos "
                                "al plano de desague (cota %.2f) y tramos ortogonales hacia la "
                                "bajante con una pendiente de trazado de %.1f%%, que no es "
                                "pendiente de diseno."
                                % (code, lid, len(items), drain_z, slope * 100)),
                derived_from=["HYP_DRAIN_SLOPE", "HYP_ROUTING_Z", "RES_FIXTURE_SPEC"],
                flow_direction="aparatos_hacia_bajante",
                validation_notes=["La pendiente y el diametro de diseno estan pendientes.",
                                  _REPRESENTATION_NOTE % (rep * 1000)],
            )
            branches.append((did, dlen, items))

    if not branches:
        return

    # Bajante: desde por debajo de la llegada mas baja hasta 0.60 m sobre la
    # cubierta (ventilacion primaria por prolongacion de la bajante).
    bottom = round(min(arrivals) - 0.10, 3)
    vent_top = round(P.ROOF_LEVEL["elevation"] + 0.60, 3)
    rep_stack = _res_rep("bajante_sanitaria")
    _, stlen = K.add_route(
        model, component_id="HID-BAJ-SAN", discipline="hydrosanitary",
        type="drain_stack", name="Bajante sanitaria con ventilacion",
        polylines=[R.riser(sx, sy, bottom, vent_top)], diameter=rep_stack,
        material="pvc_sanitario", ifc_class="IfcPipeSegment", layer="HID-DESAGUE",
        parameters={"nominal_diameter_m": None, "representation_diameter_m": rep_stack,
                    "shaft": "ducto sanitario",
                    "vent": "prolongacion de la bajante 0.60 m sobre la cubierta (hipotesis)",
                    "discharge_units": None, "peak_flow_lps": None,
                    "vent_diameter_m": None},
        requires_calculation=["nominal_diameter_m", "discharge_units", "peak_flow_lps",
                              "vent_diameter_m"],
        tags=["sanitario", "bajante", "ventilacion", "vivienda"],
        op_description=("Bajante sanitaria en el ducto sanitario, de cota %.2f (bajo la "
                        "llegada mas baja) a %.2f, prolongada sobre la cubierta como "
                        "ventilacion primaria." % (bottom, vent_top)),
        derived_from=["SHAFT_SANITARY_SIZE", "ROOF_LEVEL"],
        flow_direction="descendente_por_gravedad",
        validation_notes=[_REPRESENTATION_NOTE % (rep_stack * 1000)],
    )
    for did, dlen, items in branches:
        for f in items:
            K.link(model, connection_id="CNX-DES-%s" % f["component_id"],
                   discipline="hydrosanitary", type="pipe_connection",
                   origin=f["component_id"], destination=did,
                   medium="tuberia_pvc_sanitario", technology="descarga de aparato",
                   parameters={"nominal_diameter_m": None},
                   flow_direction="aparato_hacia_ramal",
                   requires_calculation=["nominal_diameter_m", "discharge_units"])
        K.link(model, connection_id="CNX-%s-BAJ" % did, discipline="hydrosanitary",
               type="pipe_connection", origin=did, destination="HID-BAJ-SAN",
               medium="tuberia_pvc_sanitario", technology="conexion a bajante",
               parameters={"design_slope": None}, geometry_reference="SOL-%s" % did,
               length_m=dlen, flow_direction="ramal_hacia_bajante",
               requires_calculation=["nominal_diameter_m", "design_slope"])

    # Colector enterrado hasta la caja de inspeccion, fuera de la huella por
    # la fachada (sur o norte) mas proxima a la bajante.
    south = sy <= P.REQ_WIDTH_Y / 2.0
    box_y = -1.00 if south else round(P.REQ_WIDTH_Y + 1.00, 3)
    box_x = sx
    pw = P.HYP_PEDESTAL_SIZE[0]
    for gx in P.GRID_X:
        if abs(box_x - gx) < pw / 2.0 + 0.45:
            box_x = round(gx + pw / 2.0 + 0.45 if sx >= gx else gx - pw / 2.0 - 0.45, 3)
    col = _sloped_route((sx, sy, bottom), (box_x, box_y), slope, buried, order="yx")
    _, clen = K.add_route(
        model, component_id="HID-COL-SAN", discipline="hydrosanitary",
        type="building_drain", name="Colector sanitario enterrado",
        polylines=[col], diameter=rep_stack, material="pvc_sanitario",
        ifc_class="IfcPipeSegment", layer="HID-DESAGUE", level_id="N1",
        parameters={"nominal_diameter_m": None, "representation_diameter_m": rep_stack,
                    "design_slope": None, "drawing_slope": slope,
                    "discharge_units": None, "peak_flow_lps": None},
        requires_calculation=RES_DRAIN_PENDING,
        tags=["sanitario", "colector", "vivienda"],
        op_description=("Colector enterrado desde el pie de la bajante hasta la caja de "
                        "inspeccion, fuera de la huella; pendiente de trazado %.1f%%."
                        % (slope * 100)),
        derived_from=["HYP_DRAIN_SLOPE", "HYP_PEDESTAL_SIZE"],
        flow_direction="bajante_hacia_caja",
        validation_notes=[_REPRESENTATION_NOTE % (rep_stack * 1000)],
    )
    inv = col[-1][2]
    _inspection_box(model, "HID-CAJ-SAN", "Caja de inspeccion sanitaria",
                    (box_x, box_y), inv, "HID-DESAGUE")
    out_y = round(box_y - 2.0 if south else box_y + 2.0, 3)
    sal = R.sloped_polyline((box_x, box_y, round(inv, 3)), [(box_x, out_y)], slope)
    _, salen = K.add_route(
        model, component_id="HID-SAL-SAN", discipline="hydrosanitary",
        type="sewer_outlet", name="Salida sanitaria",
        polylines=[sal], diameter=rep_stack, material="pvc_sanitario",
        ifc_class="IfcPipeSegment", layer="HID-DESAGUE", level_id="N1",
        parameters={"nominal_diameter_m": None, "design_slope": None,
                    "discharge_to": None, "public_sewer_invert_m": None},
        requires_calculation=["nominal_diameter_m", "design_slope", "discharge_to",
                              "public_sewer_invert_m"],
        tags=["sanitario", "salida", "vivienda"],
        op_description=("Salida desde la caja de inspeccion hacia la red publica o el "
                        "sistema de disposicion, que no esta definido."),
        derived_from=["HYP_DRAIN_SLOPE"], flow_direction="caja_hacia_red",
        validation_notes=["Destino del vertimiento y cota de la red sin definir."],
    )
    K.link(model, connection_id="CNX-HID-BAJ-COL", discipline="hydrosanitary",
           type="pipe_connection", origin="HID-BAJ-SAN", destination="HID-COL-SAN",
           medium="tuberia_pvc_sanitario", technology="pie de bajante",
           parameters={"design_slope": None}, geometry_reference="SOL-HID-COL-SAN",
           length_m=clen, flow_direction="bajante_hacia_colector",
           requires_calculation=["nominal_diameter_m"])
    K.link(model, connection_id="CNX-HID-COL-CAJ", discipline="hydrosanitary",
           type="pipe_connection", origin="HID-COL-SAN", destination="HID-CAJ-SAN",
           medium="tuberia_pvc_sanitario", technology="llegada a caja",
           parameters={}, flow_direction="colector_hacia_caja",
           requires_calculation=["nominal_diameter_m"])
    K.link(model, connection_id="CNX-HID-CAJ-SAL", discipline="hydrosanitary",
           type="pipe_connection", origin="HID-CAJ-SAN", destination="HID-SAL-SAN",
           medium="tuberia_pvc_sanitario", technology="salida de caja",
           parameters={}, geometry_reference="SOL-HID-SAL-SAN", length_m=salen,
           flow_direction="caja_hacia_red", requires_calculation=["nominal_diameter_m"])


def _inspection_box(model, cid: str, name: str, xy: Tuple[float, float],
                    invert: float, layer: str) -> None:
    """Caja de inspeccion: prisma desde la cota de fondo hasta el terreno."""
    x, y = xy
    z0 = round(invert - 0.10, 3)
    h = round(0.0 - z0, 3)
    K.add_device(
        model, component_id=cid, discipline="hydrosanitary", type="inspection_chamber",
        name=name, level_id="N1", xyz=(x, y, round(z0 + h / 2.0, 3)),
        box=(0.60, 0.60, h), material="concreto_estructural", ifc_class="IfcDistributionChamberElement",
        layer=layer,
        parameters={"inner_size_m": None, "depth_m": round(h, 3), "cover_type": None,
                    "invert_elevation_m": round(invert, 3)},
        requires_calculation=["inner_size_m", "cover_type"],
        tags=["sanitario" if "SAN" in cid else "pluvial", "caja", "vivienda"],
        op_description=("%s fuera de la huella, de la cota %.2f al terreno. Planta de "
                        "0.60 x 0.60 m como envolvente geometrica." % (name, z0)),
        derived_from=["HYP_DRAIN_SLOPE"],
    )


def build_residential_rainwater(model) -> None:
    """Pluvial de cubierta plana: sumidero, gargola, bajante exterior, caja y salida."""
    rz = P.ROOF_LEVEL["elevation"]
    L, W = P.REQ_LENGTH_X, P.REQ_WIDTH_Y
    t = P.HYP_PARAPET_THICKNESS
    rep = _res_rep("bajante_pluvial")
    radius = rep / 2.0
    slope = P.HYP_DRAIN_SLOPE
    # Sobre la fachada este (la del acceso esta en el pasillo): en la banda sur,
    # lejos de las columnas, del pasillo y de los ejes de viga.
    pw = max(P.HYP_PEDESTAL_SIZE[1], P.HYP_COLUMN_SIZE[1], P.HYP_BEAM_WIDTH)
    need = pw / 2.0 + radius + 0.10
    y = None
    for cand in [round(P.INNER_Y0 + k * 0.05, 3) for k in range(8, 400)]:
        if cand > P.RING_Y0 - 0.40:
            break
        if all(abs(cand - gy) >= need for gy in P.GRID_Y):
            y = cand
            break
    if y is None:
        y = round((P.INNER_Y0 + P.RING_Y0) / 2.0, 3)
    dx = round(L - t - 0.35, 3)
    # Las vigas y columnas de fachada estan centradas en el eje x = L y
    # sobresalen del muro: la bajante va por fuera de ellas.
    xo = round(L + max(P.HYP_BEAM_WIDTH, P.HYP_COLUMN_SIZE[0]) / 2.0 + radius + 0.03, 3)
    K.add_device(
        model, component_id="HID-SUM-01", discipline="hydrosanitary", type="roof_drain",
        name="Sumidero de cubierta", level_id="NC",
        xyz=(dx, y, round(rz + 0.03, 3)), box=(0.30, 0.30, 0.06),
        material="equipo_generico", ifc_class="IfcWasteTerminal", layer="HID-PLUVIAL",
        parameters={"contributing_area_m2": round(L * W, 2), "nominal_diameter_m": None,
                    "design_flow_lps": None, "verified_capacity_lps": None,
                    "design_rainfall_intensity_mm_h": None,
                    "position_criterion": "junto al pretil este, fuera de los ejes de viga"},
        requires_calculation=["nominal_diameter_m", "design_flow_lps",
                              "verified_capacity_lps", "design_rainfall_intensity_mm_h"],
        tags=["pluvial", "sumidero", "vivienda"],
        op_description=("Sumidero de cubierta junto al pretil este. Un solo sumidero es una "
                        "hipotesis de trazado: el numero y la capacidad dependen de la "
                        "intensidad de lluvia, que no se conoce."),
        derived_from=["HYP_PARAPET_THICKNESS", "GRID_Y"],
        validation_notes=["Area tributaria geometrica = cubierta completa; sin calculo."],
    )
    zg = round(rz + 0.08, 3)
    gargola = [(dx, y, zg), (xo, y, zg)]
    bottom = -0.40
    leader = [(xo, y, zg), (xo, y, bottom)]
    _, llen = K.add_route(
        model, component_id="HID-BAJ-PLU-01", discipline="hydrosanitary",
        type="rain_leader", name="Gargola y bajante pluvial exterior",
        polylines=[gargola, leader], diameter=rep, material="pvc_sanitario",
        ifc_class="IfcPipeSegment", layer="HID-PLUVIAL",
        parameters={"nominal_diameter_m": None, "representation_diameter_m": rep,
                    "design_rainfall_intensity_mm_h": None,
                    "contributing_area_m2": round(L * W, 2),
                    "peak_flow_lps": None, "verified_capacity_lps": None},
        requires_calculation=RES_RAIN_PENDING,
        tags=["pluvial", "bajante", "vivienda"],
        op_description=("Gargola por el pretil este a %.2f m y bajante exterior adosada a "
                        "la fachada, por fuera de vigas y columnas de borde, hasta -0.40 m."
                        % zg),
        derived_from=["HYP_PARAPET_THICKNESS", "ROOF_LEVEL"],
        flow_direction="descendente_por_gravedad",
        validation_notes=[_REPRESENTATION_NOTE % (rep * 1000)],
    )
    box_x = round(xo + 1.00, 3)
    run = R.sloped_polyline((xo, y, bottom), [(box_x, y)], slope)
    _, rlen = K.add_route(
        model, component_id="HID-COL-PLU", discipline="hydrosanitary",
        type="rain_drain", name="Tramo enterrado pluvial",
        polylines=[run], diameter=rep, material="pvc_sanitario",
        ifc_class="IfcPipeSegment", layer="HID-PLUVIAL", level_id="N1",
        parameters={"nominal_diameter_m": None, "design_slope": None,
                    "drawing_slope": slope, "peak_flow_lps": None},
        requires_calculation=["nominal_diameter_m", "design_slope", "peak_flow_lps"],
        tags=["pluvial", "colector", "vivienda"],
        op_description="Tramo enterrado del pie de la bajante pluvial a su caja de inspeccion.",
        derived_from=["HYP_DRAIN_SLOPE"], flow_direction="bajante_hacia_caja",
    )
    inv = run[-1][2]
    _inspection_box(model, "HID-CAJ-PLU", "Caja de inspeccion pluvial", (box_x, y), inv,
                    "HID-PLUVIAL")
    sal = R.sloped_polyline((box_x, y, inv), [(round(box_x + 2.0, 3), y)], slope)
    _, salen = K.add_route(
        model, component_id="HID-SAL-PLU", discipline="hydrosanitary",
        type="storm_outlet", name="Salida pluvial",
        polylines=[sal], diameter=rep, material="pvc_sanitario",
        ifc_class="IfcPipeSegment", layer="HID-PLUVIAL", level_id="N1",
        parameters={"nominal_diameter_m": None, "design_slope": None, "discharge_to": None},
        requires_calculation=["nominal_diameter_m", "design_slope", "discharge_to"],
        tags=["pluvial", "salida", "vivienda"],
        op_description=("Salida pluvial desde la caja hacia la calle o el sistema de "
                        "drenaje, que no esta definido."),
        derived_from=["HYP_DRAIN_SLOPE"], flow_direction="caja_hacia_red",
    )
    K.link(model, connection_id="CNX-HID-SUM-01-BAJPLU", discipline="hydrosanitary",
           type="pipe_connection", origin="HID-SUM-01", destination="HID-BAJ-PLU-01",
           medium="tuberia_pvc_sanitario", technology="recoleccion pluvial",
           parameters={}, geometry_reference="SOL-HID-BAJ-PLU-01", length_m=llen,
           flow_direction="sumidero_hacia_bajante",
           requires_calculation=["nominal_diameter_m", "design_flow_lps"])
    K.link(model, connection_id="CNX-HID-BAJPLU-COL", discipline="hydrosanitary",
           type="pipe_connection", origin="HID-BAJ-PLU-01", destination="HID-COL-PLU",
           medium="tuberia_pvc_sanitario", technology="pie de bajante",
           parameters={}, geometry_reference="SOL-HID-COL-PLU", length_m=rlen,
           flow_direction="bajante_hacia_caja", requires_calculation=["nominal_diameter_m"])
    K.link(model, connection_id="CNX-HID-COLPLU-CAJ", discipline="hydrosanitary",
           type="pipe_connection", origin="HID-COL-PLU", destination="HID-CAJ-PLU",
           medium="tuberia_pvc_sanitario", technology="llegada a caja", parameters={},
           flow_direction="colector_hacia_caja", requires_calculation=["nominal_diameter_m"])
    K.link(model, connection_id="CNX-HID-CAJPLU-SAL", discipline="hydrosanitary",
           type="pipe_connection", origin="HID-CAJ-PLU", destination="HID-SAL-PLU",
           medium="tuberia_pvc_sanitario", technology="salida de caja", parameters={},
           geometry_reference="SOL-HID-SAL-PLU", length_m=salen,
           flow_direction="caja_hacia_red", requires_calculation=["nominal_diameter_m"])


def build_residential(model) -> None:
    meter = build_residential_source(model)
    fixtures = build_residential_supply(model, meter)
    build_residential_drainage(model, fixtures)
    build_residential_rainwater(model)


def build(model) -> None:
    if P.is_residential():
        build_residential(model)
        return
    build_source(model)
    fixtures = build_water_distribution(model)
    build_drainage(model, fixtures)
    build_rainwater(model)

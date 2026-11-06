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
from discipline_structure import riser_at, shaft_tech

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
            for f in items:
                fx, fy, fz = f["xyz"]
                # bajada del aparato al plano de desague
                polylines.append([(fx, fy, round(fz - 0.10, 3)), (fx, fy, drain_z)])
                # tramo con pendiente hacia la bajante: la cota de llegada se deduce
                run = R.sloped_run((fx, fy, drain_z), (sx, sy), P.HYP_DRAIN_SLOPE)
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
            run = R.sloped_run((dx, dy, collector_z), (rx, ry), slope)
            path = [drop[0], drop[1], run[1]]
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


def build(model) -> None:
    build_source(model)
    fixtures = build_water_distribution(model)
    build_drainage(model, fixtures)
    build_rainwater(model)

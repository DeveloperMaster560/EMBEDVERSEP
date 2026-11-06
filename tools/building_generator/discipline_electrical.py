"""Paquete electrico conceptual.

QUE CONTIENE DATOS REALES
-------------------------
  * Geometria y recorridos: calculados. Las longitudes de circuito se miden
    sobre la polilinea 3D generada.
  * Topologia: cada circuito declara origen, destino y dispositivos servidos.
  * Potencia conectada: suma aritmetica de las potencias nominales de los
    dispositivos seleccionados como hipotesis (HYP_LUMINAIRE, HYP_OUTLET).
  * Corriente: derivada de P / (V x fp) con el factor de potencia declarado
    HYP_POWER_FACTOR. Es una derivacion aritmetica de hipotesis, NO una
    medicion ni un calculo de diseno verificado.

QUE QUEDA EXPLICITAMENTE PENDIENTE (valor None)
-----------------------------------------------
  * calibre de conductor          requiere calculo de caida de tension,
                                  agrupamiento y temperatura
  * capacidad y curva de proteccion   requiere coordinacion de protecciones
  * tipo de aislamiento           requiere especificacion
  * demanda maxima y factores de demanda
  * resistencia de puesta a tierra
  * niveles de iluminancia

No se asume una unica tension: iluminacion y tomacorrientes se plantean
monofasicos y la fuerza/climatizacion/bombeo trifasicos, segun
HYP_SYSTEM_VOLTAGES.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Sequence, Tuple

import params as P
import routing as R
import solids as S
from catalog import Component, Connection
from discipline_structure import riser_at, shaft_tech, stair_geometry

PANEL_PENDING = ["conductor_gauge", "protection_rating", "protection_curve",
                 "insulation_type", "maximum_demand_kW", "demand_factor"]


def electrical_room():
    """Recinto que aloja el tablero general, localizado por uso.

    El programa de espacios se genera por reglas, asi que el codigo del recinto
    cambia con la solicitud. Se busca por uso y se degrada a un recinto tecnico
    equivalente si el programa no incluye cuarto electrico.
    """
    return P.find_space_any("N1", ("cuarto_electrico", "zona_tecnica", "archivo", "oficina"))


def tg_position():
    """Tablero general contra el muro de fachada del cuarto electrico."""
    entry = electrical_room()
    x0, y0, x1, y1 = P.space_rect_of(entry)
    return (round(x0 + 0.30, 3), round((y0 + y1) / 2.0, 3))


def meter_position():
    """Medidor empotrado en la fachada, a la altura del cuarto electrico."""
    return (round(P.HYP_WALL_EXTERIOR / 2.0, 4), tg_position()[1])


def ts_position():
    """Tablero secundario de piso, junto al ducto tecnico de la circulacion."""
    tx0, ty0, tx1, ty1 = shaft_tech()
    return (round((tx0 + tx1) / 2.0, 3), round(ty1 + 0.35, 3))


def _add(model, comp: Component, solid: Optional[S.Solid], op: Optional[str]) -> Component:
    if solid is not None:
        model.add_solid(solid)
        comp.geometry_reference = solid.solid_id
    if op:
        comp.operations.append(op)
    model.add_component(comp)
    return comp


def _route_solid(sid: str, polylines: Sequence[Sequence[Tuple[float, float, float]]],
                 diameter: float, material: str, level_id: Optional[str],
                 layer: str) -> S.Solid:
    prims: List[S.Primitive] = []
    for pl in polylines:
        prims.extend(S.polyline_pipe(pl, diameter))
    return S.Solid(sid, prims, material, "electrical", level_id, layer)


# ---------------------------------------------------------------------------
# Acometida, medidor y tablero general
# ---------------------------------------------------------------------------


def build_service_entrance(model) -> None:
    sysv = P.HYP_SYSTEM_VOLTAGES["acometida"]
    mx, my = meter_position()
    meter_z = 1.50
    room = electrical_room()

    # --- acometida subterranea desde el lindero ---
    path = [(-3.00, my, -0.80), (mx, my, -0.80), (mx, my, meter_z)]
    sid = "SOL-ELE-ACO-001"
    solid = _route_solid(sid, [path], P.HYP_CONDUIT_DIAMETERS["acometida"],
                         "pvc", None, "ELE-ACOMETIDA")
    length = R.total_length([path])
    op = model.oplog.record(
        "sweep_polyline", "creation",
        ("Acometida electrica subterranea: polilinea de %d tramos desde el lindero "
         "hasta el medidor, longitud %.2f m, canalizacion de %.0f mm.")
        % (len(path) - 1, length, P.HYP_CONDUIT_DIAMETERS["acometida"] * 1000),
        component_id="ELE-ACO-001", solid_id=sid,
        inputs={"path": [list(p) for p in path],
                "conduit_diameter": P.HYP_CONDUIT_DIAMETERS["acometida"]},
        outputs={"length_m": length},
        derived_from=["HYP_CONDUIT_DIAMETERS", "HYP_SYSTEM_VOLTAGES"],
        implementation="solids.polyline_pipe (barridos circulares consecutivos)",
    )
    _add(model, Component(
        component_id="ELE-ACO-001", discipline="electrical", type="service_entrance",
        name="Acometida electrica", level_id="N1", material="cobre",
        ifc_class="IfcCableSegment", position=[-3.00, my, -0.80],
        parameters={
            "nominal_voltage_v": sysv["voltage_v"], "phases": sysv["phases"],
            "system": sysv["system"], "installation": "subterranea en canalizacion",
            "route_length_m": length,
            "conduit_diameter_m": P.HYP_CONDUIT_DIAMETERS["acometida"],
            "conductor_material": "cobre",
            "conductor_gauge": None, "insulation_type": None,
            "maximum_demand_kW": None, "short_circuit_current_kA": None,
            "utility_coordination": None,
        },
        requires_calculation=["conductor_gauge", "insulation_type", "maximum_demand_kW",
                              "short_circuit_current_kA", "utility_coordination"],
        provenance="hypothesis", tags=["electrico", "acometida"],
        validation_notes=["Punto de entrega y demanda contratada no definidos."],
    ), solid, op)

    # --- medidor ---
    sid = "SOL-ELE-MED-001"
    solid = S.Solid(sid, [S.box_prism(mx - 0.10, my - 0.25, mx + 0.10, my + 0.25,
                                      meter_z - 0.25, meter_z + 0.25)],
                    "equipo_generico", "electrical", "N1", "ELE-EQUIPOS")
    op = model.oplog.record(
        "extrude", "creation", "Medidor de energia empotrado en fachada oeste a %.2f m." % meter_z,
        component_id="ELE-MED-001", solid_id=sid,
        inputs={"position": [mx, my, meter_z], "box": [0.20, 0.50, 0.50]},
        outputs={}, derived_from=["HYP_SYSTEM_VOLTAGES"],
        implementation="solids.Prism",
    )
    _add(model, Component(
        component_id="ELE-MED-001", discipline="electrical", type="meter",
        name="Medidor de energia", level_id="N1", material="equipo_generico",
        ifc_class="IfcElectricDistributionBoard", position=[mx, my, meter_z],
        dimensions={"width": 0.20, "depth": 0.50, "height": 0.50},
        parameters={"nominal_voltage_v": sysv["voltage_v"], "phases": sysv["phases"],
                    "system": sysv["system"], "meter_type": None,
                    "rated_current_a": None, "ct_ratio": None},
        requires_calculation=["meter_type", "rated_current_a", "ct_ratio"],
        provenance="hypothesis", tags=["electrico", "medicion"],
    ), solid, op)

    # --- tablero general ---
    tx, ty = tg_position()
    sid = "SOL-ELE-TAB-TG"
    solid = S.Solid(sid, [S.box_prism(tx - 0.10, ty - 0.40, tx + 0.10, ty + 0.40, 1.00, 1.90)],
                    "equipo_generico", "electrical", "N1", "ELE-TABLEROS")
    op = model.oplog.record(
        "extrude", "creation",
        "Tablero general en el cuarto electrico (recinto %s), 0.80 x 0.90 m de frente."
        % P.space_code(room),
        component_id="ELE-TAB-TG", solid_id=sid,
        inputs={"position": [tx, ty, 1.00], "box": [0.20, 0.80, 0.90], "room": P.space_code(room)},
        outputs={}, derived_from=["SPACE_PROGRAM", "HYP_SYSTEM_VOLTAGES"],
        implementation="solids.Prism",
    )
    _add(model, Component(
        component_id="ELE-TAB-TG", discipline="electrical", type="main_distribution_board",
        name="Tablero general", level_id="N1", space_id="ARQ-ESP-%s" % P.space_code(room),
        material="equipo_generico", ifc_class="IfcElectricDistributionBoard",
        position=[tx, ty, 1.00], dimensions={"width": 0.20, "depth": 0.80, "height": 0.90},
        parameters={
            "nominal_voltage_v": sysv["voltage_v"], "phases": sysv["phases"],
            "system": sysv["system"], "enclosure_rating": None,
            "main_breaker_rating_a": None, "bus_rating_a": None,
            "short_circuit_rating_kA": None, "maximum_demand_kW": None,
            "connected_power_W": None,
        },
        requires_calculation=["enclosure_rating", "main_breaker_rating_a", "bus_rating_a",
                              "short_circuit_rating_kA", "maximum_demand_kW"],
        provenance="hypothesis", tags=["electrico", "tablero"],
    ), solid, op)

    model.add_connection(Connection(
        connection_id="CNX-ELE-ACO-MED", discipline="electrical", type="power_feed",
        origin="ELE-ACO-001", destination="ELE-MED-001",
        medium="conductor_cobre_en_canalizacion", technology="acometida %s" % sysv["system"],
        parameters={"nominal_voltage_v": sysv["voltage_v"], "phases": sysv["phases"],
                    "conductor_gauge": None, "protection_rating": None},
        length_m=length, flow_direction="red_hacia_medidor",
        requires_calculation=["conductor_gauge", "protection_rating"], provenance="hypothesis",
    ))

    # --- alimentador medidor -> tablero general ---
    path = R.manhattan((mx, my, meter_z), (tx, ty, 1.90), 2.40)
    sid = "SOL-ELE-ALI-TG"
    solid = _route_solid(sid, [path], P.HYP_CONDUIT_DIAMETERS["alimentador"],
                         "cobre", "N1", "ELE-ALIMENTADORES")
    flen = R.total_length([path])
    op = model.oplog.record(
        "sweep_polyline", "creation",
        "Alimentador medidor-tablero general, longitud %.2f m." % flen,
        component_id="ELE-ALI-TG", solid_id=sid,
        inputs={"path": [list(p) for p in path]}, outputs={"length_m": flen},
        derived_from=["HYP_CONDUIT_DIAMETERS"],
        implementation="routing.manhattan + solids.polyline_pipe",
    )
    _add(model, Component(
        component_id="ELE-ALI-TG", discipline="electrical", type="feeder",
        name="Alimentador al tablero general", level_id="N1", material="cobre",
        ifc_class="IfcCableSegment", position=list(path[0]),
        parameters={"nominal_voltage_v": sysv["voltage_v"], "phases": sysv["phases"],
                    "system": sysv["system"], "route_length_m": flen,
                    "conduit_diameter_m": P.HYP_CONDUIT_DIAMETERS["alimentador"],
                    "conductor_material": "cobre", "conductor_gauge": None,
                    "insulation_type": None, "protection_rating": None,
                    "voltage_drop_percent": None},
        requires_calculation=["conductor_gauge", "insulation_type", "protection_rating",
                              "voltage_drop_percent"],
        provenance="derived", tags=["electrico", "alimentador"],
    ), solid, op)
    model.add_connection(Connection(
        connection_id="CNX-ELE-MED-TG", discipline="electrical", type="power_feed",
        origin="ELE-MED-001", destination="ELE-TAB-TG",
        medium="conductor_cobre_en_canalizacion", technology="alimentador %s" % sysv["system"],
        parameters={"nominal_voltage_v": sysv["voltage_v"], "phases": sysv["phases"],
                    "conductor_gauge": None, "protection_rating": None},
        geometry_reference=sid, length_m=flen, flow_direction="medidor_hacia_tablero",
        requires_calculation=["conductor_gauge", "protection_rating"], provenance="derived",
    ))


# ---------------------------------------------------------------------------
# Tableros secundarios y montante
# ---------------------------------------------------------------------------


def build_subpanels(model) -> None:
    sysv = P.HYP_SYSTEM_VOLTAGES["acometida"]
    rx, ry = riser_at("electrical")
    tx, ty = ts_position()

    # Montante vertical en el ducto tecnico, desde N1 hasta cubierta.
    path = R.riser(rx, ry, 0.30, P.ROOF_LEVEL["elevation"])
    sid = "SOL-ELE-MON-001"
    solid = _route_solid(sid, [path], P.HYP_CONDUIT_DIAMETERS["alimentador"],
                         "cobre", None, "ELE-ALIMENTADORES")
    mlen = R.total_length([path])
    op = model.oplog.record(
        "sweep_polyline", "creation",
        "Montante electrico en el ducto tecnico, de cota 0.30 a %.2f m (%.2f m)."
        % (P.ROOF_LEVEL["elevation"], mlen),
        component_id="ELE-MON-001", solid_id=sid,
        inputs={"position": [rx, ry], "z0": 0.30, "z1": P.ROOF_LEVEL["elevation"]},
        outputs={"length_m": mlen},
        derived_from=["HYP_CORRIDOR_WIDTH", "HYP_CONDUIT_DIAMETERS"],
        implementation="routing.riser + solids.polyline_pipe",
    )
    _add(model, Component(
        component_id="ELE-MON-001", discipline="electrical", type="riser",
        name="Montante electrico", level_id=None, material="cobre",
        ifc_class="IfcCableSegment", position=[rx, ry, 0.30],
        parameters={"nominal_voltage_v": sysv["voltage_v"], "phases": sysv["phases"],
                    "system": sysv["system"], "route_length_m": mlen,
                    "shaft": "ducto tecnico del anillo de circulacion",
                    "conductor_material": "cobre", "conductor_gauge": None,
                    "insulation_type": None, "protection_rating": None},
        requires_calculation=["conductor_gauge", "insulation_type", "protection_rating"],
        provenance="derived", tags=["electrico", "montante"],
    ), solid, op)

    # Alimentador TG -> montante
    tgx, tgy = tg_position()
    tg_path = R.manhattan((tgx, tgy, 1.90), (rx, ry, 0.30), 2.60)
    sid = "SOL-ELE-ALI-MON"
    solid = _route_solid(sid, [tg_path], P.HYP_CONDUIT_DIAMETERS["alimentador"],
                         "cobre", "N1", "ELE-ALIMENTADORES")
    tlen = R.total_length([tg_path])
    op = model.oplog.record(
        "sweep_polyline", "creation",
        "Alimentador del tablero general al montante, longitud %.2f m." % tlen,
        component_id="ELE-ALI-MON", solid_id=sid,
        inputs={"path": [list(p) for p in tg_path]}, outputs={"length_m": tlen},
        derived_from=["HYP_CONDUIT_DIAMETERS"],
        implementation="routing.manhattan + solids.polyline_pipe",
    )
    _add(model, Component(
        component_id="ELE-ALI-MON", discipline="electrical", type="feeder",
        name="Alimentador tablero general a montante", level_id="N1", material="cobre",
        ifc_class="IfcCableSegment", position=list(tg_path[0]),
        parameters={"nominal_voltage_v": sysv["voltage_v"], "phases": sysv["phases"],
                    "route_length_m": tlen, "conductor_material": "cobre",
                    "conductor_gauge": None, "protection_rating": None,
                    "voltage_drop_percent": None},
        requires_calculation=["conductor_gauge", "protection_rating", "voltage_drop_percent"],
        provenance="derived", tags=["electrico", "alimentador"],
    ), solid, op)
    model.add_connection(Connection(
        connection_id="CNX-ELE-TG-MON", discipline="electrical", type="power_feed",
        origin="ELE-TAB-TG", destination="ELE-MON-001",
        medium="conductor_cobre_en_canalizacion", technology="alimentador vertical",
        parameters={"nominal_voltage_v": sysv["voltage_v"], "phases": sysv["phases"],
                    "conductor_gauge": None, "protection_rating": None},
        geometry_reference=sid, length_m=tlen, flow_direction="tablero_hacia_montante",
        requires_calculation=["conductor_gauge", "protection_rating"], provenance="derived",
    ))

    for level in P.LEVELS:
        lid = level["level_id"]
        e = level["elevation"]
        z0 = round(e + 1.00, 3)
        cid = "ELE-TAB-TS-%s" % lid
        sid = "SOL-%s" % cid
        solid = S.Solid(sid, [S.box_prism(tx - 0.08, ty - 0.30, tx + 0.08, ty + 0.30,
                                          z0, round(z0 + 0.70, 3))],
                        "equipo_generico", "electrical", lid, "ELE-TABLEROS")
        op = model.oplog.record(
            "extrude", "creation",
            "Tablero secundario del %s junto al ducto tecnico, frente 0.60 x 0.70 m." % lid,
            component_id=cid, solid_id=sid,
            inputs={"position": [tx, ty, z0], "box": [0.16, 0.60, 0.70]},
            outputs={}, derived_from=["HYP_CORRIDOR_WIDTH", "HYP_SYSTEM_VOLTAGES"],
            implementation="solids.Prism",
        )
        _add(model, Component(
            component_id=cid, discipline="electrical", type="distribution_board",
            name="Tablero secundario %s" % lid, level_id=lid,
            space_id="ARQ-ESP-%sCIRC" % lid, material="equipo_generico",
            ifc_class="IfcElectricDistributionBoard", position=[tx, ty, z0],
            dimensions={"width": 0.16, "depth": 0.60, "height": 0.70},
            parameters={
                "nominal_voltage_v": sysv["voltage_v"], "phases": sysv["phases"],
                "system": sysv["system"], "served_level": lid,
                "enclosure_rating": None, "main_breaker_rating_a": None,
                "circuit_ways": None, "connected_power_W": None,
                "maximum_demand_kW": None, "demand_factor": None,
            },
            requires_calculation=["enclosure_rating", "main_breaker_rating_a", "circuit_ways",
                                  "maximum_demand_kW", "demand_factor"],
            provenance="hypothesis", tags=["electrico", "tablero"],
        ), solid, op)

        # derivacion del montante al tablero secundario
        dpath = R.manhattan((rx, ry, round(z0 + 0.35, 3)), (tx, ty, round(z0 + 0.35, 3)),
                            round(z0 + 0.35, 3))
        fid = "ELE-ALI-%s" % lid
        fsid = "SOL-%s" % fid
        fsolid = _route_solid(fsid, [dpath], P.HYP_CONDUIT_DIAMETERS["alimentador"],
                              "cobre", lid, "ELE-ALIMENTADORES")
        dlen = R.total_length([dpath])
        fop = model.oplog.record(
            "sweep_polyline", "creation",
            "Derivacion del montante al tablero secundario del %s (%.2f m)." % (lid, dlen),
            component_id=fid, solid_id=fsid,
            inputs={"path": [list(p) for p in dpath]}, outputs={"length_m": dlen},
            derived_from=["SPACE_PROGRAM", "HYP_CORRIDOR_WIDTH"],
            implementation="routing.manhattan + solids.polyline_pipe",
        )
        _add(model, Component(
            component_id=fid, discipline="electrical", type="feeder",
            name="Alimentador al tablero secundario %s" % lid, level_id=lid,
            material="cobre", ifc_class="IfcCableSegment", position=list(dpath[0]),
            parameters={"nominal_voltage_v": sysv["voltage_v"], "phases": sysv["phases"],
                        "route_length_m": dlen, "conductor_material": "cobre",
                        "conductor_gauge": None, "protection_rating": None},
            requires_calculation=["conductor_gauge", "protection_rating"],
            provenance="derived", tags=["electrico", "alimentador"],
        ), fsolid, fop)
        model.add_connection(Connection(
            connection_id="CNX-ELE-MON-%s" % lid, discipline="electrical", type="power_feed",
            origin="ELE-MON-001", destination=cid,
            medium="conductor_cobre_en_canalizacion", technology="derivacion de montante",
            parameters={"nominal_voltage_v": sysv["voltage_v"], "phases": sysv["phases"],
                        "conductor_gauge": None, "protection_rating": None},
            geometry_reference=fsid, length_m=dlen, flow_direction="montante_hacia_tablero",
            requires_calculation=["conductor_gauge", "protection_rating"], provenance="derived",
        ))


# ---------------------------------------------------------------------------
# Luminarias e interruptores
# ---------------------------------------------------------------------------


def _space_list(model, lid: str):
    """Recintos del nivel ordenados, incluyendo circulacion y nucleo."""
    return sorted(model.spaces_of_level(lid), key=lambda s: s.code)


def build_lighting(model) -> Dict[str, List[Dict[str, Any]]]:
    """Crea luminarias e interruptores. Devuelve los puntos por nivel."""
    per_level: Dict[str, List[Dict[str, Any]]] = {}
    lum = P.HYP_LUMINAIRE
    sysv = P.HYP_SYSTEM_VOLTAGES["iluminacion"]

    for level in P.LEVELS:
        lid = level["level_id"]
        e = level["elevation"]
        cz = R.ceiling_z(level)
        points: List[Dict[str, Any]] = []

        for sp in _space_list(model, lid):
            n = max(1, int(math.ceil(sp.area_m2 / lum["area_per_luminaire_m2"])))
            if sp.shape == "ring":
                # la circulacion se reparte en el perimetro del anillo
                pts = [(x, y) for x, y, _ in R.perimeter_points(
                    [P.RING_X0 + 0.9, P.RING_Y0 + 0.9, P.RING_X1 - 0.9, P.RING_Y1 - 0.9],
                    spacing=3.0, inset=0.0, start_offset=0.5)]
                n = len(pts)
            elif sp.use == "escalera":
                # En el nucleo la escalera ocupa la zona central y sube por
                # encima del cielo raso: las luminarias van en las franjas
                # laterales libres, no sobre los tramos.
                g = stair_geometry()
                pts = [(round((sp.rect[0] + g["xa0"]) / 2, 3), round(sp.rect[1] + 1.40, 3)),
                       (round((sp.rect[0] + g["xa0"]) / 2, 3), round(sp.rect[3] - 1.40, 3)),
                       (round((sp.rect[2] + g["xb1"]) / 2, 3), round(sp.rect[1] + 1.40, 3)),
                       (round((sp.rect[2] + g["xb1"]) / 2, 3), round(sp.rect[3] - 1.40, 3))]
                n = len(pts)
            else:
                pts = R.grid_in_rect(sp.rect, n, margin=0.80)

            for k, (px, py) in enumerate(pts, start=1):
                cid = "ELE-LUM-%s-%s-%02d" % (lid, sp.code, k)
                sid = "SOL-%s" % cid
                solid = S.Solid(
                    sid, [S.box_prism(px - 0.30, py - 0.30, px + 0.30, py + 0.30,
                                      round(cz - 0.07, 4), cz)],
                    "luminaria", "electrical", lid, "ELE-ILUMINACION")
                op = model.oplog.record(
                    "extrude", "creation",
                    ("Luminaria %s en el recinto %s: panel 0.60x0.60 a cota de cielo raso %.2f. "
                     "Reparto geometrico de %d unidades para %.2f m2 a razon de %.1f m2/unidad.")
                    % (cid, sp.code, cz, n, sp.area_m2, lum["area_per_luminaire_m2"]),
                    component_id=cid, solid_id=sid,
                    inputs={"space": sp.space_id, "position": [px, py, cz],
                            "area_m2": sp.area_m2, "units": n,
                            "criterion_m2_per_unit": lum["area_per_luminaire_m2"]},
                    outputs={"nominal_power_w": lum["nominal_power_w"]},
                    derived_from=["HYP_LUMINAIRE", "HYP_CEILING_HEIGHT", "SPACE_PROGRAM"],
                    implementation="routing.grid_in_rect + solids.Prism",
                )
                _add(model, Component(
                    component_id=cid, discipline="electrical", type="luminaire",
                    name="Luminaria %s-%02d" % (sp.code, k), level_id=lid,
                    space_id=sp.space_id, material="luminaria", ifc_class="IfcLightFixture",
                    position=[px, py, cz], dimensions={"width": 0.60, "depth": 0.60, "height": 0.07},
                    parameters={
                        "model_reference": lum["model_ref"],
                        "nominal_power_w": lum["nominal_power_w"],
                        "nominal_voltage_v": lum["nominal_voltage_v"],
                        "phases": sysv["phases"], "system": sysv["system"],
                        "mounting": "empotrada en cielo raso",
                        "luminous_flux_lm": None, "efficacy_lm_W": None,
                        "illuminance_contribution_lux": None, "cri": None,
                        "photometric_file": None,
                    },
                    requires_calculation=["luminous_flux_lm", "efficacy_lm_W",
                                          "illuminance_contribution_lux", "cri",
                                          "photometric_file"],
                    provenance="hypothesis", tags=["electrico", "iluminacion"],
                ), solid, op)
                model.relate(cid, "serves_space", sp.space_id)
                points.append({"component_id": cid, "xyz": (px, py, cz),
                               "space": sp.space_id, "code": sp.code,
                               "power_w": lum["nominal_power_w"]})

            # interruptor del recinto junto a su puerta
            swx, swy = _switch_position(sp)
            cid = "ELE-INT-%s-%s" % (lid, sp.code)
            sid = "SOL-%s" % cid
            solid = S.Solid(sid, [S.box_prism(swx - 0.04, swy - 0.04, swx + 0.04, swy + 0.04,
                                              round(e + 1.14, 3), round(e + 1.26, 3))],
                            "equipo_generico", "electrical", lid, "ELE-ILUMINACION")
            op = model.oplog.record(
                "extrude", "creation",
                "Interruptor de %s a 1.20 m sobre piso, junto al acceso del recinto." % sp.code,
                component_id=cid, solid_id=sid,
                inputs={"space": sp.space_id, "position": [swx, swy, round(e + 1.20, 3)]},
                outputs={"controlled_luminaires": len(pts)},
                derived_from=["SPACE_PROGRAM"], implementation="solids.Prism",
            )
            _add(model, Component(
                component_id=cid, discipline="electrical", type="switch",
                name="Interruptor %s" % sp.code, level_id=lid, space_id=sp.space_id,
                material="equipo_generico", ifc_class="IfcSwitchingDevice",
                position=[swx, swy, round(e + 1.20, 3)],
                parameters={"nominal_voltage_v": sysv["voltage_v"], "phases": sysv["phases"],
                            "mounting_height_m": 1.20,
                            "controlled_luminaires": len(pts),
                            "gang_count": None, "device_rating_a": None,
                            "accessibility_check": None},
                requires_calculation=["gang_count", "device_rating_a", "accessibility_check"],
                provenance="hypothesis", tags=["electrico", "iluminacion", "control"],
            ), solid, op)
            model.relate(cid, "controls_space", sp.space_id)

        per_level[lid] = points
    return per_level


def _switch_position(sp) -> Tuple[float, float]:
    x0, y0, x1, y1 = sp.rect
    return (round(x0 + 0.35, 4), round(y0 + 0.20, 4))


# ---------------------------------------------------------------------------
# Tomacorrientes
# ---------------------------------------------------------------------------


OUTLET_COUNT_BY_USE = {
    "bano": 1, "aseo": 1, "escalera": 1, "circulacion": 4,
    "cuarto_electrico": 2, "cuarto_telecom": 4, "cuarto_hvac": 2,
    "zona_tecnica": 3, "archivo": 2,
}


def build_outlets(model) -> Dict[str, List[Dict[str, Any]]]:
    per_level: Dict[str, List[Dict[str, Any]]] = {}
    out_cfg = P.HYP_OUTLET
    sysv = P.HYP_SYSTEM_VOLTAGES["tomacorrientes"]

    for level in P.LEVELS:
        lid = level["level_id"]
        e = level["elevation"]
        pts_level: List[Dict[str, Any]] = []
        for sp in _space_list(model, lid):
            cap = OUTLET_COUNT_BY_USE.get(sp.use)
            if sp.shape == "ring":
                candidates = R.perimeter_points(
                    [P.RING_X0 + 0.3, P.RING_Y0 + 0.3, P.RING_X1 - 0.3, P.RING_Y1 - 0.3],
                    spacing=8.0, inset=0.0, start_offset=1.0)
            else:
                candidates = R.perimeter_points(sp.rect, spacing=out_cfg["spacing_m"])
            if cap is not None:
                step = max(1, len(candidates) // cap) if candidates else 1
                candidates = candidates[::step][:cap]
            else:
                candidates = candidates[:6]
            if not candidates:
                cx = round((sp.rect[0] + sp.rect[2]) / 2, 4)
                cy = round(sp.rect[1] + 0.15, 4)
                candidates = [(cx, cy, "S")]

            for k, (px, py, face) in enumerate(candidates, start=1):
                cid = "ELE-TOM-%s-%s-%02d" % (lid, sp.code, k)
                sid = "SOL-%s" % cid
                z = round(e + 0.40, 3)
                solid = S.Solid(sid, [S.box_prism(px - 0.06, py - 0.04, px + 0.06, py + 0.04,
                                                  z - 0.06, z + 0.06)],
                                "equipo_generico", "electrical", lid, "ELE-TOMACORRIENTES")
                op = model.oplog.record(
                    "extrude", "creation",
                    ("Tomacorriente %s en el recinto %s, cara %s, a 0.40 m sobre piso. "
                     "Reparto perimetral cada %.1f m.")
                    % (cid, sp.code, face, out_cfg["spacing_m"]),
                    component_id=cid, solid_id=sid,
                    inputs={"space": sp.space_id, "position": [px, py, z], "wall_face": face,
                            "spacing_criterion_m": out_cfg["spacing_m"]},
                    outputs={"declared_demand_w": out_cfg["declared_demand_w"]},
                    derived_from=["HYP_OUTLET", "SPACE_PROGRAM"],
                    implementation="routing.perimeter_points + solids.Prism",
                )
                _add(model, Component(
                    component_id=cid, discipline="electrical", type="socket_outlet",
                    name="Tomacorriente %s-%02d" % (sp.code, k), level_id=lid,
                    space_id=sp.space_id, material="equipo_generico",
                    ifc_class="IfcOutlet", position=[px, py, z],
                    parameters={
                        "model_reference": out_cfg["model_ref"],
                        "nominal_voltage_v": out_cfg["nominal_voltage_v"],
                        "phases": sysv["phases"], "system": sysv["system"],
                        "declared_demand_w": out_cfg["declared_demand_w"],
                        "mounting_height_m": 0.40, "wall_face": face,
                        "has_ground_pin": True,
                        "device_rating_a": None, "gfci_required": None,
                        "actual_load_w": None,
                    },
                    requires_calculation=["device_rating_a", "gfci_required", "actual_load_w"],
                    provenance="hypothesis", tags=["electrico", "tomacorriente"],
                ), solid, op)
                model.relate(cid, "serves_space", sp.space_id)
                pts_level.append({"component_id": cid, "xyz": (px, py, z),
                                  "space": sp.space_id, "code": sp.code,
                                  "power_w": out_cfg["declared_demand_w"]})
        per_level[lid] = pts_level
    return per_level


# ---------------------------------------------------------------------------
# Circuitos ramales
# ---------------------------------------------------------------------------


def build_circuits(
    model, lighting: Dict[str, List[Dict[str, Any]]], outlets: Dict[str, List[Dict[str, Any]]],
) -> None:
    counter = 0
    for level in P.LEVELS:
        lid = level["level_id"]
        via = R.plenum_z(level, "electrical")
        panel = "ELE-TAB-TS-%s" % lid
        panel_xyz = (ts_position()[0], ts_position()[1], round(level["elevation"] + 1.35, 3))

        for kind, points, sysname in (
            ("iluminacion", lighting[lid], "iluminacion"),
            ("tomacorrientes", outlets[lid], "tomacorrientes"),
        ):
            sysv = P.HYP_SYSTEM_VOLTAGES[sysname]
            groups = _group_points(points, P.HYP_MAX_POINTS_PER_CIRCUIT)
            for gi, group in enumerate(groups, start=1):
                counter += 1
                cid = "ELE-CIR-%03d" % counter
                sid = "SOL-%s" % cid
                devices = [g["xyz"] for g in group]
                polylines = R.trunk_and_drops(panel_xyz, devices, via)
                length = R.total_length(polylines)
                solid = _route_solid(sid, polylines,
                                     P.HYP_CONDUIT_DIAMETERS["circuito_ramal"],
                                     "cobre", lid, "ELE-CIRCUITOS")
                connected_w = round(sum(g["power_w"] for g in group), 2)
                voltage = sysv["voltage_v"]
                if sysv["phases"] == 1:
                    current = round(connected_w / (voltage * P.HYP_POWER_FACTOR), 3)
                else:
                    current = round(connected_w / (math.sqrt(3) * voltage * P.HYP_POWER_FACTOR), 3)

                op = model.oplog.record(
                    "sweep_polyline", "creation",
                    ("Circuito %s de %s en %s: troncal por el vacio tecnico a cota %.2f mas "
                     "bajada a %d dispositivos. Longitud medida sobre la polilinea: %.2f m.")
                    % (cid, kind, lid, via, len(group), length),
                    component_id=cid, solid_id=sid,
                    inputs={"panel": panel, "panel_position": list(panel_xyz),
                            "device_count": len(group),
                            "devices": [g["component_id"] for g in group],
                            "routing_z": via,
                            "conduit_diameter": P.HYP_CONDUIT_DIAMETERS["circuito_ramal"],
                            "max_points_per_circuit": P.HYP_MAX_POINTS_PER_CIRCUIT},
                    outputs={"route_length_m": length, "connected_power_w": connected_w,
                             "derived_current_a": current,
                             "current_formula": ("P/(V*fp)" if sysv["phases"] == 1
                                                 else "P/(sqrt(3)*V*fp)"),
                             "power_factor_assumed": P.HYP_POWER_FACTOR},
                    derived_from=["HYP_SYSTEM_VOLTAGES", "HYP_POWER_FACTOR",
                                  "HYP_MAX_POINTS_PER_CIRCUIT", "HYP_CONDUIT_DIAMETERS",
                                  "HYP_PLENUM_ROUTING_Z"],
                    implementation="routing.trunk_and_drops + solids.polyline_pipe",
                )
                comp = Component(
                    component_id=cid, discipline="electrical", type="circuit",
                    name="Circuito de %s %s-%02d" % (kind, lid, gi), level_id=lid,
                    material="cobre", ifc_class="IfcElectricDistributionBoard",
                    position=list(panel_xyz),
                    parameters={
                        "circuit_kind": kind,
                        "nominal_voltage_v": voltage,
                        "phases": sysv["phases"], "system": sysv["system"],
                        "connected_power_w": connected_w,
                        "derived_current_a": current,
                        "current_derivation": ("P/(V*fp)" if sysv["phases"] == 1
                                               else "P/(sqrt(3)*V*fp)"),
                        "power_factor_assumed": P.HYP_POWER_FACTOR,
                        "point_count": len(group),
                        "conductor_material": "cobre",
                        "conductor_gauge": None,
                        "insulation_type": None,
                        "conduit": "canalizacion de %.0f mm" % (
                            P.HYP_CONDUIT_DIAMETERS["circuito_ramal"] * 1000),
                        "conduit_diameter_m": P.HYP_CONDUIT_DIAMETERS["circuito_ramal"],
                        "route_length_m": length,
                        "protection_rating": None,
                        "protection_curve": None,
                        "voltage_drop_percent": None,
                        "origin": panel,
                        "destination": [g["component_id"] for g in group],
                    },
                    requires_calculation=["conductor_gauge", "insulation_type",
                                          "protection_rating", "protection_curve",
                                          "voltage_drop_percent"],
                    provenance="derived", tags=["electrico", "circuito", kind],
                    validation_notes=[
                        "Potencia conectada = suma de potencias nominales declaradas como hipotesis.",
                        "Corriente derivada con factor de potencia supuesto %.2f; no es medicion."
                        % P.HYP_POWER_FACTOR,
                    ],
                )
                _add(model, comp, solid, op)
                model.relate(cid, "fed_from", panel)
                model.add_connection(Connection(
                    connection_id="CNX-%s-PANEL" % cid, discipline="electrical",
                    type="branch_circuit", origin=panel, destination=cid,
                    medium="conductor_cobre_en_canalizacion",
                    technology="circuito ramal %s" % sysv["system"],
                    parameters={"nominal_voltage_v": voltage, "phases": sysv["phases"],
                                "connected_power_w": connected_w,
                                "derived_current_a": current,
                                "conductor_gauge": None, "protection_rating": None},
                    geometry_reference=sid, length_m=length,
                    flow_direction="tablero_hacia_dispositivos",
                    requires_calculation=["conductor_gauge", "protection_rating"],
                    provenance="derived",
                ))
                for g in group:
                    model.relate(cid, "serves_device", g["component_id"])
                    model.add_connection(Connection(
                        connection_id="CNX-%s-%s" % (cid, g["component_id"].split("-")[-1] + "-"
                                                     + g["code"]),
                        discipline="electrical", type="device_connection",
                        origin=cid, destination=g["component_id"],
                        medium="conductor_cobre_en_canalizacion", technology="derivacion",
                        parameters={"nominal_voltage_v": voltage,
                                    "declared_power_w": g["power_w"],
                                    "conductor_gauge": None},
                        flow_direction="circuito_hacia_dispositivo",
                        requires_calculation=["conductor_gauge"], provenance="derived",
                    ))


def _group_points(points: Sequence[Dict[str, Any]], max_size: int) -> List[List[Dict[str, Any]]]:
    """Agrupa dispositivos en circuitos respetando el maximo y la proximidad."""
    ordered = sorted(points, key=lambda p: (p["code"], p["component_id"]))
    return [list(ordered[i:i + max_size]) for i in range(0, len(ordered), max_size)]


# ---------------------------------------------------------------------------
# Bandeja portacables y puesta a tierra
# ---------------------------------------------------------------------------


def build_cable_tray(model) -> None:
    tw, th = P.HYP_CABLE_TRAY["width"], P.HYP_CABLE_TRAY["height"]
    for level in P.LEVELS:
        lid = level["level_id"]
        z = R.plenum_z(level, "electrical")
        # anillo rectangular por el eje de la circulacion
        mx0 = round(P.RING_X0 + P.HYP_CORRIDOR_WIDTH / 2, 3)
        mx1 = round(P.RING_X1 - P.HYP_CORRIDOR_WIDTH / 2, 3)
        my0 = round(P.RING_Y0 + P.HYP_CORRIDOR_WIDTH / 2, 3)
        my1 = round(P.RING_Y1 - P.HYP_CORRIDOR_WIDTH / 2, 3)
        ring = [(mx0, my0, z), (mx1, my0, z), (mx1, my1, z), (mx0, my1, z), (mx0, my0, z)]
        cid = "ELE-BAN-%s" % lid
        sid = "SOL-%s" % cid
        prims = S.polyline_duct(ring, tw, th)
        solid = S.Solid(sid, prims, "acero_galvanizado", "electrical", lid, "ELE-CANALIZACIONES")
        length = R.total_length([ring])
        op = model.oplog.record(
            "sweep_polyline", "creation",
            ("Bandeja portacables del %s: anillo de %.2f m por el eje de la circulacion, "
             "seccion %.2f x %.2f m, a cota %.2f.") % (lid, length, tw, th, z),
            component_id=cid, solid_id=sid,
            inputs={"path": [list(p) for p in ring], "section": [tw, th], "z": z},
            outputs={"length_m": length},
            derived_from=["HYP_CABLE_TRAY", "HYP_CORRIDOR_WIDTH", "HYP_PLENUM_ROUTING_Z"],
            implementation="solids.polyline_duct (barridos rectangulares)",
        )
        _add(model, Component(
            component_id=cid, discipline="electrical", type="cable_tray",
            name="Bandeja portacables %s" % lid, level_id=lid,
            space_id="ARQ-ESP-%sCIRC" % lid, material="acero_galvanizado",
            ifc_class="IfcCableCarrierSegment", position=list(ring[0]),
            dimensions={"width": tw, "height": th, "length": length},
            parameters={"section_m": [tw, th], "route_length_m": length,
                        "elevation_m": z, "support_spacing_m": None,
                        "fill_ratio": None, "load_capacity": None},
            requires_calculation=["support_spacing_m", "fill_ratio", "load_capacity"],
            provenance="hypothesis", tags=["electrico", "canalizacion"],
        ), solid, op)


def build_grounding(model) -> None:
    electrodes = [(-1.20, 3.00), (-1.20, 6.00), (-1.20, 9.00)]
    ids: List[str] = []
    for k, (ex, ey) in enumerate(electrodes, start=1):
        cid = "ELE-PAT-ELE-%02d" % k
        sid = "SOL-%s" % cid
        solid = S.Solid(sid, [S.pipe((ex, ey, -0.60), (ex, ey, -3.00), 0.016)],
                        "cobre", "electrical", None, "ELE-TIERRA")
        op = model.oplog.record(
            "sweep_polyline", "creation",
            "Electrodo de puesta a tierra %d: varilla vertical de 2.40 m enterrada." % k,
            component_id=cid, solid_id=sid,
            inputs={"position": [ex, ey], "z0": -0.60, "z1": -3.00, "diameter": 0.016},
            outputs={"length_m": 2.40},
            derived_from=[], implementation="solids.pipe (barrido circular vertical)",
        )
        _add(model, Component(
            component_id=cid, discipline="electrical", type="grounding_electrode",
            name="Electrodo de tierra %d" % k, level_id=None, material="cobre",
            ifc_class="IfcDistributionElement", position=[ex, ey, -0.60],
            dimensions={"length": 2.40, "diameter": 0.016},
            parameters={"length_m": 2.40, "diameter_m": 0.016, "burial_depth_m": 0.60,
                        "soil_resistivity_ohm_m": None, "measured_resistance_ohm": None,
                        "target_resistance_ohm": None},
            requires_calculation=["soil_resistivity_ohm_m", "measured_resistance_ohm",
                                  "target_resistance_ohm"],
            provenance="hypothesis", tags=["electrico", "tierra"],
            validation_notes=["La resistencia de puesta a tierra solo se establece por medicion."],
        ), solid, op)
        ids.append(cid)

    path = [(electrodes[0][0], electrodes[0][1], -0.60)]
    for ex, ey in electrodes[1:]:
        path.append((ex, ey, -0.60))
    tgx, tgy = tg_position()
    path.append((tgx, tgy, -0.60))
    path.append((tgx, tgy, 1.00))
    cid = "ELE-PAT-COND-001"
    sid = "SOL-%s" % cid
    solid = _route_solid(sid, [path], 0.012, "cobre", None, "ELE-TIERRA")
    length = R.total_length([path])
    op = model.oplog.record(
        "sweep_polyline", "creation",
        "Conductor de puesta a tierra que une los %d electrodos con el tablero general (%.2f m)."
        % (len(electrodes), length),
        component_id=cid, solid_id=sid,
        inputs={"path": [list(p) for p in path], "electrodes": ids},
        outputs={"length_m": length}, derived_from=["SPACE_PROGRAM"],
        implementation="solids.polyline_pipe",
    )
    _add(model, Component(
        component_id=cid, discipline="electrical", type="grounding_conductor",
        name="Conductor de puesta a tierra", level_id=None, material="cobre",
        ifc_class="IfcCableSegment", position=list(path[0]),
        parameters={"route_length_m": length, "conductor_material": "cobre",
                    "conductor_gauge": None, "connection_method": None,
                    "measured_resistance_ohm": None},
        requires_calculation=["conductor_gauge", "connection_method", "measured_resistance_ohm"],
        provenance="derived", tags=["electrico", "tierra"],
    ), solid, op)
    for eid in ids:
        model.relate(cid, "bonds", eid)
        model.add_connection(Connection(
            connection_id="CNX-%s-%s" % (cid, eid), discipline="electrical",
            type="grounding_bond", origin=eid, destination=cid,
            medium="conductor_cobre_desnudo", technology="union exotermica o mecanica",
            parameters={"conductor_gauge": None, "connection_method": None},
            requires_calculation=["conductor_gauge", "connection_method"], provenance="hypothesis",
        ))
    model.add_connection(Connection(
        connection_id="CNX-ELE-PAT-TG", discipline="electrical", type="grounding_bond",
        origin=cid, destination="ELE-TAB-TG", medium="conductor_cobre_desnudo",
        technology="barraje de tierra del tablero",
        parameters={"conductor_gauge": None}, length_m=length,
        requires_calculation=["conductor_gauge"], provenance="derived",
    ))


# ---------------------------------------------------------------------------
# Circuitos de fuerza para equipos
# ---------------------------------------------------------------------------

# (equipo, clave de tension, tablero de origen)
EQUIPMENT_FEEDS = (
    ("HID-BOM-001", "bombeo", "ELE-TAB-TG"),
    ("CLI-EXT-N1", "climatizacion", "ELE-TAB-TS-N3"),
    ("CLI-EXT-N2", "climatizacion", "ELE-TAB-TS-N3"),
    ("CLI-EXT-N3", "climatizacion", "ELE-TAB-TS-N3"),
    ("CLI-EXTR-001", "climatizacion", "ELE-TAB-TS-N3"),
    ("TEL-RAC-001", "fuerza_equipos", "ELE-TAB-TG"),
    ("SEG-PAN-001", "fuerza_equipos", "ELE-TAB-TG"),
)


def build_equipment_circuits(model) -> None:
    """Circuitos dedicados de fuerza. Debe ejecutarse tras las demas disciplinas.

    La potencia de estos equipos NO esta determinada (depende de calculo de
    carga termica o hidraulica), por lo que `connected_power_w` y la corriente
    quedan en None. Es el caso que la solicitud describe como "corriente
    calculada unicamente cuando existan los datos necesarios".
    """
    counter = 0
    for equip_id, syskey, panel_id in EQUIPMENT_FEEDS:
        equip = model.components.get(equip_id)
        panel = model.components.get(panel_id)
        if equip is None or panel is None:
            continue
        counter += 1
        sysv = P.HYP_SYSTEM_VOLTAGES[syskey]
        cid = "ELE-CIR-FUE-%02d" % counter
        sid = "SOL-%s" % cid

        ex, ey, ez = equip.position
        pxp, pyp, pzp = panel.position
        via = max(ez, pzp) + 0.60
        path = R.manhattan((pxp, pyp, pzp), (ex, ey, ez), round(via, 3))
        solid = _route_solid(sid, [path], P.HYP_CONDUIT_DIAMETERS["alimentador"],
                             "cobre", equip.level_id, "ELE-FUERZA")
        length = R.total_length([path])

        op = model.oplog.record(
            "sweep_polyline", "creation",
            ("Circuito de fuerza %s desde %s hasta el equipo %s. Tension nominal %s V, "
             "%d fase(s). La potencia del equipo no esta determinada, por lo que la "
             "corriente no se calcula." )
            % (cid, panel_id, equip_id, sysv["voltage_v"], sysv["phases"]),
            component_id=cid, solid_id=sid,
            inputs={"panel": panel_id, "equipment": equip_id,
                    "path": [list(p) for p in path],
                    "voltage_system": sysv["system"]},
            outputs={"route_length_m": length, "connected_power_w": None,
                     "derived_current_a": None,
                     "reason_current_not_computed": "potencia del equipo sin determinar"},
            derived_from=["HYP_SYSTEM_VOLTAGES", "HYP_CONDUIT_DIAMETERS", "EQUIPMENT_FEEDS"],
            implementation="routing.manhattan + solids.polyline_pipe",
        )
        comp = Component(
            component_id=cid, discipline="electrical", type="equipment_circuit",
            name="Circuito de fuerza para %s" % equip.name,
            level_id=equip.level_id, material="cobre", ifc_class="IfcCableSegment",
            position=list(path[0]),
            parameters={
                "circuit_kind": "fuerza_equipos",
                "nominal_voltage_v": sysv["voltage_v"],
                "phases": sysv["phases"], "system": sysv["system"],
                "served_equipment": equip_id,
                "connected_power_w": None,
                "derived_current_a": None,
                "current_derivation": None,
                "conductor_material": "cobre",
                "conductor_gauge": None,
                "insulation_type": None,
                "conduit": "canalizacion de %.0f mm" % (
                    P.HYP_CONDUIT_DIAMETERS["alimentador"] * 1000),
                "route_length_m": length,
                "protection_rating": None,
                "protection_curve": None,
                "voltage_drop_percent": None,
                "origin": panel_id,
                "destination": equip_id,
            },
            requires_calculation=["connected_power_w", "derived_current_a", "conductor_gauge",
                                  "insulation_type", "protection_rating", "protection_curve",
                                  "voltage_drop_percent"],
            provenance="derived", tags=["electrico", "circuito", "fuerza"],
            validation_notes=[
                "La corriente no se declara porque la potencia del equipo depende de un "
                "calculo (carga termica o hidraulica) que no forma parte de este paquete.",
            ],
        )
        _add(model, comp, solid, op)
        model.relate(cid, "fed_from", panel_id)
        model.relate(cid, "serves_device", equip_id)
        model.add_connection(Connection(
            connection_id="CNX-%s" % cid, discipline="electrical", type="equipment_circuit",
            origin=panel_id, destination=equip_id,
            medium="conductor_cobre_en_canalizacion",
            technology="circuito de fuerza %s" % sysv["system"],
            parameters={"nominal_voltage_v": sysv["voltage_v"], "phases": sysv["phases"],
                        "connected_power_w": None, "derived_current_a": None,
                        "conductor_gauge": None, "protection_rating": None},
            geometry_reference=sid, length_m=length,
            flow_direction="tablero_hacia_equipo",
            requires_calculation=["connected_power_w", "conductor_gauge", "protection_rating"],
            provenance="derived",
        ))


# ---------------------------------------------------------------------------
# Orquestador
# ---------------------------------------------------------------------------


def build(model) -> None:
    build_service_entrance(model)
    build_subpanels(model)
    lighting = build_lighting(model)
    outlets = build_outlets(model)
    build_circuits(model, lighting, outlets)
    build_cable_tray(model)
    build_grounding(model)

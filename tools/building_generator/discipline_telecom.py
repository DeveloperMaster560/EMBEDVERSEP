"""Paquete de telecomunicaciones conceptual.

Datos calculados: geometria, recorridos y longitud real de cada enlace medida
sobre su polilinea 3D. Topologia completa en el grafo de conexiones, con
origen, destino, medio fisico o inalambrico y tecnologia declarada por enlace.

Pendiente (None): certificacion de canal, categoria definitiva del cableado
tras ensayo, presupuesto de potencia optica, plan de canales y potencia de
radio, dimensionamiento de rack y consumo real de equipos. La cobertura Wi-Fi
NO esta calculada: la posicion de los puntos de acceso es un reparto
geometrico y requiere estudio de sitio.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Tuple

import mepkit as K
import params as P
import routing as R
from discipline_structure import riser_at, shaft_tech

def telecom_room():
    """Recinto del rack principal, localizado por uso."""
    return P.find_space_any("N1", ("cuarto_telecom", "zona_tecnica", "archivo",
                                   "cuarto_electrico", "oficina"))


def rack_position():
    entry = telecom_room()
    x0, y0, x1, y1 = P.space_rect_of(entry)
    return (round(x0 + 0.70, 3), round((y0 + y1) / 2.0, 3))


def cabinet_position():
    """Gabinete de piso, junto al ducto tecnico de la circulacion."""
    tx0, ty0, tx1, ty1 = shaft_tech()
    return (round(tx1 + 0.25, 3), round(ty0 + 0.40, 3))


def wifi_positions():
    """Reparto geometrico de puntos de acceso sobre la planta."""
    L, W = P.REQ_LENGTH_X, P.REQ_WIDTH_Y
    return [(round(L * 0.25, 2), round(W * 0.50, 2)),
            (round(L * 0.50, 2), round(W * 0.14, 2)),
            (round(L * 0.50, 2), round(W * 0.86, 2)),
            (round(L * 0.75, 2), round(W * 0.50, 2))]

# Recintos que reciben tomas de red y cuantas.
DATA_OUTLETS_BY_USE = {
    "oficina": 2, "sala_reuniones": 2, "sala_juntas": 4, "recepcion": 3,
    "archivo": 1, "zona_tecnica": 1, "cuarto_electrico": 1, "cuarto_telecom": 4,
    "cuarto_hvac": 1,
}
WIRELESS_PENDING = ["channel_plan", "transmit_power_dBm", "coverage_survey",
                    "client_capacity", "throughput_estimate"]
COPPER_PENDING = ["channel_certification", "attenuation_dB", "next_dB",
                  "verified_category"]
FIBER_PENDING = ["optical_power_budget_dB", "attenuation_dB", "connector_loss_dB",
                 "verified_fiber_type"]


def build_core_equipment(model) -> None:
    rx, ry = rack_position()
    room = telecom_room()

    K.add_device(
        model, component_id="TEL-RAC-001", discipline="telecommunications",
        type="rack", name="Rack principal de comunicaciones",
        level_id="N1", space_id=P.space_id_of(room),
        xyz=(rx, ry, 1.10), box=(0.80, 0.80, 2.20),
        material="acero_galvanizado", ifc_class="IfcCommunicationsAppliance",
        layer="TEL-EQUIPOS",
        parameters={"room": P.space_code(room), "height_units_U": None,
                    "rack_width_in": None, "installed_load_W": None,
                    "cooling_requirement_W": None, "grounding_bond": None},
        requires_calculation=["height_units_U", "rack_width_in", "installed_load_W",
                              "cooling_requirement_W", "grounding_bond"],
        tags=["telecom", "rack"],
        op_description=("Rack principal en el cuarto de telecomunicaciones (recinto %s), "
                        "envolvente 0.80 x 0.80 x 2.20 m." % P.space_code(room)),
        derived_from=["SPACE_PROGRAM"],
        validation_notes=["Altura util y carga termica del rack sin dimensionar."],
    )

    K.add_device(
        model, component_id="TEL-RTR-001", discipline="telecommunications",
        type="router", name="Router de borde",
        level_id="N1", space_id=P.space_id_of(room),
        xyz=(rx, ry, 1.95), box=(0.48, 0.40, 0.09),
        material="equipo_generico", ifc_class="IfcCommunicationsAppliance",
        layer="TEL-EQUIPOS",
        parameters={"mounted_in": "TEL-RAC-001", "wan_interfaces": None,
                    "lan_interfaces": None, "throughput_Gbps": None,
                    "power_consumption_W": None, "firmware_baseline": None},
        requires_calculation=["wan_interfaces", "lan_interfaces", "throughput_Gbps",
                              "power_consumption_W", "firmware_baseline"],
        tags=["telecom", "router"],
        op_description="Router de borde montado en el rack principal.",
        derived_from=["SPACE_PROGRAM"],
    )
    model.relate("TEL-RTR-001", "mounted_in", "TEL-RAC-001")

    # Switch principal en el rack y un switch de piso por nivel.
    K.add_device(
        model, component_id="TEL-SW-CORE", discipline="telecommunications",
        type="switch", name="Switch nucleo",
        level_id="N1", space_id=P.space_id_of(room),
        xyz=(rx, ry, 1.80), box=(0.48, 0.40, 0.09),
        material="equipo_generico", ifc_class="IfcCommunicationsAppliance",
        layer="TEL-EQUIPOS",
        parameters={"mounted_in": "TEL-RAC-001", "role": "nucleo",
                    "port_count": None, "uplink_type": None, "poe_budget_W": None,
                    "switching_capacity_Gbps": None, "power_consumption_W": None},
        requires_calculation=["port_count", "uplink_type", "poe_budget_W",
                              "switching_capacity_Gbps", "power_consumption_W"],
        tags=["telecom", "switch"],
        op_description="Switch nucleo montado en el rack principal.",
        derived_from=["SPACE_PROGRAM"],
    )
    model.relate("TEL-SW-CORE", "mounted_in", "TEL-RAC-001")
    K.link(model, connection_id="CNX-TEL-RTR-SWCORE", discipline="telecommunications",
           type="network_link", origin="TEL-RTR-001", destination="TEL-SW-CORE",
           medium="cable_de_parcheo_cobre", technology="Ethernet",
           parameters={"link_type": "uplink interno de rack", "negotiated_speed": None},
           requires_calculation=["negotiated_speed"], provenance="hypothesis")

    for level in P.LEVELS:
        lid = level["level_id"]
        e = level["elevation"]
        cx, cy = cabinet_position()
        K.add_device(
            model, component_id="TEL-GAB-%s" % lid, discipline="telecommunications",
            type="cabinet", name="Gabinete de piso %s" % lid,
            level_id=lid, space_id="ARQ-ESP-%sCIRC" % lid,
            xyz=(cx, cy, round(e + 1.80, 3)), box=(0.30, 0.60, 0.60),
            material="acero_galvanizado", ifc_class="IfcCommunicationsAppliance",
            layer="TEL-EQUIPOS",
            parameters={"served_level": lid, "height_units_U": None,
                        "installed_load_W": None, "grounding_bond": None},
            requires_calculation=["height_units_U", "installed_load_W", "grounding_bond"],
            tags=["telecom", "gabinete"],
            op_description="Gabinete de piso del %s junto al ducto tecnico." % lid,
            derived_from=["HYP_CORRIDOR_WIDTH"],
        )
        K.add_device(
            model, component_id="TEL-SW-%s" % lid, discipline="telecommunications",
            type="switch", name="Switch de piso %s" % lid,
            level_id=lid, space_id="ARQ-ESP-%sCIRC" % lid,
            xyz=(cx, cy, round(e + 1.80, 3)), box=(0.26, 0.44, 0.09),
            material="equipo_generico", ifc_class="IfcCommunicationsAppliance",
            layer="TEL-EQUIPOS",
            parameters={"mounted_in": "TEL-GAB-%s" % lid, "role": "acceso",
                        "served_level": lid, "port_count": None, "uplink_type": None,
                        "poe_budget_W": None, "power_consumption_W": None},
            requires_calculation=["port_count", "uplink_type", "poe_budget_W",
                                  "power_consumption_W"],
            tags=["telecom", "switch"],
            op_description="Switch de acceso del %s en el gabinete de piso." % lid,
            derived_from=["HYP_CORRIDOR_WIDTH"],
        )
        model.relate("TEL-SW-%s" % lid, "mounted_in", "TEL-GAB-%s" % lid)


def build_backbone(model) -> None:
    """Troncal de fibra optica desde el rack a cada gabinete de piso."""
    rx, ry = rack_position()
    room = telecom_room()
    sx, sy = riser_at("telecom")
    cx, cy = cabinet_position()

    # tramo horizontal rack -> ducto tecnico en N1
    base = R.manhattan((rx, ry, 1.95), (sx, sy, 0.50), R.plenum_z(P.LEVELS[0], "telecommunications"))
    comp, blen = K.add_route(
        model, component_id="TEL-FIB-BASE", discipline="telecommunications",
        type="fiber_backbone", name="Troncal de fibra rack a ducto tecnico",
        polylines=[base], diameter=P.HYP_CONDUIT_DIAMETERS["telecom_backbone"],
        material="pvc", ifc_class="IfcCableSegment", layer="TEL-CANALIZACIONES",
        level_id="N1",
        parameters={"medium": "fibra optica en canalizacion", "fiber_type": None,
                    "strand_count": None, "optical_power_budget_dB": None},
        requires_calculation=FIBER_PENDING + ["strand_count"],
        tags=["telecom", "fibra", "backbone"],
        op_description=("Troncal de fibra desde el rack principal hasta el ducto tecnico, "
                        "por el vacio tecnico del N1."),
        derived_from=["SPACE_PROGRAM", "HYP_CORRIDOR_WIDTH", "HYP_CONDUIT_DIAMETERS"],
        flow_direction="bidireccional",
    )

    # montante de fibra en el ducto tecnico
    riser = R.riser(sx, sy, 0.50, round(P.LEVELS[-1]["elevation"] + 2.00, 3))
    comp, rlen = K.add_route(
        model, component_id="TEL-FIB-MON", discipline="telecommunications",
        type="fiber_riser", name="Montante de fibra optica",
        polylines=[riser], diameter=P.HYP_CONDUIT_DIAMETERS["telecom_backbone"],
        material="pvc", ifc_class="IfcCableSegment", layer="TEL-CANALIZACIONES",
        parameters={"medium": "fibra optica en canalizacion vertical",
                    "shaft": "ducto tecnico", "fiber_type": None,
                    "strand_count": None, "optical_power_budget_dB": None},
        requires_calculation=FIBER_PENDING + ["strand_count"],
        tags=["telecom", "fibra", "montante"],
        op_description="Montante de fibra optica en el ducto tecnico, de cota 0.50 a %.2f m."
                       % riser[-1][2],
        derived_from=["HYP_CORRIDOR_WIDTH"], flow_direction="bidireccional",
    )
    K.link(model, connection_id="CNX-TEL-FIB-BASE-MON", discipline="telecommunications",
           type="network_link", origin="TEL-FIB-BASE", destination="TEL-FIB-MON",
           medium="fibra_optica", technology="troncal optica",
           parameters={"fiber_type": None}, requires_calculation=FIBER_PENDING,
           length_m=round(blen + rlen, 4))

    for level in P.LEVELS:
        lid = level["level_id"]
        e = level["elevation"]
        drop = R.manhattan((sx, sy, round(e + 1.80, 3)), (cx, cy, round(e + 1.80, 3)),
                           round(e + 1.80, 3))
        comp, dlen = K.add_route(
            model, component_id="TEL-FIB-%s" % lid, discipline="telecommunications",
            type="fiber_drop", name="Derivacion de fibra al gabinete %s" % lid,
            polylines=[drop], diameter=P.HYP_CONDUIT_DIAMETERS["telecom_backbone"],
            material="pvc", ifc_class="IfcCableSegment", layer="TEL-CANALIZACIONES",
            level_id=lid,
            parameters={"medium": "fibra optica", "served_level": lid,
                        "fiber_type": None, "optical_power_budget_dB": None},
            requires_calculation=FIBER_PENDING,
            tags=["telecom", "fibra"],
            op_description="Derivacion de fibra del montante al gabinete de piso del %s." % lid,
            derived_from=["HYP_CORRIDOR_WIDTH"],
            flow_direction="bidireccional",
        )
        K.link(model, connection_id="CNX-TEL-MON-%s" % lid, discipline="telecommunications",
               type="network_link", origin="TEL-SW-CORE", destination="TEL-SW-%s" % lid,
               medium="fibra_optica", technology="uplink optico de piso",
               parameters={"path": ["TEL-FIB-BASE", "TEL-FIB-MON", "TEL-FIB-%s" % lid],
                           "fiber_type": None, "negotiated_speed": None},
               geometry_reference="SOL-TEL-FIB-%s" % lid,
               length_m=round(blen + rlen + dlen, 4),
               flow_direction="bidireccional",
               requires_calculation=FIBER_PENDING + ["negotiated_speed"])


def build_access_points(model) -> List[Dict[str, Any]]:
    """Puntos de acceso Wi-Fi repartidos geometricamente (sin estudio de sitio)."""
    out: List[Dict[str, Any]] = []
    positions = wifi_positions()
    for level in P.LEVELS:
        lid = level["level_id"]
        cz = R.ceiling_z(level)
        for k, (px, py) in enumerate(positions, start=1):
            cid = "TEL-WIFI-%s-%02d" % (lid, k)
            K.add_device(
                model, component_id=cid, discipline="telecommunications",
                type="wireless_access_point", name="Punto de acceso Wi-Fi %s-%02d" % (lid, k),
                level_id=lid, space_id=None,
                xyz=(px, py, round(cz - 0.03, 4)), box=(0.22, 0.22, 0.06),
                material="equipo_generico", ifc_class="IfcCommunicationsAppliance",
                layer="TEL-WIFI",
                parameters={"mounting": "cielo raso", "powered_by": "PoE",
                            "served_switch": "TEL-SW-%s" % lid,
                            "radio_bands": None, "channel_plan": None,
                            "transmit_power_dBm": None, "coverage_radius_m": None,
                            "client_capacity": None, "poe_class": None},
                requires_calculation=WIRELESS_PENDING + ["radio_bands", "poe_class"],
                tags=["telecom", "wifi", "inalambrico"],
                op_description=("Punto de acceso Wi-Fi %s: reparto geometrico en planta, "
                                "sin estudio de cobertura." % cid),
                derived_from=["REQ_LENGTH_X", "REQ_WIDTH_Y", "HYP_CEILING_HEIGHT"],
                validation_notes=["Posicion por reparto geometrico. La cobertura real "
                                  "requiere estudio de sitio y plan de canales."],
            )
            out.append({"component_id": cid, "xyz": (px, py, round(cz - 0.03, 4)),
                        "level": lid, "code": "WIFI%02d" % k})
            K.link(model, connection_id="CNX-%s-SW" % cid, discipline="telecommunications",
                   type="network_link", origin="TEL-SW-%s" % lid, destination=cid,
                   medium="cable_utp", technology="Ethernet con PoE",
                   parameters={"declared_category": "Cat 6 (hipotesis de seleccion)",
                               "verified_category": None, "poe_class": None},
                   requires_calculation=COPPER_PENDING + ["poe_class"], provenance="hypothesis")
    return out


def build_data_outlets(model) -> Dict[str, List[Dict[str, Any]]]:
    per_level: Dict[str, List[Dict[str, Any]]] = {}
    for level in P.LEVELS:
        lid = level["level_id"]
        e = level["elevation"]
        pts: List[Dict[str, Any]] = []
        for sp in sorted(model.spaces_of_level(lid), key=lambda s: s.code):
            n = DATA_OUTLETS_BY_USE.get(sp.use, 0)
            if n <= 0:
                continue
            # El desfase de arranque y el retranqueo separan la toma de datos
            # de la toma de corriente, que recorre el mismo perimetro.
            candidates = R.perimeter_points(sp.rect, spacing=max(2.0, sp.perimeter_m / (n + 1)),
                                            inset=0.24, start_offset=1.55)
            if not candidates:
                continue
            step = max(1, len(candidates) // n)
            chosen = candidates[::step][:n]
            for k, (px, py, face) in enumerate(chosen, start=1):
                cid = "TEL-TOM-%s-%s-%02d" % (lid, sp.code, k)
                z = round(e + 0.40, 3)
                K.add_device(
                    model, component_id=cid, discipline="telecommunications",
                    type="data_outlet", name="Toma de red %s-%02d" % (sp.code, k),
                    level_id=lid, space_id=sp.space_id,
                    xyz=(px, py, z), box=(0.12, 0.08, 0.12),
                    material="equipo_generico", ifc_class="IfcOutlet", layer="TEL-TOMAS",
                    parameters={"port_count": 1, "wall_face": face,
                                "mounting_height_m": 0.40,
                                "declared_category": "Cat 6 (hipotesis de seleccion)",
                                "served_switch": "TEL-SW-%s" % lid,
                                "verified_category": None, "channel_certification": None,
                                "patch_panel_port": None},
                    requires_calculation=COPPER_PENDING + ["patch_panel_port"],
                    tags=["telecom", "toma"],
                    op_description=("Toma de red %s en el recinto %s, cara %s, a 0.40 m "
                                    "sobre piso." % (cid, sp.code, face)),
                    derived_from=["DATA_OUTLETS_BY_USE", "SPACE_PROGRAM"],
                )
                model.relate(cid, "serves_space", sp.space_id)
                pts.append({"component_id": cid, "xyz": (px, py, z),
                            "space": sp.space_id, "code": sp.code})
        per_level[lid] = pts
    return per_level


def build_horizontal_cabling(model, outlets: Dict[str, List[Dict[str, Any]]],
                             aps: List[Dict[str, Any]]) -> None:
    """Cableado horizontal en estrella: un enlace por toma, longitud medida."""
    cx, cy = cabinet_position()
    for level in P.LEVELS:
        lid = level["level_id"]
        e = level["elevation"]
        via = R.plenum_z(level, "telecommunications")
        switch = "TEL-SW-%s" % lid
        origin = (cx, cy, round(e + 1.80, 3))

        devices = list(outlets[lid]) + [a for a in aps if a["level"] == lid]
        if not devices:
            continue

        polylines: List[List[Tuple[float, float, float]]] = []
        per_run: List[Tuple[str, float]] = []
        for d in devices:
            path = R.manhattan(origin, d["xyz"], via, avoid=True)
            polylines.append(path)
            per_run.append((d["component_id"], R.total_length([path])))

        comp, total = K.add_route(
            model, component_id="TEL-CAB-%s" % lid, discipline="telecommunications",
            type="horizontal_cabling", name="Cableado horizontal %s" % lid,
            polylines=polylines, diameter=P.HYP_CONDUIT_DIAMETERS["telecom_horizontal"],
            material="pvc", ifc_class="IfcCableCarrierSegment", layer="TEL-CANALIZACIONES",
            level_id=lid,
            parameters={"topology": "estrella desde el gabinete de piso",
                        "run_count": len(per_run),
                        "longest_run_m": round(max(l for _, l in per_run), 4),
                        "shortest_run_m": round(min(l for _, l in per_run), 4),
                        "declared_category": "Cat 6 (hipotesis de seleccion)",
                        "max_permitted_channel_m": None,
                        "verified_category": None, "channel_certification": None},
            requires_calculation=COPPER_PENDING + ["max_permitted_channel_m"],
            tags=["telecom", "cableado"],
            op_description=("Cableado horizontal del %s: %d enlaces en estrella desde el "
                            "gabinete de piso por el vacio tecnico a cota %.2f. Longitud "
                            "total medida %.2f m." % (lid, len(per_run), via,
                                                      R.total_length(polylines))),
            derived_from=["HYP_CORRIDOR_WIDTH", "HYP_ROUTING_Z",
                          "HYP_CONDUIT_DIAMETERS"],
            flow_direction="bidireccional",
            validation_notes=["La longitud de canal admisible no esta verificada."],
        )

        for dev_id, dlen in per_run:
            if dev_id.startswith("TEL-WIFI"):
                continue   # el enlace del AP ya existe
            K.link(model, connection_id="CNX-%s-SW" % dev_id, discipline="telecommunications",
                   type="network_link", origin=switch, destination=dev_id,
                   medium="cable_utp", technology="Ethernet",
                   parameters={"declared_category": "Cat 6 (hipotesis de seleccion)",
                               "verified_category": None, "channel_certification": None},
                   geometry_reference="SOL-TEL-CAB-%s" % lid, length_m=dlen,
                   flow_direction="bidireccional", requires_calculation=COPPER_PENDING)


def build_roof_antenna(model) -> None:
    z = round(P.ROOF_LEVEL["elevation"] + P.HYP_PARAPET_HEIGHT + 1.20, 3)
    K.add_device(
        model, component_id="TEL-ANT-001", discipline="telecommunications",
        type="antenna", name="Antena de enlace en cubierta",
        level_id="NC", xyz=(round(P.REQ_LENGTH_X * 0.10, 2), round(P.REQ_WIDTH_Y * 0.12, 2), z), box=(0.40, 0.40, 0.60),
        material="equipo_generico", ifc_class="IfcCommunicationsAppliance",
        layer="TEL-EQUIPOS",
        parameters={"mounting": "mastil sobre cubierta", "purpose": "enlace exterior",
                    "frequency_band": None, "gain_dBi": None, "azimuth_deg": None,
                    "tilt_deg": None, "link_budget_dB": None, "lightning_protection": None},
        requires_calculation=["frequency_band", "gain_dBi", "azimuth_deg", "tilt_deg",
                              "link_budget_dB", "lightning_protection"],
        tags=["telecom", "antena", "inalambrico"],
        op_description="Antena de enlace exterior sobre mastil en cubierta.",
        derived_from=["ROOF_LEVEL", "HYP_PARAPET_HEIGHT"],
        validation_notes=["Orientacion, banda y presupuesto de enlace sin definir."],
    )
    sx, sy = riser_at("telecom")
    path = R.manhattan((round(P.REQ_LENGTH_X * 0.10, 2), round(P.REQ_WIDTH_Y * 0.12, 2), z), (sx, sy, round(P.LEVELS[-1]["elevation"] + 2.00, 3)),
                       round(P.ROOF_LEVEL["elevation"] + 0.30, 3))
    comp, length = K.add_route(
        model, component_id="TEL-ANT-CAB", discipline="telecommunications",
        type="antenna_feeder", name="Bajante de antena a montante de fibra",
        polylines=[path], diameter=P.HYP_CONDUIT_DIAMETERS["telecom_horizontal"],
        material="pvc", ifc_class="IfcCableSegment", layer="TEL-CANALIZACIONES",
        level_id="NC",
        parameters={"medium": "cable coaxial o UTP exterior", "cable_type": None,
                    "attenuation_dB": None, "surge_protection": None},
        requires_calculation=["cable_type", "attenuation_dB", "surge_protection"],
        tags=["telecom", "antena"],
        op_description="Recorrido desde la antena de cubierta hasta el montante del ducto tecnico.",
        derived_from=["HYP_CORRIDOR_WIDTH"], flow_direction="bidireccional",
    )
    K.link(model, connection_id="CNX-TEL-ANT-RTR", discipline="telecommunications",
           type="network_link", origin="TEL-ANT-001", destination="TEL-RTR-001",
           medium="cable_coaxial_o_utp_exterior", technology="enlace inalambrico exterior",
           parameters={"cable_type": None, "link_budget_dB": None},
           geometry_reference="SOL-TEL-ANT-CAB", length_m=length,
           flow_direction="bidireccional",
           requires_calculation=["cable_type", "link_budget_dB"])


def build(model) -> None:
    build_core_equipment(model)
    build_backbone(model)
    aps = build_access_points(model)
    outlets = build_data_outlets(model)
    build_horizontal_cabling(model, outlets, aps)
    build_roof_antenna(model)

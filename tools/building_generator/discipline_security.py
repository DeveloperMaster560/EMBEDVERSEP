"""Paquete de seguridad y proteccion conceptual.

Incluye CCTV, deteccion de humo, sensores de movimiento, alarmas, control de
acceso, senalizacion, alumbrado de emergencia y dispositivos de proteccion
contra incendios, con ubicacion, recorridos de cableado, alimentacion y
comunicacion.

Pendiente por completo (None): evaluacion de riesgo, categoria del sistema de
deteccion, area de cobertura verificada por detector, autonomia requerida del
alumbrado de emergencia, distancias de recorrido de evacuacion, agente y
capacidad de extintores y caudal/presion de la red de incendio. La ubicacion
de los dispositivos es un reparto geometrico, NO un diseno normativo de
proteccion contra incendios.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Tuple

import mepkit as K
import params as P
import routing as R
from discipline_structure import riser_at

def panel_room():
    """Recinto del panel de seguridad, localizado por uso."""
    return P.find_space_any("N1", ("cuarto_telecom", "cuarto_electrico",
                                   "zona_tecnica", "archivo", "oficina"))


def panel_position():
    entry = panel_room()
    x0, y0, x1, y1 = P.space_rect_of(entry)
    return (round(x0 + 0.60, 3), round(y1 - 0.60, 3))


def security_riser():
    return riser_at("telecom")


def cctv_positions():
    """Camaras en las cuatro esquinas del anillo de circulacion."""
    ix0 = round(P.RING_X0 + P.HYP_CORRIDOR_WIDTH * 0.55, 2)
    ix1 = round(P.RING_X1 - P.HYP_CORRIDOR_WIDTH * 0.55, 2)
    iy0 = round(P.RING_Y0 + P.HYP_CORRIDOR_WIDTH * 0.55, 2)
    iy1 = round(P.RING_Y1 - P.HYP_CORRIDOR_WIDTH * 0.55, 2)
    return [(ix0, iy0), (ix1, iy0), (ix0, iy1), (ix1, iy1)]


def motion_positions():
    """Sensores en los tramos medios oeste y este de la circulacion."""
    my = round((P.RING_Y0 + P.RING_Y1) / 2.0, 2)
    return [(round(P.RING_X0 + P.HYP_CORRIDOR_WIDTH * 0.5, 2), my),
            (round(P.RING_X1 - P.HYP_CORRIDOR_WIDTH * 0.5, 2), my)]


def access_controlled():
    """Recintos tecnicos con control de acceso, por uso."""
    out = {}
    for use in ("cuarto_electrico", "cuarto_telecom"):
        entry = P.find_space("N1", use)
        if entry is not None:
            out[P.space_code(entry)] = P.ROOM_TYPES[use]["label"]
    return out

FIRE_PENDING = ["risk_assessment", "detection_category", "verified_coverage_m2",
                "code_compliance_check"]
CCTV_PENDING = ["resolution", "field_of_view_deg", "recording_retention_days",
                "bandwidth_Mbps", "low_light_performance"]

# Un detector de humo por cada 40 m2 como reparto geometrico.
SMOKE_AREA_PER_DEVICE = 40.0



def build_panel(model) -> None:
    px, py = panel_position()
    room = panel_room()
    K.add_device(
        model, component_id="SEG-PAN-001", discipline="security",
        type="security_panel", name="Panel de seguridad y deteccion",
        level_id="N1", space_id=P.space_id_of(room),
        xyz=(px, py, 1.50), box=(0.15, 0.50, 0.70),
        material="equipo_generico", ifc_class="IfcAlarm", layer="SEG-EQUIPOS",
        parameters={"room": P.space_code(room),
                    "subsystems": ["deteccion de humo", "alarma", "control de acceso",
                                   "CCTV", "sensores de movimiento"],
                    "zone_count": None, "loop_capacity": None,
                    "battery_autonomy_h": None, "detection_category": None,
                    "monitoring_service": None},
        requires_calculation=["zone_count", "loop_capacity", "battery_autonomy_h",
                              "detection_category", "monitoring_service"],
        tags=["seguridad", "panel"],
        op_description=("Panel de seguridad y deteccion en el cuarto de telecomunicaciones "
                        "(recinto %s)." % P.space_code(room)),
        derived_from=["SPACE_PROGRAM"],
        validation_notes=["Zonificacion y autonomia sin dimensionar."],
    )


def build_detection(model) -> Dict[str, List[Dict[str, Any]]]:
    per_level: Dict[str, List[Dict[str, Any]]] = {}
    for level in P.LEVELS:
        lid = level["level_id"]
        cz = R.ceiling_z(level)
        devices: List[Dict[str, Any]] = []

        for sp in sorted(model.spaces_of_level(lid), key=lambda s: s.code):
            n = max(1, int(math.ceil(sp.area_m2 / SMOKE_AREA_PER_DEVICE)))
            if sp.shape == "ring":
                pts = [(x, y) for x, y, _ in R.perimeter_points(
                    [P.RING_X0 + 1.0, P.RING_Y0 + 1.0, P.RING_X1 - 1.0, P.RING_Y1 - 1.0],
                    spacing=8.0, inset=0.0, start_offset=2.0)]
                n = len(pts)
            else:
                # Desfase respecto a la reticula de luminarias, que ocupa los
                # mismos puntos de cielo raso.
                pts = [(round(x + 0.55, 3), round(y + 0.45, 3))
                       for x, y in R.grid_in_rect(sp.rect, n, margin=1.10)]
            for k, (px, py) in enumerate(pts, start=1):
                cid = "SEG-HUM-%s-%s-%02d" % (lid, sp.code, k)
                K.add_device(
                    model, component_id=cid, discipline="security",
                    type="smoke_detector", name="Detector de humo %s-%02d" % (sp.code, k),
                    level_id=lid, space_id=sp.space_id,
                    xyz=(px, py, round(cz - 0.03, 3)), box=(0.12, 0.12, 0.05),
                    material="equipo_generico", ifc_class="IfcSensor", layer="SEG-DETECCION",
                    parameters={"detector_type": "optico de humo (hipotesis de seleccion)",
                                "mounting": "cielo raso", "served_space": sp.space_id,
                                "geometric_allocation_m2": SMOKE_AREA_PER_DEVICE,
                                "verified_coverage_m2": None, "zone": None,
                                "detection_category": None, "sensitivity": None},
                    requires_calculation=FIRE_PENDING + ["zone", "sensitivity"],
                    tags=["seguridad", "deteccion", "incendio"],
                    op_description=("Detector de humo %s en el recinto %s. Reparto geometrico de "
                                    "%d unidades para %.2f m2 a razon de %.0f m2/unidad; no es "
                                    "diseno normativo de deteccion."
                                    % (cid, sp.code, n, sp.area_m2, SMOKE_AREA_PER_DEVICE)),
                    derived_from=["SMOKE_AREA_PER_DEVICE", "SPACE_PROGRAM"],
                    validation_notes=["Cobertura por detector no verificada contra norma."],
                )
                model.relate(cid, "serves_space", sp.space_id)
                devices.append({"component_id": cid, "xyz": (px, py, round(cz - 0.03, 3)),
                                "kind": "smoke"})

        for k, (px, py) in enumerate(motion_positions(), start=1):
            cid = "SEG-MOV-%s-%02d" % (lid, k)
            K.add_device(
                model, component_id=cid, discipline="security", type="motion_sensor",
                name="Sensor de movimiento %s-%02d" % (lid, k), level_id=lid,
                space_id="ARQ-ESP-%sCIRC" % lid,
                xyz=(px, py, round(level["elevation"] + 2.40, 3)), box=(0.10, 0.08, 0.10),
                material="equipo_generico", ifc_class="IfcSensor", layer="SEG-DETECCION",
                parameters={"sensor_type": "infrarrojo pasivo (hipotesis de seleccion)",
                            "mounting_height_m": 2.40, "zone": None,
                            "detection_range_m": None, "field_of_view_deg": None},
                requires_calculation=["zone", "detection_range_m", "field_of_view_deg"],
                tags=["seguridad", "intrusion"],
                op_description="Sensor de movimiento en la circulacion del %s." % lid,
                derived_from=["HYP_CORRIDOR_WIDTH"],
            )
            devices.append({"component_id": cid,
                            "xyz": (px, py, round(level["elevation"] + 2.40, 3)),
                            "kind": "motion"})
        per_level[lid] = devices
    return per_level


def build_cctv(model) -> Dict[str, List[Dict[str, Any]]]:
    per_level: Dict[str, List[Dict[str, Any]]] = {}
    for level in P.LEVELS:
        lid = level["level_id"]
        cz = R.ceiling_z(level)
        cams: List[Dict[str, Any]] = []
        for k, (px, py) in enumerate(cctv_positions(), start=1):
            cid = "SEG-CAM-%s-%02d" % (lid, k)
            K.add_device(
                model, component_id=cid, discipline="security", type="cctv_camera",
                name="Camara CCTV %s-%02d" % (lid, k), level_id=lid,
                space_id="ARQ-ESP-%sCIRC" % lid,
                xyz=(px, py, round(cz - 0.22, 3)), box=(0.14, 0.14, 0.12),
                material="equipo_generico", ifc_class="IfcAudioVisualAppliance",
                layer="SEG-CCTV",
                parameters={"camera_type": "domo fijo IP (hipotesis de seleccion)",
                            "mounting": "cielo raso", "powered_by": "PoE",
                            "served_switch": "TEL-SW-%s" % lid,
                            "resolution": None, "field_of_view_deg": None,
                            "bandwidth_Mbps": None, "recording_retention_days": None,
                            "low_light_performance": None},
                requires_calculation=CCTV_PENDING,
                tags=["seguridad", "cctv"],
                op_description="Camara CCTV en la circulacion del %s, posicion %d." % (lid, k),
                derived_from=["HYP_CORRIDOR_WIDTH", "HYP_CEILING_HEIGHT"],
                validation_notes=["Cobertura y retencion de grabacion sin definir."],
            )
            cams.append({"component_id": cid, "xyz": (px, py, round(cz - 0.22, 3)),
                         "kind": "cctv"})
            K.link(model, connection_id="CNX-%s-SW" % cid, discipline="security",
                   type="network_link", origin="TEL-SW-%s" % lid, destination=cid,
                   medium="cable_utp", technology="IP sobre Ethernet con PoE",
                   parameters={"declared_category": "Cat 6 (hipotesis de seleccion)",
                               "bandwidth_Mbps": None, "poe_class": None},
                   flow_direction="camara_hacia_grabador",
                   requires_calculation=["bandwidth_Mbps", "poe_class"], provenance="hypothesis")
        per_level[lid] = cams

    # Camaras de acceso y cubierta
    K.add_device(
        model, component_id="SEG-CAM-ACC-001", discipline="security", type="cctv_camera",
        name="Camara de acceso principal", level_id="N1",
        xyz=(4.00, 0.00, 2.80), box=(0.14, 0.14, 0.12),
        material="equipo_generico", ifc_class="IfcAudioVisualAppliance", layer="SEG-CCTV",
        parameters={"camera_type": "bullet IP exterior (hipotesis de seleccion)",
                    "covers": "puerta de acceso principal", "powered_by": "PoE",
                    "resolution": None, "field_of_view_deg": None,
                    "bandwidth_Mbps": None, "recording_retention_days": None,
                    "low_light_performance": None},
        requires_calculation=CCTV_PENDING, tags=["seguridad", "cctv", "exterior"],
        op_description="Camara exterior sobre la puerta de acceso principal.",
        derived_from=["SPACE_PROGRAM"],
    )
    K.add_device(
        model, component_id="SEG-CAM-CUB-001", discipline="security", type="cctv_camera",
        name="Camara de cubierta", level_id="NC",
        xyz=(12.00, 2.00, round(P.ROOF_LEVEL["elevation"] + 2.20, 3)), box=(0.14, 0.14, 0.12),
        material="equipo_generico", ifc_class="IfcAudioVisualAppliance", layer="SEG-CCTV",
        parameters={"camera_type": "bullet IP exterior (hipotesis de seleccion)",
                    "covers": "cubierta y equipos", "powered_by": "PoE",
                    "resolution": None, "field_of_view_deg": None,
                    "bandwidth_Mbps": None, "recording_retention_days": None,
                    "low_light_performance": None},
        requires_calculation=CCTV_PENDING, tags=["seguridad", "cctv", "exterior"],
        op_description="Camara exterior en cubierta para vigilancia de equipos.",
        derived_from=["ROOF_LEVEL"],
    )
    return per_level


def build_access_control(model) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    # Acceso principal
    points = [("ACC", "Acceso principal", "N1", (4.00, 0.40, 1.10), "ARQ-ESP-101")]
    # Puerta de escalera por nivel
    for level in P.LEVELS:
        lid = level["level_id"]
        points.append((("ESC-%s" % lid), "Puerta de escalera %s" % lid, lid,
                       (8.70, 9.00, round(level["elevation"] + 1.10, 3)),
                       "ARQ-ESP-%sESC" % lid))
    # Recintos tecnicos del N1
    for code, name in access_controlled().items():
        rect = None
        for c, n, use, band, start, end in P.SPACE_PROGRAM["N1"]:
            if c == code:
                rect = P.space_rect(band, start, end)
        points.append((("T-%s" % code), name, "N1",
                       (round(rect[2] - 0.30, 3), round((rect[1] + rect[3]) / 2, 3), 1.10),
                       "ARQ-ESP-%s" % code))

    for tag, name, lid, xyz, space in points:
        cid = "SEG-LEC-%s" % tag
        K.add_device(
            model, component_id=cid, discipline="security", type="access_reader",
            name="Lector de control de acceso: %s" % name, level_id=lid, space_id=space,
            xyz=xyz, box=(0.09, 0.05, 0.13), material="equipo_generico",
            ifc_class="IfcAccessControl" if False else "IfcSensor", layer="SEG-ACCESO",
            parameters={"reader_type": "proximidad (hipotesis de seleccion)",
                        "controls": name, "mounting_height_m": 1.10,
                        "credential_technology": None, "fail_safe_mode": None,
                        "egress_override": None, "door_hardware": None},
            requires_calculation=["credential_technology", "fail_safe_mode",
                                  "egress_override", "door_hardware"],
            tags=["seguridad", "control de acceso"],
            op_description="Lector de control de acceso en %s." % name,
            derived_from=["SPACE_PROGRAM"],
            validation_notes=["El modo de fallo debe compatibilizarse con la evacuacion."],
        )
        out.append({"component_id": cid, "xyz": xyz, "kind": "reader", "level": lid})
    return out


def build_emergency(model) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for level in P.LEVELS:
        lid = level["level_id"]
        e = level["elevation"]
        cz = R.ceiling_z(level)

        # alumbrado de emergencia en la circulacion
        pts = R.perimeter_points(
            [P.RING_X0 + 0.8, P.RING_Y0 + 0.8, P.RING_X1 - 0.8, P.RING_Y1 - 0.8],
            spacing=6.0, inset=0.0, start_offset=1.5)
        for k, (px, py, _face) in enumerate(pts, start=1):
            cid = "SEG-EME-%s-%02d" % (lid, k)
            K.add_device(
                model, component_id=cid, discipline="security", type="emergency_light",
                name="Luminaria de emergencia %s-%02d" % (lid, k), level_id=lid,
                space_id="ARQ-ESP-%sCIRC" % lid,
                xyz=(px, py, round(cz - 0.06, 3)), box=(0.30, 0.10, 0.10),
                material="luminaria", ifc_class="IfcLightFixture", layer="SEG-EMERGENCIA",
                parameters={"fixture_type": "autonoma con bateria (hipotesis de seleccion)",
                            "mounting": "cielo raso",
                            "required_autonomy_min": None,
                            "illuminance_on_path_lux": None,
                            "battery_capacity_Wh": None, "code_compliance_check": None},
                requires_calculation=["required_autonomy_min", "illuminance_on_path_lux",
                                      "battery_capacity_Wh", "code_compliance_check"],
                tags=["seguridad", "emergencia"],
                op_description=("Luminaria de emergencia en la circulacion del %s, reparto "
                                "perimetral cada 6 m." % lid),
                derived_from=["HYP_CORRIDOR_WIDTH"],
                validation_notes=["Autonomia e iluminancia en la via de evacuacion sin verificar."],
            )
            out.append({"component_id": cid, "xyz": (px, py, round(cz - 0.06, 3)),
                        "kind": "emergency", "level": lid})

        # senalizacion de salida sobre las puertas de escalera y en la circulacion
        for k, (px, py) in enumerate([(8.70, 9.00), (12.00, 4.60), (12.00, 13.40)], start=1):
            cid = "SEG-SEN-%s-%02d" % (lid, k)
            K.add_device(
                model, component_id=cid, discipline="security", type="exit_sign",
                name="Senalizacion de salida %s-%02d" % (lid, k), level_id=lid,
                space_id="ARQ-ESP-%sCIRC" % lid,
                xyz=(px, py, round(e + 2.30, 3)), box=(0.35, 0.06, 0.18),
                material="equipo_generico", ifc_class="IfcLightFixture", layer="SEG-SENALIZACION",
                parameters={"sign_type": "salida iluminada (hipotesis de seleccion)",
                            "mounting_height_m": 2.30,
                            "viewing_distance_m": None, "required_autonomy_min": None,
                            "pictogram_standard": None, "code_compliance_check": None},
                requires_calculation=["viewing_distance_m", "required_autonomy_min",
                                      "pictogram_standard", "code_compliance_check"],
                tags=["seguridad", "senalizacion"],
                op_description="Senalizacion de salida en la circulacion del %s." % lid,
                derived_from=["HYP_CORRIDOR_WIDTH"],
            )
            out.append({"component_id": cid, "xyz": (px, py, round(e + 2.30, 3)),
                        "kind": "sign", "level": lid})

        # extintores y gabinete de incendio
        for k, (px, py) in enumerate([(8.30, 6.00), (16.00, 12.00)], start=1):
            cid = "SEG-EXT-%s-%02d" % (lid, k)
            K.add_device(
                model, component_id=cid, discipline="security", type="fire_extinguisher",
                name="Extintor %s-%02d" % (lid, k), level_id=lid,
                space_id="ARQ-ESP-%sCIRC" % lid,
                xyz=(px, py, round(e + 1.00, 3)), box=(0.20, 0.20, 0.55),
                material="equipo_generico", ifc_class="IfcFireSuppressionTerminal",
                layer="SEG-INCENDIO",
                parameters={"mounting_height_m": 1.00,
                            "extinguishing_agent": None, "rated_capacity_kg": None,
                            "fire_class_rating": None, "max_travel_distance_m": None,
                            "code_compliance_check": None},
                requires_calculation=["extinguishing_agent", "rated_capacity_kg",
                                      "fire_class_rating", "max_travel_distance_m",
                                      "code_compliance_check"],
                tags=["seguridad", "incendio"],
                op_description=("Extintor en la circulacion del %s. Agente y capacidad sin "
                                "definir: dependen de la evaluacion de riesgo." % lid),
                derived_from=["HYP_CORRIDOR_WIDTH"],
                validation_notes=["Distancia maxima de recorrido no verificada."],
            )
            out.append({"component_id": cid, "xyz": (px, py, round(e + 1.00, 3)),
                        "kind": "extinguisher", "level": lid})

        cid = "SEG-GAB-%s" % lid
        K.add_device(
            model, component_id=cid, discipline="security", type="fire_hose_cabinet",
            name="Gabinete de incendio %s" % lid, level_id=lid,
            space_id="ARQ-ESP-%sCIRC" % lid,
            xyz=(8.30, 11.00, round(e + 1.10, 3)), box=(0.25, 0.80, 0.80),
            material="equipo_generico", ifc_class="IfcFireSuppressionTerminal",
            layer="SEG-INCENDIO",
            parameters={"cabinet_type": "gabinete con manguera (hipotesis de seleccion)",
                        "hose_length_m": None, "nozzle_type": None,
                        "required_flow_lpm": None, "required_pressure_kPa": None,
                        "standpipe_diameter_m": None, "code_compliance_check": None},
            requires_calculation=["hose_length_m", "nozzle_type", "required_flow_lpm",
                                  "required_pressure_kPa", "standpipe_diameter_m",
                                  "code_compliance_check"],
            tags=["seguridad", "incendio"],
            op_description="Gabinete de incendio en la circulacion del %s." % lid,
            derived_from=["HYP_CORRIDOR_WIDTH"],
            validation_notes=["Caudal y presion de la red de incendio sin calcular."],
        )
        out.append({"component_id": cid, "xyz": (8.30, 11.00, round(e + 1.10, 3)),
                    "kind": "cabinet", "level": lid})
    return out


def build_cabling(model, detection: Dict[str, List[Dict[str, Any]]],
                  readers: List[Dict[str, Any]], emergency: List[Dict[str, Any]]) -> None:
    """Cableado de deteccion, control y alimentacion de los dispositivos."""
    px, py = panel_position()
    room = panel_room()
    sx, sy = security_riser()

    # montante de seguridad
    riser = R.riser(sx, sy, 1.00, round(P.LEVELS[-1]["elevation"] + 2.80, 3))
    base = R.manhattan((px, py, 1.85), (sx, sy, 1.00), R.plenum_z(P.LEVELS[0], "security"))
    _, mlen = K.add_route(
        model, component_id="SEG-CAB-MON", discipline="security", type="security_riser",
        name="Montante de cableado de seguridad",
        polylines=[base, riser], diameter=P.HYP_CONDUIT_DIAMETERS["control"],
        material="pvc", ifc_class="IfcCableCarrierSegment", layer="SEG-CANALIZACIONES",
        parameters={"shaft": "ducto tecnico", "circuits": "deteccion, control y alarma",
                    "cable_type": None, "fire_rated_cable": None,
                    "loop_resistance_ohm": None},
        requires_calculation=["cable_type", "fire_rated_cable", "loop_resistance_ohm"],
        tags=["seguridad", "cableado"],
        op_description=("Montante de cableado de seguridad desde el panel hasta el ultimo "
                        "nivel, por el ducto tecnico."),
        derived_from=["SPACE_PROGRAM", "HYP_CORRIDOR_WIDTH", "HYP_CONDUIT_DIAMETERS"],
        flow_direction="bidireccional_senal",
    )

    for level in P.LEVELS:
        lid = level["level_id"]
        e = level["elevation"]
        via = R.plenum_z(level, "security")
        devices = list(detection[lid])
        devices += [d for d in emergency if d["level"] == lid]
        devices += [d for d in readers if d["level"] == lid]
        if not devices:
            continue

        polylines = R.trunk_and_drops((sx, sy, via), [d["xyz"] for d in devices], via)
        cid = "SEG-CAB-%s" % lid
        _, length = K.add_route(
            model, component_id=cid, discipline="security", type="security_cabling",
            name="Cableado de seguridad %s" % lid,
            polylines=polylines, diameter=P.HYP_CONDUIT_DIAMETERS["control"],
            material="pvc", ifc_class="IfcCableCarrierSegment", layer="SEG-CANALIZACIONES",
            level_id=lid,
            parameters={"device_count": len(devices),
                        "devices": [d["component_id"] for d in devices],
                        "cable_type": None, "fire_rated_cable": None,
                        "loop_resistance_ohm": None, "voltage_drop_percent": None},
            requires_calculation=["cable_type", "fire_rated_cable", "loop_resistance_ohm",
                                  "voltage_drop_percent"],
            tags=["seguridad", "cableado"],
            op_description=("Cableado de seguridad del %s: troncal en el vacio tecnico a cota "
                            "%.2f con derivacion a %d dispositivos." % (lid, via, len(devices))),
            derived_from=["HYP_CORRIDOR_WIDTH", "HYP_ROUTING_Z"],
            flow_direction="bidireccional_senal",
        )
        K.link(model, connection_id="CNX-SEG-%s-MON" % lid, discipline="security",
               type="signal_link", origin="SEG-CAB-MON", destination=cid,
               medium="cable_de_control_en_canalizacion", technology="lazo de deteccion",
               parameters={"cable_type": None}, geometry_reference="SOL-%s" % cid,
               length_m=length, flow_direction="bidireccional_senal",
               requires_calculation=["cable_type"])
        for d in devices:
            K.link(model, connection_id="CNX-SEG-%s" % d["component_id"],
                   discipline="security", type="signal_link",
                   origin="SEG-PAN-001", destination=d["component_id"],
                   medium="cable_de_control_en_canalizacion",
                   technology="lazo de deteccion y control",
                   parameters={"via": [cid, "SEG-CAB-MON"], "cable_type": None,
                               "device_kind": d["kind"]},
                   geometry_reference="SOL-%s" % cid,
                   flow_direction="bidireccional_senal",
                   requires_calculation=["cable_type"])


def build(model) -> None:
    build_panel(model)
    detection = build_detection(model)
    build_cctv(model)
    readers = build_access_control(model)
    emergency = build_emergency(model)
    build_cabling(model, detection, readers, emergency)

"""Paquete mecanico y de climatizacion conceptual.

Datos calculados: geometria, trazado y longitud real de cada tramo de tuberia
frigorifica y de ducto, medida sobre su polilinea 3D. Secciones de ducto
tomadas de HYP_DUCT_SECTIONS, que son secciones ADOPTADAS para el trazado.

Pendiente por completo (None): capacidad de refrigeracion y calefaccion,
caudal de aire, carga termica por recinto, perdida de carga, presion estatica,
seleccion de ventilador, nivel sonoro y consumo electrico real. Sin calculo de
carga termica no existe capacidad de equipo, y este paquete no lo inventa.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Tuple

import mepkit as K
import params as P
import routing as R
from discipline_structure import riser_at, shaft_sanitary

CONDITIONED_USES = ("oficina", "sala_reuniones", "sala_juntas", "recepcion",
                    "cuarto_telecom", "archivo")
EXTRACTED_USES = ("bano", "aseo", "cuarto_electrico", "cuarto_hvac", "zona_tecnica")

THERMAL_PENDING = ["cooling_capacity_kW", "heating_capacity_kW", "thermal_load_kW",
                   "airflow_m3_h", "sensible_heat_ratio", "sound_level_dBA",
                   "power_consumption_kW"]
AIR_PENDING = ["design_airflow_m3_h", "pressure_drop_Pa", "verified_section_m",
               "air_velocity_m_s"]

def refrigerant_riser():
    return riser_at("hvac_refrigerant")


def duct_riser():
    return riser_at("hvac_duct")


def outdoor_base():
    """Zona de condensadoras en cubierta, en el tercio este de la planta."""
    return (round(P.REQ_LENGTH_X * 0.80, 3), round(P.REQ_WIDTH_Y * 0.50, 3))


def outdoor_spacing(count: int) -> float:
    """Separacion entre condensadoras, acotada al ancho disponible."""
    usable = max(2.0, P.REQ_WIDTH_Y - 4.0)
    return round(min(3.0, usable / max(1, count)), 3)


def extractor_position():
    """Extractor en cubierta, junto a la vertical del ducto sanitario."""
    sx0, sy0, sx1, sy1 = shaft_sanitary()
    return (round((sx0 + sx1) / 2.0, 3), round(sy0 - 0.70, 3))


# ---------------------------------------------------------------------------
# Unidades interiores
# ---------------------------------------------------------------------------


def build_indoor_units(model) -> Dict[str, List[Dict[str, Any]]]:
    per_level: Dict[str, List[Dict[str, Any]]] = {}
    for level in P.LEVELS:
        lid = level["level_id"]
        e = level["elevation"]
        units: List[Dict[str, Any]] = []
        for sp in sorted(model.spaces_of_level(lid), key=lambda s: s.code):
            if sp.use not in CONDITIONED_USES:
                continue
            n = 2 if sp.area_m2 > 25.0 else 1
            x0, y0, x1, y1 = sp.rect
            for k in range(1, n + 1):
                px = round(x0 + (x1 - x0) * k / (n + 1), 3)
                py = round(y0 + 0.30, 3)
                pz = round(e + 2.40, 3)
                cid = "CLI-UNI-%s-%s-%02d" % (lid, sp.code, k)
                K.add_device(
                    model, component_id=cid, discipline="hvac",
                    type="indoor_unit", name="Unidad interior %s-%02d" % (sp.code, k),
                    level_id=lid, space_id=sp.space_id,
                    xyz=(px, py, pz), box=(0.90, 0.22, 0.30),
                    material="equipo_generico", ifc_class="IfcUnitaryEquipment",
                    layer="CLI-EQUIPOS",
                    parameters={
                        "unit_type": "evaporadora de pared (hipotesis de seleccion)",
                        "mounting_height_m": 2.40,
                        "served_space": sp.space_id,
                        "served_area_m2": sp.area_m2,
                        "units_in_space": n,
                        "refrigerant": None,
                        "cooling_capacity_kW": None, "heating_capacity_kW": None,
                        "thermal_load_kW": None, "airflow_m3_h": None,
                        "sound_level_dBA": None, "power_consumption_kW": None,
                        "condensate_drain": None,
                    },
                    requires_calculation=THERMAL_PENDING + ["refrigerant", "condensate_drain"],
                    tags=["climatizacion", "unidad interior"],
                    op_description=("Unidad interior %s en el recinto %s (%.2f m2), montada a "
                                    "2.40 m. Cantidad por recinto definida por umbral "
                                    "geometrico de 25 m2, no por carga termica."
                                    % (cid, sp.code, sp.area_m2)),
                    derived_from=["CONDITIONED_USES", "SPACE_PROGRAM"],
                    validation_notes=["Sin calculo de carga termica no hay capacidad asignable."],
                )
                model.relate(cid, "serves_space", sp.space_id)
                units.append({"component_id": cid, "xyz": (px, py, pz),
                              "space": sp.space_id, "code": sp.code})
        per_level[lid] = units
    return per_level


# ---------------------------------------------------------------------------
# Unidades exteriores en cubierta
# ---------------------------------------------------------------------------


def build_outdoor_units(model, indoor: Dict[str, List[Dict[str, Any]]]) -> Dict[str, str]:
    rz = P.ROOF_LEVEL["elevation"]
    mapping: Dict[str, str] = {}
    for i, level in enumerate(P.LEVELS):
        lid = level["level_id"]
        bx, by = outdoor_base()
        step = outdoor_spacing(len(P.LEVELS))
        px = round(bx, 3)
        py = round(by + (i - (len(P.LEVELS) - 1) / 2.0) * step, 3)
        cid = "CLI-EXT-%s" % lid
        K.add_device(
            model, component_id=cid, discipline="hvac", type="outdoor_unit",
            name="Unidad exterior %s" % lid, level_id="NC",
            xyz=(px, py, round(rz + 0.55, 3)), box=(1.20, 0.70, 1.10),
            material="equipo_generico", ifc_class="IfcUnitaryEquipment",
            layer="CLI-EQUIPOS",
            parameters={
                "unit_type": "condensadora en cubierta (hipotesis de seleccion)",
                "served_level": lid,
                "served_indoor_units": [u["component_id"] for u in indoor[lid]],
                "indoor_unit_count": len(indoor[lid]),
                "electrical_system": P.HYP_SYSTEM_VOLTAGES["climatizacion"]["system"],
                "nominal_voltage_v": P.HYP_SYSTEM_VOLTAGES["climatizacion"]["voltage_v"],
                "phases": P.HYP_SYSTEM_VOLTAGES["climatizacion"]["phases"],
                "refrigerant": None, "cooling_capacity_kW": None,
                "heating_capacity_kW": None, "thermal_load_kW": None,
                "power_consumption_kW": None, "sound_level_dBA": None,
                "mounting_base_design": None,
            },
            requires_calculation=THERMAL_PENDING + ["refrigerant", "mounting_base_design"],
            tags=["climatizacion", "unidad exterior"],
            op_description=("Unidad exterior del %s sobre cubierta, asociada a %d unidades "
                            "interiores." % (lid, len(indoor[lid]))),
            derived_from=["REQ_LENGTH_X", "REQ_WIDTH_Y", "ROOF_LEVEL", "HYP_SYSTEM_VOLTAGES"],
            validation_notes=["Capacidad sin determinar: requiere calculo de carga termica."],
        )
        mapping[lid] = cid
    return mapping


# ---------------------------------------------------------------------------
# Tuberia frigorifica
# ---------------------------------------------------------------------------


def build_refrigerant_piping(model, indoor: Dict[str, List[Dict[str, Any]]],
                             outdoor: Dict[str, str]) -> None:
    rx, ry = refrigerant_riser()
    rz = P.ROOF_LEVEL["elevation"]

    for level in P.LEVELS:
        lid = level["level_id"]
        e = level["elevation"]
        via = R.plenum_z(level, "hvac")
        units = indoor[lid]
        if not units:
            continue

        collector = (rx, ry, via)
        polylines = R.trunk_and_drops(collector, [u["xyz"] for u in units], via)
        # montante hasta la unidad exterior en cubierta
        polylines.append(R.riser(rx, ry, via, round(rz + 0.40, 3)))
        ou = outdoor[lid]
        ox, oy = model.components[ou].position[0], model.components[ou].position[1]
        polylines.append(R.manhattan((rx, ry, round(rz + 0.40, 3)),
                                     (ox, oy, round(rz + 0.40, 3)),
                                     round(rz + 0.40, 3)))

        cid = "CLI-FRI-%s" % lid
        _, length = K.add_route(
            model, component_id=cid, discipline="hvac", type="refrigerant_pipe",
            name="Tuberia frigorifica %s" % lid,
            polylines=polylines, diameter=0.0191, material="cobre",
            ifc_class="IfcPipeSegment", layer="CLI-FRIGORIFICA", level_id=lid,
            parameters={
                "nominal_diameter_m": 0.0191,
                "served_indoor_units": [u["component_id"] for u in units],
                "outdoor_unit": ou, "unit_count": len(units),
                "insulation": "aislamiento de tuberia requerido",
                "refrigerant": None, "verified_diameter_m": None,
                "pressure_drop_kPa": None, "max_equivalent_length_m": None,
                "refrigerant_charge_kg": None,
            },
            requires_calculation=["refrigerant", "verified_diameter_m", "pressure_drop_kPa",
                                  "max_equivalent_length_m", "refrigerant_charge_kg"],
            tags=["climatizacion", "frigorifica"],
            op_description=("Tuberia frigorifica del %s: troncal en el vacio tecnico a cota "
                            "%.2f con derivacion a %d unidades interiores, montante por el "
                            "ducto tecnico y tramo en cubierta hasta la unidad exterior."
                            % (lid, via, len(units))),
            derived_from=["HYP_ROUTING_Z", "HYP_CORRIDOR_WIDTH", "REQ_LENGTH_X"],
            flow_direction="bidireccional_refrigerante",
            validation_notes=["La longitud equivalente maxima admisible no esta verificada."],
        )
        K.link(model, connection_id="CNX-CLI-FRI-%s" % lid, discipline="hvac",
               type="refrigerant_connection", origin=ou, destination=cid,
               medium="tuberia_de_cobre_frigorifica", technology="circuito de refrigerante",
               parameters={"unit_count": len(units), "refrigerant": None,
                           "max_equivalent_length_m": None},
               geometry_reference="SOL-%s" % cid, length_m=length,
               flow_direction="bidireccional_refrigerante",
               requires_calculation=["refrigerant", "max_equivalent_length_m"])
        for u in units:
            K.link(model, connection_id="CNX-CLI-%s" % u["component_id"], discipline="hvac",
                   type="refrigerant_connection", origin=cid, destination=u["component_id"],
                   medium="tuberia_de_cobre_frigorifica", technology="derivacion a evaporadora",
                   parameters={"refrigerant": None, "verified_diameter_m": None},
                   geometry_reference="SOL-%s" % cid,
                   flow_direction="bidireccional_refrigerante",
                   requires_calculation=["refrigerant", "verified_diameter_m"])


# ---------------------------------------------------------------------------
# Ventilacion mecanica: ductos, rejillas, difusores y extractores
# ---------------------------------------------------------------------------


def build_ventilation(model) -> None:
    dx, dy = duct_riser()
    rz = P.ROOF_LEVEL["elevation"]
    main_w, main_h = P.HYP_DUCT_SECTIONS["principal"]
    br_w, br_h = P.HYP_DUCT_SECTIONS["extraccion_bano"]

    # Extractor en cubierta
    ex, ey = extractor_position()
    K.add_device(
        model, component_id="CLI-EXTR-001", discipline="hvac", type="exhaust_fan",
        name="Extractor de cubierta", level_id="NC",
        xyz=(ex, ey, round(rz + 0.45, 3)), box=(0.60, 0.60, 0.70),
        material="acero_galvanizado", ifc_class="IfcFan", layer="CLI-EQUIPOS",
        parameters={"fan_type": "extractor centrifugo en cubierta (hipotesis)",
                    "served_spaces": "banos, aseo y recintos tecnicos",
                    "design_airflow_m3_h": None, "static_pressure_Pa": None,
                    "power_consumption_kW": None, "sound_level_dBA": None,
                    "electrical_system": P.HYP_SYSTEM_VOLTAGES["climatizacion"]["system"],
                    "nominal_voltage_v": P.HYP_SYSTEM_VOLTAGES["climatizacion"]["voltage_v"],
                    "phases": P.HYP_SYSTEM_VOLTAGES["climatizacion"]["phases"]},
        requires_calculation=["design_airflow_m3_h", "static_pressure_Pa",
                              "power_consumption_kW", "sound_level_dBA"],
        tags=["climatizacion", "ventilacion", "extractor"],
        op_description="Extractor centrifugo sobre cubierta, descarga del sistema de extraccion.",
        derived_from=["SPACE_PROGRAM", "HYP_SYSTEM_VOLTAGES"],
        validation_notes=["Caudal y presion estatica sin calcular."],
    )

    # Montante de extraccion
    riser = R.riser(dx, dy, round(P.LEVELS[0]["elevation"] + 2.80, 3), round(rz + 0.15, 3))
    top = R.manhattan((dx, dy, round(rz + 0.15, 3)), (ex, ey, round(rz + 0.15, 3)),
                      round(rz + 0.15, 3))
    _, rlen = K.add_route(
        model, component_id="CLI-DUC-MON", discipline="hvac", type="exhaust_riser",
        name="Montante de extraccion",
        polylines=[riser, top], section=(main_w, main_h),
        material="acero_galvanizado", ifc_class="IfcDuctSegment", layer="CLI-DUCTOS",
        parameters={"adopted_section_m": [main_w, main_h], "shaft": "ducto tecnico",
                    "design_airflow_m3_h": None, "pressure_drop_Pa": None,
                    "verified_section_m": None, "air_velocity_m_s": None},
        requires_calculation=AIR_PENDING,
        tags=["climatizacion", "ducto"],
        op_description=("Montante de extraccion de seccion adoptada %.2f x %.2f m desde el N1 "
                        "hasta el extractor de cubierta." % (main_w, main_h)),
        derived_from=["HYP_DUCT_SECTIONS", "HYP_CORRIDOR_WIDTH", "SPACE_PROGRAM"],
        flow_direction="ascendente_aire_extraido",
    )
    K.link(model, connection_id="CNX-CLI-MON-EXTR", discipline="hvac",
           type="duct_connection", origin="CLI-DUC-MON", destination="CLI-EXTR-001",
           medium="ducto_de_acero_galvanizado", technology="extraccion mecanica",
           parameters={"adopted_section_m": [main_w, main_h], "design_airflow_m3_h": None},
           geometry_reference="SOL-CLI-DUC-MON", length_m=rlen,
           flow_direction="ducto_hacia_extractor", requires_calculation=AIR_PENDING)

    for level in P.LEVELS:
        lid = level["level_id"]
        e = level["elevation"]
        via = R.plenum_z(level, "hvac")
        targets = [sp for sp in sorted(model.spaces_of_level(lid), key=lambda s: s.code)
                   if sp.use in EXTRACTED_USES]
        if not targets:
            continue

        grille_points: List[Tuple[float, float, float]] = []
        for sp in targets:
            x0, y0, x1, y1 = sp.rect
            # Desplazada del centro geometrico para no coincidir con la
            # luminaria ni con el detector de humo del mismo recinto.
            gx = round((x0 + x1) / 2 - 0.70, 3)
            gy = round((y0 + y1) / 2 - 0.75, 3)
            gz = round(R.ceiling_z(level) - 0.05, 3)
            cid = "CLI-REJ-%s-%s" % (lid, sp.code)
            K.add_device(
                model, component_id=cid, discipline="hvac", type="exhaust_grille",
                name="Rejilla de extraccion %s" % sp.code, level_id=lid,
                space_id=sp.space_id, xyz=(gx, gy, gz), box=(0.30, 0.30, 0.05),
                material="aluminio", ifc_class="IfcAirTerminal", layer="CLI-REJILLAS",
                parameters={"terminal_type": "rejilla de extraccion en cielo raso",
                            "served_space": sp.space_id, "served_area_m2": sp.area_m2,
                            "design_airflow_m3_h": None, "free_area_ratio": None,
                            "pressure_drop_Pa": None, "throw_m": None},
                requires_calculation=["design_airflow_m3_h", "free_area_ratio",
                                      "pressure_drop_Pa", "throw_m"],
                tags=["climatizacion", "rejilla"],
                op_description=("Rejilla de extraccion en el recinto %s, centrada en planta a "
                                "cota de cielo raso." % sp.code),
                derived_from=["EXTRACTED_USES", "HYP_CEILING_HEIGHT"],
            )
            model.relate(cid, "serves_space", sp.space_id)
            grille_points.append((gx, gy, gz))

        branch = R.trunk_and_drops((dx, dy, via), grille_points, via)
        cid = "CLI-DUC-%s" % lid
        _, blen = K.add_route(
            model, component_id=cid, discipline="hvac", type="exhaust_duct",
            name="Ductos de extraccion %s" % lid,
            polylines=branch, section=(br_w, br_h), material="acero_galvanizado",
            ifc_class="IfcDuctSegment", layer="CLI-DUCTOS", level_id=lid,
            parameters={"adopted_section_m": [br_w, br_h],
                        "served_grilles": len(grille_points),
                        "design_airflow_m3_h": None, "pressure_drop_Pa": None,
                        "verified_section_m": None, "air_velocity_m_s": None},
            requires_calculation=AIR_PENDING,
            tags=["climatizacion", "ducto"],
            op_description=("Ductos de extraccion del %s: troncal en el vacio tecnico a cota "
                            "%.2f con derivacion a %d rejillas, seccion adoptada %.2f x %.2f m."
                            % (lid, via, len(grille_points), br_w, br_h)),
            derived_from=["HYP_DUCT_SECTIONS", "HYP_ROUTING_Z", "HYP_CORRIDOR_WIDTH"],
            flow_direction="recintos_hacia_montante",
        )
        K.link(model, connection_id="CNX-CLI-DUC-%s-MON" % lid, discipline="hvac",
               type="duct_connection", origin=cid, destination="CLI-DUC-MON",
               medium="ducto_de_acero_galvanizado", technology="conexion a montante",
               parameters={"adopted_section_m": [br_w, br_h]},
               geometry_reference="SOL-%s" % cid, length_m=blen,
               flow_direction="nivel_hacia_montante", requires_calculation=AIR_PENDING)
        for sp in targets:
            K.link(model, connection_id="CNX-CLI-REJ-%s-%s" % (lid, sp.code),
                   discipline="hvac", type="duct_connection",
                   origin="CLI-REJ-%s-%s" % (lid, sp.code), destination=cid,
                   medium="ducto_de_acero_galvanizado", technology="derivacion a rejilla",
                   parameters={"design_airflow_m3_h": None},
                   geometry_reference="SOL-%s" % cid,
                   flow_direction="rejilla_hacia_ducto", requires_calculation=AIR_PENDING)

    # Difusores de impulsion en los recintos climatizados de mayor tamano
    for level in P.LEVELS:
        lid = level["level_id"]
        for sp in sorted(model.spaces_of_level(lid), key=lambda s: s.code):
            if sp.use not in ("sala_reuniones", "sala_juntas", "recepcion"):
                continue
            x0, y0, x1, y1 = sp.rect
            gx = round((x0 + x1) / 2, 3)
            gy = round((y0 + y1) / 2 + 0.80, 3)
            gz = round(R.ceiling_z(level) - 0.05, 3)
            cid = "CLI-DIF-%s-%s" % (lid, sp.code)
            K.add_device(
                model, component_id=cid, discipline="hvac", type="supply_diffuser",
                name="Difusor de impulsion %s" % sp.code, level_id=lid,
                space_id=sp.space_id, xyz=(gx, gy, gz), box=(0.40, 0.40, 0.05),
                material="aluminio", ifc_class="IfcAirTerminal", layer="CLI-REJILLAS",
                parameters={"terminal_type": "difusor de 4 vias en cielo raso",
                            "served_space": sp.space_id, "served_area_m2": sp.area_m2,
                            "design_airflow_m3_h": None, "throw_m": None,
                            "pressure_drop_Pa": None, "sound_level_dBA": None},
                requires_calculation=["design_airflow_m3_h", "throw_m", "pressure_drop_Pa",
                                      "sound_level_dBA"],
                tags=["climatizacion", "difusor"],
                op_description=("Difusor de impulsion en el recinto %s. La asignacion de "
                                "caudal requiere calculo de ventilacion." % sp.code),
                derived_from=["SPACE_PROGRAM", "HYP_CEILING_HEIGHT"],
            )
            model.relate(cid, "serves_space", sp.space_id)


def build(model) -> None:
    indoor = build_indoor_units(model)
    outdoor = build_outdoor_units(model, indoor)
    build_refrigerant_piping(model, indoor, outdoor)
    build_ventilation(model)

"""Orquestador: construye el modelo, las laminas y el expediente completo.

Uso:
    python build.py [directorio_de_salida]

Produce el arbol EMBEDVERSE_BUILDING_001/ descrito en la solicitud, verificando
cada archivo generado por relectura. Nada se declara entregado sin esa
comprobacion.
"""

from __future__ import annotations

import datetime
import json
import os
import shutil
import sys
import time
from typing import Any, Dict, List, Optional, Sequence, Tuple

import params as P
import export_data as XD
import export_drawings as XG
import export_model as XM
import sheets as SH
import sheets_mep as SM
import validate as VAL
from catalog import BuildingModel, VALIDATION_GEOMETRY_OK
from oplog import OperationLog

import discipline_architecture as ARCH
import discipline_electrical as ELEC
import discipline_hvac as HVAC
import discipline_hydrosanitary as HYDRO
import discipline_security as SEC
import discipline_structure as STRUCT
import discipline_telecom as TELE

GENERATION_DATE = datetime.date.today().isoformat()

TREE = [
    "01_INPUT", "01_INPUT/source_documents",
    "02_3D_MODEL", "02_3D_MODEL/geometry",
    "03_ARCHITECTURE", "03_ARCHITECTURE/floor_01", "03_ARCHITECTURE/floor_02",
    "03_ARCHITECTURE/floor_03", "03_ARCHITECTURE/elevations", "03_ARCHITECTURE/sections",
    "04_STRUCTURE", "04_STRUCTURE/structural_plans", "04_STRUCTURE/components",
    "04_STRUCTURE/connections",
    "05_ELECTRICAL", "05_ELECTRICAL/lighting", "05_ELECTRICAL/outlets",
    "05_ELECTRICAL/circuits", "05_ELECTRICAL/diagrams",
    "06_TELECOMMUNICATIONS", "06_TELECOMMUNICATIONS/network",
    "06_TELECOMMUNICATIONS/wifi", "06_TELECOMMUNICATIONS/topology",
    "07_HYDROSANITARY", "07_HYDROSANITARY/water", "07_HYDROSANITARY/drainage",
    "07_HYDROSANITARY/isometrics",
    "08_HVAC", "08_HVAC/ducts", "08_HVAC/equipment", "08_HVAC/ventilation",
    "09_SECURITY", "09_SECURITY/cameras", "09_SECURITY/alarms",
    "09_SECURITY/fire_protection",
    "10_PROCEDURES",
    "11_DRAWINGS", "11_DRAWINGS/pdf", "11_DRAWINGS/dxf", "11_DRAWINGS/svg",
    "11_DRAWINGS/metadata",
    "12_VALIDATION",
    "13_DATASET",
]

# Carpeta de destino de cada lamina segun su codigo.
SHEET_FOLDER = [
    ("ARQ-P-N1", "03_ARCHITECTURE/floor_01"),
    ("ARQ-P-N2", "03_ARCHITECTURE/floor_02"),
    ("ARQ-P-N3", "03_ARCHITECTURE/floor_03"),
    ("ARQ-F-", "03_ARCHITECTURE/elevations"),
    ("ARQ-C-", "03_ARCHITECTURE/sections"),
    ("ARQ-", "03_ARCHITECTURE"),
    ("EST-D-", "04_STRUCTURE/connections"),
    ("EST-T-", "04_STRUCTURE/components"),
    ("EST-", "04_STRUCTURE/structural_plans"),
    ("ELE-P-ILU", "05_ELECTRICAL/lighting"),
    ("ELE-P-TOM", "05_ELECTRICAL/outlets"),
    ("ELE-T-", "05_ELECTRICAL/circuits"),
    ("ELE-D-", "05_ELECTRICAL/diagrams"),
    ("ELE-", "05_ELECTRICAL"),
    ("TEL-P-RED", "06_TELECOMMUNICATIONS/network"),
    ("TEL-P-WIFI", "06_TELECOMMUNICATIONS/wifi"),
    ("TEL-D-TOP", "06_TELECOMMUNICATIONS/topology"),
    ("TEL-", "06_TELECOMMUNICATIONS"),
    ("HID-P-AGU", "07_HYDROSANITARY/water"),
    ("HID-P-DES", "07_HYDROSANITARY/drainage"),
    ("HID-I-", "07_HYDROSANITARY/isometrics"),
    ("HID-", "07_HYDROSANITARY"),
    ("CLI-P-DUC", "08_HVAC/ducts"),
    ("CLI-P-EQU", "08_HVAC/equipment"),
    ("CLI-T-", "08_HVAC/equipment"),
    ("CLI-", "08_HVAC/ventilation"),
    ("SEG-", "09_SECURITY"),
    ("MOD-", "02_3D_MODEL"),
]


def sheet_folder(code: str) -> str:
    for prefix, folder in SHEET_FOLDER:
        if code.startswith(prefix):
            return folder
    return "11_DRAWINGS"


def log(msg: str) -> None:
    print(msg, flush=True)


# ---------------------------------------------------------------------------
# Construccion del modelo
# ---------------------------------------------------------------------------


def build_model() -> BuildingModel:
    oplog = OperationLog()
    model = BuildingModel(oplog)
    for name, mod in (("estructura", STRUCT), ("arquitectura", ARCH),
                      ("electrico", ELEC), ("telecomunicaciones", TELE),
                      ("hidrosanitario", HYDRO), ("climatizacion", HVAC),
                      ("seguridad", SEC)):
        t0 = time.time()
        mod.build(model)
        log("   %-20s %5d componentes   %5.1fs"
            % (name, len(model.components), time.time() - t0))
    ELEC.build_equipment_circuits(model)
    log("   %-20s %5d componentes" % ("circuitos de fuerza", len(model.components)))
    return model


def build_sheets(model, clashes: Optional[List[Dict[str, Any]]] = None) -> List:
    out: List = []
    for name, fn in (("arquitectura", SH.architecture_sheets),
                     ("estructura", SH.structure_sheets),
                     ("electrico", SM.electrical_sheets),
                     ("telecomunicaciones", SM.telecom_sheets),
                     ("hidrosanitario", SM.hydrosanitary_sheets),
                     ("climatizacion", SM.hvac_sheets),
                     ("seguridad", SM.security_sheets)):
        t0 = time.time()
        s = fn(model)
        out.extend(s)
        log("   %-20s %3d laminas  %6.1fs" % (name, len(s), time.time() - t0))
    s = SM.model_sheets(model, clashes)
    out.extend(s)
    log("   %-20s %3d laminas" % ("modelo integral", len(s)))
    return out


def attach_drawing_refs(model, sheets: Sequence) -> Dict[str, List[str]]:
    solid_to_comp: Dict[str, str] = {}
    for c in model.components.values():
        if c.geometry_reference:
            solid_to_comp[c.geometry_reference] = c.component_id
    index: Dict[str, List[str]] = {}
    for sh in sheets:
        for sid in sh.component_refs:
            cid = solid_to_comp.get(sid)
            if cid is None:
                continue
            model.attach_drawing(cid, sh.code)
            index.setdefault(cid, [])
            if sh.code not in index[cid]:
                index[cid].append(sh.code)
    return index


# ---------------------------------------------------------------------------
# Escritura del expediente
# ---------------------------------------------------------------------------


def write_package(model, sheets: Sequence, out_root: str) -> Dict[str, Any]:
    manifest: Dict[str, Any] = {"files": [], "verification": []}

    def record(entry: Dict[str, Any], category: str) -> None:
        e = dict(entry)
        e["category"] = category
        if "path" in e:
            e["path"] = os.path.relpath(e["path"], out_root)
        manifest["files"].append(e)

    for d in TREE:
        os.makedirs(os.path.join(out_root, d), exist_ok=True)

    J = lambda *p: os.path.join(out_root, *p)

    # ---- 01_INPUT ----
    log("-> 01_INPUT")
    record(XD.write_json(J("01_INPUT", "project_request.json"),
                         XD.project_request(GENERATION_DATE)), "input")
    record(XD.write_json(J("01_INPUT", "specifications.json"),
                         XD.specifications(GENERATION_DATE)), "input")
    record(XD.write_json(J("01_INPUT", "source_documents", "source_documents.json"), {
        "schema": "embedverse-source-documents/1.0",
        "statement": ("No se utilizo ningun documento de origen para generar este "
                      "expediente. La geometria procede unicamente de los parametros de la "
                      "solicitud y de las hipotesis declaradas en 01_INPUT/specifications.json."),
        "documents": [],
        "note": ("La carpeta Planos/ del repositorio NO se ha leido ni incorporado. Si en el "
                 "futuro se ingiere, cada dato extraido debe citar archivo, pagina y region, "
                 "y debe revisarse su licencia antes de usarlo para entrenamiento."),
    }), "input")

    # ---- 02_3D_MODEL ----
    log("-> 02_3D_MODEL  (IFC4, GLB, OBJ, STEP)")
    record(XM.write_ifc(model, J("02_3D_MODEL", "building.ifc")), "model_3d")
    record(XM.write_glb(model, J("02_3D_MODEL", "building.glb")), "model_3d")
    record(XM.write_obj(model, J("02_3D_MODEL", "building.obj")), "model_3d")
    record(XM.write_step(model, J("02_3D_MODEL", "building.step")), "model_3d")
    for e in XM.write_discipline_glb(model, J("02_3D_MODEL", "geometry")):
        record(e, "model_3d_by_discipline")
    record(XD.write_json(J("02_3D_MODEL", "geometry", "solids.json"), {
        "schema": "embedverse-solid-registry/1.0",
        "count": len(model.solids),
        "note": ("Receta parametrica de cada solido: primitivas, dimensiones y volumen. "
                 "Es la fuente desde la que se generan el 3D y todas las vistas 2D."),
        "solids": [model.solids[k].describe() for k in sorted(model.solids)],
    }), "model_3d")

    # ---- laminas ----
    log("-> 11_DRAWINGS  (%d laminas x DXF/PDF/SVG)" % len(sheets))
    sheet_index: List[Dict[str, Any]] = []
    by_folder: Dict[str, List[Dict[str, Any]]] = {}
    for sh in sheets:
        base = sh.code
        dxf = XG.write_dxf(sh, J("11_DRAWINGS", "dxf", base + ".dxf"))
        pdf = XG.write_pdf(sh, J("11_DRAWINGS", "pdf", base + ".pdf"))
        svg = XG.write_svg(sh, J("11_DRAWINGS", "svg", base + ".svg"))
        vdxf = XG.verify_dxf(dxf["path"])
        vpdf = XG.verify_pdf(pdf["path"])
        vsvg = XG.verify_svg(svg["path"])
        record(dxf, "drawing_dxf")
        record(pdf, "drawing_pdf")
        record(svg, "drawing_svg")
        manifest["verification"].append({
            "sheet": base, "dxf": vdxf, "pdf": vpdf, "svg": vsvg,
            "entities_match": vdxf["entities"] == pdf["entities"] == svg["entities"],
        })
        meta = {
            "schema": "embedverse-sheet/1.0",
            "sheet_id": sh.sheet_id, "code": sh.code, "title": sh.title,
            "discipline": sh.discipline, "view_kind": sh.view_kind,
            "level": sh.level_label, "scale": sh.scale,
            "scale_label": "1:%d" % sh.scale if sh.scale > 1 else "sin escala",
            "paper": sh.paper, "paper_size_mm": list(sh.size_mm),
            "version": sh.version, "subtitle": sh.subtitle,
            "fits_drawing_area": sh.fits(),
            "model_origin": list(sh.origin_model), "viewport_mm": list(sh.viewport_mm),
            "legend": [list(x) for x in sh.legend], "notes": sh.notes,
            "referenced_solids": sh.component_refs,
            "files": {
                "dxf": os.path.relpath(dxf["path"], out_root),
                "pdf": os.path.relpath(pdf["path"], out_root),
                "svg": os.path.relpath(svg["path"], out_root),
            },
            "entity_counts": {"dxf": vdxf["entities"], "pdf": pdf["entities"],
                              "svg": svg["entities"]},
            "professional_review": "not_reviewed",
        }
        XD.write_json(J("11_DRAWINGS", "metadata", base + ".json"), meta)
        sheet_index.append({k: meta[k] for k in
                            ("code", "title", "discipline", "view_kind", "level",
                             "scale_label", "paper", "files", "fits_drawing_area")})
        by_folder.setdefault(sheet_folder(sh.code), []).append(sheet_index[-1])

    record(XD.write_json(J("11_DRAWINGS", "metadata", "sheet_index.json"), {
        "schema": "embedverse-sheet-index/1.0",
        "project_id": P.PROJECT_ID,
        "sheet_count": len(sheet_index),
        "formats": {"dxf": "R2018 (AC1032), unidades en metros",
                    "pdf": "vectorial a tamano real de lamina",
                    "svg": "vectorial en milimetros de lamina"},
        "dwg_note": ("No se entrega DWG: no hay en este entorno un conversor con licencia "
                     "adecuada. El DXF R2018 es editable y lo abren AutoCAD, BricsCAD, "
                     "LibreCAD, QCAD y FreeCAD. Vease 12_VALIDATION/format_report.json."),
        "sheets": sheet_index,
    }), "drawing_index")

    for folder, items in sorted(by_folder.items()):
        XD.write_json(J(folder, "drawings.json"), {
            "schema": "embedverse-folder-drawings/1.0",
            "folder": folder,
            "count": len(items),
            "note": ("Los archivos de dibujo se almacenan una sola vez en 11_DRAWINGS para "
                     "evitar duplicados. Las rutas son relativas a la raiz del paquete."),
            "sheets": items,
        })

    # ---- datos por disciplina ----
    log("-> datos por disciplina (JSON + CSV)")
    disc_folder = {
        "architecture": "03_ARCHITECTURE", "structure": "04_STRUCTURE",
        "electrical": "05_ELECTRICAL", "telecommunications": "06_TELECOMMUNICATIONS",
        "hydrosanitary": "07_HYDROSANITARY", "hvac": "08_HVAC", "security": "09_SECURITY",
    }
    for disc, folder in disc_folder.items():
        record(XD.write_json(J(folder, "components.json"),
                             XD.components_payload(model, disc)), "discipline_data")
        record(XD.write_csv(J(folder, "components.csv"), XD.COMPONENT_CSV_HEADERS,
                            XD.components_rows(model, disc)), "discipline_data")
        record(XD.write_json(J(folder, "connections.json"),
                             XD.connections_payload(model, disc)), "discipline_data")
        record(XD.write_csv(J(folder, "connections.csv"), XD.CONNECTION_CSV_HEADERS,
                            XD.connections_rows(model, disc)), "discipline_data")

    # arquitectura: espacios por planta
    for i, level in enumerate(P.LEVELS, start=1):
        lid = level["level_id"]
        f = "03_ARCHITECTURE/floor_%02d" % i
        record(XD.write_csv(J(f, "spaces.csv"), XD.SPACE_CSV_HEADERS,
                            XD.spaces_rows(model, lid)), "discipline_data")
        record(XD.write_json(J(f, "spaces.json"), {
            "schema": "embedverse-space-registry/1.0", "level": lid,
            "count": len(model.spaces_of_level(lid)),
            "spaces": [s.to_dict() for s in
                       sorted(model.spaces_of_level(lid), key=lambda s: s.code)],
        }), "discipline_data")
    record(XD.write_csv(J("03_ARCHITECTURE", "spaces_all.csv"), XD.SPACE_CSV_HEADERS,
                        XD.spaces_rows(model)), "discipline_data")

    # estructura: componentes y conexiones en sus subcarpetas
    record(XD.write_csv(J("04_STRUCTURE/components", "structural_components.csv"),
                        XD.COMPONENT_CSV_HEADERS, XD.components_rows(model, "structure")),
           "discipline_data")
    record(XD.write_csv(J("04_STRUCTURE/connections", "structural_connections.csv"),
                        XD.CONNECTION_CSV_HEADERS, XD.connections_rows(model, "structure")),
           "discipline_data")

    # electrico: circuitos
    circ_headers = ["component_id", "level_id", "circuit_kind", "nominal_voltage_v", "phases",
                    "system", "connected_power_w", "derived_current_a", "current_derivation",
                    "power_factor_assumed", "point_count", "conductor_material",
                    "conductor_gauge", "insulation_type", "conduit_diameter_m",
                    "route_length_m", "protection_rating", "protection_curve",
                    "voltage_drop_percent", "origin", "destination"]
    rows = []
    for c in sorted(model.by_type("circuit") + model.by_type("equipment_circuit"),
                    key=lambda c: c.component_id):
        p = c.parameters
        rows.append([c.component_id, c.level_id, p.get("circuit_kind"),
                     p.get("nominal_voltage_v"), p.get("phases"), p.get("system"),
                     p.get("connected_power_w"), p.get("derived_current_a"),
                     p.get("current_derivation"), p.get("power_factor_assumed"),
                     p.get("point_count"), p.get("conductor_material"),
                     p.get("conductor_gauge"), p.get("insulation_type"),
                     p.get("conduit_diameter_m"), p.get("route_length_m"),
                     p.get("protection_rating"), p.get("protection_curve"),
                     p.get("voltage_drop_percent"), p.get("origin"),
                     XD._flat(p.get("destination"))])
    record(XD.write_csv(J("05_ELECTRICAL/circuits", "circuits.csv"), circ_headers, rows),
           "discipline_data")
    record(XD.write_json(J("05_ELECTRICAL/circuits", "circuits.json"), {
        "schema": "embedverse-circuit-schedule/1.0",
        "count": len(rows),
        "current_policy": (
            "La corriente se declara solo cuando existen tension, potencia y factor de "
            "potencia. En los circuitos de fuerza la potencia del equipo no esta "
            "determinada, por lo que la corriente queda en null."),
        "pending_everywhere": ["conductor_gauge", "insulation_type", "protection_rating",
                               "protection_curve", "voltage_drop_percent"],
        "circuits": [dict(zip(circ_headers, r)) for r in rows],
    }), "discipline_data")
    for sub, types in (("lighting", ("luminaire", "switch")),
                       ("outlets", ("socket_outlet",))):
        rws = []
        for t in types:
            for c in sorted(model.by_type(t), key=lambda c: c.component_id):
                rws.append([c.component_id, c.type, c.level_id, c.space_id,
                            c.position[0], c.position[1], c.position[2],
                            c.parameters.get("nominal_power_w")
                            or c.parameters.get("declared_demand_w"),
                            c.parameters.get("nominal_voltage_v"),
                            XD._flat(c.requires_calculation)])
        record(XD.write_csv(J("05_ELECTRICAL", sub, "%s.csv" % sub),
                            ["component_id", "type", "level_id", "space_id", "x", "y", "z",
                             "declared_power_w", "nominal_voltage_v", "requires_calculation"],
                            rws), "discipline_data")

    # telecom
    for sub, types in (("network", ("data_outlet", "switch", "cabinet", "rack", "router")),
                       ("wifi", ("wireless_access_point", "antenna"))):
        rws = []
        for t in types:
            for c in sorted(model.by_type(t), key=lambda c: c.component_id):
                if c.discipline != "telecommunications":
                    continue
                rws.append([c.component_id, c.type, c.level_id, c.space_id,
                            c.position[0], c.position[1], c.position[2],
                            XD._flat(c.requires_calculation)])
        record(XD.write_csv(J("06_TELECOMMUNICATIONS", sub, "%s.csv" % sub),
                            ["component_id", "type", "level_id", "space_id", "x", "y", "z",
                             "requires_calculation"], rws), "discipline_data")
    record(XD.write_json(J("06_TELECOMMUNICATIONS/topology", "topology.json"), {
        "schema": "embedverse-network-topology/1.0",
        "nodes": [{"component_id": c.component_id, "type": c.type, "level": c.level_id,
                   "name": c.name}
                  for c in sorted(model.by_discipline("telecommunications"),
                                  key=lambda c: c.component_id)
                  if c.type in ("router", "switch", "rack", "cabinet",
                                "wireless_access_point", "antenna", "data_outlet")],
        "links": [cx.to_dict() for cx in
                  sorted(model.connections_of_discipline("telecommunications"),
                         key=lambda c: c.connection_id)
                  if cx.type == "network_link"],
        "note": "Topologia en estrella por nivel con troncal optica vertical.",
    }), "discipline_data")

    # hidrosanitario
    for sub, types in (("water", ("water_service", "water_meter", "water_tank", "pump",
                                  "water_riser", "water_branch", "valve", "pumping_main",
                                  "suction_pipe")),
                       ("drainage", ("drain_stack", "drain_branch", "vent_stack",
                                     "rain_leader", "rain_branch", "roof_drain",
                                     "sanitary_fixture"))):
        rws = []
        for t in types:
            for c in sorted(model.by_type(t), key=lambda c: c.component_id):
                p = c.parameters
                rws.append([c.component_id, c.type, c.level_id, c.space_id,
                            p.get("nominal_diameter_m"), p.get("route_length_m"),
                            p.get("adopted_slope"), p.get("flow_direction"),
                            XD._flat(c.requires_calculation)])
        record(XD.write_csv(J("07_HYDROSANITARY", sub, "%s.csv" % sub),
                            ["component_id", "type", "level_id", "space_id",
                             "nominal_diameter_m", "route_length_m", "adopted_slope",
                             "flow_direction", "requires_calculation"], rws),
               "discipline_data")
    record(XD.write_json(J("07_HYDROSANITARY/isometrics", "isometrics.json"), {
        "schema": "embedverse-isometrics/1.0",
        "note": ("Los isometricos se generan por proyeccion axonometrica de las aristas de "
                 "los mismos solidos de tuberia. Lamina HID-I-ISO."),
        "projection": {"type": "axonometrica", "elevation_deg": 30.0, "azimuth_deg": 45.0,
                       "hidden_line_removal": False},
        "routes": [{"component_id": c.component_id, "type": c.type,
                    "length_m": c.parameters.get("route_length_m"),
                    "nominal_diameter_m": c.parameters.get("nominal_diameter_m")}
                   for c in sorted(model.by_discipline("hydrosanitary"),
                                   key=lambda c: c.component_id)
                   if c.parameters.get("route_length_m")],
    }), "discipline_data")

    # climatizacion
    for sub, types in (("ducts", ("exhaust_duct", "exhaust_riser")),
                       ("equipment", ("indoor_unit", "outdoor_unit", "exhaust_fan")),
                       ("ventilation", ("exhaust_grille", "supply_diffuser",
                                        "refrigerant_pipe"))):
        rws = []
        for t in types:
            for c in sorted(model.by_type(t), key=lambda c: c.component_id):
                p = c.parameters
                sec = p.get("adopted_section_m")
                rws.append([c.component_id, c.type, c.level_id, c.space_id,
                            p.get("cooling_capacity_kW"), p.get("design_airflow_m3_h"),
                            XD._flat(sec) if sec else None, p.get("route_length_m"),
                            XD._flat(c.requires_calculation)])
        record(XD.write_csv(J("08_HVAC", sub, "%s.csv" % sub),
                            ["component_id", "type", "level_id", "space_id",
                             "cooling_capacity_kW", "design_airflow_m3_h",
                             "adopted_section_m", "route_length_m", "requires_calculation"],
                            rws), "discipline_data")

    # seguridad
    for sub, types in (("cameras", ("cctv_camera",)),
                       ("alarms", ("smoke_detector", "motion_sensor", "security_panel",
                                   "access_reader")),
                       ("fire_protection", ("fire_extinguisher", "fire_hose_cabinet",
                                            "emergency_light", "exit_sign"))):
        rws = []
        for t in types:
            for c in sorted(model.by_type(t), key=lambda c: c.component_id):
                rws.append([c.component_id, c.type, c.level_id, c.space_id,
                            c.position[0], c.position[1], c.position[2],
                            XD._flat(c.requires_calculation)])
        record(XD.write_csv(J("09_SECURITY", sub, "%s.csv" % sub),
                            ["component_id", "type", "level_id", "space_id", "x", "y", "z",
                             "requires_calculation"], rws), "discipline_data")

    # ---- 10_PROCEDURES ----
    log("-> 10_PROCEDURES")
    record(XD.write_json(J("10_PROCEDURES", "geometry_operations.json"),
                         model.oplog.to_dict()), "procedures")
    record(XD.write_json(J("10_PROCEDURES", "component_creation.json"),
                         XD.component_creation_payload(model)), "procedures")
    rels = XD.relationships_payload(model)
    record(XD.write_json(J("10_PROCEDURES", "relationships.json"), rels), "procedures")
    record(XD.write_csv(J("10_PROCEDURES", "operations.csv"),
                        ["op_id", "sequence", "operation", "category", "component_id",
                         "solid_id", "description", "derived_from", "implementation"],
                        [[o.op_id, o.sequence, o.operation, o.category, o.component_id,
                          o.solid_id, o.description, XD._flat(o.derived_from),
                          o.implementation] for o in model.oplog.operations]),
           "procedures")

    # ---- catalogo global ----
    record(XD.write_json(J("13_DATASET", "component_catalog.json"),
                         XD.components_payload(model)), "dataset")
    record(XD.write_csv(J("13_DATASET", "components.csv"), XD.COMPONENT_CSV_HEADERS,
                        XD.components_rows(model)), "dataset")
    record(XD.write_csv(J("13_DATASET", "connections.csv"), XD.CONNECTION_CSV_HEADERS,
                        XD.connections_rows(model)), "dataset")
    return manifest


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main(argv: Sequence[str]) -> int:
    out_base = argv[1] if len(argv) > 1 else os.getcwd()
    out_root = os.path.join(out_base, P.PROJECT_ID)
    if os.path.isdir(out_root):
        shutil.rmtree(out_root)
    os.makedirs(out_root, exist_ok=True)

    t_start = time.time()
    log("=" * 78)
    log("EMBEDVERSE - generacion del expediente %s" % P.PROJECT_ID)
    log("=" * 78)

    log("[1/6] Modelo parametrico")
    model = build_model()
    log("      componentes %d | conexiones %d | espacios %d | solidos %d | operaciones %d"
        % (len(model.components), len(model.connections), len(model.spaces),
           len(model.solids), len(model.oplog)))

    log("[2/6] Validacion geometrica y colisiones")
    geo = VAL.geometry_report(model)
    clash, clashes = VAL.clash_report(model)
    log("      volumen material %.2f m3 | colisiones %d (%s)"
        % (geo["material_volume_m3"], clash["clash_count"],
           ", ".join("%s=%d" % (k, v) for k, v in clash["by_severity"].items()) or "ninguna"))

    log("[3/6] Laminas")
    sheets = build_sheets(model, clashes)
    index = attach_drawing_refs(model, sheets)
    log("      %d laminas | %d componentes con referencia de plano"
        % (len(sheets), len(index)))

    for c in model.components.values():
        if c.geometry_reference and c.geometry_reference not in geo["degenerate_solids"]:
            c.validation_status = VALIDATION_GEOMETRY_OK

    log("[4/6] Consistencia")
    cons = VAL.consistency_report(model, sheets)
    rev = VAL.professional_review_report(model)
    log("      comprobaciones %d | errores %d | avisos %d"
        % (cons["checks_run"], cons["errors"], cons["warnings"]))
    for r in cons["results"]:
        if not r["passed"]:
            log("        [%s] %s -> %s" % (r["severity"], r["check"], str(r["detail"])[:110]))

    log("[5/6] Escritura del expediente")
    manifest = write_package(model, sheets, out_root)

    J = lambda *p: os.path.join(out_root, *p)
    XD.write_json(J("12_VALIDATION", "geometry_report.json"), geo)
    XD.write_json(J("12_VALIDATION", "consistency_report.json"), cons)
    XD.write_json(J("12_VALIDATION", "clash_report.json"), clash)
    XD.write_json(J("12_VALIDATION", "professional_review.json"), rev)
    XD.write_csv(J("12_VALIDATION", "clashes.csv"),
                 ["a", "b", "a_layer", "b_layer", "a_discipline", "b_discipline",
                  "overlap_m3", "exact", "kind", "severity", "level"],
                 [[c["a"], c["b"], c["a_layer"], c["b_layer"], c["a_discipline"],
                   c["b_discipline"], c["overlap_m3"], c["exact"], c["kind"],
                   c["severity"], c["level"]] for c in clashes])
    XD.write_csv(J("12_VALIDATION", "pending_parameters.csv"),
                 ["component_id", "discipline", "type", "pending_parameter"],
                 [[c.component_id, c.discipline, c.type, p]
                  for c in sorted(model.components.values(), key=lambda c: c.component_id)
                  for p in c.requires_calculation])

    log("[6/6] Dataset y documentacion")
    exports = {
        "sheet_count": len(sheets),
        "tooling": _tooling(),
    }
    validation = {"consistency": cons, "clash": clash}
    XD.write_json(J("13_DATASET", "annotations.json"),
                  XD.annotations_payload(model, index))
    XD.write_json(J("13_DATASET", "component_labels.json"),
                  XD.component_labels_payload(model))
    XD.write_json(J("13_DATASET", "relationships.json"),
                  XD.relationships_payload(model))
    XD.write_json(J("13_DATASET", "training_metadata.json"),
                  XD.training_metadata_payload(model, GENERATION_DATE, exports, validation))

    fmt = _format_report(manifest)
    XD.write_json(J("12_VALIDATION", "format_report.json"), fmt)

    manifest["project_id"] = P.PROJECT_ID
    manifest["generated_on"] = GENERATION_DATE
    manifest["file_count"] = len(manifest["files"])
    manifest["total_bytes"] = sum(f.get("bytes", 0) for f in manifest["files"])
    XD.write_json(J("MANIFEST.json"), manifest)

    import readme as RD
    RD.write_readme(model, sheets, geo, clash, cons, rev, fmt, manifest,
                    GENERATION_DATE, J("README.md"))

    total_files = sum(len(fs) for _, _, fs in os.walk(out_root))
    total_bytes = sum(os.path.getsize(os.path.join(r, f))
                      for r, _, fs in os.walk(out_root) for f in fs)
    log("=" * 78)
    log("Expediente en %s" % out_root)
    log("Archivos: %d   Tamano: %.1f MB   Tiempo: %.1f s"
        % (total_files, total_bytes / 1e6, time.time() - t_start))
    log("Errores de consistencia: %d" % cons["errors"])
    log("=" * 78)
    return 0 if cons["errors"] == 0 else 1


def _tooling() -> List[Dict[str, str]]:
    import ezdxf, ifcopenshell, numpy, reportlab, shapely, trimesh
    try:
        import cadquery
        cq_ver = cadquery.__version__
    except Exception:
        cq_ver = "no disponible"
    return [
        {"name": "ifcopenshell", "version": ifcopenshell.version, "license": "LGPL-3.0",
         "use": "escritura y relectura de IFC4"},
        {"name": "ezdxf", "version": ezdxf.__version__, "license": "MIT",
         "use": "escritura y relectura de DXF R2018"},
        {"name": "trimesh", "version": trimesh.__version__, "license": "MIT",
         "use": "mallas, GLB, OBJ y comprobacion de volumenes"},
        {"name": "cadquery / OCP", "version": cq_ver, "license": "Apache-2.0 / LGPL-2.1",
         "use": "B-rep exacto y escritura de STEP"},
        {"name": "shapely", "version": shapely.__version__, "license": "BSD-3-Clause",
         "use": "operaciones 2D para secciones y colisiones"},
        {"name": "reportlab", "version": reportlab.Version, "license": "BSD-3-Clause",
         "use": "escritura de PDF vectorial"},
        {"name": "numpy", "version": numpy.__version__, "license": "BSD-3-Clause",
         "use": "algebra de la geometria"},
    ]


def _format_report(manifest: Dict[str, Any]) -> Dict[str, Any]:
    delivered: Dict[str, Dict[str, Any]] = {}
    for f in manifest["files"]:
        ext = os.path.splitext(f["path"])[1].lower().lstrip(".")
        if not ext:
            continue
        d = delivered.setdefault(ext, {"files": 0, "bytes": 0, "verified": 0})
        d["files"] += 1
        d["bytes"] += f.get("bytes", 0)
        if f.get("verified_by_reopen") or f.get("verified_by_reload"):
            d["verified"] += 1
    return {
        "schema": "embedverse-format-report/1.0",
        "verification_policy": ("Todo archivo generado se vuelve a abrir con una biblioteca "
                                "independiente del escritor cuando es posible. Ningun formato "
                                "se obtiene renombrando la extension de otro."),
        "tooling": _tooling(),
        "delivered": {k: delivered[k] for k in sorted(delivered)},
        "formats": {
            "IFC": {"status": "entregado", "version": "IFC4",
                    "verification": "reabierto con ifcopenshell; se cuentan productos y niveles"},
            "GLB": {"status": "entregado", "version": "glTF 2.0 binario",
                    "verification": "reabierto con trimesh; se cuentan nodos y triangulos"},
            "OBJ": {"status": "entregado",
                    "verification": "reabierto con trimesh; se cuentan vertices y caras"},
            "STEP": {"status": "entregado", "version": "AP214 via OpenCascade",
                     "verification": "reabierto con cadquery; se suma el volumen de los solidos",
                     "scope": "estructura y arquitectura"},
            "DXF": {"status": "entregado", "version": "R2018 (AC1032), unidades en metros",
                    "verification": "reabierto con ezdxf; se cuentan entidades y capas"},
            "PDF": {"status": "entregado", "version": "PDF 1.3 vectorial",
                    "verification": "cabecera %PDF y marcador %%EOF comprobados"},
            "SVG": {"status": "entregado", "version": "SVG 1.1 en milimetros",
                    "verification": "analizado como XML; se cuentan elementos"},
            "DWG": {
                "status": "NO ENTREGADO",
                "reason": ("No hay en este entorno un conversor DWG con licencia adecuada. "
                           "ezdxf no escribe DWG. La instalacion de LibreDWG fallo por "
                           "permisos del sistema y, ademas, su escritor de DWG es "
                           "experimental."),
                "alternative": ("DXF R2018, que es editable y lo abren AutoCAD, BricsCAD, "
                                "LibreCAD, QCAD y FreeCAD sin perdida."),
                "how_to_enable": ("Instalar el ODA File Converter (gratuito, requiere aceptar "
                                  "su licencia) o reparar los permisos de Homebrew y "
                                  "ejecutar 'brew install libredwg', y convertir "
                                  "11_DRAWINGS/dxf/*.dxf"),
            },
        },
    }


if __name__ == "__main__":
    sys.exit(main(sys.argv))

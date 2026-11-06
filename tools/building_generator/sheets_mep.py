"""Laminas de instalaciones, diagramas, cuadros y vistas del modelo 3D.

Los diagramas (unifilar, topologia de red, distribucion hidraulica y de
climatizacion) NO estan dibujados a mano: se construyen recorriendo el grafo de
conexiones del catalogo. Si cambia una conexion del modelo, cambia el diagrama.
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Sequence, Tuple

import drafting as D
import params as P
import views as V
from drafting import Circle, Line, PolyLine, Sheet, Text
from sheets import COMMON_NOTES, _grid_ann, auto_legend, compose, _new

ARCH_BG = ("ARQ-MUROS", "ARQ-PUERTAS", "ARQ-VENTANAS", "ESTR-COLUMNAS", "ESTR-ESCALERA")


def _mep_plan(model, lid: str, code: str, title: str, discipline: str,
              fg_layers: Sequence[str], subtitle: str,
              extra_notes: Sequence[str] = (), levelless: bool = False) -> Sheet:
    level = P.level_by_id(lid)
    prims, refs = V.plan(model, lid, background_layers=ARCH_BG,
                         foreground_layers=fg_layers,
                         include_levelless_foreground=levelless, show_spaces=False)
    sh = _new(code, title, discipline, "planta", 50,
              level_label="%s (N %+0.2f)" % (lid, level["elevation"]),
              subtitle=subtitle, north=True,
              notes=list(COMMON_NOTES) + list(extra_notes))
    sh.legend = auto_legend(prims)
    return compose(sh, prims, lambda s: _grid_ann(s) + V.space_labels(model, lid, s,
                                                                      with_area=False),
                   refs=refs)


# ---------------------------------------------------------------------------
# ELECTRICO
# ---------------------------------------------------------------------------

ELEC_NOTES = [
    "Calibres de conductor, capacidad y curva de protecciones NO estan determinados: "
    "requieren calculo de corriente, caida de tension y coordinacion de protecciones.",
    "La corriente indicada en los circuitos de alumbrado y tomacorrientes es una DERIVACION "
    "aritmetica de potencias nominales declaradas y un factor de potencia supuesto de %.2f."
    % P.HYP_POWER_FACTOR,
]


def electrical_sheets(model) -> List[Sheet]:
    out: List[Sheet] = []
    for level in P.LEVELS:
        lid = level["level_id"]
        out.append(_mep_plan(
            model, lid, "ELE-P-ILU-%s" % lid, "Plano de iluminacion %s" % level["name"].lower(),
            "electrical", ("ELE-ILUMINACION", "ELE-CIRCUITOS", "ELE-TABLEROS"),
            "Luminarias, interruptores y trazado de circuitos de alumbrado", ELEC_NOTES))
        out.append(_mep_plan(
            model, lid, "ELE-P-TOM-%s" % lid,
            "Plano de tomacorrientes %s" % level["name"].lower(), "electrical",
            ("ELE-TOMACORRIENTES", "ELE-CIRCUITOS", "ELE-TABLEROS"),
            "Salidas de tomacorriente y trazado de sus circuitos", ELEC_NOTES))
        out.append(_mep_plan(
            model, lid, "ELE-P-CAN-%s" % lid,
            "Plano de canalizaciones electricas %s" % level["name"].lower(), "electrical",
            ("ELE-CANALIZACIONES", "ELE-ALIMENTADORES", "ELE-TABLEROS", "ELE-ACOMETIDA",
             "ELE-TIERRA", "ELE-FUERZA", "ELE-EQUIPOS"),
            "Bandeja portacables, alimentadores, acometida y puesta a tierra",
            ELEC_NOTES, levelless=True))

    out.append(_single_line_diagram(model))
    out.append(_panel_diagram(model))
    out.append(_circuit_schedule(model))
    out.append(_load_schedule(model))
    out.append(_connection_detail_sheet(model))
    out.append(_route_isometric(model, "ELE-I-REC", "Identificacion de recorridos electricos",
                                "electrical",
                                ("ELE-CIRCUITOS", "ELE-ALIMENTADORES", "ELE-CANALIZACIONES",
                                 "ELE-ACOMETIDA", "ELE-TIERRA", "ELE-TABLEROS", "ELE-FUERZA"),
                                "Recorridos electricos en tres dimensiones", ELEC_NOTES))
    return out


def _single_line_diagram(model) -> Sheet:
    sh = _new("ELE-D-UNI", "Diagrama unifilar conceptual", "electrical", "diagrama", 1,
              level_label="Conjunto",
              subtitle="Construido desde el grafo de conexiones del modelo",
              notes=list(COMMON_NOTES) + ELEC_NOTES)
    prims: List[D.Prim] = []
    W, H = 46.0, 13.0

    def box(x, y, label, sub, layer="DIAGRAMA"):
        prims.extend(V.node_box(x, y, W, H, label, sub, layer))
        return (x + W / 2, y)

    def link(a, b):
        prims.extend(V.ortho_connector(a, b))

    y0 = 215.0
    acc = box(20.0, y0, "ACOMETIDA", "%s  %.0f V  %dF" % (
        P.HYP_SYSTEM_VOLTAGES["acometida"]["system"],
        P.HYP_SYSTEM_VOLTAGES["acometida"]["voltage_v"],
        P.HYP_SYSTEM_VOLTAGES["acometida"]["phases"]), "ELE-ACOMETIDA")
    med = box(20.0, y0 - 26, "MEDIDOR", "tipo y relacion: pendiente", "ELE-EQUIPOS")
    tg = box(20.0, y0 - 52, "TABLERO GENERAL TG", "interruptor principal: pendiente",
             "ELE-TABLEROS")
    link((20 + W / 2, y0), (20 + W / 2, y0 - 26 + H))
    link((20 + W / 2, y0 - 26), (20 + W / 2, y0 - 52 + H))

    prims.append(Text("DIAGRAMA-TEXTO", (20.0 + W + 4, y0 - 52 + H / 2),
                      "Montante  ELE-MON-001", height_mm=2.1))

    x_ts = 100.0
    ts_y = []
    for i, level in enumerate(P.LEVELS):
        lid = level["level_id"]
        y = y0 - 52 - i * 34
        ts_y.append(y)
        box(x_ts, y, "TABLERO TS-%s" % lid, "%s  %.0f V" % (
            P.HYP_SYSTEM_VOLTAGES["iluminacion"]["system"],
            P.HYP_SYSTEM_VOLTAGES["iluminacion"]["voltage_v"]), "ELE-TABLEROS")
        link((20 + W, y0 - 52 + H / 2), (x_ts, y + H / 2))

        circs = [c for c in model.by_type("circuit") if c.level_id == lid]
        ilu = [c for c in circs if c.parameters["circuit_kind"] == "iluminacion"]
        tom = [c for c in circs if c.parameters["circuit_kind"] == "tomacorrientes"]
        for j, (name, group) in enumerate((("ILUMINACION", ilu), ("TOMACORRIENTES", tom))):
            if not group:
                continue
            gy = y + H - 4 - j * 12
            gx = x_ts + W + 16
            pw = sum(c.parameters["connected_power_w"] for c in group)
            cur = sum(c.parameters["derived_current_a"] for c in group)
            prims.append(Line("DIAGRAMA", (x_ts + W, y + H / 2), (gx, gy)))
            prims.append(Text("DIAGRAMA-TEXTO", (gx + 1, gy - 1.2),
                              "%d circuitos de %s   %.0f V  %.0f W  %.1f A (derivada)   "
                              "calibre y proteccion: pendientes"
                              % (len(group), name,
                                 group[0].parameters["nominal_voltage_v"], pw, cur),
                              height_mm=2.1))

    # circuitos de fuerza
    eq = model.by_type("equipment_circuit")
    if eq:
        y = ts_y[-1] - 40
        box(x_ts, y, "CIRCUITOS DE FUERZA", "%d circuitos  %.0f V  3F" % (
            len(eq), P.HYP_SYSTEM_VOLTAGES["climatizacion"]["voltage_v"]), "ELE-FUERZA")
        link((20 + W, y0 - 52 + H / 2), (x_ts, y + H / 2))
        for j, c in enumerate(eq):
            prims.append(Text("DIAGRAMA-TEXTO", (x_ts + W + 6, y + H - 3 - j * 5),
                              "%s -> %s   %.0f V  %dF   potencia y corriente: pendientes"
                              % (c.component_id, c.parameters["served_equipment"],
                                 c.parameters["nominal_voltage_v"], c.parameters["phases"]),
                              height_mm=2.0))

    for p in prims:
        sh.add_paper(p)
    sh.add_paper(Text("LAM-TEXTO", (20.0, 92.0),
                      "Este diagrama representa la TOPOLOGIA real del modelo. No es un "
                      "diagrama unifilar de diseno: faltan calibres, protecciones, "
                      "corrientes de cortocircuito y coordinacion.", height_mm=2.4))
    sh.legend = [("ELE-ACOMETIDA", "Acometida"), ("ELE-TABLEROS", "Tableros"),
                 ("ELE-FUERZA", "Circuitos de fuerza"), ("DIAGRAMA", "Enlaces de topologia")]
    D.finish(sh, rescale=False)
    return sh


def _panel_diagram(model) -> Sheet:
    sh = _new("ELE-D-TAB", "Diagrama de distribucion de tableros", "electrical", "diagrama", 1,
              level_label="Conjunto", subtitle="Jerarquia de tableros y circuitos asociados",
              notes=list(COMMON_NOTES) + ELEC_NOTES)
    rows: List[List[str]] = []
    for panel in sorted(model.by_type("main_distribution_board")
                        + model.by_type("distribution_board"),
                        key=lambda c: c.component_id):
        fed = [c for c in model.components.values()
               if {"relation": "fed_from", "target": panel.component_id} in c.relationships]
        pw = sum(c.parameters.get("connected_power_w") or 0.0 for c in fed)
        rows.append([panel.component_id, panel.name[:28], panel.level_id or "-",
                     "%.0f" % panel.parameters["nominal_voltage_v"],
                     str(panel.parameters["phases"]), str(len(fed)),
                     "%.0f" % pw if pw else "pendiente", "pendiente"])
    D.draw_table(sh, ["TABLERO", "NOMBRE", "NIVEL", "V", "FASES", "CIRCUITOS",
                      "POT. CONECTADA W", "INT. PRINCIPAL"],
                 rows, [34.0, 56.0, 20.0, 18.0, 20.0, 26.0, 36.0, 32.0],
                 (24.0, sh.size_mm[1] - 40.0), title="TABLEROS Y CIRCUITOS ASOCIADOS")
    y = sh.size_mm[1] - 40.0 - 20.0 - 6.0 * len(rows)
    sh.add_paper(Text("LAM-TEXTO", (24.0, y - 10),
                      "La potencia conectada es la suma de potencias nominales declaradas. "
                      "La demanda maxima y los factores de demanda NO estan calculados.",
                      height_mm=2.4))
    D.finish(sh, rescale=False)
    return sh


def _circuit_schedule(model) -> Sheet:
    sh = _new("ELE-T-CIR", "Cuadro de circuitos", "electrical", "cuadro", 1,
              level_label="Todos los niveles",
              subtitle="Longitudes medidas sobre el trazado 3D del modelo",
              notes=list(COMMON_NOTES) + ELEC_NOTES)
    rows: List[List[str]] = []
    for c in sorted(model.by_type("circuit") + model.by_type("equipment_circuit"),
                    key=lambda c: c.component_id):
        p = c.parameters
        cur = p.get("derived_current_a")
        pw = p.get("connected_power_w")
        rows.append([
            c.component_id, c.level_id or "-", p["circuit_kind"],
            "%.0f" % p["nominal_voltage_v"], str(p["phases"]),
            ("%.0f" % pw) if pw is not None else "pendiente",
            ("%.2f" % cur) if cur is not None else "pendiente",
            "pendiente", "pendiente", "%.2f" % p["route_length_m"],
        ])
    D.draw_table(sh, ["CIRCUITO", "NIVEL", "TIPO", "V", "F", "POT W", "CORR A",
                      "CALIBRE", "PROTECC", "LONG m"],
                 rows, [34.0, 18.0, 36.0, 16.0, 12.0, 24.0, 24.0, 26.0, 26.0, 24.0],
                 (24.0, sh.size_mm[1] - 34.0), title="CUADRO DE CIRCUITOS", max_rows=72)
    sh.add_paper(Text("LAM-TEXTO", (24.0, 88.0),
                      "Material del conductor: cobre (hipotesis de seleccion). "
                      "Tipo de aislamiento: pendiente de especificacion en todos los circuitos.",
                      height_mm=2.4))
    D.finish(sh, rescale=False)
    return sh


def _load_schedule(model) -> Sheet:
    sh = _new("ELE-T-CAR", "Cuadro de cargas preliminar", "electrical", "cuadro", 1,
              level_label="Todos los niveles",
              subtitle="Suma de potencias nominales declaradas. NO es demanda de diseno",
              notes=list(COMMON_NOTES) + ELEC_NOTES)
    rows: List[List[str]] = []
    grand = 0.0
    for level in P.LEVELS:
        lid = level["level_id"]
        circs = [c for c in model.by_type("circuit") if c.level_id == lid]
        for kind in ("iluminacion", "tomacorrientes"):
            grp = [c for c in circs if c.parameters["circuit_kind"] == kind]
            if not grp:
                continue
            pw = sum(c.parameters["connected_power_w"] for c in grp)
            cur = sum(c.parameters["derived_current_a"] for c in grp)
            pts = sum(c.parameters["point_count"] for c in grp)
            grand += pw
            rows.append([lid, kind, str(len(grp)), str(pts),
                         "%.0f" % grp[0].parameters["nominal_voltage_v"],
                         "%.0f" % pw, "%.2f" % cur, "pendiente"])
    eq = model.by_type("equipment_circuit")
    if eq:
        rows.append(["Todos", "fuerza de equipos", str(len(eq)), str(len(eq)),
                     "%.0f" % P.HYP_SYSTEM_VOLTAGES["climatizacion"]["voltage_v"],
                     "pendiente", "pendiente", "pendiente"])
    rows.append(["", "TOTAL CONECTADO DECLARADO", "", "", "", "%.0f" % grand, "", "pendiente"])

    D.draw_table(sh, ["NIVEL", "TIPO DE CARGA", "CIRC", "PUNTOS", "V",
                      "POT. CONECTADA W", "CORR. DERIVADA A", "FACT. DEMANDA"],
                 rows, [24.0, 60.0, 20.0, 24.0, 18.0, 38.0, 38.0, 32.0],
                 (24.0, sh.size_mm[1] - 40.0), title="CUADRO DE CARGAS PRELIMINAR")
    sh.add_paper(Text("LAM-TEXTO", (24.0, 110.0),
                      "ADVERTENCIA: la potencia total conectada (%.0f W) NO es la demanda "
                      "maxima. Sin factores de demanda, diversidad y cargas de climatizacion "
                      "determinadas, la acometida y el interruptor principal no pueden "
                      "dimensionarse." % grand, height_mm=2.6))
    sh.add_paper(Text("LAM-TEXTO", (24.0, 104.0),
                      "Potencias unitarias declaradas: luminaria %.0f W, salida de "
                      "tomacorriente %.0f W. Factor de potencia supuesto %.2f."
                      % (P.HYP_LUMINAIRE["nominal_power_w"],
                         P.HYP_OUTLET["declared_demand_w"], P.HYP_POWER_FACTOR), height_mm=2.4))
    D.finish(sh, rescale=False)
    return sh


def _connection_detail_sheet(model) -> Sheet:
    """Detalles de conexion: esquemas de union generados desde los tipos reales."""
    sh = _new("ELE-D-CON", "Detalles de conexion electrica", "electrical", "detalle", 1,
              level_label="Tipos", subtitle="Esquemas de los tipos de conexion presentes "
                                            "en el modelo",
              notes=list(COMMON_NOTES) + ELEC_NOTES)
    kinds: Dict[str, int] = {}
    for cx in model.connections_of_discipline("electrical"):
        kinds[cx.type] = kinds.get(cx.type, 0) + 1

    y = sh.size_mm[1] - 60.0
    x = 30.0
    for i, (kind, n) in enumerate(sorted(kinds.items())):
        yy = y - i * 40.0
        sh.add_paper(*V.node_box(x, yy, 44.0, 12.0, "ORIGEN", "", "DIAGRAMA"))
        sh.add_paper(*V.node_box(x + 110.0, yy, 44.0, 12.0, "DESTINO", "", "DIAGRAMA"))
        sh.add_paper(Line("ELE-CIRCUITOS", (x + 44.0, yy + 6.0), (x + 110.0, yy + 6.0)))
        sh.add_paper(Circle("ELE-CIRCUITOS", (x + 77.0, yy + 6.0), 3.0))
        sh.add_paper(Text("LAM-TEXTO", (x, yy + 18.0), "%s  (%d en el modelo)" % (kind, n),
                          height_mm=3.0))
        sh.add_paper(Text("LAM-TEXTO", (x + 160.0, yy + 8.0),
                          "Conductor: cobre (hipotesis).  Calibre: pendiente.", height_mm=2.2))
        sh.add_paper(Text("LAM-TEXTO", (x + 160.0, yy + 3.0),
                          "Proteccion: pendiente.  Aislamiento: pendiente.", height_mm=2.2))
    sh.add_paper(Text("LAM-TEXTO", (30.0, 86.0),
                      "Los detalles muestran la TOPOLOGIA de cada tipo de conexion presente en "
                      "el modelo. El detalle constructivo de borne, empalme y puesta a tierra "
                      "requiere especificacion de producto y norma aplicable.", height_mm=2.4))
    sh.legend = [("ELE-CIRCUITOS", "Enlace electrico"), ("DIAGRAMA", "Extremo de conexion")]
    D.finish(sh, rescale=False)
    return sh


# ---------------------------------------------------------------------------
# Isometrico de recorridos (reutilizable por disciplina)
# ---------------------------------------------------------------------------


def _route_isometric(model, code: str, title: str, discipline: str,
                     layers: Sequence[str], subtitle: str,
                     extra_notes: Sequence[str] = (),
                     with_envelope: bool = True) -> Sheet:
    prims, refs = V.isometric(model, layers=list(layers))
    if with_envelope:
        env, _ = V.isometric(model, layers=["ESTR-LOSAS", "ESTR-COLUMNAS"],
                             layer_override="ISO-ARISTAS")
        prims = env + prims
    sh = _new(code, title, discipline, "isometrico", 100, level_label="Conjunto",
              subtitle=subtitle, notes=list(COMMON_NOTES) + list(extra_notes))
    sh.legend = auto_legend(prims)
    sh.notes = sh.notes + ["Proyeccion axonometrica de aristas (elevacion 30, azimut 45). "
                           "Sin eliminacion de lineas ocultas."]
    return compose(sh, prims, None, padding_mm=10.0, refs=refs)


# ---------------------------------------------------------------------------
# TELECOMUNICACIONES
# ---------------------------------------------------------------------------

TEL_NOTES = [
    "La posicion de los puntos de acceso Wi-Fi es un reparto GEOMETRICO. La cobertura real "
    "exige estudio de sitio, plan de canales y medicion.",
    "Categoria del cableado, certificacion de canal y presupuesto optico: pendientes.",
]


def telecom_sheets(model) -> List[Sheet]:
    out: List[Sheet] = []
    for level in P.LEVELS:
        lid = level["level_id"]
        out.append(_mep_plan(
            model, lid, "TEL-P-RED-%s" % lid, "Plano de puntos de red %s" % level["name"].lower(),
            "telecommunications", ("TEL-TOMAS", "TEL-EQUIPOS", "TEL-CANALIZACIONES"),
            "Tomas de red, gabinete de piso y cableado horizontal", TEL_NOTES))
        out.append(_mep_plan(
            model, lid, "TEL-P-WIFI-%s" % lid,
            "Plano de puntos Wi-Fi %s" % level["name"].lower(), "telecommunications",
            ("TEL-WIFI", "TEL-EQUIPOS"),
            "Puntos de acceso inalambrico y gabinete de piso", TEL_NOTES))
    out.append(_network_topology(model))
    out.append(_route_isometric(model, "TEL-I-CAN", "Canalizaciones de telecomunicaciones",
                                "telecommunications",
                                ("TEL-CANALIZACIONES", "TEL-EQUIPOS", "TEL-TOMAS", "TEL-WIFI"),
                                "Troncal optica, montante y cableado horizontal", TEL_NOTES))
    out.append(_connection_diagram(model))
    out.append(_equipment_inventory(model, "TEL-T-INV", "Inventario de equipos de "
                                                        "telecomunicaciones",
                                    "telecommunications",
                                    ("rack", "router", "switch", "cabinet",
                                     "wireless_access_point", "antenna"), TEL_NOTES))
    return out


def _network_topology(model) -> Sheet:
    sh = _new("TEL-D-TOP", "Topologia de red", "telecommunications", "diagrama", 1,
              level_label="Conjunto",
              subtitle="Construida desde el grafo de enlaces del modelo",
              notes=list(COMMON_NOTES) + TEL_NOTES)
    W, H = 52.0, 13.0
    y0 = 200.0
    sh.add_paper(*V.node_box(24.0, y0, W, H, "ANTENA EXTERIOR", "TEL-ANT-001", "TEL-WIFI"))
    sh.add_paper(*V.node_box(24.0, y0 - 28, W, H, "ROUTER DE BORDE", "TEL-RTR-001",
                             "TEL-EQUIPOS"))
    sh.add_paper(*V.node_box(24.0, y0 - 56, W, H, "SWITCH NUCLEO", "TEL-SW-CORE",
                             "TEL-EQUIPOS"))
    sh.add_paper(*V.ortho_connector((24 + W / 2, y0), (24 + W / 2, y0 - 28 + H)))
    sh.add_paper(*V.ortho_connector((24 + W / 2, y0 - 28), (24 + W / 2, y0 - 56 + H)))

    for i, level in enumerate(P.LEVELS):
        lid = level["level_id"]
        y = y0 - 56 - 34 * (i + 1)
        sh.add_paper(*V.node_box(110.0, y, W, H, "SWITCH %s" % lid, "TEL-SW-%s" % lid,
                                 "TEL-EQUIPOS"))
        sh.add_paper(Line("TEL-CANALIZACIONES", (24 + W, y0 - 56 + H / 2), (110.0, y + H / 2)))
        fib = model.components.get("TEL-FIB-%s" % lid)
        sh.add_paper(Text("TEL-TEXTO", (70.0, y + H / 2 + 2.0),
                          "fibra optica  %.1f m" % (fib.parameters["route_length_m"] if fib else 0),
                          height_mm=2.0))
        outlets = [c for c in model.by_type("data_outlet") if c.level_id == lid]
        aps = [c for c in model.by_type("wireless_access_point") if c.level_id == lid]
        cams = [c for c in model.by_type("cctv_camera") if c.level_id == lid]
        for j, (label, items) in enumerate((("TOMAS DE RED", outlets),
                                            ("PUNTOS WI-FI", aps),
                                            ("CAMARAS IP", cams))):
            yy = y + H - 2 - j * 5.0
            sh.add_paper(Line("TEL-CANALIZACIONES", (110.0 + W, y + H / 2), (184.0, yy)))
            sh.add_paper(Text("TEL-TEXTO", (186.0, yy - 1.2),
                              "%d x %s   UTP Cat 6 declarada, certificacion pendiente"
                              % (len(items), label), height_mm=2.1))
    sh.add_paper(Text("LAM-TEXTO", (24.0, 86.0),
                      "Topologia en estrella por nivel con troncal optica vertical. Velocidades, "
                      "VLAN, direccionamiento y capacidad de puertos: pendientes.",
                      height_mm=2.4))
    sh.legend = [("TEL-EQUIPOS", "Equipo activo"), ("TEL-CANALIZACIONES", "Enlace"),
                 ("TEL-WIFI", "Equipo inalambrico")]
    D.finish(sh, rescale=False)
    return sh


def _connection_diagram(model) -> Sheet:
    sh = _new("TEL-D-CNX", "Diagrama de conexiones", "telecommunications", "diagrama", 1,
              level_label="Conjunto",
              subtitle="Cada enlace declara origen, destino, medio y tecnologia",
              notes=list(COMMON_NOTES) + TEL_NOTES)
    rows: List[List[str]] = []
    for cx in sorted(model.connections_of_discipline("telecommunications"),
                     key=lambda c: c.connection_id):
        rows.append([cx.connection_id[:28], cx.origin[:24], cx.destination[:24],
                     cx.medium[:22], (cx.technology or "-")[:24],
                     ("%.2f" % cx.length_m) if cx.length_m else "-",
                     cx.flow_direction or "-"])
    D.draw_table(sh, ["ENLACE", "ORIGEN", "DESTINO", "MEDIO", "TECNOLOGIA", "LONG m",
                      "SENTIDO"],
                 rows, [54.0, 46.0, 46.0, 44.0, 46.0, 22.0, 36.0],
                 (24.0, sh.size_mm[1] - 34.0), title="REGISTRO DE CONEXIONES DE DATOS",
                 max_rows=74)
    sh.add_paper(Text("LAM-TEXTO", (24.0, 88.0),
                      "Total de enlaces de telecomunicaciones en el modelo: %d. El listado "
                      "integro esta en 06_TELECOMMUNICATIONS y en el registro de conexiones."
                      % len(model.connections_of_discipline("telecommunications")),
                      height_mm=2.4))
    D.finish(sh, rescale=False)
    return sh


def _equipment_inventory(model, code: str, title: str, discipline: str,
                         types: Sequence[str], extra_notes: Sequence[str] = ()) -> Sheet:
    sh = _new(code, title, discipline, "cuadro", 1, level_label="Todos los niveles",
              subtitle="Inventario extraido del catalogo de componentes",
              notes=list(COMMON_NOTES) + list(extra_notes))
    rows: List[List[str]] = []
    for t in types:
        for c in sorted(model.by_type(t), key=lambda c: c.component_id):
            dims = c.dimensions or {}
            dim = " x ".join("%.2f" % v for k, v in sorted(dims.items())
                             if isinstance(v, (int, float))) or "-"
            pend = len(c.requires_calculation)
            rows.append([c.component_id[:26], t[:22], c.name[:32], c.level_id or "-",
                         dim[:22], str(pend), c.validation_status])
    D.draw_table(sh, ["ID", "TIPO", "NOMBRE", "NIVEL", "DIMENSIONES m",
                      "PARAM PEND", "VALIDACION"],
                 rows, [50.0, 44.0, 62.0, 20.0, 44.0, 28.0, 36.0],
                 (24.0, sh.size_mm[1] - 34.0), title=title.upper(), max_rows=74)
    D.finish(sh, rescale=False)
    return sh


# ---------------------------------------------------------------------------
# HIDROSANITARIO
# ---------------------------------------------------------------------------

HID_NOTES = [
    "Los diametros son NOMINALES ADOPTADOS para poder trazar la red. El dimensionamiento por "
    "unidades de consumo y de descarga esta pendiente.",
    "La pendiente de desague adoptada es %.1f%%. Las cotas de llegada se deducen de la longitud "
    "horizontal y esa pendiente, no se eligen." % (P.HYP_DRAIN_SLOPE * 100),
]


def hydrosanitary_sheets(model) -> List[Sheet]:
    out: List[Sheet] = []
    for level in P.LEVELS:
        lid = level["level_id"]
        out.append(_mep_plan(
            model, lid, "HID-P-AGU-%s" % lid,
            "Plano de agua potable %s" % level["name"].lower(), "hydrosanitary",
            ("HID-AGUA", "HID-APARATOS", "HID-EQUIPOS"),
            "Montante, ramales de agua potable y aparatos sanitarios", HID_NOTES,
            levelless=True))
        out.append(_mep_plan(
            model, lid, "HID-P-DES-%s" % lid,
            "Plano de desagues %s" % level["name"].lower(), "hydrosanitary",
            ("HID-DESAGUE", "HID-APARATOS"),
            "Ramales de desague con pendiente y bajante sanitaria", HID_NOTES,
            levelless=True))
    out.append(_mep_plan(
        model, "N1", "HID-P-VEN", "Plano de ventilacion sanitaria", "hydrosanitary",
        ("HID-VENTILACION", "HID-DESAGUE", "HID-APARATOS"),
        "Columna de ventilacion sanitaria y su terminal sobre cubierta", HID_NOTES,
        levelless=True))
    out.append(_mep_plan(
        model, "NC", "HID-P-PLU", "Plano de red pluvial de cubierta", "hydrosanitary",
        ("HID-PLUVIAL", "HID-EQUIPOS"),
        "Sumideros, ramales con pendiente y bajante pluvial", HID_NOTES, levelless=True))
    out.append(_route_isometric(model, "HID-I-ISO", "Isometricos hidrosanitarios",
                                "hydrosanitary",
                                ("HID-AGUA", "HID-DESAGUE", "HID-VENTILACION", "HID-PLUVIAL",
                                 "HID-APARATOS", "HID-EQUIPOS"),
                                "Isometrico de agua potable, desague, ventilacion y pluvial",
                                HID_NOTES))
    out.append(_hydro_diagram(model))
    out.append(_pipe_schedule(model))
    return out


def _hydro_diagram(model) -> Sheet:
    sh = _new("HID-D-DIS", "Diagrama de distribucion hidrosanitaria", "hydrosanitary",
              "diagrama", 1, level_label="Conjunto",
              subtitle="Cadena de suministro y de evacuacion segun el grafo del modelo",
              notes=list(COMMON_NOTES) + HID_NOTES)
    W, H = 50.0, 13.0
    chain = [
        ("ACOMETIDA", "HID-ACO-001", "HID-AGUA"),
        ("MEDIDOR", "HID-MED-001", "HID-EQUIPOS"),
        ("TANQUE DE RESERVA", "HID-TAN-BAJO", "HID-EQUIPOS"),
        ("EQUIPO DE BOMBEO", "HID-BOM-001", "HID-EQUIPOS"),
        ("TANQUE ELEVADO", "HID-TAN-ALTO", "HID-EQUIPOS"),
        ("MONTANTE POR GRAVEDAD", "HID-MON-DIST", "HID-AGUA"),
    ]
    x, y = 24.0, 210.0
    prev = None
    for label, cid, lay in chain:
        comp = model.components.get(cid)
        sub = ""
        if comp is not None:
            d = comp.parameters.get("nominal_diameter_m")
            if d:
                sub = "D nominal %.0f mm" % (d * 1000)
            elif comp.parameters.get("geometric_volume_m3"):
                sub = "volumen geometrico %.1f m3" % comp.parameters["geometric_volume_m3"]
        sh.add_paper(*V.node_box(x, y, W, H, label, sub, lay))
        if prev:
            sh.add_paper(*V.ortho_connector((x + W / 2, prev), (x + W / 2, y + H)))
        prev = y
        y -= 24.0

    # ramales por nivel
    for i, level in enumerate(P.LEVELS):
        lid = level["level_id"]
        yy = 210.0 - 24.0 * (len(chain) - 1) - 6 - i * 20.0
        branches = [c for c in model.by_type("water_branch") if c.level_id == lid]
        fx = sum(len(c.parameters["served_fixtures"]) for c in branches)
        sh.add_paper(Line("HID-AGUA", (x + W, 210.0 - 24.0 * (len(chain) - 1) + H / 2),
                          (110.0, yy + 5)))
        sh.add_paper(Text("HID-TEXTO", (112.0, yy + 3.5),
                          "%s: %d ramales de agua, %d aparatos  (D nominal %.0f mm)"
                          % (lid, len(branches), fx,
                             P.HYP_PIPE_DIAMETERS["ramal_agua"] * 1000), height_mm=2.1))

    # evacuacion
    x2, y2 = 300.0, 210.0
    drain_chain = [("APARATOS SANITARIOS", "", "HID-APARATOS"),
                   ("RAMALES CON PENDIENTE %.1f%%" % (P.HYP_DRAIN_SLOPE * 100), "", "HID-DESAGUE"),
                   ("BAJANTE SANITARIA", "HID-BAJ-SAN", "HID-DESAGUE"),
                   ("VENTILACION SANITARIA", "HID-VEN-SAN", "HID-VENTILACION"),
                   ("DESCARGA (pendiente de definir)", "", "HID-DESAGUE")]
    prev = None
    for label, cid, lay in drain_chain:
        comp = model.components.get(cid) if cid else None
        sub = ""
        if comp is not None:
            d = comp.parameters.get("nominal_diameter_m")
            if d:
                sub = "D nominal %.0f mm" % (d * 1000)
        sh.add_paper(*V.node_box(x2, y2, W + 18, H, label, sub, lay))
        if prev:
            sh.add_paper(*V.ortho_connector((x2 + (W + 18) / 2, prev),
                                            (x2 + (W + 18) / 2, y2 + H)))
        prev = y2
        y2 -= 24.0

    sh.add_paper(Text("LAM-TEXTO", (24.0, 86.0),
                      "Volumen de tanque, curva de bomba, presion residual y diametros "
                      "definitivos son parametros PENDIENTES: dependen de dotacion, ocupacion "
                      "y calculo hidraulico.", height_mm=2.4))
    sh.legend = [("HID-AGUA", "Agua potable"), ("HID-DESAGUE", "Desague"),
                 ("HID-VENTILACION", "Ventilacion sanitaria"), ("HID-EQUIPOS", "Equipos")]
    D.finish(sh, rescale=False)
    return sh


def _pipe_schedule(model) -> Sheet:
    sh = _new("HID-T-TUB", "Cuadro de tuberias y accesorios", "hydrosanitary", "cuadro", 1,
              level_label="Todos los niveles",
              subtitle="Longitudes medidas sobre el trazado 3D del modelo",
              notes=list(COMMON_NOTES) + HID_NOTES)
    rows: List[List[str]] = []
    for c in sorted(model.by_discipline("hydrosanitary"), key=lambda c: c.component_id):
        p = c.parameters
        d = p.get("nominal_diameter_m")
        if d is None and c.type not in ("valve", "water_meter", "pump", "water_tank",
                                        "sanitary_fixture", "roof_drain"):
            continue
        rows.append([
            c.component_id[:28], c.type[:20], c.level_id or "-",
            ("%.0f" % (d * 1000)) if d else "-",
            (p.get("material_declared") or c.material or "-")[:16],
            ("%.2f" % p["route_length_m"]) if p.get("route_length_m") else "-",
            ("%.3f" % p["adopted_slope"]) if p.get("adopted_slope") else "-",
            (p.get("flow_direction") or "-")[:24],
            "pendiente",
        ])
    D.draw_table(sh, ["ID", "TIPO", "NIVEL", "D NOM mm", "MATERIAL", "LONG m",
                      "PENDIENTE", "SENTIDO DE FLUJO", "D VERIFICADO"],
                 rows, [52.0, 38.0, 18.0, 24.0, 32.0, 22.0, 24.0, 46.0, 28.0],
                 (24.0, sh.size_mm[1] - 34.0), title="CUADRO DE TUBERIAS Y ACCESORIOS",
                 max_rows=74)
    total = sum(c.parameters.get("route_length_m") or 0.0
                for c in model.by_discipline("hydrosanitary"))
    sh.add_paper(Text("LAM-TEXTO", (24.0, 88.0),
                      "Longitud total de tuberia trazada en el modelo: %.2f m. Ningun diametro "
                      "esta verificado por calculo hidraulico." % total, height_mm=2.4))
    D.finish(sh, rescale=False)
    return sh


# ---------------------------------------------------------------------------
# CLIMATIZACION
# ---------------------------------------------------------------------------

CLI_NOTES = [
    "No existe capacidad de refrigeracion asignada: sin calculo de carga termica por recinto "
    "no es posible seleccionar equipos. Todas las capacidades figuran como pendientes.",
    "Las secciones de ducto son ADOPTADAS para el trazado; el caudal y la perdida de carga "
    "estan pendientes.",
]


def hvac_sheets(model) -> List[Sheet]:
    out: List[Sheet] = []
    for level in P.LEVELS:
        lid = level["level_id"]
        out.append(_mep_plan(
            model, lid, "CLI-P-CLI-%s" % lid,
            "Plano de climatizacion %s" % level["name"].lower(), "hvac",
            ("CLI-EQUIPOS", "CLI-FRIGORIFICA", "CLI-REJILLAS"),
            "Unidades interiores, tuberia frigorifica y terminales de aire", CLI_NOTES))
        out.append(_mep_plan(
            model, lid, "CLI-P-DUC-%s" % lid,
            "Plano de ductos %s" % level["name"].lower(), "hvac",
            ("CLI-DUCTOS", "CLI-REJILLAS"),
            "Ductos de extraccion y rejillas", CLI_NOTES, levelless=True))
    out.append(_mep_plan(
        model, "NC", "CLI-P-EQU", "Plano de ubicacion de equipos de climatizacion", "hvac",
        ("CLI-EQUIPOS", "CLI-DUCTOS", "CLI-FRIGORIFICA"),
        "Unidades exteriores y extractor en cubierta", CLI_NOTES, levelless=True))
    out.append(_route_isometric(model, "CLI-I-DIS", "Diagrama de distribucion de climatizacion",
                                "hvac",
                                ("CLI-EQUIPOS", "CLI-FRIGORIFICA", "CLI-DUCTOS", "CLI-REJILLAS"),
                                "Trazado tridimensional de refrigerante y extraccion",
                                CLI_NOTES))
    out.append(_equipment_inventory(model, "CLI-T-INV", "Inventario de equipos de climatizacion",
                                    "hvac", ("indoor_unit", "outdoor_unit", "exhaust_fan"),
                                    CLI_NOTES))
    out.append(_hvac_tech_schedule(model))
    return out


def _hvac_tech_schedule(model) -> Sheet:
    sh = _new("CLI-T-CAR", "Cuadro de caracteristicas tecnicas de climatizacion", "hvac",
              "cuadro", 1, level_label="Todos los niveles",
              subtitle="Las capacidades y caudales aparecen como pendientes por diseno",
              notes=list(COMMON_NOTES) + CLI_NOTES)
    rows: List[List[str]] = []
    for t in ("outdoor_unit", "indoor_unit", "exhaust_fan", "exhaust_grille",
              "supply_diffuser", "exhaust_duct", "exhaust_riser", "refrigerant_pipe"):
        for c in sorted(model.by_type(t), key=lambda c: c.component_id):
            p = c.parameters
            sec = p.get("adopted_section_m")
            rows.append([
                c.component_id[:26], t[:18], c.level_id or "-",
                (c.space_id or "-")[-10:],
                "pendiente" if p.get("cooling_capacity_kW") is None else str(p["cooling_capacity_kW"]),
                "pendiente" if p.get("design_airflow_m3_h") is None else str(p["design_airflow_m3_h"]),
                ("%.2f x %.2f" % (sec[0], sec[1])) if sec else "-",
                ("%.2f" % p["route_length_m"]) if p.get("route_length_m") else "-",
            ])
    D.draw_table(sh, ["ID", "TIPO", "NIVEL", "RECINTO", "CAP. FRIO kW",
                      "CAUDAL m3/h", "SECCION m", "LONG m"],
                 rows, [48.0, 36.0, 18.0, 26.0, 32.0, 32.0, 32.0, 24.0],
                 (24.0, sh.size_mm[1] - 34.0),
                 title="CUADRO DE CARACTERISTICAS TECNICAS", max_rows=74)
    sh.add_paper(Text("LAM-TEXTO", (24.0, 88.0),
                      "Todas las capacidades de refrigeracion y caudales de aire del proyecto "
                      "estan PENDIENTES. Asignarlas sin calculo de carga termica seria "
                      "inventar un resultado tecnico.", height_mm=2.6))
    D.finish(sh, rescale=False)
    return sh


# ---------------------------------------------------------------------------
# SEGURIDAD
# ---------------------------------------------------------------------------

SEG_NOTES = [
    "La ubicacion de detectores y dispositivos es un reparto GEOMETRICO, no un diseno "
    "normativo de proteccion contra incendios.",
    "Evaluacion de riesgo, categoria de deteccion, autonomia del alumbrado de emergencia y "
    "distancias de evacuacion: pendientes.",
]


def security_sheets(model) -> List[Sheet]:
    out: List[Sheet] = []
    for level in P.LEVELS:
        lid = level["level_id"]
        out.append(_mep_plan(
            model, lid, "SEG-P-UBI-%s" % lid,
            "Plano de seguridad y proteccion %s" % level["name"].lower(), "security",
            ("SEG-DETECCION", "SEG-CCTV", "SEG-ACCESO", "SEG-EMERGENCIA",
             "SEG-SENALIZACION", "SEG-INCENDIO", "SEG-EQUIPOS"),
            "Deteccion, CCTV, control de acceso, emergencia, senalizacion e incendio",
            SEG_NOTES))
    out.append(_route_isometric(model, "SEG-I-REC",
                               "Recorridos de cableado de seguridad", "security",
                               ("SEG-CANALIZACIONES", "SEG-EQUIPOS", "SEG-DETECCION",
                                "SEG-CCTV", "SEG-EMERGENCIA"),
                               "Montante y troncales de deteccion y control", SEG_NOTES))
    out.append(_security_supply_diagram(model))
    return out


def _security_supply_diagram(model) -> Sheet:
    sh = _new("SEG-D-ALI", "Alimentacion y comunicacion de seguridad", "security", "diagrama", 1,
              level_label="Conjunto",
              subtitle="Como se alimenta y como comunica cada subsistema",
              notes=list(COMMON_NOTES) + SEG_NOTES)
    rows: List[List[str]] = []
    kinds = ("smoke_detector", "motion_sensor", "cctv_camera", "access_reader",
             "emergency_light", "exit_sign", "fire_extinguisher", "fire_hose_cabinet",
             "security_panel")
    supply = {
        "smoke_detector": ("lazo del panel SEG-PAN-001", "cable de control"),
        "motion_sensor": ("lazo del panel SEG-PAN-001", "cable de control"),
        "cctv_camera": ("PoE desde el switch de piso", "IP sobre Ethernet"),
        "access_reader": ("lazo del panel SEG-PAN-001", "cable de control"),
        "emergency_light": ("bateria autonoma + circuito de alumbrado", "no comunica"),
        "exit_sign": ("bateria autonoma + circuito de alumbrado", "no comunica"),
        "fire_extinguisher": ("no requiere", "no comunica"),
        "fire_hose_cabinet": ("red de incendio (pendiente)", "no comunica"),
        "security_panel": ("circuito de fuerza ELE-CIR-FUE", "lazos y red"),
    }
    for t in kinds:
        items = model.by_type(t)
        if not items:
            continue
        s, c = supply[t]
        rows.append([t[:24], str(len(items)), s[:44], c[:30], "pendiente", "pendiente"])
    D.draw_table(sh, ["SUBSISTEMA", "CANT", "ALIMENTACION", "COMUNICACION",
                      "AUTONOMIA", "VERIFICACION NORMATIVA"],
                 rows, [54.0, 20.0, 92.0, 62.0, 30.0, 52.0],
                 (24.0, sh.size_mm[1] - 40.0), title="ALIMENTACION Y COMUNICACION POR SUBSISTEMA")
    sh.add_paper(Text("LAM-TEXTO", (24.0, 110.0),
                      "El panel SEG-PAN-001 concentra deteccion, alarma y control de acceso. "
                      "El CCTV usa la red de datos. Ningun subsistema tiene autonomia ni "
                      "zonificacion definidas.", height_mm=2.4))
    D.finish(sh, rescale=False)
    return sh


# ---------------------------------------------------------------------------
# MODELO INTEGRAL
# ---------------------------------------------------------------------------


def model_sheets(model, clashes: Optional[List[Dict[str, Any]]] = None) -> List[Sheet]:
    out: List[Sheet] = []

    out.append(_route_isometric(
        model, "MOD-I-GEN", "Isometrico general del edificio", "model",
        ("ARQ-MUROS", "ESTR-COLUMNAS", "ESTR-LOSAS", "ESTR-VIGAS", "ARQ-CUBIERTA",
         "ESTR-ESCALERA"),
        "Vista axonometrica de la envolvente y la estructura", with_envelope=False))

    out.append(_route_isometric(
        model, "MOD-I-EST", "Isometrico estructural", "model",
        ("ESTR-COLUMNAS", "ESTR-VIGAS", "ESTR-LOSAS", "ESTR-ESCALERA", "ESTR-CIMENTACION"),
        "Porticos, losas, escalera y cimentacion conceptual", with_envelope=False))

    out.append(_route_isometric(
        model, "MOD-I-MEP", "Isometrico de instalaciones", "model",
        ("ELE-CIRCUITOS", "ELE-CANALIZACIONES", "ELE-ALIMENTADORES",
         "TEL-CANALIZACIONES", "HID-AGUA", "HID-DESAGUE", "HID-VENTILACION",
         "HID-PLUVIAL", "CLI-DUCTOS", "CLI-FRIGORIFICA", "SEG-CANALIZACIONES"),
        "Todas las instalaciones superpuestas sobre la envolvente estructural"))

    # Vista explosionada
    prims, refs = V.exploded_isometric(
        model, layers=("ARQ-MUROS", "ESTR-COLUMNAS", "ESTR-LOSAS", "ARQ-CUBIERTA",
                       "ESTR-ESCALERA"), spacing=7.0)
    sh = _new("MOD-I-EXP", "Vista explosionada por niveles", "model", "isometrico", 150,
              level_label="Conjunto",
              subtitle="Cada nivel desplazado 7.00 m en vertical para mostrar su contenido")
    sh.legend = auto_legend(prims)
    sh.notes = list(COMMON_NOTES) + [
        "El desplazamiento es una separacion de presentacion; no altera las cotas del modelo.",
    ]
    out.append(compose(sh, prims, None, padding_mm=10.0, refs=refs))

    if clashes is not None:
        out.append(_clash_sheet(model, clashes))
    return out


def _clash_sheet(model, clashes: List[Dict[str, Any]]) -> Sheet:
    sh = _new("MOD-T-COL", "Informe de colisiones geometricas", "model", "cuadro", 1,
              level_label="Conjunto",
              subtitle="Interferencias detectadas entre solidos del modelo")
    rows: List[List[str]] = []
    for c in clashes[:400]:
        rows.append([c["kind"][:22], c["a"][:34], c["b"][:34],
                     "%.4f" % c["overlap_m3"], c["level"] or "-", c["severity"]])
    if not rows:
        rows = [["-", "Sin interferencias registradas", "-", "-", "-", "-"]]
    D.draw_table(sh, ["TIPO", "ELEMENTO A", "ELEMENTO B", "SOLAPE m3", "NIVEL", "CLASIFICACION"],
                 rows, [48.0, 70.0, 70.0, 28.0, 22.0, 56.0],
                 (24.0, sh.size_mm[1] - 34.0), title="COLISIONES Y PASES DETECTADOS",
                 max_rows=70)
    sh.add_paper(Text("LAM-TEXTO", (24.0, 92.0),
                      "Total detectado: %d. Las interferencias clasificadas como PASE DE MURO "
                      "son esperadas y requieren manguito y coordinacion en obra; las "
                      "clasificadas como COLISION ESTRUCTURAL requieren rediseno del trazado."
                      % len(clashes), height_mm=2.4))
    sh.add_paper(Text("LAM-TEXTO", (24.0, 86.0),
                      "El analisis compara envolventes y volumenes de interseccion entre "
                      "solidos. No sustituye una coordinacion BIM completa.", height_mm=2.4))
    D.finish(sh, rescale=False)
    return sh

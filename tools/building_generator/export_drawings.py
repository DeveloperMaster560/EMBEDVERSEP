"""Exportacion de laminas a DXF, PDF y SVG.

Las tres salidas se generan desde la MISMA lista de primitivas de la lamina,
expandiendo antes las cotas a geometria explicita. Por eso son geometricamente
identicas y los valores rotulados coinciden.

Sistemas de unidades de cada salida:

  DXF   1 unidad = 1 metro. La geometria de la vista va a tamano real y el
        marco/cajetin se convierte de milimetros de papel a metros con la
        escala de la lamina. El archivo es medible en CAD.
  PDF   puntos PostScript (1 mm = 72/25.4 pt). Lamina plotada a tamano real.
  SVG   milimetros, con viewBox en milimetros.
"""

from __future__ import annotations

import math
import os
from typing import Dict, List, Sequence, Tuple

import drafting as D
from drafting import Arc, Circle, Hatch, Line, PolyLine, Prim, Sheet, Text

MM_TO_PT = 72.0 / 25.4


# ---------------------------------------------------------------------------
# Preparacion comun
# ---------------------------------------------------------------------------


def _prepared(sheet: Sheet) -> Tuple[List[Prim], List[Prim]]:
    """Primitivas de modelo y de papel, con cotas ya expandidas."""
    return (D.flatten(sheet.model_prims, sheet.scale),
            D.flatten(sheet.paper_prims, 1))


def _paper_prims_in_mm(sheet: Sheet) -> List[Prim]:
    """Todas las primitivas llevadas a milimetros de papel."""
    model, paper = _prepared(sheet)
    out: List[Prim] = []
    for p in model:
        out.append(_transform(p, sheet.model_to_paper, scale_len=1000.0 / sheet.scale))
    out.extend(paper)
    return out


def _model_prims_in_m(sheet: Sheet) -> List[Prim]:
    """Todas las primitivas llevadas a metros de modelo."""
    model, paper = _prepared(sheet)
    out: List[Prim] = list(model)
    k = sheet.scale / 1000.0
    for p in paper:
        out.append(_transform(p, sheet.paper_to_model, scale_len=k))
    return out


def _transform(p: Prim, fn, scale_len: float) -> Prim:
    if isinstance(p, PolyLine):
        return PolyLine(p.layer, [fn(pt) for pt in p.points], p.closed)
    if isinstance(p, Line):
        return Line(p.layer, fn(p.a), fn(p.b))
    if isinstance(p, Circle):
        return Circle(p.layer, fn(p.center), p.radius * scale_len)
    if isinstance(p, Arc):
        return Arc(p.layer, fn(p.center), p.radius * scale_len, p.start_deg, p.end_deg)
    if isinstance(p, Text):
        return Text(p.layer, fn(p.position), p.text, p.height_mm, p.rotation,
                    p.anchor, p.vertical)
    if isinstance(p, Hatch):
        return Hatch(p.layer, [[fn(pt) for pt in ring] for ring in p.rings],
                     p.pattern, p.scale, p.angle)
    raise TypeError("primitiva no soportada: %r" % type(p))


# ---------------------------------------------------------------------------
# DXF
# ---------------------------------------------------------------------------


def write_dxf(sheet: Sheet, path: str) -> Dict[str, object]:
    import ezdxf

    doc = ezdxf.new("R2018", setup=True)
    doc.header["$INSUNITS"] = 6          # metros
    doc.header["$MEASUREMENT"] = 1       # sistema metrico
    msp = doc.modelspace()

    used = set()
    prims = _model_prims_in_m(sheet)
    for p in prims:
        used.add(p.layer)
    for name in sorted(used):
        lay = D.layer(name)
        if name not in doc.layers:
            doc.layers.add(name, color=lay.aci,
                           linetype=lay.linetype if lay.linetype in doc.linetypes else "CONTINUOUS")
            doc.layers.get(name).dxf.lineweight = max(5, int(round(lay.lineweight_mm * 100)))

    counts = {"polyline": 0, "line": 0, "circle": 0, "arc": 0, "text": 0, "hatch": 0}
    k = sheet.scale / 1000.0   # mm de ploteo -> metros de modelo

    for p in prims:
        attrs = {"layer": p.layer}
        if isinstance(p, PolyLine):
            msp.add_lwpolyline(p.points, close=p.closed, dxfattribs=attrs)
            counts["polyline"] += 1
        elif isinstance(p, Line):
            msp.add_line(p.a, p.b, dxfattribs=attrs)
            counts["line"] += 1
        elif isinstance(p, Circle):
            msp.add_circle(p.center, p.radius, dxfattribs=attrs)
            counts["circle"] += 1
        elif isinstance(p, Arc):
            msp.add_arc(p.center, p.radius, p.start_deg, p.end_deg, dxfattribs=attrs)
            counts["arc"] += 1
        elif isinstance(p, Text):
            h = max(p.height_mm * k, 1e-5)
            t = msp.add_text(p.text, height=h, rotation=p.rotation, dxfattribs=attrs)
            align = {"left": "LEFT", "center": "MIDDLE_CENTER", "right": "RIGHT"}[p.anchor]
            if p.anchor == "center" and p.vertical != "middle":
                align = "BOTTOM_CENTER"
            t.set_placement(p.position, align=ezdxf.enums.TextEntityAlignment[align])
            counts["text"] += 1
        elif isinstance(p, Hatch):
            h = msp.add_hatch(color=D.layer(p.layer).aci, dxfattribs=attrs)
            for ring in p.rings:
                h.paths.add_polyline_path(ring, is_closed=True)
            counts["hatch"] += 1

    doc.saveas(path)
    return {"path": path, "entities": sum(counts.values()), "by_kind": counts,
            "layers": sorted(used), "units": "m", "dxf_version": "AC1032"}


# ---------------------------------------------------------------------------
# PDF
# ---------------------------------------------------------------------------


def write_pdf(sheet: Sheet, path: str) -> Dict[str, object]:
    from reportlab.pdfgen import canvas as rl_canvas

    w_mm, h_mm = sheet.size_mm
    c = rl_canvas.Canvas(path, pagesize=(w_mm * MM_TO_PT, h_mm * MM_TO_PT))
    c.setTitle("%s %s" % (sheet.code, sheet.title))
    c.setAuthor(D.PROJECT_HEADER["author"])
    c.setSubject("%s - %s - escala %s" % (D.PROJECT_HEADER["project"], sheet.discipline,
                                          D.scale_label(sheet.scale)))
    c.setCreator("EMBEDVERSE building generator")

    prims = _paper_prims_in_mm(sheet)
    drawn = 0
    for p in prims:
        lay = D.layer(p.layer)
        r, g, b = [v / 255.0 for v in lay.rgb]
        c.setStrokeColorRGB(r, g, b)
        c.setFillColorRGB(r, g, b)
        c.setLineWidth(max(lay.lineweight_mm, 0.05) * MM_TO_PT)
        if lay.linetype == "DASHED":
            c.setDash(2.2 * MM_TO_PT, 1.4 * MM_TO_PT)
        elif lay.linetype == "CENTER":
            c.setDash([4.0 * MM_TO_PT, 1.2 * MM_TO_PT, 1.2 * MM_TO_PT, 1.2 * MM_TO_PT], 0)
        else:
            c.setDash()

        if isinstance(p, PolyLine):
            if len(p.points) < 2:
                continue
            pth = c.beginPath()
            pth.moveTo(p.points[0][0] * MM_TO_PT, p.points[0][1] * MM_TO_PT)
            for pt in p.points[1:]:
                pth.lineTo(pt[0] * MM_TO_PT, pt[1] * MM_TO_PT)
            if p.closed:
                pth.close()
            c.drawPath(pth, stroke=1, fill=0)
            drawn += 1
        elif isinstance(p, Line):
            c.line(p.a[0] * MM_TO_PT, p.a[1] * MM_TO_PT,
                   p.b[0] * MM_TO_PT, p.b[1] * MM_TO_PT)
            drawn += 1
        elif isinstance(p, Circle):
            c.circle(p.center[0] * MM_TO_PT, p.center[1] * MM_TO_PT,
                     max(p.radius, 0.01) * MM_TO_PT, stroke=1, fill=0)
            drawn += 1
        elif isinstance(p, Arc):
            cx, cy, rr = p.center[0] * MM_TO_PT, p.center[1] * MM_TO_PT, p.radius * MM_TO_PT
            c.arc(cx - rr, cy - rr, cx + rr, cy + rr, p.start_deg,
                  p.end_deg - p.start_deg)
            drawn += 1
        elif isinstance(p, Text):
            c.setDash()
            size = max(p.height_mm, 0.8) * MM_TO_PT
            c.setFont("Helvetica", size)
            c.saveState()
            c.translate(p.position[0] * MM_TO_PT, p.position[1] * MM_TO_PT)
            if p.rotation:
                c.rotate(p.rotation)
            dy = -size * 0.36 if p.vertical == "middle" else 0.0
            if p.anchor == "center":
                c.drawCentredString(0, dy, p.text)
            elif p.anchor == "right":
                c.drawRightString(0, dy, p.text)
            else:
                c.drawString(0, dy, p.text)
            c.restoreState()
            drawn += 1
        elif isinstance(p, Hatch):
            for ring in p.rings:
                if len(ring) < 3:
                    continue
                pth = c.beginPath()
                pth.moveTo(ring[0][0] * MM_TO_PT, ring[0][1] * MM_TO_PT)
                for pt in ring[1:]:
                    pth.lineTo(pt[0] * MM_TO_PT, pt[1] * MM_TO_PT)
                pth.close()
                c.drawPath(pth, stroke=0, fill=1)
            drawn += 1

    c.showPage()
    c.save()
    return {"path": path, "entities": drawn, "paper": sheet.paper,
            "size_mm": [w_mm, h_mm], "units": "pt"}


# ---------------------------------------------------------------------------
# SVG
# ---------------------------------------------------------------------------


def _svg_escape(s: str) -> str:
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;"))


def write_svg(sheet: Sheet, path: str) -> Dict[str, object]:
    w_mm, h_mm = sheet.size_mm
    prims = _paper_prims_in_mm(sheet)
    fy = lambda y: h_mm - y        # SVG tiene Y hacia abajo

    parts: List[str] = []
    parts.append(
        '<svg xmlns="http://www.w3.org/2000/svg" version="1.1" '
        'width="%.3fmm" height="%.3fmm" viewBox="0 0 %.3f %.3f">' % (w_mm, h_mm, w_mm, h_mm))
    parts.append('<title>%s %s</title>' % (_svg_escape(sheet.code), _svg_escape(sheet.title)))
    parts.append('<desc>%s - %s - escala %s - generado automaticamente, sin revision '
                 'profesional</desc>' % (_svg_escape(D.PROJECT_HEADER["project"]),
                                         _svg_escape(sheet.discipline),
                                         D.scale_label(sheet.scale)))
    parts.append('<rect x="0" y="0" width="%.3f" height="%.3f" fill="#ffffff"/>' % (w_mm, h_mm))

    by_layer: Dict[str, List[Prim]] = {}
    for p in prims:
        by_layer.setdefault(p.layer, []).append(p)

    drawn = 0
    for name in sorted(by_layer):
        lay = D.layer(name)
        col = "#%02x%02x%02x" % lay.rgb
        dash = ""
        if lay.linetype == "DASHED":
            dash = ' stroke-dasharray="2.2,1.4"'
        elif lay.linetype == "CENTER":
            dash = ' stroke-dasharray="4,1.2,1.2,1.2"'
        parts.append('<g id="%s" stroke="%s" stroke-width="%.3f" fill="none"%s>'
                     % (_svg_escape(name), col, max(lay.lineweight_mm, 0.05), dash))
        for p in by_layer[name]:
            if isinstance(p, PolyLine):
                if len(p.points) < 2:
                    continue
                pts = " ".join("%.3f,%.3f" % (x, fy(y)) for x, y in p.points)
                tag = "polygon" if p.closed else "polyline"
                parts.append('<%s points="%s"/>' % (tag, pts))
                drawn += 1
            elif isinstance(p, Line):
                parts.append('<line x1="%.3f" y1="%.3f" x2="%.3f" y2="%.3f"/>'
                             % (p.a[0], fy(p.a[1]), p.b[0], fy(p.b[1])))
                drawn += 1
            elif isinstance(p, Circle):
                parts.append('<circle cx="%.3f" cy="%.3f" r="%.3f"/>'
                             % (p.center[0], fy(p.center[1]), max(p.radius, 0.01)))
                drawn += 1
            elif isinstance(p, Arc):
                a0 = math.radians(p.start_deg)
                a1 = math.radians(p.end_deg)
                x0 = p.center[0] + p.radius * math.cos(a0)
                y0 = p.center[1] + p.radius * math.sin(a0)
                x1 = p.center[0] + p.radius * math.cos(a1)
                y1 = p.center[1] + p.radius * math.sin(a1)
                large = 1 if (p.end_deg - p.start_deg) % 360.0 > 180.0 else 0
                parts.append('<path d="M %.3f %.3f A %.3f %.3f 0 %d 0 %.3f %.3f"/>'
                             % (x0, fy(y0), p.radius, p.radius, large, x1, fy(y1)))
                drawn += 1
            elif isinstance(p, Text):
                anchor = {"left": "start", "center": "middle", "right": "end"}[p.anchor]
                dy = 0.36 * p.height_mm if p.vertical == "middle" else 0.0
                rot = ""
                if p.rotation:
                    rot = ' transform="rotate(%.2f %.3f %.3f)"' % (
                        -p.rotation, p.position[0], fy(p.position[1]))
                parts.append(
                    '<text x="%.3f" y="%.3f" font-family="Helvetica,Arial,sans-serif" '
                    'font-size="%.3f" fill="%s" stroke="none" text-anchor="%s"%s>%s</text>'
                    % (p.position[0], fy(p.position[1]) + dy, max(p.height_mm, 0.8), col,
                       anchor, rot, _svg_escape(p.text)))
                drawn += 1
            elif isinstance(p, Hatch):
                for ring in p.rings:
                    if len(ring) < 3:
                        continue
                    pts = " ".join("%.3f,%.3f" % (x, fy(y)) for x, y in ring)
                    parts.append('<polygon points="%s" fill="%s" stroke="none"/>' % (pts, col))
                drawn += 1
        parts.append("</g>")
    parts.append("</svg>")

    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(parts))
    return {"path": path, "entities": drawn, "paper": sheet.paper, "units": "mm"}


# ---------------------------------------------------------------------------
# Verificacion por relectura
# ---------------------------------------------------------------------------


def verify_dxf(path: str) -> Dict[str, object]:
    import ezdxf

    doc = ezdxf.readfile(path)
    msp = doc.modelspace()
    ents = list(msp)
    kinds: Dict[str, int] = {}
    for e in ents:
        kinds[e.dxftype()] = kinds.get(e.dxftype(), 0) + 1
    return {"ok": True, "dxf_version": doc.dxfversion, "entities": len(ents),
            "entity_types": dict(sorted(kinds.items())),
            "layers": sorted(l.dxf.name for l in doc.layers),
            "bytes": os.path.getsize(path)}


def verify_pdf(path: str) -> Dict[str, object]:
    with open(path, "rb") as fh:
        head = fh.read(5)
        fh.seek(max(0, os.path.getsize(path) - 1024))
        tail = fh.read()
    return {"ok": head == b"%PDF-" and b"%%EOF" in tail,
            "header": head.decode("latin-1"),
            "has_eof": b"%%EOF" in tail,
            "bytes": os.path.getsize(path)}


def verify_svg(path: str) -> Dict[str, object]:
    import xml.etree.ElementTree as ET

    tree = ET.parse(path)
    root = tree.getroot()
    n = sum(1 for _ in root.iter())
    return {"ok": root.tag.endswith("svg"), "elements": n,
            "width": root.get("width"), "height": root.get("height"),
            "bytes": os.path.getsize(path)}

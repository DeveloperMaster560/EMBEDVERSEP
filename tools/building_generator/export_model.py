"""Exportacion del modelo tridimensional: IFC4, GLB, OBJ y STEP.

Cada exportador verifica su resultado volviendo a abrir el archivo escrito. Un
formato solo se declara entregado si esa relectura tiene exito.

Correspondencia de representaciones

  IFC4   Los prismas se exportan como solidos de extrusion (SweptSolid), con
         huecos cuando el perfil los tiene. El resto (barridos de tuberia y
         ducto, revoluciones) se exporta como malla triangulada
         (IfcTriangulatedFaceSet). Ambos son representaciones IFC4 validas.
  GLB    Malla triangulada con jerarquia de nodos por nivel y disciplina, para
         poder mostrar y ocultar capas.
  OBJ    Malla triangulada, un objeto por componente.
  STEP   B-rep exacto de OpenCascade. Los cilindros son superficies exactas,
         no teseladas; es la unica salida donde la tuberia no esta facetada.
"""

from __future__ import annotations

import math
import os
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

import numpy as np

import params as P
import solids as S

STEP_DISCIPLINES = ("structure", "architecture")


def _sanitize(name: str) -> str:
    return "".join(ch if (ch.isalnum() or ch in "-_.") else "_" for ch in name)


# ---------------------------------------------------------------------------
# IFC4
# ---------------------------------------------------------------------------


def write_ifc(model, path: str) -> Dict[str, Any]:
    import ifcopenshell
    import ifcopenshell.api

    f = ifcopenshell.file(schema="IFC4")
    run = ifcopenshell.api.run

    project = run("root.create_entity", f, ifc_class="IfcProject", name=P.PROJECT_NAME)
    run("unit.assign_unit", f, length={"is_metric": True, "raw": "METERS"})
    ctx = run("context.add_context", f, context_type="Model")
    body = run("context.add_context", f, context_type="Model", context_identifier="Body",
               target_view="MODEL_VIEW", parent=ctx)

    site = run("root.create_entity", f, ifc_class="IfcSite", name="Lote de referencia")
    building = run("root.create_entity", f, ifc_class="IfcBuilding", name=P.PROJECT_ID)
    run("aggregate.assign_object", f, products=[site], relating_object=project)
    run("aggregate.assign_object", f, products=[building], relating_object=site)

    storeys: Dict[str, Any] = {}
    for lv in [P.FOUNDATION_LEVEL] + list(P.ALL_LEVELS):
        st = run("root.create_entity", f, ifc_class="IfcBuildingStorey", name=lv["name"])
        st.Elevation = float(lv["elevation"])
        run("aggregate.assign_object", f, products=[st], relating_object=building)
        storeys[lv["level_id"]] = st
    default_storey = storeys["N1"]

    def pt(x, y, z=None):
        return f.create_entity("IfcCartesianPoint",
                               Coordinates=(float(x), float(y)) if z is None
                               else (float(x), float(y), float(z)))

    def polyline_profile(ring: Sequence[Tuple[float, float]]):
        pts = [pt(x, y) for x, y in ring] + [pt(ring[0][0], ring[0][1])]
        return f.create_entity("IfcPolyline", Points=pts)

    def extruded(prim: S.Prism):
        poly = prim.polygon()
        outer = list(poly.exterior.coords)[:-1]
        outer_curve = polyline_profile(outer)
        if poly.interiors:
            inner = [polyline_profile(list(r.coords)[:-1]) for r in poly.interiors]
            profile = f.create_entity("IfcArbitraryProfileDefWithVoids",
                                      ProfileType="AREA", OuterCurve=outer_curve,
                                      InnerCurves=inner)
        else:
            profile = f.create_entity("IfcArbitraryClosedProfileDef",
                                      ProfileType="AREA", OuterCurve=outer_curve)
        placement = f.create_entity(
            "IfcAxis2Placement3D", Location=pt(0.0, 0.0, float(prim.z0)))
        return f.create_entity("IfcExtrudedAreaSolid", SweptArea=profile,
                               Position=placement,
                               ExtrudedDirection=f.create_entity(
                                   "IfcDirection", DirectionRatios=(0.0, 0.0, 1.0)),
                               Depth=float(max(prim.height, 1e-6)))

    def tessellated(solid: S.Solid):
        mesh = solid.to_trimesh()
        if mesh is None or not len(mesh.faces):
            return None
        verts = [tuple(float(v) for v in row) for row in mesh.vertices]
        plist = f.create_entity("IfcCartesianPointList3D", CoordList=verts)
        faces = [tuple(int(i) + 1 for i in tri) for tri in mesh.faces]
        return f.create_entity("IfcTriangulatedFaceSet", Coordinates=plist,
                               Closed=bool(mesh.is_watertight), CoordIndex=faces)

    created = 0
    swept = 0
    tess = 0
    skipped: List[str] = []

    for comp in sorted(model.components.values(), key=lambda c: c.component_id):
        solid = model.solids.get(comp.geometry_reference) if comp.geometry_reference else None
        ifc_class = comp.ifc_class or "IfcBuildingElementProxy"
        try:
            product = run("root.create_entity", f, ifc_class=ifc_class, name=comp.name)
        except Exception:
            product = run("root.create_entity", f, ifc_class="IfcBuildingElementProxy",
                          name=comp.name)
        product.Description = "%s | %s" % (comp.component_id, comp.type)
        # Tag solo existe en los elementos; los elementos espaciales no lo tienen.
        if product.is_a("IfcElement"):
            product.Tag = comp.component_id

        storey = storeys.get(comp.level_id or "", default_storey)
        try:
            if product.is_a("IfcSpatialElement"):
                # Un IfcSpace se AGREGA al nivel, no se contiene en el.
                run("aggregate.assign_object", f, products=[product], relating_object=storey)
            else:
                run("spatial.assign_container", f, products=[product],
                    relating_structure=storey)
        except Exception:
            pass

        if solid is not None and solid.primitives:
            items = []
            if all(isinstance(p, S.Prism) for p in solid.primitives):
                items = [extruded(p) for p in solid.primitives]
                rep_type = "SweptSolid"
                swept += 1
            else:
                item = tessellated(solid)
                items = [item] if item is not None else []
                rep_type = "Tessellation"
                tess += 1
            if items:
                rep = f.create_entity("IfcShapeRepresentation", ContextOfItems=body,
                                      RepresentationIdentifier="Body",
                                      RepresentationType=rep_type, Items=items)
                run("geometry.assign_representation", f, product=product, representation=rep)
                created += 1
            else:
                skipped.append(comp.component_id)
        else:
            skipped.append(comp.component_id)

        # Conjunto de propiedades con los datos del catalogo
        props: Dict[str, Any] = {}
        for k, v in comp.parameters.items():
            if v is None:
                continue
            if isinstance(v, bool):
                props[k] = v
            elif isinstance(v, (int, float)):
                props[k] = float(v)
            elif isinstance(v, str):
                props[k] = v[:250]
            elif isinstance(v, (list, tuple)):
                props[k] = ", ".join(str(x) for x in v)[:250]
        props["component_id"] = comp.component_id
        props["discipline"] = comp.discipline
        props["provenance"] = comp.provenance
        props["validation_status"] = comp.validation_status
        props["professional_review"] = comp.professional_review
        if comp.requires_calculation:
            props["pending_parameters"] = ", ".join(comp.requires_calculation)[:250]
        try:
            pset = run("pset.add_pset", f, product=product, name="EMBEDVERSE_Component")
            run("pset.edit_pset", f, pset=pset, properties=props)
        except Exception:
            pass

    f.write(path)

    g = ifcopenshell.open(path)
    return {
        "path": path, "schema": g.schema,
        "products_with_geometry": created,
        "swept_solid_products": swept,
        "tessellated_products": tess,
        "products_without_geometry": len(skipped),
        "storeys": len(g.by_type("IfcBuildingStorey")),
        "total_entities": len(list(g)),
        "bytes": os.path.getsize(path),
        "verified_by_reopen": True,
    }


# ---------------------------------------------------------------------------
# GLB / OBJ
# ---------------------------------------------------------------------------


def _build_scene(model, include: Optional[Sequence[str]] = None):
    import trimesh

    scene = trimesh.Scene()
    added = 0
    failed: List[str] = []
    for comp in sorted(model.components.values(), key=lambda c: c.component_id):
        if not comp.geometry_reference:
            continue
        solid = model.solids.get(comp.geometry_reference)
        if solid is None:
            continue
        if include is not None and solid.discipline not in include:
            continue
        non_material = (getattr(model, "clash_roles", {}) or {}).get(
            "non_material_layers", {"ARQ-ESPACIOS"})
        if solid.layer in non_material:
            continue
        try:
            mesh = solid.to_trimesh()
        except Exception:
            failed.append(comp.component_id)
            continue
        if mesh is None or not len(mesh.faces):
            continue
        mesh = mesh.copy()
        # Los materiales los declara el modelo; los de edificacion son el
        # respaldo para no romper el paquete de planos existente.
        palette = getattr(model, "materials", None) or P.MATERIALS
        mat = palette.get(solid.material, {})
        color = mat.get("color", [0.7, 0.7, 0.7])
        opacity = mat.get("opacity", 1.0)
        rgba = [int(max(0.0, min(1.0, c)) * 255) for c in color] + [int(opacity * 255)]
        mesh.visual = trimesh.visual.ColorVisuals(mesh=mesh, face_colors=rgba)
        mesh.metadata.update({
            "component_id": comp.component_id,
            "discipline": comp.discipline,
            "type": comp.type,
            "level": comp.level_id or "",
            "layer": solid.layer,
            "material": solid.material,
        })
        node = _sanitize("%s__%s__%s" % (comp.discipline, comp.level_id or "SIN", comp.component_id))
        scene.add_geometry(mesh, node_name=node, geom_name=_sanitize(comp.component_id))
        added += 1
    return scene, added, failed


def write_glb(model, path: str) -> Dict[str, Any]:
    import trimesh

    scene, added, failed = _build_scene(model)
    data = scene.export(file_type="glb")
    with open(path, "wb") as fh:
        fh.write(data)

    reopened = trimesh.load(path, force="scene")
    return {
        "path": path, "nodes_written": added, "failed": failed,
        "geometries_on_reopen": len(reopened.geometry),
        "triangles": int(sum(len(g.faces) for g in reopened.geometry.values())),
        "bytes": os.path.getsize(path),
        "verified_by_reopen": True,
    }


def write_obj(model, path: str) -> Dict[str, Any]:
    import trimesh

    scene, added, failed = _build_scene(model)
    combined = trimesh.util.concatenate(
        [g for g in scene.dump()]) if added else trimesh.Trimesh()
    combined.export(path)
    reopened = trimesh.load(path, force="mesh")
    return {
        "path": path, "objects_merged": added, "failed": failed,
        "vertices_on_reopen": int(len(reopened.vertices)),
        "triangles_on_reopen": int(len(reopened.faces)),
        "bytes": os.path.getsize(path),
        "verified_by_reopen": True,
        "note": ("OBJ se entrega como malla unica concatenada. La identidad por componente "
                 "se conserva en GLB, IFC y en el catalogo JSON."),
    }


# ---------------------------------------------------------------------------
# STEP
# ---------------------------------------------------------------------------


def write_step(model, path: str,
               disciplines: Sequence[str] = STEP_DISCIPLINES) -> Dict[str, Any]:
    import cadquery as cq

    asm = cq.Assembly(name=_sanitize(P.PROJECT_ID))
    added = 0
    failed: List[str] = []
    for comp in sorted(model.components.values(), key=lambda c: c.component_id):
        if not comp.geometry_reference:
            continue
        solid = model.solids.get(comp.geometry_reference)
        if solid is None or solid.discipline not in disciplines:
            continue
        non_material = (getattr(model, "clash_roles", {}) or {}).get(
            "non_material_layers", {"ARQ-ESPACIOS"})
        if solid.layer in non_material:
            continue
        try:
            wp = solid.to_cadquery()
            if wp is None:
                continue
            asm.add(wp, name=_sanitize(comp.component_id))
            added += 1
        except Exception:
            failed.append(comp.component_id)
    asm.save(path)

    reopened = cq.importers.importStep(path)
    solids = reopened.solids().vals()
    volume = float(sum(s.Volume() for s in solids))
    return {
        "path": path, "components_written": added, "failed": failed,
        "disciplines": list(disciplines),
        "solids_on_reopen": len(solids),
        "volume_on_reopen_m3": round(volume, 4),
        "bytes": os.path.getsize(path),
        "verified_by_reopen": True,
        "note": ("STEP cubre estructura y arquitectura, que es donde un B-rep CAD exacto "
                 "aporta valor. Las instalaciones se entregan en IFC y GLB."),
    }


# ---------------------------------------------------------------------------
# Mallas por disciplina (para el directorio geometry/)
# ---------------------------------------------------------------------------


def write_discipline_glb(model, directory: str) -> List[Dict[str, Any]]:
    import trimesh

    os.makedirs(directory, exist_ok=True)
    out: List[Dict[str, Any]] = []
    for disc in sorted({s.discipline for s in model.solids.values()}):
        scene, added, _ = _build_scene(model, include=[disc])
        if not added:
            continue
        path = os.path.join(directory, "%s.glb" % disc)
        with open(path, "wb") as fh:
            fh.write(scene.export(file_type="glb"))
        reopened = trimesh.load(path, force="scene")
        out.append({"discipline": disc, "path": path, "nodes": added,
                    "geometries_on_reopen": len(reopened.geometry),
                    "bytes": os.path.getsize(path), "verified_by_reopen": True})
    return out

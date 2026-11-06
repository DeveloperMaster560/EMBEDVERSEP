"""Utilidades comunes a los paquetes de instalaciones.

Centraliza la creacion de un dispositivo (equipo con volumen prismatico) y de
un recorrido (tuberia, ducto o canalizacion), garantizando que en todos los
casos se registre:

  * el solido parametrico,
  * la operacion que lo produjo en el registro de procedimientos,
  * el componente del catalogo con sus parametros pendientes declarados.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence, Tuple

import routing as R
import solids as S
from catalog import Component, Connection

Point3 = Tuple[float, float, float]


def add_device(
    model, *, component_id: str, discipline: str, type: str, name: str,
    xyz: Point3, box: Tuple[float, float, float], material: str, ifc_class: str,
    layer: str, parameters: Dict[str, Any], requires_calculation: Sequence[str],
    tags: Sequence[str], op_description: str, derived_from: Sequence[str],
    level_id: Optional[str] = None, space_id: Optional[str] = None,
    provenance: str = "hypothesis", op_inputs: Optional[Dict[str, Any]] = None,
    op_outputs: Optional[Dict[str, Any]] = None,
    validation_notes: Optional[Sequence[str]] = None,
) -> Component:
    x, y, z = xyz
    dx, dy, dz = box
    sid = "SOL-%s" % component_id
    solid = S.Solid(
        sid, [S.box_prism(x - dx / 2, y - dy / 2, x + dx / 2, y + dy / 2,
                          z - dz / 2, z + dz / 2)],
        material, discipline, level_id, layer,
    )
    op = model.oplog.record(
        "extrude", "creation", op_description,
        component_id=component_id, solid_id=sid,
        inputs=dict({"position": [round(v, 4) for v in xyz],
                     "box_dimensions": [dx, dy, dz]}, **(op_inputs or {})),
        outputs=dict(op_outputs or {}),
        derived_from=list(derived_from),
        implementation="solids.Prism (prisma del envolvente del equipo)",
    )
    comp = Component(
        component_id=component_id, discipline=discipline, type=type, name=name,
        level_id=level_id, space_id=space_id, material=material, ifc_class=ifc_class,
        position=[round(v, 4) for v in xyz],
        dimensions={"width": dx, "depth": dy, "height": dz},
        parameters=dict(parameters), requires_calculation=list(requires_calculation),
        provenance=provenance, tags=list(tags),
        validation_notes=list(validation_notes or []),
    )
    comp.operations.append(op)
    comp.geometry_reference = sid
    model.add_solid(solid)
    model.add_component(comp)
    return comp


def add_route(
    model, *, component_id: str, discipline: str, type: str, name: str,
    polylines: Sequence[Sequence[Point3]], material: str, ifc_class: str, layer: str,
    parameters: Dict[str, Any], requires_calculation: Sequence[str], tags: Sequence[str],
    op_description: str, derived_from: Sequence[str],
    diameter: Optional[float] = None, section: Optional[Tuple[float, float]] = None,
    level_id: Optional[str] = None, space_id: Optional[str] = None,
    provenance: str = "derived", op_inputs: Optional[Dict[str, Any]] = None,
    op_outputs: Optional[Dict[str, Any]] = None,
    flow_direction: Optional[str] = None,
    validation_notes: Optional[Sequence[str]] = None,
) -> Tuple[Component, float]:
    if (diameter is None) == (section is None):
        raise ValueError("indique diameter o section, no ambos")
    sid = "SOL-%s" % component_id
    prims: List[S.Primitive] = []
    for pl in polylines:
        if diameter is not None:
            prims.extend(S.polyline_pipe(pl, diameter))
        else:
            prims.extend(S.polyline_duct(pl, section[0], section[1]))
    solid = S.Solid(sid, prims, material, discipline, level_id, layer)
    length = R.total_length(polylines)

    profile = ({"diameter_m": diameter} if diameter is not None
               else {"section_m": [section[0], section[1]]})
    op = model.oplog.record(
        "sweep_polyline", "creation", op_description,
        component_id=component_id, solid_id=sid,
        inputs=dict({"polylines": [[list(p) for p in pl] for pl in polylines],
                     "segment_count": sum(max(0, len(pl) - 1) for pl in polylines)},
                    **profile, **(op_inputs or {})),
        outputs=dict({"route_length_m": length}, **(op_outputs or {})),
        derived_from=list(derived_from),
        implementation=("solids.polyline_pipe (barridos circulares consecutivos)"
                        if diameter is not None else
                        "solids.polyline_duct (barridos rectangulares consecutivos)"),
    )
    params = dict(parameters)
    params.setdefault("route_length_m", length)
    params.update(profile)
    if flow_direction:
        params.setdefault("flow_direction", flow_direction)
    comp = Component(
        component_id=component_id, discipline=discipline, type=type, name=name,
        level_id=level_id, space_id=space_id, material=material, ifc_class=ifc_class,
        position=[round(v, 4) for v in polylines[0][0]] if polylines and polylines[0] else None,
        dimensions=dict(profile, length=length),
        parameters=params, requires_calculation=list(requires_calculation),
        provenance=provenance, tags=list(tags),
        validation_notes=list(validation_notes or []),
    )
    comp.operations.append(op)
    comp.geometry_reference = sid
    model.add_solid(solid)
    model.add_component(comp)
    return comp, length


def link(
    model, *, connection_id: str, discipline: str, type: str, origin: str, destination: str,
    medium: str, technology: Optional[str] = None, parameters: Optional[Dict[str, Any]] = None,
    geometry_reference: Optional[str] = None, length_m: Optional[float] = None,
    flow_direction: Optional[str] = None, requires_calculation: Sequence[str] = (),
    provenance: str = "derived",
) -> Connection:
    return model.add_connection(Connection(
        connection_id=connection_id, discipline=discipline, type=type,
        origin=origin, destination=destination, medium=medium, technology=technology,
        parameters=dict(parameters or {}), geometry_reference=geometry_reference,
        length_m=length_m, flow_direction=flow_direction,
        requires_calculation=list(requires_calculation), provenance=provenance,
    ))

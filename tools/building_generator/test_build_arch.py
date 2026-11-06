"""Comprobacion de arquitectura + estructura antes de anadir instalaciones."""

import sys
from collections import Counter

import params as P
import discipline_architecture as A
import discipline_structure as T
from catalog import BuildingModel
from oplog import OperationLog

log = OperationLog()
model = BuildingModel(log)
T.build(model)
A.build(model)

print("=" * 80)
print("RESUMEN")
print("=" * 80)
for k, v in model.summary().items():
    print("  %-16s %s" % (k, v))

print()
print("POR TIPO")
for k, v in model.counts_by_type().items():
    print("  %-44s %d" % (k, v))

print()
print("=" * 80)
print("COMPROBACIONES")
print("=" * 80)
fails = []


def check(name, cond, detail=""):
    print("%-62s %s %s" % (name, "OK" if cond else "FALLO", detail))
    if not cond:
        fails.append(name)


# identificadores unicos
ids = list(model.components) + list(model.solids)
check("identificadores de componente unicos", len(set(model.components)) == len(model.components))
check("identificadores de solido unicos", len(set(model.solids)) == len(model.solids))

# conteos estructurales esperados
ncol = len(P.GRID_X) * len(P.GRID_Y)
check("columnas = 20 por nivel x 3", len(model.by_type("column")) == ncol * 3,
      "(%d)" % len(model.by_type("column")))
check("zapatas = 20", len(model.by_type("footing")) == ncol, "(%d)" % len(model.by_type("footing")))
nbx = len(P.GRID_Y) * (len(P.GRID_X) - 1)
nby = len(P.GRID_X) * (len(P.GRID_Y) - 1)
check("vigas = (16+15) x 3 = 93", len(model.by_type("beam")) == (nbx + nby) * 3,
      "(%d)" % len(model.by_type("beam")))
check("losas de entrepiso + cubierta = 3",
      len(model.by_type("floor_slab")) + len(model.by_type("roof_slab")) == 3)
check("tramos de escalera = 6", len(model.by_type("stair_flight")) == 6)

# areas de espacios: la suma de recintos + circulacion + nucleo debe aproximar
# el area util interior del nivel
for level in P.LEVELS:
    lid = level["level_id"]
    sp = model.spaces_of_level(lid)
    total = sum(s.area_m2 for s in sp)
    gross = P.REQ_AREA_PER_LEVEL
    print("  %s: %2d espacios, area util %.2f m2 de %.2f m2 brutos (%.1f%%)"
          % (lid, len(sp), total, gross, 100.0 * total / gross))
    check("  area util del %s dentro de un rango plausible" % lid, 0.80 <= total / gross <= 0.97)

# geometria: volumen total y colisiones basicas
print()
vol_by_disc = Counter()
for s in model.solids.values():
    try:
        vol_by_disc[s.discipline] += s.volume()
    except Exception as exc:
        fails.append("volumen de %s: %s" % (s.solid_id, exc))
for k, v in sorted(vol_by_disc.items()):
    print("  volumen %-16s %10.2f m3" % (k, v))

# los espacios son volumenes de referencia, no materia
concrete = sum(s.volume() for s in model.solids.values()
               if s.material == "concreto_estructural")
print("  volumen de concreto estructural: %.2f m3" % concrete)
check("volumen de concreto en rango plausible (200-900 m3)", 200 <= concrete <= 900,
      "(%.1f)" % concrete)

# aperturas
doors = model.by_type("door")
windows = model.by_type("window")
print()
print("  puertas: %d   ventanas: %d" % (len(doors), len(windows)))
check("cada recinto del programa tiene puerta",
      len(doors) >= sum(len(v) for v in P.SPACE_PROGRAM.values()))
check("hay ventanas en fachada", len(windows) > 60)

# toda apertura esta alojada en un muro existente
missing = []
for d in doors + windows:
    for rel in d.relationships:
        if rel["relation"] == "hosted_in" and rel["target"] not in model.components:
            missing.append((d.component_id, rel["target"]))
check("toda apertura referencia un muro existente", not missing, str(missing[:3]))

# relaciones apuntan a componentes existentes
bad = []
for c in model.components.values():
    for rel in c.relationships:
        if rel["target"] not in model.components:
            bad.append((c.component_id, rel["relation"], rel["target"]))
check("todas las relaciones referencian componentes existentes", not bad, str(bad[:3]))

# conexiones
bad_cnx = []
for cx in model.connections.values():
    for end in (cx.origin, cx.destination):
        if end not in model.components:
            bad_cnx.append((cx.connection_id, end))
check("todas las conexiones referencian componentes existentes", not bad_cnx, str(bad_cnx[:3]))

# procedimientos
print()
print("  operaciones registradas: %d" % len(log))
for k, v in log.counts_by_category().items():
    print("    %-14s %d" % (k, v))
comp_without_op = [c.component_id for c in model.components.values()
                   if not c.operations and c.type != "beam_column_joint"]
check("los componentes geometricos tienen procedimiento registrado",
      len(comp_without_op) == 0, str(comp_without_op[:4]))

# honestidad de datos
nulls = sum(1 for c in model.components.values()
            for v in c.parameters.values() if v is None)
with_pending = sum(1 for c in model.components.values() if c.requires_calculation)
print()
print("  parametros nulos conservados: %d" % nulls)
print("  componentes con parametros pendientes declarados: %d" % with_pending)
check("ningun componente se declara revisado",
      all(c.professional_review == "not_reviewed" for c in model.components.values()))

print()
if fails:
    print("FALLOS: %d" % len(fails))
    for f in fails:
        print("  - %s" % f)
    sys.exit(1)
print("ARQUITECTURA Y ESTRUCTURA CORRECTAS")

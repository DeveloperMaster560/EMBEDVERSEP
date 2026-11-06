"""Pruebas del kernel geometrico contra valores calculables a mano.

No valida ingenieria. Valida que la geometria generada, sus secciones y sus
proyecciones son numericamente correctas, que es la condicion para que los
planos derivados del modelo sean fiables.
"""

import math
import sys

import params as P
import solids as S


FAILS = []


def check(name, got, expected, tol=1e-6):
    ok = abs(got - expected) <= tol
    print("%-58s %-14s esperado %-14s %s" % (
        name, round(got, 6), round(expected, 6), "OK" if ok else "FALLO"))
    if not ok:
        FAILS.append(name)


def check_true(name, cond):
    print("%-58s %s" % (name, "OK" if cond else "FALLO"))
    if not cond:
        FAILS.append(name)


print("=" * 90)
print("1. PRISMA: volumen, seccion, alzado, corte")
print("=" * 90)

col = S.Solid(
    solid_id="T-COL",
    primitives=[S.box_prism(0, 0, 0.4, 0.4, 0.0, 3.6)],
    material="concreto_estructural",
    discipline="structure",
)
check("volumen columna 0.4x0.4x3.6", col.volume(), 0.4 * 0.4 * 3.6)

cut = col.plan_cut(1.5)
check("area seccion horizontal a z=1.5", sum(g.area for g in cut), 0.16)
check_true("sin seccion por encima del solido", col.plan_cut(4.0) == [])

elev = col.elevation("x")
check("area alzado (0.4 x 3.6)", sum(g.area for g in elev), 0.4 * 3.6)

vc = col.vertical_cut("x", 0.2)
check("area corte vertical en x=0.2 (0.4 x 3.6)", sum(g.area for g in vc), 0.4 * 3.6)
check_true("corte vertical fuera del solido vacio", col.vertical_cut("x", 1.0) == [])

print()
print("=" * 90)
print("2. PRISMA CON AGUJERO: losa con vacio de escalera")
print("=" * 90)

slab = S.Solid(
    solid_id="T-SLAB",
    primitives=[S.Prism(
        outer=S.rect_points(0, 0, 24, 18),
        holes=[S.rect_points(9, 6, 15, 12)],
        z0=3.48, z1=3.60,
    )],
    material="concreto_estructural",
    discipline="structure",
)
area_neta = 24 * 18 - 6 * 6
check("volumen losa con vacio 6x6", slab.volume(), area_neta * 0.12, tol=1e-4)
check("area seccion losa a z=3.54", sum(g.area for g in slab.plan_cut(3.54)), area_neta)
check_true("el vacio existe en la seccion", len(slab.plan_cut(3.54)[0].interiors) == 1)

print()
print("=" * 90)
print("3. BARRIDO CIRCULAR: tuberias")
print("=" * 90)

d = 0.1016
tube_h = S.Solid(
    solid_id="T-PIPE-H",
    primitives=[S.pipe((2.0, 5.0, 2.95), (8.0, 5.0, 2.95), d)],
    material="pvc_sanitario",
    discipline="hydrosanitary",
)
# volumen de un prisma de 16 lados inscrito en el circulo de radio r
r = d / 2.0
area_poly = 0.5 * S.CIRCLE_SEGMENTS * r * r * math.sin(2 * math.pi / S.CIRCLE_SEGMENTS)
check("volumen tuberia horizontal L=6.0", tube_h.volume(), area_poly * 6.0, tol=1e-6)

# corte en planta por el eje: ancho = diametro completo
cut_axis = tube_h.plan_cut(2.95)
check("ancho de seccion en planta por el eje", sum(g.area for g in cut_axis) / 6.0, d, tol=2e-3)
check_true("sin seccion por encima de la tuberia", tube_h.plan_cut(2.95 + r + 0.01) == [])

tube_v = S.Solid(
    solid_id="T-PIPE-V",
    primitives=[S.pipe((1.0, 1.0, 0.0), (1.0, 1.0, 10.8), d)],
    material="pvc_sanitario",
    discipline="hydrosanitary",
)
check("volumen montante vertical L=10.8", tube_v.volume(), area_poly * 10.8, tol=1e-6)
check("area seccion montante en planta", sum(g.area for g in tube_v.plan_cut(5.0)), area_poly, tol=1e-9)

print()
print("=" * 90)
print("4. BARRIDO RECTANGULAR: ductos y bandejas")
print("=" * 90)

duct = S.Solid(
    solid_id="T-DUCT",
    primitives=[S.duct((0.0, 9.0, 2.95), (12.0, 9.0, 2.95), 0.50, 0.30)],
    material="acero_galvanizado",
    discipline="hvac",
)
check("volumen ducto 0.50x0.30 L=12", duct.volume(), 0.50 * 0.30 * 12.0)
check("area en planta del ducto", sum(g.area for g in duct.plan_cut(2.95)), 0.50 * 12.0, tol=1e-6)
check("area alzado del ducto (corte en y)", sum(g.area for g in duct.elevation("x")), 0.30 * 12.0, tol=1e-6)

print()
print("=" * 90)
print("5. REVOLUCION: tanque")
print("=" * 90)

tank = S.Solid(
    solid_id="T-TANK",
    primitives=[S.Revolve(profile=[(1.0, 0.0), (1.0, 2.0)], center=(5.0, 5.0))],
    material="pvc",
    discipline="hydrosanitary",
)
check("volumen cilindro revolucionado r=1 h=2", tank.volume(),
      0.5 * S.CIRCLE_SEGMENTS * 1.0 * math.sin(2 * math.pi / S.CIRCLE_SEGMENTS) * 2.0, tol=1e-6)
check("radio de seccion a media altura", math.sqrt(sum(g.area for g in tank.plan_cut(1.0)) / math.pi), 0.993, tol=0.01)

print()
print("=" * 90)
print("6. COHERENCIA CON params.py")
print("=" * 90)

check("altura libre = entre niveles - canto", P.REQ_FLOOR_TO_FLOOR - P.HYP_STRUCTURAL_DEPTH, P.REQ_CLEAR_HEIGHT)
check("suma de contrahuellas = altura entre niveles",
      P.HYP_STAIR_RISER * P.HYP_STAIR_RISERS_PER_FLIGHT * P.HYP_STAIR_FLIGHTS_PER_LEVEL,
      P.REQ_FLOOR_TO_FLOOR)
check("nucleo centrado en X", (P.CORE_X0 + P.CORE_X1) / 2.0, P.REQ_LENGTH_X / 2.0)
check("nucleo centrado en Y", (P.CORE_Y0 + P.CORE_Y1) / 2.0, P.REQ_WIDTH_Y / 2.0)
check("cota de cubierta", P.ROOF_LEVEL["elevation"], 10.80)
check("area por nivel declarada", P.REQ_LENGTH_X * P.REQ_WIDTH_Y, P.REQ_AREA_PER_LEVEL)

print()
print("=" * 90)
print("7. ARISTAS PARA ISOMETRICO")
print("=" * 90)
check("aristas de un prisma rectangular", len(col.iso_edges()), 12)
check_true("aristas de barrido circular no vacias", len(tube_h.iso_edges()) > 0)

print()
print("=" * 90)
if FAILS:
    print("FALLOS: %d" % len(FAILS))
    for f in FAILS:
        print("  - %s" % f)
    sys.exit(1)
print("TODAS LAS COMPROBACIONES DEL KERNEL CORRECTAS")

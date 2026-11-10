"""Pruebas de la orientacion con que se exporta glTF.

El modelo se construye con Z hacia arriba, que es la convencion de ingenieria
y la que usan IFC y STEP. glTF 2.0 obliga a +Y arriba. Durante un tiempo el
GLB se escribio sin convertir, y el resultado era un archivo valido que se
abria TUMBADO en cualquier visor que respetara la norma: en el Viaducto de la
Novena los pilonos salian horizontales y los tirantes se abanicaban en plano.

Habia cuatro sitios exportando GLB por su cuenta. Arreglar uno dejaba los
otros tres torcidos, asi que aqui se comprueban las dos cosas: que la
conversion es correcta, y que nadie vuelve a exportar saltandosela.
"""

import os
import re
import unittest

import numpy as np
import trimesh

import export_model as XM

AQUI = os.path.dirname(os.path.abspath(__file__))


class TestConversionAYArriba(unittest.TestCase):
    def _escena_con_torre(self):
        """Una 'torre': estrecha en planta y alta en Z, como un pilono."""
        torre = trimesh.creation.box(extents=(2.0, 3.0, 100.0))
        escena = trimesh.Scene()
        escena.add_geometry(torre, node_name="torre")
        return escena

    def test_lo_alto_pasa_de_z_a_y(self):
        datos = XM.gltf_bytes(self._escena_con_torre())
        reabierto = trimesh.load(
            trimesh.util.wrap_as_stream(datos), file_type="glb", force="scene")
        extension = reabierto.bounds[1] - reabierto.bounds[0]
        # Y es ahora el eje largo: la torre esta de pie.
        self.assertAlmostEqual(float(extension[1]), 100.0, places=4)
        self.assertAlmostEqual(float(extension[0]), 2.0, places=4)
        self.assertAlmostEqual(float(extension[2]), 3.0, places=4)

    def test_no_deforma_ni_refleja(self):
        """Rotar no debe cambiar volumenes ni poner el modelo del reves."""
        escena = self._escena_con_torre()
        antes = float(escena.bounds[1][2] - escena.bounds[0][2])
        datos = XM.gltf_bytes(escena)
        reabierto = trimesh.load(
            trimesh.util.wrap_as_stream(datos), file_type="glb", force="scene")
        despues = float(reabierto.bounds[1][1] - reabierto.bounds[0][1])
        self.assertAlmostEqual(antes, despues, places=6)
        malla = trimesh.util.concatenate(list(reabierto.geometry.values()))
        # Un volumen negativo significaria que la malla quedo del reves.
        self.assertGreater(malla.volume, 0.0)

    def test_no_altera_la_escena_que_recibe(self):
        """Exportar no debe dejar rotada la escena del que llama.

        Importa porque la misma escena se usa despues para IFC y STEP, que
        mantienen Z arriba.
        """
        escena = self._escena_con_torre()
        antes = escena.bounds.copy()
        XM.gltf_bytes(escena)
        np.testing.assert_allclose(escena.bounds, antes)


class TestNadieSeSaltaLaConversion(unittest.TestCase):
    """Guarda contra la reaparicion del fallo.

    Si alguien anade `scene.export(file_type="glb")` en cualquier otro sitio,
    ese modelo saldra torcido y nadie se dara cuenta hasta verlo en pantalla.
    """

    def test_solo_gltf_bytes_exporta_glb(self):
        patron = re.compile(r'export\(\s*file_type\s*=\s*["\']glb["\']')
        infractores = []
        for nombre in sorted(os.listdir(AQUI)):
            if not nombre.endswith(".py") or nombre == "test_gltf_orientation.py":
                continue
            with open(os.path.join(AQUI, nombre), encoding="utf-8") as fh:
                texto = fh.read()
            for numero, linea in enumerate(texto.splitlines(), 1):
                if not patron.search(linea):
                    continue
                # La unica exportacion legitima es la de dentro de gltf_bytes.
                if nombre == "export_model.py" and "rotated.export" in linea:
                    continue
                infractores.append("%s:%d: %s" % (nombre, numero, linea.strip()))
        self.assertEqual(
            infractores, [],
            "Exportan glTF sin convertir a Y arriba; usa export_model.gltf_bytes:\n"
            + "\n".join(infractores))


if __name__ == "__main__":
    unittest.main()

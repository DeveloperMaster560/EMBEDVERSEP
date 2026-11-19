"""La exportacion GLB rapida (girar cada malla) da lo mismo que girar la escena."""
import io
import math
import unittest

import numpy as np
import trimesh

import export_model as XM


class TestGiroGlb(unittest.TestCase):
    def _escena(self):
        s = trimesh.Scene()
        a = trimesh.creation.box((1, 2, 3)); a.apply_translation((5, 0, 1.5))
        b = trimesh.creation.cylinder(0.2, 4); b.apply_translation((0, 3, 2))
        s.add_geometry(a, node_name="structure__N1__A"); s.add_geometry(b, node_name="electrical__N1__B")
        return s

    def test_igual_que_girar_la_escena(self):
        s = self._escena()
        self.assertTrue(XM._nodos_sin_transformacion(s))
        nuevo = trimesh.load(io.BytesIO(XM.gltf_bytes(s)), file_type="glb")
        ref = s.copy(); ref.apply_transform(trimesh.transformations.rotation_matrix(-math.pi / 2, (1, 0, 0)))
        viejo = trimesh.load(io.BytesIO(ref.export(file_type="glb")), file_type="glb")
        self.assertTrue(np.allclose(nuevo.bounds, viejo.bounds))
        self.assertEqual(sorted(nuevo.graph.nodes_geometry), sorted(viejo.graph.nodes_geometry))
        # Z arriba del modelo -> Y arriba de glTF: la caja de 3 m de alto mide 3 m en Y.
        self.assertAlmostEqual(nuevo.bounds[1][1] - nuevo.bounds[0][1], 4.0, places=6)

    def test_no_modifica_la_escena_original(self):
        s = self._escena(); antes = s.bounds.copy()
        XM.gltf_bytes(s)
        self.assertTrue(np.allclose(s.bounds, antes))

    def test_con_transformaciones_usa_el_camino_general(self):
        s = self._escena()
        s.graph.update(frame_to="structure__N1__A", matrix=trimesh.transformations.translation_matrix((1, 0, 0)))
        self.assertFalse(XM._nodos_sin_transformacion(s))
        self.assertTrue(len(XM.gltf_bytes(s)) > 0)


if __name__ == "__main__":
    unittest.main()

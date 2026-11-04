import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import {
  AmbientLight,
  AxesHelper,
  Box3,
  Color,
  DirectionalLight,
  GridHelper,
  Line,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { Object3D } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { createBridgeGeometry } from './geometry';
import type { BridgeObject, BridgeSceneDocument, BridgeTool } from './types';

export interface BridgeViewportHandle {
  focusSelection: () => void;
  frameAll: () => void;
  setView: (view: 'perspective' | 'top' | 'front' | 'side') => void;
}

function disposeObject(object: Object3D) {
  object.traverse((child) => {
    if (!(child instanceof Mesh || child instanceof Line || child instanceof LineSegments)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => material.dispose());
  });
}

interface BridgeViewportProps {
  document: BridgeSceneDocument;
  selectedId: string | null;
  tool: BridgeTool;
  gridVisible: boolean;
  gridSize: number;
  wireframe: boolean;
  onSelect: (id: string | null) => void;
  onTransform: (id: string, values: Pick<BridgeObject, 'position' | 'rotation' | 'scale'>) => void;
}

export const BridgeViewport = forwardRef<BridgeViewportHandle, BridgeViewportProps>(({
  document: sceneDocument,
  selectedId,
  tool,
  gridVisible,
  gridSize,
  wireframe,
  onSelect,
  onTransform,
}, ref) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const cameraRef = useRef<PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const transformRef = useRef<TransformControls | null>(null);
  const meshesRef = useRef(new Map<string, Mesh>());
  const selectedRef = useRef(selectedId);
  const onSelectRef = useRef(onSelect);
  const onTransformRef = useRef(onTransform);

  selectedRef.current = selectedId;
  onSelectRef.current = onSelect;
  onTransformRef.current = onTransform;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const objectMeshes = meshesRef.current;
    const scene = new Scene();
    scene.background = new Color('#111821');
    const camera = new PerspectiveCamera(45, 1, 0.05, 100000);
    camera.position.set(45, 35, 55);
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'WebGL no está disponible en este navegador.';
      onSelectRef.current(null);
      host.dataset.error = message;
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setSize(Math.max(host.clientWidth, 1), Math.max(host.clientHeight, 1));
    renderer.shadowMap.enabled = true;
    renderer.setClearColor('#111821');
    renderer.domElement.className = 'bridge-canvas';
    renderer.domElement.tabIndex = 0;
    host.replaceChildren(renderer.domElement);

    scene.add(new AmbientLight('#d9e7f7', 1.15));
    const keyLight = new DirectionalLight('#fff2d6', 3.2);
    keyLight.position.set(-30, 60, 35);
    keyLight.castShadow = true;
    scene.add(keyLight);
    const fillLight = new DirectionalLight('#87b7ed', 1.25);
    fillLight.position.set(45, 30, -40);
    scene.add(fillLight);
    const grid = new GridHelper(200, 200, '#496075', '#273746');
    grid.name = 'bridge-grid';
    scene.add(grid);
    scene.add(new AxesHelper(4));

    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.08;
    orbit.target.set(0, 0, 0);
    const transform = new TransformControls(camera, renderer.domElement);
    scene.add(transform.getHelper());
    transform.addEventListener('dragging-changed', (event) => {
      orbit.enabled = !event.value;
      if (!event.value) {
        const selected = selectedRef.current;
        const mesh = selected ? meshesRef.current.get(selected) : undefined;
        if (mesh) {
          onTransformRef.current(mesh.userData.objectId as string, {
            position: [mesh.position.x, mesh.position.y, mesh.position.z],
            rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
            scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z],
          });
        }
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      const width = Math.max(host.clientWidth, 1);
      const height = Math.max(host.clientHeight, 1);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    });
    resizeObserver.observe(host);
    const raycaster = new Raycaster();
    const pointer = new Vector2();
    const handlePointer = (event: PointerEvent) => {
      if (transform.dragging) return;
      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.set(((event.clientX - bounds.left) / bounds.width) * 2 - 1, -((event.clientY - bounds.top) / bounds.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const objects = [...meshesRef.current.values()].filter((mesh) => mesh.visible && !mesh.userData.locked);
      const hit = raycaster.intersectObjects(objects, true)[0]?.object;
      onSelectRef.current(hit?.userData.objectId as string | undefined ?? null);
    };
    renderer.domElement.addEventListener('pointerdown', handlePointer);

    let animationFrame = 0;
    const draw = () => {
      orbit.update();
      renderer.render(scene, camera);
      animationFrame = window.requestAnimationFrame(draw);
    };
    draw();

    sceneRef.current = scene;
    cameraRef.current = camera;
    controlsRef.current = orbit;
    transformRef.current = transform;
    const previousError = host.dataset.error;
    if (previousError) delete host.dataset.error;

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener('pointerdown', handlePointer);
      transform.dispose();
      orbit.dispose();
      disposeObject(scene);
      renderer.dispose();
      scene.clear();
      objectMeshes.clear();
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      transformRef.current = null;
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    const transform = transformRef.current;
    if (!scene || !transform) return;
    const objects = sceneDocument.objects;
    const activeIds = new Set(objects.map(({ id }) => id));
    for (const [id, mesh] of meshesRef.current) {
      if (activeIds.has(id)) continue;
      scene.remove(mesh);
      disposeObject(mesh);
      meshesRef.current.delete(id);
    }
    for (const object of objects) {
      let mesh = meshesRef.current.get(object.id);
      if (!mesh || mesh.userData.kind !== object.kind || mesh.userData.dimensions?.join(',') !== object.dimensions.join(',')) {
        if (mesh) {
          scene.remove(mesh);
          disposeObject(mesh);
        }
        try {
          mesh = new Mesh(createBridgeGeometry(object), new MeshStandardMaterial({
            color: object.color,
            roughness: object.roughness,
            metalness: object.metalness,
          }));
        } catch (error) {
          const message = error instanceof Error ? error.message : `No se pudo crear ${object.name}.`;
          const host = hostRef.current;
          if (host) host.dataset.error = message;
          continue;
        }
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.objectId = object.id;
        mesh.userData.kind = object.kind;
        mesh.userData.dimensions = [...object.dimensions];
        meshesRef.current.set(object.id, mesh);
        scene.add(mesh);
      }
      mesh.name = object.name;
      mesh.position.set(...object.position);
      mesh.rotation.set(...object.rotation);
      mesh.scale.set(...object.scale);
      mesh.visible = object.visible;
      mesh.userData.locked = object.locked;
      const material = mesh.material as MeshStandardMaterial;
      material.color.set(object.color);
      material.roughness = object.roughness;
      material.metalness = object.metalness;
      material.emissive.set(object.id === selectedId ? '#1b3954' : '#000000');
      material.emissiveIntensity = object.id === selectedId ? 0.55 : 0;
      material.wireframe = wireframe;
    }
    const grid = scene.getObjectByName('bridge-grid');
    if (grid) {
      grid.visible = gridVisible;
      grid.scale.setScalar(gridSize);
    }
    const selected = selectedId ? meshesRef.current.get(selectedId) : undefined;
    if (selected && !selected.userData.locked) transform.attach(selected);
    else transform.detach();
    transform.setMode(tool === 'rotate' ? 'rotate' : tool === 'scale' ? 'scale' : 'translate');
    transform.enabled = tool !== 'select' && Boolean(selected && !selected.userData.locked);
  }, [sceneDocument.objects, gridVisible, gridSize, selectedId, tool, wireframe]);

  const frameAll = () => {
    const camera = cameraRef.current;
    const orbit = controlsRef.current;
    if (!camera || !orbit) return;
    const visible = [...meshesRef.current.values()].filter((mesh) => mesh.visible);
    if (!visible.length) {
      camera.position.set(45, 35, 55);
      orbit.target.set(0, 0, 0);
      return;
    }
    const bounds = visible.reduce((result, mesh) => result.union(new Box3().setFromObject(mesh)), new Box3());
    const center = bounds.getCenter(new Vector3());
    const size = bounds.getSize(new Vector3());
    const distance = Math.max(size.x, size.y, size.z, 1) * 1.5;
    orbit.target.copy(center);
    camera.position.set(center.x + distance, center.y + distance * 0.7, center.z + distance);
    camera.near = Math.max(distance / 10000, 0.01);
    camera.far = Math.max(distance * 100, 1000);
    camera.updateProjectionMatrix();
  };

  const focusSelection = () => {
    const selected = selectedRef.current ? meshesRef.current.get(selectedRef.current) : undefined;
    const camera = cameraRef.current;
    const orbit = controlsRef.current;
    if (!selected || !camera || !orbit) return;
    const center = selected.getWorldPosition(new Vector3());
    selected.geometry.computeBoundingBox();
    const distance = Math.max(...selected.scale.toArray()) * Math.max(...selected.geometry.boundingBox?.getSize(new Vector3()).toArray() ?? [3, 3, 3]) * 3;
    orbit.target.copy(center);
    camera.position.set(center.x + distance, center.y + distance * 0.7, center.z + distance);
  };

  const setView = (view: 'perspective' | 'top' | 'front' | 'side') => {
    const camera = cameraRef.current;
    const orbit = controlsRef.current;
    if (!camera || !orbit) return;
    const focus = orbit.target;
    const distance = Math.max(camera.position.distanceTo(focus), 10);
    if (view === 'top') camera.position.set(focus.x, focus.y + distance, focus.z);
    else if (view === 'front') camera.position.set(focus.x, focus.y, focus.z + distance);
    else if (view === 'side') camera.position.set(focus.x + distance, focus.y, focus.z);
    else camera.position.set(focus.x + distance * 0.65, focus.y + distance * 0.55, focus.z + distance * 0.75);
    camera.up.set(0, view === 'top' ? 0 : 1, view === 'top' ? -1 : 0);
    camera.lookAt(focus);
    camera.updateProjectionMatrix();
  };

  useImperativeHandle(ref, () => ({ focusSelection, frameAll, setView }), []);

  return <div ref={hostRef} className="bridge-viewport" aria-label="Viewport 3D editable" />;
});

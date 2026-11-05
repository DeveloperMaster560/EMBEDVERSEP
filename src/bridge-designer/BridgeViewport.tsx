import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import {
  AmbientLight,
  AxesHelper,
  Box3,
  Color,
  DirectionalLight,
  Group,
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
  selectedIds: string[];
  tool: BridgeTool;
  gridVisible: boolean;
  gridSize: number;
  snapEnabled: boolean;
  transformSpace: 'world' | 'local';
  boxSelectEnabled: boolean;
  wireframe: boolean;
  onSelect: (id: string | null, additive: boolean) => void;
  onSelectMany: (ids: string[], additive: boolean) => void;
  onTransform: (transforms: { id: string; values: Pick<BridgeObject, 'position' | 'rotation' | 'scale'> }[]) => void;
}

export const BridgeViewport = forwardRef<BridgeViewportHandle, BridgeViewportProps>(({
  document: sceneDocument,
  selectedIds,
  tool,
  gridVisible,
  gridSize,
  snapEnabled,
  transformSpace,
  boxSelectEnabled,
  wireframe,
  onSelect,
  onSelectMany,
  onTransform,
}, ref) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const selectionBoxRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const cameraRef = useRef<PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const transformRef = useRef<TransformControls | null>(null);
  const meshesRef = useRef(new Map<string, Mesh>());
  const pivotRef = useRef(new Group());
  const selectedRef = useRef(selectedIds);
  const boxSelectEnabledRef = useRef(boxSelectEnabled);
  const onSelectRef = useRef(onSelect);
  const onSelectManyRef = useRef(onSelectMany);
  const onTransformRef = useRef(onTransform);

  selectedRef.current = selectedIds;
  boxSelectEnabledRef.current = boxSelectEnabled;
  onSelectRef.current = onSelect;
  onSelectManyRef.current = onSelectMany;
  onTransformRef.current = onTransform;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const objectMeshes = meshesRef.current;
    const scene = new Scene();
    const pivot = pivotRef.current;
    scene.add(pivot);
    scene.background = new Color('#111821');
    const camera = new PerspectiveCamera(45, 1, 0.05, 100000);
    camera.position.set(45, 35, 55);
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'WebGL no está disponible en este navegador.';
      onSelectRef.current(null, false);
      host.dataset.error = message;
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    renderer.setSize(Math.max(host.clientWidth, 1), Math.max(host.clientHeight, 1));
    renderer.shadowMap.enabled = true;
    renderer.setClearColor('#111821');
    renderer.domElement.className = 'bridge-canvas';
    renderer.domElement.tabIndex = 0;
    host.prepend(renderer.domElement);

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
        for (const mesh of meshesRef.current.values()) {
          if (mesh.parent === pivot) scene.attach(mesh);
        }
        const transforms = selectedRef.current.flatMap((id) => {
          const mesh = meshesRef.current.get(id);
          return mesh ? [{
            id,
            values: {
              position: [mesh.position.x, mesh.position.y, mesh.position.z] as [number, number, number],
              rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z] as [number, number, number],
              scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z] as [number, number, number],
            },
          }] : [];
        });
        if (transforms.length) onTransformRef.current(transforms);
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
    const selectionBox = selectionBoxRef.current;
    let selectionStart: Vector2 | null = null;
    let additiveSelection = false;
    const selectAt = (clientX: number, clientY: number, additive: boolean) => {
      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.set(((clientX - bounds.left) / bounds.width) * 2 - 1, -((clientY - bounds.top) / bounds.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      const objects = [...meshesRef.current.values()].filter((mesh) => mesh.visible && !mesh.userData.locked);
      const hit = raycaster.intersectObjects(objects, true)[0]?.object;
      onSelectRef.current(hit?.userData.objectId as string | undefined ?? null, additive);
    };
    const handlePointer = (event: PointerEvent) => {
      if (transform.dragging || boxSelectEnabledRef.current) return;
      selectAt(event.clientX, event.clientY, event.shiftKey || event.ctrlKey || event.metaKey);
    };
    const handleBoxPointerDown = (event: PointerEvent) => {
      if (!boxSelectEnabledRef.current || event.button !== 0 || transform.dragging || !selectionBox) return;
      event.preventDefault();
      event.stopPropagation();
      selectionStart = new Vector2(event.clientX, event.clientY);
      additiveSelection = event.shiftKey || event.ctrlKey || event.metaKey;
      orbit.enabled = false;
      selectionBox.style.display = 'block';
      selectionBox.style.left = `${event.clientX - renderer.domElement.getBoundingClientRect().left}px`;
      selectionBox.style.top = `${event.clientY - renderer.domElement.getBoundingClientRect().top}px`;
      selectionBox.style.width = '0px';
      selectionBox.style.height = '0px';
      renderer.domElement.setPointerCapture(event.pointerId);
    };
    const handleBoxPointerMove = (event: PointerEvent) => {
      if (!selectionStart || !selectionBox) return;
      const bounds = renderer.domElement.getBoundingClientRect();
      const left = Math.min(selectionStart.x, event.clientX) - bounds.left;
      const top = Math.min(selectionStart.y, event.clientY) - bounds.top;
      selectionBox.style.left = `${left}px`;
      selectionBox.style.top = `${top}px`;
      selectionBox.style.width = `${Math.abs(event.clientX - selectionStart.x)}px`;
      selectionBox.style.height = `${Math.abs(event.clientY - selectionStart.y)}px`;
    };
    const handleBoxPointerUp = (event: PointerEvent) => {
      if (!selectionStart || !selectionBox) return;
      const start = selectionStart;
      const dragDistance = Math.hypot(event.clientX - start.x, event.clientY - start.y);
      selectionStart = null;
      selectionBox.style.display = 'none';
      orbit.enabled = true;
      if (dragDistance < 4) {
        selectAt(event.clientX, event.clientY, additiveSelection);
        return;
      }

      const bounds = renderer.domElement.getBoundingClientRect();
      const left = Math.min(start.x, event.clientX) - bounds.left;
      const right = Math.max(start.x, event.clientX) - bounds.left;
      const top = Math.min(start.y, event.clientY) - bounds.top;
      const bottom = Math.max(start.y, event.clientY) - bounds.top;
      const selected = [...meshesRef.current.values()].filter((mesh) => {
        if (!mesh.visible || mesh.userData.locked) return false;
        const box = new Box3().setFromObject(mesh);
        if (box.isEmpty()) return false;
        const projected = [
          new Vector3(box.min.x, box.min.y, box.min.z),
          new Vector3(box.min.x, box.min.y, box.max.z),
          new Vector3(box.min.x, box.max.y, box.min.z),
          new Vector3(box.min.x, box.max.y, box.max.z),
          new Vector3(box.max.x, box.min.y, box.min.z),
          new Vector3(box.max.x, box.min.y, box.max.z),
          new Vector3(box.max.x, box.max.y, box.min.z),
          new Vector3(box.max.x, box.max.y, box.max.z),
        ].map((point) => point.project(camera));
        const inFront = projected.filter((point) => point.z >= -1 && point.z <= 1);
        if (!inFront.length) return false;
        const xs = inFront.map((point) => (point.x + 1) * bounds.width / 2);
        const ys = inFront.map((point) => (1 - point.y) * bounds.height / 2);
        return Math.max(...xs) >= left && Math.min(...xs) <= right
          && Math.max(...ys) >= top && Math.min(...ys) <= bottom;
      }).map((mesh) => mesh.userData.objectId as string);
      onSelectManyRef.current(selected, additiveSelection);
    };
    renderer.domElement.addEventListener('pointerdown', handleBoxPointerDown, true);
    renderer.domElement.addEventListener('pointerdown', handlePointer);
    renderer.domElement.addEventListener('pointermove', handleBoxPointerMove);
    renderer.domElement.addEventListener('pointerup', handleBoxPointerUp);
    renderer.domElement.addEventListener('pointercancel', handleBoxPointerUp);

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
      renderer.domElement.removeEventListener('pointerdown', handleBoxPointerDown, true);
      renderer.domElement.removeEventListener('pointerdown', handlePointer);
      renderer.domElement.removeEventListener('pointermove', handleBoxPointerMove);
      renderer.domElement.removeEventListener('pointerup', handleBoxPointerUp);
      renderer.domElement.removeEventListener('pointercancel', handleBoxPointerUp);
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
    const pivot = pivotRef.current;
    transform.detach();
    for (const mesh of meshesRef.current.values()) {
      if (mesh.parent === pivot) scene.attach(mesh);
    }
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
            transparent: (object.opacity ?? 1) < 1,
            opacity: object.opacity ?? 1,
            depthWrite: (object.opacity ?? 1) >= 1,
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
      material.transparent = (object.opacity ?? 1) < 1;
      material.opacity = object.opacity ?? 1;
      material.depthWrite = (object.opacity ?? 1) >= 1;
      const isSelected = selectedIds.includes(object.id);
      material.emissive.set(isSelected ? '#1b3954' : '#000000');
      material.emissiveIntensity = isSelected ? 0.55 : 0;
      material.wireframe = wireframe;
    }
    const grid = scene.getObjectByName('bridge-grid');
    if (grid) {
      grid.visible = gridVisible;
      grid.scale.setScalar(gridSize);
    }
    const selectedMeshes = selectedIds
      .map((id) => meshesRef.current.get(id))
      .filter((mesh): mesh is Mesh => Boolean(mesh && !mesh.userData.locked && mesh.visible));
    if (selectedMeshes.length === 1) {
      transform.attach(selectedMeshes[0]);
    } else if (selectedMeshes.length > 1) {
      const bounds = selectedMeshes.reduce((result, mesh) => result.union(new Box3().setFromObject(mesh)), new Box3());
      bounds.getCenter(pivot.position);
      pivot.rotation.set(0, 0, 0);
      pivot.scale.set(1, 1, 1);
      pivot.updateMatrixWorld(true);
      selectedMeshes.forEach((mesh) => pivot.attach(mesh));
      transform.attach(pivot);
    }
    transform.setMode(tool === 'rotate' ? 'rotate' : tool === 'scale' ? 'scale' : 'translate');
    transform.setSpace(transformSpace);
    transform.setTranslationSnap(snapEnabled ? gridSize : null);
    transform.setRotationSnap(snapEnabled ? Math.PI / 12 : null);
    transform.setScaleSnap(snapEnabled ? 0.1 : null);
    transform.enabled = tool !== 'select' && selectedMeshes.length > 0;
  }, [sceneDocument.objects, gridVisible, gridSize, selectedIds, snapEnabled, tool, transformSpace, wireframe]);

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
    const camera = cameraRef.current;
    const orbit = controlsRef.current;
    const selected = selectedRef.current
      .map((id) => meshesRef.current.get(id))
      .filter((mesh): mesh is Mesh => Boolean(mesh && mesh.visible));
    if (!selected.length || !camera || !orbit) return;
    const bounds = selected.reduce((result, mesh) => result.union(new Box3().setFromObject(mesh)), new Box3());
    const center = bounds.getCenter(new Vector3());
    const size = bounds.getSize(new Vector3());
    const distance = Math.max(size.x, size.y, size.z, 1) * 2.5;
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

  return <div ref={hostRef} className="bridge-viewport" aria-label="Viewport 3D editable"><div ref={selectionBoxRef} className="bridge-selection-box" /></div>;
});

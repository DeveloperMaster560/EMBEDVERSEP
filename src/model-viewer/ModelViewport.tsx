/**
 * Visor tridimensional del modelo generado. Sirve a edificios y a puentes.
 *
 * El GLB llega con un nodo por componente, nombrado
 * `disciplina__zona__component_id`. El visor reconstruye esa jerarquía para
 * poder encender y apagar disciplinas, aislar zonas, cortar el volumen y
 * separar los conjuntos sin volver a generar el modelo.
 *
 * El aspecto se consigue con iluminación de estudio por imagen (IBL), mapeo
 * tonal ACES y materiales físicos por material declarado. No hay texturas ni
 * mobiliario: lo que se ve es la geometría real del modelo.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import {
  ACESFilmicToneMapping,
  Box3,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PMREMGenerator,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Raycaster,
  Scene,
  ShadowMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { Material, Object3D } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import { DISCIPLINE_COLOR, presetFor } from './materials';
import { explodeOffset, LEVELLESS, parseNodeName } from './scene-graph';
import type { ModelDomain } from './scene-graph';
import type { GeneratedComponentSummary } from './contracts';

export type ColorMode = 'material' | 'discipline';
export type ViewPreset = 'iso' | 'top' | 'front' | 'side';

export interface SectionState {
  enabled: boolean;
  /** Fracción 0..1 del lado; 1 = sin recortar. */
  x: number;
  y: number;
  z: number;
}

export interface ModelViewportProps {
  domain: ModelDomain;
  glbBase64: string | null;
  components: GeneratedComponentSummary[];
  visibleDisciplines: Set<string>;
  visibleLevels: Set<string>;
  explode: number;
  section: SectionState;
  colorMode: ColorMode;
  selectedId: string | null;
  onSelect: (componentId: string | null) => void;
  onLoaded: (info: { meshes: number; triangles: number; bounds: [number, number, number] }) => void;
  onError: (message: string) => void;
}

/** Geometría de un componente, lista para convertirse en objeto editable. */
export interface ExtractedComponent {
  componentId: string;
  discipline: string;
  level: string;
  /** Coordenadas relativas al centro de la pieza, para que gire sobre sí misma. */
  positions: number[];
  indices: number[] | undefined;
  center: [number, number, number];
  triangles: number;
}

export interface ModelViewportHandle {
  frameAll: () => void;
  setView: (preset: ViewPreset) => void;
  focus: (componentId: string) => void;
  /** Geometría de lo que está visible ahora mismo, en coordenadas de mundo. */
  extractVisible: () => ExtractedComponent[];
}

interface NodeEntry {
  object: Object3D;
  discipline: string;
  level: string;
  componentId: string;
}

function base64ToArrayBuffer(data: string): ArrayBuffer {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function disposeTree(root: Object3D): void {
  root.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    child.geometry.dispose();
    const materials: Material[] = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => material.dispose());
  });
}

export const ModelViewport = forwardRef<ModelViewportHandle, ModelViewportProps>(
  function ModelViewport(props, ref) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const sceneRef = useRef<Scene | null>(null);
    const cameraRef = useRef<PerspectiveCamera | null>(null);
    const rendererRef = useRef<WebGLRenderer | null>(null);
    const controlsRef = useRef<OrbitControls | null>(null);
    const modelRef = useRef<Group | null>(null);
    const nodesRef = useRef<NodeEntry[]>([]);
    const boundsRef = useRef<Box3 | null>(null);
    const planesRef = useRef<Plane[]>([]);
    const keyLightRef = useRef<DirectionalLight | null>(null);
    const groundRef = useRef<Mesh | null>(null);
    const selectedRef = useRef<string | null>(null);
    const propsRef = useRef(props);
    propsRef.current = props;

    // --- montaje del renderizador -----------------------------------------
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return undefined;

      let renderer: WebGLRenderer;
      try {
        renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
      } catch {
        propsRef.current.onError('Este navegador no pudo iniciar WebGL. El visor 3D no está disponible.');
        return undefined;
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(container.clientWidth, container.clientHeight);
      renderer.outputColorSpace = SRGBColorSpace;
      renderer.toneMapping = ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = PCFSoftShadowMap;
      renderer.localClippingEnabled = true;
      container.appendChild(renderer.domElement);
      rendererRef.current = renderer;

      const scene = new Scene();
      scene.background = new Color('#0e1116');
      sceneRef.current = scene;

      // Iluminación por imagen: es lo que da profundidad a los metales y al vidrio.
      const pmrem = new PMREMGenerator(renderer);
      scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

      scene.add(new HemisphereLight('#dceaff', '#2a2b30', 1.0));
      const key = new DirectionalLight('#fff4e2', 2.6);
      key.position.set(28, 44, 22);
      key.castShadow = true;
      key.shadow.mapSize.set(2048, 2048);
      key.shadow.bias = -0.0008;
      key.shadow.camera.near = 1;
      key.shadow.camera.far = 220;
      key.shadow.camera.left = -70;
      key.shadow.camera.right = 70;
      key.shadow.camera.top = 70;
      key.shadow.camera.bottom = -70;
      scene.add(key);
      keyLightRef.current = key;

      const fill = new DirectionalLight('#9dc2ff', 0.7);
      fill.position.set(-32, 22, -26);
      scene.add(fill);

      const ground = new Mesh(
        new PlaneGeometry(2000, 2000),
        new ShadowMaterial({ opacity: 0.32 }),
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = -0.02;
      ground.receiveShadow = true;
      scene.add(ground);
      groundRef.current = ground;

      const camera = new PerspectiveCamera(42, container.clientWidth / container.clientHeight, 0.1, 6000);
      camera.position.set(44, 34, 46);
      cameraRef.current = camera;

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.maxPolarAngle = Math.PI * 0.495;
      controls.target.set(0, 5, 0);
      controlsRef.current = controls;

      planesRef.current = [
        new Plane(new Vector3(-1, 0, 0), Number.POSITIVE_INFINITY),
        new Plane(new Vector3(0, -1, 0), Number.POSITIVE_INFINITY),
        new Plane(new Vector3(0, 0, -1), Number.POSITIVE_INFINITY),
      ];

      let frame = 0;
      const animate = () => {
        frame = requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
      };
      animate();

      const observer = new ResizeObserver(() => {
        const w = container.clientWidth;
        const h = container.clientHeight;
        if (w === 0 || h === 0) return;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      });
      observer.observe(container);

      const raycaster = new Raycaster();
      const pointer = new Vector2();
      const onClick = (event: MouseEvent) => {
        const model = modelRef.current;
        if (!model) return;
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObject(model, true);
        const visible = hits.find((hit) => hit.object.visible && hit.object.parent?.visible);
        if (!visible) {
          propsRef.current.onSelect(null);
          return;
        }
        let node: Object3D | null = visible.object;
        while (node && !node.userData.componentId) node = node.parent;
        propsRef.current.onSelect((node?.userData.componentId as string) ?? null);
      };
      renderer.domElement.addEventListener('click', onClick);

      return () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        renderer.domElement.removeEventListener('click', onClick);
        controls.dispose();
        pmrem.dispose();
        if (modelRef.current) disposeTree(modelRef.current);
        renderer.dispose();
        container.removeChild(renderer.domElement);
        rendererRef.current = null;
        sceneRef.current = null;
      };
      // El visor se monta una sola vez; el resto se actualiza por efectos.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useImperativeHandle(ref, () => ({
      frameAll: () => frameBounds(),
      setView: (preset) => applyView(preset),
      focus: (componentId) => focusComponent(componentId),
      extractVisible: () => extractVisible(),
    }));

    /**
     * Geometría de los componentes visibles, en su posición real.
     *
     * El despiece se anula durante la extracción: separar las plantas es una
     * ayuda visual, no una posición del modelo, y enviarla al editor movería
     * las piezas de sitio. Se restaura al terminar.
     */
    function extractVisible(): ExtractedComponent[] {
      const model = modelRef.current;
      if (!model) return [];
      const { visibleDisciplines, visibleLevels } = propsRef.current;

      const restore: { group: Object3D; y: number }[] = [];
      model.children.forEach((disciplineGroup) => {
        disciplineGroup.children.forEach((levelGroup) => {
          if (levelGroup.position.y === 0) return;
          restore.push({ group: levelGroup, y: levelGroup.position.y });
          levelGroup.position.y = 0;
        });
      });
      model.updateWorldMatrix(true, true);

      const out: ExtractedComponent[] = [];
      try {
        for (const entry of nodesRef.current) {
          if (!visibleDisciplines.has(entry.discipline)) continue;
          if (visibleLevels.size > 0 && !visibleLevels.has(entry.level)) continue;
          const mesh = entry.object as Mesh;
          const geometry = mesh.geometry.clone();
          geometry.applyMatrix4(mesh.matrixWorld);
          geometry.computeBoundingBox();
          const box = geometry.boundingBox;
          if (!box) {
            geometry.dispose();
            continue;
          }
          const center = box.getCenter(new Vector3());
          geometry.translate(-center.x, -center.y, -center.z);

          const position = geometry.getAttribute('position');
          const positions: number[] = new Array(position.count * 3);
          for (let i = 0; i < position.count; i += 1) {
            // Se redondea a 0.1 mm: más precisión solo engorda el guardado.
            positions[i * 3] = Math.round(position.getX(i) * 1e4) / 1e4;
            positions[i * 3 + 1] = Math.round(position.getY(i) * 1e4) / 1e4;
            positions[i * 3 + 2] = Math.round(position.getZ(i) * 1e4) / 1e4;
          }
          const indexAttribute = geometry.getIndex();
          const indices = indexAttribute ? Array.from(indexAttribute.array) : undefined;
          geometry.dispose();

          out.push({
            componentId: entry.componentId,
            discipline: entry.discipline,
            level: entry.level,
            positions,
            indices,
            center: [center.x, center.y, center.z],
            triangles: Math.round((indices ? indices.length : position.count) / 3),
          });
        }
      } finally {
        restore.forEach(({ group, y }) => {
          group.position.y = y;
        });
        model.updateWorldMatrix(true, true);
      }
      return out;
    }

    /**
     * Ajusta la sombra y el suelo al tamaño real del modelo.
     * Un puente de 240 m no cabe en el frustum pensado para un edificio de 24.
     */
    function fitStage(bounds: Box3): void {
      const key = keyLightRef.current;
      const ground = groundRef.current;
      const size = bounds.getSize(new Vector3());
      const center = bounds.getCenter(new Vector3());
      const reach = Math.max(size.x, size.y, size.z) * 0.8 + 10;

      if (ground) ground.position.y = bounds.min.y - 0.02;
      if (!key) return;
      key.position.set(center.x + reach * 0.7, bounds.max.y + reach, center.z + reach * 0.55);
      key.target.position.copy(center);
      key.target.updateMatrixWorld();
      if (!key.target.parent) key.add(key.target);
      const camera = key.shadow.camera;
      camera.left = -reach;
      camera.right = reach;
      camera.top = reach;
      camera.bottom = -reach;
      camera.near = 1;
      camera.far = reach * 4;
      camera.updateProjectionMatrix();
    }

    function frameBounds(): void {
      const bounds = boundsRef.current;
      const camera = cameraRef.current;
      const controls = controlsRef.current;
      if (!bounds || !camera || !controls) return;
      const size = bounds.getSize(new Vector3());
      const center = bounds.getCenter(new Vector3());
      const radius = Math.max(size.x, size.y, size.z) * 0.78;
      const distance = radius / Math.tan((camera.fov * Math.PI) / 360);
      camera.position.set(center.x + distance * 0.72, center.y + distance * 0.55, center.z + distance * 0.72);
      controls.target.copy(center);
      controls.update();
    }

    function applyView(preset: ViewPreset): void {
      const bounds = boundsRef.current;
      const camera = cameraRef.current;
      const controls = controlsRef.current;
      if (!bounds || !camera || !controls) return;
      const size = bounds.getSize(new Vector3());
      const center = bounds.getCenter(new Vector3());
      const d = Math.max(size.x, size.y, size.z) * 1.6;
      const positions: Record<ViewPreset, [number, number, number]> = {
        iso: [center.x + d * 0.7, center.y + d * 0.55, center.z + d * 0.7],
        top: [center.x, center.y + d * 1.3, center.z + 0.001],
        front: [center.x, center.y + size.y * 0.3, center.z + d],
        side: [center.x + d, center.y + size.y * 0.3, center.z],
      };
      camera.position.set(...positions[preset]);
      controls.target.copy(center);
      controls.update();
    }

    function focusComponent(componentId: string): void {
      const entry = nodesRef.current.find((n) => n.componentId === componentId);
      const camera = cameraRef.current;
      const controls = controlsRef.current;
      if (!entry || !camera || !controls) return;
      const box = new Box3().setFromObject(entry.object);
      if (box.isEmpty()) return;
      const center = box.getCenter(new Vector3());
      const size = box.getSize(new Vector3());
      const d = Math.max(size.x, size.y, size.z, 1.5) * 4.2;
      camera.position.set(center.x + d, center.y + d * 0.7, center.z + d);
      controls.target.copy(center);
      controls.update();
    }

    // --- carga del modelo --------------------------------------------------
    useEffect(() => {
      const scene = sceneRef.current;
      if (!scene) return;
      if (modelRef.current) {
        scene.remove(modelRef.current);
        disposeTree(modelRef.current);
        modelRef.current = null;
        nodesRef.current = [];
      }
      if (!props.glbBase64) return;

      const materialByComponent = new Map<string, string | null>();
      props.components.forEach((c) => materialByComponent.set(c.component_id, c.material));

      const loader = new GLTFLoader();
      let cancelled = false;
      try {
        loader.parse(
          base64ToArrayBuffer(props.glbBase64),
          '',
          (gltf) => {
            if (cancelled) return;
            const root = new Group();
            root.name = 'modelo';
            const entries: NodeEntry[] = [];
            let meshes = 0;
            let triangles = 0;

            gltf.scene.traverse((child) => {
              if (!(child instanceof Mesh)) return;
              const parsed =
                parseNodeName(child.name) ??
                parseNodeName(child.parent?.name ?? '');
              if (!parsed) return;
              meshes += 1;
              const index = child.geometry.getIndex();
              triangles += index
                ? index.count / 3
                : child.geometry.getAttribute('position').count / 3;
              child.userData.componentId = parsed.componentId;
              child.userData.discipline = parsed.discipline;
              child.userData.level = parsed.level;
              child.castShadow = true;
              child.receiveShadow = true;
              child.material = buildMaterial(
                materialByComponent.get(parsed.componentId) ?? null,
                parsed.discipline,
                propsRef.current.colorMode,
              );
            });

            // Se reconstruye la jerarquía: raíz -> disciplina -> zona -> malla.
            // `attach` conserva la transformación en mundo al reasignar padre.
            const disciplineGroups = new Map<string, Group>();
            const levelGroups = new Map<string, Group>();
            const meshList: Mesh[] = [];
            gltf.scene.traverse((child) => {
              if (child instanceof Mesh && child.userData.componentId) meshList.push(child);
            });
            meshList.forEach((mesh) => {
              const discipline = mesh.userData.discipline as string;
              const level = (mesh.userData.level as string) || LEVELLESS;

              let disciplineGroup = disciplineGroups.get(discipline);
              if (!disciplineGroup) {
                disciplineGroup = new Group();
                disciplineGroup.name = `disciplina:${discipline}`;
                disciplineGroups.set(discipline, disciplineGroup);
                root.add(disciplineGroup);
              }

              const levelKey = `${discipline}/${level}`;
              let levelGroup = levelGroups.get(levelKey);
              if (!levelGroup) {
                levelGroup = new Group();
                levelGroup.name = `zona:${level}`;
                levelGroup.userData.level = level;
                levelGroups.set(levelKey, levelGroup);
                disciplineGroup.add(levelGroup);
              }

              levelGroup.attach(mesh);
              entries.push({
                object: mesh,
                discipline,
                level,
                componentId: mesh.userData.componentId as string,
              });
            });

            scene.add(root);
            modelRef.current = root;
            nodesRef.current = entries;

            const bounds = new Box3().setFromObject(root);
            boundsRef.current = bounds;
            const size = bounds.getSize(new Vector3());
            fitStage(bounds);
            frameBounds();
            applyAll();
            propsRef.current.onLoaded({
              meshes,
              triangles: Math.round(triangles),
              bounds: [size.x, size.y, size.z],
            });
          },
          (error) => {
            const detail =
              error instanceof Error ? error.message : (error as ErrorEvent)?.message ?? 'error desconocido';
            propsRef.current.onError(`No se pudo interpretar el modelo generado: ${detail}`);
          },
        );
      } catch (error) {
        propsRef.current.onError(
          `No se pudo cargar el modelo: ${error instanceof Error ? error.message : 'error desconocido'}`,
        );
      }
      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.glbBase64]);

    function buildMaterial(
      materialKey: string | null,
      discipline: string,
      mode: ColorMode,
    ): Material {
      const preset = presetFor(materialKey);
      const color = mode === 'discipline' ? (DISCIPLINE_COLOR[discipline] ?? preset.color) : preset.color;
      const shared = {
        color: new Color(color),
        roughness: preset.roughness,
        metalness: mode === 'discipline' ? 0.15 : preset.metalness,
        clippingPlanes: planesRef.current,
        clipShadows: true,
        // Al cortar el volumen, el interior de un sólido queda abierto. Con
        // doble cara la sección se lee como macizo en vez de desaparecer.
        side: DoubleSide,
      };
      if (preset.transmission && mode === 'material') {
        return new MeshPhysicalMaterial({
          ...shared,
          transmission: preset.transmission,
          thickness: 0.05,
          transparent: true,
          opacity: preset.opacity ?? 0.4,
          ior: 1.45,
        });
      }
      const material = new MeshStandardMaterial(shared);
      if (preset.emissive && mode === 'material') {
        material.emissive = new Color(preset.emissive);
        material.emissiveIntensity = preset.emissiveIntensity ?? 1;
      }
      return material;
    }

    // --- aplicación de capas, zona, explosión, corte y selección -----------
    function applyAll(): void {
      const { visibleDisciplines, visibleLevels, explode, section, selectedId, domain } =
        propsRef.current;
      const bounds = boundsRef.current;
      const model = modelRef.current;
      if (!model || !bounds) return;

      const size = bounds.getSize(new Vector3());
      const min = bounds.min;
      const levelCount = Math.max(
        1,
        new Set(nodesRef.current.map((n) => n.level).filter((l) => /^N\d+$/.test(l))).size,
      );

      model.children.forEach((disciplineGroup) => {
        const discipline = disciplineGroup.name.replace('disciplina:', '');
        disciplineGroup.visible = visibleDisciplines.has(discipline);
        disciplineGroup.children.forEach((levelGroup) => {
          const level = (levelGroup.userData.level as string) || LEVELLESS;
          levelGroup.visible = visibleLevels.size === 0 || visibleLevels.has(level);
          levelGroup.position.y = explodeOffset(level, explode, levelCount, domain);
        });
      });

      const planes = planesRef.current;
      if (section.enabled) {
        planes[0].constant = min.x + size.x * section.x;
        planes[1].constant = min.y + size.y * section.y;
        planes[2].constant = min.z + size.z * section.z;
      } else {
        planes.forEach((plane) => {
          plane.constant = Number.POSITIVE_INFINITY;
        });
      }

      if (selectedRef.current !== selectedId) {
        nodesRef.current.forEach((entry) => {
          const material = (entry.object as Mesh).material as MeshStandardMaterial;
          if (!material || !('emissive' in material)) return;
          const isSelected = entry.componentId === selectedId;
          if (isSelected) {
            material.userData.previousEmissive ??= material.emissive.getHex();
            material.emissive.set('#36e0b0');
            material.emissiveIntensity = 0.75;
          } else if (material.userData.previousEmissive !== undefined) {
            material.emissive.setHex(material.userData.previousEmissive as number);
            material.emissiveIntensity = material.userData.previousIntensity ?? 1;
            delete material.userData.previousEmissive;
          }
        });
        selectedRef.current = selectedId ?? null;
      }
    }

    useEffect(() => {
      applyAll();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
      props.visibleDisciplines,
      props.visibleLevels,
      props.explode,
      props.section,
      props.selectedId,
    ]);

    // Cambiar el modo de color exige reconstruir los materiales.
    useEffect(() => {
      const materialByComponent = new Map<string, string | null>();
      props.components.forEach((c) => materialByComponent.set(c.component_id, c.material));
      nodesRef.current.forEach((entry) => {
        const mesh = entry.object as Mesh;
        const old = mesh.material as Material;
        mesh.material = buildMaterial(
          materialByComponent.get(entry.componentId) ?? null,
          entry.discipline,
          props.colorMode,
        );
        old.dispose();
      });
      selectedRef.current = null;
      applyAll();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.colorMode]);

    return <div ref={containerRef} className="bs-viewport" />;
  },
);

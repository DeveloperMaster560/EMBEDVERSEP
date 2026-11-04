import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import {
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  DoubleSide,
  GridHelper,
  LoadingManager,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Texture,
  Vector3,
  WebGLRenderer,
} from 'three';
import { Line } from 'three';
import type { Object3D } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { Box, FolderOpen, Plus } from 'lucide-react';
import { makeIllustrativeBridge } from '../3d/bridgeModel';
import type { DigitalTwinAsset, DigitalTwinScene } from '../domain/types';

const maxImportBytes = 50 * 1024 * 1024;
const maxImportFiles = 200;
const allowedExtensions = new Set(['.glb', '.gltf', '.obj', '.stl', '.bin', '.png', '.jpg', '.jpeg', '.webp']);
const modelExtensions = new Set(['.glb', '.gltf', '.obj', '.stl']);

function extensionOf(name: string): string {
  return name.slice(name.lastIndexOf('.')).toLowerCase();
}

function getModelUrl(name: string, urls: Map<string, string>): string {
  const url = urls.get(name.toLowerCase());
  if (!url) throw new Error(`No se encontró el archivo requerido “${name}”. Selecciona también los recursos externos del modelo.`);
  return url;
}

async function loadImportedModel(assets: DigitalTwinAsset[]): Promise<Object3D> {
  const model = assets.find((asset) => modelExtensions.has(extensionOf(asset.name)));
  if (!model) throw new Error('Elige un modelo GLB, glTF, OBJ o STL.');

  const urls = new Map<string, string>();
  const objectUrls: string[] = [];
  for (const asset of assets) {
    const objectUrl = URL.createObjectURL(new Blob([asset.data], { type: asset.type || 'application/octet-stream' }));
    objectUrls.push(objectUrl);
    urls.set(asset.name.toLowerCase(), objectUrl);
  }

  const manager = new LoadingManager();
  manager.setURLModifier((url) => {
    if (url.startsWith('data:') || url.startsWith('blob:')) return url;
    let filename = url;
    try {
      filename = decodeURIComponent(new URL(url, urls.get(model.name.toLowerCase())).pathname.split('/').pop() ?? url);
    } catch {
      filename = url.split(/[\\/]/).pop() ?? url;
    }
    return getModelUrl(filename, urls);
  });

  try {
    const modelUrl = getModelUrl(model.name, urls);
    const extension = extensionOf(model.name);
    if (extension === '.glb' || extension === '.gltf') {
      return (await new GLTFLoader(manager).loadAsync(modelUrl)).scene;
    }
    if (extension === '.obj') {
      return await new OBJLoader(manager).loadAsync(modelUrl);
    }

    const geometry = await new STLLoader(manager).loadAsync(modelUrl);
    geometry.computeVertexNormals();
    return new Mesh(
      geometry,
      new MeshStandardMaterial({ color: '#9aafc4', roughness: 0.72, metalness: 0.18, side: DoubleSide }),
    );
  } finally {
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
  }
}

function disposeObject(object: Object3D): void {
  object.traverse((child) => {
    if (child instanceof Mesh || child instanceof Line) {
      child.geometry.dispose();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        Object.values(material).forEach((value) => {
          if (value instanceof Texture) value.dispose();
        });
        material.dispose();
      });
    }
  });
}

export function DigitalTwinViewer({
  digitalTwin,
  onGenerateBridge,
  onImportModel,
}: {
  digitalTwin: DigitalTwinScene | undefined;
  onGenerateBridge: () => void;
  onImportModel: (files: File[]) => Promise<void>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [viewerError, setViewerError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const loadState = { active: true };
    let animationFrame = 0;
    const scene = new Scene();
    scene.background = new Color('#121a24');
    const camera = new PerspectiveCamera(45, 1, 0.1, 2000);
    camera.position.set(20, 15, 23);
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'El navegador no pudo crear el contexto WebGL.';
      const timer = window.setTimeout(() => setViewerError(`No se puede iniciar el visor 3D: ${message}`), 0);
      return () => window.clearTimeout(timer);
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = 'srgb';
    renderer.toneMapping = 3;
    renderer.toneMappingExposure = 1.15;
    renderer.domElement.className = 'twin-canvas';
    host.replaceChildren(renderer.domElement);
    scene.add(new AmbientLight('#d5e5ff', 2));
    const keyLight = new DirectionalLight('#ffffff', 3);
    keyLight.position.set(12, 22, 14);
    scene.add(keyLight);
    const fillLight = new DirectionalLight('#75a9e6', 1.3);
    fillLight.position.set(-14, 8, -8);
    scene.add(fillLight);
    scene.add(new GridHelper(60, 60, '#34465b', '#243243'));
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.target.set(0, 2, 0);

    const resize = () => {
      const width = Math.max(host.clientWidth, 1);
      const height = Math.max(host.clientHeight, 1);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    const renderFrame = () => {
      controls.update();
      renderer.render(scene, camera);
      animationFrame = window.requestAnimationFrame(renderFrame);
    };
    renderFrame();

    if (digitalTwin) {
      const modelPromise = digitalTwin.kind === 'generated'
        ? Promise.resolve(makeIllustrativeBridge())
        : loadImportedModel(digitalTwin.assets ?? []);
      void modelPromise.then((model) => {
        if (!loadState.active) {
          disposeObject(model);
          return;
        }
        const bounds = new Box3().setFromObject(model);
        const center = bounds.getCenter(new Vector3());
        model.position.sub(center);
        scene.add(model);
        const size = bounds.getSize(new Vector3());
        const largestDimension = Math.max(size.x, size.y, size.z, 1);
        const cameraDistance = largestDimension * 1.65;
        camera.position.set(cameraDistance, cameraDistance * 0.75, cameraDistance);
        camera.near = Math.max(largestDimension / 1000, 0.01);
        camera.far = Math.max(largestDimension * 100, 1000);
        camera.updateProjectionMatrix();
        controls.target.set(0, 0, 0);
        controls.minDistance = largestDimension * 0.04;
        controls.maxDistance = largestDimension * 30;
        setIsLoading(false);
      }).catch((error: unknown) => {
        if (!loadState.active) return;
        setViewerError(error instanceof Error ? error.message : 'No se pudo cargar el modelo.');
        setIsLoading(false);
      });
    }
    queueMicrotask(() => {
      if (!loadState.active) return;
      setViewerError('');
      setIsLoading(digitalTwin?.kind === 'imported');
    });

    return () => {
      loadState.active = false;
      observer.disconnect();
      window.cancelAnimationFrame(animationFrame);
      controls.dispose();
      renderer.dispose();
      disposeObject(scene);
      scene.clear();
    };
  }, [digitalTwin]);

  const handleFileSelection = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!files.length) return;

    if (files.length > maxImportFiles) {
      setViewerError(`Selecciona como máximo ${maxImportFiles} archivos por importación.`);
      return;
    }
    const totalBytes = files.reduce((total, file) => total + file.size, 0);
    if (totalBytes > maxImportBytes) {
      setViewerError('El tamaño total de los archivos seleccionados no puede superar 50 MiB.');
      return;
    }
    const names = new Set<string>();
    for (const file of files) {
      const name = file.name.toLowerCase();
      if (names.has(name)) {
        setViewerError(`Hay más de un archivo con el nombre “${file.name}”. Selecciona solo recursos con nombres únicos.`);
        return;
      }
      names.add(name);
    }
    const invalidFile = files.find((file) => !allowedExtensions.has(extensionOf(file.name)));
    if (invalidFile) {
      setViewerError(`Formato no admitido: ${invalidFile.name}`);
      return;
    }
    if (!files.some((file) => modelExtensions.has(extensionOf(file.name)))) {
      setViewerError('La selección debe incluir un modelo .glb, .gltf, .obj o .stl.');
      return;
    }

    setViewerError('');
    try {
      await onImportModel(files);
    } catch (error) {
      setViewerError(error instanceof Error ? error.message : 'No se pudo importar el modelo.');
    }
  };

  return (
    <div className="twin-viewer-shell">
      <div className="twin-toolbar">
        <div className="twin-model-label">
          <span className="twin-model-icon"><Box size={17} /></span>
          <span><strong>{digitalTwin?.name ?? 'Escena 3D vacía'}</strong><small>{digitalTwin ? digitalTwin.kind === 'generated' ? 'Geometría ilustrativa generada' : 'Modelo 3D importado' : 'Genera un modelo o importa un archivo'}</small></span>
        </div>
        <div className="twin-toolbar-actions">
          <button className="secondary-button" onClick={onGenerateBridge}><Plus size={15} /> Generar puente</button>
          <button className="primary-button" onClick={() => inputRef.current?.click()}><FolderOpen size={15} /> Importar modelo</button>
          <input
            ref={inputRef}
            className="visually-hidden-input"
            type="file"
            accept=".glb,.gltf,.obj,.stl,.bin,.png,.jpg,.jpeg,.webp"
            multiple
            onChange={(event) => void handleFileSelection(event)}
          />
        </div>
      </div>
      <div className="twin-canvas-wrap" ref={hostRef}>
        {!digitalTwin && <div className="twin-empty-hint"><Box size={24} /><strong>Tu espacio 3D está listo</strong><span>Genera un puente demostrativo o carga un modelo GLB, glTF, OBJ o STL.</span></div>}
        {isLoading && <div className="twin-loading">Cargando modelo 3D…</div>}
        {viewerError && <div className="twin-error" role="alert">{viewerError}</div>}
        {digitalTwin?.kind === 'generated' && <span className="twin-fidelity-label">GEOMETRÍA ILUSTRATIVA · NO ES ANÁLISIS ESTRUCTURAL</span>}
      </div>
      <div className="twin-footer"><span>Arrastrar: orbitar</span><span>Rueda: zoom</span><span>Escala y resultados dependen del modelo importado.</span></div>
    </div>
  );
}

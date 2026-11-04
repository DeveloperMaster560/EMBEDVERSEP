import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import {
  ArrowDownToLine,
  Box,
  Camera,
  ChevronDown,
  Circle,
  CircleHelp,
  Copy,
  Cuboid,
  Eye,
  EyeOff,
  Focus,
  FolderPlus,
  Grid2X2,
  HardDriveDownload,
  Import,
  Layers,
  Lock,
  LockOpen,
  Redo2,
  Rotate3D,
  Save,
  Scaling,
  ShieldAlert,
  Sparkles,
  Trash2,
  Undo2,
  Upload,
  Waves,
  X,
} from 'lucide-react';
import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry as ThreeSphereGeometry,
  ConeGeometry,
  PlaneGeometry,
  TorusGeometry,
  LoadingManager,
  Vector3,
  Texture,
} from 'three';
import type { Object3D } from 'three';
import { Float32BufferAttribute } from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { BridgeViewport } from './BridgeViewport';
import type { BridgeViewportHandle } from './BridgeViewport';
import { convertSceneUnits, createAiBridgeObjects, createBridgeObjects, createPrimitive, createScene, createSensorObject } from './scene';
import { loadBridgeScene, saveBridgeScene } from './persistence';
import { parseBridgeScene } from './serialization';
import type { BridgeObject, BridgeParameters, BridgeSceneDocument, BridgeTool, BridgeType } from './types';
import { canGenerateBridge, parseBridgeSpecification, type BridgeSpecification } from './ai-contracts';
import { interpretBridgePrompt } from './ai-client';
import './bridge-designer.css';

const bridgeTypes: { id: BridgeType; label: string }[] = [
  { id: 'beam', label: 'Puente viga' },
  { id: 'slab', label: 'Puente de losa' },
  { id: 'box-girder', label: 'Vigas cajón' },
  { id: 'cable-stayed', label: 'Atirantado' },
  { id: 'suspension', label: 'Colgante' },
  { id: 'arch', label: 'Arco' },
  { id: 'truss', label: 'Cercha' },
  { id: 'viaduct', label: 'Viaducto' },
  { id: 'pedestrian', label: 'Peatonal' },
  { id: 'highway', label: 'Vehicular' },
];

const inspectorTabs = ['Escena', 'Objetos', 'Transformar', 'Material', 'Sensores'] as const;
type InspectorTab = typeof inspectorTabs[number];
const objectKinds = ['box', 'sphere', 'cylinder', 'cone', 'plane', 'torus'] as const;
const allowedModel = /\.(glb|gltf|obj|stl)$/i;
const clarificationQuestions = [
  '¿Cuál es la longitud del puente?',
  '¿Cuál es el ancho del puente?',
  '¿Qué altura debe tener el tablero sobre el terreno?',
  '¿Respecto a qué nivel de terreno se mide la altura del tablero?',
  '¿Cuántos apoyos necesitas?',
  '¿Cómo se distribuyen los apoyos: en una fila a lo largo del puente o en pares a ambos lados?',
  'La distribución en pares requiere una cantidad par; corrige la cantidad de apoyos.',
];
type BridgeAiSpecificationUpdate = Omit<Partial<BridgeSpecification>, 'overallDimensions' | 'deck' | 'supports'> & {
  overallDimensions?: Partial<BridgeSpecification['overallDimensions']>;
  deck?: Partial<BridgeSpecification['deck']>;
  supports?: Partial<BridgeSpecification['supports']>;
};

function withUpdatedAt(scene: BridgeSceneDocument): BridgeSceneDocument {
  return { ...scene, updatedAt: new Date().toISOString() };
}

async function loadModelFiles(files: File[], model: File): Promise<Group> {
  const urls = new Map<string, string>();
  const objectUrls: string[] = [];
  for (const file of files) {
    const url = URL.createObjectURL(file);
    objectUrls.push(url);
    urls.set(file.name.toLowerCase(), url);
  }
  const manager = new LoadingManager();
  manager.setURLModifier((url) => {
    if (/^(data|blob):/i.test(url)) return url;
    const name = decodeURIComponent(new URL(url, urls.get(model.name.toLowerCase())).pathname.split('/').pop() ?? url).toLowerCase();
    const asset = urls.get(name);
    if (!asset) throw new Error(`Falta el recurso externo “${name}”. Selecciónalo junto al modelo.`);
    return asset;
  });
  try {
    const source = urls.get(model.name.toLowerCase());
    if (!source) throw new Error('No se pudo preparar la URL del modelo.');
    const extension = model.name.slice(model.name.lastIndexOf('.')).toLowerCase();
    if (extension === '.glb' || extension === '.gltf') {
      return (await new GLTFLoader(manager).loadAsync(source)).scene;
    }
    if (extension === '.obj') return new OBJLoader(manager).loadAsync(source);
    const geometry = new STLLoader(manager).parse(await model.arrayBuffer());
    const root = new Group();
    root.add(new Mesh(geometry, new MeshStandardMaterial({ color: '#95a9bb', roughness: 0.72 })));
    return root;
  } finally {
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
  }
}

function disposeModel(root: Object3D) {
  root.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      Object.values(material).forEach((value) => {
        if (value instanceof Texture) value.dispose();
      });
      material.dispose();
    });
  });
}

function extractImportedMeshes(root: Group, modelName: string): BridgeObject[] {
  root.updateMatrixWorld(true);
  const imported: BridgeObject[] = [];
  let vertexCount = 0;
  root.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    const geometry = child.geometry.clone();
    geometry.applyMatrix4(child.matrixWorld);
    const position = geometry.getAttribute('position');
    if (!position) {
      geometry.dispose();
      return;
    }
    vertexCount += position.count;
    if (vertexCount > 1_000_000) {
      geometry.dispose();
      throw new Error('El modelo supera el límite de un millón de vértices.');
    }
    const bounds = geometry.boundingBox ?? (geometry.computeBoundingBox(), geometry.boundingBox);
    const center = bounds?.getCenter(new Vector3()) ?? new Vector3();
    const size = bounds?.getSize(new Vector3()) ?? new Vector3(1, 1, 1);
    geometry.translate(-center.x, -center.y, -center.z);
    const rawMaterial = Array.isArray(child.material) ? child.material[0] : child.material;
    const material = rawMaterial instanceof MeshStandardMaterial ? rawMaterial : null;
    imported.push({
      id: crypto.randomUUID(),
      name: child.name || modelName.replace(/\.[^.]+$/, ''),
      kind: 'custom',
      role: 'imported',
      dimensions: [size.x, size.y, size.z],
      position: [center.x, center.y, center.z],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      color: material ? `#${material.color.getHexString()}` : '#95a9bb',
      roughness: material?.roughness ?? 0.72,
      metalness: material?.metalness ?? 0.08,
      visible: true,
      locked: false,
      collection: 'Modelos importados',
      geometry: {
        positions: Array.from(position.array),
        ...(geometry.index ? { indices: Array.from(geometry.index.array) } : {}),
        ...(geometry.getAttribute('normal') ? { normals: Array.from(geometry.getAttribute('normal').array) } : {}),
      },
    });
    geometry.dispose();
  });
  return imported;
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function makeExportGroup(objects: BridgeObject[]): Group {
  const group = new Group();
  for (const object of objects) {
    let geometry: BufferGeometry;
    const [width, height, depth] = object.dimensions;
    if (object.kind === 'custom') {
      if (!object.geometry?.positions.length) continue;
      geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(object.geometry.positions, 3));
      if (object.geometry.normals) geometry.setAttribute('normal', new Float32BufferAttribute(object.geometry.normals, 3));
      if (object.geometry.indices) geometry.setIndex(object.geometry.indices);
      if (!object.geometry.normals) geometry.computeVertexNormals();
    } else if (object.kind === 'box') geometry = new BoxGeometry(width, height, depth);
    else if (object.kind === 'cylinder') geometry = new CylinderGeometry(width / 2, depth / 2, height, 16);
    else if (object.kind === 'sphere') {
      geometry = new ThreeSphereGeometry(0.5, 20, 12);
      geometry.scale(width, height, depth);
    } else if (object.kind === 'cone') {
      geometry = new ConeGeometry(width / 2, height, 24);
      geometry.scale(1, 1, depth / Math.max(width, 0.001));
    }
    else if (object.kind === 'plane') geometry = new PlaneGeometry(width, depth);
    else if (object.kind === 'torus') {
      geometry = new TorusGeometry(width / 2, height / 2, 12, 32);
      geometry.scale(1, 1, depth / Math.max(width, 0.001));
    }
    else continue;
    const mesh = new Mesh(geometry, new MeshStandardMaterial({ color: object.color, roughness: object.roughness, metalness: object.metalness }));
    mesh.name = object.name;
    mesh.position.set(...object.position);
    mesh.rotation.set(...object.rotation);
    mesh.scale.set(...object.scale);
    mesh.visible = object.visible;
    group.add(mesh);
  }
  return group;
}

export function BridgeDesigner({
  projectId,
  projectName,
  standalone = false,
}: {
  projectId: string;
  projectName: string;
  standalone?: boolean;
}) {
  const [document, setDocument] = useState<BridgeSceneDocument | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tool, setTool] = useState<BridgeTool>('select');
  const [activeInspector, setActiveInspector] = useState<InspectorTab>('Escena');
  const [showGenerate, setShowGenerate] = useState(false);
  const [showAiGenerator, setShowAiGenerator] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiSpecification, setAiSpecification] = useState<BridgeSpecification | null>(null);
  const [aiFlow, setAiFlow] = useState<'idle' | 'interpreting' | 'needs_clarification' | 'awaiting_approval' | 'generating' | 'completed' | 'error'>('idle');
  const [aiError, setAiError] = useState('');
  const [aiBackendStatus, setAiBackendStatus] = useState<'checking' | 'configured' | 'missing' | 'unavailable'>('checking');
  const [showHelp, setShowHelp] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [saveState, setSaveState] = useState<'loading' | 'saved' | 'saving' | 'error'>('loading');
  const [error, setError] = useState('');
  const [operation, setOperation] = useState('Escena lista.');
  const [gridVisible, setGridVisible] = useState(true);
  const [wireframe, setWireframe] = useState(false);
  const [undoStack, setUndoStack] = useState<BridgeSceneDocument[]>([]);
  const [redoStack, setRedoStack] = useState<BridgeSceneDocument[]>([]);
  const [parameters, setParameters] = useState<BridgeParameters>({
    name: `${projectName} · puente`,
    type: 'cable-stayed',
    length: 120,
    width: 18,
    deckHeight: 8,
    pierHeight: 7,
    spans: 3,
    lanes: 4,
    unit: 'm',
  });
  const viewportRef = useRef<BridgeViewportHandle>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const openRef = useRef<HTMLInputElement>(null);
  const selected = document?.objects.find((object) => object.id === selectedId) ?? null;
  const collections = useMemo(() => [...new Set(document?.objects.map((object) => object.collection) ?? [])], [document?.objects]);

  useEffect(() => {
    let current = true;
    loadBridgeScene(projectId)
      .then((saved) => {
        if (!current) return;
        const scene = saved ?? createScene(projectId, projectName);
        setDocument(scene);
        setSaveState('saved');
        setOperation(saved ? 'Escena del proyecto recuperada.' : 'Nueva escena independiente preparada.');
      })
      .catch((cause: unknown) => {
        if (current) {
          setError(cause instanceof Error ? cause.message : 'No se pudo cargar la escena.');
          setSaveState('error');
        }
      })
      .finally(() => {
        if (current) setIsLoading(false);
      });
    return () => { current = false; };
  }, [projectId, projectName]);

  useEffect(() => {
    let current = true;
    fetch('/api/ai/bridge/status')
      .then(async (response) => {
        if (!response.ok) throw new Error('Backend no disponible');
        return response.json() as Promise<{ configured?: unknown }>;
      })
      .then((result) => {
        if (current) setAiBackendStatus(result.configured === true ? 'configured' : 'missing');
      })
      .catch(() => {
        if (current) setAiBackendStatus('unavailable');
      });
    return () => { current = false; };
  }, []);

  useEffect(() => {
    if (!document || isLoading) return;
    const timer = window.setTimeout(() => {
      saveBridgeScene({ ...document, updatedAt: new Date().toISOString() })
        .then(() => setSaveState('saved'))
        .catch((cause: unknown) => {
          setSaveState('error');
          setError(cause instanceof Error ? cause.message : 'No se pudo guardar la escena.');
        });
    }, 550);
    return () => window.clearTimeout(timer);
  }, [document, isLoading]);

  const commit = (next: BridgeSceneDocument, message: string) => {
    if (document) setUndoStack((history) => [...history.slice(-39), structuredClone(document)]);
    setRedoStack([]);
    setSaveState('saving');
    setDocument(withUpdatedAt(next));
    setOperation(message);
    setError('');
  };

  const addPrimitive = (kind: typeof objectKinds[number]) => {
    if (!document) return;
    const object = createPrimitive(kind);
    commit({ ...document, objects: [...document.objects, object] }, `${object.name} agregado a la escena.`);
    setSelectedId(object.id);
    setActiveInspector('Transformar');
  };

  const updateObject = (id: string, changes: Partial<BridgeObject>, message = 'Propiedades actualizadas.') => {
    if (!document) return;
    commit({
      ...document,
      objects: document.objects.map((object) => object.id === id ? { ...object, ...changes } : object),
    }, message);
  };

  const updateTransform = (id: string, values: Pick<BridgeObject, 'position' | 'rotation' | 'scale'>) => {
    if (!document) return;
    setUndoStack((history) => [...history.slice(-39), structuredClone(document)]);
    setRedoStack([]);
    setDocument(withUpdatedAt({
      ...document,
      objects: document.objects.map((object) => object.id === id ? { ...object, ...values } : object),
    }));
    setSaveState('saving');
    setOperation('Transformación aplicada.');
  };

  const createBridge = () => {
    if (!document) return;
    try {
      const objects = createBridgeObjects(parameters);
      const next = {
        ...document,
        name: parameters.name.trim() || document.name,
        bridgeType: parameters.type,
        bridgeParameters: { ...parameters },
        unit: parameters.unit,
        objects,
      };
      commit(next, `${bridgeTypes.find(({ id }) => id === parameters.type)?.label} generado · ${objects.length} objetos paramétricos.`);
      setSelectedId(objects[0]?.id ?? null);
      setShowGenerate(false);
      window.setTimeout(() => viewportRef.current?.frameAll(), 50);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo generar el puente.');
    }
  };

  const interpretWithAi = async () => {
    setAiFlow('interpreting');
    setAiError('');
    setAiSpecification(null);
    try {
      const specification = await interpretBridgePrompt(aiPrompt);
      setAiSpecification(specification);
      setAiFlow(canGenerateBridge(specification) ? 'awaiting_approval' : 'needs_clarification');
    } catch (cause) {
      setAiError(cause instanceof Error ? cause.message : 'No se pudo interpretar la instrucción.');
      setAiFlow('error');
    }
  };

  const updateAiSpecification = (changes: BridgeAiSpecificationUpdate) => {
    if (!aiSpecification) return;
    const updated = {
      ...aiSpecification,
      ...changes,
      overallDimensions: { ...aiSpecification.overallDimensions, ...changes.overallDimensions },
      deck: { ...aiSpecification.deck, ...changes.deck },
      supports: { ...aiSpecification.supports, ...changes.supports },
    };
    const unresolvedQuestions = updated.unresolvedQuestions.filter((question) => !clarificationQuestions.includes(question));
    try {
      const specification = parseBridgeSpecification({ ...updated, unresolvedQuestions });
      setAiSpecification(specification);
      setAiFlow(canGenerateBridge(specification) ? 'awaiting_approval' : 'needs_clarification');
      setAiError('');
    } catch (cause) {
      setAiError(cause instanceof Error ? cause.message : 'La especificación editada no es válida.');
    }
  };

  const generateAiBridge = () => {
    if (!document || !aiSpecification || !canGenerateBridge(aiSpecification)) return;
    setAiFlow('generating');
    setAiError('');
    try {
      const objects = createAiBridgeObjects(aiSpecification, document.unit);
      const retainedObjects = document.objects.filter((object) => object.collection !== 'Puente IA');
      commit({
        ...document,
        name: aiSpecification.bridgeName.trim() || document.name,
        bridgeType: aiSpecification.structureType,
        bridgeParameters: undefined,
        objects: [...retainedObjects, ...objects],
      }, `Puente conceptual generado por IA · ${objects.length} objetos editables.`);
      setSelectedId(objects[0]?.id ?? null);
      setShowAiGenerator(false);
      setAiFlow('completed');
      window.setTimeout(() => viewportRef.current?.frameAll(), 50);
    } catch (cause) {
      setAiError(cause instanceof Error ? cause.message : 'No se pudo generar la geometría.');
      setAiFlow('error');
    }
  };

  const openAiGenerator = () => {
    setAiPrompt('');
    setAiSpecification(null);
    setAiError('');
    setAiFlow('idle');
    setShowAiGenerator(true);
  };

  const openBridgeDialog = () => {
    if (document?.bridgeParameters) {
      setParameters({ ...document.bridgeParameters });
    } else if (document) {
      setParameters((current) => ({ ...current, name: document.name }));
    }
    setShowGenerate(true);
  };

  const duplicateSelected = () => {
    if (!document || !selected) return;
    const copy = structuredClone(selected);
    copy.id = crypto.randomUUID();
    copy.name = `${selected.name} · copia`;
    copy.position = [selected.position[0] + 1, selected.position[1], selected.position[2] + 1];
    if (copy.association) {
      copy.association = {
        ...copy.association,
        bridgeComponentId: copy.association.bridgeComponentId === selected.id ? copy.id : copy.association.bridgeComponentId,
        deviceId: '',
        sensorId: undefined,
        status: 'unconnected',
      };
    }
    commit({ ...document, objects: [...document.objects, copy] }, `${selected.name} duplicado.`);
    setSelectedId(copy.id);
  };

  const deleteSelected = () => {
    if (!document || !selected) return;
    if (!window.confirm(`¿Eliminar “${selected.name}” de la escena?`)) return;
    const objects = document.objects
      .filter(({ id }) => id !== selected.id)
      .map((object) => object.association?.bridgeComponentId === selected.id
        ? { ...object, association: { ...object.association, bridgeComponentId: '', status: 'unconnected' as const } }
        : object);
    commit({ ...document, objects }, `${selected.name} eliminado.`);
    setSelectedId(null);
  };

  const undo = () => {
    const previous = undoStack.at(-1);
    if (!previous || !document) return;
    setRedoStack((history) => [...history, structuredClone(document)]);
    setUndoStack((history) => history.slice(0, -1));
    setSaveState('saving');
    setDocument(previous);
    setOperation('Acción deshecha.');
  };

  const redo = () => {
    const next = redoStack.at(-1);
    if (!next || !document) return;
    setUndoStack((history) => [...history, structuredClone(document)]);
    setRedoStack((history) => history.slice(0, -1));
    setSaveState('saving');
    setDocument(next);
    setOperation('Acción rehecha.');
  };

  const downloadScene = () => {
    if (!document) return;
    downloadBlob(new Blob([JSON.stringify(document, null, 2)], { type: 'application/vnd.embedverse.evbridge+json' }), `${document.name.replace(/[^\w-]+/g, '-')}.evbridge`);
    setOperation('Proyecto .evbridge descargado.');
  };

  const openSceneFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      if (file.size > 50 * 1024 * 1024) throw new Error('El archivo .evbridge supera el límite de 50 MiB.');
      const restored = withUpdatedAt(parseBridgeScene(await file.text(), projectId));
      commit(restored, `Proyecto ${file.name} abierto.`);
      await saveBridgeScene(restored);
      setSelectedId(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo abrir el proyecto.');
    }
  };

  const importModels = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!files.length || !document) return;
    const model = files.find((file) => allowedModel.test(file.name));
    if (!model) {
      setError('Selecciona un archivo GLB, glTF, OBJ o STL.');
      return;
    }
    if (files.length > 200 || files.reduce((total, file) => total + file.size, 0) > 30 * 1024 * 1024) {
      setError('Importación limitada a 200 archivos y 30 MiB por escena.');
      return;
    }
    setOperation(`Importando ${model.name}…`);
    setError('');
    try {
      const root = await loadModelFiles(files, model);
      let imported: BridgeObject[];
      try {
        imported = extractImportedMeshes(root, model.name);
      } finally {
        disposeModel(root);
      }
      if (!imported.length) throw new Error('El archivo no contiene mallas editables.');
      commit({ ...document, objects: [...document.objects, ...imported] }, `${model.name} importado · ${imported.length} mallas editables.`);
      setSelectedId(imported[0].id);
      setActiveInspector('Objetos');
      window.setTimeout(() => viewportRef.current?.frameAll(), 50);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `No se pudo importar ${model.name}.`);
    }
  };

  const exportGlb = async () => {
    if (!document) return;
    setOperation('Exportando geometría a GLB…');
    setError('');
    try {
      const data = await new GLTFExporter().parseAsync(makeExportGroup(document.objects), { binary: true, onlyVisible: true });
      if (!(data instanceof ArrayBuffer)) throw new Error('El exportador no produjo un archivo binario GLB.');
      downloadBlob(new Blob([data], { type: 'model/gltf-binary' }), `${document.name.replace(/[^\w-]+/g, '-')}.glb`);
      setOperation('Modelo GLB exportado.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo exportar a GLB.');
    }
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (document) {
          setSaveState('saving');
          void saveBridgeScene(document)
            .then(() => setSaveState('saved'))
            .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'No se pudo guardar.'));
        }
      } else if (event.key.toLowerCase() === 'g') setTool('translate');
      else if (event.key.toLowerCase() === 'r') setTool('rotate');
      else if (event.key.toLowerCase() === 's') setTool('scale');
      else if (event.key.toLowerCase() === 'f') viewportRef.current?.focusSelection();
      else if (event.key === 'Escape') setTool('select');
      else if ((event.key === 'Delete' || event.key === 'Backspace') && selected) deleteSelected();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  const generateForm = (
    <div className="bridge-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) setShowGenerate(false);
    }}>
      <section className="bridge-modal" role="dialog" aria-modal="true" aria-labelledby="bridge-modal-title">
        <div className="bridge-modal-heading">
          <div><Waves size={18} /><h2 id="bridge-modal-title">Generar puente paramétrico</h2></div>
          <button type="button" className="bridge-icon-button" onClick={() => setShowGenerate(false)} aria-label="Cerrar"><X size={16} /></button>
        </div>
        <p>Genera geometría editable por partes. Es un modelo conceptual, no un cálculo ni un plano certificado.</p>
        <label>Nombre del proyecto<input value={parameters.name} onChange={(event) => setParameters({ ...parameters, name: event.target.value })} /></label>
        <label>Tipología<select value={parameters.type} onChange={(event) => setParameters({ ...parameters, type: event.target.value as BridgeType })}>{bridgeTypes.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}</select></label>
        <div className="bridge-field-grid">
          <label>Longitud ({parameters.unit})<input type="number" min="1" value={parameters.length} onChange={(event) => setParameters({ ...parameters, length: Number(event.target.value) })} /></label>
          <label>Ancho ({parameters.unit})<input type="number" min="1" value={parameters.width} onChange={(event) => setParameters({ ...parameters, width: Number(event.target.value) })} /></label>
          <label>Altura tablero ({parameters.unit})<input type="number" min="0" value={parameters.deckHeight} onChange={(event) => setParameters({ ...parameters, deckHeight: Number(event.target.value) })} /></label>
          <label>Altura pilas ({parameters.unit})<input type="number" min="1" value={parameters.pierHeight} onChange={(event) => setParameters({ ...parameters, pierHeight: Number(event.target.value) })} /></label>
          <label>Vanos<input type="number" min="1" max="20" value={parameters.spans} onChange={(event) => setParameters({ ...parameters, spans: Number(event.target.value) })} /></label>
          <label>Carriles<input type="number" min="1" max="12" value={parameters.lanes} onChange={(event) => setParameters({ ...parameters, lanes: Number(event.target.value) })} /></label>
          <label>Unidades<select value={parameters.unit} onChange={(event) => setParameters({ ...parameters, unit: event.target.value as BridgeSceneDocument['unit'] })}><option value="m">Metros</option><option value="cm">Centímetros</option><option value="mm">Milímetros</option></select></label>
        </div>
        <div className="bridge-modal-actions">
          <button type="button" className="bridge-toolbar-button" onClick={() => setShowGenerate(false)}>Cancelar</button>
          <button type="button" className="bridge-primary-button" onClick={createBridge}>Generar geometría</button>
        </div>
      </section>
    </div>
  );

  const aiGeneratorForm = (
    <div className="bridge-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && aiFlow !== 'interpreting' && aiFlow !== 'generating') setShowAiGenerator(false);
    }}>
      <section className="bridge-modal bridge-ai-modal" role="dialog" aria-modal="true" aria-labelledby="bridge-ai-title">
        <div className="bridge-modal-heading">
          <div><Sparkles size={18} /><h2 id="bridge-ai-title">Crear puente con IA</h2></div>
          <button type="button" className="bridge-icon-button" onClick={() => setShowAiGenerator(false)} aria-label="Cerrar" disabled={aiFlow === 'interpreting' || aiFlow === 'generating'}><X size={16} /></button>
        </div>
        <p>Gemini interpreta la solicitud; la geometría se genera localmente y no se crea hasta tu aprobación. <strong>MODELO CONCEPTUAL — NO VALIDADO PARA CONSTRUCCIÓN.</strong></p>
        <div className={`bridge-ai-indicator ${aiBackendStatus !== 'configured' ? 'error' : ''}`}><span />{aiBackendStatus === 'checking' ? 'Comprobando configuración de Gemini…' : aiBackendStatus === 'configured' ? 'Clave de Gemini configurada en el backend · conectividad se verifica al interpretar' : aiBackendStatus === 'missing' ? 'Falta GEMINI_API_KEY en .env.local del backend' : 'Backend de Gemini no disponible'} · clave nunca enviada al navegador</div>
        <label className="bridge-ai-prompt-label">Describe el puente<textarea value={aiPrompt} rows={3} maxLength={8000} placeholder="Ej.: Puente de vigas de 30 m de longitud y 8 m de ancho, con el tablero a 15 m sobre el terreno y cuatro apoyos..." onChange={(event) => setAiPrompt(event.target.value)} /></label>
        <div className="bridge-modal-actions bridge-ai-interpret-actions">
          <span>{aiFlow === 'interpreting' ? 'Interpretando con Gemini…' : aiFlow === 'needs_clarification' ? 'Faltan aclaraciones' : aiFlow === 'awaiting_approval' ? 'Interpretación lista para revisar' : aiFlow === 'generating' ? 'Generando geometría…' : aiFlow === 'completed' ? 'Modelo creado' : 'API Gemini · gemini-3.8-flash'}</span>
          <button type="button" className="bridge-primary-button" onClick={() => void interpretWithAi()} disabled={!aiPrompt.trim() || aiFlow === 'interpreting' || aiFlow === 'generating'}><Sparkles size={14} />Interpretar</button>
        </div>
        {aiError && <p className="bridge-ai-error" role="alert">{aiError}</p>}
        {aiSpecification && (
          <div className="bridge-ai-specification">
            <h3>Especificación · revisa y corrige antes de generar</h3>
            {aiSpecification.unresolvedQuestions.length > 0 && <div className="bridge-ai-questions"><strong>Necesitamos aclarar:</strong><ul>{aiSpecification.unresolvedQuestions.map((question) => <li key={question}>{question}</li>)}</ul></div>}
            <div className="bridge-field-grid">
              <label>Nombre<input value={aiSpecification.bridgeName} onChange={(event) => updateAiSpecification({ bridgeName: event.target.value })} /></label>
              <label>Tipología<select value={aiSpecification.structureType} onChange={(event) => updateAiSpecification({ structureType: event.target.value as BridgeSpecification['structureType'] })}><option value="beam">Puente de vigas</option><option value="slab">Puente de losa</option></select></label>
              <label>Longitud (m)<input type="number" min="0.1" step="any" value={aiSpecification.overallDimensions.lengthM ?? ''} onChange={(event) => updateAiSpecification({ overallDimensions: { lengthM: event.target.value === '' ? null : Number(event.target.value) } })} /></label>
              <label>Ancho (m)<input type="number" min="0.1" step="any" value={aiSpecification.overallDimensions.widthM ?? ''} onChange={(event) => updateAiSpecification({ overallDimensions: { widthM: event.target.value === '' ? null : Number(event.target.value) } })} /></label>
              <label>Altura (m)<input type="number" min="0.1" step="any" value={aiSpecification.overallDimensions.heightM ?? ''} onChange={(event) => updateAiSpecification({ overallDimensions: { heightM: event.target.value === '' ? null : Number(event.target.value) } })} /></label>
              <label>Referencia de altura<select value={aiSpecification.overallDimensions.heightMeaning} onChange={(event) => updateAiSpecification({ overallDimensions: { heightMeaning: event.target.value as BridgeSpecification['overallDimensions']['heightMeaning'] } })}>
                <option value="unknown">Sin definir</option><option value="deck_above_ground">Tablero sobre el terreno</option><option value="total_structure">Altura total</option><option value="tower_height">Altura de torre</option><option value="clearance">Altura libre bajo el puente</option><option value="end_elevation_difference">Diferencia entre extremos</option>
              </select></label>
              <label>Referencia descriptiva<input value={aiSpecification.overallDimensions.heightReference ?? ''} placeholder="Ej.: terreno natural en el eje" onChange={(event) => updateAiSpecification({ overallDimensions: { heightReference: event.target.value || null } })} /></label>
              <label>Apoyos totales<input type="number" min="0" step="1" value={aiSpecification.supports.quantity ?? ''} onChange={(event) => updateAiSpecification({ supports: { quantity: event.target.value === '' ? null : Number(event.target.value) } })} /></label>
              <label>Distribución de apoyos<select value={aiSpecification.supports.distribution} onChange={(event) => updateAiSpecification({ supports: { distribution: event.target.value as BridgeSpecification['supports']['distribution'] } })}>
                <option value="unknown">Sin definir</option><option value="along_length">Una fila a lo largo del puente</option><option value="paired_across_width">En pares a ambos lados</option>
              </select></label>
              <label>Tipo de apoyo<select value={aiSpecification.supports.type} onChange={(event) => updateAiSpecification({ supports: { type: event.target.value as BridgeSpecification['supports']['type'] } })}><option value="unknown">Sin definir</option><option value="pier">Pila</option><option value="column">Columna</option></select></label>
              <label>Orientación<select value={aiSpecification.supports.orientation} onChange={(event) => updateAiSpecification({ supports: { orientation: event.target.value as BridgeSpecification['supports']['orientation'] } })}><option value="unknown">Sin definir</option><option value="vertical">Vertical</option></select></label>
              <label>Material<select value={aiSpecification.supports.material} onChange={(event) => updateAiSpecification({ supports: { material: event.target.value as BridgeSpecification['supports']['material'] } })}><option value="unknown">Sin definir</option><option value="concrete">Concreto</option><option value="steel">Acero</option></select></label>
              <label>Ancho del apoyo (m)<input type="number" min="0.1" step="any" value={aiSpecification.supports.widthM ?? ''} onChange={(event) => updateAiSpecification({ supports: { widthM: event.target.value === '' ? null : Number(event.target.value) } })} /></label>
              <label>Profundidad del apoyo (m)<input type="number" min="0.1" step="any" value={aiSpecification.supports.depthM ?? ''} onChange={(event) => updateAiSpecification({ supports: { depthM: event.target.value === '' ? null : Number(event.target.value) } })} /></label>
              <label>Espesor del tablero (m)<input type="number" min="0.1" step="any" value={aiSpecification.deck.thicknessM ?? ''} onChange={(event) => updateAiSpecification({ deck: { thicknessM: event.target.value === '' ? null : Number(event.target.value) } })} /></label>
            </div>
            {aiSpecification.assumptions.length > 0 && <div className="bridge-ai-notes"><strong>Supuestos de la interpretación</strong><ul>{aiSpecification.assumptions.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></div>}
            {aiSpecification.warnings.length > 0 && <div className="bridge-ai-notes"><strong>Advertencias</strong><ul>{aiSpecification.warnings.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></div>}
            <div className="bridge-ai-components"><strong>Componentes incluidos</strong>{aiSpecification.components.map((component, index) => (
              <label key={`${component.id}-${index}`}><input type="checkbox" checked={component.included} disabled={component.type === 'deck'} onChange={(event) => updateAiSpecification({ components: aiSpecification.components.map((item, itemIndex) => itemIndex === index ? { ...item, included: event.target.checked } : item) })} />{component.type === 'main_girder' ? 'Vigas principales' : component.type === 'cross_beam' ? 'Vigas transversales' : component.type === 'guardrail' ? 'Barandas' : component.type === 'abutment' ? 'Estribos' : component.type === 'support' ? 'Apoyos' : component.type === 'deck' ? 'Tablero' : component.type === 'tower' ? 'Torres (no disponibles)' : 'Decoración (no disponible)'}</label>
            ))}</div>
            <div className="bridge-modal-actions">
              <button type="button" className="bridge-toolbar-button" onClick={() => { setShowAiGenerator(false); setAiSpecification(null); }}>Cancelar</button>
              <button type="button" className="bridge-primary-button" onClick={generateAiBridge} disabled={!canGenerateBridge(aiSpecification) || aiFlow === 'generating'}>Aprobar y generar puente</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );

  if (isLoading || !document) {
    return <div className="bridge-editor-loading">{error || 'Cargando escena persistente…'}</div>;
  }

  const componentObjects = document.objects.filter((object) => object.role === 'iot');

  return (
    <main className={`bridge-editor${standalone ? ' bridge-editor-standalone' : ''}`}>
      <header className="bridge-topbar">
        <div className="bridge-brand"><span className="bridge-brand-mark"><Waves size={17} /></span><span><strong>EMBEDVERSE</strong><small>BRIDGE DESIGNER</small></span></div>
        {!standalone && <span className="bridge-project-title">{document.name}</span>}
        <div className="bridge-top-actions">
          <span className={`bridge-save-state ${saveState}`}>{saveState === 'saving' ? 'Guardando…' : saveState === 'error' ? 'Error de guardado' : 'Guardado local'}</span>
          <button type="button" className="bridge-toolbar-button" title="Deshacer (Ctrl+Z)" onClick={undo} disabled={!undoStack.length}><Undo2 size={15} /></button>
          <button type="button" className="bridge-toolbar-button" title="Rehacer (Ctrl+Shift+Z)" onClick={redo} disabled={!redoStack.length}><Redo2 size={15} /></button>
          <button type="button" className="bridge-toolbar-button" title="Abrir .evbridge" onClick={() => openRef.current?.click()}><Import size={15} /><span>Abrir</span></button>
          <button type="button" className="bridge-toolbar-button" title="Exportar proyecto .evbridge" onClick={downloadScene}><ArrowDownToLine size={15} /><span>Proyecto</span></button>
          <button type="button" className="bridge-primary-button" title="Guardar ahora (Ctrl+S)" onClick={() => document && void saveBridgeScene(document).then(() => setSaveState('saved')).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'No se pudo guardar.'))}><Save size={15} /><span>Guardar</span></button>
          <button type="button" className="bridge-toolbar-button" title="Ayuda y atajos" onClick={() => setShowHelp(true)}><CircleHelp size={15} /><span>Ayuda</span></button>
          {standalone && <a className="bridge-toolbar-button" href="/">Studio</a>}
        </div>
        <input ref={openRef} type="file" accept=".evbridge,application/json" hidden onChange={(event) => void openSceneFile(event)} />
      </header>

      <nav className="bridge-menubar" aria-label="Menú del modelador">
        <button type="button" onClick={downloadScene}>Archivo <ChevronDown size={12} /></button>
        <button type="button" onClick={undo}>Editar <ChevronDown size={12} /></button>
        <button type="button" onClick={() => addPrimitive('box')}>Crear <ChevronDown size={12} /></button>
        <button type="button" onClick={openBridgeDialog}>Generar puente</button>
        <button type="button" onClick={() => setActiveInspector('Material')}>Materiales <ChevronDown size={12} /></button>
        <button type="button" onClick={() => setActiveInspector('Escena')}>Escena <ChevronDown size={12} /></button>
        <button type="button" onClick={openAiGenerator}><Sparkles size={12} />Crear con IA</button>
        <button type="button" onClick={() => viewportRef.current?.setView('perspective')}>Cámara <ChevronDown size={12} /></button>
        <button type="button" onClick={() => setWireframe((value) => !value)}>Visualización <ChevronDown size={12} /></button>
      </nav>

      <section className="bridge-workspace">
        <aside className="bridge-toolbox" aria-label="Herramientas 3D">
          <div className="bridge-tool-section-label">TRANSFORMAR</div>
          <ToolButton icon={<Focus size={17} />} label="Seleccionar" active={tool === 'select'} onClick={() => setTool('select')} />
          <ToolButton icon={<Move3D size={17} />} label="Mover · G" active={tool === 'translate'} onClick={() => setTool('translate')} />
          <ToolButton icon={<Rotate3D size={17} />} label="Rotar · R" active={tool === 'rotate'} onClick={() => setTool('rotate')} />
          <ToolButton icon={<Scaling size={17} />} label="Escalar · S" active={tool === 'scale'} onClick={() => setTool('scale')} />
          <div className="bridge-tool-divider" />
          <div className="bridge-tool-section-label">GEOMETRÍA</div>
          <ToolButton icon={<Cuboid size={17} />} label="Cubo" onClick={() => addPrimitive('box')} />
          <ToolButton icon={<Circle size={17} />} label="Esfera" onClick={() => addPrimitive('sphere')} />
          <ToolButton icon={<CylinderIcon size={17} />} label="Cilindro" onClick={() => addPrimitive('cylinder')} />
          <ToolButton icon={<Layers size={17} />} label="Plano" onClick={() => addPrimitive('plane')} />
          <ToolButton icon={<Copy size={17} />} label="Duplicar" disabled={!selected} onClick={duplicateSelected} />
          <ToolButton icon={<Trash2 size={17} />} label="Eliminar" disabled={!selected} onClick={deleteSelected} />
          <div className="bridge-tool-divider" />
          <button type="button" className="bridge-add-bridge" onClick={openBridgeDialog}><Waves size={16} /><span>Puente nuevo</span></button>
          <button type="button" className="bridge-tool-button" onClick={() => { const sensor = createSensorObject('esp32'); if (document) { commit({ ...document, objects: [...document.objects, sensor] }, 'Dispositivo ESP32 agregado sin conexión física.'); setSelectedId(sensor.id); } }}><span className="bridge-iot-icon">ESP</span><span>Agregar ESP32</span></button>
          <button type="button" className="bridge-tool-button" onClick={() => { const sensor = createSensorObject('mpu6050'); if (document) { commit({ ...document, objects: [...document.objects, sensor] }, 'Sensor MPU6050 agregado sin datos conectados.'); setSelectedId(sensor.id); setActiveInspector('Sensores'); } }}><span className="bridge-iot-icon">IMU</span><span>Agregar MPU6050</span></button>
          <button type="button" className="bridge-tool-button" onClick={() => importRef.current?.click()}><Upload size={15} /><span>Importar modelo</span></button>
          <button type="button" className="bridge-tool-button" onClick={() => void exportGlb()}><HardDriveDownload size={15} /><span>Exportar GLB</span></button>
          <input ref={importRef} type="file" accept=".glb,.gltf,.obj,.stl,.bin,.png,.jpg,.jpeg,.webp" multiple hidden onChange={(event) => void importModels(event)} />
        </aside>

        <section className="bridge-viewport-column">
          <div className="bridge-viewport-toolbar">
            <div className="bridge-tool-mode"><span className={`bridge-mode-dot ${tool}`} />{tool === 'select' ? 'Selección' : tool === 'translate' ? 'Mover' : tool === 'rotate' ? 'Rotar' : 'Escalar'}</div>
            <div className="bridge-view-actions">
              <button type="button" onClick={() => viewportRef.current?.setView('top')}>Superior</button>
              <button type="button" onClick={() => viewportRef.current?.setView('front')}>Frontal</button>
              <button type="button" onClick={() => viewportRef.current?.setView('side')}>Lateral</button>
              <button type="button" onClick={() => viewportRef.current?.setView('perspective')}>Perspectiva</button>
              <button type="button" title="Encuadrar escena" onClick={() => viewportRef.current?.frameAll()}><Camera size={14} /></button>
              <button type="button" title="Mostrar/ocultar cuadrícula" className={gridVisible ? 'selected' : ''} onClick={() => setGridVisible((visible) => !visible)}><Grid2X2 size={14} /></button>
              <button type="button" title="Ver objeto seleccionado (F)" onClick={() => viewportRef.current?.focusSelection()}><Focus size={14} /></button>
            </div>
          </div>
          <div className="bridge-viewport-frame">
            <BridgeViewport
              ref={viewportRef}
              document={document}
              selectedId={selectedId}
              tool={tool}
              gridVisible={gridVisible}
              gridSize={document.gridSize}
              wireframe={wireframe}
              onSelect={(id) => { setSelectedId(id); if (id) setActiveInspector('Transformar'); }}
              onTransform={updateTransform}
            />
            {document.objects.length === 0 && (
              <div className="bridge-empty-scene">
                <Waves size={31} />
                <strong>Escena de infraestructura vacía</strong>
                <span>Genera una tipología paramétrica o crea objetos para iniciar el modelado.</span>
                <button type="button" className="bridge-primary-button" onClick={openBridgeDialog}>Generar puente</button>
              </div>
            )}
            {error && <div className="bridge-alert" role="alert"><ShieldAlert size={15} /><span>{error}</span><button type="button" aria-label="Cerrar" onClick={() => setError('')}><X size={13} /></button></div>}
            <div className="bridge-viewport-scale">Unidades: {document.unit} · Cuadrícula {document.gridSize} {document.unit}</div>
          </div>
        </section>

        <aside className="bridge-inspector">
          <div className="bridge-inspector-tabs">
            {inspectorTabs.map((tab) => <button key={tab} type="button" className={activeInspector === tab ? 'active' : ''} onClick={() => setActiveInspector(tab)}>{tab}</button>)}
          </div>

          {activeInspector === 'Escena' && (
            <div className="bridge-inspector-content">
              <div className="bridge-panel-title">ÁRBOL DE ESCENA <span>{document.objects.length}</span></div>
              <div className="bridge-scene-root"><Layers size={14} /><strong>{document.name}</strong></div>
              {collections.map((collection) => (
                <div className="bridge-collection" key={collection}>
                  <div className="bridge-collection-heading"><ChevronDown size={13} /><FolderPlus size={13} /><strong>{collection}</strong><small>{document.objects.filter((object) => object.collection === collection).length}</small></div>
                  {document.objects.filter((object) => object.collection === collection).map((object) => (
                    <ObjectTreeRow key={object.id} object={object} selected={object.id === selectedId} onSelect={() => { setSelectedId(object.id); setActiveInspector(object.role === 'iot' ? 'Sensores' : 'Transformar'); }} onVisibility={() => updateObject(object.id, { visible: !object.visible }, `${object.name}: visibilidad ${object.visible ? 'desactivada' : 'activada'}.`)} onLock={() => updateObject(object.id, { locked: !object.locked }, `${object.name}: bloqueo actualizado.`)} />
                  ))}
                </div>
              ))}
              <button type="button" className="bridge-add-collection" onClick={() => {
                if (!selected || !document) return;
                const name = window.prompt('Nombre de la colección');
                if (!name?.trim()) return;
                updateObject(selected.id, { collection: name.trim() }, `Objeto asignado a “${name.trim()}”.`);
              }} disabled={!selected}><FolderPlus size={14} /> Asignar a colección</button>
              <button type="button" className="bridge-add-collection" onClick={() => setGridVisible((visible) => !visible)}><Grid2X2 size={14} />{gridVisible ? 'Ocultar cuadrícula' : 'Mostrar cuadrícula'}</button>
              <div className="bridge-scene-settings">
                <label>Unidades<select value={document.unit} onChange={(event) => commit(convertSceneUnits(document, event.target.value as BridgeSceneDocument['unit']), 'Unidades y dimensiones convertidas.')}><option value="m">Metros</option><option value="cm">Centímetros</option><option value="mm">Milímetros</option></select></label>
                <label>Escala de cuadrícula<input type="number" min="0.01" step="0.1" value={document.gridSize} onChange={(event) => commit({ ...document, gridSize: Math.max(Number(event.target.value), 0.01) }, 'Escala de cuadrícula actualizada.')} /></label>
                <label>Nombre<input value={document.name} onChange={(event) => { setSaveState('saving'); setDocument({ ...document, name: event.target.value }); }} onBlur={() => setOperation('Nombre de escena actualizado.')} /></label>
              </div>
            </div>
          )}

          {activeInspector === 'Objetos' && (
            <div className="bridge-inspector-content">
              <div className="bridge-panel-title">OBJETOS <span>{document.objects.length}</span></div>
              {document.objects.map((object) => (
                <ObjectTreeRow key={object.id} object={object} selected={object.id === selectedId} onSelect={() => setSelectedId(object.id)} onVisibility={() => updateObject(object.id, { visible: !object.visible })} onLock={() => updateObject(object.id, { locked: !object.locked })} />
              ))}
              <button type="button" className="bridge-add-collection" onClick={duplicateSelected} disabled={!selected}><Copy size={14} /> Duplicar objeto seleccionado</button>
              <button type="button" className="bridge-add-collection danger" onClick={deleteSelected} disabled={!selected}><Trash2 size={14} /> Eliminar seleccionado</button>
            </div>
          )}

          {(activeInspector === 'Transformar' || activeInspector === 'Material') && (
            <div className="bridge-inspector-content">
              <div className="bridge-panel-title">{activeInspector === 'Transformar' ? 'TRANSFORMACIONES' : 'MATERIAL'}</div>
              {!selected ? <div className="bridge-inspector-empty">Selecciona un objeto en la escena o jerarquía.</div> : (
                <>
                  <label className="bridge-property-label">Nombre<input value={selected.name} onChange={(event) => updateObject(selected.id, { name: event.target.value }, 'Nombre del objeto actualizado.')} /></label>
                  {activeInspector === 'Transformar' ? (
                    <>
                      <VectorFields label="Posición" values={selected.position} onChange={(position) => updateObject(selected.id, { position })} />
                      <VectorFields label="Rotación (°)" values={selected.rotation.map((radians) => radians * 180 / Math.PI) as [number, number, number]} onChange={(degrees) => updateObject(selected.id, { rotation: degrees.map((degreesValue) => degreesValue * Math.PI / 180) as [number, number, number] })} />
                      <VectorFields label="Escala" values={selected.scale} onChange={(scale) => updateObject(selected.id, { scale })} />
                      <VectorFields label="Dimensiones" values={selected.dimensions} onChange={(dimensions) => updateObject(selected.id, { dimensions: dimensions.map((value) => Math.max(value, 0.01)) as [number, number, number] })} />
                    </>
                  ) : (
                    <>
                      <label className="bridge-property-label">Color <input type="color" value={selected.color} onChange={(event) => updateObject(selected.id, { color: event.target.value })} /></label>
                      <RangeField label="Rugosidad" value={selected.roughness} onChange={(roughness) => updateObject(selected.id, { roughness })} />
                      <RangeField label="Metalicidad" value={selected.metalness} onChange={(metalness) => updateObject(selected.id, { metalness })} />
                      <div className="bridge-material-swatches">{[['Concreto', '#9aa5ae'], ['Acero', '#54718b'], ['Asfalto', '#343b43'], ['Aluminio', '#bdc8d1'], ['Madera', '#9c704c']].map(([label, color]) => <button key={label} type="button" style={{ backgroundColor: color }} title={label} onClick={() => updateObject(selected.id, { color })} />)}</div>
                    </>
                  )}
                  {selected.geometry && <p className="bridge-info-note">Malla importada: geometría almacenada por vértices. La edición es de transformación/material, no remodelado topológico.</p>}
                </>
              )}
            </div>
          )}

          {activeInspector === 'Sensores' && (
            <div className="bridge-inspector-content">
              <div className="bridge-panel-title">NODOS IoT · SIN DATOS REALES</div>
              {!componentObjects.length ? <div className="bridge-inspector-empty">Inserta un ESP32 o MPU6050 para prepararlo para una asociación futura.</div> : componentObjects.map((object) => (
                <button type="button" key={object.id} className={`bridge-sensor-card${object.id === selectedId ? ' selected' : ''}`} onClick={() => setSelectedId(object.id)}>
                  <span className="bridge-sensor-status" />
                  <span><strong>{object.name}</strong><small>{object.association?.deviceId || 'Sin device_id · sin conexión'}</small><small>{object.association?.sensorType ?? 'tipo no definido'}</small></span>
                </button>
              ))}
              {selected?.role === 'iot' && selected.association && (
                <>
                  <label className="bridge-property-label">Asociar con estructura<select value={selected.association.bridgeComponentId} onChange={(event) => updateObject(selected.id, { association: { ...selected.association!, bridgeComponentId: event.target.value } }, 'Asociación local actualizada; no se reciben datos reales.')}><option value="">Sin asociación estructural</option>{document.objects.filter((object) => object.role === 'structure').map((object) => <option key={object.id} value={object.id}>{object.name}</option>)}</select></label>
                  <label className="bridge-property-label">ID de dispositivo<input value={selected.association.deviceId} placeholder="device-id (opcional)" onChange={(event) => updateObject(selected.id, { association: { ...selected.association!, deviceId: event.target.value } }, 'Identificador preparado; no hay una conexión de datos.')} /></label>
                  <label className="bridge-property-label">ID de sensor<input value={selected.association.sensorId ?? ''} placeholder="sensor-id (opcional)" onChange={(event) => updateObject(selected.id, { association: { ...selected.association!, sensorId: event.target.value } })} /></label>
                  <label className="bridge-property-label">Tipo de sensor<input value={selected.association.sensorType ?? ''} onChange={(event) => updateObject(selected.id, { association: { ...selected.association!, sensorType: event.target.value } })} /></label>
                  <p className="bridge-info-note">Estado: no conectado. La asociación se guarda en la escena; no se consultan sensores ni se muestran datos inventados.</p>
                </>
              )}
            </div>
          )}
        </aside>
      </section>

      <footer className="bridge-statusbar">
        <span><span className="bridge-status-dot" />{saveState === 'saved' ? 'Persistencia local activa' : saveState === 'saving' ? 'Guardando cambios…' : saveState === 'error' ? 'Error de persistencia' : 'Cargando'}</span>
        <span>{operation}</span>
        <span>{selected ? `${selected.name} · ${selected.dimensions.map((value) => value.toFixed(2)).join(' × ')} ${document.unit}` : `${document.objects.length} objetos · ${document.unit}`}</span>
        <span>Proyecto conceptual · sin análisis estructural</span>
      </footer>
      {showGenerate && generateForm}
      {showAiGenerator && aiGeneratorForm}
      {showHelp && (
        <div className="bridge-modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setShowHelp(false);
        }}>
          <section className="bridge-help-modal" role="dialog" aria-modal="true" aria-labelledby="bridge-help-title">
            <div className="bridge-modal-heading"><div><CircleHelp size={18} /><h2 id="bridge-help-title">Ayuda · controles y alcance</h2></div><button type="button" className="bridge-icon-button" onClick={() => setShowHelp(false)} aria-label="Cerrar"><X size={16} /></button></div>
            <p><strong>Viewport:</strong> arrastra para orbitar, rueda para zoom y botón derecho para desplazar. Selecciona un objeto directamente o desde el árbol.</p>
            <p><strong>Atajos:</strong> G mover, R rotar, S escalar, F enfocar, Supr eliminar, Ctrl+Z deshacer, Ctrl+Shift+Z rehacer, Ctrl+S guardar y Esc seleccionar.</p>
            <p><strong>Geometría:</strong> puentes y objetos se guardan como elementos editables en unidades locales. La escena no calcula esfuerzos ni valida normas de diseño.</p>
            <p><strong>IoT:</strong> los identificadores y asociaciones se persisten, pero no existe conexión de hardware ni telemetría en esta versión.</p>
            <button type="button" className="bridge-primary-button" onClick={() => setShowHelp(false)}>Entendido</button>
          </section>
        </div>
      )}
    </main>
  );
}

function ToolButton({ icon, label, active = false, disabled = false, onClick }: { icon: ReactNode; label: string; active?: boolean; disabled?: boolean; onClick: () => void }) {
  return <button type="button" className={`bridge-tool-button${active ? ' active' : ''}`} disabled={disabled} onClick={onClick} title={label}>{icon}<span>{label}</span></button>;
}

function ObjectTreeRow({ object, selected, onSelect, onVisibility, onLock }: {
  object: BridgeObject;
  selected: boolean;
  onSelect: () => void;
  onVisibility: () => void;
  onLock: () => void;
}) {
  return (
    <div className={`bridge-object-row${selected ? ' selected' : ''}`}>
      <button type="button" className="bridge-object-select" onClick={onSelect}><Box size={13} /><span>{object.name}</span>{object.role === 'iot' && <small>IoT</small>}</button>
      <button type="button" aria-label={`${object.visible ? 'Ocultar' : 'Mostrar'} ${object.name}`} onClick={onVisibility}>{object.visible ? <Eye size={13} /> : <EyeOff size={13} />}</button>
      <button type="button" aria-label={`${object.locked ? 'Desbloquear' : 'Bloquear'} ${object.name}`} onClick={onLock}>{object.locked ? <Lock size={13} /> : <LockOpen size={13} />}</button>
    </div>
  );
}

function VectorFields({ label, values, onChange }: { label: string; values: [number, number, number]; onChange: (values: [number, number, number]) => void }) {
  return (
    <fieldset className="bridge-vector-fields">
      <legend>{label}</legend>
      {values.map((value, index) => (
        <label key={index}><span>{['X', 'Y', 'Z'][index]}</span><input type="number" step="0.1" value={Number.isFinite(value) ? Number(value.toFixed(3)) : 0} onChange={(event) => {
          const next = [...values] as [number, number, number];
          next[index] = Number(event.target.value);
          onChange(next);
        }} /></label>
      ))}
    </fieldset>
  );
}

function RangeField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label className="bridge-range-field">{label}<span>{value.toFixed(2)}</span><input type="range" min="0" max="1" step="0.01" value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function Move3D({ size }: { size: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 2v20M2 12h20M12 2 9 5m3-3 3 3M22 12l-3-3m3 3-3 3M12 22l-3-3m3 3 3-3M2 12l3-3m-3 3 3 3" /></svg>;
}

function CylinderIcon({ size }: { size: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><ellipse cx="12" cy="5" rx="7" ry="3" /><path d="M5 5v14c0 1.7 3.1 3 7 3s7-1.3 7-3V5" /><path d="M5 19c0-1.7 3.1-3 7-3s7 1.3 7 3" /></svg>;
}

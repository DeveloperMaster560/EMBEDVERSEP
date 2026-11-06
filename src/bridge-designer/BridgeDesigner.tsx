import { useEffect, useMemo, useRef, useState, type ChangeEvent, type MouseEvent, type ReactNode } from 'react';
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
  FileText,
  Focus,
  FolderPlus,
  Grid2X2,
  HardDriveDownload,
  Import,
  Layers,
  Lock,
  LockOpen,
  Magnet,
  Printer,
  Redo2,
  Rotate3D,
  Save,
  Scaling,
  Spline,
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
import { convertSceneUnits, createAiBridgeObjects, createBridgeObjects, createCableBetween, createPrimitive, createScene, createSensorObject, createStructuralElement, transformBridgeObjects, type StructuralElement } from './scene';
import { loadBridgeScene, saveBridgeScene } from './persistence';
import { parseBridgeScene } from './serialization';
import { createBridgeDrawingSvg, createPrintableBridgeDrawingHtml } from './drawings';
import type { BridgeObject, BridgeParameters, BridgeSceneDocument, BridgeTool, BridgeType } from './types';
import { canGenerateBridge, describeGenerationBlockers, parseBridgeSpecification, type BridgeSpecification } from './ai-contracts';
import { interpretBridgePromptLocally } from './local-bridge-interpreter';
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
const cableStayedFields: { key: keyof NonNullable<BridgeSpecification['cableStayed']>; label: string }[] = [
  { key: 'towerHeightM', label: 'Altura de torre sobre tablero (m)' },
  { key: 'towerSpacingM', label: 'Separación entre torres (m)' },
  { key: 'towerSectionWidthM', label: 'Ancho de sección de torre (m)' },
  { key: 'towerSectionDepthM', label: 'Fondo de sección de torre (m)' },
  { key: 'stayCableDiameterM', label: 'Diámetro de tirante (m)' },
  { key: 'mainGirderCount', label: 'Cantidad de vigas longitudinales' },
  { key: 'mainGirderHeightM', label: 'Altura de viga principal (m)' },
  { key: 'mainGirderWidthM', label: 'Ancho de viga principal (m)' },
  { key: 'crossBeamSpacingM', label: 'Separación entre vigas transversales (m)' },
  { key: 'crossBeamWidthM', label: 'Ancho de viga transversal (m)' },
  { key: 'crossBeamHeightM', label: 'Altura de viga transversal (m)' },
  { key: 'foundationLengthM', label: 'Largo de zapata (m)' },
  { key: 'foundationWidthM', label: 'Ancho de zapata (m)' },
  { key: 'foundationDepthM', label: 'Profundidad de zapata (m)' },
  { key: 'guardrailHeightM', label: 'Altura de baranda (m)' },
];
type BridgeAiSpecificationUpdate = Omit<Partial<BridgeSpecification>, 'overallDimensions' | 'deck' | 'supports' | 'cableStayed'> & {
  overallDimensions?: Partial<BridgeSpecification['overallDimensions']>;
  deck?: Partial<BridgeSpecification['deck']>;
  supports?: Partial<BridgeSpecification['supports']>;
  cableStayed?: Partial<NonNullable<BridgeSpecification['cableStayed']>>;
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
  const [selection, setSelectedIds] = useState<string[]>([]);
  const [tool, setTool] = useState<BridgeTool>('select');
  const [activeInspector, setActiveInspector] = useState<InspectorTab>('Escena');
  const [showGenerate, setShowGenerate] = useState(false);
  const [showAiGenerator, setShowAiGenerator] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiSpecification, setAiSpecification] = useState<BridgeSpecification | null>(null);
  const [aiFlow, setAiFlow] = useState<'idle' | 'interpreting' | 'needs_clarification' | 'awaiting_approval' | 'generating' | 'completed' | 'error'>('idle');
  const [aiError, setAiError] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [saveState, setSaveState] = useState<'loading' | 'saved' | 'saving' | 'error'>('loading');
  const [error, setError] = useState('');
  const [operation, setOperation] = useState('Escena lista.');
  const [gridVisible, setGridVisible] = useState(true);
  const [snapEnabled, setSnapEnabled] = useState(false);
  const [transformSpace, setTransformSpace] = useState<'world' | 'local'>('world');
  const [boxSelectEnabled, setBoxSelectEnabled] = useState(false);
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
  const validObjectIds = useMemo(() => new Set(document?.objects.map(({ id }) => id) ?? []), [document?.objects]);
  const selectedIds = useMemo(() => selection.filter((id) => validObjectIds.has(id)), [selection, validObjectIds]);
  const selectedId = selectedIds.at(-1) ?? null;
  const selectedObjects = document?.objects.filter((object) => selectedIds.includes(object.id)) ?? [];
  const selected = selectedObjects.find((object) => object.id === selectedId) ?? null;
  const collections = useMemo(() => [...new Set(document?.objects.map((object) => object.collection) ?? [])], [document?.objects]);

  useEffect(() => {
    let current = true;
    loadBridgeScene(projectId)
      .then((saved) => {
        if (!current) return;
        const scene = saved ? { ...saved, groups: saved.groups ?? [] } : createScene(projectId, projectName);
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

  const selectObject = (id: string | null, additive = false) => {
    setSelectedIds((current) => {
      const currentSelection = current.filter((selected) => validObjectIds.has(selected));
      if (!id) return additive ? currentSelection : [];
      const object = document?.objects.find((item) => item.id === id);
      const groupMembers = object?.groupId
        ? document?.objects.filter((item) => item.groupId === object.groupId).map((item) => item.id) ?? []
        : [id];
      if (!additive) return groupMembers;
      const allSelected = groupMembers.every((member) => currentSelection.includes(member));
      return allSelected
        ? currentSelection.filter((selected) => !groupMembers.includes(selected))
        : [...new Set([...currentSelection, ...groupMembers])];
    });
  };

  const selectGroup = (groupId: string, additive = false) => {
    const members = document?.objects.filter((object) => object.groupId === groupId).map(({ id }) => id) ?? [];
    setSelectedIds((current) => additive
      ? [...new Set([...current.filter((id) => validObjectIds.has(id)), ...members])]
      : members);
  };

  const selectObjects = (ids: string[], additive = false) => {
    const expandedIds = new Set(ids.flatMap((id) => {
      const object = document?.objects.find((item) => item.id === id);
      return object?.groupId
        ? document?.objects.filter((item) => item.groupId === object.groupId).map((item) => item.id) ?? []
        : [id];
    }));
    setSelectedIds((current) => additive
      ? [...new Set([...current.filter((id) => validObjectIds.has(id)), ...expandedIds])]
      : [...expandedIds]);
  };

  const groupSelected = () => {
    if (!document || selectedObjects.length < 2) return;
    const name = window.prompt('Nombre del grupo', `Grupo ${document.groups.length + 1}`);
    if (!name?.trim()) return;
    const group = { id: crypto.randomUUID(), name: name.trim() };
    const selectedSet = new Set(selectedIds);
    const remainingGroups = document.groups.filter(({ id }) =>
      !selectedSet.size || document.objects.some((object) => object.groupId === id && !selectedSet.has(object.id)));
    commit({
      ...document,
      groups: [...remainingGroups, group],
      objects: document.objects.map((object) => selectedSet.has(object.id) ? { ...object, groupId: group.id } : object),
    }, `Grupo “${group.name}” creado con ${selectedSet.size} objetos.`);
    setSelectedIds([...selectedSet]);
  };

  const ungroupSelected = () => {
    if (!document) return;
    const groupIds = new Set(selectedObjects.flatMap((object) => object.groupId ? [object.groupId] : []));
    if (!groupIds.size) return;
    const groups = document.groups.filter(({ id }) => !groupIds.has(id));
    commit({
      ...document,
      groups,
      objects: document.objects.map(({ groupId, ...object }) => groupIds.has(groupId ?? '') ? object : { ...object, ...(groupId ? { groupId } : {}) }),
    }, groupIds.size === 1 ? 'Grupo deshecho; sus objetos se conservaron.' : `${groupIds.size} grupos deshechos; sus objetos se conservaron.`);
    setSelectedIds(selectedObjects.map(({ id }) => id));
  };

  const addPrimitive = (kind: typeof objectKinds[number]) => {
    if (!document) return;
    const object = createPrimitive(kind);
    commit({ ...document, objects: [...document.objects, object] }, `${object.name} agregado a la escena.`);
    setSelectedIds([object.id]);
    setActiveInspector('Transformar');
  };

  const addStructuralElement = (element: StructuralElement) => {
    if (!document) return;
    const object = createStructuralElement(element);
    commit({ ...document, objects: [...document.objects, object] }, `${object.name} agregado a la escena.`);
    setSelectedIds([object.id]);
    setActiveInspector('Transformar');
  };

  /**
   * Tiende un cable entre las dos piezas seleccionadas, de centro a centro.
   *
   * Es la forma en que un ingeniero piensa un tirante —de este anclaje a aquel—
   * y evita tener que deducir a mano la longitud y los tres ángulos.
   */
  const addCableBetweenSelection = () => {
    if (!document) return;
    if (selectedObjects.length !== 2) {
      setError('Selecciona exactamente dos piezas para tender un cable entre ellas.');
      return;
    }
    const [from, to] = selectedObjects;
    try {
      const cable = createCableBetween(from.position, to.position, 0.09, `Cable ${from.name} → ${to.name}`);
      commit({ ...document, objects: [...document.objects, cable] }, 'Cable tendido entre las dos piezas seleccionadas.');
      setSelectedIds([cable.id]);
      setActiveInspector('Transformar');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo crear el cable.');
    }
  };

  const updateObject = (id: string, changes: Partial<BridgeObject>, message = 'Propiedades actualizadas.') => {
    if (!document) return;
    commit({
      ...document,
      objects: document.objects.map((object) => object.id === id ? { ...object, ...changes } : object),
    }, message);
  };

  const updateTransform = (transforms: { id: string; values: Pick<BridgeObject, 'position' | 'rotation' | 'scale'> }[]) => {
    if (!document) return;
    setUndoStack((history) => [...history.slice(-39), structuredClone(document)]);
    setRedoStack([]);
    setDocument(withUpdatedAt({
      ...document,
      objects: document.objects.map((object) => {
        const transform = transforms.find(({ id }) => id === object.id);
        return transform ? { ...object, ...transform.values } : object;
      }),
    }));
    setSaveState('saving');
    setOperation(transforms.length > 1 ? `Transformación aplicada a ${transforms.length} objetos.` : 'Transformación aplicada.');
  };

  const applyMultiTransform = (delta: {
    position: [number, number, number];
    rotationDegrees: [number, number, number];
    scaleFactor: [number, number, number];
  }) => {
    if (!document) return;
    const objects = transformBridgeObjects(document.objects, selectedIds, delta);
    commit({ ...document, objects }, `Transformación numérica aplicada a ${selectedObjects.filter((object) => !object.locked).length} objetos.`);
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
      setSelectedIds(objects[0] ? [objects[0].id] : []);
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
      const specification = interpretBridgePromptLocally(aiPrompt);
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
      ...(aiSpecification.cableStayed ? {
        cableStayed: { ...aiSpecification.cableStayed, ...changes.cableStayed },
      } : {}),
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
      const retainedObjects = document.objects.filter((object) => !['Puente IA', 'Puente asistido localmente'].includes(object.collection));
      commit({
        ...document,
        name: aiSpecification.bridgeName.trim() || document.name,
        bridgeType: aiSpecification.structureType === 'cable_stayed' ? 'cable-stayed' : aiSpecification.structureType,
        bridgeParameters: undefined,
        objects: [...retainedObjects, ...objects],
      }, `Puente conceptual generado con reglas locales · ${objects.length} objetos editables.`);
      setSelectedIds(objects[0] ? [objects[0].id] : []);
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

  const openManualBridgeGenerator = () => {
    setShowAiGenerator(false);
    setAiSpecification(null);
    openBridgeDialog();
  };

  const duplicateSelected = () => {
    if (!document || !selectedObjects.length) return;
    const idMap = new Map(selectedObjects.map(({ id }) => [id, crypto.randomUUID()]));
    const groupMap = new Map<string, string>();
    for (const object of selectedObjects) {
      if (object.groupId && !groupMap.has(object.groupId)) groupMap.set(object.groupId, crypto.randomUUID());
    }
    const copies = selectedObjects.map((object) => {
      const copy = structuredClone(object);
      copy.id = idMap.get(object.id) ?? object.id;
      copy.name = `${object.name} · copia`;
      copy.position = [object.position[0] + 1, object.position[1], object.position[2] + 1];
      if (object.groupId) copy.groupId = groupMap.get(object.groupId);
      if (copy.association) {
        copy.association = {
          ...copy.association,
          bridgeComponentId: idMap.get(copy.association.bridgeComponentId) ?? '',
          deviceId: '',
          sensorId: undefined,
          status: 'unconnected',
        };
      }
      return copy;
    });
    const copiedGroups = [...groupMap].flatMap(([groupId, id]) => {
      const source = document.groups.find((group) => group.id === groupId);
      return source ? [{ id, name: `${source.name} · copia` }] : [];
    });
    commit({
      ...document,
      groups: [...document.groups, ...copiedGroups],
      objects: [...document.objects, ...copies],
    }, copies.length === 1 ? `${selected?.name ?? 'Objeto'} duplicado.` : `${copies.length} objetos duplicados como conjunto.`);
    setSelectedIds(copies.map(({ id }) => id));
  };

  const deleteSelected = () => {
    if (!document || !selectedObjects.length) return;
    const selectedNames = selectedObjects.map(({ name }) => name);
    const confirmation = selectedNames.length === 1
      ? `¿Eliminar “${selectedNames[0]}” de la escena?`
      : `¿Eliminar los ${selectedNames.length} objetos seleccionados de la escena?`;
    if (!window.confirm(confirmation)) return;
    const selectedSet = new Set(selectedIds);
    const objects = document.objects
      .filter(({ id }) => !selectedSet.has(id))
      .map((object) => object.association && selectedSet.has(object.association.bridgeComponentId)
        ? { ...object, association: { ...object.association, bridgeComponentId: '', status: 'unconnected' as const } }
        : object);
    const groups = document.groups.filter(({ id }) => objects.some((object) => object.groupId === id));
    commit({ ...document, groups, objects }, selectedNames.length === 1 ? `${selectedNames[0]} eliminado.` : `${selectedNames.length} objetos eliminados.`);
    setSelectedIds([]);
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

  const exportDrawingSvg = () => {
    if (!document) return;
    try {
      const svg = createBridgeDrawingSvg(document);
      downloadBlob(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }), `${document.name.replace(/[^\w-]+/g, '-')}-planos.svg`);
      setOperation('Lámina vectorial con planta, alzado y sección exportada.');
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudieron generar los planos vectoriales.');
    }
  };

  const printDrawingPdf = () => {
    if (!document) return;
    try {
      const printable = window.open('', '_blank');
      if (!printable) throw new Error('El navegador bloqueó la ventana de impresión. Permite ventanas emergentes para exportar a PDF.');
      printable.document.open();
      printable.document.write(createPrintableBridgeDrawingHtml(document));
      printable.document.close();
      setOperation('Lámina técnica abierta: elige “Guardar como PDF” en el diálogo de impresión.');
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo preparar la impresión PDF.');
    }
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
      setSelectedIds([]);
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
      setSelectedIds([imported[0].id]);
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
      else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedObjects.length) deleteSelected();
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

  const generationBlockers = aiSpecification ? describeGenerationBlockers(aiSpecification) : [];

  const aiGeneratorForm = (
    <div className="bridge-modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && aiFlow !== 'interpreting' && aiFlow !== 'generating') setShowAiGenerator(false);
    }}>
      <section className="bridge-modal bridge-ai-modal" role="dialog" aria-modal="true" aria-labelledby="bridge-ai-title">
        <div className="bridge-modal-heading">
          <div><Sparkles size={18} /><h2 id="bridge-ai-title">Asistente local de puentes</h2></div>
          <button type="button" className="bridge-icon-button" onClick={() => setShowAiGenerator(false)} aria-label="Cerrar" disabled={aiFlow === 'interpreting' || aiFlow === 'generating'}><X size={16} /></button>
        </div>
        <p>Interpreta medidas y características conocidas mediante reglas locales. No usa IA externa ni envía el texto por internet. Revisa y completa los campos antes de generar. <strong>MODELO CONCEPTUAL — NO VALIDADO PARA CONSTRUCCIÓN.</strong></p>
        <div className="bridge-ai-indicator"><span />Interpretación determinista local · las frases no reconocidas requieren revisión manual.</div>
        <p className="bridge-ai-sibling">Esto genera un <strong>puente conceptual de visualización</strong>. Si lo que buscas es el modelo multidisciplinario —estructura, tablero, barreras, drenaje, iluminación, señalización e instrumentación, con detección de interferencias—, usa la pestaña <strong>Puentes</strong> del proyecto: allí no hay que indicar los apoyos, se deducen de los vanos.</p>
        <label className="bridge-ai-prompt-label">Describe el puente<textarea value={aiPrompt} rows={3} maxLength={8000} placeholder="Ej.: Puente de vigas de 30 m de longitud y 8 m de ancho, con el tablero a 15 m sobre el terreno y cuatro apoyos..." onChange={(event) => setAiPrompt(event.target.value)} /></label>
        <div className="bridge-modal-actions bridge-ai-interpret-actions">
          <span>{aiFlow === 'interpreting' ? 'Analizando texto localmente…' : aiFlow === 'needs_clarification' ? 'Faltan aclaraciones' : aiFlow === 'awaiting_approval' ? 'Interpretación lista para revisar' : aiFlow === 'generating' ? 'Generando geometría…' : aiFlow === 'completed' ? 'Modelo creado' : 'Sin conexión externa'}</span>
          <button type="button" className="bridge-toolbar-button" onClick={openManualBridgeGenerator} disabled={aiFlow === 'interpreting' || aiFlow === 'generating'}>Generador paramétrico manual</button>
          <button type="button" className="bridge-primary-button" onClick={() => void interpretWithAi()} disabled={!aiPrompt.trim() || aiFlow === 'interpreting' || aiFlow === 'generating'}><Sparkles size={14} />Analizar descripción</button>
        </div>
        {aiError && <p className="bridge-ai-error" role="alert">{aiError}</p>}
        {aiSpecification && (
          <div className="bridge-ai-specification">
            <h3>Especificación · revisa y corrige antes de generar</h3>
            {aiSpecification.unresolvedQuestions.length > 0 && <div className="bridge-ai-questions"><strong>Necesitamos aclarar:</strong><ul>{aiSpecification.unresolvedQuestions.map((question) => <li key={question}>{question}</li>)}</ul></div>}
            <div className="bridge-field-grid">
              <label>Nombre<input value={aiSpecification.bridgeName} onChange={(event) => updateAiSpecification({ bridgeName: event.target.value })} /></label>
              <label>Tipología<select value={aiSpecification.structureType} onChange={(event) => updateAiSpecification({ structureType: event.target.value as BridgeSpecification['structureType'] })}><option value="beam">Puente de vigas</option><option value="slab">Puente de losa</option><option value="cable_stayed">Puente atirantado</option></select></label>
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
            {aiSpecification.structureType === 'cable_stayed' && aiSpecification.cableStayed && (
              <>
                <h4>Parámetros del puente atirantado · revisa los supuestos</h4>
                <div className="bridge-field-grid">
                  <label>Cantidad total de cables<input type="number" min="8" max="400" step="8" value={aiSpecification.stayCableCount ?? ''} onChange={(event) => updateAiSpecification({ stayCableCount: event.target.value === '' ? null : Number(event.target.value) })} /></label>
                  {cableStayedFields.map(({ key, label }) => (
                    <label key={key}>{label}<input
                      type="number"
                      min={key === 'mainGirderCount' ? 2 : 0.01}
                      step={key === 'mainGirderCount' ? 1 : 'any'}
                      value={aiSpecification.cableStayed?.[key] ?? ''}
                      onChange={(event) => updateAiSpecification({ cableStayed: { [key]: event.target.value === '' ? null : Number(event.target.value) } })}
                    /></label>
                  ))}
                </div>
              </>
            )}
            {aiSpecification.assumptions.length > 0 && <div className="bridge-ai-notes"><strong>Supuestos de la interpretación</strong><ul>{aiSpecification.assumptions.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></div>}
            {aiSpecification.warnings.length > 0 && <div className="bridge-ai-notes"><strong>Advertencias</strong><ul>{aiSpecification.warnings.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul></div>}
            <div className="bridge-ai-components"><strong>Componentes incluidos</strong>{aiSpecification.components.map((component, index) => (
              <label key={`${component.id}-${index}`}><input type="checkbox" checked={component.included} disabled={component.type === 'deck'} onChange={(event) => updateAiSpecification({ components: aiSpecification.components.map((item, itemIndex) => itemIndex === index ? { ...item, included: event.target.checked } : item) })} />{component.type === 'main_girder' ? 'Vigas principales' : component.type === 'cross_beam' ? 'Vigas transversales' : component.type === 'guardrail' ? 'Barandas' : component.type === 'abutment' ? 'Estribos' : component.type === 'support' ? 'Apoyos' : component.type === 'stay_cable' ? 'Cables atirantados' : component.type === 'foundation' ? 'Cimentaciones conceptuales' : component.type === 'deck' ? 'Tablero' : component.type === 'tower' ? 'Torres' : 'Decoración (no disponible)'}</label>
            ))}</div>
            {generationBlockers.length > 0 && (
              <div className="bridge-ai-blockers" role="status">
                <strong>Falta esto para poder generar</strong>
                <ul>{generationBlockers.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
            )}
            <div className="bridge-modal-actions">
              <button type="button" className="bridge-toolbar-button" onClick={() => { setShowAiGenerator(false); setAiSpecification(null); }}>Cancelar</button>
              <button type="button" className="bridge-primary-button" onClick={generateAiBridge} disabled={generationBlockers.length > 0 || aiFlow === 'generating'} title={generationBlockers.length > 0 ? generationBlockers.join(' ') : undefined}>Aprobar y generar puente</button>
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
        <button type="button" onClick={openAiGenerator}><Sparkles size={12} />Asistente local</button>
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
          <div className="bridge-tool-divider" />
          <div className="bridge-tool-section-label">ESTRUCTURA</div>
          <ToolButton icon={<Cuboid size={17} />} label="Viga" onClick={() => addStructuralElement('beam')} />
          <ToolButton icon={<Cuboid size={17} />} label="Columna" onClick={() => addStructuralElement('column')} />
          <ToolButton icon={<Layers size={17} />} label="Placa" onClick={() => addStructuralElement('plate')} />
          <ToolButton icon={<CylinderIcon size={17} />} label="Riostra" onClick={() => addStructuralElement('brace')} />
          <ToolButton icon={<CylinderIcon size={17} />} label="Cable suelto" onClick={() => addStructuralElement('cable')} />
          <ToolButton icon={<Spline size={17} />} label="Cable entre 2 piezas seleccionadas" disabled={selectedObjects.length !== 2} onClick={addCableBetweenSelection} />
          <div className="bridge-tool-divider" />
          <div className="bridge-tool-section-label">EDICIÓN</div>
          <ToolButton icon={<Copy size={17} />} label="Duplicar selección" disabled={!selectedObjects.length} onClick={duplicateSelected} />
          <ToolButton icon={<Layers size={17} />} label="Agrupar selección" disabled={selectedObjects.length < 2} onClick={groupSelected} />
          <ToolButton icon={<X size={17} />} label="Desagrupar selección" disabled={!selectedObjects.some((object) => object.groupId)} onClick={ungroupSelected} />
          <ToolButton icon={<Trash2 size={17} />} label="Eliminar" disabled={!selectedObjects.length} onClick={deleteSelected} />
          <div className="bridge-tool-divider" />
          <button type="button" className="bridge-add-bridge" onClick={openBridgeDialog}><Waves size={16} /><span>Puente nuevo</span></button>
          <button type="button" className="bridge-tool-button" onClick={() => { const sensor = createSensorObject('esp32'); if (document) { commit({ ...document, objects: [...document.objects, sensor] }, 'Dispositivo ESP32 agregado sin conexión física.'); setSelectedIds([sensor.id]); } }}><span className="bridge-iot-icon">ESP</span><span>Agregar ESP32</span></button>
          <button type="button" className="bridge-tool-button" onClick={() => { const sensor = createSensorObject('mpu6050'); if (document) { commit({ ...document, objects: [...document.objects, sensor] }, 'Sensor MPU6050 agregado sin datos conectados.'); setSelectedIds([sensor.id]); setActiveInspector('Sensores'); } }}><span className="bridge-iot-icon">IMU</span><span>Agregar MPU6050</span></button>
          <button type="button" className="bridge-tool-button" onClick={() => importRef.current?.click()}><Upload size={15} /><span>Importar modelo</span></button>
          <button type="button" className="bridge-tool-button" onClick={() => void exportGlb()}><HardDriveDownload size={15} /><span>Exportar GLB</span></button>
          <button type="button" className="bridge-tool-button" disabled={!document.objects.some((object) => object.visible && object.role !== 'iot')} onClick={exportDrawingSvg}><FileText size={15} /><span>Exportar planos SVG</span></button>
          <button type="button" className="bridge-tool-button" disabled={!document.objects.some((object) => object.visible && object.role !== 'iot')} onClick={printDrawingPdf}><Printer size={15} /><span>Imprimir / Guardar PDF</span></button>
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
              <button type="button" title="Seleccionar por ventana" aria-label="Seleccionar por ventana" aria-pressed={boxSelectEnabled} className={boxSelectEnabled ? 'selected' : ''} onClick={() => setBoxSelectEnabled((enabled) => !enabled)}><Box size={14} /></button>
              <button type="button" title="Encuadrar escena" onClick={() => viewportRef.current?.frameAll()}><Camera size={14} /></button>
              <button type="button" title="Mostrar/ocultar cuadrícula" className={gridVisible ? 'selected' : ''} onClick={() => setGridVisible((visible) => !visible)}><Grid2X2 size={14} /></button>
              <button type="button" title={snapEnabled ? 'Desactivar ajuste preciso' : `Ajustar a la cuadrícula (${document.gridSize} ${document.unit}; rotación 15°; escala 0.1)`} aria-label="Ajuste preciso de transformaciones" aria-pressed={snapEnabled} className={snapEnabled ? 'selected' : ''} onClick={() => setSnapEnabled((enabled) => !enabled)}><Magnet size={14} /></button>
              <button type="button" title="Cambiar orientación de los ejes" aria-label="Orientación de los ejes de transformación" aria-pressed={transformSpace === 'local'} className={transformSpace === 'local' ? 'selected' : ''} onClick={() => setTransformSpace((space) => space === 'world' ? 'local' : 'world')}>{transformSpace === 'world' ? 'Global' : 'Local'}</button>
              <button type="button" title="Ver objeto seleccionado (F)" onClick={() => viewportRef.current?.focusSelection()}><Focus size={14} /></button>
            </div>
          </div>
          <div className="bridge-viewport-frame">
            <BridgeViewport
              ref={viewportRef}
              document={document}
              selectedIds={selectedIds}
              tool={tool}
              gridVisible={gridVisible}
              gridSize={document.gridSize}
              snapEnabled={snapEnabled}
              transformSpace={transformSpace}
              boxSelectEnabled={boxSelectEnabled}
              wireframe={wireframe}
              onSelect={(id, additive) => { selectObject(id, additive); if (id) setActiveInspector('Transformar'); }}
              onSelectMany={(ids, additive) => { selectObjects(ids, additive); if (ids.length) setActiveInspector('Transformar'); }}
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
              {document.groups.length > 0 && (
                <div className="bridge-collection">
                  <div className="bridge-collection-heading"><ChevronDown size={13} /><Layers size={13} /><strong>Grupos</strong><small>{document.groups.length}</small></div>
                  {document.groups.map((group) => {
                    const members = document.objects.filter((object) => object.groupId === group.id);
                    return (
                      <div className="bridge-group-tree" key={group.id}>
                        <button type="button" className={`bridge-group-select${members.every(({ id }) => selectedIds.includes(id)) ? ' selected' : ''}`} onClick={() => selectGroup(group.id)}>
                          <Layers size={12} /><span>{group.name}</span><small>{members.length}</small>
                        </button>
                        {members.map((object) => (
                          <ObjectTreeRow key={object.id} object={object} selected={selectedIds.includes(object.id)} onSelect={(event) => { selectObject(object.id, event.shiftKey || event.ctrlKey || event.metaKey); setActiveInspector(object.role === 'iot' ? 'Sensores' : 'Transformar'); }} onVisibility={() => updateObject(object.id, { visible: !object.visible })} onLock={() => updateObject(object.id, { locked: !object.locked })} />
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
              {collections.map((collection) => (
                <div className="bridge-collection" key={collection}>
                  <div className="bridge-collection-heading"><ChevronDown size={13} /><FolderPlus size={13} /><strong>{collection}</strong><small>{document.objects.filter((object) => object.collection === collection && !object.groupId).length}</small></div>
                  {document.objects.filter((object) => object.collection === collection && !object.groupId).map((object) => (
                    <ObjectTreeRow key={object.id} object={object} selected={selectedIds.includes(object.id)} onSelect={(event) => { selectObject(object.id, event.shiftKey || event.ctrlKey || event.metaKey); setActiveInspector(object.role === 'iot' ? 'Sensores' : 'Transformar'); }} onVisibility={() => updateObject(object.id, { visible: !object.visible }, `${object.name}: visibilidad ${object.visible ? 'desactivada' : 'activada'}.`)} onLock={() => updateObject(object.id, { locked: !object.locked }, `${object.name}: bloqueo actualizado.`)} />
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
                <ObjectTreeRow key={object.id} object={object} selected={selectedIds.includes(object.id)} onSelect={(event) => selectObject(object.id, event.shiftKey || event.ctrlKey || event.metaKey)} onVisibility={() => updateObject(object.id, { visible: !object.visible })} onLock={() => updateObject(object.id, { locked: !object.locked })} />
              ))}
              <button type="button" className="bridge-add-collection" onClick={groupSelected} disabled={selectedObjects.length < 2}><Layers size={14} /> Agrupar selección</button>
              <button type="button" className="bridge-add-collection" onClick={ungroupSelected} disabled={!selectedObjects.some((object) => object.groupId)}><X size={14} /> Desagrupar selección</button>
              <button type="button" className="bridge-add-collection" onClick={duplicateSelected} disabled={!selectedObjects.length}><Copy size={14} /> Duplicar selección</button>
              <button type="button" className="bridge-add-collection danger" onClick={deleteSelected} disabled={!selectedObjects.length}><Trash2 size={14} /> Eliminar selección ({selectedObjects.length})</button>
            </div>
          )}

          {(activeInspector === 'Transformar' || activeInspector === 'Material') && (
            <div className="bridge-inspector-content">
              <div className="bridge-panel-title">{activeInspector === 'Transformar' ? 'TRANSFORMACIONES' : 'MATERIAL'}</div>
              {!selected ? <div className="bridge-inspector-empty">Selecciona un objeto en la escena o jerarquía.</div> : selectedObjects.length > 1 ? (
                <MultiTransformPanel
                  key={selectedIds.join(':')}
                  selectedCount={selectedObjects.length}
                  lockedCount={selectedObjects.filter((object) => object.locked).length}
                  onApply={applyMultiTransform}
                />
              ) : (
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
                <button type="button" key={object.id} className={`bridge-sensor-card${object.id === selectedId ? ' selected' : ''}`} onClick={() => selectObject(object.id)}>
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
        <span>{selectedObjects.length > 1 ? `${selectedObjects.length} objetos seleccionados · ${document.unit}` : selected ? `${selected.name} · ${selected.dimensions.map((value) => value.toFixed(2)).join(' × ')} ${document.unit}` : `${document.objects.length} objetos · ${document.unit}`}</span>
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
            <p><strong>Selección múltiple:</strong> usa Shift o Ctrl/Cmd al seleccionar objetos en el viewport o en el árbol. El gizmo transforma juntos los objetos visibles y desbloqueados; Supr elimina la selección.</p>
            <p><strong>Selección por ventana:</strong> activa el icono de selección rectangular en la barra del viewport y arrastra para seleccionar objetos. Shift/Ctrl/Cmd suma el resultado a la selección actual.</p>
            <p><strong>Transformación numérica:</strong> con varios objetos seleccionados puedes aplicar desplazamientos y rotaciones adicionales, y factores de escala por eje desde el inspector. Los objetos bloqueados no cambian.</p>
            <p><strong>Grupos:</strong> selecciona varios objetos y usa “Agrupar selección” para crear un grupo persistente. Al seleccionar un miembro se selecciona todo el grupo; puedes duplicar el conjunto o desagruparlo sin eliminar sus piezas.</p>
            <p><strong>Precisión:</strong> activa el imán en la barra del viewport para mover según la cuadrícula, rotar en incrementos de 15° y escalar en pasos de 0.1.</p>
            <p><strong>Ejes:</strong> Global transforma respecto a la escena; Local transforma siguiendo la orientación del objeto.</p>
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

function MultiTransformPanel({ selectedCount, lockedCount, onApply }: {
  selectedCount: number;
  lockedCount: number;
  onApply: (delta: {
    position: [number, number, number];
    rotationDegrees: [number, number, number];
    scaleFactor: [number, number, number];
  }) => void;
}) {
  const [position, setPosition] = useState<[number, number, number]>([0, 0, 0]);
  const [rotationDegrees, setRotationDegrees] = useState<[number, number, number]>([0, 0, 0]);
  const [scaleFactor, setScaleFactor] = useState<[number, number, number]>([1, 1, 1]);
  const editableCount = selectedCount - lockedCount;

  const fields = (
    label: string,
    values: [number, number, number],
    update: (next: [number, number, number]) => void,
    step: number,
    min?: number,
  ) => (
    <fieldset className="bridge-vector-fields">
      <legend>{label}</legend>
      {values.map((value, index) => (
        <label key={index}><span>{['X', 'Y', 'Z'][index]}</span><input type="number" step={step} min={min} value={value} onChange={(event) => {
          const next = [...values] as [number, number, number];
          next[index] = Number(event.target.value);
          update(next);
        }} /></label>
      ))}
    </fieldset>
  );

  return (
    <div className="bridge-multi-transform">
      <p>{selectedCount} objetos seleccionados. Se aplicarán cambios relativos a los objetos desbloqueados.</p>
      {lockedCount > 0 && <p className="bridge-info-note">{lockedCount} objetos bloqueados no se modificarán.</p>}
      {fields('Desplazamiento', position, setPosition, 0.1)}
      {fields('Rotación adicional (°)', rotationDegrees, setRotationDegrees, 1)}
      {fields('Factor de escala', scaleFactor, setScaleFactor, 0.1, 0.001)}
      <button type="button" className="bridge-add-collection" disabled={!editableCount} onClick={() => onApply({ position, rotationDegrees, scaleFactor })}>
        Aplicar a {editableCount} objetos
      </button>
      <p className="bridge-info-note">El desplazamiento y la rotación se suman a cada objeto; el factor escala sus dimensiones respecto a su propio origen. Usa 1 para conservar un eje sin cambios.</p>
    </div>
  );
}

function ObjectTreeRow({ object, selected, onSelect, onVisibility, onLock }: {
  object: BridgeObject;
  selected: boolean;
  onSelect: (event: MouseEvent<HTMLButtonElement>) => void;
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

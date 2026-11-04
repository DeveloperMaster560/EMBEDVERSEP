import type { EmbeddedProject } from '../domain/types';

const databaseName = 'embedverse-studio';
const storeName = 'projects';
let databasePromise: Promise<IDBDatabase> | undefined;

function cloneArrayBuffer(buffer: ArrayBuffer): ArrayBuffer {
  return new Uint8Array(buffer).slice().buffer;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function cloneDigitalTwinAssets(assets?: NonNullable<EmbeddedProject['digitalTwin']>['assets']) {
  return assets?.map((asset) => ({
    ...asset,
    data: cloneArrayBuffer(asset.data),
  }));
}

function cloneElectronicLab(circuit: EmbeddedProject['electronicLab']) {
  if (!circuit) return undefined;
  const componentMap = new Map<string, string>();
  const components = circuit.components.map((component) => {
    const nextId = crypto.randomUUID();
    componentMap.set(component.id, nextId);
    return { ...component, id: nextId };
  });
  return {
    ...circuit,
    components,
    connections: circuit.connections.map((connection) => ({
      ...connection,
      from: componentMap.get(connection.from) ?? connection.from,
      to: componentMap.get(connection.to) ?? connection.to,
    })),
  };
}

function normalizeImportedProject(project: EmbeddedProject): EmbeddedProject {
  return {
    ...project,
    files: project.files.map((file) => ({ ...file })),
    digitalTwin: project.digitalTwin
      ? {
          ...project.digitalTwin,
          assets: project.digitalTwin.assets?.map((asset) => ({
            ...asset,
            data: typeof asset.data === 'string' ? base64ToArrayBuffer(asset.data) : cloneArrayBuffer(asset.data),
          })),
        }
      : undefined,
    electronicLab: project.electronicLab ? cloneElectronicLab(project.electronicLab) : undefined,
  };
}

export function duplicateProject(project: EmbeddedProject): EmbeddedProject {
  const fileMap = new Map<string, string>();
  const files = project.files.map((file) => {
    const nextId = crypto.randomUUID();
    fileMap.set(file.id, nextId);
    return { ...file, id: nextId };
  });
  const now = new Date().toISOString();
  const nextProject: EmbeddedProject = {
    ...project,
    id: crypto.randomUUID(),
    name: project.name.endsWith('copia') ? project.name : `${project.name} copia`,
    files,
    activeFileId: fileMap.get(project.activeFileId) ?? files[0]?.id ?? crypto.randomUUID(),
    digitalTwin: project.digitalTwin
      ? {
          ...project.digitalTwin,
          assets: cloneDigitalTwinAssets(project.digitalTwin.assets),
        }
      : undefined,
    electronicLab: cloneElectronicLab(project.electronicLab),
    createdAt: now,
    updatedAt: now,
  };
  return normalizeImportedProject(nextProject);
}

export function exportProject(project: EmbeddedProject): string {
  return JSON.stringify(
    {
      ...project,
      digitalTwin: project.digitalTwin
        ? {
            ...project.digitalTwin,
            assets: project.digitalTwin.assets?.map((asset) => ({
              ...asset,
              data: arrayBufferToBase64(asset.data),
            })),
          }
        : undefined,
    },
    null,
    2,
  );
}

export function importProjectFromJson(serialized: string): EmbeddedProject {
  const parsed = JSON.parse(serialized) as EmbeddedProject;
  return normalizeImportedProject(parsed);
}

function openDatabase(): Promise<IDBDatabase> {
  if (!('indexedDB' in window)) {
    return Promise.reject(new Error('Este navegador no ofrece almacenamiento IndexedDB.'));
  }

  if (!databasePromise) {
    const pending = new Promise<IDBDatabase>((resolve, reject) => {
      const request = window.indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(storeName)) {
          database.createObjectStore(storeName, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('No se pudo abrir la base local.'));
      request.onblocked = () => reject(new Error('La base local está bloqueada por otra ventana.'));
    }).catch((error: unknown) => {
      databasePromise = undefined;
      throw error;
    });
    databasePromise = pending;
    return pending;
  }

  const pending = databasePromise;
  if (!pending) return Promise.reject(new Error('No se pudo inicializar la base local.'));
  return pending;
}

function runRequest<T>(operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDatabase().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        const transaction = database.transaction(storeName, 'readonly');
        const request = operation(transaction.objectStore(storeName));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Falló la operación de almacenamiento.'));
        transaction.onabort = () => reject(transaction.error ?? new Error('Se canceló la operación local.'));
      }),
  );
}

export async function listProjects(): Promise<EmbeddedProject[]> {
  const projects = await runRequest<EmbeddedProject[]>((store) => store.getAll());
  return projects.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function saveProject(project: EmbeddedProject): Promise<void> {
  return openDatabase().then(
    (database) =>
      new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(storeName, 'readwrite');
        transaction.objectStore(storeName).put(project);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('No se pudo guardar el proyecto.'));
        transaction.onabort = () => reject(transaction.error ?? new Error('Se canceló el guardado.'));
      }),
  );
}

export function deleteProject(id: string): Promise<void> {
  return openDatabase().then(
    (database) =>
      new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(storeName, 'readwrite');
        transaction.objectStore(storeName).delete(id);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('No se pudo eliminar el proyecto.'));
        transaction.onabort = () => reject(transaction.error ?? new Error('Se canceló la eliminación.'));
      }),
  );
}

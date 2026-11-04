import type { BridgeSceneDocument } from './types';

const databaseName = 'embedverse-bridge-designer';
const storeName = 'scenes';
let databasePromise: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  if (!('indexedDB' in window)) return Promise.reject(new Error('Este navegador no ofrece almacenamiento IndexedDB.'));
  if (!databasePromise) {
    databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = window.indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(storeName)) {
          request.result.createObjectStore(storeName, { keyPath: 'projectId' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('No se pudo abrir la base del Bridge Designer.'));
      request.onblocked = () => reject(new Error('La base del Bridge Designer está bloqueada por otra ventana.'));
    }).catch((error: unknown) => {
      databasePromise = undefined;
      throw error;
    });
  }
  return databasePromise;
}

export async function loadBridgeScene(projectId: string): Promise<BridgeSceneDocument | undefined> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(storeName, 'readonly').objectStore(storeName).get(projectId);
    request.onsuccess = () => resolve(request.result as BridgeSceneDocument | undefined);
    request.onerror = () => reject(request.error ?? new Error('No se pudo cargar la escena.'));
  });
}

export async function saveBridgeScene(scene: BridgeSceneDocument): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).put(scene);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('No se pudo guardar la escena.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Se canceló el guardado de la escena.'));
  });
}

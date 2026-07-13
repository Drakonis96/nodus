export interface StudyDictationClip {
  id: string;
  documentId: string;
  createdAt: string;
  mimeType: string;
  provider: 'local' | 'openai';
  model: string;
  transcript: string;
  anchorText: string;
  anchorFrom: number | null;
  anchorTo: number | null;
  blob: Blob;
}

const DB_NAME = 'nodus-study-dictation';
const STORE = 'clips';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('documentId', 'documentId');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open dictation storage'));
  });
}

function transact<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason?: unknown) => void) => void): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    operation(transaction.objectStore(STORE), resolve, reject);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => reject(transaction.error);
  }));
}

export function saveStudyDictationClip(clip: StudyDictationClip): Promise<void> {
  return transact<void>('readwrite', (store, resolve, reject) => {
    const request = store.put(clip);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export function listStudyDictationClips(documentId: string): Promise<StudyDictationClip[]> {
  return transact<StudyDictationClip[]>('readonly', (store, resolve, reject) => {
    const request = store.index('documentId').getAll(documentId);
    request.onsuccess = () => resolve((request.result as StudyDictationClip[]).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    request.onerror = () => reject(request.error);
  });
}

export function deleteStudyDictationClip(id: string): Promise<void> {
  return transact<void>('readwrite', (store, resolve, reject) => {
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

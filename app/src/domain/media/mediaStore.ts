/* ─── Media Binary Storage Engine (IndexedDB + Fallback) ─────────────
   Local-first binary persistence for user-imported photos, videos, and audio.
   Keeps .wayvora.json project files lightweight by storing heavy blobs in
   browser IndexedDB, with an in-memory Map fallback for tests and Node environments.
   ─────────────────────────────────────────────────────────────────── */

const DB_NAME = 'wayvora_media_store_v1';
const STORE_NAME = 'media_blobs';
const DB_VERSION = 1;

export interface MediaBlobStore {
  saveBlob(key: string, blob: Blob | ArrayBuffer): Promise<void>;
  getBlob(key: string): Promise<Blob | null>;
  deleteBlob(key: string): Promise<void>;
  hasBlob(key: string): Promise<boolean>;
  listKeys(): Promise<string[]>;
  clear(): Promise<void>;
}

/**
 * In-memory fallback for Node.js / Vitest or environments without indexedDB.
 */
class MemoryBlobStore implements MediaBlobStore {
  private map = new Map<string, Blob>();

  async saveBlob(key: string, blob: Blob | ArrayBuffer): Promise<void> {
    const b = blob instanceof Blob ? blob : new Blob([blob]);
    this.map.set(key, b);
  }

  async getBlob(key: string): Promise<Blob | null> {
    return this.map.get(key) ?? null;
  }

  async deleteBlob(key: string): Promise<void> {
    this.map.delete(key);
  }

  async hasBlob(key: string): Promise<boolean> {
    return this.map.has(key);
  }

  async listKeys(): Promise<string[]> {
    return Array.from(this.map.keys());
  }

  async clear(): Promise<void> {
    this.map.clear();
  }
}

/**
 * IndexedDB storage engine.
 */
class IndexedDbBlobStore implements MediaBlobStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private getDb(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      if (typeof window === 'undefined' || !window.indexedDB) {
        return reject(new Error('IndexedDB is not available in this environment'));
      }

      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        this.dbPromise = null;
        reject(request.error || new Error('Failed to open IndexedDB database'));
      };
    });

    return this.dbPromise;
  }

  async saveBlob(key: string, blob: Blob | ArrayBuffer): Promise<void> {
    const db = await this.getDb();
    const finalBlob = blob instanceof Blob ? blob : new Blob([blob]);

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(finalBlob, key);

      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error || new Error(`Failed to save blob for key "${key}"`));
    });
  }

  async getBlob(key: string): Promise<Blob | null> {
    const db = await this.getDb();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);

      req.onsuccess = () => {
        const res = req.result;
        if (!res) {
          resolve(null);
        } else if (res instanceof Blob) {
          resolve(res);
        } else if (res instanceof ArrayBuffer) {
          resolve(new Blob([res]));
        } else {
          resolve(null);
        }
      };

      req.onerror = () => reject(req.error || new Error(`Failed to get blob for key "${key}"`));
    });
  }

  async deleteBlob(key: string): Promise<void> {
    const db = await this.getDb();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(key);

      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error || new Error(`Failed to delete blob for key "${key}"`));
    });
  }

  async hasBlob(key: string): Promise<boolean> {
    const blob = await this.getBlob(key);
    return blob !== null;
  }

  async listKeys(): Promise<string[]> {
    const db = await this.getDb();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAllKeys();

      req.onsuccess = () => {
        resolve((req.result as string[]) || []);
      };

      req.onerror = () => reject(req.error || new Error('Failed to list keys'));
    });
  }

  async clear(): Promise<void> {
    const db = await this.getDb();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.clear();

      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error || new Error('Failed to clear media store'));
    });
  }
}

// Select appropriate store based on browser environment capabilities
let defaultStore: MediaBlobStore | null = null;

export function getMediaBlobStore(): MediaBlobStore {
  if (defaultStore) return defaultStore;

  if (typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined') {
    defaultStore = new IndexedDbBlobStore();
  } else {
    defaultStore = new MemoryBlobStore();
  }
  return defaultStore;
}

/**
 * Convenience functions
 */
export async function saveMediaBlob(key: string, blob: Blob | ArrayBuffer): Promise<void> {
  return getMediaBlobStore().saveBlob(key, blob);
}

export async function getMediaBlob(key: string): Promise<Blob | null> {
  return getMediaBlobStore().getBlob(key);
}

export async function deleteMediaBlob(key: string): Promise<void> {
  return getMediaBlobStore().deleteBlob(key);
}

export async function hasMediaBlob(key: string): Promise<boolean> {
  return getMediaBlobStore().hasBlob(key);
}

export async function clearMediaBlobStore(): Promise<void> {
  return getMediaBlobStore().clear();
}

export function setCustomMediaBlobStore(store: MediaBlobStore | null): void {
  defaultStore = store;
}

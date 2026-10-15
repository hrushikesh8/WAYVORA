/* ─── Atomic Project Auto-Save & Crash Recovery ────────────────────
   Provides safe, debounced, and atomic localStorage persistence
   to prevent data loss across page reloads, crashes, or closures.
   Includes in-memory fallback for non-browser/test environments.
   ─────────────────────────────────────────────────────────────────── */

import type { Journey } from './types';
import { serializeProject, deserializeProject } from './serialization';

const STORAGE_KEY = 'wayvora_active_project_v1';
const STORAGE_TEMP_KEY = 'wayvora_active_project_v1_tmp';

export interface StoredProjectMetadata {
  name: string;
  updatedAt: string;
  sizeBytes: number;
}

export interface StorageProvider {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

class MemoryStorage implements StorageProvider {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  clear(): void {
    this.map.clear();
  }
}

const fallbackStorage = new MemoryStorage();

export function getStorageProvider(): StorageProvider {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const testKey = '__wayvora_test__';
      window.localStorage.setItem(testKey, '1');
      window.localStorage.removeItem(testKey);
      return window.localStorage;
    } catch {
      return fallbackStorage;
    }
  }
  return fallbackStorage;
}

/**
 * Atomically saves a journey to storage.
 * Uses a staged two-step write to protect against interrupted saves.
 */
export function saveProjectToStorage(journey: Journey): boolean {
  const storage = getStorageProvider();
  try {
    const serialized = serializeProject(journey);
    // 1. Write to temporary staging key
    storage.setItem(STORAGE_TEMP_KEY, serialized);
    // 2. Commit to primary key
    storage.setItem(STORAGE_KEY, serialized);
    // 3. Remove staging key
    storage.removeItem(STORAGE_TEMP_KEY);
    return true;
  } catch (err) {
    // QuotaExceededError or security policy rejection in restricted sandboxes
    console.warn('[WAYVORA Storage] Auto-save skipped:', err);
    return false;
  }
}

/**
 * Loads the active journey from storage with automatic crash recovery.
 * Recovers from temp key if primary key was interrupted mid-write.
 */
export function loadProjectFromStorage(): Journey | null {
  const storage = getStorageProvider();

  // Try primary key first
  const primaryJson = storage.getItem(STORAGE_KEY);
  if (primaryJson) {
    try {
      return deserializeProject(primaryJson);
    } catch (err) {
      console.warn('[WAYVORA Storage] Primary project corrupted, attempting temp recovery:', err);
    }
  }

  // Fallback to temp recovery key if primary was interrupted
  const tempJson = storage.getItem(STORAGE_TEMP_KEY);
  if (tempJson) {
    try {
      const recovered = deserializeProject(tempJson);
      // Promote temp to primary
      storage.setItem(STORAGE_KEY, tempJson);
      storage.removeItem(STORAGE_TEMP_KEY);
      return recovered;
    } catch {
      // Both corrupted, ignore
    }
  }

  return null;
}

/**
 * Checks whether an auto-saved project is stored.
 */
export function hasStoredProject(): boolean {
  const storage = getStorageProvider();
  return Boolean(
    storage.getItem(STORAGE_KEY) ||
    storage.getItem(STORAGE_TEMP_KEY)
  );
}

/**
 * Inspects metadata of the stored project without deserializing the entire model.
 */
export function getStoredProjectMetadata(): StoredProjectMetadata | null {
  const storage = getStorageProvider();
  const json = storage.getItem(STORAGE_KEY) || storage.getItem(STORAGE_TEMP_KEY);
  if (!json) return null;

  try {
    const parsed = JSON.parse(json);
    const j = parsed?.journey;
    if (j && typeof j.name === 'string') {
      return {
        name: j.name,
        updatedAt: j.updatedAt || new Date().toISOString(),
        sizeBytes: json.length,
      };
    }
  } catch {
    // Ignore invalid JSON
  }
  return null;
}

/**
 * Clears auto-saved project data from storage.
 */
export function clearProjectStorage(): void {
  const storage = getStorageProvider();
  try {
    storage.removeItem(STORAGE_KEY);
    storage.removeItem(STORAGE_TEMP_KEY);
  } catch {
    // Ignore
  }
}

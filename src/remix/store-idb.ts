// Remix storage in the visitor's browser (IndexedDB). Each visitor's remixes, ratings and stats stay on
// their device; Export/Import moves them around as single .vgremix.json files.
import type { RemixMeta, RemixStore, Transcript } from './types';

const DB = 'vg-remix', VERSION = 1;
let dbp: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  return (dbp ??= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, VERSION);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('meta', { keyPath: 'id' });
      r.result.createObjectStore('files'); // key: `${id}/${name}`
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB unavailable (private window?)'));
  }));
}

async function tx<T>(store: 'meta' | 'files', mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req ? req.result : (undefined as T));
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const getFile = (key: string) => tx<any>('files', 'readonly', (s) => s.get(key)).then((v) => v ?? null);
const putFile = (key: string, v: unknown) => tx('files', 'readwrite', (s) => { s.put(v, key); }).then(() => {});

export const idbStore: RemixStore = {
  saveMeta: (m: RemixMeta) => tx('meta', 'readwrite', (s) => { s.put(structuredClone(m)); }).then(() => {}),
  loadMeta: (id) => tx<RemixMeta | undefined>('meta', 'readonly', (s) => s.get(id)).then((m) => m ?? null),
  list: () => tx<RemixMeta[]>('meta', 'readonly', (s) => s.getAll()).then((all) => all.sort((x, y) => y.createdAt.localeCompare(x.createdAt))),
  saveSource: (id, code) => putFile(`${id}/game.js`, code),
  loadSource: (id) => getFile(`${id}/game.js`),
  archiveSource: (id, v, code) => putFile(`${id}/game.v${v}.js`, code),
  loadArchivedSource: (id, v) => getFile(`${id}/game.v${v}.js`),
  saveTranscript: (id, t: Transcript) => putFile(`${id}/transcript`, structuredClone(t)),
  loadTranscript: (id) => getFile(`${id}/transcript`),
  async delete(id) {
    await tx('meta', 'readwrite', (s) => { s.delete(id); });
    await tx('files', 'readwrite', (s) => { s.delete(IDBKeyRange.bound(`${id}/`, `${id}/￿`)); });
  },
};

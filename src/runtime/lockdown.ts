// Cartridges (especially AI-written ones) run in workers with no business touching the network or storage.
// A worker can't see the page's API keys anyway; this removes its ways to phone home as defense in depth.
// Call it before importing any cartridge code.
export function lockdownWorker() {
  const g = self as unknown as Record<string, unknown>;
  for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'WebSocketStream', 'EventSource', 'WebTransport', 'importScripts',
    'indexedDB', 'caches', 'BroadcastChannel', 'Worker', 'SharedWorker', 'navigator']) {
    try { Object.defineProperty(g, name, { value: undefined, configurable: false, writable: false }); } catch { /* not present */ }
  }
}

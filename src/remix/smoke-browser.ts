// Browser boot test: run the cartridge in a fresh sandboxed worker and terminate it if it hangs.
import type { SmokeResult } from './types';

export function smokeTestInBrowser(source: string, { frames = 3600, seed = 1234, timeoutMs = 20000 } = {}): Promise<SmokeResult> {
  return new Promise((resolve) => {
    const w = new Worker(new URL('./smoke-worker.ts', import.meta.url), { type: 'module' });
    const timer = setTimeout(() => {
      w.terminate();
      resolve({ ok: false, phase: 'timeout', error: `Timed out after ${timeoutMs}ms (infinite loop or far too slow)` });
    }, timeoutMs);
    const done = (r: SmokeResult) => { clearTimeout(timer); w.terminate(); resolve(r); };
    w.onmessage = (e) => done(e.data as SmokeResult);
    w.onerror = (e) => { e.preventDefault(); done({ ok: false, phase: 'crash', error: e.message || 'Boot test worker crashed' }); };
    w.postMessage({ source, frames, seed });
  });
}

// Browser boot test: run the cartridge in a fresh sandboxed worker and terminate it if it hangs.
import type { SmokeResult } from './types';

/** The boot test itself couldn't start (e.g. the worker script failed to load): not the cartridge's fault. */
export const INFRA_PHASE = 'infra';

export function smokeTestInBrowser(source: string, { frames = 3600, seed = 1234, timeoutMs = 20000 } = {}): Promise<SmokeResult> {
  return new Promise((resolve) => {
    const w = new Worker(new URL('./smoke-worker.ts', import.meta.url), { type: 'module' });
    let alive = false;
    const timer = setTimeout(() => {
      w.terminate();
      resolve(alive
        ? { ok: false, phase: 'timeout', error: `Timed out after ${timeoutMs}ms (infinite loop or far too slow)` }
        : { ok: false, phase: INFRA_PHASE, error: 'The boot test sandbox never started.' });
    }, timeoutMs);
    const done = (r: SmokeResult) => { clearTimeout(timer); w.terminate(); resolve(r); };
    w.onmessage = (e) => { if (e.data?.alive) alive = true; else done(e.data as SmokeResult); };
    w.onerror = (e) => {
      e.preventDefault();
      if (!alive) done({ ok: false, phase: INFRA_PHASE, error: 'The boot test sandbox failed to load (is the page out of date, or did the dev server stop?).' });
      // A message-less crash after startup usually means the cartridge exhausted memory (e.g. a loop that keeps allocating).
      else done({ ok: false, phase: 'crash', error: e.message || 'The cartridge crashed its sandbox without an error message, which usually means it ran out of memory (for example a loop that keeps growing an array) or recursed without end.' });
    };
    w.postMessage({ source, frames, seed });
  });
}

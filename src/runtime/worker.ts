// Web Worker that hosts one cartridge. The main thread sends ticks; we run fixed 60 Hz steps,
// draw into an OffscreenCanvas, and post the frame back as an ImageBitmap.
// @ts-ignore - plain JS module shared with the Node smoke tester
import { createCart, W, H } from './core.js';
import { lockdownWorker } from './lockdown';

type Msg =
  | { type: 'load'; source: string; storage: Record<string, unknown> }
  | { type: 'tick'; steps: number; held: Record<string, boolean>; tapped: Record<string, boolean> };

const canvas = new OffscreenCanvas(W, H);
const g = canvas.getContext('2d')!;
g.imageSmoothingEnabled = false;
let cart: any = null;
let dead = false;

function fail(phase: string, e: unknown) {
  dead = true;
  const err = e as Error;
  postMessage({ type: 'error', phase, message: String(err?.message ?? e), stack: String(err?.stack ?? '') });
}

self.addEventListener('error', (ev) => fail('runtime', (ev as ErrorEvent).error ?? (ev as ErrorEvent).message));
self.addEventListener('unhandledrejection', (ev) => fail('runtime', (ev as PromiseRejectionEvent).reason));

self.onmessage = async (ev: MessageEvent<Msg>) => {
  const m = ev.data;
  if (m.type === 'load') {
    let mod: unknown;
    try {
      const url = URL.createObjectURL(new Blob([m.source], { type: 'text/javascript' }));
      lockdownWorker();
      mod = await import(/* @vite-ignore */ url);
      URL.revokeObjectURL(url);
    } catch (e) { return fail('import', e); }
    try {
      cart = createCart(mod, {
        getCtx: () => g,
        sound: (s: object) => postMessage({ type: 'sound', ...s }),
        storage: m.storage,
        persist: (data: object) => postMessage({ type: 'persist', data }),
        log: (...a: unknown[]) => postMessage({ type: 'log', args: a.map(String) }),
      });
    } catch (e) { return fail('boot', e); }
    postMessage({ type: 'ready' });
  } else if (m.type === 'tick') {
    if (!cart || dead) return;
    let phase = 'update';
    try {
      for (let i = 0; i < m.steps; i++) cart.step(m.held, m.tapped, i === 0);
      phase = 'draw';
      g.imageSmoothingEnabled = false;
      cart.draw(g);
    } catch (e) { return fail(phase, e); }
    const bitmap = canvas.transferToImageBitmap();
    (postMessage as (msg: unknown, t: Transferable[]) => void)({ type: 'frame', bitmap }, [bitmap]);
  }
};

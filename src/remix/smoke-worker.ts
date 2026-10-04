// Throwaway worker that boot-tests one cartridge source against a real OffscreenCanvas, then reports.
// The page kills it on timeout, which catches infinite loops.
// @ts-ignore - plain JS module shared with the Node smoke tester
import { runSmoke } from '../runtime/smoke-harness.js';
import { lockdownWorker } from '../runtime/lockdown';

self.onmessage = async (ev: MessageEvent<{ source: string; frames: number; seed: number }>) => {
  const { source, frames, seed } = ev.data;
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  lockdownWorker();
  const report = await runSmoke(() => import(/* @vite-ignore */ url), {
    frames, seed,
    getCtx: () => {
      const g = new OffscreenCanvas(320, 240).getContext('2d')!;
      g.imageSmoothingEnabled = false;
      return g;
    },
  });
  postMessage(report);
};

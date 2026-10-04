// Grabs a cartridge's title screen as an image: boots it in a throwaway worker (no sound, no saves),
// runs it for a moment with no input, and returns one frame. Used by the DIGI-FUZE fusion screen.
// The frame is copied into a plain canvas right away: a bitmap transferred from a worker can go blank
// once another capture runs (seen when capturing two cartridges back to back).
export function captureTitle(source: string, steps = 90, timeoutMs = 2500): Promise<HTMLCanvasElement | null> {
  return new Promise((resolve) => {
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    const done = (c: HTMLCanvasElement | null) => { clearTimeout(timer); w.terminate(); resolve(c); };
    const timer = setTimeout(() => done(null), timeoutMs);
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'ready') w.postMessage({ type: 'tick', steps, held: {}, tapped: {} });
      else if (m.type === 'frame') {
        const bmp = m.bitmap as ImageBitmap;
        const c = Object.assign(document.createElement('canvas'), { width: bmp.width, height: bmp.height });
        c.getContext('2d')!.drawImage(bmp, 0, 0);
        bmp.close();
        done(c);
      } else if (m.type === 'error') done(null);
    };
    w.onerror = (e) => { e.preventDefault(); done(null); };
    w.postMessage({ type: 'load', source, storage: {} });
  });
}

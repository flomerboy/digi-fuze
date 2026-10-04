// Main-thread side of the cartridge runtime: owns the worker, paces ticks at 60 Hz,
// receives frames, plays sounds, persists save data, and detects crashes/hangs.
import { Synth } from './synth';
import { Input } from './input';

export type CartError = { phase: string; message: string; stack?: string };

export interface HostEvents {
  onFrame(bitmap: ImageBitmap): void;
  onError(err: CartError): void;
  onReady?(): void;
  onLog?(line: string): void;
  /** The cartridge saved data (api.storage.set). Staged remixes watch `best` to know level 1 was cleared. */
  onPersist?(data: Record<string, unknown>): void;
}

const STEP = 1000 / 60;
const HANG_MS = 3000;

export class CartHost {
  private worker: Worker | null = null;
  private acc = 0;
  private last = 0;
  private waiting = false;
  private waitStart = 0;
  private raf = 0;
  private saveKey = '';
  running = false;

  constructor(private synth: Synth, private input: Input, private ev: HostEvents) {}

  load(source: string, saveKey: string) {
    this.stop();
    this.saveKey = saveKey;
    let storage = {};
    try { storage = JSON.parse(localStorage.getItem(saveKey) || '{}'); } catch { /* fresh save */ }
    const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker = w;
    w.onmessage = (e) => this.onMessage(e.data);
    w.onerror = (e) => this.crash({ phase: 'worker', message: e.message || 'Worker error' });
    w.postMessage({ type: 'load', source, storage });
    this.running = true;
    this.ready = false;
    this.waiting = true; // until 'ready' (catches a boot() that never returns)
    this.waitStart = performance.now();
    this.acc = 0;
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      this.tick(now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.worker?.terminate();
    this.worker = null;
    this.synth.stopAll();
  }

  private ready = false;

  private tick(now: number) {
    const dt = Math.min(now - this.last, 250);
    this.last = now;
    if (this.waiting) {
      if (now - this.waitStart > HANG_MS) this.crash({ phase: 'hang', message: `Cartridge stopped responding for ${HANG_MS / 1000}s (infinite loop?)` });
      return;
    }
    if (!this.ready) return;
    this.acc += dt;
    let steps = Math.floor(this.acc / STEP);
    if (steps <= 0) return;
    this.acc -= steps * STEP;
    steps = Math.min(steps, 4);
    this.waiting = true;
    this.waitStart = now;
    const tapped = this.input.enabled ? this.input.takeTapped() : {};
    const held = this.input.enabled ? { ...this.input.held } : {};
    this.worker?.postMessage({ type: 'tick', steps, held, tapped });
  }

  private onMessage(m: any) {
    switch (m.type) {
      case 'ready':
        this.ready = true;
        this.waiting = false;
        this.last = performance.now();
        this.ev.onReady?.();
        break;
      case 'frame':
        this.waiting = false;
        this.ev.onFrame(m.bitmap);
        break;
      case 'sound':
        this.synth.play(m);
        break;
      case 'persist':
        try { localStorage.setItem(this.saveKey, JSON.stringify(m.data)); } catch { /* quota */ }
        this.ev.onPersist?.(m.data);
        break;
      case 'log':
        console.log('[cart]', ...m.args);
        this.ev.onLog?.(m.args.join(' '));
        break;
      case 'error':
        this.crash(m);
        break;
    }
  }

  private crash(err: CartError) {
    if (!this.running) return;
    this.stop();
    this.ready = false;
    this.ev.onError(err);
  }
}

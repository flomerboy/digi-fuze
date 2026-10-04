// Runs inside a locked-down child process (see smoke.mjs). Loads a cartridge file, drives it with
// scripted + random input against a mock canvas context, and prints a JSON report on stdout.
import { pathToFileURL } from 'node:url';
import { runSmoke } from '../src/runtime/smoke-harness.js';

const [file, framesArg, seedArg] = process.argv.slice(2);

function mockCtx(w = 320, h = 240) {
  const canvas = { width: w, height: h };
  const grad = { addColorStop() {} };
  const special = {
    canvas,
    measureText: (s) => ({ width: String(s).length * 6, actualBoundingBoxAscent: 7, actualBoundingBoxDescent: 1 }),
    createLinearGradient: () => grad,
    createRadialGradient: () => grad,
    createConicGradient: () => grad,
    createPattern: () => ({ setTransform() {} }),
    getImageData: (x, y, iw, ih) => ({ width: iw, height: ih, data: new Uint8ClampedArray(Math.max(0, iw * ih * 4)) }),
    createImageData: (iw, ih) => (typeof iw === 'object'
      ? { width: iw.width, height: iw.height, data: new Uint8ClampedArray(iw.width * iw.height * 4) }
      : { width: iw, height: ih, data: new Uint8ClampedArray(iw * ih * 4) }),
    isPointInPath: () => false,
    isPointInStroke: () => false,
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    getLineDash: () => [],
  };
  const store = {};
  return new Proxy({}, {
    get(_, k) {
      if (k in special) return special[k];
      if (k in store) return store[k];
      return () => {};
    },
    set(_, k, v) { store[k] = v; return true; },
  });
}

globalThis.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; } getContext() { return mockCtx(this.width, this.height); } transferToImageBitmap() { return {}; } };
globalThis.Path2D = class { constructor() {} addPath() {} closePath() {} moveTo() {} lineTo() {} arc() {} arcTo() {} rect() {} roundRect() {} ellipse() {} bezierCurveTo() {} quadraticCurveTo() {} };
globalThis.ImageData = class { constructor(a, b, c) { if (a instanceof Uint8ClampedArray) { this.data = a; this.width = b; this.height = c ?? a.length / 4 / b; } else { this.width = a; this.height = b; this.data = new Uint8ClampedArray(a * b * 4); } } };

const report = await runSmoke(() => import(pathToFileURL(file).href), {
  frames: Number(framesArg) || 3600,
  seed: Number(seedArg) || 1234,
  getCtx: () => mockCtx(),
});
process.stdout.write(JSON.stringify(report) + '\n');

// The boot test: drive a cartridge module for N frames with scripted + random input and report whether it
// survived. Shared by the Node child process (tools/smoke-child.mjs, mock canvas) and the browser's
// sandboxed worker (src/remix/smoke-worker.ts, real OffscreenCanvas).
import { createCart, BUTTONS } from './core.js';

/**
 * @param {() => Promise<any>} importModule  imports the cartridge module
 * @param {{ frames?: number, seed?: number, getCtx: () => any }} opts
 */
export async function runSmoke(importModule, { frames = 3600, seed = 1234, getCtx }) {
  let s = seed;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const report = { ok: false, frames: 0, error: null, phase: 'import', avgMs: 0, maxMs: 0, sounds: 0, logs: [] };
  try {
    const mod = await importModule();
    report.phase = 'boot';
    const g = getCtx();
    const cart = createCart(mod, {
      getCtx: () => g,
      sound: () => { report.sounds++; },
      storage: {},
      persist: () => {},
      log: (...a) => { if (report.logs.length < 20) report.logs.push(a.map(String).join(' ')); },
    });
    report.phase = 'run';
    const held = Object.fromEntries(BUTTONS.map((b) => [b, false]));
    const holdUntil = {};
    let total = 0;
    for (let f = 0; f < frames; f++) {
      // Script: tap START early to leave the title screen, tap A, then mostly random play.
      const tapped = {};
      if (f === 30 || f === 90 || f === 150) tapped.start = true;
      if (f === 60 || f === 120) tapped.a = true;
      for (const b of BUTTONS) {
        if (b === 'start' || b === 'select') { held[b] = false; continue; }
        if ((holdUntil[b] || 0) <= f) {
          held[b] = rand() < 0.25;
          holdUntil[b] = f + 4 + Math.floor(rand() * 40);
        }
      }
      if (f > 200 && f % 600 === 0) tapped.start = true; // occasional pause/unpause pair
      if (f > 200 && f % 600 === 40) tapped.start = true;
      if (f > 200 && f % 900 === 0) tapped.select = true;
      const t0 = performance.now();
      report.phase = 'update';
      cart.step(held, tapped, true);
      report.phase = 'draw';
      cart.draw(g);
      const dt = performance.now() - t0;
      total += dt;
      if (dt > report.maxMs) report.maxMs = dt;
      report.frames = f + 1;
    }
    report.avgMs = +(total / frames).toFixed(3);
    report.maxMs = +report.maxMs.toFixed(3);
    report.ok = true;
    report.phase = 'done';
  } catch (e) {
    report.error = (e && e.stack) ? String(e.stack).split('\n').slice(0, 6).join('\n') : String(e);
  }
  return report;
}

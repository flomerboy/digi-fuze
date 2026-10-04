// Cartridge runtime core: shared by the browser worker and the Node smoke tester.
// Builds the `api` object a cartridge receives and drives fixed-step updates.
import { FONT_CHARS, GLYPH_W, GLYPH_H, ADVANCE, glyph, glyphIndex } from './font.js';

export const W = 320;
export const H = 240;
export const BUTTONS = ['up', 'down', 'left', 'right', 'a', 'b', 'start', 'select'];

export function makeTextRenderer(getCtx) {
  const atlases = new Map(); // color -> OffscreenCanvas of all glyphs in that color
  const canAtlas = typeof OffscreenCanvas !== 'undefined';

  function atlasFor(color) {
    let a = atlases.get(color);
    if (a) return a;
    a = new OffscreenCanvas(FONT_CHARS.length * GLYPH_W, GLYPH_H);
    const c = a.getContext('2d');
    c.fillStyle = color;
    for (let i = 0; i < FONT_CHARS.length; i++) {
      const rows = glyph(FONT_CHARS[i]);
      for (let y = 0; y < GLYPH_H; y++)
        for (let x = 0; x < GLYPH_W; x++)
          if (rows[y] & (16 >> x)) c.fillRect(i * GLYPH_W + x, y, 1, 1);
    }
    if (atlases.size > 64) atlases.clear();
    atlases.set(color, a);
    return a;
  }

  function textWidth(str, scale = 1) {
    str = String(str);
    return str.length ? (str.length * ADVANCE - 1) * scale : 0;
  }

  function drawRun(g, str, x, y, color, scale) {
    x = Math.round(x);
    y = Math.round(y);
    if (canAtlas) {
      const atlas = atlasFor(color);
      for (let i = 0; i < str.length; i++) {
        if (str[i] === ' ') continue;
        const gi = glyphIndex(str[i]);
        g.drawImage(atlas, gi * GLYPH_W, 0, GLYPH_W, GLYPH_H,
          x + i * ADVANCE * scale, y, GLYPH_W * scale, GLYPH_H * scale);
      }
    } else {
      const prev = g.fillStyle;
      g.fillStyle = color;
      for (let i = 0; i < str.length; i++) {
        const rows = glyph(str[i]);
        const ox = x + i * ADVANCE * scale;
        for (let ry = 0; ry < GLYPH_H; ry++)
          for (let rx = 0; rx < GLYPH_W; rx++)
            if (rows[ry] & (16 >> rx)) g.fillRect(ox + rx * scale, y + ry * scale, scale, scale);
      }
      g.fillStyle = prev;
    }
  }

  function text(str, x, y, opts = {}) {
    const g = getCtx();
    if (!g) return;
    str = String(str);
    const scale = Math.max(1, Math.round(opts.scale || 1));
    const color = opts.color || '#fff';
    const align = opts.align || 'left';
    const w = textWidth(str, scale);
    if (align === 'center') x -= w / 2;
    else if (align === 'right') x -= w;
    if (opts.shadow) drawRun(g, str, x + scale, y + scale, opts.shadow, scale);
    drawRun(g, str, x, y, color, scale);
  }

  return { text, textWidth };
}

/**
 * @param {object} opts
 * @param {() => any} opts.getCtx        returns the 2D context for draw()
 * @param {(msg: object) => void} opts.sound   receives sound commands
 * @param {Record<string, any>} opts.storage    initial save data
 * @param {(data: Record<string, any>) => void} opts.persist  called when save data changes
 * @param {(...a: any[]) => void} opts.log
 */
export function createApi({ getCtx, sound, storage, persist, log }) {
  const save = { ...(storage || {}) };
  const { text, textWidth } = makeTextRenderer(getCtx);
  const api = {
    W, H,
    frame: 0,
    time: 0,
    text,
    textWidth,
    sound: {
      tone(freq, dur, o = {}) {
        if (!(freq > 0) || !(dur > 0)) return;
        sound({ kind: 'tone', freq, dur, type: o.type || 'square', vol: o.vol ?? 0.15, slide: o.slide ?? null, delay: o.delay || 0 });
      },
      noise(dur, o = {}) {
        if (!(dur > 0)) return;
        sound({ kind: 'noise', dur, vol: o.vol ?? 0.15, delay: o.delay || 0, filter: o.filter || 2000 });
      },
      stopAll() { sound({ kind: 'stop' }); },
    },
    storage: {
      get(key, fallback) { return key in save ? save[key] : fallback; },
      set(key, value) {
        save[key] = JSON.parse(JSON.stringify(value ?? null));
        persist({ ...save });
      },
    },
    log: (...a) => log(...a),
  };
  return api;
}

/** Turns host-supplied held/tapped state into per-tick input objects. */
export function createInputTracker() {
  let prev = Object.fromEntries(BUTTONS.map((b) => [b, false]));
  return function next(held, tapped, firstTick) {
    const input = { pressed: {}, released: {} };
    for (const b of BUTTONS) {
      const h = !!held[b];
      const wasTapped = firstTick && !!(tapped && tapped[b]);
      input[b] = h || wasTapped;
      input.pressed[b] = (h && !prev[b]) || (wasTapped && !prev[b]);
      input.released[b] = (!h && prev[b]) || (wasTapped && !h);
      prev[b] = h;
    }
    return input;
  };
}

/**
 * Instantiates a cartridge module and returns a driver.
 * @param {any} mod  the imported module (expects a default export `boot(api)`)
 */
export function createCart(mod, apiOpts) {
  const boot = mod && (mod.default || mod.boot);
  if (typeof boot !== 'function') throw new Error('Cartridge must `export default function boot(api)`');
  const api = createApi(apiOpts);
  const game = boot(api);
  if (!game || typeof game.update !== 'function' || typeof game.draw !== 'function')
    throw new Error('boot(api) must return an object with update(input) and draw(g)');
  const nextInput = createInputTracker();
  return {
    api,
    step(held, tapped, first) {
      const input = nextInput(held, tapped, first);
      game.update(input);
      api.frame++;
      api.time = api.frame / 60;
    },
    draw(g) {
      g.save();
      game.draw(g);
      g.restore();
    },
  };
}

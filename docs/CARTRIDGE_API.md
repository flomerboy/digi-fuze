# DIGI-FUZE Cartridge API (v1)

A cartridge is **one self-contained JavaScript ES module** that runs on the DIGI-FUZE
fantasy console. The console has a 320×240 screen, a D-pad, two action buttons (A, B),
START and SELECT, a simple synth, and a little save memory. That's all.

## Module shape

```js
// No imports. No network, no DOM, no external assets. Everything is drawn and synthesized in code.
export default function boot(api) {
  // set up state here (closures are fine)
  return {
    update(input) { /* called exactly 60 times per second */ },
    draw(g)       { /* called after updates, once per displayed frame */ },
  };
}
```

- `boot(api)` is called once when the cartridge is inserted.
- `update(input)` runs at a **fixed 60 Hz** timestep. Treat each call as `dt = 1/60` s.
  Do all game logic here.
- `draw(g)` renders the current state. `g` is a standard `CanvasRenderingContext2D`
  (it comes from an `OffscreenCanvas`) sized **320×240**. The pixels carry over between
  frames, so repaint the whole screen every frame. Context state (transform, styles, alpha)
  is reset before each `draw`. Image smoothing is off.
- The code runs inside a Web Worker. `window` and `document` are not there, and neither are
  `fetch`, `Image`, or `Audio`. `Math`, `Date`, typed arrays, `OffscreenCanvas`, `Path2D` and
  the rest of standard JS are available.
- If `boot`, `update` or `draw` throws, the console shows a crash screen. Don't throw.

## Input

`input` is passed to `update` every tick:

| Field | Meaning |
|---|---|
| `input.up`, `.down`, `.left`, `.right`, `.a`, `.b`, `.start`, `.select` | `true` while held |
| `input.pressed.<button>` | `true` only on the tick the button went down |
| `input.released.<button>` | `true` only on the tick the button went up |

Keyboard mapping (for reference only; don't read keys yourself):
D-pad = arrows / WASD, A = J (also Z / Space), B = K (also X), START = Enter, SELECT = Shift.

**Players know the A and B buttons as J and K** (the keys they press). In all on-screen text, call them J and K: "PRESS J", "J: JUMP  K: RUN". Keep using `input.a` / `input.b` in code.

There is **no mouse**. Menus and cursors must be driven by the D-pad and buttons.

## `api` reference

```ts
api.W            // 320 (screen width)
api.H            // 240 (screen height)
api.frame        // number of update() ticks since boot (integer, read-only)
api.time         // seconds since boot = frame / 60

// Built-in 5x7 pixel font (crisp retro text; 6px advance per char at scale 1, 8px line height)
api.text(str, x, y, { color = '#fff', scale = 1, align = 'left' | 'center' | 'right', shadow = null })
api.textWidth(str, scale = 1)  // width in pixels

// Synth (fire-and-forget, all args optional except freq/dur)
api.sound.tone(freq, dur, { type = 'square', vol = 0.15, slide = null /* end freq */, delay = 0 })
  // type: 'square' | 'sawtooth' | 'triangle' | 'sine'
api.sound.noise(dur, { vol = 0.15, delay = 0, filter = 2000 /* lowpass Hz */ })
api.sound.stopAll()

// Save memory (persists per cartridge across sessions; values must be JSON-serializable)
api.storage.get(key, fallback)
api.storage.set(key, value)

api.log(...args)  // debug logging to the host console
```

Notes:
- `api.text` supports ASCII 32–126. Lowercase letters are drawn as uppercase.
- `delay` on sounds is in seconds from now, which lets you write short jingles:
  `[523, 659, 784].forEach((f, i) => api.sound.tone(f, 0.1, { delay: i * 0.1 }))`.
- Use `api.storage` for high scores and unlocked levels.

## Quality bar for a cartridge

A cartridge is a **complete little game**, not a tech demo:

1. **Title screen**: game name, a short "how to play" line, and "PRESS START".
2. **Progression**: about **20 levels/stages** (or an equivalent campaign) with a real
   difficulty curve and some variety: new layouts, enemies, rules or twists, not only
   faster numbers.
3. **Pause** on START during play, plus a **game-over** screen, a **level-clear** moment
   and a **victory** screen after the final level.
4. **Score** and a **saved high score**. Ideally a saved "furthest level reached" with a
   level select from the title screen (LEFT/RIGHT on the title screen).
5. **Juice**: sound effects for every important event, screen shake/flash/particles
   where they fit, readable colors on a dark background.
6. Runs at a full 60 fps: keep per-frame work modest.
7. Playable **single-player**. If the game is inherently 2-player (paddle duels, chess), the
   opponent is a CPU.

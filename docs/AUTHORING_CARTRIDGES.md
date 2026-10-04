# Authoring a hand-made cartridge

The 8 launch cartridges are the *ingredients* that AI models remix. They need to be complete,
fun games, and also **clear, well-structured source**, because a model has to read two of
them and fuse them into a new game.

## Rules
- One file: `cartridges/<id>/game.js`, plain modern JavaScript (ES2022), `export default function boot(api)`.
  No imports. Follow `docs/CARTRIDGE_API.md` exactly.
- Organize the file into clearly commented sections (constants/tuning, level data, entities,
  game states, update, draw, audio helpers). Prefer named functions and plain data over clever tricks.
- Use a small explicit state machine: `title` → `playing` ↔ `paused` → `levelClear` → … → `gameOver` / `victory`.
- About 20 levels with real variety (layouts, enemy types, rule twists), described as data where
  possible (a `LEVELS` array).
- Save high score + furthest level with `api.storage`; LEFT/RIGHT on the title selects any unlocked level.
- Don't pad the code. Write what a great small game needs, and no more.

## Verifying
1. `npm run smoke -- cartridges/<id>/game.js` runs the game headless for 6000 frames × 3 seeds
   with random input and fails on any exception or hang. Must PASS.
2. With the dev server running (`npx vite --port 5173`; check whether it's already up first with
   `curl -s localhost:5173/api/cartridges`), take real screenshots:
   `node tools/shot.mjs <id> <prefix> "wait:800,shot,press:Enter,wait:1500,shot"`
   then view the PNGs. Check title, gameplay, pause, game over and level transitions visually.
   Interactive bench for humans: `http://localhost:5173/dev.html?cart=<id>`.

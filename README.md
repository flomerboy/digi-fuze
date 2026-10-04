# DIGI-FUZE

A 3D retro game console (three.js) plugged into a CRT TV. Drag a cartridge into the console
to play it. Drag in a **second** cartridge and an AI model writes a brand-new game that
kitbashes the two, live. Nothing is pre-generated. The demo doubles as a benchmark for how
well models can fuse two complete codebases into something that is actually fun.

It's a fully static site: **bring your own key**. Remixes call Anthropic (or OpenRouter) straight
from your browser with your key, which is stored only in your browser. There is no backend.

## Run it

Needs Node.js 22 LTS or newer (Windows, macOS or Linux).

```bash
npm install
npm run dev                             # http://localhost:5173
```

Single cartridges play without a key. To remix, click **Keys** (top right) and paste an Anthropic
key (`sk-ant-…`) or connect OpenRouter. "Remember on this device" keeps it in localStorage;
otherwise it's forgotten when the tab closes.

- **Play:** drag a cartridge from the rack into slot A or B (or just click it). Click the TV or
  press **F** for full screen; **Esc** goes back to the desk.
- **Remix:** put a cartridge in each slot. The TV streams the model's thinking and code, then
  boot-tests the result, and plays it if the test passes. Slot order doesn't matter.
- **Model / effort / repairs / fast mode:** pick these in the top-right panel. "Repairs" is how many
  times the model gets to see a failed boot test and try again. **Fast mode** (Opus 5.5 / Opus 5 /
  Opus 4.8 on the Anthropic API) runs the same model up to ~2.5x faster for 2x the price.
- **Results:** every remix is saved in your browser (IndexedDB) with its stats (time, tokens in/out,
  cost, attempts) and your ratings (Fun, Fusion, Works). The **Results** panel aggregates them per
  model, breaks each remix down per attempt, and lets you replay, **Export** (a single
  `.vgremix.json`), **Import**, **Submit** to the repo, or delete.
- **Level 1 first, then you direct the rest:** the model first writes a polished,
  playable level 1, so you're playing in a fraction of the time. If you like it, press **Build full
  game** and tell it what to keep or change; the same model, in the same conversation, adds the
  remaining levels (and can rework level 1). The level-1 version stays playable. Results records
  "first play" time separately, and staged remixes use their own prompt version so benchmark
  numbers stay comparable. (The CLI still does one-shot remixes for benchmarking; add `--staged`
  for level 1 only.)
- **Remix length:** *Full* (~20 levels, the real benchmark; a big model can take several
  minutes) or *Quick* (~6 levels, much faster, good for live demos).
- **Crash during play?** If an AI-made game crashes while you play it, press **START** on the
  crash screen. The runtime error goes back to the same model (same conversation), and the
  fixed version boots. These fixes are counted in the results (`runtimeRepairs`).
- **Broken but not crashing?** Press **Report bug**. Your description, a screenshot of the TV and
  your last few seconds of button presses go to the same model, which ships a fixed version
  (counted as `bugReports`; the previous version stays playable from Results). For the built-in
  cartridges, Report bug opens a pre-filled GitHub issue instead.
- **TV knobs:** VOLUME and PICTURE (CRT effect strength). Drag, scroll or click them.
- Production: `npm run build && npm run preview`. GitHub Pages deploys from `main` via
  `.github/workflows/pages.yml` (`VITE_BASE=/digi-fuze/`).

Controls: Arrows/WASD = D-pad · J = A · K = B · Enter = START · Shift = SELECT (Z/Space and X also work for A and B).

## Pre-demo checklist

1. `npm install`, then open http://localhost:5173 (`npm run dev`), add your key under **Keys**, and
   click once so audio unlocks.
2. Optional headless check of key + model access: `ANTHROPIC_API_KEY=sk-ant-... npm run remix -- snake pong --scope quick`
   (the CLI uses the same pipeline and saves to `remixes/`; `npm run remix -- export <id>` makes a
   file you can Import in the browser).
3. Do a Quick remix in the browser before going on stage so it's in Results.
4. Any past remix can be replayed instantly from **Results → Play**: a good fallback if the
   network is slow on stage.

## The cartridges

| Cartridge | What it is |
|---|---|
| SNAKE | 20 levels: wrap-around, portals, rotting apples, poison, saws, darkness |
| PADDLE | 20 CPU rivals with tricks: curve, multiball, gravity wells, mirrored controls, a split-paddle boss |
| CHESS | Full rules engine (perft-verified) with a time-sliced alpha-beta AI. Ladder of 20 rivals including mate-in-2 puzzles and blitz |
| BRICKS | 20 stages, power-ups, explosive/regenerating/steel bricks, two bosses |
| ROCKS | 20 sectors: ring drones, crystal shards, mines, seekers, black holes, rock streams, station bosses |
| SPROUT SHOWER | 20 garden levels: drop flowers next to matching planted ones to make them bloom; chain blooms, stones, ledges and wells |
| SPARROW GLIDER | 20 sky courses: rock spires, kites, goose flocks, updrafts, lightning, cloud caverns, a sky kraken boss, plus endless mode |
| JUMPER | 20 short platformer levels in 4 acts: springs, one-way ledges, sliding/crumbling platforms, lifts, bugs and hoppers |

Each one is a single self-contained JS file (`cartridges/<id>/game.js`) of roughly 800 to
1,900 lines (about 10k in total), written against a tiny fantasy-console API: **[docs/CARTRIDGE_API.md](docs/CARTRIDGE_API.md)**.
The same document is the spec the model receives, and AI-made remixes follow the same contract.

## How a remix works

1. `src/remix/pipeline.ts` sends the model the cartridge API spec (system prompt, cached), the full
   source of both cartridges, and a design brief (`src/remix/prompt.ts`, versioned via
   `PROMPT_VERSION`), straight from the browser to the provider (`src/remix/anthropic.ts` via the
   official SDK, or `src/remix/openrouter.ts`). It streams, with adaptive thinking (summarized, so
   the TV can show it) and the chosen effort.
2. Thinking and code stream onto the TV, with live time, tokens and cost.
3. The extracted cartridge is **boot-tested** in a throwaway Web Worker (`src/remix/smoke-worker.ts`)
   with network and storage APIs removed, a hard timeout, and 3,600 frames of scripted and random
   input against a real canvas. Any exception, hang or missing export is a failure. (The CLI runs the
   same harness in a locked-down Node child process, `tools/smoke.mjs`.)
4. On failure the error goes back to the model as a repair request (append-only conversation),
   up to the configured number of repairs.
5. The passing cartridge boots on the TV inside a Web Worker. A crash or hang at runtime shows
   a crash screen instead of taking down the page.

Metrics recorded per remix: time to first token, time to first code, total time, tokens
(including cache reads), estimated cost, attempts, smoke-test result per attempt, line count,
and the human ratings.

Refusals are recorded as failures; there is deliberately **no automatic fallback to another
model**, so every result is attributable to the model that was picked.

## Layout

```
cartridges/<id>/   game.js + cart.json (label art/colors), bundled into the static site
docs/              CARTRIDGE_API.md (runtime contract + model spec), AUTHORING_CARTRIDGES.md,
                   TIER2_CARTRIDGES.md (next complexity tier: tactics, monster-catcher, platform fighter, farming)
src/remix/         the remix pipeline (shared by browser + CLI): prompt, models, Anthropic/OpenRouter
                   adapters, boot test worker, IndexedDB store, BYOK key storage
src/runtime/       cartridge runtime: core.js + smoke-harness.js (shared with Node), worker, host, synth, input, font
src/world.ts       three.js scene: room, CRT TV + shader + knobs, console, gamepad, cartridges, camera
src/screen.ts      TV screens that aren't a game: idle, loading, remix progress, stats card, crash, knob OSD
src/picker.ts      model picker (featured models, more models, effort, fast mode)
src/main.ts        app state machine + overlay UI (keys, rating, bug reports, results)
server/            Node-only bits for the CLI: file store, cartridge loader
tools/             smoke tester, cartridge screenshot bench, 3D scene screenshot script
.github/           Pages deploy workflow, issue forms for remix/cartridge submissions and bugs
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Submissions are welcome but may never be reviewed or merged.

## Dev tools

- `npm run remix -- <a> <b> [--model id] [--effort level] [--scope full|quick] [--repairs n] [--fast]`: headless remix (also good for batch benchmarking). Reads `ANTHROPIC_API_KEY`.

- `npm run smoke`: smoke-test every cartridge (or `npm run smoke -- cartridges/snake/game.js`).
- `http://localhost:5173/dev.html?cart=snake` (or `?remix=<id>`): a flat 2D bench for a single cartridge.
- `node tools/shot.mjs <cart> <prefix> "wait:800,shot,press:Enter,wait:1500,shot"`: real-browser screenshots of a cartridge.
- `node tools/scene-shot.mjs out.png "wait:3000,click:408:465,wait:3000"`: screenshots of the 3D scene (uses `?lowfi` for software GL).

## Disclaimer

All cartridges, characters and art in DIGI-FUZE are original. The project is not affiliated with or endorsed by any game company, and any resemblance of a cartridge's basic mechanics to classic genres (paddle duels, brick breaking, rock blasting, snake, chess) is a nod to the genres, not to any specific product.

## License

MIT, see [LICENSE](LICENSE). Contributions are accepted under the same license.

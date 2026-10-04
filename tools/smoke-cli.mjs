// Usage: npm run smoke -- cartridges/snake/game.js [frames]
//        npm run smoke            (tests every cartridge)
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { smokeTest } from './smoke.mjs';

const [target, frames] = process.argv.slice(2);
const files = target ? [target] : readdirSync('cartridges').map((d) => `cartridges/${d}/game.js`).filter(existsSync);
let failed = 0;
for (const f of files) {
  for (const seed of [1, 2, 3]) {
    const r = await smokeTest(readFileSync(f, 'utf8'), { frames: Number(frames) || 6000, seed });
    const lines = readFileSync(f, 'utf8').split('\n').length;
    console.log(`${r.ok ? 'PASS' : 'FAIL'} ${f} seed=${seed} lines=${lines} frames=${r.frames ?? 0} avg=${r.avgMs ?? '-'}ms max=${r.maxMs ?? '-'}ms sounds=${r.sounds ?? 0}`);
    if (!r.ok) { failed++; console.log(`  [${r.phase}] ${r.error}`); break; }
  }
}
process.exit(failed ? 1 : 0);

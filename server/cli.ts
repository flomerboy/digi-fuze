// Headless remixes from the command line, handy for checking your API key / model access before a demo,
// or for batch benchmarking. Uses the same pipeline as the web app, with ANTHROPIC_API_KEY from the environment.
//   npm run remix -- snake pong --model claude-opus-5-5 --effort medium --scope quick --repairs 1 [--fast]
//   npm run remix -- export <remix-id>     writes <remix-id>.vgremix.json for Import in the web app
import { readFileSync, writeFileSync } from 'node:fs';
import { runRemix, exportRemix } from '../src/remix/pipeline';
import { createAnthropicAdapter } from '../src/remix/anthropic';
import { ANTHROPIC_MODELS } from '../src/remix/models';
import { listCartridges, readCartSource } from './cartridges';
import { fsStore } from './store';
import { API_SPEC } from './paths';
// @ts-ignore - plain JS module
import { smokeTest } from '../tools/smoke.mjs';

const args = process.argv.slice(2);
const flag = (name: string, dflt: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const BOOL_FLAGS = ['--fast', '--staged'];
const positional = args.filter((x, i) => !x.startsWith('--') && !(args[i - 1]?.startsWith('--') && !BOOL_FLAGS.includes(args[i - 1])));

if (positional[0] === 'export' && positional[1]) {
  const out = `${positional[1]}.vgremix.json`;
  writeFileSync(out, JSON.stringify(await exportRemix(fsStore, positional[1])));
  console.log(`wrote ${out}. Use Import in the web app's Results panel to load it.`);
  process.exit(0);
}

const [a, b] = positional;
const carts = listCartridges();
const ca = carts.find((c) => c.id === a), cb = carts.find((c) => c.id === b);
const model = ANTHROPIC_MODELS.find((m) => m.id === flag('model', 'claude-opus-5-5'));
if (!ca || !cb || !model) {
  console.log(`usage: npm run remix -- <cartA> <cartB> [--model id] [--effort level] [--scope full|quick] [--repairs n] [--fast]
       npm run remix -- export <remix-id>
cartridges: ${carts.map((c) => c.id).join(', ')}
models: ${ANTHROPIC_MODELS.map((m) => m.id).join(', ')}`);
  process.exit(1);
}

const t0 = Date.now();
let chars = 0, lastPhase = '';
const meta = await runRemix({
  a: { id: ca.id, title: ca.title, source: readCartSource(ca.id)! },
  b: { id: cb.id, title: cb.title, source: readCartSource(cb.id)! },
  model,
  effort: flag('effort', '') || null,
  fast: args.includes('--fast'),
  staged: args.includes('--staged'),
  scope: flag('scope', 'full') === 'quick' ? 'quick' : 'full',
  repairs: Number(flag('repairs', '1')),
  apiSpec: readFileSync(API_SPEC, 'utf8'),
}, {
  llm: createAnthropicAdapter(),
  smoke: (code) => smokeTest(code, { frames: 3600 }),
  store: fsStore,
  signal: new AbortController().signal,
  emit: (event, data) => {
    if (event === 'phase' && data.phase !== lastPhase) { lastPhase = data.phase; process.stdout.write(`\n[${((Date.now() - t0) / 1000).toFixed(1)}s] ${data.phase}`); }
    else if (event === 'text') { chars += data.text.length; if (chars % 4000 < data.text.length) process.stdout.write('.'); }
    else if (event === 'meta') process.stdout.write(`\n  ${data.title}: ${data.pitch}`);
    else if (event === 'test') process.stdout.write(`\n  boot test: ${data.ok ? 'PASS' : 'FAIL ' + String(data.error).split('\n')[0]}`);
  },
});
const out = meta.attempts.reduce((s, x) => s + x.usage.output, 0), inp = meta.attempts.reduce((s, x) => s + x.usage.input, 0);
console.log(`\n\n${meta.status.toUpperCase()}  ${meta.id}`);
console.log(`time ${(meta.totalMs / 1000).toFixed(1)}s · attempts ${meta.attempts.length} · tokens ${inp} in / ${out} out · lines ${meta.lines} · ~$${meta.costUsd.toFixed(2)}`);
if (meta.failure) console.log(`failure: ${meta.failure}`);
if (meta.status === 'ok') console.log(`to play it in the web app: npm run remix -- export ${meta.id}, then Results → Import`);
process.exit(meta.status === 'ok' ? 0 : 1);

// DIGI-FUZE app: wires the 3D world, the cartridge runtime, the TV screen and the remix pipeline together.
// Everything runs in the browser: remixes call the model provider directly with the visitor's own key (BYOK),
// get boot-tested in a sandboxed worker, and are saved in this browser's IndexedDB.
import { World, type CartInfo } from './world';
import { Screen, FUSION, type RemixView, type FusionView } from './screen';
import { captureTitle } from './runtime/capture';
import { CartHost } from './runtime/host';
import { Synth } from './runtime/synth';
import { Input, BUTTONS } from './runtime/input';
import type { RemixMeta, Provider, LlmAdapter, Attempt } from './remix/types';
import { CARTRIDGES, cartSource, apiSpec } from './remix/cartridges';
import { runRemix, runFix, runExpand, exportRemix, importRemix, type PipelineDeps } from './remix/pipeline';
import { createAnthropicAdapter } from './remix/anthropic';
import { createOpenRouterAdapter } from './remix/openrouter';
import { startOpenRouterLogin, completeOpenRouterLogin } from './remix/openrouter-auth';
import { smokeTestInBrowser } from './remix/smoke-browser';
import { idbStore } from './remix/store-idb';
import { getKey, setKey, clearKey, isRemembered, looksLikeKey } from './remix/keys';
import { FAST_PRICE_MULTIPLIER } from './remix/models';
import { ModelPicker } from './picker';

type Mode = 'off' | 'loading' | 'game' | 'fusion' | 'remix' | 'done' | 'crash';

const REPO = 'https://github.com/flomerboy/digi-fuze';
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const screen = new Screen();
const world = new World($('#stage'), screen.canvas);
const synth = new Synth();
const input = new Input();
let mode: Mode = 'off';
let crashInfo = { title: '', msg: '', hint: '' };
let loadingLabel = '';
let remixView: RemixView | null = null;
let doneCard: { heading: string; title: string; pitch: string; rows: [string, string][] } | null = null;
let fusionView: FusionView | null = null;
let fusionPair: [CartInfo, CartInfo] | null = null;
let remixAbort: AbortController | null = null;
let currentRemix: RemixMeta | null = null;
let currentCart: CartInfo | null = null;
const slots: (CartInfo | null)[] = [null, null];
let lastCrash = '';
let generation = 0; // bumps on every slot change so stale async work can bail out

// Recent activity for bug reports: button presses and the cartridge's own log lines.
const activity: { t: number; line: string }[] = [];
const note = (line: string) => { activity.push({ t: performance.now(), line }); if (activity.length > 80) activity.shift(); };

const host = new CartHost(synth, input, {
  onFrame(bitmap) { if (mode === 'game') screen.frame(bitmap); bitmap.close(); },
  onLog(line) { note(`log: ${line.slice(0, 200)}`); },
  onError(e) {
    const loadFailure = e.phase === 'load'; // the runtime didn't load: nothing for the model to fix
    crashInfo = {
      title: loadFailure ? 'COULD NOT LOAD' : 'CARTRIDGE ERROR',
      msg: loadFailure ? e.message : `[${e.phase}] ${e.message}\n\n${(e.stack || '').split('\n').slice(0, 8).join('\n')}`,
      hint: loadFailure ? 'RELOAD THE PAGE' : currentRemix ? 'PRESS START TO ASK THE MODEL TO FIX IT  -  OR EJECT A CARTRIDGE' : 'EJECT AND REINSERT THE CARTRIDGE',
    };
    lastCrash = loadFailure ? '' : `[${e.phase}] ${e.message}\n${e.stack || ''}`;
    note(`crash: ${e.message}`);
    mode = 'crash';
    $('#btn-bug').hidden = true;
    world.staticBurst(1);
    setStatus(`Crashed: ${e.message}`);
  },
});

for (const ev of ['pointerdown', 'keydown'] as const) window.addEventListener(ev, () => synth.unlock());

// ------------------------------------------------------------------ TV knobs (VOLUME, PICTURE)
const KNOB_KEYS = ['vgr:volume', 'vgr:picture'];
const KNOB_LABELS = ['VOLUME', 'PICTURE'];
let osd = { i: 0, until: 0 };
KNOB_KEYS.forEach((k, i) => {
  let v = NaN;
  try { v = parseFloat(localStorage.getItem(k) ?? ''); } catch { /* storage blocked */ }
  if (Number.isFinite(v)) world.setKnob(i, v, false);
});
synth.setVolume(world.knobValues[0]);
world.onPadButton = (b, down) => {
  if (down && b === 'start' && mode === 'fusion') { fireFusion(); return; }
  if (down) input.press(b); else input.release(b);
};
world.onKnob = (i, v) => {
  try { localStorage.setItem(KNOB_KEYS[i], String(v)); } catch { /* storage blocked */ }
  if (i === 0) synth.setVolume(v);
  synth.blip(1800, 0.012, 'square', 0.04); // detent click
  osd = { i, until: performance.now() + 1500 };
  if (world.powerTarget === 0) setStatus(`${KNOB_LABELS[i]} ${Math.round(v * 100)}`);
};

// ------------------------------------------------------------------ setup
world.addCartridges(CARTRIDGES);
const cartById = new Map<string, CartInfo>(CARTRIDGES.map((c) => [c.id, c]));
const picker = new ModelPicker();
/** How many times the model may see a failed boot test and try again. */
const REPAIRS = 1;
const scopeSel = $<HTMLSelectElement>('#scope');
try { scopeSel.value = localStorage.getItem('vgr:scope') || 'full'; } catch { /* default */ }
scopeSel.onchange = () => { try { localStorage.setItem('vgr:scope', scopeSel.value); } catch { /* ignore */ } scopeSel.blur(); };

// Returning from "Connect with OpenRouter"?
try {
  const k = await completeOpenRouterLogin();
  if (k) { setKey('openrouter', k, true); setStatus('Connected to OpenRouter.'); }
} catch (e) { setStatus(`OpenRouter sign-in failed: ${(e as Error).message}`); }
void picker.refresh();

// A remix or build streams straight into this page: reloading or closing the tab kills it. Ask first while one runs
// (this also catches the dev server's auto-reload when files change).
let jobsRunning = 0;
window.addEventListener('beforeunload', (e) => {
  if (jobsRunning > 0) { e.preventDefault(); e.returnValue = ''; }
});

// Anything still marked "running" is from a page that was closed or reloaded mid-job: it can't finish now.
void idbStore.list().then(async (all) => {
  for (const m of all) {
    if (m.status !== 'running' && m.expansion !== 'running') continue;
    if (m.status === 'running') { m.status = (await idbStore.loadSource(m.id)) ? 'ok' : 'aborted'; m.failure ??= 'Stopped: the page was closed or reloaded before it finished.'; }
    if (m.expansion === 'running') m.expansion = 'pending';
    await idbStore.saveMeta(m);
  }
}).catch(() => { /* storage unavailable */ });
updateConn();

// ------------------------------------------------------------------ slots → behaviour
world.onInsert = (i, info) => { slots[i] = info; synth.blip(220, 0.08, 'square', 0.1); void refresh(); };
world.onEject = (i) => { slots[i] = null; synth.blip(140, 0.06, 'square', 0.08); void refresh(); };
world.onScreenClick = () => (mode === 'fusion' ? fireFusion() : setFocus(true));

async function refresh() {
  const gen = ++generation;
  remixAbort?.abort();
  remixAbort = null;
  world.remixing = false;
  host.stop();
  currentRemix = null;
  currentCart = null;
  fusionView = null;
  fusionPair = null;
  $('#rate').hidden = true;
  $('#btn-bug').hidden = true;
  $('#btn-build').hidden = true;
  input.clear();
  const inserted = slots.filter(Boolean) as CartInfo[];

  if (inserted.length === 0) {
    // The TV stays on with its "insert cartridge" screen: it explains the console better than any panel text.
    mode = 'off';
    setStatus('');
    setFocus(false);
    return;
  }
  world.powerTarget = 1;
  world.staticBurst(0.9);

  if (inserted.length === 1) {
    const c = inserted[0];
    mode = 'loading';
    loadingLabel = `LOADING ${c.title}`;
    let src: string;
    try { src = await cartSource(c.id); } catch { return showCrash('NO GAME ON CARTRIDGE', `${c.title} has no game.js yet.`, 'EJECT IT'); }
    if (gen !== generation) return;
    host.load(src, `vgr:cart:${c.id}`);
    currentCart = c;
    mode = 'game';
    $('#btn-bug').hidden = false;
    setStatus(`Playing ${c.title}`);
    return;
  }

  startFusion(inserted[0], inserted[1], gen);
}

function showCrash(title: string, msg: string, hint: string) {
  crashInfo = { title, msg, hint };
  mode = 'crash';
}

// ------------------------------------------------------------------ DIGI-FUZE: the fusion screen
/** Two cartridges are in: show their title screens spiralling together, and wait for the player to fire it. */
function startFusion(a: CartInfo, b: CartInfo, gen: number) {
  const [ca, cb] = CARTRIDGES.findIndex((c) => c.id === a.id) <= CARTRIDGES.findIndex((c) => c.id === b.id) ? [a, b] : [b, a];
  fusionPair = [ca, cb];
  fusionView = {
    a: { img: null, title: ca.title, color: ca.color }, b: { img: null, title: cb.title, color: cb.color },
    startedAt: performance.now() + 400, firedAt: null, ready: !!adapterFor(picker.model.provider),
  };
  mode = 'fusion';
  setStatus(`${ca.title} + ${cb.title}`);
  setTimeout(() => { if (gen === generation) setFocus(true); }, 300);
  // rising hum while they spiral, a chime when they merge
  [196, 247, 294, 370, 440, 523].forEach((f, i) => setTimeout(() => { if (gen === generation && mode === 'fusion') synth.blip(f, 0.18, 'triangle', 0.05); }, 400 + i * 420));
  setTimeout(() => { if (gen === generation && mode === 'fusion') [784, 988, 1319].forEach((f, i) => setTimeout(() => synth.blip(f, 0.2, 'square', 0.06), i * 70)); }, 400 + FUSION.spiral * 1000);
  // real title screens (the swirl shows colored cards until these arrive)
  for (const [c, slot] of [[ca, 'a'], [cb, 'b']] as const) {
    void cartSource(c.id).then((src) => captureTitle(src)).then((img) => {
      if (gen === generation && fusionView && img) fusionView[slot].img = img;
    });
  }
}

/** The player pressed DIGI-FUZE: flood the screen, then start the remix. */
function fireFusion() {
  const f = fusionView, pair = fusionPair;
  if (!f || !pair || f.firedAt) return;
  if (performance.now() - f.startedAt < FUSION.merge * 1000) return; // let the animation land first
  if (!adapterFor(picker.model.provider)) { openSettings('Add a key to DIGI-FUZE these cartridges.'); return; }
  f.firedAt = performance.now();
  const gen = generation;
  synth.blip(110, 0.9, 'sawtooth', 0.06);
  [523, 659, 784, 1047].forEach((n, i) => setTimeout(() => synth.blip(n, 0.12, 'square', 0.07), 120 + i * 90));
  world.staticBurst(0.6);
  setTimeout(() => { if (gen === generation && mode === 'fusion') void startRemix(pair[0], pair[1], gen); }, FUSION.fire * 1000);
}

// ------------------------------------------------------------------ remix jobs
function adapterFor(p: Provider): LlmAdapter | null {
  const key = getKey(p);
  if (!key) return null;
  return p === 'anthropic' ? createAnthropicAdapter(key) : createOpenRouterAdapter(key);
}

function newView(aTitle: string, aColor: string, bTitle: string, bColor: string, label: string, effort: string | null, outPrice: number, phase: string, attempt: number): RemixView {
  return {
    aTitle, aColor, bTitle, bColor, model: label.replace(/^Claude /, '').toUpperCase(), effort,
    phase, startedAt: performance.now(), thinking: '', text: '', outTokens: 0, streamChars: 0, costUsd: 0, outPrice,
    title: '', pitch: '', attempt,
  };
}

async function startRemix(a: CartInfo, b: CartInfo, gen: number) {
  const model = picker.model;
  const llm = adapterFor(model.provider);
  if (!llm) {
    showCrash('NEEDS AN API KEY', `Remixing calls an AI model with your own key.\n\nAdd an Anthropic or OpenRouter key under "Keys" (top right), then eject and reinsert a cartridge.`, 'KEYS STAY IN THIS BROWSER');
    openSettings(`Add a key to remix with ${model.label}.`);
    return;
  }
  // Slot order doesn't matter: normalize to catalogue order so A×B and B×A are the same experiment.
  const [ca, cb] = CARTRIDGES.findIndex((c) => c.id === a.id) <= CARTRIDGES.findIndex((c) => c.id === b.id) ? [a, b] : [b, a];
  const fast = picker.fast;
  const outPrice = model.price ? (model.price[1] * (fast ? FAST_PRICE_MULTIPLIER : 1)) / 1e6 : 0;
  remixView = newView(ca.title, ca.accent, cb.title, cb.accent, model.label + (fast ? ' FAST' : ''), picker.effort, outPrice, 'connecting', 1);
  setStatus(`Remixing ${ca.title} × ${cb.title} with ${model.label}${fast ? ' (fast)' : ''}…`);
  const [sa, sb] = await Promise.all([cartSource(ca.id), cartSource(cb.id)]);
  if (gen !== generation) return;
  await runJob(gen, llm, (d) => runRemix({
    a: { id: ca.id, title: ca.title, source: sa }, b: { id: cb.id, title: cb.title, source: sb },
    model, effort: picker.effort, fast, repairs: REPAIRS, scope: scopeSel.value === 'quick' ? 'quick' : 'full', apiSpec,
    staged: true, // always: a playable level 1 first, then the player directs the full build
  }, d));
}

/** Staged remix, step 2: the player liked level 1 and asks the same model for the full game, with their feedback. */
async function startExpand(meta: RemixMeta, feedback: string) {
  const llm = adapterFor(meta.provider);
  if (!llm) { openSettings(`This remix was made through ${meta.provider === 'anthropic' ? 'Anthropic' : 'OpenRouter'}. Add that key to continue it.`); return; }
  const gen = ++generation;
  host.stop();
  $('#btn-bug').hidden = true;
  $('#btn-build').hidden = true;
  $('#rate').hidden = true;
  world.powerTarget = 1;
  const model = picker.modelFor(meta.provider, meta.model, meta.modelLabel);
  const outPrice = model.price ? (model.price[1] * (meta.fast ? FAST_PRICE_MULTIPLIER : 1)) / 1e6 : 0;
  remixView = newView(meta.title || meta.a, '#ffe066', 'FULL GAME', '#7dff9b', model.label, meta.effort, outPrice, 'expanding', meta.attempts.length + 1);
  setStatus(`${model.label} is building the full ${meta.title}${feedback ? ' with your notes' : ''}…`);
  await runJob(gen, llm, (d) => runExpand(meta.id, model, d, feedback, REPAIRS));
}

/** Crash-fix (runtime error) or bug-fix (player report): same model, same conversation, new version of the game. */
async function startFix(meta: RemixMeta, kind: 'crash-fix' | 'bug-fix', report: { text: string; recent?: string; imagePng?: string }) {
  const llm = adapterFor(meta.provider);
  if (!llm) { openSettings(`This remix was made through ${meta.provider === 'anthropic' ? 'Anthropic' : 'OpenRouter'}. Add that key to fix it.`); return; }
  const gen = ++generation;
  host.stop();
  $('#btn-bug').hidden = true;
  $('#btn-build').hidden = true;
  $('#rate').hidden = true;
  const model = picker.modelFor(meta.provider, meta.model, meta.modelLabel);
  const outPrice = model.price ? (model.price[1] * (meta.fast ? FAST_PRICE_MULTIPLIER : 1)) / 1e6 : 0;
  remixView = newView(meta.title || meta.a, '#ffe066', kind === 'bug-fix' ? 'BUG FIX' : 'FIX', '#ff8a8a', model.label, meta.effort, outPrice, 'repairing', meta.attempts.length + 1);
  setStatus(`Asking ${model.label} to fix ${meta.title}…`);
  await runJob(gen, llm, (d) => runFix(meta.id, kind, report, model, d));
}

async function runJob(gen: number, llm: LlmAdapter, job: (d: PipelineDeps) => Promise<RemixMeta>) {
  const ac = new AbortController();
  remixAbort = ac;
  jobsRunning++;
  world.remixing = true;
  mode = 'remix';
  setTimeout(() => { if (gen === generation) setFocus(true); }, 500); // the remix screen is the show
  const v = remixView!;
  const deps: PipelineDeps = {
    llm, store: idbStore, signal: ac.signal,
    smoke: (code) => smokeTestInBrowser(code, { frames: 3600 }),
    emit(event, data) {
      if (gen !== generation) return;
      switch (event) {
        case 'phase':
          v.phase = data.phase;
          v.attempt = data.attempt ?? v.attempt;
          if (data.phase === 'repairing') { v.text = ''; v.testNote = undefined; }
          break;
        case 'thinking': v.thinking += data.text; v.streamChars += data.text.length; break;
        case 'text': v.text += data.text; v.streamChars += data.text.length; break;
        case 'usage': v.outTokens += data.output; v.costUsd += data.costUsd; v.streamChars = 0; break;
        case 'meta': v.title = data.title; v.pitch = data.pitch; break;
        case 'test': if (!data.ok) v.testNote = `BOOT TEST FAILED: ${String(data.error || '').split('\n')[0].slice(0, 90)}`; break;
      }
    },
  };
  try {
    const meta = await job(deps);
    if (gen !== generation) return;
    // A failed fix or full-game build keeps the earlier playable version (status stays 'ok' but `failure` is set).
    if (meta.status !== 'ok' || meta.failure) {
      v.phase = 'failed';
      const kept = meta.status === 'ok' ? '\n\nThe previous version is still playable from Results.' : '';
      v.error = (meta.failure || 'The remix did not produce a working cartridge.') + kept;
      world.remixing = false;
      setStatus(`Didn't work: ${v.error.split('\n')[0]}`);
      return;
    }
    // Show the stats card for a moment, then boot the game.
    const heading = meta.expansion === 'pending' ? 'LEVEL 1 READY' : v.bTitle === 'FULL GAME' ? 'FULL GAME READY'
      : v.bTitle === 'FIX' || v.bTitle === 'BUG FIX' ? 'FIX READY' : 'REMIX READY';
    doneCard = { heading, title: meta.title, pitch: meta.pitch, rows: statRows(meta) };
    mode = 'done';
    world.remixing = false;
    [523, 659, 784].forEach((f, i) => setTimeout(() => synth.blip(f, 0.12, 'square', 0.08), i * 110));
    await sleep(2800);
    if (gen !== generation) return;
    await playRemix(meta, gen);
  } catch (e) {
    if (ac.signal.aborted || gen !== generation) return;
    v.phase = 'failed';
    v.error = String((e as Error).message || e);
    world.remixing = false;
    setStatus(`Remix failed: ${v.error}`);
  } finally {
    jobsRunning--;
  }
}

async function playRemix(meta: RemixMeta, gen: number, version?: number) {
  if (remixView) remixView.phase = 'booting';
  const src = version ? await idbStore.loadArchivedSource(meta.id, version) : await idbStore.loadSource(meta.id);
  if (gen !== generation) return;
  if (!src) return showCrash('MISSING GAME', 'This remix has no saved game code.', 'PICK ANOTHER FROM RESULTS');
  world.remixing = false;
  world.staticBurst(1);
  currentRemix = meta;
  currentCart = null;
  activity.length = 0;
  host.load(src, `vgr:remix:${meta.id}`);
  mode = 'game';
  $('#btn-bug').hidden = false;
  $('#btn-build').hidden = !(canBuild(meta) && !version);
  synth.blip(523, 0.1, 'square', 0.1);
  setTimeout(() => synth.blip(784, 0.15, 'square', 0.1), 110);
  const stage = meta.expansion === 'pending' ? ' · level 1 only' : '';
  setStatus(`${meta.title}${version ? ` (older version ${version})` : ''}${stage} · ${statLine(meta)}`);
  if (!version) showRating(meta);
}

const canBuild = (m: RemixMeta) => m.status === 'ok' && (m.expansion === 'pending' || m.expansion === 'failed');

function openBuild(meta: RemixMeta) {
  $('#build-intro').textContent = `${modelName(meta)} will add levels 2 to ${meta.scope === 'quick' ? 6 : 20} to ${meta.title}, in the same conversation, so it remembers how it made level 1. Tell it what you liked and what to change; it can rework level 1 too. This uses your API key (roughly the cost of the first build). The level-1 version stays playable from Results.`;
  $<HTMLTextAreaElement>('#build-text').value = '';
  $('#build').hidden = false;
  input.enabled = false;
  input.clear();
  setTimeout(() => $('#build-text').focus(), 0);
}
function closeBuild() { $('#build').hidden = true; input.enabled = true; }
$('#btn-build').onclick = () => { if (currentRemix) openBuild(currentRemix); ($('#btn-build') as HTMLButtonElement).blur(); };
$('#build-cancel').onclick = closeBuild;
$('#build-go').onclick = () => {
  if (!currentRemix) return;
  const feedback = $<HTMLTextAreaElement>('#build-text').value;
  closeBuild();
  void startExpand(currentRemix, feedback);
};

// ------------------------------------------------------------------ stats helpers
const totals = (m: RemixMeta) => m.attempts.reduce((s, a) => ({ input: s.input + a.usage.input + a.usage.cacheRead + a.usage.cacheWrite, output: s.output + a.usage.output }), { input: 0, output: 0 });
const kTok = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(n));
const dur = (ms: number) => { const s = Math.round(ms / 1000); return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`; };
const money = (n: number) => `$${n.toFixed(2)}`;
const modelName = (m: RemixMeta) => m.modelLabel || picker.modelFor(m.provider, m.model).label;

function statRows(m: RemixMeta): [string, string][] {
  const t = totals(m);
  return [
    ...(m.staged && m.firstPlayableMs ? [['FIRST PLAY', dur(m.firstPlayableMs)] as [string, string]] : []),
    ['TIME', dur(m.totalMs)],
    ['TOKENS', `${kTok(t.input)} IN / ${kTok(t.output)} OUT`],
    ['COST', money(m.costUsd)],
    ['ATTEMPTS', `${m.attempts.length}${m.fast ? '  FAST' : ''}`],
    ['MODEL', modelName(m).replace(/^Claude /, '').toUpperCase().slice(0, 22)],
  ];
}
function statLine(m: RemixMeta) {
  const t = totals(m);
  return `${dur(m.totalMs)} · ${kTok(t.input)} in / ${kTok(t.output)} out tokens · ${money(m.costUsd)} · ${modelName(m)}${m.fast ? ' (fast)' : ''}`;
}

// ------------------------------------------------------------------ rating (Fun / Fusion stars, saved on click)
const rating = { fun: 0, fusion: 0, at: '' };
for (const el of document.querySelectorAll<HTMLElement>('.stars')) {
  const k = el.dataset.k as 'fun' | 'fusion';
  for (let n = 1; n <= 5; n++) {
    const b = document.createElement('button');
    b.title = `${n}`;
    b.onclick = () => {
      rating[k] = n;
      el.querySelectorAll('button').forEach((x, j) => x.classList.toggle('on', j < n));
      b.blur();
      void saveRating();
    };
    el.appendChild(b);
  }
}
/** One rating per viewing: later clicks update it instead of adding another. */
async function saveRating() {
  if (!currentRemix) return;
  const meta = await idbStore.loadMeta(currentRemix.id);
  if (!meta) return;
  rating.at ||= new Date().toISOString();
  const entry = { fun: rating.fun, fusion: rating.fusion, at: rating.at };
  const i = meta.ratings.findIndex((r) => r.at === rating.at);
  if (i >= 0) meta.ratings[i] = entry; else meta.ratings.push(entry);
  await idbStore.saveMeta(meta);
}
function showRating(meta: RemixMeta) {
  rating.fun = rating.fusion = 0;
  rating.at = '';
  document.querySelectorAll('.stars button').forEach((x) => x.classList.remove('on'));
  $('#rate-title').textContent = meta.pitch;
  $('#rate').hidden = false;
}

// ------------------------------------------------------------------ keys / settings
function updateConn() {
  const a = !!getKey('anthropic'), o = !!getKey('openrouter');
  // Progressive disclosure: until there's a key, the panel is just "Add API key" (plus Results if remixes exist).
  $('#panel-nokey').hidden = a || o;
  $('#panel-full').hidden = !(a || o);
  void idbStore.list().then((l) => {
    const has = a || o || l.length > 0;
    $('#panel-actions').hidden = !has;
    $('#btn-results').hidden = !(a || o) && !l.length;
  }).catch(() => { $('#panel-actions').hidden = !(a || o); });
  const el = $('#conn');
  el.textContent = a && o ? 'Using your Anthropic and OpenRouter keys' : a ? 'Using your Anthropic key' : o ? 'Using your OpenRouter key' : '';
  el.classList.toggle('warn', !a && !o);
  for (const p of ['anthropic', 'openrouter'] as Provider[]) {
    const k = getKey(p);
    $(`#state-${p}`).textContent = k ? `Saved (${k.slice(0, 10)}…${k.slice(-4)}) ${isRemembered(p) ? 'on this device' : 'for this tab only'}.` : 'No key saved.';
  }
}
function openSettings(msg = '') {
  $('#settings-msg').textContent = msg;
  $<HTMLInputElement>('#remember').checked = !getKey('anthropic') && !getKey('openrouter') ? true : isRemembered('anthropic') || isRemembered('openrouter');
  updateConn();
  $('#settings').hidden = false;
}
$('#btn-settings').onclick = () => openSettings();
$('#btn-addkey').onclick = () => openSettings();
$('#conn').onclick = () => openSettings();
$('#settings-close').onclick = () => { $('#settings').hidden = true; };
for (const p of ['anthropic', 'openrouter'] as Provider[]) {
  $(`#save-${p}`).onclick = async () => {
    const box = $<HTMLInputElement>(`#key-${p}`);
    const k = box.value.trim();
    if (!looksLikeKey(p, k)) { $('#settings-msg').textContent = `That doesn't look like ${p === 'anthropic' ? 'an Anthropic key (sk-ant-…)' : 'an OpenRouter key (sk-or-…)'}.`; return; }
    setKey(p, k, $<HTMLInputElement>('#remember').checked);
    box.value = '';
    $('#settings-msg').textContent = 'Saved.';
    updateConn();
    await picker.refresh();
  };
  $(`#forget-${p}`).onclick = async () => { clearKey(p); updateConn(); await picker.refresh(); };
}
$('#connect-openrouter').onclick = async () => {
  try { await startOpenRouterLogin(); } catch (e) { $('#settings-msg').textContent = (e as Error).message; }
};

// ------------------------------------------------------------------ bug reports
let bugShot = '';
function screenshotPng(): string {
  const c = document.createElement('canvas');
  c.width = 320; c.height = 240;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.drawImage(screen.canvas, 0, 0, 320, 240);
  return c.toDataURL('image/png');
}
function recentActivity(): string {
  const now = performance.now();
  return activity.filter((a) => now - a.t < 15000).map((a) => `${((a.t - now) / 1000).toFixed(1)}s ${a.line}`).join('\n') || '(no recent input)';
}
function issueUrl(template: string, fields: Record<string, string>) {
  const u = new URL(`${REPO}/issues/new`);
  u.searchParams.set('template', template);
  for (const [k, v] of Object.entries(fields)) u.searchParams.set(k, v.slice(0, 1500));
  return u.toString();
}
$('#btn-bug').onclick = () => {
  bugShot = screenshotPng();
  ($('#bug-shot') as HTMLImageElement).src = bugShot;
  $('#bug-intro').textContent = currentRemix
    ? `Describe what's wrong. Your description, this screenshot and your last few seconds of button presses go to ${modelName(currentRemix)} (the model that made this game), which will try to fix it. This uses your API key, about the cost of one repair. The current version is kept, so you can go back to it from Results.`
    : `This opens a pre-filled GitHub issue about ${currentCart?.title ?? 'this cartridge'} in a new tab. Reports are welcome but may not get a reply.`;
  $<HTMLTextAreaElement>('#bug-text').value = '';
  $('#bug').hidden = false;
  input.enabled = false;
  input.clear();
  setTimeout(() => $('#bug-text').focus(), 0);
  ($('#btn-bug') as HTMLButtonElement).blur();
};
function closeBug() { $('#bug').hidden = true; input.enabled = true; }
$('#bug-cancel').onclick = closeBug;
$('#bug-send').onclick = () => {
  const text = $<HTMLTextAreaElement>('#bug-text').value.trim();
  if (!text) { $('#bug-text').focus(); return; }
  closeBug();
  if (currentRemix) {
    void startFix(currentRemix, 'bug-fix', { text, recent: recentActivity(), imagePng: bugShot.replace(/^data:image\/png;base64,/, '') });
  } else if (currentCart) {
    window.open(issueUrl('bug-report.yml', { title: `[Bug] ${currentCart.title}`, cartridge: currentCart.title, details: text, browser: navigator.userAgent }), '_blank', 'noopener');
    setStatus('Opened a GitHub issue in a new tab. You can attach the screenshot there.');
  }
};

// ------------------------------------------------------------------ results drawer
$('#btn-results').onclick = () => void openResults();
$('#results-close').onclick = () => { $('#results').hidden = true; };
$('#btn-import').onclick = () => $('#import-file').click();
$<HTMLInputElement>('#import-file').onchange = async (e) => {
  const files = [...((e.target as HTMLInputElement).files || [])];
  let n = 0;
  for (const f of files) {
    try { await importRemix(idbStore, JSON.parse(await f.text())); n++; } catch (err) { setStatus(`Couldn't import ${f.name}: ${(err as Error).message}`); }
  }
  (e.target as HTMLInputElement).value = '';
  if (n) setStatus(`Imported ${n} remix${n > 1 ? 'es' : ''}.`);
  void openResults();
};

function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const fileName = (m: RemixMeta) => `${(m.title || m.id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.vgremix.json`;

async function openResults() {
  const list = await idbStore.list();
  const byModel = new Map<string, RemixMeta[]>();
  for (const r of list) { const k = `${modelName(r)}${r.provider === 'openrouter' ? ' (OpenRouter)' : ''}`; byModel.set(k, [...(byModel.get(k) || []), r]); }
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const fmt = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '–');
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '–');

  const all = list.filter((r) => r.status !== 'running');
  let html = `<p class="totals"><b>${all.length}</b> remixes · <b>${money(sum(all.map((r) => r.costUsd)))}</b> total · <b>${dur(sum(all.map((r) => r.totalMs)))}</b> of generation · <b>${kTok(sum(all.map((r) => totals(r).output)))}</b> output tokens</p>`;
  html += `<h3>By model</h3><table><tr><th>Model</th><th>Remixes</th><th>Boots 1st try</th><th>Boots (w/ repairs)</th><th>Avg time</th><th>Avg tokens out</th><th>Avg cost</th><th>Total cost</th><th>Avg lines</th><th>Fun</th><th>Fusion</th><th>Works</th></tr>`;
  for (const [model, rs] of [...byModel].sort()) {
    const done = rs.filter((r) => r.status !== 'running' && r.status !== 'aborted');
    const ok = done.filter((r) => r.status === 'ok');
    const first = done.filter((r) => r.attempts[0]?.smoke?.ok);
    const rt = rs.flatMap((x) => x.ratings);
    html += `<tr><td>${esc(model)}</td><td>${done.length}</td><td>${pct(first.length, done.length)}</td><td>${pct(ok.length, done.length)}</td>
      <td>${dur(avg(ok.map((r) => r.totalMs)) || 0)}</td><td>${kTok(Math.round(avg(ok.map((r) => totals(r).output)) || 0))}</td>
      <td>${money(avg(done.map((r) => r.costUsd)) || 0)}</td><td>${money(sum(rs.map((r) => r.costUsd)))}</td><td>${fmt(avg(ok.map((r) => r.lines)), 0)}</td>
      <td>${fmt(avg(rt.map((x) => x.fun)))}</td><td>${fmt(avg(rt.map((x) => x.fusion)))}</td><td>${rt.length ? pct(rt.filter((x) => x.works).length, rt.length) : '–'}</td></tr>`;
  }
  html += `</table><h3>All remixes</h3><table class="remixes"><tr><th>When</th><th>Pair</th><th>Model</th><th>Status</th><th>Title</th><th>First play</th><th>Time</th><th>Tokens in / out</th><th>Cost</th><th>Attempts</th><th>Lines</th><th>Fun/Fusion</th><th></th></tr>`;
  for (const r of list) {
    const rt = r.ratings.at(-1);
    const t = totals(r);
    const stage = r.staged ? { pending: 'level 1 only', running: 'building…', done: 'full game', failed: 'level 1 only (build failed)' }[r.expansion || 'pending'] : '';
    const fixes = [stage, r.runtimeRepairs && `${r.runtimeRepairs} crash fix`, r.bugReports && `${r.bugReports} bug fix`].filter(Boolean).join(', ');
    const breakdown = r.attempts.map((a: Attempt) => `<li>#${a.n} ${a.kind} · ${dur(a.ms)}${a.firstCodeMs ? ` (code after ${dur(a.firstCodeMs)})` : ''} · ${kTok(a.usage.input + a.usage.cacheRead + a.usage.cacheWrite)} in / ${kTok(a.usage.output)} out · ${money(a.costUsd ?? 0)}${a.speed === 'fast' ? ' · fast' : ''} · ${a.smoke ? (a.smoke.ok ? 'boot test passed' : `failed (${esc(a.smoke.phase)})`) : a.stopReason === 'refusal' ? 'declined' : 'no test'}</li>`).join('');
    html += `<tr><td>${new Date(r.createdAt).toLocaleString()}</td><td>${esc(cartById.get(r.a)?.title || r.a)} × ${esc(cartById.get(r.b)?.title || r.b)}</td>
      <td>${esc(modelName(r))}${r.fast ? ' <span class="badge">fast</span>' : ''}<br><span class="muted">${r.effort || ''} · ${r.scope}</span></td>
      <td class="${r.status === 'ok' ? 'ok' : 'bad'}" title="${esc(r.failure || '')}">${r.status}${fixes ? `<br><span class="muted">${fixes}</span>` : ''}</td>
      <td class="title" title="${esc(r.pitch || '')}">${esc(r.title || '')}${r.expandFeedback ? `<br><span class="muted" title="${esc(r.expandFeedback)}">your notes: ${esc(r.expandFeedback.slice(0, 60))}${r.expandFeedback.length > 60 ? '…' : ''}</span>` : ''}</td>
      <td>${r.firstPlayableMs ? dur(r.firstPlayableMs) : '–'}</td><td>${dur(r.totalMs)}</td><td>${kTok(t.input)} / ${kTok(t.output)}</td><td>${money(r.costUsd)}</td>
      <td><details><summary>${r.attempts.length}</summary><ul>${breakdown}</ul></details></td>
      <td>${r.lines || '–'}</td><td>${rt ? `${rt.fun}/${rt.fusion}` : '–'}</td>
      <td class="actions">${r.status === 'ok' ? `<button data-play="${r.id}">Play</button>` : ''}${canBuild(r) ? `<button data-build="${r.id}" class="primary">Build full game</button>` : ''}${r.versions ? `<button data-prev="${r.id}" title="Play the version before the last change">Previous</button>` : ''}<button data-export="${r.id}">Export</button>${r.status === 'ok' ? `<button data-submit="${r.id}">Submit</button>` : ''}<button data-delete="${r.id}" class="danger">Delete</button></td></tr>`;
  }
  html += '</table>';
  if (!list.length) html = '<p>No remixes yet. Insert two cartridges to make one, or Import a <code>.vgremix.json</code> file.</p>';
  $('#results-body').innerHTML = html;
  $('#results').hidden = false;

  const byId = (id: string) => list.find((x) => x.id === id)!;
  const replay = async (meta: RemixMeta, version?: number) => {
    $('#results').hidden = true;
    // Replays leave the physical cartridges where they are; the TV just switches channel.
    const gen = ++generation;
    remixAbort?.abort();
    host.stop();
    world.powerTarget = 1;
    await playRemix(meta, gen, version);
    setFocus(true);
  };
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-play]')) b.onclick = () => replay(byId(b.dataset.play!));
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-prev]')) b.onclick = () => { const m = byId(b.dataset.prev!); void replay(m, m.versions); };
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-build]')) b.onclick = () => { $('#results').hidden = true; currentRemix = byId(b.dataset.build!); openBuild(currentRemix); };
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-export]')) b.onclick = async () => { const m = byId(b.dataset.export!); download(fileName(m), await exportRemix(idbStore, m.id)); };
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-delete]')) b.onclick = async () => {
    const m = byId(b.dataset.delete!);
    if (!confirm(`Delete "${m.title || m.id}" from this browser? Export it first if you want to keep it.`)) return;
    await idbStore.delete(m.id);
    void openResults();
  };
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-submit]')) b.onclick = async () => {
    const m = byId(b.dataset.submit!);
    if (!confirm('Submit this fusion to the DIGI-FUZE repo?\n\nThis downloads the remix file and opens a GitHub form in a new tab, where you attach the file.\n\nHeads up: submissions are welcome but may never be reviewed or merged, and there is no guarantee of a response.')) return;
    download(fileName(m), await exportRemix(idbStore, m.id));
    const t = totals(m);
    window.open(issueUrl('remix-submission.yml', {
      title: `[Remix] ${m.title}`, game_title: m.title, model: `${modelName(m)}${m.provider === 'openrouter' ? ' via OpenRouter' : ''}`, pitch: m.pitch,
      stats: `${cartById.get(m.a)?.title} x ${cartById.get(m.b)?.title} · ${m.scope} · effort ${m.effort || 'n/a'}${m.fast ? ' · fast' : ''}\n${dur(m.totalMs)} · ${t.input} in / ${t.output} out tokens · ${money(m.costUsd)} · ${m.attempts.length} attempt(s) · ${m.lines} lines`,
    }), '_blank', 'noopener');
  };
}

// ------------------------------------------------------------------ misc UI
$('#btn-eject').onclick = () => { world.ejectAll(); ($('#btn-eject') as HTMLButtonElement).blur(); };
$('#btn-focus').onclick = () => { setFocus(world.focusTarget < 0.5); ($('#btn-focus') as HTMLButtonElement).blur(); };
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) {
    if (e.code === 'Escape') { closeBug(); closeBuild(); $('#settings').hidden = true; }
    return;
  }
  if (mode === 'fusion' && (e.code === 'Enter' || e.code === 'KeyJ' || e.code === 'Space' || e.code === 'KeyZ')) { e.preventDefault(); fireFusion(); return; }
  if (e.code === 'Escape') { setFocus(false); $('#results').hidden = true; $('#settings').hidden = true; $('#info').hidden = true; closeBug(); closeBuild(); }
  if (e.code === 'KeyF') setFocus(world.focusTarget < 0.5);
  if (e.code === 'Enter' && mode === 'crash' && currentRemix && lastCrash) void startFix(currentRemix, 'crash-fix', { text: lastCrash });
});

function setFocus(on: boolean) {
  world.focusTarget = on ? 1 : 0;
  document.body.classList.toggle('focused', on);
  $('#btn-focus').textContent = on ? 'Back to desk' : 'Full screen';
}

function setStatus(s: string) { $('#status').textContent = s; syncNow(); }
/** The "now playing" section only shows when it has something to say: a status line, or the full-screen/build/bug buttons. */
function syncNow() {
  $('#btn-focus').hidden = mode === 'off' && world.focusTarget < 0.5;
  $('#btn-fuse').hidden = !(mode === 'fusion' && fusionView && !fusionView.firedAt && performance.now() - fusionView.startedAt > FUSION.merge * 1000);
  const busy = !!$('#status').textContent || ['#btn-focus', '#btn-fuse', '#btn-build', '#btn-bug'].some((s) => !$(s).hidden);
  $('#now').hidden = !busy;
}
world.powerTarget = 1; // the TV starts on, showing "insert cartridge"
syncNow();

$('#btn-fuse').onclick = () => { fireFusion(); ($('#btn-fuse') as HTMLButtonElement).blur(); };
$('#btn-info').onclick = () => { $('#info').hidden = false; ($('#btn-info') as HTMLButtonElement).blur(); };
$('#info-close').onclick = () => { $('#info').hidden = true; };

// ------------------------------------------------------------------ main loop
let frames = 0;
const prevHeld: Record<string, boolean> = {};
function frame() {
  requestAnimationFrame(frame);
  frames++;
  const t = performance.now() / 1000;
  if (mode === 'remix' && remixView) screen.remix(remixView, t);
  else if (mode === 'fusion' && fusionView) screen.fusion(fusionView, performance.now());
  else if (mode === 'done' && doneCard) screen.done(doneCard.heading, doneCard.title, doneCard.pitch, doneCard.rows, t);
  else if (mode === 'loading') screen.loading(loadingLabel, t);
  else if (mode === 'crash') screen.crash(crashInfo.title, crashInfo.msg, crashInfo.hint);
  else if (mode === 'off') screen.idle(t);
  const osdLeft = osd.until - performance.now();
  if (osdLeft > 0) screen.osd(KNOB_LABELS[osd.i], world.knobValues[osd.i], Math.min(1, osdLeft / 300));
  if (mode === 'game') for (const b of BUTTONS) {
    if (!!input.held[b] !== !!prevHeld[b]) { note(`${b.toUpperCase()} ${input.held[b] ? 'down' : 'up'}`); prevHeld[b] = input.held[b]; }
  }
  world.setPadState(input.held);
  world.update();
  if (frames % 15 === 0) syncNow(); // buttons are toggled in many places; keep the section's visibility in step
}
frame();

Object.assign(window, { __vgr: { world, host, slots, refresh, picker, get frames() { return frames; } } });

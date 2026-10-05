// The remix pipeline: prompt a model with two cartridges, stream its output, boot-test the result in a
// sandbox, let it repair failures, and record everything (time, tokens, cost) for the model comparison.
// Provider-, storage- and sandbox-neutral: the browser and the Node CLI plug in their own pieces.
import type { Attempt, AttemptResult, CartSource, Emit, LlmAdapter, ModelInfo, RemixMeta, RemixStore, Scope, SmokeResult, Transcript, TurnMessage } from './types';
import { systemPrompt, remixRequest, expandRequest, repairRequest, runtimeRepairRequest, bugReportRequest, parseResponse, PROMPT_VERSION, STAGED_PROMPT_VERSION } from './prompt';
import { estimateCost } from './models';

export interface PipelineDeps {
  llm: LlmAdapter;
  smoke(code: string): Promise<SmokeResult>;
  store: RemixStore;
  emit: Emit;
  signal: AbortSignal;
}

export interface RemixOptions {
  a: CartSource;
  b: CartSource;
  model: ModelInfo;
  effort?: string | null;
  fast?: boolean;
  repairs?: number; // max repair rounds after a failed boot test (default 1)
  scope?: Scope;
  apiSpec: string;  // docs/CARTRIDGE_API.md
  /** Level 1 only (playable fast). The player can then ask for the rest with runExpand(). */
  staged?: boolean;
}

export function newRemixId(a: string, b: string, model: string) {
  const t = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const rnd = Math.random().toString(36).slice(2, 6);
  const m = model.replace(/^claude-/, '').replace(/^.*\//, '');
  return `${t}-${a}-x-${b}-${m}-${rnd}`.toLowerCase().replace(/[^a-z0-9-]/g, '');
}

export async function runRemix(o: RemixOptions, d: PipelineDeps): Promise<RemixMeta> {
  const { model } = o;
  const effort = model.efforts.length ? (o.effort && model.efforts.includes(o.effort) ? o.effort : model.defaultEffort ?? null) : null;
  const meta: RemixMeta = {
    id: newRemixId(o.a.id, o.b.id, model.id),
    createdAt: new Date().toISOString(),
    a: o.a.id, b: o.b.id, provider: model.provider, model: model.id, modelLabel: model.label, effort,
    fast: !!(o.fast && model.fast), scope: o.scope === 'quick' ? 'quick' : 'full', promptVersion: o.staged ? STAGED_PROMPT_VERSION : PROMPT_VERSION,
    staged: !!o.staged, title: '', pitch: '', status: 'running', attempts: [], totalMs: 0, lines: 0, costUsd: 0, ratings: [],
  };
  await d.store.saveMeta(meta);
  d.emit('start', { id: meta.id });
  const transcript: Transcript = {
    provider: model.provider,
    system: systemPrompt(o.apiSpec),
    messages: [{ role: 'user', text: remixRequest({ title: o.a.title, source: o.a.source }, { title: o.b.title, source: o.b.source }, meta.scope, meta.staged) }],
  };
  await attemptLoop(meta, model, transcript, Math.max(0, Math.min(o.repairs ?? 1, 3)) + 1, 'remix', d);
  if (meta.status === 'ok') {
    meta.firstPlayableMs = meta.totalMs;
    if (meta.staged) meta.expansion = 'pending';
  }
  await d.store.saveMeta(meta);
  return meta;
}

/**
 * Step 2 of a staged remix, when the player asks for it: add levels 2..N in the same conversation.
 * The level-1 version is archived and stays playable; if this fails, the level-1 game is kept.
 */
export async function runExpand(id: string, model: ModelInfo, d: PipelineDeps, feedback = '', repairs = 1): Promise<RemixMeta> {
  const meta = await d.store.loadMeta(id);
  const transcript = await d.store.loadTranscript(id);
  if (!meta || !transcript) throw new Error('This remix has no saved conversation to continue.');
  if (transcript.provider !== model.provider) throw new Error(`This remix was made through ${transcript.provider}; connect that provider to continue it.`);
  transcript.messages.push({ role: 'user', text: expandRequest(meta.scope, feedback.slice(0, 3000)) });
  meta.expansion = 'running';
  if (feedback.trim()) meta.expandFeedback = feedback.trim().slice(0, 3000);
  await d.store.saveMeta(meta);
  d.emit('start', { id: meta.id, expand: true });
  const before = meta.attempts.length;
  await attemptLoop(meta, model, transcript, Math.max(0, Math.min(repairs, 3)) + 1, 'expand', d);
  meta.expansion = meta.attempts.slice(before).some((a) => a.smoke?.ok) ? 'done' : d.signal.aborted ? 'pending' : 'failed';
  await d.store.saveMeta(meta);
  return meta;
}

/**
 * A playable remix that crashed (crash-fix) or that the player says is broken (bug-fix): send the problem back to
 * the same model in the same, append-only conversation and ship the fix as a new version. The old version is archived.
 */
export async function runFix(
  id: string, kind: 'crash-fix' | 'bug-fix', report: { text: string; recent?: string; imagePng?: string }, model: ModelInfo, d: PipelineDeps,
): Promise<RemixMeta> {
  const meta = await d.store.loadMeta(id);
  const transcript = await d.store.loadTranscript(id);
  if (!meta || !transcript) throw new Error('This remix has no saved conversation to continue.');
  if (transcript.provider !== model.provider) throw new Error(`This remix was made through ${transcript.provider}; connect that provider to fix it.`);
  const text = kind === 'crash-fix' ? runtimeRepairRequest(report.text.slice(0, 4000)) : bugReportRequest(report.text.slice(0, 2000), (report.recent || 'n/a').slice(0, 3000));
  transcript.messages.push({ role: 'user', text, imagePng: kind === 'bug-fix' ? report.imagePng : undefined });
  if (kind === 'crash-fix') meta.runtimeRepairs = (meta.runtimeRepairs || 0) + 1;
  else meta.bugReports = (meta.bugReports || 0) + 1;
  meta.status = 'running';
  await d.store.saveMeta(meta);
  d.emit('start', { id: meta.id, fix: kind });
  return attemptLoop(meta, model, transcript, 2, kind, d);
}

async function attemptLoop(meta: RemixMeta, model: ModelInfo, t: Transcript, maxAttempts: number, firstKind: Attempt['kind'], d: PipelineDeps): Promise<RemixMeta> {
  const t0 = Date.now();
  let finalCode: string | null = null;
  try {
    for (let k = 1; k <= maxAttempts; k++) {
      const n = meta.attempts.length + 1;
      const kind: Attempt['kind'] = k === 1 ? firstKind : 'repair';
      d.emit('phase', { phase: kind === 'remix' ? 'thinking' : kind === 'expand' ? 'expanding' : 'repairing', attempt: n });
      let streamed = '', wrote = false;
      const res: AttemptResult = await d.llm.attempt({
        model, effort: meta.effort, fast: !!meta.fast, system: t.system, messages: t.messages, signal: d.signal,
        onThinking: (s) => d.emit('thinking', { text: s }),
        onText: (s) => {
          d.emit('text', { text: s });
          streamed += s;
          if (!wrote && streamed.includes('```')) { wrote = true; d.emit('phase', { phase: 'writing' }); }
        },
      });
      const cost = res.costUsd ?? estimateCost(model.price, res.usage, res.speed === 'fast');
      d.emit('usage', { output: res.usage.output, input: res.usage.input, costUsd: cost, speed: res.speed });

      const parsed = parseResponse(res.text);
      if (!meta.title || (kind === 'remix' && parsed.title !== 'UNTITLED REMIX')) { meta.title = parsed.title; meta.pitch = parsed.pitch || meta.pitch; }
      d.emit('meta', { title: meta.title, pitch: meta.pitch });

      const attempt: Attempt = {
        n, kind, stopReason: res.stopReason, usage: res.usage, costUsd: cost, speed: res.speed,
        ms: res.ms, ttftMs: res.ttftMs, firstCodeMs: res.firstCodeMs, smoke: null, extracted: !!parsed.code,
      };
      meta.attempts.push(attempt);
      meta.costUsd += cost;
      t.messages.push({ role: 'assistant', raw: res.raw } satisfies TurnMessage);
      await d.store.saveTranscript(meta.id, t);

      let problem: string;
      if (res.stopReason === 'refusal') {
        meta.status = 'failed';
        meta.failure = 'The model declined this request.';
        break;
      }
      if (!parsed.code) {
        problem = 'No ```javascript code block was found in your response.';
      } else if (res.stopReason === 'max_tokens') {
        problem = `Your response hit the output limit (${model.maxOutput} tokens) before the code block finished. Write a more compact version.`;
        attempt.smoke = { ok: false, phase: 'truncated' };
      } else {
        d.emit('phase', { phase: 'testing', attempt: n });
        const smoke = await d.smoke(parsed.code);
        attempt.smoke = smoke;
        d.emit('test', smoke);
        // The test sandbox itself couldn't start: that's our problem, not the model's. Don't bill a repair for it.
        if (smoke.phase === 'infra') throw new Error(`${smoke.error} Nothing was sent back to the model. Reload the page and try again.`);
        if (smoke.ok) { finalCode = parsed.code; break; }
        problem = `Phase: ${smoke.phase}\n${smoke.error || 'unknown error'}${smoke.frames ? `\n(after ${smoke.frames} frames of simulated play)` : ''}`;
      }
      meta.failure = problem;
      await d.store.saveMeta(meta);
      if (k >= maxAttempts) break;
      t.messages.push({ role: 'user', text: repairRequest(problem) });
    }
  } catch (e) {
    if (d.signal.aborted) { meta.status = 'aborted'; meta.failure = 'Stopped before it finished.'; }
    else { meta.status = 'failed'; meta.failure = String((e as Error)?.message || e); }
  }

  meta.totalMs += Date.now() - t0;
  if (finalCode) {
    const previous = await d.store.loadSource(meta.id);
    if (previous) {
      meta.versions = (meta.versions || 0) + 1;
      await d.store.archiveSource(meta.id, meta.versions, previous);
    }
    meta.status = 'ok';
    delete meta.failure;
    meta.lines = finalCode.split('\n').length;
    await d.store.saveSource(meta.id, finalCode);
  } else if (await d.store.loadSource(meta.id)) {
    meta.status = 'ok'; // a failed or stopped fix/expansion keeps the previous playable version
  } else if (meta.status === 'running' || meta.status === 'ok') {
    meta.status = 'failed';
  }
  await d.store.saveMeta(meta);
  return meta;
}

/** Portable single-file export: what the Submit button downloads and Import reads. */
export interface RemixExport { format: 'vgremix'; version: 1; meta: RemixMeta; source: string | null; transcript: Transcript | null }

export async function exportRemix(store: RemixStore, id: string): Promise<RemixExport> {
  const meta = await store.loadMeta(id);
  if (!meta) throw new Error('No such remix');
  return { format: 'vgremix', version: 1, meta, source: await store.loadSource(id), transcript: await store.loadTranscript(id) };
}

export async function importRemix(store: RemixStore, data: RemixExport): Promise<RemixMeta> {
  if (data?.format !== 'vgremix' || !data.meta?.id) throw new Error('Not a DIGI-FUZE export file.');
  const meta = { ...data.meta, status: data.source ? 'ok' : data.meta.status } as RemixMeta;
  if (meta.status === 'running') meta.status = 'aborted';
  await store.saveMeta(meta);
  if (data.source) await store.saveSource(meta.id, data.source);
  if (data.transcript) await store.saveTranscript(meta.id, data.transcript);
  return meta;
}

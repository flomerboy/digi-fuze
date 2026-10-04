// OpenRouter provider: one OpenAI-style chat completions endpoint in front of hundreds of models.
// Runs in the browser with the visitor's own key (BYOK) — OpenRouter allows CORS from any origin,
// so there is no backend. Streams over SSE, reports reasoning separately from the answer, and
// returns the exact billed cost that OpenRouter puts in the final usage chunk.
//
// API reference (verified 2026-10):
//   streaming   https://openrouter.ai/docs/api/reference/streaming
//   usage/cost  https://openrouter.ai/docs/use-cases/usage-accounting
//   reasoning   https://openrouter.ai/docs/use-cases/reasoning-tokens
//   images      https://openrouter.ai/docs/guides/overview/multimodal/image-understanding
//   errors      https://openrouter.ai/docs/api-reference/errors
//   models      https://openrouter.ai/docs/guides/overview/models
//   attribution https://openrouter.ai/docs/app-attribution
import type { AttemptRequest, AttemptResult, LlmAdapter, ModelInfo, TurnMessage, Usage } from './types';

const API = 'https://openrouter.ai/api/v1';
const APP_TITLE = 'DIGI-FUZE';

/** Ids of models whose listing says they can't take image input (filled by fetchOpenRouterModels). */
const textOnlyModels = new Set<string>();

/** App attribution headers. HTTP-Referer is the primary identifier; X-OpenRouter-Title is the display name. */
function appHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'X-OpenRouter-Title': APP_TITLE };
  const origin = typeof location !== 'undefined' ? location.origin : '';
  if (origin && origin.startsWith('http')) h['HTTP-Referer'] = origin;
  return h;
}

// ---------------------------------------------------------------------------------------------
// Errors

/** Turn an OpenRouter error (HTTP status or mid-stream error code) into a short message for the UI. */
function describeError(code: number | string | undefined, message: string | undefined, modelId: string): string {
  const detail = (message || '').trim().slice(0, 300);
  switch (Number(code)) {
    case 400: return `OpenRouter rejected the request${detail ? `: ${detail}` : '.'}`;
    case 401: return 'OpenRouter rejected your key — check it, or connect again.';
    case 402: return 'Your OpenRouter account is out of credits — top up at openrouter.ai/settings/credits.';
    case 403: return `OpenRouter blocked the request (moderation or permissions)${detail ? `: ${detail}` : '.'}`;
    case 404: return `Model ${modelId} isn't available on OpenRouter.`;
    case 408: return 'OpenRouter timed out — try again.';
    case 413: return 'The request is too large for this model.';
    case 429: return 'Rate limited by OpenRouter — wait a moment and try again.';
    case 502: return `${modelId} is down or sent an invalid response — try again or pick another model.`;
    case 503: return `No provider is currently serving ${modelId} — try another model.`;
  }
  // Mid-stream errors carry string codes like "server_error".
  return `OpenRouter error${code ? ` (${code})` : ''}${detail ? `: ${detail}` : ''}`;
}

async function httpError(res: Response, modelId: string): Promise<Error> {
  let message = '';
  try {
    const body = await res.json();
    message = body?.error?.message || '';
    // Upstream provider details, when present, are usually the useful part of a 400.
    const raw = body?.error?.metadata?.raw;
    if (res.status === 400 && typeof raw === 'string' && raw.length < 300) message += ` (${raw})`;
  } catch { /* non-JSON body */ }
  return new Error(describeError(res.status, message, modelId));
}

// ---------------------------------------------------------------------------------------------
// Request mapping

/** Provider-neutral transcript → OpenAI-style chat messages. */
function toChatMessages(system: string, messages: TurnMessage[], modelId: string): unknown[] {
  const out: unknown[] = [];
  if (system) out.push({ role: 'system', content: system });
  for (const m of messages) {
    if (m.role === 'assistant') {
      // Replay exactly what we stored (content + reasoning_details), falling back to plain text.
      out.push(m.raw ?? { role: 'assistant', content: m.text ?? '' });
      continue;
    }
    if (!m.imagePng) { out.push({ role: 'user', content: m.text ?? '' }); continue; }
    // Docs recommend text first, then images. Models that can't see images get a note instead.
    if (textOnlyModels.has(modelId)) {
      out.push({ role: 'user', content: `${m.text ?? ''}\n\n[A screenshot was attached, but this model can't view images.]` });
      continue;
    }
    out.push({
      role: 'user',
      content: [
        { type: 'text', text: m.text ?? '' },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${m.imagePng}` } },
      ],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// SSE

/**
 * Yields the `data:` payload of each server-sent event. Handles events split across network chunks,
 * CRLF line endings, multi-line data fields, and comment lines (OpenRouter sends `: OPENROUTER
 * PROCESSING` keep-alives that must be skipped, not JSON-parsed).
 */
async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let data: string[] = [];
  const flushLine = function* (line: string): Generator<string> {
    if (line === '') {
      if (data.length) { yield data.join('\n'); data = []; }
    } else if (line.startsWith(':')) {
      // comment / keep-alive
    } else if (line.startsWith('data:')) {
      data.push(line.slice(line[5] === ' ' ? 6 : 5));
    } // other SSE fields (event:, id:, retry:) aren't used by OpenRouter
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        yield* flushLine(line);
      }
    }
    buf += decoder.decode();
    if (buf) yield* flushLine(buf.replace(/\r$/, ''));
    yield* flushLine('');
  } finally {
    reader.releaseLock();
  }
}

/** One entry of `reasoning_details`; streamed in pieces that share an `index`. */
interface ReasoningDetail { type?: string; index?: number; text?: string; summary?: string; data?: string; [k: string]: unknown }

/** Merge a streamed reasoning_details piece into the accumulated list (same index ⇒ append strings). */
function mergeReasoningDetail(acc: ReasoningDetail[], piece: ReasoningDetail) {
  const prev = typeof piece.index === 'number' ? acc.find((d) => d.index === piece.index) : undefined;
  if (!prev) { acc.push({ ...piece }); return; }
  for (const [k, v] of Object.entries(piece)) {
    if ((k === 'text' || k === 'summary' || k === 'data') && typeof v === 'string') prev[k] = ((prev[k] as string) || '') + v;
    else if (v !== undefined && v !== null) prev[k] = v; // signature, id, format, type: latest wins
  }
}

const STOP_REASONS: Record<string, string> = {
  stop: 'end_turn',
  length: 'max_tokens',
  content_filter: 'refusal',
  tool_calls: 'tool_use',
  error: 'error',
};

// ---------------------------------------------------------------------------------------------
// Adapter

export function createOpenRouterAdapter(apiKey: string): LlmAdapter {
  return {
    provider: 'openrouter',
    async attempt(req: AttemptRequest): Promise<AttemptResult> {
      const t0 = performance.now();
      const modelId = req.model.id;
      const body: Record<string, unknown> = {
        model: modelId,
        messages: toChatMessages(req.system, req.messages, modelId),
        stream: true,
        // Docs mark max_tokens deprecated in favour of max_completion_tokens, but max_tokens is what
        // every model lists in supported_parameters, so it's the one guaranteed to be honoured.
        max_tokens: req.model.maxOutput,
      };
      if (req.effort && req.model.efforts.length) body.reasoning = { effort: req.effort };
      // Usage (tokens + exact cost) is now always included in the final chunk; no flag needed.

      const res = await fetch(`${API}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...appHeaders() },
        body: JSON.stringify(body),
        signal: req.signal,
      });
      if (!res.ok) throw await httpError(res, modelId);
      if (!res.body) throw new Error('OpenRouter returned an empty response.');

      let text = '';
      let reasoning = '';
      const details: ReasoningDetail[] = [];
      let finish: string | null = null;
      let usage: any = null;
      let ttftMs: number | null = null;
      let firstCodeMs: number | null = null;
      let sawDone = false;
      const mark = () => { if (ttftMs === null) ttftMs = Math.round(performance.now() - t0); };

      for await (const payload of sseEvents(res.body)) {
        if (payload === '[DONE]') { sawDone = true; break; }
        let chunk: any;
        try { chunk = JSON.parse(payload); } catch { continue; } // tolerate a malformed line
        if (chunk.error) throw new Error(describeError(chunk.error.code, chunk.error.message, modelId));
        if (chunk.usage) usage = chunk.usage;
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) finish = choice.finish_reason;
        const delta = choice.delta ?? {};

        // Reasoning arrives twice: plain text in delta.reasoning and structured delta.reasoning_details.
        // Stream the plain text; keep the details for replay (docs: pass them back unmodified).
        let thought = typeof delta.reasoning === 'string' ? delta.reasoning : '';
        if (Array.isArray(delta.reasoning_details)) {
          for (const d of delta.reasoning_details as ReasoningDetail[]) {
            mergeReasoningDetail(details, d);
            if (!delta.reasoning) thought += typeof d.text === 'string' ? d.text : typeof d.summary === 'string' ? d.summary : '';
          }
        }
        if (thought) { mark(); reasoning += thought; req.onThinking(thought); }

        if (typeof delta.content === 'string' && delta.content) {
          mark();
          text += delta.content;
          if (firstCodeMs === null && text.includes('```')) firstCodeMs = Math.round(performance.now() - t0);
          req.onText(delta.content);
        }
      }
      if (!sawDone && !finish && !text) throw new Error('OpenRouter closed the stream before the model answered — try again.');

      // OpenAI-style prompt_tokens include cached tokens; Usage counts them separately (as Anthropic does).
      const cacheRead = usage?.prompt_tokens_details?.cached_tokens ?? 0;
      const cacheWrite = usage?.prompt_tokens_details?.cache_write_tokens ?? 0;
      const u: Usage = {
        input: Math.max(0, (usage?.prompt_tokens ?? 0) - cacheRead - cacheWrite),
        output: usage?.completion_tokens ?? 0, // includes reasoning tokens
        cacheRead,
        cacheWrite,
      };

      // What we'd replay next turn: the answer plus reasoning_details (or plain reasoning as fallback).
      const raw: Record<string, unknown> = { role: 'assistant', content: text };
      if (details.length) raw.reasoning_details = details;
      else if (reasoning) raw.reasoning = reasoning;

      return {
        text,
        raw,
        stopReason: finish ? (STOP_REASONS[finish] ?? finish) : null,
        usage: u,
        costUsd: typeof usage?.cost === 'number' ? usage.cost : null,
        speed: 'standard',
        ms: Math.round(performance.now() - t0),
        ttftMs,
        firstCodeMs,
      };
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Model list

const CACHE_KEY = 'vgr:or-models';
const CACHE_TTL = 24 * 60 * 60 * 1000;
const MAX_OUTPUT_CAP = 128000;
const MAX_OUTPUT_FALLBACK = 32000;

interface CachedModels { at: number; models: ModelInfo[]; textOnly: string[] }

/**
 * Featured picks, chosen by pattern + newest `created` so they follow new releases without edits.
 * Variants (`:batch`, `:free`), `~…-latest` aliases, previews and expiring models are never featured.
 */
const FEATURED: { match: (m: any) => boolean; blurb: string }[] = [
  { match: (m) => /^anthropic\/claude-fable-/.test(m.id), blurb: "Anthropic's most powerful, priciest" },
  { match: (m) => /^anthropic\/claude-opus-/.test(m.id), blurb: "Anthropic's top all-rounder" },
  { match: (m) => /^anthropic\/claude-sonnet-/.test(m.id), blurb: "Anthropic's best balance" },
  {
    match: (m) => /^openai\/gpt-\d/.test(m.id) && !/-(pro|mini|nano|chat|codex|image|audio|realtime|search|oss|instant)\b/.test(m.id),
    blurb: 'OpenAI flagship',
  },
  {
    match: (m) => /^google\/gemini-\d/.test(m.id) && !/-(lite|image|tts|audio|live|customtools|embedding)\b/.test(m.id),
    blurb: 'Google flagship',
  },
  {
    // Open weights: has a Hugging Face repo, from a lab with strong large models, not a small/flash tier.
    match: (m) => !!m.hugging_face_id
      && /^(deepseek|qwen|z-ai|moonshotai|meta-llama|mistralai)\//.test(m.id)
      && !/(flash|mini|small|lite|nano|tiny|vision|omni|exp|coder?\b|-\d{1,2}b\b)/.test(m.id),
    blurb: 'Strong open-weight model',
  },
];

const perMillion = (s: unknown): number | null => {
  const n = typeof s === 'string' || typeof s === 'number' ? Number(s) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1e6 * 1e4) / 1e4 : null; // routers report -1
};

function toModelInfo(m: any): ModelInfo {
  const pin = perMillion(m.pricing?.prompt), pout = perMillion(m.pricing?.completion);
  let maxOutput = Number(m.top_provider?.max_completion_tokens) || MAX_OUTPUT_FALLBACK;
  // Some listings give max output == context length; leave room for the prompt.
  const ctx = Number(m.context_length) || 0;
  if (ctx && maxOutput >= ctx) maxOutput = Math.floor(ctx / 2);
  maxOutput = Math.min(maxOutput, MAX_OUTPUT_CAP);
  const reasoning = Array.isArray(m.supported_parameters) && m.supported_parameters.includes('reasoning');
  return {
    key: `openrouter:${m.id}`,
    provider: 'openrouter',
    id: m.id,
    label: m.name || m.id,
    maxOutput,
    thinking: 'none',
    efforts: reasoning ? ['low', 'medium', 'high'] : [],
    defaultEffort: reasoning ? 'medium' : undefined,
    price: pin !== null && pout !== null ? [pin, pout] : null,
  };
}

function buildModelList(raw: any[]): CachedModels {
  const now = Date.now() / 1000;
  const usable = raw.filter((m) =>
    m && typeof m.id === 'string'
    && !m.id.endsWith(':batch') // async batch endpoints, not for interactive streaming
    && (m.architecture?.output_modalities ?? ['text']).includes('text')
    && !(m.expiration_date && Date.parse(m.expiration_date) / 1000 < now));
  usable.sort((a, b) => (b.created || 0) - (a.created || 0));

  const featurable = usable.filter((m) =>
    !m.id.includes(':') && !m.id.startsWith('~') && !m.expiration_date
    && !/-(preview|exp|beta|alpha)\b/.test(m.id) && (m.architecture?.input_modalities ?? ['text']).includes('text'));
  const featured: ModelInfo[] = [];
  const featuredIds = new Set<string>();
  for (const slot of FEATURED) {
    // Newest first; on a same-day tie prefer the pricier (usually larger) model.
    const pick = featurable
      .filter((m) => !featuredIds.has(m.id) && slot.match(m))
      .sort((a, b) => (b.created || 0) - (a.created || 0) || Number(b.pricing?.completion || 0) - Number(a.pricing?.completion || 0))[0];
    if (!pick) continue;
    featuredIds.add(pick.id);
    featured.push({ ...toModelInfo(pick), featured: true, blurb: slot.blurb });
  }

  const models = [...featured, ...usable.filter((m) => !featuredIds.has(m.id)).map(toModelInfo)];
  const textOnly = usable.filter((m) => !(m.architecture?.input_modalities ?? []).includes('image')).map((m) => m.id);
  return { at: Date.now(), models, textOnly };
}

function readCache(): CachedModels | null {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null') as CachedModels | null;
    return c && Array.isArray(c.models) && typeof c.at === 'number' ? c : null;
  } catch { return null; }
}

function useCache(c: CachedModels): ModelInfo[] {
  textOnlyModels.clear();
  for (const id of c.textOnly ?? []) textOnlyModels.add(id);
  return c.models;
}

let modelsPromise: Promise<ModelInfo[]> | null = null;

/** The public OpenRouter model list (no key needed), featured picks first. Cached 24h in memory + localStorage. */
export function fetchOpenRouterModels(): Promise<ModelInfo[]> {
  return (modelsPromise ??= (async () => {
    const cached = readCache();
    if (cached && Date.now() - cached.at < CACHE_TTL) return useCache(cached);
    try {
      const res = await fetch(`${API}/models`, { headers: appHeaders() });
      if (!res.ok) throw new Error(`Couldn't load the OpenRouter model list (HTTP ${res.status}).`);
      const json = await res.json();
      if (!Array.isArray(json?.data)) throw new Error("Couldn't read the OpenRouter model list.");
      const built = buildModelList(json.data);
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(built)); } catch { /* quota / disabled */ }
      return useCache(built);
    } catch (e) {
      if (cached) return useCache(cached); // stale beats nothing
      modelsPromise = null; // allow a retry later
      throw e;
    }
  })());
}

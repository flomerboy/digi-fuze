// Anthropic provider, via the official SDK. Works in the browser (visitor's own key, sent straight to
// api.anthropic.com) and in Node (the CLI, which reads ANTHROPIC_API_KEY from the environment).
// Deliberately no refusal fallback to another model: every result must be attributable to the model that was picked.
import Anthropic from '@anthropic-ai/sdk';
import type { AttemptRequest, AttemptResult, LlmAdapter, TurnMessage } from './types';

const FAST_BETA = 'fast-mode-2026-02-01';

/** apiKey omitted = let the SDK find credentials itself (Node CLI). */
export function createAnthropicAdapter(apiKey?: string): LlmAdapter {
  const client = new Anthropic({
    ...(apiKey ? { apiKey } : {}),
    dangerouslyAllowBrowser: typeof window !== 'undefined', // BYOK: the visitor's key never leaves their browser except to Anthropic
    maxRetries: 2,
    timeout: 30 * 60 * 1000,
  });

  async function attempt(req: AttemptRequest): Promise<AttemptResult> {
    try {
      return await run(req, req.fast);
    } catch (e) {
      // Fast mode has its own rate limit. If it's exhausted, finish the job at standard speed (recorded per attempt).
      if (req.fast && e instanceof Anthropic.RateLimitError) {
        try { return await run(req, false); } catch (e2) { throw new Error(errorText(e2)); }
      }
      throw new Error(errorText(e));
    }
  }

  async function run(req: AttemptRequest, fast: boolean): Promise<AttemptResult> {
    const t0 = Date.now();
    let ttft: number | null = null, firstCode: number | null = null, text = '';
    const params: Record<string, unknown> = {
      model: req.model.id,
      max_tokens: req.model.maxOutput,
      system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
      messages: req.messages.map(toParam),
    };
    if (req.model.thinking === 'adaptive') params.thinking = { type: 'adaptive', display: 'summarized' };
    if (req.effort) params.output_config = { effort: req.effort };
    if (fast) { params.speed = 'fast'; params.betas = [FAST_BETA]; }

    // Fast mode lives on the beta endpoint; standard requests use the regular one.
    const stream = fast
      ? client.beta.messages.stream(params as any, { signal: req.signal })
      : client.messages.stream(params as any, { signal: req.signal });
    for await (const ev of stream as AsyncIterable<any>) {
      if (ev.type !== 'content_block_delta') continue;
      if (ttft == null) ttft = Date.now() - t0;
      if (ev.delta.type === 'thinking_delta') req.onThinking(ev.delta.thinking);
      else if (ev.delta.type === 'text_delta') {
        text += ev.delta.text;
        if (firstCode == null && text.includes('```')) firstCode = Date.now() - t0;
        req.onText(ev.delta.text);
      }
    }
    const msg: any = await stream.finalMessage();
    const u = msg.usage;
    return {
      text,
      raw: msg.content,
      stopReason: msg.stop_reason,
      usage: { input: u.input_tokens, output: u.output_tokens, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 },
      costUsd: null,
      speed: u.speed === 'fast' || (fast && u.speed == null) ? 'fast' : 'standard',
      ms: Date.now() - t0,
      ttftMs: ttft,
      firstCodeMs: firstCode,
    };
  }

  return { provider: 'anthropic', attempt };
}

function toParam(m: TurnMessage): Anthropic.MessageParam {
  if (m.role === 'assistant') return { role: 'assistant', content: m.raw as Anthropic.ContentBlockParam[] };
  const content: Anthropic.ContentBlockParam[] = [];
  if (m.imagePng) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: m.imagePng } });
  content.push({ type: 'text', text: m.text || '' });
  return { role: 'user', content };
}

function errorText(e: unknown) {
  if (e instanceof Anthropic.AuthenticationError) return 'Anthropic rejected the API key. Check it under Keys.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'This API key is not allowed to use that model.';
  if (e instanceof Anthropic.NotFoundError) return 'Model not found (404). Is it available to this API key?';
  if (e instanceof Anthropic.RateLimitError) return 'Rate limited (429). Try again shortly.';
  if (e instanceof Anthropic.APIConnectionError) return 'Could not reach api.anthropic.com. Check your connection.';
  if (e instanceof Anthropic.APIError) return `API error ${e.status ?? ''}: ${e.message}`;
  return String((e as Error)?.message || e);
}

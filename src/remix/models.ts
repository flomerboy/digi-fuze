// Claude models offered for remixes through the Anthropic API. (OpenRouter models are listed live; see openrouter.ts.)
// Prices are USD per million tokens [input, output], used for the cost shown in stats.
import type { ModelInfo } from './types';

const ALL = ['low', 'medium', 'high', 'xhigh', 'max'];

const claude = (id: string, label: string, price: [number, number], extra: Partial<ModelInfo> = {}): ModelInfo => ({
  key: `anthropic:${id}`, provider: 'anthropic', id, label, maxOutput: 128000, thinking: 'adaptive',
  efforts: ALL, defaultEffort: 'medium', price, ...extra,
});

export const ANTHROPIC_MODELS: ModelInfo[] = [
  claude('claude-opus-5-5', 'Claude Opus 5.5', [4, 20], { featured: true, fast: true, blurb: 'Best balance' }),
  claude('claude-sonnet-5-5', 'Claude Sonnet 5.5', [2, 10], { featured: true, blurb: 'Cheaper, quicker' }),
  claude('claude-fable-5-1', 'Claude Fable 5.1', [10, 50], { featured: true, blurb: 'Most capable, priciest' }),
  claude('claude-haiku-5-5', 'Claude Haiku 5.5', [0.1, 0.5]),
  claude('claude-opus-5', 'Claude Opus 5', [5, 25], { fast: true }),
  claude('claude-sonnet-5', 'Claude Sonnet 5', [2, 10]),
  claude('claude-opus-4-8', 'Claude Opus 4.8', [5, 25], { fast: true }),
  claude('claude-opus-4-7', 'Claude Opus 4.7', [5, 25]),
  claude('claude-opus-4-6', 'Claude Opus 4.6', [5, 25], { efforts: ['low', 'medium', 'high', 'max'] }),
  claude('claude-sonnet-4-6', 'Claude Sonnet 4.6', [3, 15], { efforts: ['low', 'medium', 'high', 'max'] }),
  claude('claude-haiku-4-5', 'Claude Haiku 4.5', [1, 5], { maxOutput: 64000, thinking: 'none', efforts: [], defaultEffort: undefined }),
];

export const DEFAULT_MODEL_KEY = 'anthropic:claude-opus-5-5';

/** Fast mode runs the same model at up to ~2.5x output speed for 2x the price. */
export const FAST_PRICE_MULTIPLIER = 2;

/** Cost estimate from token usage when the provider doesn't report an exact figure. */
export function estimateCost(price: [number, number] | null, u: { input: number; output: number; cacheRead: number; cacheWrite: number }, fast = false): number {
  if (!price) return 0;
  const [pin, pout] = price.map((p) => p * (fast ? FAST_PRICE_MULTIPLIER : 1));
  return (u.input * pin + u.cacheWrite * pin * 1.25 + u.cacheRead * pin * 0.1 + u.output * pout) / 1e6;
}

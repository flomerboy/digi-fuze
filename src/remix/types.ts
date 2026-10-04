// Shared types for the remix pipeline. Runs in the browser (published BYOK site) and in Node (CLI).

export type Scope = 'full' | 'quick';
export type Provider = 'anthropic' | 'openrouter';
export type Emit = (event: string, data: any) => void;

/** One entry in the model picker. */
export interface ModelInfo {
  /** Unique key in the picker, e.g. 'anthropic:claude-opus-5-5' or 'openrouter:anthropic/claude-opus-5.5'. */
  key: string;
  provider: Provider;
  /** The provider's model id sent in the request. */
  id: string;
  label: string;
  /** One-line hint shown in the picker ("best balance", "cheaper, faster", …). */
  blurb?: string;
  maxOutput: number;
  /** 'adaptive' = send thinking:{type:'adaptive'} (Anthropic); 'none' = omit thinking */
  thinking: 'adaptive' | 'none';
  /** Supported effort levels ([] = don't send effort). */
  efforts: string[];
  defaultEffort?: string;
  /** USD per million tokens [input, output]; null when unknown (the provider may report exact cost). */
  price: [number, number] | null;
  /** Anthropic fast mode (research preview): Opus 5.5 / Opus 5 / Opus 4.8 on the Anthropic API only. */
  fast?: boolean;
  featured?: boolean;
}

export interface Usage { input: number; output: number; cacheRead: number; cacheWrite: number }

/** A provider-neutral chat transcript entry. `raw` keeps the provider's exact content blocks for append-only replay. */
export interface TurnMessage {
  role: 'user' | 'assistant';
  /** User turns: text plus optional PNG screenshot (base64, no data: prefix). */
  text?: string;
  imagePng?: string;
  /** Assistant turns: exact provider content to send back unchanged (Anthropic content blocks, or OpenRouter message). */
  raw?: unknown;
}

export interface Transcript { provider: Provider; system: string; messages: TurnMessage[] }

export interface AttemptResult {
  text: string;
  raw: unknown;
  stopReason: string | null;
  usage: Usage;
  /** Exact cost reported by the provider (OpenRouter), else null and we estimate from price. */
  costUsd: number | null;
  /** 'fast' | 'standard' as actually served. */
  speed: 'fast' | 'standard';
  ms: number;
  ttftMs: number | null;
  firstCodeMs: number | null;
}

export interface AttemptRequest {
  model: ModelInfo;
  effort: string | null;
  fast: boolean;
  system: string;
  messages: TurnMessage[];
  signal: AbortSignal;
  /** Streaming callbacks: thinking text, answer text, and the exact output token count when known. */
  onThinking(text: string): void;
  onText(text: string): void;
}

/** A model provider: Anthropic (official SDK) or OpenRouter. */
export interface LlmAdapter {
  provider: Provider;
  attempt(req: AttemptRequest): Promise<AttemptResult>;
}

export interface SmokeResult { ok: boolean; phase: string; error?: string | null; frames?: number; avgMs?: number; maxMs?: number; sounds?: number; logs?: string[] }

export interface Attempt {
  n: number;
  kind: 'remix' | 'repair' | 'expand' | 'crash-fix' | 'bug-fix';
  stopReason: string | null;
  usage: Usage;
  costUsd: number;
  speed: 'fast' | 'standard';
  ms: number;
  ttftMs: number | null;
  firstCodeMs: number | null;
  smoke: SmokeResult | null;
  extracted: boolean;
}

export interface Rating { fun: number; fusion: number; works?: boolean; note?: string; at: string }

export interface RemixMeta {
  id: string;
  createdAt: string;
  a: string;
  b: string;
  provider: Provider;
  model: string;      // provider model id
  modelLabel?: string;
  effort: string | null;
  fast?: boolean;
  scope: Scope;
  promptVersion: string;
  title: string;
  pitch: string;
  status: 'running' | 'ok' | 'failed' | 'aborted';
  failure?: string;
  attempts: Attempt[];
  totalMs: number;
  lines: number;
  costUsd: number;
  /** Staged remix: the model writes a playable level 1 first; the player can then ask it to build the rest. */
  staged?: boolean;
  /** Time from start until something playable booted (level 1 for staged remixes, the whole game otherwise). */
  firstPlayableMs?: number;
  /** Staged remixes only: whether levels 2..N have been built ('pending' = the player hasn't asked yet). */
  expansion?: 'pending' | 'running' | 'done' | 'failed';
  /** What the player asked for when building the full game. */
  expandFeedback?: string;
  runtimeRepairs?: number;
  bugReports?: number;
  /** Older playable versions kept when a fix replaced the game (newest last). */
  versions?: number;
  ratings: Rating[];
}

/** Where remixes live: IndexedDB in the browser, the remixes/ folder in Node. */
export interface RemixStore {
  saveMeta(meta: RemixMeta): Promise<void>;
  loadMeta(id: string): Promise<RemixMeta | null>;
  list(): Promise<RemixMeta[]>;
  saveSource(id: string, code: string): Promise<void>;
  loadSource(id: string): Promise<string | null>;
  /** Keep the previous version before a fix overwrites it. */
  archiveSource(id: string, version: number, code: string): Promise<void>;
  loadArchivedSource(id: string, version: number): Promise<string | null>;
  saveTranscript(id: string, t: Transcript): Promise<void>;
  loadTranscript(id: string): Promise<Transcript | null>;
  delete(id: string): Promise<void>;
}

export interface CartSource { id: string; title: string; source: string }

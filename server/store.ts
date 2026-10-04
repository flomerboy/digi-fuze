// Remix storage for the Node CLI: remixes/<id>/{meta.json, game.js, game.v<N>.js, transcript.json}
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { REMIX_DIR } from './paths';
import type { RemixMeta, RemixStore, Transcript } from '../src/remix/types';

const ID_RE = /^[a-z0-9-]+$/;
const dir = (id: string) => {
  if (!ID_RE.test(id)) throw new Error('bad remix id');
  return path.join(REMIX_DIR, id);
};
const write = (id: string, name: string, content: string) => { mkdirSync(dir(id), { recursive: true }); writeFileSync(path.join(dir(id), name), content); };
const read = (id: string, name: string) => { const p = path.join(dir(id), name); return existsSync(p) ? readFileSync(p, 'utf8') : null; };

/** Remixes made before the BYOK refactor stored Anthropic messages directly; convert them on load. */
function upgradeTranscript(t: any): Transcript {
  if (t.provider) return t;
  return {
    provider: 'anthropic',
    system: t.system,
    messages: t.messages.map((m: any) => m.role === 'assistant'
      ? { role: 'assistant', raw: m.content }
      : { role: 'user', text: typeof m.content === 'string' ? m.content : m.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n') }),
  };
}

/** Same for older meta.json files (no provider / per-attempt cost). */
function upgradeMeta(m: any): RemixMeta {
  if (m.provider) return m;
  return {
    ...m, provider: 'anthropic',
    attempts: m.attempts.map((a: any, i: number) => ({ kind: i === 0 ? 'remix' : 'repair', speed: 'standard', costUsd: m.attempts.length === 1 ? m.costUsd : 0, ...a })),
  };
}

export const fsStore: RemixStore = {
  async saveMeta(m) { write(m.id, 'meta.json', JSON.stringify(m, null, 2)); },
  async loadMeta(id) { const s = read(id, 'meta.json'); return s ? upgradeMeta(JSON.parse(s)) : null; },
  async list() {
    if (!existsSync(REMIX_DIR)) return [];
    return readdirSync(REMIX_DIR)
      .filter((d) => ID_RE.test(d) && existsSync(path.join(REMIX_DIR, d, 'meta.json')))
      .map((d) => upgradeMeta(JSON.parse(readFileSync(path.join(REMIX_DIR, d, 'meta.json'), 'utf8'))))
      .sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  },
  async saveSource(id, code) { write(id, 'game.js', code); },
  async loadSource(id) { return read(id, 'game.js'); },
  async archiveSource(id, v, code) { write(id, `game.v${v}.js`, code); },
  async loadArchivedSource(id, v) { return read(id, `game.v${v}.js`); },
  async saveTranscript(id, t) { write(id, 'transcript.json', JSON.stringify(t, null, 2)); },
  async loadTranscript(id) { const s = read(id, 'transcript.json'); return s ? upgradeTranscript(JSON.parse(s)) : null; },
  async delete(id) { rmSync(dir(id), { recursive: true, force: true }); },
};

// Smoke-tests a cartridge source string in an isolated child process
// (no env vars, Node permission model: read-only access to the cartridge + runtime, no fs writes,
// no child processes), with a hard timeout to catch infinite loops.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

export async function smokeTest(source, { frames = 3600, seed = 1234, timeoutMs = 20000 } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'vgr-smoke-'));
  const file = path.join(dir, 'game.mjs');
  writeFileSync(file, source);
  try {
    const sandboxed = await runChild(file, frames, seed, timeoutMs, true);
    // If this Node build/OS rejects the permission flags (older Node, some Windows setups), fall back to an
    // unsandboxed child (still no env vars, still a hard timeout) rather than failing every remix.
    if (sandboxed.phase === 'crash' && /permission|bad option|allow-fs/i.test(sandboxed.error || '')) {
      if (!warned) { warned = true; console.warn('[smoke] Node permission model unavailable; running boot tests without the fs sandbox.'); }
      return await runChild(file, frames, seed, timeoutMs, false);
    }
    return sandboxed;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

let warned = false;

function runChild(file, frames, seed, timeoutMs, sandbox) {
  const flags = sandbox ? [
    '--permission',
    `--allow-fs-read=${file}`,
    `--allow-fs-read=${path.join(here, 'smoke-child.mjs')}`,
    `--allow-fs-read=${path.join(root, 'src', 'runtime')}${path.sep}*`,
  ] : [];
  // Windows needs SystemRoot even in an otherwise empty environment.
  const env = process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot || 'C:\\Windows' } : {};
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [...flags, path.join(here, 'smoke-child.mjs'), file, String(frames), String(seed)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ ok: false, error: `Timed out after ${timeoutMs}ms (infinite loop or far too slow)`, phase: 'timeout' });
    }, timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('close', () => {
      clearTimeout(timer);
      const line = out.trim().split('\n').pop();
      try { resolve(JSON.parse(line)); }
      catch { resolve({ ok: false, phase: 'crash', error: (err || out || 'smoke runner crashed').slice(0, 2000) }); }
    });
  });
}

// The visitor's own API keys (BYOK). They live only in this browser: localStorage when "remember on this
// device" is ticked, otherwise sessionStorage (gone when the tab closes). They are sent only to the provider.
import type { Provider } from './types';

const KEY = (p: Provider) => `vgr:key:${p}`;

function read(store: () => Storage, k: string): string | null {
  try { return store().getItem(k); } catch { return null; }
}

export function getKey(p: Provider): string | null {
  return read(() => sessionStorage, KEY(p)) || read(() => localStorage, KEY(p));
}

export function isRemembered(p: Provider): boolean {
  return !!read(() => localStorage, KEY(p));
}

export function setKey(p: Provider, key: string, remember: boolean) {
  clearKey(p);
  try { (remember ? localStorage : sessionStorage).setItem(KEY(p), key.trim()); } catch { /* storage blocked: key lasts until reload */ }
}

export function clearKey(p: Provider) {
  for (const s of [() => localStorage, () => sessionStorage]) { try { s().removeItem(KEY(p)); } catch { /* ignore */ } }
}

/** Light sanity check so typos are caught before a paid request. */
export function looksLikeKey(p: Provider, key: string): boolean {
  const k = key.trim();
  return p === 'anthropic' ? /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(k) : /^sk-or-[A-Za-z0-9_-]{20,}$/.test(k);
}

// "Connect with OpenRouter": OAuth PKCE in the browser, so visitors get a key without copy-pasting.
// Flow (https://openrouter.ai/docs/use-cases/oauth-pkce):
//   1. send the user to https://openrouter.ai/auth?callback_url=…&code_challenge=…&code_challenge_method=S256
//   2. OpenRouter redirects back to callback_url with ?code=…
//   3. POST https://openrouter.ai/api/v1/auth/keys {code, code_verifier, code_challenge_method} → {key}
// Codes expire 10 minutes after issuance. The verifier waits in sessionStorage across the redirect.

const AUTH_URL = 'https://openrouter.ai/auth';
const EXCHANGE_URL = 'https://openrouter.ai/api/v1/auth/keys';
const VERIFIER_KEY = 'vgr:or-verifier';

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function storage(op: 'get' | 'set' | 'remove', value?: string): string | null {
  try {
    if (op === 'get') return sessionStorage.getItem(VERIFIER_KEY);
    if (op === 'set') sessionStorage.setItem(VERIFIER_KEY, value!);
    else sessionStorage.removeItem(VERIFIER_KEY);
  } catch { /* storage disabled (private mode etc.) */ }
  return null;
}

/** Redirects the page to OpenRouter's consent screen. Resolves just before navigation. */
export async function startOpenRouterLogin(): Promise<void> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  storage('set', verifier);
  if (storage('get') !== verifier) throw new Error("Can't connect: this browser is blocking session storage. Paste a key instead.");
  const params = new URLSearchParams({
    callback_url: location.origin + location.pathname,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    key_label: 'DIGI-FUZE',
  });
  location.assign(`${AUTH_URL}?${params}`);
}

/**
 * Call on page load. If we're returning from OpenRouter with ?code=…, exchanges it for an API key,
 * strips the code from the address bar and returns the key. Otherwise returns null.
 */
export async function completeOpenRouterLogin(): Promise<string | null> {
  const url = new URL(location.href);
  const code = url.searchParams.get('code');
  if (!code) return null;

  // Clean the URL first so a reload can't replay a spent code.
  url.searchParams.delete('code');
  history.replaceState(history.state, '', url.pathname + url.search + url.hash);

  const verifier = storage('get');
  storage('remove');
  if (!verifier) throw new Error('OpenRouter login expired or was started in another tab — please connect again.');

  let res: Response;
  try {
    res = await fetch(EXCHANGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
    });
  } catch {
    throw new Error("Couldn't reach OpenRouter to finish connecting — check your connection and try again.");
  }
  if (!res.ok) {
    let msg = '';
    try { msg = (await res.json())?.error?.message || ''; } catch { /* non-JSON */ }
    if (res.status === 400 || res.status === 403) throw new Error(`OpenRouter login failed${msg ? ` (${msg})` : ''} — the code may have expired; please connect again.`);
    throw new Error(`OpenRouter login failed (HTTP ${res.status}${msg ? `: ${msg}` : ''}).`);
  }
  const key = (await res.json().catch(() => null))?.key;
  if (typeof key !== 'string' || !key) throw new Error('OpenRouter login failed: no key was returned.');
  return key;
}

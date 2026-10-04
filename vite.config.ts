import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';

// Production builds get a Content-Security-Policy: the page may only talk to itself and the two model providers.
// (Dev skips it so Vite's HMR keeps working.) GitHub Pages can't set headers, so it goes in a <meta> tag.
const CSP = [
  "default-src 'self'",
  "script-src 'self' blob:",           // cartridges are loaded from blob: URLs inside workers
  "worker-src 'self' blob:",
  "connect-src 'self' https://api.anthropic.com https://openrouter.ai",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

const csp = (): Plugin => ({
  name: 'digi-fuze-csp',
  apply: 'build',
  transformIndexHtml: (html) => html.replace('<head>', `<head>\n<meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
});

export default defineConfig({
  // GitHub Pages serves the site under /<repo>/; the deploy workflow sets VITE_BASE=/digi-fuze/.
  base: process.env.VITE_BASE || '/',
  server: { host: true, port: 5173 },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
    rollupOptions: { input: { main: resolve(import.meta.dirname, 'index.html'), dev: resolve(import.meta.dirname, 'dev.html') } },
  },
  plugins: [csp()],
});

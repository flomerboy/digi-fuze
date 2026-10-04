import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { CART_DIR } from './paths';

export interface CartMeta {
  id: string;
  title: string;
  color: string;
  accent: string;
  tagline: string;
  order: number;
  lines?: number;
}

const ID_RE = /^[a-z0-9-]+$/;

export function listCartridges(): CartMeta[] {
  return readdirSync(CART_DIR)
    .filter((d) => ID_RE.test(d) && existsSync(path.join(CART_DIR, d, 'cart.json')))
    .map((d) => {
      const meta = JSON.parse(readFileSync(path.join(CART_DIR, d, 'cart.json'), 'utf8')) as CartMeta;
      const src = cartSourcePath(d);
      meta.lines = existsSync(src) ? readFileSync(src, 'utf8').split('\n').length : 0;
      return meta;
    })
    .sort((a, b) => a.order - b.order);
}

export function cartSourcePath(id: string) {
  if (!ID_RE.test(id)) throw new Error('bad cartridge id');
  return path.join(CART_DIR, id, 'game.js');
}

export function readCartSource(id: string): string | null {
  const p = cartSourcePath(id);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

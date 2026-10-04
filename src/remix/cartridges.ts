// The built-in cartridges, bundled into the static site at build time (no server needed).
import type { CartInfo } from '../world';
import apiSpec from '../../docs/CARTRIDGE_API.md?raw';

export { apiSpec };

export interface CartMeta extends CartInfo { order: number; lines?: number }

const metas = import.meta.glob<CartMeta>('../../cartridges/*/cart.json', { eager: true, import: 'default' });
const sources = import.meta.glob<string>('../../cartridges/*/game.js', { query: '?raw', import: 'default' });

const idOf = (path: string) => path.split('/').at(-2)!;

export const CARTRIDGES: CartMeta[] = Object.entries(metas)
  .map(([p, m]) => ({ ...m, id: idOf(p) }))
  .sort((a, b) => a.order - b.order);

export async function cartSource(id: string): Promise<string> {
  const load = Object.entries(sources).find(([p]) => idOf(p) === id)?.[1];
  if (!load) throw new Error(`No cartridge ${id}`);
  return load();
}

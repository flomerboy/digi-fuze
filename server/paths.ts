import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CART_DIR = path.join(ROOT, 'cartridges');
export const REMIX_DIR = path.join(ROOT, 'remixes');
export const API_SPEC = path.join(ROOT, 'docs', 'CARTRIDGE_API.md');

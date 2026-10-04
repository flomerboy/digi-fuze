// Flat 2D cartridge bench: /dev.html?cart=snake  or  /dev.html?remix=<id>
import { CartHost } from './runtime/host';
import { Synth } from './runtime/synth';
import { Input } from './runtime/input';
import { CARTRIDGES, cartSource } from './remix/cartridges';
import { idbStore } from './remix/store-idb';

const canvas = document.getElementById('screen') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const errEl = document.getElementById('err')!;
const statusEl = document.getElementById('status')!;
const pick = document.getElementById('pick') as HTMLSelectElement;
const synth = new Synth();
const input = new Input();
const host = new CartHost(synth, input, {
  onFrame(b) { ctx.drawImage(b, 0, 0); b.close(); },
  onError(e) { errEl.textContent = `CRASH [${e.phase}] ${e.message}\n${e.stack || ''}`; statusEl.textContent = 'crashed'; },
  onReady() { statusEl.textContent = 'running'; },
});
window.addEventListener('pointerdown', () => synth.unlock());
window.addEventListener('keydown', () => synth.unlock());

const params = new URLSearchParams(location.search);

async function load() {
  errEl.textContent = '';
  statusEl.textContent = 'loading…';
  const remix = params.get('remix');
  const id = remix ? null : (pick.value || params.get('cart') || 'snake');
  const src = remix ? await idbStore.loadSource(remix) : await cartSource(id!).catch(() => null);
  if (!src) { errEl.textContent = `Could not load ${remix ? `remix ${remix} (it lives in the main app's browser storage)` : `cartridge ${id}`}`; return; }
  host.load(src, remix ? `vgr:remix:${remix}` : `vgr:cart:${id}`);
}

for (const c of CARTRIDGES) pick.add(new Option(c.title, c.id));
pick.value = params.get('cart') || CARTRIDGES[0]?.id;
pick.onchange = () => { params.set('cart', pick.value); history.replaceState(null, '', `?${params}`); load(); pick.blur(); };
document.getElementById('reload')!.onclick = (e) => { (e.target as HTMLElement).blur(); load(); };
void load();
(window as any).__host = host;

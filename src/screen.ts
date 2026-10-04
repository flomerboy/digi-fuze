// Draws everything the CRT shows that isn't a running cartridge: idle, remix progress, errors.
// The TV canvas is 640x480; cartridge frames (320x240) are blitted at 2x.
import { makeTextRenderer } from './runtime/core.js';

export const SW = 640;
export const SH = 480;

export interface RemixView {
  aTitle: string; aColor: string;
  bTitle: string; bColor: string;
  model: string; effort: string | null;
  phase: string;            // connecting | thinking | writing | testing | repairing | booting | failed
  startedAt: number;
  thinking: string;         // accumulated thinking summary
  text: string;             // accumulated model text (TITLE / PITCH / code)
  outTokens: number;        // exact output tokens from finished attempts (API usage)
  streamChars: number;      // thinking + text chars streamed since the last usage report
  costUsd: number;          // exact/estimated cost of finished attempts
  outPrice: number;         // USD per output token, for the live estimate (0 = unknown)
  title: string; pitch: string;
  attempt: number;
  error?: string;
  testNote?: string;
}

/** Two cartridges are in: their title screens collide and twist together like a two-color soft serve. */
export interface FusionView {
  a: { img: CanvasImageSource | null; title: string; color: string };
  b: { img: CanvasImageSource | null; title: string; color: string };
  startedAt: number;        // performance.now() when both cartridges were in
  firedAt: number | null;   // when the player pressed DIGI-FUZE
  ready: boolean;           // has an API key (otherwise the CTA asks for one)
}

/** Fusion timeline, in seconds from startedAt: slide in, collide, twist into a swirl, then wait for START. */
export const FUSION = { slide: 0.8, collide: 1.5, spiral: 2.9, merge: 3.0, fire: 1.0 };

// "DIGI-FUZE" with its Z drawn as a lightning bolt (5x7 grid like the font, '#' = lit).
const BOLT_Z = ['#####', '...#.', '..#..', '.####', '..#..', '.#...', '#####'];

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t); };

export class Screen {
  readonly canvas = document.createElement('canvas');
  readonly g: CanvasRenderingContext2D;
  private t: ReturnType<typeof makeTextRenderer>;
  private noise: HTMLCanvasElement;

  constructor() {
    this.canvas.width = SW;
    this.canvas.height = SH;
    this.g = this.canvas.getContext('2d')!;
    this.g.imageSmoothingEnabled = false;
    this.t = makeTextRenderer(() => this.g);
    this.noise = document.createElement('canvas');
    this.noise.width = 160; this.noise.height = 120;
    const ng = this.noise.getContext('2d')!;
    const img = ng.createImageData(160, 120);
    for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
    ng.putImageData(img, 0, 0);
  }

  text(s: string, x: number, y: number, o: Parameters<Screen['t']['text']>[3] = {}) { this.t.text(s, x, y, o); }

  frame(bitmap: ImageBitmap) {
    this.g.imageSmoothingEnabled = false;
    this.g.drawImage(bitmap, 0, 0, SW, SH);
  }

  /** The DIGI-FUZE logo, centered on x, with the Z as a yellow lightning bolt. */
  logo(x: number, y: number, scale: number) {
    const g = this.g;
    const adv = 6 * scale, w = adv * 9 - scale;
    let cx = x - w / 2;
    this.text('DIGI-FU', cx, y, { scale, color: '#fff', shadow: '#000' });
    cx += adv * 7;
    for (const [dx, col] of [[scale, '#000'], [0, '#ffe066']] as const) {
      g.fillStyle = col;
      BOLT_Z.forEach((row, r) => { for (let c = 0; c < 5; c++) if (row[c] === '#') g.fillRect(cx + c * scale + dx, y + r * scale + dx, scale, scale); });
    }
    this.text('E', cx + adv, y, { scale, color: '#fff', shadow: '#000' });
  }

  /**
   * The fusion screen. Both title screens slide in side by side and collide in the middle; the merged screen
   * starts as a straight half-and-half split, then the split twists into a spiral, like a two-color soft serve,
   * so both games stay visible as ribbons winding around each other. It keeps slowly turning under
   * "PRESS START TO DIGI-FUZE". Firing spins the swirl up, collapses it into the middle, and flashes white.
   */
  fusion(f: FusionView, now: number) {
    const g = this.g;
    const T = (now - f.startedAt) / 1000;
    const fire = f.firedAt ? clamp01((now - f.firedAt) / 1000 / FUSION.fire) : 0;
    const cx = SW / 2, cy = SH / 2 - 6;
    g.fillStyle = '#05030c';
    g.fillRect(0, 0, SW, SH);
    this.vortex(f, cx, cy, T, fire);

    const BIG = 0.66; // merged screen size, as a fraction of the TV
    if (T < FUSION.collide) {
      // two separate screens: slide in from the edges, then move together and grow
      const s = 1 - Math.pow(1 - clamp01(T / FUSION.slide), 3);
      const c = smooth((T - FUSION.slide) / (FUSION.collide - FUSION.slide));
      const sc = 0.44 + (BIG - 0.44) * c;
      ([[-1, f.a], [1, f.b]] as const).forEach(([side, card]) => {
        const x = cx + side * ((1 - c) * 160 + (1 - s) * 340);
        this.card(card, x, cy, sc);
        if (c < 0.3) this.text(card.title, x, cy + (SH * sc) / 2 + 10, { align: 'center', color: '#fff', shadow: '#000', scale: 2 });
      });
      if (s > 0.8 && c < 0.5) this.text('+', cx, cy - 10, { scale: 4, align: 'center', color: '#ffe066', shadow: '#000' });
    } else {
      // one screen: the A/B boundary twists into a spiral that keeps turning; firing spins it up and collapses it
      const tw = smooth((T - FUSION.collide) / (FUSION.spiral - FUSION.collide));
      const twist = tw * 9 + Math.sin(T * 1.3) * 0.6 * tw + fire * fire * 30;
      const turn = T * 0.7 + fire * 10;
      const sc = BIG * (1 - Math.pow(fire, 1.5));
      if (sc > 0.01) this.softServe(f, cx, cy, sc, twist, turn, T);
    }

    // a pop when they collide, and the screen floods white when the fusion fires
    const pop = T >= FUSION.collide ? clamp01(1 - (T - FUSION.collide) / 0.35) * 0.8 : 0;
    const flood = clamp01((fire - 0.55) / 0.45);
    if (pop > 0 || flood > 0) {
      g.fillStyle = '#fff';
      g.globalAlpha = Math.max(pop, flood);
      g.fillRect(0, 0, SW, SH);
      g.globalAlpha = 1;
    }

    // logo, the pair, and the call to action
    if (T > FUSION.merge && !f.firedAt) {
      this.logo(SW / 2, 14, 4);
      this.text(`${f.a.title} + ${f.b.title}`, SW / 2, 412, { align: 'center', color: '#fff', shadow: '#000', scale: 2 });
      const blink = Math.floor(T * 2.5) % 2 === 0;
      if (f.ready) {
        if (blink) this.text('PRESS START TO DIGI-FUZE', SW / 2, 440, { align: 'center', color: '#ffe066', shadow: '#000', scale: 2 });
      } else {
        this.text('ADD AN API KEY TO START THE FUSION', SW / 2, 440, { align: 'center', color: '#ffe066', shadow: '#000', scale: 2 });
      }
    }
  }

  /** Spinning arcs in both cartridges' colors behind everything, faster as the fusion builds. */
  private vortex(f: FusionView, cx: number, cy: number, T: number, fire: number) {
    const g = this.g;
    const spin = T * 1.2 + fire * 12;
    g.lineWidth = 6;
    for (let i = 0; i < 22; i++) {
      const r = 30 + i * 18;
      const segs = 6 + (i % 3) * 2;
      g.globalAlpha = (0.1 + 0.35 * (1 - i / 22)) * clamp01(T * 2);
      for (let s = 0; s < segs; s++) {
        const a0 = (s / segs) * Math.PI * 2 + spin * (1 + i * 0.06) * (i % 2 ? 1 : -0.7) + i * 0.4;
        g.strokeStyle = s % 2 ? f.a.color : f.b.color;
        g.beginPath();
        g.arc(cx, cy, r, a0, a0 + (Math.PI * 2 / segs) * 0.5);
        g.stroke();
      }
    }
    g.globalAlpha = 1;
  }

  /** One title screen as a card with a colored frame (a color fill until the real screen has been captured). */
  private card(card: FusionView['a'], x: number, y: number, sc: number) {
    const g = this.g;
    const w = SW * sc, h = SH * sc;
    if (card.img) g.drawImage(card.img, x - w / 2, y - h / 2, w, h);
    else { g.fillStyle = card.color; g.fillRect(x - w / 2, y - h / 2, w, h); }
    g.strokeStyle = card.color;
    g.lineWidth = 6;
    g.strokeRect(x - w / 2 - 3, y - h / 2 - 3, w + 6, h + 6);
  }

  private fuseCanvas: HTMLCanvasElement | null = null;

  /**
   * The merged screen: screen A everywhere, screen B inside one spiral arm. With twist 0 the arm is a straight
   * half (left/right split); as twist grows the boundary winds into a two-color swirl.
   */
  private softServe(f: FusionView, x: number, y: number, sc: number, twist: number, turn: number, T: number) {
    const g = this.g;
    const W = 320, H = 240;
    const c = (this.fuseCanvas ??= Object.assign(document.createElement('canvas'), { width: W, height: H }));
    const fg = c.getContext('2d')!;
    fg.imageSmoothingEnabled = false;
    const paint = (card: FusionView['a']) => {
      if (card.img) fg.drawImage(card.img, 0, 0, W, H);
      else { fg.fillStyle = card.color; fg.fillRect(0, 0, W, H); }
    };
    paint(f.a);
    // the B arm: half a turn wide, its edges bending by `twist` radians from the center to the corners
    const R = Math.hypot(W, H) / 2 + 4, ox = W / 2, oy = H / 2;
    const edge = (a0: number) => { const pts: [number, number][] = []; for (let r = 0; r <= R; r += 4) { const a = a0 + (twist * r) / R; pts.push([ox + Math.cos(a) * r, oy + Math.sin(a) * r]); } return pts; };
    const e1 = edge(turn), e2 = edge(turn + Math.PI);
    fg.save();
    fg.beginPath();
    fg.moveTo(ox, oy);
    for (const [px, py] of e1) fg.lineTo(px, py);
    // close around the outside so the arm covers the corners too
    for (let a = turn + twist; a <= turn + twist + Math.PI; a += 0.1) fg.lineTo(ox + Math.cos(a) * R * 1.5, oy + Math.sin(a) * R * 1.5);
    for (let i = e2.length - 1; i >= 0; i--) fg.lineTo(e2[i][0], e2[i][1]);
    fg.closePath();
    fg.clip();
    paint(f.b);
    fg.restore();
    // a bright seam where the two flavors meet
    fg.lineWidth = 2;
    for (const [pts, col] of [[e1, f.b.color], [e2, f.a.color]] as const) {
      fg.strokeStyle = col;
      fg.globalAlpha = 0.7 + 0.3 * Math.sin(T * 6);
      fg.beginPath();
      pts.forEach(([px, py], i) => (i ? fg.lineTo(px, py) : fg.moveTo(px, py)));
      fg.stroke();
    }
    fg.globalAlpha = 1;

    const w = SW * sc, h = SH * sc;
    g.imageSmoothingEnabled = false;
    g.drawImage(c, x - w / 2, y - h / 2, w, h);
    // frame in both colors, alternating as it turns
    const alt = Math.floor(T * 4) % 2;
    g.lineWidth = 6;
    g.strokeStyle = alt ? f.a.color : f.b.color;
    g.strokeRect(x - w / 2 - 3, y - h / 2 - 3, w + 6, h + 6);
    g.strokeStyle = alt ? f.b.color : f.a.color;
    g.setLineDash([12, 12]);
    g.strokeRect(x - w / 2 - 3, y - h / 2 - 3, w + 6, h + 6);
    g.setLineDash([]);
  }

  /** The "remix done" card shown for a moment before the new game boots. */
  done(heading: string, title: string, pitch: string, rows: [string, string][], time: number) {
    const g = this.g;
    this.staticBg(0.05, time);
    this.text(heading, SW / 2, 60, { scale: 2, align: 'center', color: '#7dff9b' });
    this.text(title, SW / 2, 96, { scale: 4, align: 'center', color: '#ffe066', shadow: '#5a3b00' });
    wrap(pitch, 90).slice(0, 3).forEach((l, i) => this.text(l, SW / 2, 146 + i * 12, { align: 'center', color: '#cfd8ff' }));
    g.fillStyle = 'rgba(255,255,255,0.06)';
    g.fillRect(150, 196, 340, rows.length * 28 + 16);
    rows.forEach(([k, v], i) => {
      this.text(k, 170, 208 + i * 28, { scale: 2, color: '#8a93b8' });
      this.text(v, 470, 208 + i * 28, { scale: 2, align: 'right', color: '#ffffff' });
    });
  }

  /** Old-TV style on-screen display for the knobs: a label and a row of segments. */
  osd(label: string, value: number, alpha: number) {
    const g = this.g;
    const x = 120, y = 400, segs = 20, sw = 18;
    g.globalAlpha = alpha;
    g.fillStyle = '#000';
    g.fillRect(x - 10, y - 30, segs * sw + 20, 62);
    this.text(label, x, y - 22, { scale: 2, color: '#7dff9b' });
    this.text(String(Math.round(value * 100)), x + segs * sw, y - 22, { scale: 2, align: 'right', color: '#7dff9b' });
    for (let i = 0; i < segs; i++) {
      g.fillStyle = i < Math.round(value * segs) ? '#7dff9b' : '#1f3a26';
      g.fillRect(x + i * sw, y, sw - 4, 20);
    }
    g.globalAlpha = 1;
  }

  private staticBg(alpha: number, time: number) {
    const g = this.g;
    g.fillStyle = '#05060a';
    g.fillRect(0, 0, SW, SH);
    g.globalAlpha = alpha;
    g.imageSmoothingEnabled = false;
    const ox = Math.floor(Math.random() * 160), oy = Math.floor(Math.random() * 120);
    g.drawImage(this.noise, -ox, -oy, 640, 480);
    g.drawImage(this.noise, 640 - ox, -oy, 640, 480);
    g.drawImage(this.noise, -ox, 480 - oy, 640, 480);
    g.drawImage(this.noise, 640 - ox, 480 - oy, 640, 480);
    g.globalAlpha = 1;
    void time;
  }

  idle(time: number) {
    const g = this.g;
    g.fillStyle = '#0b1a7a';
    g.fillRect(0, 0, SW, SH);
    this.text('DIGI-FUZE', SW / 2, 150, { scale: 6, align: 'center', color: '#fff', shadow: '#000' });
    if (Math.floor(time * 2) % 2 === 0) this.text('INSERT CARTRIDGE', SW / 2, 260, { scale: 3, align: 'center', color: '#ffe066', shadow: '#000' });
    this.text('ONE CARTRIDGE = PLAY      TWO CARTRIDGES = REMIX', SW / 2, 330, { scale: 1, align: 'center', color: '#9fb4ff' });
    this.text('DRAG A CARTRIDGE INTO A SLOT, OR CLICK ONE', SW / 2, 350, { scale: 1, align: 'center', color: '#9fb4ff' });
  }

  loading(label: string, time: number) {
    this.staticBg(0.25, time);
    this.text(label, SW / 2, SH / 2 - 8, { scale: 2, align: 'center', color: '#fff', shadow: '#000' });
  }

  crash(title: string, msg: string, hint: string) {
    const g = this.g;
    g.fillStyle = '#7a0b0b';
    g.fillRect(0, 0, SW, SH);
    this.text(title, SW / 2, 60, { scale: 3, align: 'center', color: '#fff', shadow: '#000' });
    let y = 120;
    for (const line of wrap(msg, 100).slice(0, 30)) { this.text(line, 20, y, { color: '#ffd6d6' }); y += 10; }
    this.text(hint, SW / 2, 440, { align: 'center', color: '#ffe066', scale: 1 });
  }

  remix(v: RemixView, time: number) {
    const g = this.g;
    this.staticBg(0.07, time);
    const elapsed = (performance.now() - v.startedAt) / 1000;

    // Header: A × B
    const head = `${v.aTitle}  X  ${v.bTitle}`;
    const scale = head.length > 26 ? 2 : 3;
    const w = this.t.textWidth(head, scale);
    let x = SW / 2 - w / 2;
    this.text(v.aTitle, x, 18, { scale, color: v.aColor, shadow: '#000' });
    x += this.t.textWidth(v.aTitle + '  ', scale);
    this.text('X', x, 18, { scale, color: '#fff', shadow: '#000' });
    x += this.t.textWidth('X  ', scale);
    this.text(v.bTitle, x, 18, { scale, color: v.bColor, shadow: '#000' });

    // Title once the model names it
    if (v.title) {
      this.text(v.title, SW / 2, 52, { scale: 3, align: 'center', color: '#ffe066', shadow: '#5a3b00' });
      if (v.pitch) wrap(v.pitch, 96).slice(0, 2).forEach((l, i) => this.text(l, SW / 2, 82 + i * 10, { align: 'center', color: '#cfd8ff' }));
    }

    // Status bar
    const spin = '|/-\\'[Math.floor(time * 10) % 4];
    const phaseLabel: Record<string, string> = {
      connecting: 'CONNECTING', thinking: 'THINKING', writing: 'WRITING CODE', testing: 'BOOT TEST',
      repairing: `REPAIRING (ATTEMPT ${v.attempt})`, expanding: 'BUILDING THE FULL GAME', booting: 'BOOTING', failed: 'REMIX FAILED',
    };
    const codeStart = v.text.indexOf('```');
    const lines = codeStart < 0 ? 0 : v.text.slice(codeStart).split('\n').length - 1;
    // Live count is an estimate (thinking arrives summarized, so it runs low); exact once the API reports usage.
    const tokens = v.outTokens + Math.round(v.streamChars / 3.6);
    const approx = v.streamChars > 0 ? '~' : '';
    const cost = v.costUsd + (v.streamChars / 3.6) * v.outPrice;
    const costText = v.outPrice || v.costUsd ? `  ${approx}$${cost.toFixed(2)}` : '';
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(0, 104, SW, 22);
    this.text(`${v.phase === 'failed' ? '!' : spin} ${phaseLabel[v.phase] || v.phase.toUpperCase()}`, 12, 111, { scale: 1, color: v.phase === 'failed' ? '#ff6b6b' : '#7dff9b' });
    this.text(`${v.model}${v.effort ? ' / ' + v.effort.toUpperCase() : ''}`, SW / 2, 111, { align: 'center', color: '#ffb347' });
    this.text(`${elapsed.toFixed(1)}S  ${approx}${tokens} TOK${costText}  ${lines} LN`, SW - 12, 111, { align: 'right', color: '#9fb4ff' });

    // Body
    const top = 134, rows = 33;
    if (v.phase === 'failed') {
      wrap(v.error || 'Unknown error', 100).slice(0, 26).forEach((l, i) => this.text(l, 14, top + 10 + i * 10, { color: '#ffb3b3' }));
      this.text('EJECT A CARTRIDGE TO TRY AGAIN', SW / 2, 452, { align: 'center', color: '#ffe066' });
      return;
    }
    const code = v.text.includes('```') ? v.text.slice(v.text.indexOf('```')) : '';
    if (code) {
      const all = code.split('\n').slice(1);
      const shown = all.slice(-rows);
      const first = all.length - shown.length;
      shown.forEach((l, i) => {
        const n = String(first + i + 1).padStart(4, ' ');
        this.text(n, 8, top + i * 10, { color: '#2f6f45' });
        this.text(l.replace(/\t/g, '  ').slice(0, 96), 40, top + i * 10, { color: i === shown.length - 1 ? '#d6ffe0' : '#5fe08a' });
      });
      if (Math.floor(time * 3) % 2 === 0) g.fillStyle = '#d6ffe0', g.fillRect(40 + Math.min(96, (shown.at(-1) || '').length) * 6, top + (shown.length - 1) * 10, 5, 7);
    } else {
      const th = v.thinking.trim();
      if (th) {
        const wrapped = th.split('\n').flatMap((p) => wrap(p, 96));
        wrapped.slice(-rows).forEach((l, i) => this.text(l, 20, top + i * 10, { color: '#8a93b8' }));
      } else {
        this.text('PLUGGING IN...', SW / 2, 280, { scale: 2, align: 'center', color: '#8a93b8' });
      }
    }
    if (v.testNote) this.text(v.testNote, SW / 2, 466, { align: 'center', color: '#ffb3b3' });
  }
}

export function wrap(s: string, width: number): string[] {
  const out: string[] = [];
  for (const para of String(s).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      if ((line + ' ' + word).trim().length > width) {
        if (line) out.push(line);
        line = word.length > width ? word.slice(0, width) : word;
      } else line = (line + ' ' + word).trim();
    }
    out.push(line);
  }
  return out;
}

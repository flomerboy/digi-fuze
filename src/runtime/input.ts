// Keyboard -> console buttons. Tracks held state plus "tapped since last tick" so very short
// presses between frames are never lost.
export const BUTTONS = ['up', 'down', 'left', 'right', 'a', 'b', 'start', 'select'] as const;
export type Button = (typeof BUTTONS)[number];

const KEYMAP: Record<string, Button> = {
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  KeyZ: 'a', KeyJ: 'a', Space: 'a',
  KeyX: 'b', KeyK: 'b',
  Enter: 'start',
  ShiftLeft: 'select', ShiftRight: 'select',
};

export class Input {
  held: Record<Button, boolean> = Object.fromEntries(BUTTONS.map((b) => [b, false])) as any;
  tapped: Partial<Record<Button, boolean>> = {};
  enabled = true;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      const b = KEYMAP[e.code];
      if (!b || !this.enabled) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      if (!this.held[b]) this.tapped[b] = true;
      this.held[b] = true;
    });
    target.addEventListener('keyup', (e) => {
      const b = KEYMAP[e.code];
      if (b) this.held[b] = false;
    });
    target.addEventListener('blur', () => this.clear());
  }

  /** Clickable buttons (the 3D gamepad) press and release through here. */
  press(b: Button) {
    if (!this.enabled) return;
    if (!this.held[b]) this.tapped[b] = true;
    this.held[b] = true;
  }
  release(b: Button) { this.held[b] = false; }

  clear() {
    for (const b of BUTTONS) this.held[b] = false;
    this.tapped = {};
  }

  /** Returns and resets the tapped set. */
  takeTapped() {
    const t = this.tapped;
    this.tapped = {};
    return t;
  }
}

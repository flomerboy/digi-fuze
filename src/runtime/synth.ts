// Tiny WebAudio synth that plays the sound commands cartridges emit.
export class Synth {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private live = new Set<AudioScheduledSourceNode>();
  private noiseBuf: AudioBuffer | null = null;
  volume = 0.6;

  setVolume(v: number) {
    this.volume = v;
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  /** Must be called from a user gesture at least once. */
  unlock() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, len);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  play(s: any) {
    if (!this.ctx || !this.master) return;
    if (s.kind === 'stop') return this.stopAll();
    if (this.live.size > 48) return; // runaway protection
    const ctx = this.ctx;
    const t0 = ctx.currentTime + Math.min(Math.max(+s.delay || 0, 0), 10);
    const dur = Math.min(Math.max(+s.dur || 0.05, 0.005), 10);
    const vol = Math.min(Math.max(+s.vol || 0, 0), 1) * 0.5;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + 0.005);
    gain.gain.setValueAtTime(vol, t0 + dur * 0.7);
    gain.gain.linearRampToValueAtTime(0, t0 + dur);
    gain.connect(this.master);
    let src: AudioScheduledSourceNode;
    if (s.kind === 'noise') {
      const n = ctx.createBufferSource();
      n.buffer = this.noiseBuf;
      n.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = Math.min(Math.max(+s.filter || 2000, 50), 20000);
      n.connect(f).connect(gain);
      src = n;
    } else {
      const o = ctx.createOscillator();
      o.type = ['square', 'sawtooth', 'triangle', 'sine'].includes(s.type) ? s.type : 'square';
      const f0 = Math.min(Math.max(+s.freq || 440, 20), 20000);
      o.frequency.setValueAtTime(f0, t0);
      if (s.slide) o.frequency.exponentialRampToValueAtTime(Math.min(Math.max(+s.slide, 20), 20000), t0 + dur);
      o.connect(gain);
      src = o;
    }
    src.start(t0);
    src.stop(t0 + dur + 0.02);
    this.live.add(src);
    src.onended = () => { this.live.delete(src); gain.disconnect(); };
  }

  stopAll() {
    for (const s of this.live) { try { s.stop(); } catch { /* already stopped */ } }
    this.live.clear();
  }

  /** Short UI sounds for the console itself (not cartridge-driven). */
  blip(freq = 880, dur = 0.05, type: OscillatorType = 'square', vol = 0.08) {
    this.play({ kind: 'tone', freq, dur, type, vol, delay: 0 });
  }
}

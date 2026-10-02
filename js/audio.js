// Fully synthesized audio (Web Audio API) — no sound files needed.
export class GameAudio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0.55;
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(ctx.destination);

    // Engine: two detuned oscillators through a resonant low-pass.
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.Q.value = 4;
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.osc1 = ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'square';
    const o2g = ctx.createGain();
    o2g.gain.value = 0.35;
    this.osc1.connect(this.engFilter);
    this.osc2.connect(o2g).connect(this.engFilter);
    this.engFilter.connect(this.engGain).connect(this.master);
    this.osc1.start();
    this.osc2.start();

    // Noise source shared by skid + nitro + wind.
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    const mkNoise = (type, freq, q) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(this.master);
      src.start();
      return { f, g };
    };
    this.skid = mkNoise('bandpass', 1400, 3);
    this.nitro = mkNoise('highpass', 900, 0.7);
    this.wind = mkNoise('lowpass', 500, 0.5);
  }

  setVolume(v) { if (this.master) this.master.gain.value = v; }

  update(kart, racing) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const sp = Math.abs(kart.speed);
    // Simulated gearbox for a satisfying rev curve.
    const gears = [0, 16, 30, 44, 58, 72, 100];
    let gi = 1;
    while (gi < gears.length - 1 && sp > gears[gi]) gi++;
    const lo = gears[gi - 1], hi = gears[gi];
    const r = Math.min(1, (sp - lo) / (hi - lo));
    const rpm = racing ? 0.25 + r * 0.75 : 0.25 + (kart.input.throttle ? 0.5 : 0);
    const base = 55 + rpm * 120 + gi * 6 + (kart.isBoosting ? 25 : 0);
    this.osc1.frequency.setTargetAtTime(base, t, 0.04);
    this.osc2.frequency.setTargetAtTime(base * 0.502, t, 0.04);
    this.engFilter.frequency.setTargetAtTime(400 + rpm * 1800 + (kart.input.throttle ? 600 : 0), t, 0.05);
    this.engGain.gain.setTargetAtTime(0.11 + kart.input.throttle * 0.07, t, 0.08);

    const skidAmt = kart.drifting ? 0.16 : (kart.input.brake && sp > 15 ? 0.1 : 0) + Math.min(0.08, Math.abs(kart.slip) * 0.012);
    this.skid.g.gain.setTargetAtTime(skidAmt, t, 0.05);
    this.skid.f.frequency.setTargetAtTime(1100 + sp * 12, t, 0.1);
    this.nitro.g.gain.setTargetAtTime(kart.isBoosting ? 0.13 : 0, t, 0.08);
    this.wind.g.gain.setTargetAtTime(Math.min(0.12, sp * 0.002), t, 0.2);
  }

  blip(freq, dur = 0.15, type = 'square', vol = 0.25) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  whoosh(vol = 0.35) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(3000, t + 0.35);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 0.55);
  }

  thud(strength) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const v = Math.min(0.6, strength * 0.03);
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.2);
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.3);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(v * 0.6, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    src.connect(ng).connect(this.master);
    src.start(t);
    src.stop(t + 0.15);
  }

  silence() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const g of [this.engGain, this.skid.g, this.nitro.g, this.wind.g]) g.gain.setTargetAtTime(0, t, 0.05);
  }
}

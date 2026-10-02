// All sound is synthesised (no audio files).
// Chamber sounds pass through a low-pass "glass" filter and a long concrete-hall reverb: we hear
// them through the window. The music's loudness, measured before the glass, is what drives the
// fly's auditory receptors. A spike monitor clicks with the brain's activity, as rigs in real
// electrophysiology labs do.
export class LabAudio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.level = 0;
    this.musicOn = false;
    this.clock = 0;
  }

  start() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -6; limiter.ratio.value = 12; limiter.attack.value = 0.003; limiter.release.value = 0.2;
    limiter.connect(ctx.destination);
    this.muffle = ctx.createBiquadFilter();   // closes down when we are inside the dying subject
    this.muffle.type = 'lowpass'; this.muffle.frequency.value = 20000; this.muffle.Q.value = 0.7;
    this.muffle.connect(limiter);
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.9 : 0;
    this.master.connect(this.muffle);
    this.booth = ctx.createGain();            // our side of the glass: UI, alarms, sirens
    this.booth.connect(this.master);
    this.glass = ctx.createBiquadFilter();    // the chamber, heard through the window
    this.glass.type = 'lowpass';
    this.glass.frequency.value = 1300;
    this.glass.Q.value = 0.4;
    const glassGain = ctx.createGain();
    glassGain.gain.value = 0.9;
    this.glass.connect(glassGain).connect(this.master);
    this.noise = this.noiseBuffer(4);
    // the hall: a long, dark concrete reverb on everything behind the glass
    this.hall = ctx.createConvolver();
    this.hall.buffer = this.impulse(4.2, 2.6);
    const hallWet = ctx.createGain(); hallWet.gain.value = 0.55;
    this.glass.connect(this.hall).connect(hallWet).connect(this.master);

    // room tone: ventilation + mains hum + a low drone that never quite settles
    const vent = ctx.createBufferSource(); vent.buffer = this.noise; vent.loop = true;
    const vl = ctx.createBiquadFilter(); vl.type = 'lowpass'; vl.frequency.value = 220;
    const vg = ctx.createGain(); vg.gain.value = 0.1;
    vent.connect(vl).connect(vg).connect(this.master); vent.start();
    for (const [f, g] of [[50, 0.012], [100, 0.008], [150, 0.004]]) {
      const o = ctx.createOscillator(); o.frequency.value = f;
      const gg = ctx.createGain(); gg.gain.value = g;
      o.connect(gg).connect(this.master); o.start();
    }
    const droneF = ctx.createBiquadFilter(); droneF.type = 'lowpass'; droneF.frequency.value = 160; droneF.Q.value = 3;
    const droneG = ctx.createGain(); droneG.gain.value = 0.05;
    for (const f of [41.2, 41.7, 61.8]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(droneF); o.start();
    }
    const droneLfo = ctx.createOscillator(); droneLfo.frequency.value = 0.05;
    const droneDepth = ctx.createGain(); droneDepth.gain.value = 70;
    droneLfo.connect(droneDepth).connect(droneF.frequency); droneLfo.start();
    droneF.connect(droneG).connect(this.master);
    this.droneGain = droneG;

    // failing lamp: mains buzz that only sounds when the tube stutters
    const buzz = ctx.createOscillator(); buzz.type = 'sawtooth'; buzz.frequency.value = 100;
    const bf = ctx.createBiquadFilter(); bf.type = 'bandpass'; bf.frequency.value = 1800; bf.Q.value = 0.8;
    this.buzzGain = ctx.createGain(); this.buzzGain.gain.value = 0;
    buzz.connect(bf).connect(this.buzzGain).connect(this.glass); buzz.start();

    // spike monitor: a loop of sparse clicks, density follows the brain's firing
    this.crackle = ctx.createBufferSource(); this.crackle.buffer = this.clickBuffer(3, 90); this.crackle.loop = true;
    const cf = ctx.createBiquadFilter(); cf.type = 'highpass'; cf.frequency.value = 700;
    this.crackleGain = ctx.createGain(); this.crackleGain.gain.value = 0;
    this.crackle.connect(cf).connect(this.crackleGain).connect(this.booth || this.master); this.crackle.start();
    const roar = ctx.createBufferSource(); roar.buffer = this.noise; roar.loop = true;
    const rf = ctx.createBiquadFilter(); rf.type = 'bandpass'; rf.frequency.value = 2400; rf.Q.value = 0.6;
    this.roarGain = ctx.createGain(); this.roarGain.gain.value = 0;
    roar.connect(rf).connect(this.roarGain).connect(this.master); roar.start();

    // continuous machines: laser hum, centrifuge motor, N2 hiss, overload whine
    this.laserOsc = ctx.createOscillator(); this.laserOsc.type = 'square'; this.laserOsc.frequency.value = 120;
    const lf = ctx.createBiquadFilter(); lf.type = 'bandpass'; lf.frequency.value = 6500; lf.Q.value = 6;
    this.laserGain = ctx.createGain(); this.laserGain.gain.value = 0;
    this.laserOsc.connect(lf).connect(this.laserGain).connect(this.glass); this.laserOsc.start();
    const sizzle = ctx.createBufferSource(); sizzle.buffer = this.noise; sizzle.loop = true;
    const szf = ctx.createBiquadFilter(); szf.type = 'highpass'; szf.frequency.value = 4000;
    this.sizzleGain = ctx.createGain(); this.sizzleGain.gain.value = 0;
    sizzle.connect(szf).connect(this.sizzleGain).connect(this.glass); sizzle.start();
    this.motor = ctx.createOscillator(); this.motor.type = 'sawtooth'; this.motor.frequency.value = 30;
    const mf = ctx.createBiquadFilter(); mf.type = 'lowpass'; mf.frequency.value = 600;
    this.motorGain = ctx.createGain(); this.motorGain.gain.value = 0;
    this.motor.connect(mf).connect(this.motorGain).connect(this.glass); this.motor.start();
    const gas = ctx.createBufferSource(); gas.buffer = this.noise; gas.loop = true;
    const gf = ctx.createBiquadFilter(); gf.type = 'highpass'; gf.frequency.value = 2200;
    this.gasGain = ctx.createGain(); this.gasGain.gain.value = 0;
    gas.connect(gf).connect(this.gasGain).connect(this.glass); gas.start();
    this.whine = ctx.createOscillator(); this.whine.type = 'sawtooth'; this.whine.frequency.value = 300;
    const wf2 = ctx.createBiquadFilter(); wf2.type = 'bandpass'; wf2.frequency.value = 2000; wf2.Q.value = 2;
    this.whineGain = ctx.createGain(); this.whineGain.gain.value = 0;
    this.whine.connect(wf2).connect(this.whineGain).connect(this.master); this.whine.start();
    this.tinnitus = ctx.createOscillator(); this.tinnitus.frequency.value = 5600;
    this.tinGain = ctx.createGain(); this.tinGain.gain.value = 0;
    this.tinnitus.connect(this.tinGain).connect(limiter); this.tinnitus.start();   // not muffled: it is inside the head
    this.flat = ctx.createOscillator(); this.flat.frequency.value = 1000;
    this.flatGain = ctx.createGain(); this.flatGain.gain.value = 0;
    this.flat.connect(this.flatGain).connect(this.master); this.flat.start();
    this.nextDrip = 2; this.nextClank = 9; this.nextBeatT = 0;

    // music: bus -> compressor -> drive -> analyser (the fly's ears) -> speakers -> out (loud)
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20; comp.ratio.value = 6;
    const drive = ctx.createWaveShaper();
    drive.curve = this.softClip(2.2);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.anaBuf = new Float32Array(this.analyser.fftSize);
    const musicGlass = ctx.createBiquadFilter();
    musicGlass.type = 'lowpass'; musicGlass.frequency.value = 3200;
    const musicOut = ctx.createGain(); musicOut.gain.value = 1.25;
    this.musicBus.connect(comp).connect(drive).connect(this.analyser).connect(musicGlass).connect(musicOut).connect(this.master);
    // the listener's own track: levelled, then into the same analyser (the fly's ears) and speakers
    this.trackComp = ctx.createDynamicsCompressor();
    this.trackComp.threshold.value = -24; this.trackComp.ratio.value = 4;
    this.trackGain = ctx.createGain(); this.trackGain.gain.value = 1.4;
    this.trackComp.connect(this.trackGain).connect(this.analyser);
    if (this.trackEl) this.attachTrack();

    // continuous sources toggled by experiments
    this.wing = ctx.createOscillator(); this.wing.type = 'sawtooth'; this.wing.frequency.value = 210;
    const wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 420; wf.Q.value = 1.6;
    this.wingGain = ctx.createGain(); this.wingGain.gain.value = 0;
    this.wing.connect(wf).connect(this.wingGain).connect(this.glass); this.wing.start();

    const fan = ctx.createBufferSource(); fan.buffer = this.noise; fan.loop = true;
    const ff = ctx.createBiquadFilter(); ff.type = 'bandpass'; ff.frequency.value = 500; ff.Q.value = 0.5;
    this.fanGain = ctx.createGain(); this.fanGain.gain.value = 0;
    fan.connect(ff).connect(this.fanGain).connect(this.glass); fan.start();
    const fanHum = ctx.createOscillator(); fanHum.frequency.value = 118;
    const fhg = ctx.createGain(); fhg.gain.value = 0.25;
    fanHum.connect(fhg).connect(this.fanGain); fanHum.start();

    this.alarm = ctx.createOscillator(); this.alarm.type = 'square'; this.alarm.frequency.value = 660;
    const af = ctx.createBiquadFilter(); af.type = 'lowpass'; af.frequency.value = 1500;
    this.alarmGain = ctx.createGain(); this.alarmGain.gain.value = 0;
    this.alarm.connect(af).connect(this.alarmGain).connect(this.booth); this.alarm.start();

    // siren: wailing tone + low horn, facility-wide
    this.siren = ctx.createOscillator(); this.siren.type = 'sawtooth'; this.siren.frequency.value = 600;
    const sirenLfo = ctx.createOscillator(); sirenLfo.frequency.value = 0.55;
    const sirenDepth = ctx.createGain(); sirenDepth.gain.value = 320;
    sirenLfo.connect(sirenDepth).connect(this.siren.frequency); sirenLfo.start();
    const sf = ctx.createBiquadFilter(); sf.type = 'lowpass'; sf.frequency.value = 2400;
    this.sirenGain = ctx.createGain(); this.sirenGain.gain.value = 0;
    this.siren.connect(sf).connect(this.sirenGain).connect(this.booth); this.siren.start();
    this.horn = ctx.createOscillator(); this.horn.type = 'square'; this.horn.frequency.value = 196;
    const hf = ctx.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 700;
    this.hornGain = ctx.createGain(); this.hornGain.gain.value = 0;
    this.horn.connect(hf).connect(this.hornGain).connect(this.booth); this.horn.start();

    this.nextBeat = 0;
    this.beat = 0;
  }

  noiseBuffer(sec) {
    const ctx = this.ctx;
    const b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 1.75 + w * 0.5;
    }
    return b;
  }

  // exponentially decaying stereo-less noise: a big concrete space
  impulse(sec, decay) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay) * (i < 400 ? i / 400 : 1);
    return b;
  }

  clickBuffer(sec, perSec) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    for (let k = 0; k < sec * perSec; k++) {
      const at = Math.floor(Math.random() * (n - 200)), amp = 0.3 + Math.random() * 0.7, sign = Math.random() < 0.5 ? -1 : 1;
      for (let j = 0; j < 60; j++) d[at + j] += sign * amp * Math.exp(-j / 9) * (j < 3 ? j / 3 : 1) * Math.cos(j * 0.9);
    }
    return b;
  }

  softClip(k) {
    const n = 1024, c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); }
    return c;
  }

  ok() { return !!this.ctx && this.ctx.state === 'running'; }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.05);
  }

  setMusic(on) {
    this.musicOn = on;
    if (this.trackEl) { if (on) this.trackEl.play().catch(() => {}); else this.trackEl.pause(); }
    if (!this.ctx) return;
    this.musicBus.gain.setTargetAtTime(on && !this.ext ? 1 : 0, this.ctx.currentTime, on ? 0.02 : 0.15);
    if (on) this.nextBeat = this.ctx.currentTime + 0.05;
  }

  // a local audio file (never uploaded): streamed by an <audio> element into the music chain
  loadTrack(file) {
    if (this.trackEl) { this.trackEl.pause(); URL.revokeObjectURL(this.trackEl.src); }
    this.trackEl = new Audio(URL.createObjectURL(file));
    this.trackEl.loop = true;
    this.trackName = file.name;
    this.trackSrc = null;
    if (this.ctx) this.attachTrack();
    if (this.musicOn) this.trackEl.play().catch(() => {});
  }
  attachTrack() {
    this.trackSrc = this.ctx.createMediaElementSource(this.trackEl);
    this.trackSrc.connect(this.trackComp);
  }
  clearTrack() {
    if (!this.trackEl) return;
    this.trackEl.pause();
    URL.revokeObjectURL(this.trackEl.src);
    if (this.trackSrc) this.trackSrc.disconnect();
    this.trackEl = null; this.trackSrc = null; this.trackName = '';
    if (this.musicOn && this.ctx) this.nextBeat = this.ctx.currentTime + 0.05;
  }

  // music playing outside Web Audio (a YouTube player): we cannot read its samples, so the
  // fly hears the room through the microphone instead (analysed locally, never sent anywhere)
  setExternal(on) {
    this.ext = on;
    if (this.ctx) this.musicBus.gain.setTargetAtTime(this.musicOn && !on ? 1 : 0, this.ctx.currentTime, 0.05);
  }
  async enableMic() {
    if (this.micAna) return true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      const src = this.ctx.createMediaStreamSource(stream);
      this.micAna = this.ctx.createAnalyser();
      this.micAna.fftSize = 1024;
      this.micBuf = new Float32Array(1024);
      this.micPeak = 0.02;
      src.connect(this.micAna);
      return true;
    } catch { return false; }
  }

  setFan(on) { if (this.ctx) this.fanGain.gain.setTargetAtTime(on ? 0.5 : 0, this.ctx.currentTime, on ? 0.4 : 0.6); }

  setSiren(on) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.sirenGain.gain.setTargetAtTime(on ? 0.16 : 0, t, on ? 0.2 : 0.4);
    this.hornGain.gain.setTargetAtTime(on ? 0.05 : 0, t, 0.3);
  }

  // ---- 128 BPM techno, scheduled ahead ----
  schedule() {
    if (!this.musicOn || this.trackEl || this.ext) return;
    const ctx = this.ctx, spb = 60 / 128 / 4;
    if (this.nextBeat < ctx.currentTime - 0.2) this.nextBeat = ctx.currentTime + 0.02;
    while (this.nextBeat < ctx.currentTime + 0.15) {
      const t = this.nextBeat, s = this.beat % 16, bar = Math.floor(this.beat / 16) % 4;
      if (s % 4 === 0) this.kick(t);
      if (s % 4 === 2) this.hat(t, 0.4);
      if (s % 2 === 1) this.hat(t, 0.12);
      if (s === 4 || s === 12) this.clap(t);
      const bassNotes = [0, 0, 12, 0, 0, 10, 0, 7, 0, 0, 12, 0, 3, 0, 10, 0];
      const root = [41, 41, 44, 39][bar];
      if (s % 2 === 1 || s === 0) this.bass(t, root + bassNotes[s] - 12, spb * 0.9);
      if (s === 6 || s === 14) this.stab(t, root + 12);
      this.nextBeat += spb;
      this.beat++;
    }
  }

  env(g, t, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  osc(type, f, t, dur, out, peak = 0.3, a = 0.004) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    this.env(g, t, a, peak, dur);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + a + dur + 0.05);
    return o;
  }

  burst(t, dur, out, { type = 'bandpass', freq = 2000, q = 1, peak = 0.3, a = 0.002 } = {}) {
    const s = this.ctx.createBufferSource(); s.buffer = this.noise;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    const g = this.ctx.createGain();
    this.env(g, t, a, peak, dur);
    s.connect(f).connect(g).connect(out);
    s.start(t, Math.random() * 3); s.stop(t + a + dur + 0.05);
    return f;
  }

  kick(t) {
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    this.env(g, t, 0.003, 1.0, 0.32);
    o.connect(g).connect(this.musicBus);
    o.start(t); o.stop(t + 0.4);
  }
  hat(t, v) { this.burst(t, 0.05, this.musicBus, { type: 'highpass', freq: 7000, peak: v }); }
  clap(t) { this.burst(t, 0.16, this.musicBus, { freq: 1500, q: 0.8, peak: 0.6, a: 0.004 }); }
  bass(t, midi, len) {
    const o = this.ctx.createOscillator(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
    f.type = 'lowpass'; f.Q.value = 7;
    f.frequency.setValueAtTime(1800, t);
    f.frequency.exponentialRampToValueAtTime(180, t + len);
    this.env(g, t, 0.005, 0.5, len);
    o.connect(f).connect(g).connect(this.musicBus);
    o.start(t); o.stop(t + len + 0.05);
  }
  stab(t, midi) {
    for (const d of [0, 3, 7]) this.osc('square', 440 * Math.pow(2, (midi + d - 69) / 12), t, 0.22, this.musicBus, 0.09);
  }

  // ---------------- SFX ----------------
  // mechanical keyboard key: thock + click
  key() {
    if (!this.ok()) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.frequency.setValueAtTime(220 + Math.random() * 40, t);
    o.frequency.exponentialRampToValueAtTime(90, t + 0.03);
    this.env(g, t, 0.001, 0.22, 0.04);
    o.connect(g).connect(this.booth);
    o.start(t); o.stop(t + 0.06);
    this.burst(t, 0.012, this.booth, { type: 'highpass', freq: 3500 + Math.random() * 1500, peak: 0.25, a: 0.0005 });
    this.burst(t + 0.035 + Math.random() * 0.01, 0.01, this.booth, { type: 'highpass', freq: 5000, peak: 0.08, a: 0.0005 });
  }

  // robotic arm / actuator: hiss -> motor whine with gear ticks -> end clunk
  servo(dur = 1.1, { pitch = 1 } = {}) {
    if (!this.ok()) return;
    const ctx = this.ctx, t = ctx.currentTime, dst = this.glass;
    this.burst(t, 0.18, dst, { type: 'highpass', freq: 3000, peak: 0.18, a: 0.01 });
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.14, t + 0.15);
    g.gain.setValueAtTime(0.14, t + dur - 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3;
    bp.frequency.setValueAtTime(700 * pitch, t);
    bp.frequency.linearRampToValueAtTime(1400 * pitch, t + dur * 0.5);
    bp.frequency.linearRampToValueAtTime(800 * pitch, t + dur);
    bp.connect(g).connect(dst);
    for (const [type, mul] of [['sawtooth', 1], ['square', 2.02]]) {
      const o = ctx.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(110 * pitch * mul, t);
      o.frequency.linearRampToValueAtTime(190 * pitch * mul, t + dur * 0.5);
      o.frequency.linearRampToValueAtTime(120 * pitch * mul, t + dur);
      o.connect(bp); o.start(t); o.stop(t + dur + 0.05);
    }
    for (let k = t + 0.12; k < t + dur - 0.08; k += 0.028 + Math.random() * 0.012) {
      this.burst(k, 0.008, dst, { freq: 3200, q: 4, peak: 0.07, a: 0.0005 });
    }
    this.clunk(t + dur);
  }

  clunk(at = null) {
    if (!this.ok()) return;
    const t = at ?? this.ctx.currentTime, dst = this.glass;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.12);
    this.env(g, t, 0.002, 0.55, 0.22);
    o.connect(g).connect(dst);
    o.start(t); o.stop(t + 0.3);
    this.burst(t, 0.09, dst, { freq: 900, q: 2, peak: 0.35, a: 0.001 });
    this.burst(t, 0.25, dst, { freq: 2600, q: 12, peak: 0.08, a: 0.001 });
  }

  hiss(dur = 1.2) {
    if (!this.ok()) return;
    this.burst(this.ctx.currentTime, dur, this.glass, { type: 'highpass', freq: 2500, peak: 0.5, a: 0.04 });
  }

  // electric shock: crackling arcs + mains buzz + capacitor squeal
  zap() {
    if (!this.ok()) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (let k = 0; k < 26; k++) {
      this.burst(t + Math.random() * 0.55, 0.01 + Math.random() * 0.03, this.booth, { freq: 1500 + Math.random() * 6000, q: 2, peak: 0.25 + Math.random() * 0.3, a: 0.0005 });
    }
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 100;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 300;
    o.connect(f).connect(g).connect(this.booth); o.start(t); o.stop(t + 0.65);
    this.osc('sine', 3400, t, 0.5, this.booth, 0.05, 0.01);
  }

  beep(freq = 1200, dur = 0.08, vol = 0.08) {
    if (!this.ok()) return;
    this.osc('sine', freq, this.ctx.currentTime, dur, this.booth, vol, 0.003);
  }

  typeTick() {
    if (!this.ok()) return;
    const t = this.ctx.currentTime;
    this.burst(t, 0.015, this.booth, { freq: 2200 + Math.random() * 800, q: 3, peak: 0.18, a: 0.0005 });
    this.osc('sine', 160, t, 0.02, this.booth, 0.06, 0.001);
  }

  coverFlip() {
    if (!this.ok()) return;
    const t = this.ctx.currentTime;
    this.burst(t, 0.03, this.booth, { freq: 1800, q: 5, peak: 0.3, a: 0.001 });
    this.osc('sine', 600, t + 0.04, 0.05, this.booth, 0.08, 0.001);
  }

  bigButton() {
    if (!this.ok()) return;
    const t = this.ctx.currentTime;
    this.osc('sine', 90, t, 0.18, this.booth, 0.5, 0.002);
    this.burst(t, 0.05, this.booth, { freq: 700, q: 2, peak: 0.4, a: 0.001 });
  }

  // straps / locks releasing: three metal clanks + pneumatic release
  unlock() {
    if (!this.ok()) return;
    const t = this.ctx.currentTime;
    [0, 0.18, 0.31].forEach((d) => this.clunk(t + d));
    this.burst(t + 0.35, 0.7, this.glass, { type: 'highpass', freq: 1800, peak: 0.45, a: 0.02 });
  }

  whoosh() {
    if (!this.ok()) return;
    const t = this.ctx.currentTime;
    const f = this.burst(t, 0.7, this.booth, { freq: 400, q: 1.2, peak: 0.35, a: 0.15 });
    f.frequency.exponentialRampToValueAtTime(3000, t + 0.6);
  }

  glitch() {
    if (!this.ok()) return;
    const t = this.ctx.currentTime;
    for (let k = 0; k < 8; k++) this.osc('square', 200 + Math.random() * 1800, t + k * 0.025, 0.02, this.booth, 0.06, 0.001);
  }

  // explosion: sub drop + blast + window rattle + debris
  boom() {
    if (!this.ok()) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(22, t + 1.4);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1.0, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 1.9);
    const f = this.burst(t, 1.6, this.master, { type: 'lowpass', freq: 4000, q: 0.5, peak: 0.9, a: 0.003 });
    f.frequency.exponentialRampToValueAtTime(150, t + 1.5);
    this.burst(t + 0.05, 0.6, this.booth, { freq: 2600, q: 6, peak: 0.25, a: 0.01 });
    for (let k = 0; k < 14; k++) {
      this.burst(t + 0.3 + Math.random() * 1.4, 0.03, this.glass, { freq: 3000 + Math.random() * 4000, q: 8, peak: 0.12, a: 0.001 });
    }
  }

  // ---------------- continuous controls (called every frame from main) ----------------
  setBuzz(v) { if (this.ok()) this.buzzGain.gain.setTargetAtTime(v * 0.05, this.ctx.currentTime, 0.01); }
  // central spikes per second -> click density / loudness, roar when the brain is overloaded
  setSpikes(rate) {
    if (!this.ok()) return;
    const now = this.ctx.currentTime, x = Math.max(0, rate);
    this.crackle.playbackRate.setTargetAtTime(Math.min(4, 0.35 + x / 9000), now, 0.1);
    this.crackleGain.gain.setTargetAtTime(Math.min(0.32, x > 30 ? 0.05 + Math.log10(1 + x / 1000) * 0.1 : 0), now, 0.1);
    this.roarGain.gain.setTargetAtTime(Math.min(0.14, Math.max(0, (x - 120000) / 900000)), now, 0.15);
  }
  setLaser(on, burn = 0) {
    if (!this.ok()) return;
    const now = this.ctx.currentTime;
    this.laserGain.gain.setTargetAtTime(on ? 0.05 : 0, now, 0.03);
    this.sizzleGain.gain.setTargetAtTime(on ? burn * 0.12 : 0, now, 0.1);
  }
  setSpin(w) {
    if (!this.ok()) return;
    const now = this.ctx.currentTime;
    this.motor.frequency.setTargetAtTime(28 + 140 * w, now, 0.2);
    this.motorGain.gain.setTargetAtTime(w > 0.01 ? 0.08 + 0.12 * w : 0, now, 0.2);
  }
  setGas(v) { if (this.ok()) this.gasGain.gain.setTargetAtTime(v * 0.25, this.ctx.currentTime, 0.15); }
  setOverload(v) {
    if (!this.ok()) return;
    const now = this.ctx.currentTime;
    this.whine.frequency.setTargetAtTime(300 + 1700 * v, now, 0.3);
    this.whineGain.gain.setTargetAtTime(v > 0.02 ? 0.015 + 0.05 * v : 0, now, 0.2);
  }
  setMuffle(hz) { if (this.ok()) this.muffle.frequency.setTargetAtTime(hz, this.ctx.currentTime, 0.25); }
  setTinnitus(v) { if (this.ok()) this.tinGain.gain.setTargetAtTime(v * 0.025, this.ctx.currentTime, 0.4); }
  setFlatline(on) { if (this.ok()) this.flatGain.gain.setTargetAtTime(on ? 0.05 : 0, this.ctx.currentTime, 0.02); }
  setDrone(v) { if (this.ok()) this.droneGain.gain.setTargetAtTime(0.05 * v, this.ctx.currentTime, 0.5); }

  // ---------------- one-shots ----------------
  // heavy panel push-button: plastic clack + spring
  button() {
    if (!this.ok()) return;
    const t = this.ctx.currentTime;
    this.burst(t, 0.02, this.booth, { freq: 1400 + Math.random() * 300, q: 3, peak: 0.45, a: 0.0006 });
    this.osc('triangle', 180, t, 0.05, this.booth, 0.2, 0.001);
    this.burst(t + 0.06, 0.015, this.booth, { freq: 2600, q: 4, peak: 0.12, a: 0.0006 });
  }
  // laser scalpel through cuticle: crack + sizzle + wet drop
  slice() {
    if (!this.ok()) return;
    const t = this.ctx.currentTime;
    this.burst(t, 0.06, this.glass, { type: 'highpass', freq: 3000, peak: 0.6, a: 0.0005 });
    this.burst(t + 0.02, 0.35, this.glass, { type: 'highpass', freq: 5000, peak: 0.18, a: 0.01 });
    this.osc('sawtooth', 1800, t, 0.08, this.glass, 0.08, 0.001).frequency.exponentialRampToValueAtTime(300, t + 0.08);
    this.burst(t + 0.05, 0.14, this.glass, { type: 'lowpass', freq: 420, q: 3, peak: 0.55, a: 0.003 });
    this.burst(t + 0.75, 0.08, this.glass, { type: 'lowpass', freq: 900, q: 2, peak: 0.3, a: 0.002 });
  }
  // circular saw: motor whine; grinding when the blade bites
  saw(dur = 1.4, biteAt = 0.6) {
    if (!this.ok()) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain(), f = this.ctx.createBiquadFilter();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(980, t + 0.45);
    o.frequency.setValueAtTime(980, t + biteAt);
    o.frequency.exponentialRampToValueAtTime(640, t + biteAt + 0.15);
    o.frequency.exponentialRampToValueAtTime(900, t + dur - 0.2);
    o.frequency.exponentialRampToValueAtTime(150, t + dur + 0.4);
    f.type = 'bandpass'; f.frequency.value = 1800; f.Q.value = 1.2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.3);
    g.gain.setValueAtTime(0.16, t + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.5);
    o.connect(f).connect(g).connect(this.glass);
    o.start(t); o.stop(t + dur + 0.6);
    this.burst(t + biteAt, 0.45, this.glass, { freq: 3500, q: 2, peak: 0.45, a: 0.01 });
    for (let k = 0; k < 10; k++) this.burst(t + biteAt + Math.random() * 0.45, 0.01, this.glass, { freq: 5000 + Math.random() * 3000, q: 4, peak: 0.25, a: 0.0005 });
  }
  // the moment the teeth go through: crack of cuticle, wet thud, spatter
  chop() {
    if (!this.ok()) return;
    const t = this.ctx.currentTime;
    this.burst(t, 0.05, this.glass, { type: 'highpass', freq: 2200, peak: 0.9, a: 0.0005 });
    for (let k = 0; k < 6; k++) this.burst(t + Math.random() * 0.08, 0.012, this.glass, { freq: 1500 + Math.random() * 3000, q: 5, peak: 0.5, a: 0.0005 });
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.2);
    this.env(g, t, 0.003, 0.9, 0.3);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.4);
    this.burst(t + 0.02, 0.25, this.master, { type: 'lowpass', freq: 600, q: 2, peak: 0.7, a: 0.004 });
    for (let k = 0; k < 9; k++) this.burst(t + 0.5 + Math.random() * 0.9, 0.03, this.glass, { type: 'lowpass', freq: 1200, q: 3, peak: 0.25, a: 0.002 });
  }
  knob() {
    if (!this.ok()) return;
    const t = this.ctx.currentTime;
    for (const d of [0, 0.045]) this.burst(t + d, 0.01, this.booth, { freq: 3800, q: 6, peak: 0.3, a: 0.0005 });
  }
  strobeFlash() {
    if (!this.ok()) return;
    const t = this.ctx.currentTime;
    this.burst(t, 0.03, this.glass, { type: 'highpass', freq: 2500, peak: 0.5, a: 0.0005 });
    this.osc('sine', 60, t, 0.06, this.glass, 0.3, 0.001);
    const o = this.osc('sine', 3000, t + 0.05, 0.25, this.glass, 0.02, 0.1);
    o.frequency.exponentialRampToValueAtTime(9000, t + 0.3);
  }
  needle() {
    if (!this.ok()) return;
    const t = this.ctx.currentTime;
    this.burst(t, 0.12, this.glass, { type: 'lowpass', freq: 500, q: 2, peak: 0.6, a: 0.002 });
    this.burst(t + 0.02, 0.18, this.glass, { freq: 1200, q: 5, peak: 0.2, a: 0.01 });
    this.osc('sine', 70, t, 0.2, this.glass, 0.4, 0.002);
  }
  plunger(dur = 1.6) {
    if (!this.ok()) return;
    const t = this.ctx.currentTime;
    const f = this.burst(t, dur, this.glass, { freq: 700, q: 3, peak: 0.12, a: 0.2 });
    f.frequency.linearRampToValueAtTime(260, t + dur);
  }
  // fluorescent tube striking: ticks, then the hum comes up
  tubeStart(at = 0) {
    if (!this.ok()) return;
    const t = this.ctx.currentTime + at;
    for (let k = 0; k < 4; k++) this.burst(t + k * 0.09 + Math.random() * 0.04, 0.02, this.booth, { freq: 3000, q: 3, peak: 0.25, a: 0.0005 });
    this.osc('sawtooth', 100, t + 0.4, 0.5, this.booth, 0.02, 0.05);
  }
  heartbeat() {
    if (!this.ok()) return;
    const t = this.ctx.currentTime;
    for (const [d, v] of [[0, 0.55], [0.22, 0.35]]) {
      const o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.frequency.setValueAtTime(70, t + d); o.frequency.exponentialRampToValueAtTime(38, t + d + 0.12);
      this.env(g, t + d, 0.008, v, 0.18);
      o.connect(g).connect(this.master); o.start(t + d); o.stop(t + d + 0.3);
    }
  }
  spark() {
    if (!this.ok()) return;
    const t = this.ctx.currentTime;
    for (let k = 0; k < 5; k++) this.burst(t + Math.random() * 0.12, 0.008, this.glass, { freq: 2000 + Math.random() * 5000, q: 3, peak: 0.3, a: 0.0005 });
  }
  // intro: the dive into the brain
  dive() {
    if (!this.ok()) return;
    const t = this.ctx.currentTime;
    const f = this.burst(t, 1.3, this.master, { freq: 200, q: 1.5, peak: 0.4, a: 0.9 });
    f.frequency.exponentialRampToValueAtTime(5000, t + 1.2);
    const o = this.osc('sawtooth', 55, t, 1.2, this.master, 0.12, 0.8);
    o.frequency.exponentialRampToValueAtTime(220, t + 1.2);
    this.osc('sine', 40, t + 1.25, 1.2, this.master, 0.7, 0.003);
  }
  drip() {
    if (!this.ok()) return;
    const t = this.ctx.currentTime;
    const o = this.osc('sine', 1400 + Math.random() * 900, t, 0.08, this.glass, 0.12, 0.001);
    o.frequency.exponentialRampToValueAtTime(500, t + 0.07);
  }
  clank() {
    if (!this.ok()) return;
    const t = this.ctx.currentTime;
    for (const f of [180, 433, 911, 1573]) this.osc('sine', f * (0.9 + Math.random() * 0.2), t, 1.4, this.glass, 0.05, 0.002);
    this.burst(t, 0.1, this.glass, { freq: 700, q: 1, peak: 0.3, a: 0.001 });
  }

  update(dt, { escape = 0, seizure = false, flight = 0 } = {}) {
    this.clock += dt;
    if (!this.ok()) {
      // no audio output: still drive the fly's ears with the same 128 BPM pattern
      const beat = (this.clock * 128 / 60) % 1;
      const target = this.musicOn ? 0.35 + 0.65 * Math.exp(-beat * 6) : 0;
      this.level += (target - this.level) * Math.min(1, dt * 25);
      return;
    }
    this.schedule();
    if (this.musicOn) {
      // loudness relative to the loudest recent moment, so any track or volume knob drives the
      // ears over their whole range (a quiet mp3 used to barely register)
      let rms = -1;
      const ana = this.ext ? this.micAna : this.analyser, buf = this.ext ? this.micBuf : this.anaBuf;
      if (ana) {
        ana.getFloatTimeDomainData(buf);
        let s = 0;
        for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
        rms = Math.sqrt(s / buf.length);
      }
      const floor = this.ext ? 0.012 : 0.02;
      if (rms >= 0) this.musicPeak = Math.max(rms, (this.musicPeak || floor) * Math.exp(-dt / 6), floor);
      let target;
      if (rms < 0 || (this.ext && this.musicPeak <= floor * 1.01)) {
        // no microphone, or it hears silence (headphones): a stand-in 128 BPM beat
        const beat = (this.clock * 128 / 60) % 1;
        target = 0.45 + 0.55 * Math.exp(-beat * 6);
      } else target = Math.pow(Math.min(1, rms / this.musicPeak), 0.6);
      this.level += (target - this.level) * Math.min(1, dt * 25);
    } else {
      this.level += (0 - this.level) * Math.min(1, dt * 8);
    }
    const now = this.ctx.currentTime;
    const buzz = Math.max(escape * 0.3, flight * 0.32);
    this.wingGain.gain.setTargetAtTime(Math.min(0.32, buzz), now, 0.05);
    this.wing.frequency.setTargetAtTime(180 + escape * 50 + flight * 60, now, 0.08);
    // the hall is never quite quiet
    if ((this.nextDrip -= dt) < 0) { this.nextDrip = 1.5 + Math.random() * 5; this.drip(); }
    if ((this.nextClank -= dt) < 0) { this.nextClank = 14 + Math.random() * 26; this.clank(); }
    const on = seizure && Math.floor(now * 1.6) % 2 === 0;
    this.alarmGain.gain.setTargetAtTime(on ? 0.04 : 0, now, 0.01);
    this.alarm.frequency.setTargetAtTime(Math.floor(now * 1.6) % 4 < 2 ? 660 : 520, now, 0.005);
    this.horn.frequency.setTargetAtTime(Math.floor(now * 1.1) % 2 ? 196 : 233, now, 0.01);
  }
}

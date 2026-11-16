(() => {
  const ACCENT = '#FF4F12';
  const INK = '#111112';
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function sizer(el) {
    const s = { ctx: el.getContext('2d'), w: 0, h: 0 };
    const fit = () => {
      const r = el.getBoundingClientRect(), d = devicePixelRatio || 1;
      s.w = r.width; s.h = r.height;
      el.width = Math.max(1, Math.round(r.width * d));
      el.height = Math.max(1, Math.round(r.height * d));
      s.ctx.setTransform(d, 0, 0, d, 0, 0);
    };
    fit();
    new ResizeObserver(fit).observe(el);
    return s;
  }

  // Only animate while on screen; reduced motion gets a single settled frame.
  function loop(el, draw, stillTime = 4000) {
    if (still) {
      const once = () => requestAnimationFrame(() => draw(stillTime));
      once();
      return once;
    }
    let id = 0, running = false;
    const tick = (t) => { draw(t); if (running) id = requestAnimationFrame(tick); };
    new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !running) { running = true; id = requestAnimationFrame(tick); }
      else if (!e.isIntersecting && running) { running = false; cancelAnimationFrame(id); }
    }).observe(el);
    return () => {};
  }

  function field(el) {
    const s = sizer(el);
    const p = { x: null, y: null, tx: 0, ty: 0, last: -1e9 };
    const ripples = [];
    const move = (e) => { const r = el.getBoundingClientRect(); p.tx = e.clientX - r.left; p.ty = e.clientY - r.top; p.last = performance.now(); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerdown', (e) => { move(e); ripples.push({ x: p.tx, y: p.ty, t: performance.now() }); if (ripples.length > 6) ripples.shift(); });
    loop(el, (t) => {
      const { ctx, w, h } = s;
      if (!w) return;
      if (t - p.last > 2200) {
        p.tx = w * (0.62 + 0.26 * Math.sin(t * 0.00027));
        p.ty = h * (0.45 + 0.28 * Math.sin(t * 0.00041 + 1.3));
      }
      if (p.x === null) { p.x = p.tx; p.y = p.ty; }
      p.x += (p.tx - p.x) * 0.08; p.y += (p.ty - p.y) * 0.08;
      while (ripples.length && t - ripples[0].t > 1800) ripples.shift();
      ctx.clearRect(0, 0, w, h);
      const gap = 22, sig2 = 2 * 105 * 105;
      for (let y = gap / 2; y < h; y += gap) {
        for (let x = gap / 2; x < w; x += gap) {
          const dx = x - p.x, dy = y - p.y, d2 = dx * dx + dy * dy;
          let f = Math.exp(-d2 / sig2);
          for (const r of ripples) {
            const age = t - r.t, band = Math.hypot(x - r.x, y - r.y) - age * 0.5;
            f += Math.exp(-(band * band) / 650) * (1 - age / 1800) * 0.85;
          }
          const k = Math.min(f, 1), d = Math.sqrt(d2) || 1, push = k * 8;
          const amb = 0.05 * Math.sin(x * 0.017 + y * 0.011 - t * 0.0011);
          ctx.globalAlpha = Math.min(1, 0.17 + amb + k * 0.83);
          ctx.fillStyle = k > 0.42 ? ACCENT : INK;
          ctx.beginPath();
          ctx.arc(x + (dx / d) * push, y + (dy / d) * push, 1.05 + Math.min(f, 1.5) * 2.5, 0, 6.2832);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    });
  }

  function waveGlyph(el) {
    const s = sizer(el);
    loop(el, (t) => {
      const { ctx, w, h } = s;
      if (!w) return;
      ctx.clearRect(0, 0, w, h);
      const n = 28, step = w / n, head = Math.floor(((t / 6000) % 1) * n), ink = getComputedStyle(el).color;
      for (let i = 0; i < n; i++) {
        const a = Math.abs(Math.sin(i * 0.55 + t * 0.0035) * Math.sin(i * 0.23 - t * 0.0016));
        const bh = Math.max(3, (0.18 + 0.82 * a) * h);
        ctx.fillStyle = i <= head ? ACCENT : ink;
        ctx.globalAlpha = i <= head ? 1 : 0.35;
        ctx.fillRect(i * step, (h - bh) / 2, 2, bh);
      }
      ctx.globalAlpha = 1;
    });
  }

  function gridGlyph(el) {
    const s = sizer(el);
    const cols = 16, rows = 4, done = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) done.push(((r * 7 + c * 5 + r * c) % 5) > 1);
    loop(el, (t) => {
      const { ctx, w, h } = s;
      if (!w) return;
      ctx.clearRect(0, 0, w, h);
      const gx = w / cols, gy = h / rows, lit = Math.floor((t / 260) % (cols + 6)), ink = getComputedStyle(el).color;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const on = done[r * cols + c] && c < lit;
          ctx.fillStyle = on && c === Math.min(lit, cols) - 1 ? ACCENT : ink;
          ctx.globalAlpha = on ? 1 : 0.2;
          ctx.beginPath();
          ctx.arc(c * gx + gx / 2, r * gy + gy / 2, Math.min(gx, gy) * 0.26, 0, 6.2832);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    });
  }

  // Runs on the audio thread: two overlapping grains give tempo and pitch independently; scratching reads the buffer at the wheel's own speed.
  const WORKLET = `
class ReverieDeck extends AudioWorkletProcessor {
  constructor() {
    super();
    this.L = null; this.len = 0; this.k = 1; this.c = 0;
    this.r = 0; this.rs = 0; this.scratch = false; this.playing = false; this.tempo = 1; this.pitch = 1;
    this.gs = 0; this.gp = 0; this.G = 2048; this.ph = [0, 1024]; this.st = [0, 0]; this.n = 0;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.L) { this.L = m.L; this.R = m.R; this.len = m.L.length; this.k = m.rate / sampleRate; this.G = Math.round(0.05 * sampleRate); this.ph = [0, this.G >> 1]; }
      if (m.seek !== undefined && this.len) this.c = m.seek * this.len;
      if (m.r !== undefined) { this.r = m.r; this.scratch = m.scratch; this.playing = m.playing; this.tempo = m.tempo; this.pitch = m.pitch; }
    };
  }
  read(b, x) {
    const n = this.len; x = ((x % n) + n) % n;
    const i = x | 0, f = x - i, a = b[i], z = b[i + 1 < n ? i + 1 : 0];
    return a + (z - a) * f;
  }
  process(inputs, outputs) {
    const oL = outputs[0][0], oR = outputs[0][1] || oL;
    if (!this.L) return true;
    const G = this.G, k = this.k;
    for (let s = 0; s < oL.length; s++) {
      this.rs += (this.r - this.rs) * 0.003;
      this.gs += ((this.scratch ? 1 : 0) - this.gs) * 0.004;
      this.gp += ((this.playing && !this.scratch ? 1 : 0) - this.gp) * 0.004;
      let l = 0, r = 0;
      if (this.gs > 0.001) {
        const v = Math.min(1, Math.abs(this.rs) * 3) * this.gs;
        l += this.read(this.L, this.c) * v; r += this.read(this.R, this.c) * v;
      }
      if (this.gp > 0.001) {
        for (let g = 0; g < 2; g++) {
          if (this.ph[g] >= G) { this.ph[g] = 0; this.st[g] = this.c; }
          const p = this.ph[g], w = (0.5 - 0.5 * Math.cos(6.283185307 * p / G)) * this.gp, x = this.st[g] + p * this.pitch * k;
          l += this.read(this.L, x) * w; r += this.read(this.R, x) * w;
          this.ph[g]++;
        }
      }
      this.c += (this.gs * this.rs + this.gp * this.tempo) * k;
      oL[s] = l; oR[s] = r;
    }
    this.c = ((this.c % this.len) + this.len) % this.len;
    if ((this.n += oL.length) >= 1024) { this.n = 0; this.port.postMessage(this.c / this.len); }
    return true;
  }
}
registerProcessor('reverie-deck', ReverieDeck);
`;

  function audioEngine(url) {
    const e = { ready: false, running: false, pos: null, posT: 0, duration: 0, peaks: null };
    e.load = () => e.loading || (e.loading = (async () => {
      const data = await (await fetch(url)).arrayBuffer();
      const buf = await new OfflineAudioContext(2, 1, 44100).decodeAudioData(data);
      const ch = buf.getChannelData(0), n = 720, size = Math.floor(ch.length / n), peaks = new Float32Array(n);
      let max = 0;
      for (let i = 0; i < n; i++) {
        let sum = 0;
        for (let j = i * size, end = j + size; j < end; j += 8) sum += ch[j] * ch[j];
        peaks[i] = Math.sqrt(sum / (size / 8));
        max = Math.max(max, peaks[i]);
      }
      for (let i = 0; i < n; i++) peaks[i] /= max || 1;
      Object.assign(e, { buf, duration: buf.duration, peaks, ready: true });
    })());
    e.start = (fromPos) => e.starting || (e.starting = (async () => {
      const ctx = e.ctx = new AudioContext();
      const src = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
      await ctx.audioWorklet.addModule(src);
      await e.load();
      const node = e.node = new AudioWorkletNode(ctx, 'reverie-deck', { outputChannelCount: [2] });
      const L = e.buf.getChannelData(0).slice();
      const R = (e.buf.numberOfChannels > 1 ? e.buf.getChannelData(1) : e.buf.getChannelData(0)).slice();
      node.port.postMessage({ L, R, rate: e.buf.sampleRate }, [L.buffer, R.buffer]);
      node.port.postMessage({ seek: fromPos() });
      node.port.onmessage = (m) => { e.pos = m.data; e.posT = performance.now(); };
      const len = Math.round(ctx.sampleRate * 3.4), ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let c = 0; c < 2; c++) {
        const d = ir.getChannelData(c);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2) * (i < 600 ? i / 600 : 1);
      }
      const conv = ctx.createConvolver(), dry = e.dry = ctx.createGain(), wet = e.wet = ctx.createGain(), master = ctx.createGain();
      conv.buffer = ir;
      master.gain.value = 0.8;
      node.connect(dry).connect(master);
      node.connect(conv).connect(wet).connect(master);
      master.connect(ctx.destination);
      e.running = true;
      await ctx.resume();
    })());
    e.send = (m) => { if (e.node) e.node.port.postMessage(m); };
    e.reverb = (v) => {
      if (!e.wet) return;
      const t = e.ctx.currentTime;
      e.wet.gain.setTargetAtTime(v * 0.9, t, 0.05);
      e.dry.gain.setTargetAtTime(1 - v * 0.4, t, 0.05);
    };
    return e;
  }

  function deck(wheel) {
    const root = wheel.closest('[data-deck]');
    const tapeEl = root.querySelector('canvas.tape');
    const keys = [...root.querySelectorAll('.key[data-mode]')];
    const playBtn = root.querySelector('.key[data-play]');
    const audio = audioEngine(root.dataset.track);
    const W = sizer(wheel), T = sizer(tapeEl);
    // Same feel as the app: 24°/s motor, 1.8 s of song per scratch turn, a 270° ring.
    const TAU = Math.PI * 2, SPIN = 24 * Math.PI / 180, SCRATCH = 1.8, FRICTION = 4, MIN_COAST = 45 * Math.PI / 180, ARC = Math.PI * 1.5;
    const DIALS = {
      tempo: { min: 0.5, max: 1.5, def: 1, step: 0.05, perTurn: 0.5, fmt: (v) => '×' + v.toFixed(2), short: 'TMP' },
      pitch: { min: -12, max: 12, def: 0, step: 1, perTurn: 12, fmt: (v) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(Math.round(v)) + ' st', short: 'PIT' },
      reverb: { min: 0, max: 100, def: 0, step: 5, perTurn: 100, fmt: (v) => (Math.round(v) === 0 ? 'Off' : Math.round(v) + '%'), short: 'REV' }
    };
    const val = { tempo: 1, pitch: 0, reverb: 0 };
    const st = { pos: 0.3, r: 0, finger: 0, vel: 0, coast: 0, moved: 0, rot: 0, mode: null, drag: false, playing: false, last: 0, lastT: 0, prev: 0, flash: -1e9, tick: 0 };

    const len = () => audio.duration || +root.dataset.duration || 100;
    const norm = (m) => (val[m] - DIALS[m].min) / (DIALS[m].max - DIALS[m].min);
    const shown = (m) => (m === 'pitch' ? Math.round(val[m]) : val[m]);
    const clock = (sec) => { sec = Math.floor(sec); return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0'); };
    const click = () => { st.flash = performance.now(); if (navigator.vibrate) navigator.vibrate(4); };
    const wake = () => { audio.start(() => st.pos).then(() => audio.reverb(val.reverb / 100)).catch(() => {}); };

    new IntersectionObserver(([en]) => { if (en.isIntersecting) audio.load().catch(() => {}); }, { rootMargin: '600px' }).observe(root);

    const sync = () => {
      keys.forEach((k) => {
        const m = k.dataset.mode;
        k.setAttribute('aria-pressed', String(st.mode === m));
        k.querySelector('output').textContent = DIALS[m].fmt(shown(m));
      });
      playBtn.setAttribute('aria-pressed', String(st.playing));
      playBtn.setAttribute('aria-label', st.playing ? 'Pause' : 'Play');
      playBtn.querySelector('.mono').textContent = st.playing ? 'Pause' : 'Play';
      wheel.setAttribute('aria-valuetext', st.mode ? `${st.mode} ${DIALS[st.mode].fmt(shown(st.mode))}` : `${clock(st.pos * len())} of ${clock(len())}`);
      audio.reverb(val.reverb / 100);
    };

    const angleAt = (e) => {
      const r = wheel.getBoundingClientRect();
      return Math.atan2(e.clientY - r.top - r.height / 2, e.clientX - r.left - r.width / 2);
    };
    const applyTurn = (d, dtSec, smooth) => {
      if (st.mode) {
        const D = DIALS[st.mode], before = Math.floor(val[st.mode] / D.step + 1e-6);
        const next = val[st.mode] + (d / TAU) * D.perTurn;
        val[st.mode] = Math.min(D.max, Math.max(D.min, next));
        if (Math.floor(val[st.mode] / D.step + 1e-6) !== before) click();
        sync();
        if (val[st.mode] !== next) return false;
        st.rot += d;
        return true;
      }
      st.rot += d;
      const tick = Math.floor(st.rot / (TAU / 60));
      if (tick !== st.tick) { st.tick = tick; click(); }
      const rps = (d / TAU) / dtSec;
      const perTurn = Math.min(SCRATCH * Math.max(1, Math.abs(rps)), Math.max(SCRATCH, len() * 0.25));
      const inst = Math.max(-12, Math.min(12, rps * perTurn));
      st.finger = smooth ? st.finger * 0.4 + inst * 0.6 : inst;
      return true;
    };
    wheel.addEventListener('pointerdown', (e) => {
      wake();
      st.drag = true; st.coast = 0; st.vel = 0; st.finger = 0;
      st.last = angleAt(e); st.lastT = performance.now(); st.moved = st.lastT;
      wheel.setPointerCapture(e.pointerId);
    });
    wheel.addEventListener('pointermove', (e) => {
      if (!st.drag) return;
      const a = angleAt(e), now = performance.now(), dt = Math.max(1, now - st.lastT) / 1000;
      let d = a - st.last;
      if (d > Math.PI) d -= TAU;
      if (d < -Math.PI) d += TAU;
      st.last = a; st.lastT = now; st.moved = now;
      st.vel = st.vel * 0.5 + (d / dt) * 0.5;
      applyTurn(d, dt, true);
    });
    const release = () => {
      if (!st.drag) return;
      st.drag = false;
      const fresh = performance.now() - st.moved < 50;
      st.coast = fresh && Math.abs(st.vel) > MIN_COAST * 3 ? Math.max(-26, Math.min(26, st.vel)) : 0;
      sync();
    };
    wheel.addEventListener('pointerup', release);
    wheel.addEventListener('pointercancel', release);
    wheel.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); playBtn.click(); return; }
      const d = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[e.key];
      if (!d) return;
      e.preventDefault();
      if (st.mode) {
        const D = DIALS[st.mode];
        val[st.mode] = Math.min(D.max, Math.max(D.min, val[st.mode] + d * D.step));
      } else {
        st.pos = ((st.pos + d * 2 / len()) % 1 + 1) % 1;
        audio.send({ seek: st.pos });
        audio.pos = null;
      }
      sync();
    });
    keys.forEach((k) => {
      const m = k.dataset.mode;
      k.addEventListener('click', () => { st.mode = st.mode === m ? null : m; st.coast = 0; sync(); });
      k.addEventListener('dblclick', () => { val[m] = DIALS[m].def; st.mode = m; sync(); });
    });
    playBtn.addEventListener('click', () => { wake(); st.playing = !st.playing; sync(); });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && st.playing) { st.playing = false; st.r = 0; audio.send({ r: 0, scratch: false, playing: false, tempo: val.tempo, pitch: 1 }); sync(); }
    });

    const fallback = (u) => {
      const x = u * 40;
      const v = Math.abs(Math.sin(x * 1.7) * 0.5 + Math.sin(x * 0.63 + 1) * 0.35 + Math.sin(x * 4.1) * 0.15);
      return Math.min(1, v * (0.35 + 0.65 * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.08)), 0.6)) * 1.25);
    };

    function drawWheel(t) {
      const { ctx, w } = W;
      if (!w) return;
      const c = w / 2, R = c - Math.max(22, w * 0.06), lit = Math.max(0, 1 - (t - st.flash) / 160);
      ctx.clearRect(0, 0, w, w);
      ctx.lineCap = 'round';
      const start = Math.PI * 0.75, ar = R + Math.max(10, w * 0.028), frac = Math.min(1, Math.max(0, st.mode ? norm(st.mode) : st.pos));
      ctx.lineWidth = 3;
      ctx.strokeStyle = INK; ctx.globalAlpha = 0.12;
      ctx.beginPath(); ctx.arc(c, c, ar, start, start + ARC); ctx.stroke();
      ctx.strokeStyle = st.mode ? ACCENT : INK; ctx.globalAlpha = st.mode ? 1 : 0.55;
      ctx.beginPath(); ctx.arc(c, c, ar, start, start + ARC * frac); ctx.stroke();
      ctx.strokeStyle = INK;
      ctx.globalAlpha = 0.9; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(c, c, R, 0, TAU); ctx.stroke();
      for (let i = 0; i < 120; i++) {
        const a = st.rot + (i / 120) * TAU - Math.PI / 2, major = i % 10 === 0;
        const nearTop = Math.abs(Math.atan2(Math.sin(a + Math.PI / 2), Math.cos(a + Math.PI / 2))) < 0.06;
        ctx.globalAlpha = (major ? 0.75 : 0.32) + (nearTop ? lit * 0.6 : 0);
        ctx.lineWidth = major ? 1.5 : 1;
        const r1 = R - (major ? R * 0.11 : R * 0.06), r2 = R - R * 0.02;
        ctx.beginPath(); ctx.moveTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1); ctx.lineTo(c + Math.cos(a) * r2, c + Math.sin(a) * r2); ctx.stroke();
      }
      ctx.globalAlpha = 0.16; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(c, c, R * 0.66, 0, TAU); ctx.stroke();
      ctx.beginPath(); ctx.arc(c, c, R * 0.14, 0, TAU); ctx.stroke();
      const ma = st.rot - Math.PI / 2;
      ctx.strokeStyle = ACCENT; ctx.globalAlpha = 1; ctx.lineWidth = 2.5 + lit * 1.5;
      ctx.beginPath(); ctx.moveTo(c + Math.cos(ma) * R * 0.7, c + Math.sin(ma) * R * 0.7); ctx.lineTo(c + Math.cos(ma) * R * 0.84, c + Math.sin(ma) * R * 0.84); ctx.stroke();
      ctx.strokeStyle = INK; ctx.globalAlpha = 0.9; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(c, c - R - 6); ctx.lineTo(c, c - R - Math.max(14, w * 0.03)); ctx.stroke();
      ctx.globalAlpha = 1; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `500 ${Math.max(10, w * 0.022)}px 'Geist Mono', monospace`;
      ctx.fillStyle = '#5C5C59';
      const loading = audio.starting && !audio.running;
      const label = st.mode ? st.mode.toUpperCase() : loading ? 'LOADING' : st.drag ? 'SCRUB' : st.playing ? 'PLAYING' : 'PAUSED';
      ctx.fillText(label, c, c - R * 0.3);
      ctx.fillStyle = INK;
      ctx.font = `500 ${Math.max(22, w * 0.07)}px Geist, sans-serif`;
      ctx.fillText(st.mode ? DIALS[st.mode].fmt(shown(st.mode)) : clock(st.pos * len()), c, c + R * 0.34);
      ctx.textAlign = 'start';
    }

    function drawTape(t) {
      const { ctx, w, h } = T;
      if (!w) return;
      ctx.clearRect(0, 0, w, h);
      ctx.textBaseline = 'top';
      ctx.font = "500 12px 'Geist Mono', monospace";
      ctx.fillStyle = INK;
      ctx.fillText('Dopamine — KV', 0, 0);
      const tl = clock(st.pos * len()) + ' / ' + clock(len());
      ctx.fillStyle = '#5C5C59';
      ctx.fillText(tl, w - ctx.measureText(tl).width, 0);
      let x = 0;
      for (const m of ['tempo', 'pitch', 'reverb']) {
        const label = DIALS[m].short + ' ' + DIALS[m].fmt(shown(m)), tw = ctx.measureText(label).width;
        if (st.mode === m) { ctx.fillStyle = ACCENT; ctx.fillRect(x - 6, 22, tw + 12, 20); ctx.fillStyle = '#fff'; }
        else ctx.fillStyle = '#5C5C59';
        ctx.fillText(label, x, 26);
        x += tw + 28;
      }
      const top = 58, mid = top + (h - top) / 2, maxH = h - top - 8;
      const step = 5, n = Math.floor(w / step), head = st.pos * n, rv = val.reverb / 100, P = audio.peaks;
      ctx.fillStyle = INK;
      for (let i = 0; i < n; i++) {
        let a = P ? Math.min(1, P[Math.floor((i / n) * P.length)] * 1.15) : fallback(i / n) * 0.35;
        const near = Math.abs(i - head);
        if (st.playing && near < 6) a = Math.min(1, a * (1 + 0.25 * (1 - near / 6) * (0.5 + 0.5 * Math.sin(t * 0.018 * val.tempo + i))));
        const bh = Math.max(2, a * maxH);
        if (rv > 0) {
          ctx.globalAlpha = 0.09 * rv;
          const gh = Math.min(maxH, bh * (1 + rv * 0.6));
          ctx.fillRect(i * step - rv * 2, mid - gh / 2, 2 + rv * 3, gh);
        }
        ctx.globalAlpha = i <= head ? 1 : 0.22;
        ctx.fillRect(i * step, mid - bh / 2, 2, bh);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = ACCENT;
      ctx.fillRect(head * step - 1, top, 2, h - top);
    }

    sync();
    const frame = (t) => {
      const dt = st.prev ? Math.min(64, t - st.prev) / 1000 : 0.016; st.prev = t;
      const target = st.playing ? val.tempo : 0;
      const ease = () => { st.r += (target - st.r) * Math.min(1, dt * 8); };
      let scratch = false;
      if (st.drag) {
        if (st.mode) ease();
        else {
          if (performance.now() - st.moved > 50) st.finger *= 0.6;
          st.r = st.finger; scratch = true;
        }
      } else if (st.coast) {
        st.coast *= Math.exp(-FRICTION * dt);
        const moved = applyTurn(st.coast * dt, dt, false);
        if (st.mode) ease(); else { st.r = st.finger; scratch = true; }
        if (Math.abs(st.coast) < MIN_COAST || !moved) st.coast = 0;
      } else {
        ease();
        if (st.playing) st.rot += SPIN * val.tempo * dt;
      }
      if (audio.running && audio.pos !== null) {
        st.pos = (((audio.pos + ((performance.now() - audio.posT) / 1000) * st.r / len()) % 1) + 1) % 1;
      } else {
        st.pos = (((st.pos + st.r * dt / len()) % 1) + 1) % 1;
      }
      audio.send({ r: st.r, scratch, playing: st.playing, tempo: val.tempo, pitch: Math.pow(2, Math.round(val.pitch) / 12) });
      drawWheel(t);
      drawTape(t);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  function habits(el) {
    const s = sizer(el);
    const names = ['Read', 'Run', 'Water', 'Stretch', 'Journal', 'Walk', 'Meditate', 'Lights out'];
    const colors = ['#5B9DF9', '#62C089', '#EFC557', '#F0A05A', '#E78AAE', '#6FC8D6', '#A893DB', '#FF8A8A'];
    const MAXC = 40, toggled = {}, blooms = [];
    const base = (r, c) => ((r * 7 + c * 11 + r * c * 3) % 9) > 2 || (c > MAXC - 6 && (r + c) % 4 !== 0);
    const on = (r, c) => { const key = r + ':' + c; return key in toggled ? toggled[key] : base(r, c); };
    let hover = null, t0 = null, g = null, redraw = () => {};
    const geo = () => {
      const { w, h } = s, labelW = w < 640 ? 76 : 128, streakW = w < 640 ? 40 : 64;
      const rows = 8, cell = Math.min(32, Math.floor(h / rows));
      const cols = Math.min(MAXC, Math.max(4, Math.floor((w - labelW - streakW) / cell)));
      return { streakW, rows, cell, cols, x0: w - streakW - cols * cell, y0: (h - rows * cell) / 2 };
    };
    const hit = (e) => {
      if (!g) return null;
      const b = el.getBoundingClientRect();
      const c = Math.floor((e.clientX - b.left - g.x0) / g.cell), r = Math.floor((e.clientY - b.top - g.y0) / g.cell);
      if (r < 0 || r >= g.rows || c < 0 || c >= g.cols) return null;
      return { r, c: MAXC - g.cols + c };
    };
    el.addEventListener('pointermove', (e) => { hover = hit(e); el.style.cursor = hover ? 'pointer' : 'default'; redraw(); });
    el.addEventListener('pointerleave', () => { hover = null; redraw(); });
    el.addEventListener('pointerdown', (e) => {
      const p = hit(e);
      if (!p) return;
      const next = !on(p.r, p.c);
      toggled[p.r + ':' + p.c] = next;
      if (next && !still) blooms.push({ r: p.r, c: p.c, t: performance.now() });
      redraw();
    });
    redraw = loop(el, (t) => {
      const { ctx, w, h } = s;
      if (!w) return;
      if (t0 === null) t0 = still ? -1e6 : t;
      g = geo();
      const first = MAXC - g.cols, pad = Math.max(2, g.cell * 0.14), rad = Math.max(2, g.cell * 0.18);
      ctx.clearRect(0, 0, w, h);
      ctx.font = (w < 640 ? '11px' : '12px') + " 'Geist Mono', monospace";
      ctx.textBaseline = 'middle';
      while (blooms.length && t - blooms[0].t > 700) blooms.shift();
      for (let r = 0; r < g.rows; r++) {
        const cy = g.y0 + r * g.cell;
        ctx.fillStyle = INK;
        ctx.globalAlpha = hover && hover.r === r ? 1 : 0.62;
        ctx.fillText(names[r], 0, cy + g.cell / 2);
        let streak = 0;
        for (let c = MAXC - 1; c >= 0 && on(r, c); c--) streak++;
        const label = streak + 'd';
        ctx.globalAlpha = streak ? 1 : 0.35;
        ctx.fillText(label, w - ctx.measureText(label).width, cy + g.cell / 2);
        for (let i = 0; i < g.cols; i++) {
          const c = first + i, x = g.x0 + i * g.cell;
          const appear = Math.min(1, Math.max(0, (t - t0 - i * 28 - r * 18) / 380));
          const lit = on(r, c) && appear > 0;
          const isHover = hover && hover.r === r && hover.c === c;
          const sz = g.cell - pad * 2, off = (g.cell - sz) / 2;
          let alpha = appear;
          if (lit && c === MAXC - 1 && !still) alpha *= 0.82 + 0.18 * Math.sin(t * 0.004);
          ctx.globalAlpha = lit ? alpha : (isHover ? 0.22 : 0.08);
          ctx.fillStyle = lit ? colors[r] : INK;
          ctx.beginPath();
          ctx.roundRect(x + off, cy + off, sz, sz, rad);
          ctx.fill();
          if (isHover) {
            ctx.globalAlpha = 0.9;
            ctx.strokeStyle = INK;
            ctx.lineWidth = 1.25;
            ctx.beginPath();
            ctx.roundRect(x + off - 2.5, cy + off - 2.5, sz + 5, sz + 5, rad + 2);
            ctx.stroke();
          }
        }
      }
      for (const b of blooms) {
        const i = b.c - first;
        if (i < 0) continue;
        const p = (t - b.t) / 700, grow = g.cell * (0.6 + p * 1.4);
        const cx = g.x0 + i * g.cell + g.cell / 2, cy = g.y0 + b.r * g.cell + g.cell / 2;
        ctx.globalAlpha = (1 - p) * 0.55;
        ctx.strokeStyle = colors[b.r];
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(cx - grow / 2, cy - grow / 2, grow, grow, rad + p * 6);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }, 1e6);
  }

  const mounts = { field, wave: waveGlyph, grid: gridGlyph, deck, habits };
  document.querySelectorAll('canvas[data-draw]').forEach((el) => mounts[el.dataset.draw]?.(el));
})();

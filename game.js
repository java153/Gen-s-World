(() => {
  'use strict';

  // ================= Config =================
  const W = 320, H = 180;
  const FIXED_DT = 1 / 60;
  const MAX_ACCUM = 0.25;
  const GRID_W = 64, GRID_H = 48, CELL = 3;
  const PAINT_X = 64, PAINT_Y = 18, PAINT_W = GRID_W * CELL, PAINT_H = GRID_H * CELL;
  const PARTICLE_MAX = 180;
  const SAVE_KEY = 'gens_world_painter_v2';

  const PALETTES = [
    {
      name: 'Pharaoh Sunset',
      colors: [
        [66, 102, 220], [250, 133, 56], [211, 116, 24], [241, 227, 95],
        [93, 203, 255], [116, 232, 146], [169, 92, 255], [255, 95, 152]
      ]
    },
    {
      name: 'Neon Tomb',
      colors: [
        [76, 86, 236], [255, 98, 74], [247, 208, 63], [112, 248, 255],
        [255, 68, 210], [129, 251, 131], [255, 160, 91], [175, 201, 255]
      ]
    },
    {
      name: 'Gen Dream',
      colors: [
        [103, 128, 255], [255, 126, 201], [255, 179, 102], [255, 243, 147],
        [132, 236, 255], [181, 255, 182], [211, 157, 255], [255, 106, 106]
      ]
    }
  ];

  const SECRET_MSG = [
    'Gen, every pixel is a little love note 💖',
    'Palette unlocked: Neon Tomb ✨',
    'Palette unlocked: Gen Dream 🌈',
    'Your art is glowing beautifully.'
  ];

  // ================= Utils =================
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const hashString = (str) => {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  };
  const makeRng = (seed) => {
    let s = seed >>> 0 || 1;
    return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  };
  const daySeed = () => {
    const d = new Date();
    return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
  };

  // ================= DOM =================
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  ctx.imageSmoothingEnabled = false;

  const titleCard = document.getElementById('titleCard');
  const topHud = document.getElementById('topHud');
  const startOverlay = document.getElementById('startOverlay');
  const fpsOverlay = document.getElementById('fpsOverlay');
  const paletteRow = document.getElementById('paletteRow');

  const strokeLabel = document.getElementById('strokeLabel');
  const bestLabel = document.getElementById('bestLabel');
  const gemLabel = document.getElementById('gemLabel');
  const moodLabel = document.getElementById('moodLabel');
  const messageLabel = document.getElementById('messageLabel');
  const unlockLabel = document.getElementById('unlockLabel');
  const brushLabel = document.getElementById('brushLabel');

  const seedInput = document.getElementById('seedInput');
  const perfModeEl = document.getElementById('perfMode');
  const scanlineEl = document.getElementById('scanlineMode');
  const reducedMotionEl = document.getElementById('reducedMotion');
  const highContrastEl = document.getElementById('highContrast');
  const showFpsEl = document.getElementById('showFpsToggle');
  const muteEl = document.getElementById('muteToggle');
  const volumeEl = document.getElementById('volume');

  // ================= State =================
  let rng = makeRng(hashString(daySeed()));
  let started = false;
  let paused = false;
  let showFps = false;
  let perfMode = false;
  let scanline = true;
  let reducedMotion = false;
  let highContrast = false;
  let muted = false;

  let paletteUnlock = 1;
  let paletteIndex = 0;
  let colorIndex = 0;
  let tool = 0; // 0 paint, 1 erase, 2 pulse+
  let brush = 2;
  let strokes = 0;
  let gems = 0;
  let best = 0;
  let secretStep = 0;
  let globalWave = 0;

  let accum = 0;
  let last = 0;
  let fpsFrames = 0;
  let fpsTime = 0;
  let fps = 60;

  // Grid data (typed arrays for perf)
  const colorGrid = new Uint8Array(GRID_W * GRID_H); // 0 = empty, 1..8 color idx+1
  const pulseGrid = new Uint8Array(GRID_W * GRID_H); // phase offset

  // Offscreen paint buffer
  const paintCanvas = document.createElement('canvas');
  paintCanvas.width = PAINT_W;
  paintCanvas.height = PAINT_H;
  const paintCtx = paintCanvas.getContext('2d', { alpha: false, desynchronized: true });
  const paintImage = paintCtx.createImageData(PAINT_W, PAINT_H);
  const px = new Uint32Array(paintImage.data.buffer);
  const littleEndian = new Uint8Array(new Uint32Array([0x11223344]).buffer)[0] === 0x44;

  const WAVE = new Uint8Array(1024);
  for (let i = 0; i < 1024; i++) WAVE[i] = (128 + Math.sin((i / 1024) * Math.PI * 2) * 127) | 0;

  // precomputed colors: [palette][color(0-7)][wave(0-1023)]
  const colorLut = [];
  function packRGBA(r, g, b) {
    return littleEndian ? (255 << 24) | (b << 16) | (g << 8) | r : (r << 24) | (g << 16) | (b << 8) | 255;
  }
  function rebuildColorLut() {
    colorLut.length = 0;
    for (let p = 0; p < PALETTES.length; p++) {
      const pal = PALETTES[p].colors;
      const palSet = [];
      for (let c = 0; c < pal.length; c++) {
        const [br, bg, bb] = pal[c];
        const arr = new Uint32Array(1024);
        for (let w = 0; w < 1024; w++) {
          const osc = WAVE[w];
          const amp = highContrast ? 18 : 48;
          const r = clamp(br + ((osc - 128) * amp >> 8), 0, 255);
          const g = clamp(bg + ((127 - osc) * amp >> 8), 0, 255);
          const b = clamp(bb + ((osc - 128) * amp >> 9), 0, 255);
          arr[w] = packRGBA(r, g, b);
        }
        palSet.push(arr);
      }
      colorLut.push(palSet);
    }
  }
  rebuildColorLut();

  // ================= Audio =================
  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.music = null;
      this.sfx = null;
      this.step = 0;
      this.tempo = 132;
      this.nextTime = 0;
      this.timer = 0;
      this.playing = false;
      this.lookAhead = 0.12;
      this.seqA = [64, 67, 71, 72, 71, 67, 64, -1, 64, 67, 71, 74, 71, 67, 64, -1];
      this.bass = [40, -1, 40, -1, 43, -1, 35, -1, 38, -1, 40, -1, 35, -1, 31, -1];
      this.noiseBuf = null;
    }
    init() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.music = this.ctx.createGain();
      this.sfx = this.ctx.createGain();
      this.music.gain.value = 0.7;
      this.sfx.gain.value = 0.8;
      this.music.connect(this.master);
      this.sfx.connect(this.master);
      this.master.connect(this.ctx.destination);
      this.setVolume(Number(volumeEl.value));
      const size = this.ctx.sampleRate * 0.06;
      this.noiseBuf = this.ctx.createBuffer(1, size | 0, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    }
    setVolume(v) { if (this.master) this.master.gain.value = muted ? 0 : v; }
    hz(n) { return 440 * Math.pow(2, (n - 69) / 12); }
    tone(time, dur, note, type, gain, bus) {
      if (!this.ctx || note < 0) return;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(this.hz(note), time);
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(gain, time + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
      o.connect(g); g.connect(bus);
      o.start(time); o.stop(time + dur + 0.02);
    }
    drum(time, gain = 0.05) {
      if (!this.ctx || !this.noiseBuf) return;
      const s = this.ctx.createBufferSource();
      const g = this.ctx.createGain();
      s.buffer = this.noiseBuf;
      g.gain.value = gain;
      s.connect(g); g.connect(this.music);
      s.start(time);
    }
    start() {
      this.init();
      if (this.playing) return;
      this.playing = true;
      this.nextTime = this.ctx.currentTime + 0.05;
      this.timer = window.setInterval(() => this.schedule(), 25);
    }
    stop() {
      if (this.timer) clearInterval(this.timer);
      this.timer = 0;
      this.playing = false;
    }
    schedule() {
      const stepDur = 60 / this.tempo / 4;
      while (this.nextTime < this.ctx.currentTime + this.lookAhead) {
        const i = this.step & 15;
        this.tone(this.nextTime, stepDur * 0.9, this.seqA[i], 'square', 0.06, this.music);
        this.tone(this.nextTime, stepDur * 0.95, this.bass[i], 'triangle', 0.07, this.music);
        if (i % 4 === 0) this.drum(this.nextTime, 0.04);
        if (i % 8 === 4) this.drum(this.nextTime, 0.03);
        this.step++;
        this.nextTime += stepDur;
      }
    }
    sfxPaint() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this.tone(t, 0.05, 79, 'square', 0.04, this.sfx);
    }
    sfxUnlock() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this.tone(t, 0.08, 72, 'triangle', 0.06, this.sfx);
      this.tone(t + 0.06, 0.12, 79, 'square', 0.06, this.sfx);
    }
  }
  const audio = new AudioEngine();

  // ================= Particle Pool =================
  const partX = new Float32Array(PARTICLE_MAX);
  const partY = new Float32Array(PARTICLE_MAX);
  const partVX = new Float32Array(PARTICLE_MAX);
  const partVY = new Float32Array(PARTICLE_MAX);
  const partLife = new Float32Array(PARTICLE_MAX);
  const partCol = new Uint8Array(PARTICLE_MAX);
  const partOn = new Uint8Array(PARTICLE_MAX);

  function spawnParticle(x, y, color) {
    for (let i = 0; i < PARTICLE_MAX; i++) {
      if (partOn[i]) continue;
      partOn[i] = 1;
      partX[i] = x; partY[i] = y;
      const a = rng() * Math.PI * 2;
      const s = 8 + rng() * 18;
      partVX[i] = Math.cos(a) * s;
      partVY[i] = Math.sin(a) * s;
      partLife[i] = 0.25 + rng() * 0.35;
      partCol[i] = color;
      return;
    }
  }

  // ================= Save =================
  function saveData() {
    const data = {
      best,
      paletteUnlock,
      settings: {
        perfMode, scanline, reducedMotion, highContrast, showFps, muted,
        volume: Number(volumeEl.value)
      }
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  }

  function loadData() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
      best = s.best | 0;
      paletteUnlock = clamp(s.paletteUnlock | 0, 1, PALETTES.length) || 1;
      if (s.settings) {
        perfMode = !!s.settings.perfMode;
        scanline = s.settings.scanline !== false;
        reducedMotion = !!s.settings.reducedMotion;
        highContrast = !!s.settings.highContrast;
        showFps = !!s.settings.showFps;
        muted = !!s.settings.muted;
        volumeEl.value = String(s.settings.volume ?? 0.65);
      }
    } catch {}
    bestLabel.textContent = String(best);
    perfModeEl.checked = perfMode;
    scanlineEl.checked = scanline;
    reducedMotionEl.checked = reducedMotion;
    highContrastEl.checked = highContrast;
    showFpsEl.checked = showFps;
    muteEl.checked = muted;
    fpsOverlay.classList.toggle('hidden', !showFps);
    document.body.classList.toggle('hc', highContrast);
    rebuildColorLut();
  }

  // ================= Painting =================
  function clearArt() {
    colorGrid.fill(0);
    pulseGrid.fill(0);
    strokes = 0;
    gems = 0;
    secretStep = 0;
    messageLabel.textContent = 'Fresh canvas. Paint something magical for Gen.';
    updateHud();
  }

  function pickPalette(index) {
    paletteIndex = clamp(index, 0, paletteUnlock - 1);
    moodLabel.textContent = `Palette: ${PALETTES[paletteIndex].name}`;
    renderPaletteButtons();
  }

  function updateHud() {
    strokeLabel.textContent = String(strokes);
    bestLabel.textContent = String(best);
    gemLabel.textContent = String(gems);
  }

  function idx(gx, gy) { return gy * GRID_W + gx; }

  function brushAt(gx, gy) {
    const bs = brush;
    for (let oy = -bs; oy <= bs; oy++) {
      const y = gy + oy;
      if (y < 0 || y >= GRID_H) continue;
      for (let ox = -bs; ox <= bs; ox++) {
        const x = gx + ox;
        if (x < 0 || x >= GRID_W) continue;
        if (ox * ox + oy * oy > bs * bs) continue;
        const i = idx(x, y);
        const before = colorGrid[i];
        if (tool === 1) {
          colorGrid[i] = 0;
          pulseGrid[i] = 0;
        } else if (tool === 2) {
          if (before !== 0) pulseGrid[i] = (pulseGrid[i] + 48) & 255;
        } else {
          colorGrid[i] = colorIndex + 1;
          pulseGrid[i] = (globalWave + ((rng() * 255) | 0)) & 255;
          if (before === 0) {
            strokes++;
            if (strokes > best) { best = strokes; saveData(); }
          }
        }
      }
    }

    if (!reducedMotion) {
      const c = colorIndex;
      const count = perfMode ? 2 : 4;
      for (let i = 0; i < count; i++) {
        const sx = PAINT_X + gx * CELL + 1;
        const sy = PAINT_Y + gy * CELL + 1;
        spawnParticle(sx, sy, c);
      }
    }

    if (tool === 0 && (strokes % 40 === 0) && strokes > 0) {
      gems++;
      if (gems % 2 === 0 && paletteUnlock < PALETTES.length) {
        paletteUnlock++;
        unlockLabel.textContent = `Unlocked palette: ${PALETTES[paletteUnlock - 1].name}`;
        messageLabel.textContent = SECRET_MSG[Math.min(secretStep, SECRET_MSG.length - 1)];
        secretStep++;
        audio.sfxUnlock();
      }
    }

    if ((strokes & 7) === 0) audio.sfxPaint();
    updateHud();
  }

  let drawing = false;
  let lastGX = -1, lastGY = -1;

  function canvasToGrid(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    const x = ((clientX - r.left) * W / r.width) | 0;
    const y = ((clientY - r.top) * H / r.height) | 0;
    if (x < PAINT_X || x >= PAINT_X + PAINT_W || y < PAINT_Y || y >= PAINT_Y + PAINT_H) return null;
    return [((x - PAINT_X) / CELL) | 0, ((y - PAINT_Y) / CELL) | 0];
  }

  function paintLine(x0, y0, x1, y1) {
    let dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    let dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    while (true) {
      brushAt(x0, y0);
      if (x0 === x1 && y0 === y1) break;
      const e2 = err << 1;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  function onPointerDown(e) {
    if (!started) return;
    const p = canvasToGrid(e.clientX, e.clientY);
    if (!p) return;
    drawing = true;
    lastGX = p[0]; lastGY = p[1];
    brushAt(lastGX, lastGY);
    e.preventDefault();
  }
  function onPointerMove(e) {
    if (!drawing || !started) return;
    const p = canvasToGrid(e.clientX, e.clientY);
    if (!p) return;
    const gx = p[0], gy = p[1];
    if (gx === lastGX && gy === lastGY) return;
    paintLine(lastGX, lastGY, gx, gy);
    lastGX = gx; lastGY = gy;
    e.preventDefault();
  }
  function onPointerUp() { drawing = false; }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
  canvas.addEventListener('touchmove', e => e.preventDefault(), { passive: false });

  // ================= Input =================
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'p') paused = !paused;
    else if (k === 'f') { showFps = !showFps; showFpsEl.checked = showFps; fpsOverlay.classList.toggle('hidden', !showFps); saveData(); }
    else if (k === 'm') { muted = !muted; muteEl.checked = muted; audio.setVolume(Number(volumeEl.value)); saveData(); }
    else if (k === 'c') clearArt();
    else if (k === '[') { brush = clamp(brush - 1, 1, 4); brushLabel.textContent = `Brush ${brush}`; }
    else if (k === ']') { brush = clamp(brush + 1, 1, 4); brushLabel.textContent = `Brush ${brush}`; }
    else if (k >= '1' && k <= '8') colorIndex = clamp((k.charCodeAt(0) - 49), 0, 7);
  });

  // ================= Rendering =================
  function renderBackground(t) {
    ctx.fillStyle = highContrast ? '#000' : '#456fdf';
    ctx.fillRect(0, 0, W, H);

    // clouds
    if (!perfMode) {
      ctx.fillStyle = highContrast ? '#fff' : '#d8d8d8';
      for (let i = 0; i < 6; i++) {
        const x = ((i * 56 + (t * 0.01 * (i + 1))) % (W + 20)) - 20;
        const y = 8 + ((i & 1) * 8);
        ctx.fillRect(x | 0, y, 16, 6);
        ctx.fillRect((x + 4) | 0, y - 3, 10, 3);
      }
    }

    // pyramids inspired geometry
    ctx.fillStyle = highContrast ? '#777' : '#ff7f3f';
    ctx.beginPath();
    ctx.moveTo(45, 120); ctx.lineTo(120, 30); ctx.lineTo(190, 120); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(130, 120); ctx.lineTo(210, 20); ctx.lineTo(290, 120); ctx.closePath(); ctx.fill();

    ctx.fillStyle = highContrast ? '#444' : '#bc6b00';
    ctx.beginPath();
    ctx.moveTo(70, 120); ctx.lineTo(120, 55); ctx.lineTo(165, 120); ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(160, 120); ctx.lineTo(210, 42); ctx.lineTo(260, 120); ctx.closePath(); ctx.fill();

    // patterned frame area
    ctx.fillStyle = highContrast ? '#111' : '#7d7408';
    ctx.fillRect(0, 120, W, 60);
    if (!perfMode) {
      ctx.fillStyle = highContrast ? '#333' : '#d0be2c';
      for (let y = 120; y < H; y += 4) {
        for (let x = 0; x < W; x += 6) {
          if (((x + y) & 8) === 0) ctx.fillRect(x, y, 2, 2);
        }
      }
    }

    // paint frame
    ctx.fillStyle = highContrast ? '#fff' : '#a96c15';
    ctx.fillRect(PAINT_X - 6, PAINT_Y - 6, PAINT_W + 12, PAINT_H + 12);
    ctx.fillStyle = '#000';
    ctx.fillRect(PAINT_X - 2, PAINT_Y - 2, PAINT_W + 4, PAINT_H + 4);
  }

  function renderPaintLayer() {
    px.fill(packRGBA(0, 0, 0));
    const lut = colorLut[paletteIndex];
    const wave = globalWave & 1023;

    for (let gy = 0; gy < GRID_H; gy++) {
      let row = gy * GRID_W;
      for (let gx = 0; gx < GRID_W; gx++) {
        const ci = colorGrid[row + gx];
        if (ci === 0) continue;
        const pulse = pulseGrid[row + gx];
        const color = lut[ci - 1][(wave + pulse) & 1023];
        const sx = gx * CELL;
        const sy = gy * CELL;
        const o0 = sy * PAINT_W + sx;
        const o1 = o0 + PAINT_W;
        const o2 = o1 + PAINT_W;
        px[o0] = color; px[o0 + 1] = color; px[o0 + 2] = color;
        px[o1] = color; px[o1 + 1] = color; px[o1 + 2] = color;
        px[o2] = color; px[o2 + 1] = color; px[o2 + 2] = color;
      }
    }

    paintCtx.putImageData(paintImage, 0, 0);
    ctx.drawImage(paintCanvas, PAINT_X, PAINT_Y);
  }

  function renderParticles(dt) {
    if (reducedMotion) return;
    for (let i = 0; i < PARTICLE_MAX; i++) {
      if (!partOn[i]) continue;
      partLife[i] -= dt;
      if (partLife[i] <= 0) { partOn[i] = 0; continue; }
      partVY[i] += 16 * dt;
      partX[i] += partVX[i] * dt;
      partY[i] += partVY[i] * dt;
      const c = PALETTES[paletteIndex].colors[partCol[i] % 8];
      ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
      ctx.fillRect(partX[i] | 0, partY[i] | 0, 1, 1);
    }
  }

  function renderCRT() {
    if (!scanline || perfMode) return;
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
    ctx.fillStyle = 'rgba(255,140,60,0.07)';
    ctx.fillRect(0, 0, W, 4);
    ctx.fillRect(0, H - 4, W, 4);
  }

  function renderUI() {
    ctx.fillStyle = '#111';
    ctx.fillRect(6, 6, 86, 12);
    ctx.fillStyle = '#8effff';
    const fill = Math.min(84, ((strokes % 80) / 80) * 84) | 0;
    ctx.fillRect(7, 7, fill, 10);
    if (paused) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#fff';
      ctx.font = '8px monospace';
      ctx.fillText('PAUSED', 145, 90);
    }
  }

  function render(dt, t) {
    renderBackground(t);
    renderPaintLayer();
    renderParticles(dt);
    renderUI();
    renderCRT();
  }

  // ================= Update/Loop =================
  function update(dt) {
    if (!started || paused) return;
    globalWave = (globalWave + (reducedMotion ? 2 : 5)) & 1023;
  }

  function loop(ts) {
    if (!last) last = ts;
    let dt = (ts - last) / 1000;
    last = ts;
    if (dt > MAX_ACCUM) dt = MAX_ACCUM;
    accum += dt;

    while (accum >= FIXED_DT) {
      update(FIXED_DT);
      accum -= FIXED_DT;
    }

    render(dt, ts);

    fpsTime += dt;
    fpsFrames++;
    if (fpsTime > 0.25) {
      fps = (fpsFrames / fpsTime) | 0;
      if (showFps) fpsOverlay.innerHTML = `FPS: ${fps}<br/>FT: ${(1000 / (fps || 1)).toFixed(1)} ms`;
      fpsFrames = 0;
      fpsTime = 0;
    }

    requestAnimationFrame(loop);
  }

  // ================= UI wiring =================
  function renderPaletteButtons() {
    paletteRow.innerHTML = '';
    for (let i = 0; i < paletteUnlock; i++) {
      const b = document.createElement('button');
      b.className = 'colorBtn' + (i === paletteIndex ? ' active' : '');
      const c = PALETTES[i].colors[0];
      b.style.background = `rgb(${c[0]},${c[1]},${c[2]})`;
      b.title = PALETTES[i].name;
      b.addEventListener('click', () => pickPalette(i));
      paletteRow.appendChild(b);
    }
  }

  function setTool(t) {
    tool = t;
    document.getElementById('toolPaint').classList.toggle('active', t === 0);
    document.getElementById('toolErase').classList.toggle('active', t === 1);
    document.getElementById('toolPulse').classList.toggle('active', t === 2);
  }

  document.getElementById('gestureBtn').addEventListener('click', () => {
    startOverlay.classList.add('hidden');
    audio.init();
    audio.start();
    audio.stop(); // obey autoplay policy: unlocked but not yet running until Start
  });

  document.getElementById('startBtn').addEventListener('click', () => {
    started = true;
    titleCard.classList.add('hidden');
    topHud.classList.remove('hidden');
    const seed = seedInput.value.trim() || daySeed();
    rng = makeRng(hashString(seed));
    pickPalette(0);
    messageLabel.textContent = 'Draw your 8-bit masterpiece for Gen 💖';
    audio.start();
  });

  document.getElementById('clearBtn').addEventListener('click', clearArt);
  document.getElementById('toolPaint').addEventListener('click', () => setTool(0));
  document.getElementById('toolErase').addEventListener('click', () => setTool(1));
  document.getElementById('toolPulse').addEventListener('click', () => setTool(2));
  document.getElementById('sizeDown').addEventListener('click', () => { brush = clamp(brush - 1, 1, 4); brushLabel.textContent = `Brush ${brush}`; });
  document.getElementById('sizeUp').addEventListener('click', () => { brush = clamp(brush + 1, 1, 4); brushLabel.textContent = `Brush ${brush}`; });

  perfModeEl.addEventListener('change', (e) => { perfMode = e.target.checked; saveData(); });
  scanlineEl.addEventListener('change', (e) => { scanline = e.target.checked; saveData(); });
  reducedMotionEl.addEventListener('change', (e) => { reducedMotion = e.target.checked; saveData(); });
  highContrastEl.addEventListener('change', (e) => {
    highContrast = e.target.checked;
    document.body.classList.toggle('hc', highContrast);
    rebuildColorLut();
    saveData();
  });
  showFpsEl.addEventListener('change', (e) => {
    showFps = e.target.checked;
    fpsOverlay.classList.toggle('hidden', !showFps);
    saveData();
  });
  muteEl.addEventListener('change', (e) => { muted = e.target.checked; audio.setVolume(Number(volumeEl.value)); saveData(); });
  volumeEl.addEventListener('input', () => { audio.setVolume(Number(volumeEl.value)); saveData(); });

  // init
  loadData();
  setTool(0);
  clearArt();
  pickPalette(0);
  topHud.classList.add('hidden');
  brushLabel.textContent = `Brush ${brush}`;
  updateHud();
  requestAnimationFrame(loop);
})();

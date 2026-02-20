/* Gen's World! - single file game engine, no dependencies */
(() => {
  'use strict';

  // ===================== Config =====================
  const W = 320;
  const H = 180;
  const FIXED_DT = 1 / 60;
  const MAX_ACCUM = 0.2;
  const GEM_POOL = 20;
  const PARTICLE_POOL = 220;
  const CAMERA_SHAKE_DECAY = 1.6;

  const MOODS = [
    { name: 'Sunset Garden', bgA: '#2b1f3d', bgB: '#ff7f7f', ground: '#6c4d84', deco: '#7dd67d', gem: '#ffd35c', quirk: 0 },
    { name: 'Neon Night', bgA: '#09041d', bgB: '#2e2be8', ground: '#3f2f6a', deco: '#48f2ff', gem: '#ff58dc', quirk: 1 },
    { name: 'Rainy Arcade', bgA: '#1a294a', bgB: '#436f8d', ground: '#2a3f52', deco: '#80c8d2', gem: '#9bf9ff', quirk: 2 },
    { name: 'Starfield', bgA: '#050510', bgB: '#301050', ground: '#2b2153', deco: '#fff2a5', gem: '#ff9ccd', quirk: 3 }
  ];

  const SAVE_KEY = 'gens_world_save_v1';

  // ===================== Util =====================
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOutQuad = t => 1 - (1 - t) * (1 - t);

  function hashString(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function makeRng(seed) {
    let s = seed >>> 0 || 123456789;
    return () => {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
      return ((s >>> 0) & 0xffffffff) / 4294967296;
    };
  }

  function daySeed() {
    const d = new Date();
    return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
  }

  // ===================== DOM =====================
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  const hud = document.getElementById('hud');
  const menu = document.getElementById('menu');
  const startOverlay = document.getElementById('startOverlay');
  const fpsOverlay = document.getElementById('fpsOverlay');
  const scoreLabel = document.getElementById('scoreLabel');
  const bestLabel = document.getElementById('bestLabel');
  const gemLabel = document.getElementById('gemLabel');
  const moodLabel = document.getElementById('moodLabel');
  const messageLabel = document.getElementById('messageLabel');
  const unlockLabel = document.getElementById('unlockLabel');
  const seedInput = document.getElementById('seedInput');
  const volumeSlider = document.getElementById('volume');

  // ===================== State =====================
  let rng = makeRng(hashString(daySeed()));
  let inMenu = true;
  let started = false;
  let paused = false;
  let challengeMode = false;
  let showFps = false;
  let mute = false;
  let reducedMotion = false;
  let highContrast = false;
  let scanline = true;
  let perfMode = false;
  let moodIndex = 0;
  let moodMeter = 0;
  let score = 0;
  let gemCount = 0;
  let timer = 120;
  let secretIndex = 0;
  let bestScore = 0;
  let unlockedPalettes = 0;
  let accum = 0;
  let last = 0;
  let frameFps = 60;
  let frameMs = 16.7;
  let fpsTimer = 0;
  let fpsFrames = 0;
  let cameraShake = 0;

  const secrets = [
    'Gen, your smile is my favorite power-up.',
    'You unlocked: Starlight Palette ✨',
    'The world says: thank you for being you 💖'
  ];

  const player = {
    x: 160, y: 100, vx: 0, vy: 0, speed: 58,
    dashCd: 0, dashT: 0, face: 1
  };

  const gems = new Float32Array(GEM_POOL * 3); // x, y, active
  const particles = new Float32Array(PARTICLE_POOL * 7); // x y vx vy life type active

  // ===================== Input =====================
  const input = { up: 0, down: 0, left: 0, right: 0, action: 0 };
  function onKey(e, d) {
    const k = e.key.toLowerCase();
    if (k === 'w' || k === 'arrowup') input.up = d;
    else if (k === 's' || k === 'arrowdown') input.down = d;
    else if (k === 'a' || k === 'arrowleft') input.left = d;
    else if (k === 'd' || k === 'arrowright') input.right = d;
    else if (k === ' ') input.action = d;
    if (d && k === 'p') paused = !paused;
    if (d && k === 'm') setMute(!mute);
    if (d && k === 'f') { showFps = !showFps; fpsOverlay.classList.toggle('hidden', !showFps); }
    if (d && k === 'enter' && inMenu) startRun();
  }
  window.addEventListener('keydown', e => onKey(e, 1));
  window.addEventListener('keyup', e => onKey(e, 0));

  // Touch controls
  const stick = document.getElementById('stickZone');
  const knob = document.getElementById('stickKnob');
  const actionBtn = document.getElementById('actionBtn');
  let stickActive = false;
  let stickCx = 50, stickCy = 50;
  function handleStick(clientX, clientY) {
    const r = stick.getBoundingClientRect();
    const x = clientX - r.left;
    const y = clientY - r.top;
    const dx = clamp(x - stickCx, -32, 32);
    const dy = clamp(y - stickCy, -32, 32);
    knob.style.left = `${32 + dx}px`;
    knob.style.top = `${32 + dy}px`;
    input.left = dx < -8 ? 1 : 0; input.right = dx > 8 ? 1 : 0;
    input.up = dy < -8 ? 1 : 0; input.down = dy > 8 ? 1 : 0;
  }
  stick.addEventListener('pointerdown', e => { stickActive = true; handleStick(e.clientX, e.clientY); });
  stick.addEventListener('pointermove', e => { if (stickActive) handleStick(e.clientX, e.clientY); });
  const endStick = () => {
    stickActive = false; input.left = input.right = input.up = input.down = 0;
    knob.style.left = '32px'; knob.style.top = '32px';
  };
  stick.addEventListener('pointerup', endStick);
  stick.addEventListener('pointercancel', endStick);
  actionBtn.addEventListener('pointerdown', () => { input.action = 1; });
  actionBtn.addEventListener('pointerup', () => { input.action = 0; });

  // ===================== Audio =====================
  class AudioEngine {
    constructor() {
      this.ctx = null;
      this.master = null;
      this.music = null;
      this.sfx = null;
      this.delay = null;
      this.playing = false;
      this.volume = 0.7;
      this.step = 0;
      this.nextNoteTime = 0;
      this.tempo = 138;
      this.lookAhead = 0.12;
      this.scheduleInt = 25;
      this.scheduler = 0;
      this.pattern = this.makeSong();
    }

    init() {
      if (this.ctx) return;
      const A = window.AudioContext || window.webkitAudioContext;
      this.ctx = new A();
      this.master = this.ctx.createGain();
      this.music = this.ctx.createGain();
      this.sfx = this.ctx.createGain();
      this.delay = this.ctx.createDelay(0.2);
      const fb = this.ctx.createGain();
      this.delay.delayTime.value = 0.11;
      fb.gain.value = 0.19;
      this.delay.connect(fb); fb.connect(this.delay);
      this.music.connect(this.delay);
      this.delay.connect(this.master);
      this.music.connect(this.master);
      this.sfx.connect(this.master);
      this.master.connect(this.ctx.destination);
      this.setVolume(this.volume);
    }

    setVolume(v) {
      this.volume = v;
      if (this.master) this.master.gain.value = mute ? 0 : v;
    }

    noteHz(note) {
      if (note < 0) return 0;
      return 440 * Math.pow(2, (note - 69) / 12);
    }

    tone(time, dur, note, type, gain, bus) {
      if (note < 0 || !this.ctx) return;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(this.noteHz(note), time);
      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(gain, time + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
      o.connect(g); g.connect(bus);
      o.start(time); o.stop(time + dur + 0.02);
    }

    noise(time, dur, gain) {
      const len = Math.floor(this.ctx.sampleRate * dur);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = this.ctx.createBufferSource();
      const g = this.ctx.createGain();
      g.gain.value = gain;
      src.buffer = buf; src.connect(g); g.connect(this.music);
      src.start(time);
    }

    makeSong() {
      const A = [72, 74, 76, 77, 79, 81, 79, 77, 76, 74, 72, 69, 71, 72, -1, -1];
      const B = [76, 77, 79, 81, 83, 84, 83, 81, 79, 77, 76, 72, 74, 76, -1, -1];
      const BR = [67, 69, 71, 72, 74, 76, 77, 79, 77, 76, 74, 72, 71, 69, -1, -1];
      const bassA = [48, -1, 48, -1, 50, -1, 52, -1, 45, -1, 45, -1, 47, -1, 50, -1];
      const bassB = [52, -1, 52, -1, 55, -1, 57, -1, 50, -1, 50, -1, 52, -1, 55, -1];
      const intro = [69, -1, 71, -1, 72, -1, 74, -1, 76, -1, 77, -1, 79, -1, -1, -1];
      // ~2.3 minutes @138 bpm, 16th steps
      const seq = [];
      for (let i = 0; i < 4; i++) seq.push({ l: intro, b: bassA, d: i % 2 });
      for (let i = 0; i < 16; i++) seq.push({ l: A, b: bassA, d: i % 2 });
      for (let i = 0; i < 16; i++) seq.push({ l: B, b: bassB, d: 1 });
      for (let i = 0; i < 8; i++) seq.push({ l: BR, b: bassA, d: 1 });
      for (let i = 0; i < 16; i++) seq.push({ l: A, b: bassA, d: i % 2 });
      return seq;
    }

    startMusic() {
      this.init();
      if (this.playing) return;
      this.playing = true;
      this.nextNoteTime = this.ctx.currentTime + 0.06;
      this.scheduler = window.setInterval(() => this.schedule(), this.scheduleInt);
    }

    stopMusic() {
      if (this.scheduler) clearInterval(this.scheduler);
      this.scheduler = 0;
      this.playing = false;
    }

    schedule() {
      const spb = 60 / this.tempo / 4;
      while (this.nextNoteTime < this.ctx.currentTime + this.lookAhead) {
        const patt = this.pattern[(this.step >> 4) % this.pattern.length];
        const i = this.step & 15;
        const nL = patt.l[i];
        const nB = patt.b[i];
        if (nL >= 0) this.tone(this.nextNoteTime, spb * 0.9, nL, 'square', 0.06, this.music);
        if (nB >= 0) this.tone(this.nextNoteTime, spb * 0.95, nB, 'triangle', 0.085, this.music);
        if (patt.d && (i % 4 === 0)) this.noise(this.nextNoteTime, 0.03, 0.05);
        if (i % 8 === 4) this.noise(this.nextNoteTime, 0.02, 0.03);
        this.step++;
        this.nextNoteTime += spb;
      }
    }

    sfxPickup() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this.tone(t, 0.09, 84, 'square', 0.08, this.sfx);
      this.tone(t + 0.04, 0.09, 88, 'square', 0.06, this.sfx);
    }
    sfxDash() { if (this.ctx) this.noise(this.ctx.currentTime, 0.04, 0.06); }
    sfxMood() {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this.tone(t, 0.16, 72, 'triangle', 0.08, this.sfx);
      this.tone(t + 0.08, 0.2, 79, 'square', 0.06, this.sfx);
    }
  }
  const audio = new AudioEngine();

  // ===================== Save =====================
  function loadSave() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
      bestScore = s.bestScore | 0;
      unlockedPalettes = s.unlockedPalettes | 0;
      volumeSlider.value = String(s.volume ?? 0.7);
      perfMode = !!s.perfMode;
      reducedMotion = !!s.reducedMotion;
      highContrast = !!s.highContrast;
      scanline = s.scanline !== false;
      document.getElementById('perfMode').checked = perfMode;
      document.getElementById('reducedMotion').checked = reducedMotion;
      document.getElementById('highContrast').checked = highContrast;
      document.getElementById('scanlineMode').checked = scanline;
    } catch {}
    bestLabel.textContent = String(bestScore);
  }

  function saveGame() {
    const data = {
      bestScore, unlockedPalettes,
      volume: Number(volumeSlider.value),
      perfMode, reducedMotion, highContrast, scanline
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  }

  // ===================== Gameplay =====================
  function spawnGem(i) {
    const base = i * 3;
    gems[base] = 16 + (rng() * (W - 32)) | 0;
    gems[base + 1] = 28 + (rng() * (H - 56)) | 0;
    gems[base + 2] = 1;
  }

  function resetWorld() {
    player.x = 160; player.y = 100; player.vx = 0; player.vy = 0;
    player.dashCd = 0; player.dashT = 0;
    score = 0; gemCount = 0; moodMeter = 0; timer = 120; moodIndex = 0; secretIndex = 0;
    for (let i = 0; i < GEM_POOL; i++) spawnGem(i);
    for (let i = 0; i < PARTICLE_POOL; i++) particles[i * 7 + 6] = 0;
    updateHud();
  }

  function setSeedFromInput() {
    const txt = seedInput.value.trim() || daySeed();
    rng = makeRng(hashString(txt));
  }

  function setMute(m) { mute = m; audio.setVolume(Number(volumeSlider.value)); }

  function startRun() {
    inMenu = false;
    menu.classList.add('hidden');
    hud.classList.remove('hidden');
    setSeedFromInput();
    resetWorld();
    audio.startMusic();
    started = true;
  }

  function addParticle(x, y, vx, vy, life, type) {
    for (let i = 0; i < PARTICLE_POOL; i++) {
      const b = i * 7;
      if (particles[b + 6] === 0) {
        particles[b] = x; particles[b + 1] = y; particles[b + 2] = vx;
        particles[b + 3] = vy; particles[b + 4] = life; particles[b + 5] = type; particles[b + 6] = 1;
        return;
      }
    }
  }

  function spawnBurst(x, y, n, type) {
    const count = perfMode ? (n >> 1) : n;
    for (let i = 0; i < count; i++) {
      const a = rng() * Math.PI * 2;
      const s = 18 + rng() * 35;
      addParticle(x, y, Math.cos(a) * s, Math.sin(a) * s, 0.35 + rng() * 0.4, type);
    }
  }

  function moodShift() {
    moodIndex = (moodIndex + 1) % MOODS.length;
    moodMeter = 0;
    cameraShake = 1;
    audio.sfxMood();
    spawnBurst(player.x, player.y, 28, 2);
    messageLabel.textContent = `Mood Shift: ${MOODS[moodIndex].name}`;
  }

  function update(dt) {
    if (inMenu || paused) return;
    timer -= dt * (challengeMode ? 1.1 : 0.65);
    if (timer <= 0) {
      timer = 120;
      moodShift();
    }

    let mx = input.right - input.left;
    let my = input.down - input.up;
    const mag = Math.hypot(mx, my) || 1;
    mx /= mag; my /= mag;

    if (player.dashCd > 0) player.dashCd -= dt;
    if (player.dashT > 0) player.dashT -= dt;

    if (input.action && player.dashCd <= 0) {
      player.dashCd = 0.7;
      player.dashT = 0.12;
      const dx = mx || player.face;
      const dy = my;
      player.vx += dx * 125;
      player.vy += dy * 125;
      spawnBurst(player.x, player.y, 10, 1);
      audio.sfxDash();
    }

    const accel = player.dashT > 0 ? 240 : 140;
    player.vx += mx * accel * dt;
    player.vy += my * accel * dt;
    player.vx *= 0.84;
    player.vy *= 0.84;

    player.x += player.vx * dt;
    player.y += player.vy * dt;

    if (mx !== 0) player.face = mx > 0 ? 1 : -1;

    if (player.x < 0) player.x += W;
    if (player.x >= W) player.x -= W;
    player.y = clamp(player.y, 20, H - 18);

    const px = player.x;
    const py = player.y;

    for (let i = 0; i < GEM_POOL; i++) {
      const b = i * 3;
      if (gems[b + 2] === 0) continue;
      const dx = gems[b] - px;
      const dy = gems[b + 1] - py;
      if (dx * dx + dy * dy < 70) {
        gems[b + 2] = 0;
        score += 10 + (moodIndex * 2);
        gemCount++;
        moodMeter += 0.16;
        spawnBurst(gems[b], gems[b + 1], 16, 0);
        audio.sfxPickup();
        spawnGem(i);
        if (moodMeter >= 1) moodShift();
        if (score > bestScore) {
          bestScore = score;
          saveGame();
        }
        if (score >= 120 && unlockedPalettes < 1) {
          unlockedPalettes = 1;
          unlockLabel.textContent = 'Unlocked: Starlight contrast palette!';
          saveGame();
        }
        if (gemCount % 12 === 0 && secretIndex < secrets.length) {
          messageLabel.textContent = secrets[secretIndex++];
        }
      }
    }

    const grav = MOODS[moodIndex].quirk === 2 ? 16 : 0;
    for (let i = 0; i < PARTICLE_POOL; i++) {
      const b = i * 7;
      if (!particles[b + 6]) continue;
      particles[b + 4] -= dt;
      if (particles[b + 4] <= 0) { particles[b + 6] = 0; continue; }
      particles[b + 3] += grav * dt;
      particles[b] += particles[b + 2] * dt;
      particles[b + 1] += particles[b + 3] * dt;
    }

    if (!reducedMotion && rng() < 0.08) {
      addParticle((rng() * W) | 0, 12 + ((rng() * 30) | 0), 0, 8 + rng() * 12, 1 + rng(), 3);
    }

    cameraShake = Math.max(0, cameraShake - dt * CAMERA_SHAKE_DECAY);
    updateHud();
  }

  function updateHud() {
    scoreLabel.textContent = String(score);
    bestLabel.textContent = String(bestScore);
    gemLabel.textContent = String(gemCount);
    moodLabel.textContent = MOODS[moodIndex].name;
  }

  // ===================== Renderer =====================
  function drawPixelHeart(x, y, c) {
    ctx.fillStyle = c;
    ctx.fillRect(x + 1, y, 2, 1);
    ctx.fillRect(x, y + 1, 4, 1);
    ctx.fillRect(x, y + 2, 4, 1);
    ctx.fillRect(x + 1, y + 3, 2, 1);
  }

  function render(t) {
    const mood = MOODS[moodIndex];
    const shx = cameraShake > 0 ? ((rng() * 3 - 1.5) * cameraShake) | 0 : 0;
    const shy = cameraShake > 0 ? ((rng() * 3 - 1.5) * cameraShake) | 0 : 0;

    ctx.setTransform(1, 0, 0, 1, shx, shy);
    ctx.fillStyle = highContrast ? '#000' : mood.bgA;
    ctx.fillRect(-2, -2, W + 4, H + 4);

    // sky gradient bands
    for (let y = 0; y < 80; y += 8) {
      const k = y / 80;
      ctx.fillStyle = highContrast ? '#111' : `rgba(${(24 + 150 * k) | 0}, ${(16 + 80 * k) | 0}, ${(45 + 150 * k) | 0}, 0.75)`;
      ctx.fillRect(0, y, W, 8);
    }

    // ground
    ctx.fillStyle = highContrast ? '#222' : mood.ground;
    ctx.fillRect(0, 130, W, 50);

    // environment strips
    const wave = Math.sin(t * 0.002) * (reducedMotion ? 0.5 : 2);
    ctx.fillStyle = highContrast ? '#fff' : mood.deco;
    for (let i = 0; i < 40; i++) {
      const x = (i * 9 + ((t * 0.03) | 0)) % W;
      const h = 3 + ((i + moodIndex) % 4);
      ctx.fillRect(x, 130 - h - ((i & 1) ? wave : -wave), 1, h);
    }

    // gems
    const pulse = 0.5 + 0.5 * Math.sin(t * 0.01);
    ctx.fillStyle = mood.gem;
    for (let i = 0; i < GEM_POOL; i++) {
      const b = i * 3;
      if (!gems[b + 2]) continue;
      const x = gems[b] | 0;
      const y = (gems[b + 1] + ((i & 1) ? pulse : -pulse)) | 0;
      ctx.fillRect(x, y, 2, 2);
      ctx.fillRect(x - 1, y + 1, 4, 1);
    }

    // particles
    for (let i = 0; i < PARTICLE_POOL; i++) {
      const b = i * 7;
      if (!particles[b + 6]) continue;
      const type = particles[b + 5] | 0;
      if (type === 0) ctx.fillStyle = '#fff3b0';
      else if (type === 1) ctx.fillStyle = '#8ffcff';
      else if (type === 2) ctx.fillStyle = '#ff8ed2';
      else ctx.fillStyle = '#9ab0ff';
      ctx.fillRect(particles[b] | 0, particles[b + 1] | 0, 1, 1);
    }

    // player
    const px = player.x | 0;
    const py = player.y | 0;
    drawPixelHeart(px - 2, py - 3, highContrast ? '#0ff' : '#ff5e9c');
    if ((t * 0.02) % 2 < 1) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(px + (player.face > 0 ? 1 : -2), py - 2, 1, 1);
    }

    // mood meter + timer bar
    ctx.fillStyle = '#111'; ctx.fillRect(8, 8, 100, 5);
    ctx.fillStyle = '#ff8cc3'; ctx.fillRect(9, 9, (98 * moodMeter) | 0, 3);
    ctx.fillStyle = '#111'; ctx.fillRect(8, 15, 100, 4);
    ctx.fillStyle = '#8be2ff'; ctx.fillRect(9, 16, (98 * (timer / 120)) | 0, 2);

    if (scanline && !perfMode) {
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
    }

    if (paused) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#fff';
      ctx.fillText('PAUSED', 140, 90);
    }
  }

  // ===================== Main loop =====================
  function frame(ts) {
    if (!last) last = ts;
    let dt = (ts - last) / 1000;
    last = ts;
    if (dt > MAX_ACCUM) dt = MAX_ACCUM;
    accum += dt;

    while (accum >= FIXED_DT) {
      update(FIXED_DT);
      accum -= FIXED_DT;
    }
    render(ts);

    fpsTimer += dt;
    fpsFrames++;
    if (fpsTimer >= 0.25) {
      frameFps = (fpsFrames / fpsTimer) | 0;
      frameMs = 1000 / (frameFps || 1);
      fpsFrames = 0; fpsTimer = 0;
      if (showFps) fpsOverlay.innerHTML = `FPS: ${frameFps}<br/>FT: ${frameMs.toFixed(1)} ms`;
    }

    requestAnimationFrame(frame);
  }

  // ===================== UI =====================
  document.getElementById('gestureBtn').addEventListener('click', () => {
    startOverlay.classList.add('hidden');
    audio.init();
    audio.startMusic();
    audio.stopMusic();
  });

  document.getElementById('startBtn').addEventListener('click', startRun);
  document.getElementById('challengeBtn').addEventListener('click', (e) => {
    challengeMode = !challengeMode;
    e.target.textContent = `Challenge Mode: ${challengeMode ? 'On' : 'Off'}`;
  });

  volumeSlider.addEventListener('input', () => {
    audio.setVolume(Number(volumeSlider.value));
    saveGame();
  });

  document.getElementById('perfMode').addEventListener('change', e => { perfMode = e.target.checked; saveGame(); });
  document.getElementById('scanlineMode').addEventListener('change', e => { scanline = e.target.checked; saveGame(); });
  document.getElementById('reducedMotion').addEventListener('change', e => { reducedMotion = e.target.checked; saveGame(); });
  document.getElementById('highContrast').addEventListener('change', e => {
    highContrast = e.target.checked;
    document.body.classList.toggle('hc', highContrast);
    saveGame();
  });

  loadSave();
  audio.setVolume(Number(volumeSlider.value));
  hud.classList.add('hidden');
  messageLabel.textContent = 'A tiny world of hearts, stars, and surprises for Gen.';
  requestAnimationFrame(frame);
})();

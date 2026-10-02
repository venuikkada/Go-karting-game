import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Track } from './track.js';
import { buildScenery } from './scenery.js';
import { Kart, PHYS } from './kart.js';
import { AIDriver } from './ai.js';
import { Input, isTouchDevice } from './input.js';
import { HUD } from './hud.js';
import { GameAudio } from './audio.js';
import { Particles, SkidMarks, SpeedLines } from './effects.js';
import { clamp, damp, lerp, rand, formatTime, ordinal } from './utils.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const THEMES = {
  day: {
    name: 'day', skyTop: 0x2f7fe0, skyHorizon: 0xcfe9ff, skyBottom: 0xa9c4b0,
    sunDir: new THREE.Vector3(-0.45, 0.72, 0.5), sunGlow: 0xfff0c8, sunColor: 0xfff1dc, sunIntensity: 3.3,
    hemiSky: 0xcfe6ff, hemiGround: 0x5b7343, hemiIntensity: 1.15, fog: 0xcfe9ff, fogNear: 260, fogFar: 1900,
    grass: '#4c8b36', verge: '#5c8e42', mountain: 0x6c8a7c, snow: 0xf4f8ff, pine: 0x2f6b3a, leaf: 0x5b9b38,
    water: 0x2a6fa8, cloud: 0xffffff, exposure: 1.0, bloom: 0.22,
  },
  sunset: {
    name: 'sunset', skyTop: 0x22357a, skyHorizon: 0xff9a58, skyBottom: 0x5a3f52,
    sunDir: new THREE.Vector3(-0.75, 0.1, 0.65), sunGlow: 0xffa040, sunColor: 0xffb377, sunIntensity: 2.8,
    hemiSky: 0xffb59a, hemiGround: 0x40304a, hemiIntensity: 0.85, fog: 0xe9956c, fogNear: 220, fogFar: 1600,
    grass: '#577a33', verge: '#66803e', mountain: 0x5a4a6e, snow: 0xffd9c4, pine: 0x2c5a34, leaf: 0x6a8a30,
    water: 0x6a4a7a, cloud: 0xffc3a0, exposure: 1.0, bloom: 0.45,
  },
  night: {
    name: 'night', skyTop: 0x02040c, skyHorizon: 0x14233f, skyBottom: 0x05070c,
    sunDir: new THREE.Vector3(0.35, 0.45, -0.6), sunGlow: 0x9ab4ff, sunColor: 0xa8bcff, sunIntensity: 1.3,
    hemiSky: 0x5568a8, hemiGround: 0x1a1e2e, hemiIntensity: 1.1, fog: 0x101a30, fogNear: 160, fogFar: 1200,
    grass: '#24452a', verge: '#2c4a30', mountain: 0x1b2438, snow: 0x8a9ac0, pine: 0x1d3f27, leaf: 0x2c5a2a,
    water: 0x0a1a35, cloud: 0x445066, exposure: 1.35, bloom: 0.8,
  },
};

const QUALITY = {
  low: { pixelRatio: 1, bloom: false, shadowSize: 1024, msaa: 0, particles: 0.5 },
  medium: { pixelRatio: 1.5, bloom: true, shadowSize: 2048, msaa: 2, particles: 0.8 },
  high: { pixelRatio: 2, bloom: true, shadowSize: 2048, msaa: 4, particles: 1 },
};

const RIVALS = [
  { name: 'Blaze', color: 0xff7a00, accent: 0x111111, helmet: 0xffcc00 },
  { name: 'Viper', color: 0x22c55e, accent: 0x111111, helmet: 0xffffff },
  { name: 'Nova', color: 0x9b4dff, accent: 0xffffff, helmet: 0x00e5ff },
  { name: 'Storm', color: 0x1e6bff, accent: 0xffffff, helmet: 0xd81e2c },
  { name: 'Rex', color: 0xffcc00, accent: 0x111111, helmet: 0x111111 },
  { name: 'Kira', color: 0xff4fa0, accent: 0xffffff, helmet: 0xffffff },
  { name: 'Ace', color: 0xeeeeee, accent: 0xd81e2c, helmet: 0x1e6bff },
];
const PLAYER_COLORS = [0xff2a2a, 0x1e6bff, 0x22c55e, 0xffcc00, 0x9b4dff, 0xff4fa0, 0xff7a00, 0xeeeeee, 0x222222];
const SKILL = { easy: [0.84, 0.9], normal: [0.93, 0.99], hard: [0.99, 1.05] };
const FIXED_DT = 1 / 120;
const KART_COUNT = 6;
const PLAYER_SLOT = 3;

const touch = isTouchDevice();
document.body.classList.toggle('touch', touch);

// ---------------------------------------------------------------------------
// Settings (persisted)
// ---------------------------------------------------------------------------
const settings = {
  laps: 3, difficulty: 'normal', time: 'day', quality: touch ? 'medium' : 'high',
  steer: 'touch', autoAccel: 'on', color: 0, muted: false,
};
try { Object.assign(settings, JSON.parse(localStorage.getItem('turbokart.settings') || '{}')); } catch { /* ignore */ }
const saveSettings = () => { try { localStorage.setItem('turbokart.settings', JSON.stringify(settings)); } catch { /* ignore */ } };

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.1, 5000);
const speedLines = new SpeedLines(document.getElementById('speedlines'));
const input = new Input();
input.bindTouch(document.getElementById('touch'));
const audio = new GameAudio();
const track = new Track();
const hud = new HUD(track);

let scene, composer, bloomPass, sun, hemi, headlight, smoke, sparks, flames, skids, sceneryGroup;
let builtTheme = null;
let builtQuality = null;
let resScale = 1;

function qualityCfg() { return QUALITY[settings.quality] || QUALITY.medium; }

function disposeScene(s) {
  s.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose();
        m.dispose();
      }
    }
  });
}

function buildWorld() {
  const theme = THEMES[settings.time];
  const q = qualityCfg();
  if (builtTheme === theme.name && builtQuality === settings.quality) return;
  if (scene) disposeScene(scene);

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(theme.fog, theme.fogNear, theme.fogFar);
  renderer.toneMappingExposure = theme.exposure;

  hemi = new THREE.HemisphereLight(theme.hemiSky, theme.hemiGround, theme.hemiIntensity);
  scene.add(hemi);
  sun = new THREE.DirectionalLight(theme.sunColor, theme.sunIntensity);
  sun.castShadow = true;
  sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
  const sc = sun.shadow.camera;
  sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 400;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  track.build(scene, theme);
  sceneryGroup = buildScenery(scene, track, theme);

  // Image-based lighting from the sky for glossy kart paint.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const sky = sceneryGroup.children[0].clone();
  envScene.add(sky);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(100, 100).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: theme.hemiGround }));
  ground.position.y = -5;
  envScene.add(ground);
  scene.environment = pmrem.fromScene(envScene, 0.02).texture;
  scene.environmentIntensity = theme.name === 'night' ? 0.35 : 0.8;
  pmrem.dispose();

  const pMul = q.particles;
  smoke = new Particles(scene, Math.floor(900 * pMul));
  sparks = new Particles(scene, Math.floor(700 * pMul), { additive: true });
  flames = new Particles(scene, Math.floor(500 * pMul), { additive: true });
  skids = new SkidMarks(scene, Math.floor(1600 * pMul));

  headlight = null;
  if (theme.name === 'night') {
    headlight = new THREE.SpotLight(0xfff2d8, 260, 90, 0.55, 0.5, 1.6);
    headlight.castShadow = false;
    scene.add(headlight, headlight.target);
  }

  setupComposer();
  game.scene = scene;
  builtTheme = theme.name;
  builtQuality = settings.quality;
}

function setupComposer() {
  const q = qualityCfg();
  const theme = THEMES[settings.time];
  if (composer) composer.dispose();
  composer = null;
  bloomPass = null;
  if (!q.bloom) return;
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: q.msaa });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  bloomPass = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), theme.bloom, 0.55, 0.82);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
  resize();
}

function resize() {
  const w = innerWidth, h = innerHeight;
  const pr = Math.min(devicePixelRatio || 1, qualityCfg().pixelRatio) * resScale;
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h, false);
  if (composer) {
    composer.setPixelRatio(pr);
    composer.setSize(w, h);
  }
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  speedLines.resize(w, h, Math.min(devicePixelRatio || 1, 2));
  for (const p of [smoke, sparks, flames]) if (p) p.setScale(h * pr);
  checkOrientation();
}
addEventListener('resize', resize);

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
const game = {
  state: 'menu', // menu | countdown | race | finished | paused
  karts: [],
  ais: [],
  player: null,
  ranking: [],
  time: 0,
  countdown: 0,
  laps: 3,
  camMode: 0,
  shake: 0,
  prevState: null,
  firstThrottle: -1,
  finishTimer: 0,
};
window.__game = game; // handy for debugging & automated tests

let camHeading = 0;
const camPos = new THREE.Vector3();
const camLook = new THREE.Vector3();
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const wheelTrail = new Map();

function setupRace() {
  buildWorld();
  for (const k of game.karts) scene.remove(k.group);
  game.karts = [];
  game.ais = [];
  wheelTrail.clear();
  game.laps = settings.laps;
  hud.setLaps(game.laps);

  const playerColor = PLAYER_COLORS[settings.color] ?? PLAYER_COLORS[0];
  const rivals = RIVALS.filter((r) => r.color !== playerColor).slice(0, KART_COUNT - 1);
  const [s0, s1] = SKILL[settings.difficulty];
  let r = 0;
  for (let slot = 0; slot < KART_COUNT; slot++) {
    let kart;
    if (slot === PLAYER_SLOT) {
      kart = new Kart({ color: playerColor, accent: playerColor === 0xeeeeee ? 0x111111 : 0xffffff, name: 'YOU', number: 1, isPlayer: true, helmet: 0xffffff });
      game.player = kart;
    } else {
      const rv = rivals[r++];
      kart = new Kart({ ...rv, number: slot + 2 });
      // Faster rivals start ahead.
      const skill = lerp(s1, s0, slot / (KART_COUNT - 1)) + rand(-0.01, 0.01);
      game.ais.push(new AIDriver(kart, track, skill, slot + 1));
    }
    kart.placeAt(track, -12 - slot * 7, (slot % 2 ? 1 : -1) * 6);
    kart.lap = -1;
    kart.progress = kart.lap * track.length + kart.s;
    kart.maxLap = -1;
    scene.add(kart.group);
    game.karts.push(kart);
  }
  if (headlight) {
    game.player.group.add(headlight);
    headlight.position.set(0, 1.2, 1.5);
    game.player.group.add(headlight.target);
    headlight.target.position.set(0, 0, 25);
  }
  game.time = 0;
  game.countdown = 0;
  game.firstThrottle = -1;
  game.finishTimer = 0;
  game.playerAI = null;
  game.ranking = [...game.karts];
  for (const l of track.startLights || []) { l.color.setHex(0x220000); l.emissive.setHex(0x000000); }
  snapCamera();
}

function startCountdown() {
  game.state = 'countdown';
  game.countdown = 0;
  game.lastCount = null;
  hud.show(true);
  document.getElementById('touch').classList.toggle('hidden', !touch);
  document.getElementById('btn-gas').classList.toggle('hidden', settings.autoAccel === 'on');
  checkOrientation();
}

function snapCamera() {
  const p = game.player;
  camHeading = p.heading;
  camPos.set(p.x - Math.sin(camHeading) * 8, 3.2, p.z - Math.cos(camHeading) * 8);
  camLook.set(p.x, 1, p.z);
  camera.position.copy(camPos);
  camera.lookAt(camLook);
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------
function stepPhysics(dt) {
  for (const k of game.karts) k.physicsStep(dt, track);
  // Kart-to-kart collisions (equal mass, soft bounce).
  const ks = game.karts;
  const R2 = PHYS.radius * 2;
  for (let i = 0; i < ks.length; i++) {
    for (let j = i + 1; j < ks.length; j++) {
      const a = ks[i], b = ks[j];
      const dx = b.x - a.x, dz = b.z - a.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > R2 * R2 || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const nx = dx / d, nz = dz / d;
      const pen = (R2 - d) / 2;
      a.x -= nx * pen; a.z -= nz * pen;
      b.x += nx * pen; b.z += nz * pen;
      const rv = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
      if (rv < 0) {
        const jimp = -rv * 0.65;
        a.vx -= nx * jimp; a.vz -= nz * jimp;
        b.vx += nx * jimp; b.vz += nz * jimp;
        if (-rv > 4) {
          const ev = { type: 'bump', strength: -rv, x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
          a.events.push(ev);
          b.events.push(ev);
        }
      }
    }
  }
}

function updateRace(dt) {
  game.time += dt;
  // AI decisions once per frame.
  for (const ai of game.ais) ai.update(dt, game.karts, game.player, game.time);
  if (game.playerAI) game.playerAI.update(dt, game.karts, game.player, game.time);

  // Fixed-step physics for stable handling at any frame rate.
  game.acc = (game.acc || 0) + dt;
  let steps = 0;
  while (game.acc >= FIXED_DT && steps < 8) {
    stepPhysics(FIXED_DT);
    game.acc -= FIXED_DT;
    steps++;
  }
  if (steps === 8) game.acc = 0;

  // Laps & finishing
  for (const k of game.karts) {
    if (k.lap > k.maxLap) {
      k.maxLap = k.lap;
      if (k.lap >= 1) {
        const lt = game.time - k.lapStart;
        k.lapTimes.push(lt);
        const newBest = lt < k.bestLap;
        k.bestLap = Math.min(k.bestLap, lt);
        if (k.isPlayer && !k.finished) {
          if (k.lap === game.laps - 1) hud.message('FINAL LAP!', '#ffcc00');
          else if (k.lap < game.laps) hud.message(newBest && k.lap > 1 ? `LAP ${k.lap + 1} · BEST!` : `LAP ${k.lap + 1}`);
        }
      }
      k.lapStart = game.time;
      if (k.lap >= game.laps && !k.finished) {
        k.finished = true;
        k.finishTime = game.time;
        if (k.isPlayer) onPlayerFinish();
      }
    }
  }

  game.ranking = [...game.karts].sort((a, b) => {
    if (a.finished && b.finished) return a.finishTime - b.finishTime;
    if (a.finished) return -1;
    if (b.finished) return 1;
    return b.progress - a.progress;
  });
}

function onPlayerFinish() {
  const p = game.player;
  const rank = game.ranking.filter((k) => k.finished).length;
  game.state = 'finished';
  game.finishTimer = 0;
  hud.message(rank === 1 ? '🏆 VICTORY!' : `${ordinal(rank)} PLACE`, rank === 1 ? '#ffcc00' : '#ffffff');
  audio.blip(880, 0.4, 'triangle', 0.3);
  setTimeout(() => audio.blip(1320, 0.5, 'triangle', 0.3), 180);
  // Hand the wheel to the AI for the cool-down lap.
  game.playerAI = new AIDriver(p, track, 0.8, 99);
  document.getElementById('touch').classList.add('hidden');
}

function showResults() {
  const est = (k) => {
    if (k.finished) return k.finishTime;
    const remaining = game.laps * track.length - k.progress;
    return game.time + remaining / (PHYS.maxSpeed * 0.85);
  };
  const order = [...game.karts].sort((a, b) => est(a) - est(b));
  const rank = order.indexOf(game.player) + 1;
  document.getElementById('result-title').textContent = rank === 1 ? '🏆 VICTORY!' : rank <= 3 ? `PODIUM — ${ordinal(rank)}!` : `${ordinal(rank)} PLACE`;
  const rows = order.map((k, i) => {
    const t = est(k);
    const col = '#' + k.color.toString(16).padStart(6, '0');
    return `<tr class="${k.isPlayer ? 'me' : ''}"><td>${i + 1}</td><td><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${col};margin-right:8px"></span>${k.name}</td><td>${k.finished ? formatTime(t) : '~' + formatTime(t)}</td><td>${isFinite(k.bestLap) ? 'best ' + formatTime(k.bestLap) : ''}</td></tr>`;
  });
  document.getElementById('result-table').innerHTML = rows.join('');
  document.getElementById('results').classList.remove('hidden');
  hud.show(false);
  saveBest(rank);
}

function saveBest(rank) {
  try {
    const key = `turbokart.best.${settings.laps}`;
    const prev = parseFloat(localStorage.getItem(key) || 'Infinity');
    if (game.player.finishTime < prev) localStorage.setItem(key, String(game.player.finishTime));
    const wins = parseInt(localStorage.getItem('turbokart.wins') || '0', 10);
    if (rank === 1) localStorage.setItem('turbokart.wins', String(wins + 1));
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------
const LEVEL_COLORS = [[0.6, 0.85, 1], [0.2, 0.9, 1], [1, 0.55, 0.1]];

function updateEffects(dt) {
  const theme = THEMES[settings.time];
  const smokeShade = theme.name === 'night' ? 0.45 : 0.85;
  for (const k of game.karts) {
    k.group.updateMatrixWorld();
    const dCam = Math.hypot(k.x - camera.position.x, k.z - camera.position.z);
    const near = dCam < 140;
    const sp = Math.abs(k.speed);
    const slipping = k.drifting || Math.abs(k.slip) > 5 || (k.input.brake > 0 && sp > 18);

    // Rear wheel smoke + skid marks
    for (let w = 0; w < 2; w++) {
      const wp = k.worldPoint(k.model.rearWheels[w], tmpV);
      const key = k.name + w;
      const prev = wheelTrail.get(key);
      if (slipping && !k.offroad && k.hop < 0.05) {
        if (prev) skids.add(prev.x, prev.z, wp.x, wp.z, 0.45, k.drifting ? 0.55 : 0.35);
        wheelTrail.set(key, { x: wp.x, z: wp.z });
        if (near && Math.random() < 0.7) {
          smoke.spawn(wp.x, 0.3, wp.z, rand(-1, 1) - k.vx * 0.08, rand(0.6, 1.6), rand(-1, 1) - k.vz * 0.08, {
            life: rand(0.6, 1.2), size: rand(0.8, 1.4), grow: 2.8, r: smokeShade, g: smokeShade, b: smokeShade, alpha: 0.35, drag: 1.4,
          });
        }
      } else {
        wheelTrail.delete(key);
      }
      // Drift sparks coloured by turbo level
      if (k.drifting && near && k.driftTime > 0.3) {
        const [r, g, b] = LEVEL_COLORS[k.driftLevel];
        for (let n = 0; n < 2; n++) {
          sparks.spawn(wp.x, 0.15, wp.z, rand(-3, 3) - k.vx * 0.1, rand(1.5, 4), rand(-3, 3) - k.vz * 0.1, {
            life: rand(0.15, 0.35), size: rand(0.18, 0.32), grow: -0.3, r, g, b, alpha: 1, drag: 2, gravity: 14,
          });
        }
      }
      // Off-road dust
      if (k.offroad && sp > 6 && near && Math.random() < 0.5) {
        smoke.spawn(wp.x, 0.3, wp.z, rand(-1, 1), rand(0.5, 1.5), rand(-1, 1), {
          life: rand(0.6, 1.0), size: 1, grow: 3, r: 0.55, g: 0.45, b: 0.3, alpha: 0.4, drag: 1.2,
        });
      }
    }
    // Nitro / boost flames
    if (k.isBoosting && near) {
      for (const ex of k.model.exhausts) {
        const p = k.worldPoint(ex, tmpV);
        const fx = -Math.sin(k.heading), fz = -Math.cos(k.heading);
        for (let n = 0; n < 2; n++) {
          const blue = k.nitroActive;
          flames.spawn(p.x, p.y, p.z, fx * rand(6, 12) + k.vx * 0.85, rand(0, 0.6), fz * rand(6, 12) + k.vz * 0.85, {
            life: rand(0.08, 0.18), size: rand(0.5, 0.9), grow: -1.5,
            r: blue ? 0.35 : 1, g: blue ? 0.75 : 0.55, b: blue ? 1 : 0.15, alpha: 1, drag: 3,
          });
        }
      }
    }
    // Events
    for (const ev of k.events) handleEvent(k, ev);
    k.events.length = 0;
  }
  smoke.update(dt);
  sparks.update(dt);
  flames.update(dt);
}

function burstSparks(x, z, n, strength) {
  for (let i = 0; i < n; i++) {
    sparks.spawn(x, rand(0.3, 0.8), z, rand(-8, 8), rand(2, 7), rand(-8, 8), {
      life: rand(0.2, 0.5), size: rand(0.15, 0.3), grow: -0.2, r: 1, g: rand(0.6, 0.9), b: 0.3, alpha: 1, drag: 1.5, gravity: 16,
    });
  }
}

function handleEvent(k, ev) {
  const isP = k === game.player;
  switch (ev.type) {
    case 'wall':
      burstSparks(ev.x, ev.z, Math.min(30, Math.floor(ev.strength * 1.5)), ev.strength);
      if (isP) {
        game.shake = Math.min(1, game.shake + ev.strength * 0.05);
        audio.thud(ev.strength);
        if (touch && navigator.vibrate) navigator.vibrate(Math.min(60, ev.strength * 4));
      }
      break;
    case 'bump':
      burstSparks(ev.x, ev.z, 10, ev.strength);
      if (isP) {
        game.shake = Math.min(1, game.shake + ev.strength * 0.04);
        audio.thud(ev.strength * 0.8);
        if (touch && navigator.vibrate) navigator.vibrate(25);
      }
      break;
    case 'driftLevel':
      if (isP && ev.level > 0) audio.blip(ev.level === 2 ? 1100 : 760, 0.12, 'square', 0.12);
      break;
    case 'miniTurbo':
      if (isP) {
        audio.whoosh(0.3);
        hud.message(ev.level === 2 ? 'SUPER TURBO!' : 'TURBO!', ev.level === 2 ? '#ff9d00' : '#00e5ff');
      }
      break;
    case 'pad':
      if (isP) { audio.whoosh(0.4); hud.flash(0.15); }
      break;
    case 'driftEnd':
      if (isP && ev.time > 2.6) hud.message(`DRIFT ${ev.time.toFixed(1)}s`, '#ffcc00');
      break;
    case 'respawn':
      break;
  }
}

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------
const CAM_MODES = [
  { dist: 7.2, height: 2.8, look: 1.3 },
  { dist: 10.5, height: 4.2, look: 1.4 },
  { dist: -0.35, height: 1.55, look: 1.2, cockpit: true },
];

function updateCamera(dt) {
  const p = game.player;
  const sp = Math.abs(p.speed);
  if (game.state === 'finished') {
    // Cinematic orbit after the flag.
    game.orbit = (game.orbit || 0) + dt * 0.35;
    const a = p.heading + Math.PI * 0.75 + game.orbit;
    tmpV.set(p.x + Math.sin(a) * 9, 3.2, p.z + Math.cos(a) * 9);
    camera.position.lerp(tmpV, 1 - Math.exp(-3 * dt));
    camera.lookAt(p.x, 1, p.z);
    camera.fov = damp(camera.fov, 55, 3, dt);
    camera.updateProjectionMatrix();
    return;
  }
  const mode = CAM_MODES[game.camMode];
  const portrait = innerHeight > innerWidth;
  // Camera swings with the drift, giving that cinematic Asphalt slide.
  const target = p.heading + (p.drifting ? p.driftDir * 0.22 : 0) + clamp(p.slip * 0.015, -0.2, 0.2);
  let d = target - camHeading;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  camHeading += d * (1 - Math.exp(-(mode.cockpit ? 20 : 5.5) * dt));

  const boostPull = p.isBoosting ? 1.4 : 0;
  const dist = mode.cockpit ? mode.dist : mode.dist + sp * 0.03 + boostPull;
  const fx = Math.sin(camHeading), fz = Math.cos(camHeading);
  tmpV.set(p.x - fx * dist, mode.height + p.hop * 0.6, p.z - fz * dist);
  if (mode.cockpit) {
    camPos.copy(tmpV);
    tmpV2.set(p.x + Math.sin(p.heading) * 20, 1.1, p.z + Math.cos(p.heading) * 20);
    camLook.copy(tmpV2);
  } else {
    camPos.lerp(tmpV, 1 - Math.exp(-14 * dt));
    tmpV2.set(p.x + fx * 4, mode.look, p.z + fz * 4);
    camLook.lerp(tmpV2, 1 - Math.exp(-18 * dt));
  }
  camera.position.copy(camPos);
  // Shake
  game.shake = Math.max(0, game.shake - dt * 2.5);
  const speedRumble = sp > PHYS.maxSpeed * 0.9 ? 0.015 : 0;
  const sh = game.shake * 0.35 + speedRumble + (p.isBoosting ? 0.03 : 0) + (p.offroad && sp > 8 ? 0.05 : 0);
  if (sh > 0) camera.position.add(tmpV.set(rand(-sh, sh), rand(-sh, sh), rand(-sh, sh)));
  camera.lookAt(camLook);
  if (!mode.cockpit) camera.rotateZ(clamp(-p.yawRate * sp * 0.0012, -0.04, 0.04));

  const baseFov = portrait ? 82 : 66;
  const fovT = baseFov + clamp(sp / PHYS.maxSpeed, 0, 1.4) * 12 + (p.isBoosting ? 9 : 0);
  camera.fov = damp(camera.fov, fovT, 4, dt);
  camera.updateProjectionMatrix();
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
let last = performance.now();
let fpsAcc = 0, fpsFrames = 0;
let prevNitro = false;
let flagT = 0;

function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!scene) return;

  const p = game.player;
  const playing = game.state === 'countdown' || game.state === 'race';

  if (input.consume('pause') && (game.state === 'race' || game.state === 'countdown' || game.state === 'paused')) togglePause();
  if (input.consume('mute')) toggleMute();
  if (game.state === 'paused') { render(); return; }
  // Hold the race while the "rotate your phone" prompt is up.
  if (!rotateEl.classList.contains('hidden')) { last = now; render(); return; }
  if (input.consume('camera') && playing) game.camMode = (game.camMode + 1) % CAM_MODES.length;
  if (input.consume('reset') && game.state === 'race') p.respawn(track);

  if (p && game.state !== 'menu') {
    const inp = input.update(dt, p.nitro);
    if (!game.playerAI) Object.assign(p.input, inp);
  }

  if (game.state === 'countdown') {
    game.countdown += dt;
    const c = game.countdown;
    const n = c < 1 ? 0 : c < 2 ? 3 : c < 3 ? 2 : c < 4 ? 1 : -1;
    if (n !== game.lastCount) {
      game.lastCount = n;
      if (n > 0) {
        hud.countdown(String(n));
        audio.blip(440, 0.18, 'square', 0.2);
        const lights = track.startLights || [];
        const lit = { 3: 1, 2: 3, 1: 5 }[n];
        lights.forEach((l, i) => { if (i < lit) { l.color.setHex(0xff0000); l.emissive.setHex(0xff0000); } });
      } else if (n === -1) {
        hud.countdown('GO!');
        audio.blip(880, 0.45, 'square', 0.25);
        for (const l of track.startLights || []) { l.color.setHex(0x00ff40); l.emissive.setHex(0x00ff40); }
        game.state = 'race';
        game.time = 0;
        // Perfect start: throttle pressed in the last moment before GO.
        if (game.firstThrottle > 3.35) {
          p.boost(1.3, 1);
          hud.message('PERFECT START!', '#00e5ff');
          audio.whoosh(0.4);
        }
        setTimeout(() => hud.countdown(''), 700);
      }
    }
    if (p.input.throttle > 0 && game.firstThrottle < 0) game.firstThrottle = c;
    if (p.input.throttle <= 0) game.firstThrottle = -1;
    // Keep karts locked in place; let wheels idle.
    for (const k of game.karts) k.syncModel(dt);
  } else if (game.state === 'race' || game.state === 'finished') {
    updateRace(dt);
    for (const k of game.karts) k.syncModel(dt);
    if (game.state === 'finished') {
      game.finishTimer += dt;
      if (game.finishTimer > 4 && document.getElementById('results').classList.contains('hidden')) {
        showResults();
      }
    }
  }

  if (game.state !== 'menu' && p) {
    if (p.nitroActive && !prevNitro) { audio.whoosh(0.45); hud.flash(0.12); }
    prevNitro = p.nitroActive;
    updateEffects(dt);
    updateCamera(dt);
    // Keep the shadow frustum centred on the player.
    const theme = THEMES[settings.time];
    sun.position.set(p.x + theme.sunDir.x * 150, theme.sunDir.y * 150 + 20, p.z + theme.sunDir.z * 150);
    sun.target.position.set(p.x, 0, p.z);
    hud.update(dt, game);
    audio.update(p, game.state === 'race');
    const sp = Math.abs(p.speed) / PHYS.maxSpeed;
    speedLines.draw(p.isBoosting ? 1 : clamp((sp - 0.85) * 3, 0, 0.6), dt);
  } else {
    // Menu: slow cinematic fly-around.
    flagT += dt;
    const s = track.sample(flagT * 18, 0);
    const a = flagT * 0.15;
    camera.position.set(s.x + Math.sin(a) * 30, 9 + Math.sin(flagT * 0.3) * 3, s.z + Math.cos(a) * 30);
    camera.lookAt(s.x, 1, s.z);
    camera.fov = 60;
    camera.updateProjectionMatrix();
    speedLines.draw(0, dt);
  }

  track.update(dt);
  const fl = sceneryGroup && sceneryGroup.children.find((c) => c.userData.update);
  if (fl) fl.userData.update(now / 1000);

  render();
  adaptResolution(dt);
}

function render() {
  if (composer) composer.render();
  else renderer.render(scene, camera);
}

// Dynamic resolution keeps phones smooth.
function adaptResolution(dt) {
  fpsAcc += dt;
  fpsFrames++;
  if (fpsAcc < 2) return;
  const fps = fpsFrames / fpsAcc;
  fpsAcc = 0;
  fpsFrames = 0;
  if (document.hidden) return;
  let changed = false;
  if (fps < 45 && resScale > 0.55) { resScale = Math.max(0.55, resScale - 0.1); changed = true; }
  else if (fps > 58 && resScale < 1) { resScale = Math.min(1, resScale + 0.05); changed = true; }
  if (changed) resize();
}

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);

function initMenu() {
  const sw = $('colors');
  PLAYER_COLORS.forEach((c, i) => {
    const b = document.createElement('button');
    b.style.background = '#' + c.toString(16).padStart(6, '0');
    b.className = i === settings.color ? 'on' : '';
    b.onclick = () => {
      settings.color = i;
      sw.querySelectorAll('button').forEach((x, j) => x.classList.toggle('on', j === i));
      saveSettings();
    };
    sw.appendChild(b);
  });
  document.querySelectorAll('.seg').forEach((seg) => {
    const key = seg.dataset.key;
    const cur = String(settings[key]);
    seg.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('on', b.dataset.v === cur);
      b.onclick = async () => {
        seg.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        settings[key] = key === 'laps' ? parseInt(b.dataset.v, 10) : b.dataset.v;
        saveSettings();
        if (key === 'steer' && b.dataset.v === 'tilt') {
          const ok = await input.enableTilt();
          if (!ok) hud.message('Tilt not available');
        }
        if (key === 'time' || key === 'quality') {
          buildWorld();
          resize();
        }
      };
    });
  });
  $('btn-start').onclick = startFromMenu;
  $('btn-resume').onclick = togglePause;
  $('btn-restart').onclick = () => { $('pause').classList.add('hidden'); restart(); };
  $('btn-quit').onclick = () => { $('pause').classList.add('hidden'); toMenu(); };
  $('btn-again').onclick = () => { $('results').classList.add('hidden'); restart(); };
  $('btn-menu').onclick = () => { $('results').classList.add('hidden'); toMenu(); };
  $('btn-mute').onclick = toggleMute;
  $('btn-calibrate').onclick = () => { input.calibrateTilt(); hud.message('TILT CENTERED'); };
  $('btn-portrait').onclick = () => { portraitDismissed = true; checkOrientation(); };
  updateMuteLabel();
}

async function startFromMenu() {
  audio.init();
  audio.setVolume(settings.muted ? 0 : 0.55);
  input.settings.autoAccel = settings.autoAccel === 'on';
  input.settings.steerMode = settings.steer;
  if (touch) {
    // Go full-screen landscape on phones for an app-like feel.
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape').catch(() => {});
    } catch { /* not supported (e.g. iOS Safari) */ }
    if (settings.steer === 'tilt') {
      await input.enableTilt();
      setTimeout(() => input.calibrateTilt(), 300);
    }
  }
  $('menu').classList.add('hidden');
  setupRace();
  resize();
  startCountdown();
}

function restart() {
  setupRace();
  startCountdown();
}

function toMenu() {
  game.state = 'menu';
  hud.show(false);
  $('touch').classList.add('hidden');
  $('menu').classList.remove('hidden');
  audio.silence();
}

function togglePause() {
  if (game.state === 'paused') {
    game.state = game.prevState;
    $('pause').classList.add('hidden');
    last = performance.now();
  } else {
    game.prevState = game.state;
    game.state = 'paused';
    $('pause').classList.remove('hidden');
    audio.silence();
  }
}

function toggleMute() {
  settings.muted = !settings.muted;
  audio.setVolume(settings.muted ? 0 : 0.55);
  saveSettings();
  updateMuteLabel();
}
function updateMuteLabel() { $('btn-mute').textContent = `SOUND: ${settings.muted ? 'OFF' : 'ON'}`; }

let portraitDismissed = false;
const rotateEl = document.getElementById('rotate');
function checkOrientation() {
  const show = touch && innerHeight > innerWidth && !portraitDismissed && game.state !== 'menu';
  $('rotate').classList.toggle('hidden', !show);
}

// Auto-pause when the app is backgrounded (phone call, app switch).
document.addEventListener('visibilitychange', () => {
  if (document.hidden && (game.state === 'race' || game.state === 'countdown')) togglePause();
});

// PWA: offline support + install prompt.
let deferredInstall = null;
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
  $('install-hint').classList.remove('hidden');
});
$('btn-install').onclick = async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  await deferredInstall.userChoice;
  deferredInstall = null;
  $('install-hint').classList.add('hidden');
};
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
initMenu();
buildWorld();
resize();
$('loading').classList.add('hidden');
requestAnimationFrame(frame);

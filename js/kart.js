import * as THREE from 'three';
import { clamp, damp, lerp, sign } from './utils.js';

// Tunables — arcade feel inspired by mobile racers: fast, grippy, rewarding drifts.
export const PHYS = {
  maxSpeed: 46,          // m/s (~165 km/h shown)
  nitroSpeed: 64,        // m/s while boosting (~230 km/h)
  accel: 22,
  nitroAccel: 34,
  brake: 55,
  reverseMax: 12,
  reverseAccel: 18,
  coast: 6,
  drag: 0.12,
  steerRate: 2.35,       // rad/s at full lock
  grip: 11,
  driftGrip: 2.4,
  offroadGrip: 6,
  offroadMax: 21,
  radius: 1.55,
  nitroDrain: 0.3,       // per second
  driftNitroGain: 0.2,
};

const _v = new THREE.Vector3();

export class Kart {
  constructor({ color = 0xff2a2a, accent = 0xffffff, name = 'Racer', number = 1, isPlayer = false, helmet = 0xffffff } = {}) {
    this.name = name;
    this.color = color;
    this.isPlayer = isPlayer;
    this.group = buildKartModel(color, accent, number, helmet);
    this.model = this.group.userData;

    // Physics state
    this.x = 0;
    this.z = 0;
    this.heading = 0;
    this.vx = 0;
    this.vz = 0;
    this.speed = 0;      // forward speed (signed)
    this.slip = 0;       // lateral speed
    this.yawRate = 0;
    this.steerVis = 0;

    this.drifting = false;
    this.driftDir = 0;
    this.driftTime = 0;
    this.driftLevel = 0;
    this.nitro = 0.35;
    this.nitroActive = false;
    this.boostTime = 0;
    this.boostPower = 0;
    this.hop = 0;
    this.hopV = 0;
    this.offroad = false;
    this.maxSpeedMul = 1;
    this.padCooldown = new Map();

    // Track state
    this.idx = -1;
    this.s = 0;
    this.lat = 0;
    this.lap = -1;
    this.progress = 0;
    this.finished = false;
    this.finishTime = 0;
    this.lapStart = 0;
    this.lapTimes = [];
    this.bestLap = Infinity;
    this.wrongWay = false;

    this.events = []; // collisions, boosts etc. consumed by the game each frame
    this.input = { throttle: 0, brake: 0, steer: 0, drift: false, nitro: false };
    this._loc = {};
  }

  placeAt(track, s, lat) {
    const p = track.sample(s, lat);
    this.x = p.x;
    this.z = p.z;
    this.heading = p.heading;
    this.vx = this.vz = this.speed = this.slip = 0;
    this.drifting = false;
    this.boostTime = 0;
    this.nitroActive = false;
    track.locate(this.x, this.z, -1, this._loc);
    this.idx = this._loc.idx;
    this.s = this._loc.s;
    this.lat = this._loc.lat;
    this.syncModel(0);
  }

  respawn(track) {
    const s = this.s;
    const p = track.sample(s, clamp(this.lat, -4, 4));
    this.x = p.x;
    this.z = p.z;
    this.heading = p.heading;
    this.vx = this.vz = this.speed = this.slip = 0;
    this.drifting = false;
    this.events.push({ type: 'respawn' });
  }

  get forwardX() { return Math.sin(this.heading); }
  get forwardZ() { return Math.cos(this.heading); }

  physicsStep(dt, track) {
    const inp = this.input;
    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    // Screen-right vector (see Track: n = right).
    const rx = -fz, rz = fx;
    let vf = this.vx * fx + this.vz * fz;
    let vr = this.vx * rx + this.vz * rz;

    // --- Surface ---
    const absLat = Math.abs(this.lat);
    this.offroad = absLat > track.halfWidth + track.curbWidth + 0.3;
    this.onCurb = !this.offroad && absLat > track.halfWidth;

    // --- Boosts ---
    if (this.boostTime > 0) this.boostTime -= dt;
    this.nitroActive = inp.nitro && this.nitro > 0.01 && vf > 2;
    if (this.nitroActive) this.nitro = Math.max(0, this.nitro - PHYS.nitroDrain * dt);
    const boosting = this.nitroActive || this.boostTime > 0;

    let maxSpeed = PHYS.maxSpeed * this.maxSpeedMul;
    if (boosting) maxSpeed = PHYS.nitroSpeed * (this.boostTime > 0 && !this.nitroActive ? lerp(0.86, 1, this.boostPower) : 1) * Math.max(1, this.maxSpeedMul);
    if (this.offroad) maxSpeed = Math.min(maxSpeed, boosting ? PHYS.offroadMax * 1.5 : PHYS.offroadMax);

    // --- Engine & brakes ---
    if (inp.throttle > 0 && vf < -1) {
      vf += PHYS.brake * 0.8 * inp.throttle * dt; // rolling backwards: gas acts as a brake first
    } else if (inp.throttle > 0) {
      const a = boosting ? PHYS.nitroAccel : PHYS.accel;
      const t = clamp(vf / maxSpeed, 0, 1);
      vf += a * inp.throttle * (1 - t * t * 0.85) * dt;
    } else if (boosting) {
      vf += PHYS.nitroAccel * 0.6 * dt;
    }
    if (inp.brake > 0) {
      if (vf > 0.5) vf -= PHYS.brake * inp.brake * dt;
      else if (inp.throttle <= 0) vf = Math.max(-PHYS.reverseMax, vf - PHYS.reverseAccel * inp.brake * dt);
    }
    if (inp.throttle <= 0 && inp.brake <= 0 && !boosting) {
      const c = PHYS.coast * dt;
      vf = Math.abs(vf) < c ? 0 : vf - Math.sign(vf) * c;
    }
    vf -= vf * PHYS.drag * dt * (this.offroad ? 6 : 1);
    if (vf > maxSpeed) vf = lerp(vf, maxSpeed, 1 - Math.exp(-2.2 * dt));

    // --- Drift state machine ---
    if (!this.drifting && inp.drift && Math.abs(inp.steer) > 0.25 && vf > 13 && this.hop <= 0.001) {
      this.drifting = true;
      this.driftDir = sign(inp.steer);
      this.driftTime = 0;
      this.driftLevel = 0;
      this.hopV = 4.2; // little hop like a real arcade kart
      this.events.push({ type: 'driftStart' });
    }
    if (this.drifting) {
      this.driftTime += dt;
      const lvl = this.driftTime > 2.2 ? 2 : this.driftTime > 1.0 ? 1 : 0;
      if (lvl !== this.driftLevel) {
        this.driftLevel = lvl;
        this.events.push({ type: 'driftLevel', level: lvl });
      }
      this.nitro = Math.min(1, this.nitro + PHYS.driftNitroGain * dt);
      vf -= vf * 0.06 * dt;
      if (!inp.drift || vf < 9 || this.offroad) {
        this.drifting = false;
        if (this.driftLevel > 0 && !this.offroad) {
          this.boost(this.driftLevel === 2 ? 1.25 : 0.65, this.driftLevel === 2 ? 1 : 0.6);
          this.events.push({ type: 'miniTurbo', level: this.driftLevel });
        }
        this.events.push({ type: 'driftEnd', time: this.driftTime });
        this.driftLevel = 0;
      }
    }

    // Passive nitro trickle at speed, like Asphalt's driving reward.
    if (vf > PHYS.maxSpeed * 0.7 && !boosting) this.nitro = Math.min(1, this.nitro + 0.018 * dt);

    // --- Steering ---
    const absV = Math.abs(vf);
    // Less steering lock at high speed: hairpins need a brake tap or a drift.
    const speedFactor = clamp(absV / 7, 0, 1) * (1 - 0.55 * clamp(absV / PHYS.nitroSpeed, 0, 1));
    let targetYaw;
    if (this.drifting) {
      const s = clamp(inp.steer * this.driftDir, -1, 1); // -1 = open up, +1 = tighten
      targetYaw = -this.driftDir * PHYS.steerRate * (0.78 + 0.5 * s) * Math.max(speedFactor, 0.7);
    } else {
      targetYaw = -inp.steer * PHYS.steerRate * speedFactor * (vf < -0.5 ? -1 : 1);
    }
    this.yawRate = damp(this.yawRate, targetYaw, this.drifting ? 8 : 14, dt);
    this.heading += this.yawRate * dt;

    // --- Lateral grip ---
    const grip = this.drifting ? PHYS.driftGrip : this.offroad ? PHYS.offroadGrip : PHYS.grip;
    const vrNew = vr * Math.exp(-grip * dt);
    // Arcade momentum: most of the scrubbed sideways speed is fed back into forward
    // speed, so drifts keep you fast instead of bleeding off pace.
    if (vf > 0) vf += Math.abs(vr - vrNew) * (this.drifting ? 0.92 : 0.6);
    vr = vrNew;

    // Recompose world velocity using the OLD frame so slip emerges when heading rotates.
    this.vx = fx * vf + rx * vr;
    this.vz = fz * vf + rz * vr;
    this.x += this.vx * dt;
    this.z += this.vz * dt;

    // --- Hop ---
    if (this.hop > 0 || this.hopV > 0) {
      this.hopV -= 30 * dt;
      this.hop += this.hopV * dt;
      if (this.hop <= 0) { this.hop = 0; this.hopV = 0; }
    }

    // --- Track relation & walls ---
    track.locate(this.x, this.z, this.idx, this._loc);
    const prevS = this.s;
    this.idx = this._loc.idx;
    this.s = this._loc.s;
    this.lat = this._loc.lat;
    const L = track.length;
    if (prevS > L * 0.75 && this.s < L * 0.25) this.lap++;
    else if (prevS < L * 0.25 && this.s > L * 0.75) this.lap--;
    this.progress = this.lap * L + this.s;

    const limit = track.wallDist - PHYS.radius * 0.8;
    if (Math.abs(this.lat) > limit) {
      const sd = sign(this.lat);
      const nx = track.nx[this.idx] * sd;
      const nz = track.nz[this.idx] * sd;
      const push = Math.abs(this.lat) - limit;
      this.x -= nx * push;
      this.z -= nz * push;
      this.lat = sd * limit;
      const vn = this.vx * nx + this.vz * nz;
      if (vn > 0) {
        this.vx -= nx * vn * 1.25;
        this.vz -= nz * vn * 1.25;
        const keep = 1 - clamp(vn / 80, 0.02, 0.35);
        this.vx *= keep;
        this.vz *= keep;
        // Forgiving wall-ride: steer the kart parallel to the barrier.
        const vAlong = Math.hypot(this.vx, this.vz);
        if (vAlong > 5) {
          let d = Math.atan2(this.vx, this.vz) - this.heading;
          while (d > Math.PI) d -= Math.PI * 2;
          while (d < -Math.PI) d += Math.PI * 2;
          if (Math.abs(d) < 1.6) this.heading += d * 0.35;
        }
        if (vn > 3) this.events.push({ type: 'wall', strength: vn, x: this.x + nx * PHYS.radius, z: this.z + nz * PHYS.radius });
        if (this.drifting && vn > 6) {
          this.drifting = false;
          this.driftLevel = 0;
        }
      }
      // Pinned nose-first against the wall: swing round to face down the track.
      if (Math.hypot(this.vx, this.vz) < 6 && inp.throttle > 0) {
        let d = Math.atan2(track.tx[this.idx], track.tz[this.idx]) - this.heading;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        if (Math.abs(d) < 2.2) this.heading += Math.sign(d) * Math.min(Math.abs(d), 1.8 * dt);
      }
    }

    // Boost pads
    for (let i = 0; i < track.boostPads.length; i++) {
      const pad = track.boostPads[i];
      let ds = this.s - pad.s;
      if (ds > L / 2) ds -= L;
      if (ds < -L / 2) ds += L;
      const cd = this.padCooldown.get(i) || 0;
      if (cd > 0) { this.padCooldown.set(i, cd - dt); continue; }
      if (Math.abs(ds) < pad.len / 2 && Math.abs(this.lat - pad.lat) < pad.halfW + 0.6) {
        this.boost(1.1, 1);
        this.nitro = Math.min(1, this.nitro + 0.12);
        this.padCooldown.set(i, 1.5);
        this.events.push({ type: 'pad' });
      }
    }

    // Wrong way detection
    const tdot = fx * track.tx[this.idx] + fz * track.tz[this.idx];
    this.wrongWay = tdot < -0.35 && Math.abs(vf) > 3;

    const nfx = Math.sin(this.heading), nfz = Math.cos(this.heading);
    this.speed = this.vx * nfx + this.vz * nfz;
    this.slip = this.vx * -nfz + this.vz * nfx;
  }

  boost(time, power) {
    if (this.boostTime < time) this.boostTime = time;
    this.boostPower = Math.max(power, this.boostTime > 0 ? this.boostPower : 0);
  }

  get isBoosting() { return this.nitroActive || this.boostTime > 0; }

  syncModel(dt) {
    const m = this.model;
    this.group.position.set(this.x, this.hop, this.z);
    this.group.rotation.y = this.heading;

    // Visual steer, body roll & pitch
    const steerTarget = this.drifting ? this.input.steer * 0.25 - this.driftDir * 0.35 : this.input.steer * 0.5;
    this.steerVis = dt ? damp(this.steerVis, steerTarget, 12, dt) : 0;
    m.wheelFL.rotation.y = m.wheelFR.rotation.y = -this.steerVis;
    const spin = (this.speed * (dt || 0)) / 0.32;
    for (const w of m.spinners) w.rotation.x += spin;

    const roll = clamp(this.yawRate * this.speed * 0.006, -0.12, 0.12) + (this.drifting ? this.driftDir * 0.05 : 0);
    m.body.rotation.z = dt ? damp(m.body.rotation.z, roll, 8, dt) : 0;
    const pitchT = clamp((this.input.throttle - this.input.brake) * -0.025 - (this.isBoosting ? 0.03 : 0), -0.06, 0.06);
    m.body.rotation.x = dt ? damp(m.body.rotation.x, pitchT, 6, dt) : 0;
    // Driver leans into turns
    m.driver.rotation.z = dt ? damp(m.driver.rotation.z, -this.steerVis * 0.5, 6, dt) : 0;
    m.steeringWheel.rotation.z = this.steerVis * 2.2;

    // Rear "drift visual": kart yaws out a bit more than physics heading.
    const driftYaw = this.drifting ? this.driftDir * 0.28 : clamp(-this.slip * 0.02, -0.2, 0.2);
    m.body.rotation.y = dt ? damp(m.body.rotation.y, -driftYaw, 6, dt) : 0;

    // Brake lights glow
    const braking = this.input.brake > 0 && this.speed > 1;
    m.brakeMat.emissiveIntensity = braking ? 4 : 0.6;
  }

  // World position of exhaust pipes / rear wheels for effects.
  worldPoint(local, out = _v) {
    out.copy(local);
    return this.model.body.localToWorld(out);
  }
}

// ---------------------------------------------------------------------------
// Model — built from primitives so the game needs no external assets.
// ---------------------------------------------------------------------------
function buildKartModel(color, accent, number, helmetColor) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const paint = new THREE.MeshPhysicalMaterial({
    color, metalness: 0.45, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.08,
  });
  const accentMat = new THREE.MeshPhysicalMaterial({ color: accent, metalness: 0.3, roughness: 0.35, clearcoat: 0.6 });
  const carbon = new THREE.MeshStandardMaterial({ color: 0x15171c, metalness: 0.5, roughness: 0.45 });
  const chrome = new THREE.MeshStandardMaterial({ color: 0xe6e9ee, metalness: 1, roughness: 0.15 });
  const tire = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.85 });

  const add = (geo, mat, x, y, z, parent = body) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  // Chassis tray
  add(new THREE.BoxGeometry(1.5, 0.12, 2.6), carbon, 0, 0.28, 0);
  // Nose cone (tapered)
  const nose = new THREE.CylinderGeometry(0.42, 0.75, 1.1, 4, 1);
  nose.rotateY(Math.PI / 4);
  nose.rotateX(Math.PI / 2);
  nose.scale(1.25, 0.45, 1);
  add(nose, paint, 0, 0.45, 1.25);
  // Front bumper wing
  add(new THREE.BoxGeometry(1.9, 0.12, 0.35), paint, 0, 0.32, 1.95);
  add(new THREE.BoxGeometry(0.12, 0.3, 0.45), accentMat, -0.95, 0.38, 1.95);
  add(new THREE.BoxGeometry(0.12, 0.3, 0.45), accentMat, 0.95, 0.38, 1.95);
  // Side pods
  for (const s of [-1, 1]) {
    const pod = new THREE.BoxGeometry(0.42, 0.34, 1.35);
    const p = add(pod, paint, s * 0.88, 0.42, -0.05);
    p.rotation.y = s * 0.04;
    add(new THREE.BoxGeometry(0.44, 0.06, 1.37), accentMat, s * 0.88, 0.6, -0.05);
  }
  // Seat
  add(new THREE.BoxGeometry(0.7, 0.55, 0.15), carbon, 0, 0.62, -0.62).rotation.x = -0.25;
  add(new THREE.BoxGeometry(0.7, 0.12, 0.6), carbon, 0, 0.38, -0.35);
  // Engine block + exhaust
  add(new THREE.BoxGeometry(0.55, 0.45, 0.55), chrome, 0.32, 0.55, -1.05);
  add(new THREE.BoxGeometry(0.5, 0.2, 0.4), carbon, 0.32, 0.86, -1.05);
  const exhaustGeo = new THREE.CylinderGeometry(0.08, 0.1, 0.55, 10);
  exhaustGeo.rotateX(Math.PI / 2);
  add(exhaustGeo, chrome, -0.25, 0.55, -1.42);
  add(exhaustGeo, chrome, -0.45, 0.55, -1.42);
  // Rear spoiler
  add(new THREE.BoxGeometry(1.7, 0.06, 0.45), paint, 0, 1.12, -1.4).rotation.x = 0.12;
  add(new THREE.BoxGeometry(0.06, 0.45, 0.4), carbon, -0.7, 0.9, -1.38);
  add(new THREE.BoxGeometry(0.06, 0.45, 0.4), carbon, 0.7, 0.9, -1.38);
  add(new THREE.BoxGeometry(0.08, 0.5, 0.5), accentMat, -0.86, 1.05, -1.4);
  add(new THREE.BoxGeometry(0.08, 0.5, 0.5), accentMat, 0.86, 1.05, -1.4);
  // Rear bumper + brake lights
  add(new THREE.BoxGeometry(1.7, 0.16, 0.18), carbon, 0, 0.3, -1.6);
  const brakeMat = new THREE.MeshStandardMaterial({ color: 0x550000, emissive: 0xff1010, emissiveIntensity: 0.6 });
  add(new THREE.BoxGeometry(0.3, 0.08, 0.04), brakeMat, -0.55, 0.36, -1.7);
  add(new THREE.BoxGeometry(0.3, 0.08, 0.04), brakeMat, 0.55, 0.36, -1.7);
  // Headlights
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6d8, emissiveIntensity: 1.5 });
  add(new THREE.BoxGeometry(0.22, 0.08, 0.04), headMat, -0.3, 0.5, 1.82);
  add(new THREE.BoxGeometry(0.22, 0.08, 0.04), headMat, 0.3, 0.5, 1.82);

  // Number plate on nose
  const plateTex = new THREE.CanvasTexture(makeNumberCanvas(number));
  plateTex.colorSpace = THREE.SRGBColorSpace;
  const plate = add(new THREE.PlaneGeometry(0.5, 0.36), new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.5 }), 0, 0.72, 1.0);
  plate.rotation.x = -Math.PI / 2 + 0.55;

  // Steering column & wheel
  add(new THREE.CylinderGeometry(0.03, 0.03, 0.7), carbon, 0, 0.62, 0.42).rotation.x = 1.0;
  const steeringWheel = new THREE.Group();
  steeringWheel.position.set(0, 0.86, 0.22);
  steeringWheel.rotation.x = -0.55;
  body.add(steeringWheel);
  const swGeo = new THREE.TorusGeometry(0.17, 0.035, 6, 16);
  const sw = new THREE.Mesh(swGeo, carbon);
  steeringWheel.add(sw);
  const swCenter = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.03), carbon);
  steeringWheel.add(swCenter);

  // Driver
  const driver = new THREE.Group();
  driver.position.set(0, 0.45, -0.38);
  body.add(driver);
  const suitMat = new THREE.MeshStandardMaterial({ color: accent === 0xffffff ? 0x22252b : accent, roughness: 0.7 });
  const suitPaint = new THREE.MeshStandardMaterial({ color, roughness: 0.6 });
  const torso = add(new THREE.CylinderGeometry(0.24, 0.3, 0.75, 10), suitPaint, 0, 0.45, 0, driver);
  torso.rotation.x = -0.25;
  // Legs going forward
  for (const s of [-1, 1]) {
    const leg = add(new THREE.CylinderGeometry(0.09, 0.1, 0.9, 6), suitMat, s * 0.14, 0.12, 0.55, driver);
    leg.rotation.x = Math.PI / 2 - 0.1;
    // Arms to the wheel
    const arm = add(new THREE.CylinderGeometry(0.065, 0.07, 0.6, 6), suitPaint, s * 0.24, 0.55, 0.32, driver);
    arm.rotation.x = 1.05;
    arm.rotation.z = -s * 0.25;
  }
  const helmetMat = new THREE.MeshPhysicalMaterial({ color: helmetColor, metalness: 0.3, roughness: 0.2, clearcoat: 1 });
  const helmet = add(new THREE.SphereGeometry(0.27, 18, 14), helmetMat, 0, 1.0, 0.05, driver);
  helmet.scale.set(1, 1.05, 1.1);
  const stripe = add(new THREE.TorusGeometry(0.255, 0.035, 6, 20, Math.PI), paint, 0, 1.0, 0.05, driver);
  stripe.rotation.y = Math.PI / 2;
  const visor = add(new THREE.SphereGeometry(0.24, 16, 10, -0.9, 1.8, 1.1, 0.7),
    new THREE.MeshPhysicalMaterial({ color: 0x0a0a12, metalness: 0.9, roughness: 0.05, clearcoat: 1 }), 0, 1.0, 0.1, driver);
  visor.scale.set(1.05, 1.05, 1.1);

  // Wheels
  const wheelGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.34, 20);
  wheelGeo.rotateZ(Math.PI / 2);
  const rearGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.46, 20);
  rearGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.19, 0.19, 0.36, 8);
  rimGeo.rotateZ(Math.PI / 2);
  const rimMat = new THREE.MeshStandardMaterial({ color: accent, metalness: 0.9, roughness: 0.25 });
  const spinners = [];
  const makeWheel = (geo, x, y, z) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    root.add(pivot);
    const spin = new THREE.Group();
    pivot.add(spin);
    const t = new THREE.Mesh(geo, tire);
    t.castShadow = true;
    spin.add(t);
    const r = new THREE.Mesh(rimGeo, rimMat);
    r.scale.x = geo === rearGeo ? 1.3 : 1;
    spin.add(r);
    // Spoke bar so rotation is visible
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.06, 0.3), chrome);
    spoke.scale.x = geo === rearGeo ? 1.3 : 1;
    spin.add(spoke);
    spinners.push(spin);
    return pivot;
  };
  const wheelFL = makeWheel(wheelGeo, -0.88, 0.32, 1.25);
  const wheelFR = makeWheel(wheelGeo, 0.88, 0.32, 1.25);
  makeWheel(rearGeo, -0.92, 0.34, -1.05);
  makeWheel(rearGeo, 0.92, 0.34, -1.05);
  // Rear axle
  const axle = new THREE.CylinderGeometry(0.05, 0.05, 1.9);
  axle.rotateZ(Math.PI / 2);
  add(axle, chrome, 0, 0.34, -1.05);

  root.userData = {
    body, driver, wheelFL, wheelFR, spinners, steeringWheel, brakeMat,
    exhausts: [new THREE.Vector3(-0.25, 0.55, -1.75), new THREE.Vector3(-0.45, 0.55, -1.75)],
    rearWheels: [new THREE.Vector3(-0.92, 0.05, -1.05), new THREE.Vector3(0.92, 0.05, -1.05)],
    frontWheels: [new THREE.Vector3(-0.88, 0.05, 1.25), new THREE.Vector3(0.88, 0.05, 1.25)],
  };
  root.scale.setScalar(1.15);
  return root;
}

function makeNumberCanvas(n) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 96);
  g.strokeStyle = '#111';
  g.lineWidth = 6;
  g.strokeRect(3, 3, 122, 90);
  g.fillStyle = '#111';
  g.font = 'italic 900 70px Arial Black, Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(n), 64, 52);
  return c;
}

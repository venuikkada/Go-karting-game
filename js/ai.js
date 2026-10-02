import { clamp, wrapAngle } from './utils.js';
import { PHYS } from './kart.js';

// Rival driver: follows a racing line with look-ahead, brakes for corners,
// fires nitro on straights and avoids other karts.
export class AIDriver {
  constructor(kart, track, skill, seed) {
    this.kart = kart;
    this.track = track;
    this.skill = skill;
    this.seed = seed;
    this.laneBase = ((seed * 7919) % 9) - 4; // preferred lane -4..4
    this.lane = this.laneBase;
    this.nitroCooldown = 3 + (seed % 3);
    this.stuckTime = 0;
    this._p = {};
  }

  update(dt, karts, player, time) {
    const k = this.kart;
    const tr = this.track;
    const inp = k.input;
    const v = Math.max(0, k.speed);

    // Rubber-banding keeps the pack close for exciting races.
    const gap = player.progress - k.progress;
    const band = clamp(1 + gap * 0.0011, 0.88, 1.12);
    k.maxSpeedMul = this.skill * band;

    // Racing line: drift to the inside ahead of corners.
    const turn = tr.turnAhead(k.s + 10, 45);
    let targetLane = this.laneBase * 0.5 + clamp(-turn * 5, -6, 6) + Math.sin(time * 0.25 + this.seed) * 1.5;

    // Avoid karts directly ahead.
    for (const o of karts) {
      if (o === k) continue;
      let ds = o.s - k.s;
      if (ds < -tr.length / 2) ds += tr.length;
      if (ds > tr.length / 2) ds -= tr.length;
      if (ds > 0 && ds < 14 && Math.abs(o.lat - this.lane) < 3.2) {
        targetLane = o.lat + (o.lat > 0 ? -4.5 : 4.5);
      }
    }
    targetLane = clamp(targetLane, -tr.halfWidth + 2.5, tr.halfWidth - 2.5);
    this.lane += clamp(targetLane - this.lane, -6 * dt, 6 * dt);

    const look = 9 + v * 0.45;
    const p = tr.sample(k.s + look, this.lane, this._p);
    const desired = Math.atan2(p.x - k.x, p.z - k.z);
    const diff = wrapAngle(desired - k.heading);
    inp.steer = clamp(-diff * 2.6, -1, 1);

    // Corner speed management.
    const turnFar = Math.abs(tr.turnAhead(k.s + v * 0.4, 30 + v * 0.9));
    const cornerMul = 1 - clamp((turnFar - 0.25) * 0.42, 0, 0.42);
    const targetSpeed = PHYS.maxSpeed * k.maxSpeedMul * cornerMul;
    inp.throttle = v < targetSpeed ? 1 : 0;
    inp.brake = v > targetSpeed + 6 ? 1 : 0;
    inp.drift = false;

    // Nitro on straights.
    this.nitroCooldown -= dt;
    if (k.nitroActive) {
      inp.nitro = turnFar < 0.35 && k.nitro > 0.02;
    } else if (this.nitroCooldown <= 0 && turnFar < 0.2 && k.nitro > 0.45) {
      inp.nitro = true;
      this.nitroCooldown = 7 + (this.seed % 5);
    } else {
      inp.nitro = false;
    }
    // AI earns nitro steadily (stand-in for drifting).
    k.nitro = Math.min(1, k.nitro + dt * 0.035 * this.skill);

    // Unstick if wedged against a wall.
    if (v < 2 && time > 6) this.stuckTime += dt; else this.stuckTime = 0;
    if (this.stuckTime > 2.5) {
      k.respawn(tr);
      this.stuckTime = 0;
    }
  }
}

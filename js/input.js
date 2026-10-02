import { clamp } from './utils.js';

export const isTouchDevice = () =>
  'ontouchstart' in window || navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches;

// Unifies keyboard, gamepad, on-screen touch controls and tilt steering into one
// smoothed input state.
export class Input {
  constructor() {
    this.keys = new Set();
    this.state = { throttle: 0, brake: 0, steer: 0, drift: false, nitro: false };
    this.steerSmoothed = 0;
    this.pressed = new Set(); // edge-triggered actions consumed once
    this.touch = { steer: 0, steering: false, brake: false, drift: false, nitro: false, gas: false };
    this.settings = { autoAccel: true, steerMode: 'touch', tiltSensitivity: 1 };
    this.tilt = 0;
    this.tiltZero = 0;
    this.lastGamepadButtons = [];
    this.usingTouch = false;

    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) {
        const map = { KeyP: 'pause', Escape: 'pause', KeyC: 'camera', KeyR: 'reset', KeyM: 'mute', Enter: 'confirm' };
        if (map[e.code]) this.pressed.add(map[e.code]);
      }
      this.keys.add(e.code);
      this.usingTouch = false;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    window.addEventListener('deviceorientation', (e) => this.onOrientation(e));
  }

  // iOS 13+ requires an explicit permission request from a user gesture.
  async enableTilt() {
    const DOE = window.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === 'function') {
      try {
        const r = await DOE.requestPermission();
        return r === 'granted';
      } catch {
        return false;
      }
    }
    return !!DOE;
  }

  onOrientation(e) {
    if (e.beta == null) return;
    const angle = (screen.orientation && screen.orientation.angle) ?? window.orientation ?? 0;
    // In landscape the "steering wheel" axis is beta; in portrait it's gamma.
    let v;
    if (angle === 90) v = e.beta;
    else if (angle === -90 || angle === 270) v = -e.beta;
    else v = e.gamma;
    this.tilt = v;
  }

  calibrateTilt() { this.tiltZero = this.tilt; }

  bindTouch(root) {
    const zone = root.querySelector('#steer-zone');
    const knob = root.querySelector('#steer-knob');
    const pointers = new Map();
    const updateZone = () => {
      if (pointers.size === 0) {
        this.touch.steering = false;
        this.touch.steer = 0;
        knob.style.transform = 'translateX(0px)';
        zone.classList.remove('active-left', 'active-right');
        return;
      }
      const rect = zone.getBoundingClientRect();
      const x = [...pointers.values()].pop();
      const rel = (x - (rect.left + rect.width / 2)) / (rect.width * 0.32);
      const v = clamp(rel, -1, 1);
      this.touch.steering = true;
      // Small dead-zone, then a gentle curve for precise small corrections.
      const dz = Math.abs(v) < 0.08 ? 0 : Math.sign(v) * Math.pow((Math.abs(v) - 0.08) / 0.92, 1.25);
      this.touch.steer = dz;
      knob.style.transform = `translateX(${v * rect.width * 0.32}px)`;
      zone.classList.toggle('active-left', v < -0.1);
      zone.classList.toggle('active-right', v > 0.1);
    };
    zone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      zone.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, e.clientX);
      this.usingTouch = true;
      updateZone();
    });
    zone.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, e.clientX);
      updateZone();
    });
    const end = (e) => { pointers.delete(e.pointerId); updateZone(); };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);

    const hold = (id, key) => {
      const el = root.querySelector(id);
      if (!el) return;
      const down = (e) => {
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        this.touch[key] = true;
        el.classList.add('down');
        this.usingTouch = true;
        if (navigator.vibrate) navigator.vibrate(8);
      };
      const up = () => { this.touch[key] = false; el.classList.remove('down'); };
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
      el.addEventListener('lostpointercapture', up);
    };
    hold('#btn-brake', 'brake');
    hold('#btn-drift', 'drift');
    hold('#btn-gas', 'gas');
    // Nitro on touch: tap to fire (latched) — like mobile racers.
    const nb = root.querySelector('#btn-nitro');
    nb.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.touch.nitro = !this.touch.nitro;
      nb.classList.toggle('down', this.touch.nitro);
      this.usingTouch = true;
      if (navigator.vibrate) navigator.vibrate(20);
    });
    const tap = (id, action) => {
      const el = root.querySelector(id);
      if (el) el.addEventListener('pointerdown', (e) => { e.preventDefault(); this.pressed.add(action); });
    };
    tap('#btn-pause', 'pause');
    tap('#btn-camera', 'camera');
    this.nitroButton = nb;
  }

  consume(action) {
    if (this.pressed.has(action)) {
      this.pressed.delete(action);
      return true;
    }
    return false;
  }

  update(dt, nitroLeft = 1) {
    const k = this.keys;
    let throttle = k.has('ArrowUp') || k.has('KeyW') ? 1 : 0;
    let brake = k.has('ArrowDown') || k.has('KeyS') ? 1 : 0;
    let steerDigital = (k.has('ArrowRight') || k.has('KeyD') ? 1 : 0) - (k.has('ArrowLeft') || k.has('KeyA') ? 1 : 0);
    let drift = k.has('Space');
    let nitro = k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyN');
    let analogSteer = null;

    // Gamepad
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp) continue;
      const b = (i) => (gp.buttons[i] ? gp.buttons[i].value : 0);
      const ax = gp.axes[0] || 0;
      if (Math.abs(ax) > 0.12) analogSteer = Math.sign(ax) * Math.pow((Math.abs(ax) - 0.12) / 0.88, 1.4);
      throttle = Math.max(throttle, b(7));
      brake = Math.max(brake, b(6));
      if (b(0) > 0.5 || b(5) > 0.5) drift = true; // A / RB
      if (b(2) > 0.5 || b(1) > 0.5) nitro = true; // X / B
      const prev = this.lastGamepadButtons;
      const edge = (i) => gp.buttons[i] && gp.buttons[i].pressed && !prev[i];
      if (edge(9)) this.pressed.add('pause');
      if (edge(3)) this.pressed.add('camera');
      if (edge(8)) this.pressed.add('reset');
      this.lastGamepadButtons = gp.buttons.map((x) => x.pressed);
      break;
    }

    // Touch
    if (this.usingTouch) {
      const t = this.touch;
      if (this.settings.autoAccel || t.gas) throttle = 1;
      if (t.brake) { brake = 1; if (!t.gas) throttle = 0; }
      if (t.drift) drift = true;
      if (t.nitro) {
        nitro = true;
        if (nitroLeft <= 0.01) {
          t.nitro = false;
          this.nitroButton && this.nitroButton.classList.remove('down');
        }
      }
      if (this.settings.steerMode === 'tilt') {
        const deg = (this.tilt - this.tiltZero) * this.settings.tiltSensitivity;
        const v = clamp(deg / 28, -1, 1);
        analogSteer = Math.abs(v) < 0.04 ? 0 : v;
      } else if (t.steering) {
        analogSteer = t.steer;
      }
    }

    // Keyboard steering ramps in/out so taps give small corrections and holds full lock.
    if (analogSteer !== null && steerDigital === 0) {
      this.steerSmoothed = analogSteer;
    } else {
      const target = steerDigital;
      const rate = target === 0 ? 9 : Math.sign(target) !== Math.sign(this.steerSmoothed) ? 12 : 5.5;
      const d = target - this.steerSmoothed;
      this.steerSmoothed += clamp(d, -rate * dt, rate * dt);
    }

    const s = this.state;
    s.throttle = throttle;
    s.brake = brake;
    s.steer = clamp(this.steerSmoothed, -1, 1);
    s.drift = drift;
    s.nitro = nitro;
    return s;
  }
}

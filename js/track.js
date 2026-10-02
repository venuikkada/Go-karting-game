import * as THREE from 'three';
import { canvasTexture, mulberry32 } from './utils.js';

// Circuit layout (x, z) — a flowing coastal circuit with a long start straight,
// a hairpin, an S-chicane and fast sweepers.
const LAYOUT = [
  [0, -200], [150, -210], [260, -170], [300, -80], [250, 0], [160, 30],
  [130, 110], [190, 190], [290, 230], [330, 320], [260, 400], [120, 400],
  [20, 330], [-60, 260], [-170, 280], [-280, 240], [-320, 120], [-260, 20],
  [-300, -90], [-240, -180], [-130, -210],
];
const SCALE = 1.1;

export const TRACK_HALF_WIDTH = 17;
export const CURB_WIDTH = 1.6;
export const WALL_DIST = 21;
// Paved apron beyond the barrier so no grass touches the circuit.
export const APRON_DIST = 27;

export class Track {
  constructor() {
    this.halfWidth = TRACK_HALF_WIDTH;
    this.curbWidth = CURB_WIDTH;
    this.wallDist = WALL_DIST;
    this.apronDist = APRON_DIST;

    const pts = LAYOUT.map(([x, z]) => new THREE.Vector3(x * SCALE, 0, z * SCALE));
    this.curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    this.length = this.curve.getLength();

    const N = Math.round(this.length / 1.0);
    this.N = N;
    this.step = this.length / N;
    this.px = new Float32Array(N);
    this.pz = new Float32Array(N);
    this.tx = new Float32Array(N);
    this.tz = new Float32Array(N);
    // n = unit "right" vector (screen-right when driving along the track).
    this.nx = new Float32Array(N);
    this.nz = new Float32Array(N);
    this.curv = new Float32Array(N);

    const p = new THREE.Vector3();
    const t = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      const u = i / N;
      this.curve.getPointAt(u, p);
      this.curve.getTangentAt(u, t);
      t.y = 0;
      t.normalize();
      this.px[i] = p.x;
      this.pz[i] = p.z;
      this.tx[i] = t.x;
      this.tz[i] = t.z;
      this.nx[i] = -t.z;
      this.nz[i] = t.x;
    }
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      const a0 = Math.atan2(this.tx[i], this.tz[i]);
      const a1 = Math.atan2(this.tx[j], this.tz[j]);
      let d = a1 - a0;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.curv[i] = d / this.step;
    }

    // Boost pads: [fraction of lap, lateral offset]
    this.boostPads = [
      [0.07, 0], [0.235, -8], [0.415, 8], [0.58, 0], [0.74, -8], [0.9, 8],
    ].map(([f, lat]) => ({ s: f * this.length, lat, len: 11, halfW: 4 }));
  }

  wrapS(s) {
    s %= this.length;
    return s < 0 ? s + this.length : s;
  }

  indexAt(s) {
    return Math.floor(this.wrapS(s) / this.step) % this.N;
  }

  // Interpolated sample at arc length s, optionally offset laterally.
  sample(s, lat = 0, out = {}) {
    s = this.wrapS(s);
    const f = s / this.step;
    const i = Math.floor(f) % this.N;
    const j = (i + 1) % this.N;
    const k = f - Math.floor(f);
    const tx = this.tx[i] + (this.tx[j] - this.tx[i]) * k;
    const tz = this.tz[i] + (this.tz[j] - this.tz[i]) * k;
    const l = Math.hypot(tx, tz) || 1;
    out.tx = tx / l;
    out.tz = tz / l;
    out.nx = -out.tz;
    out.nz = out.tx;
    out.x = this.px[i] + (this.px[j] - this.px[i]) * k + out.nx * lat;
    out.z = this.pz[i] + (this.pz[j] - this.pz[i]) * k + out.nz * lat;
    out.heading = Math.atan2(out.tx, out.tz);
    return out;
  }

  // Find nearest centreline point. hint = previous index (-1 for global search).
  locate(x, z, hint = -1, out = {}) {
    const N = this.N;
    let best = -1;
    let bestD = Infinity;
    if (hint < 0) {
      for (let i = 0; i < N; i++) {
        const dx = x - this.px[i];
        const dz = z - this.pz[i];
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = i; }
      }
    } else {
      for (let o = -80; o <= 80; o++) {
        const i = (hint + o + N) % N;
        const dx = x - this.px[i];
        const dz = z - this.pz[i];
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = i; }
      }
    }
    const dx = x - this.px[best];
    const dz = z - this.pz[best];
    out.idx = best;
    out.s = this.wrapS(best * this.step + dx * this.tx[best] + dz * this.tz[best]);
    out.lat = dx * this.nx[best] + dz * this.nz[best];
    return out;
  }

  // Coarse distance to centreline, used for scenery placement.
  distanceTo(x, z) {
    let bestD = Infinity;
    for (let i = 0; i < this.N; i += 3) {
      const dx = x - this.px[i];
      const dz = z - this.pz[i];
      const d = dx * dx + dz * dz;
      if (d < bestD) bestD = d;
    }
    return Math.sqrt(bestD);
  }

  // Total heading change over the next `dist` metres (radians, signed).
  turnAhead(s, dist) {
    const a = this.indexAt(s);
    const steps = Math.max(1, Math.round(dist / this.step));
    let sum = 0;
    for (let k = 0; k < steps; k++) sum += this.curv[(a + k) % this.N];
    return sum * this.step;
  }

  // ---------- Meshes ----------

  build(scene, theme) {
    const group = new THREE.Group();
    scene.add(group);
    this.group = group;

    const asphaltTex = makeAsphaltTexture();
    const asphaltRough = makeAsphaltRoughness();
    const road = new THREE.Mesh(
      this.ribbon(-this.halfWidth, this.halfWidth, 0.02, 24),
      new THREE.MeshStandardMaterial({
        map: asphaltTex, roughnessMap: asphaltRough, roughness: 1, metalness: 0.0,
        color: 0xffffff,
      })
    );
    road.receiveShadow = true;
    group.add(road);

    const curbTex = canvasTexture(64, 128, (g, w, h) => {
      g.fillStyle = '#d81e2c'; g.fillRect(0, 0, w, h / 2);
      g.fillStyle = '#f4f4f4'; g.fillRect(0, h / 2, w, h / 2);
      g.fillStyle = 'rgba(0,0,0,0.15)'; g.fillRect(0, 0, 6, h);
    });
    const curbMat = new THREE.MeshStandardMaterial({ map: curbTex, roughness: 0.6 });
    for (const side of [-1, 1]) {
      const a = side * this.halfWidth;
      const b = side * (this.halfWidth + this.curbWidth);
      const m = new THREE.Mesh(this.ribbon(Math.min(a, b), Math.max(a, b), 0.06, 4), curbMat);
      m.receiveShadow = true;
      group.add(m);
    }

    // Paved runoff from the curb, under the barrier and out to the apron edge —
    // no grass beside the road.
    const vergeTex = canvasTexture(128, 128, (g, w, h) => {
      g.fillStyle = '#2f3237'; g.fillRect(0, 0, w, h);
      const r = mulberry32(7);
      for (let i = 0; i < 2600; i++) {
        const v = Math.floor(35 + r() * 40);
        g.fillStyle = `rgba(${v},${v},${v + 4},${0.3 + r() * 0.4})`;
        g.fillRect(r() * w, r() * h, 1.5, 1.5);
      }
    });
    const vergeMat = new THREE.MeshStandardMaterial({ map: vergeTex, roughness: 0.95 });
    for (const side of [-1, 1]) {
      const a = side * (this.halfWidth + this.curbWidth);
      const b = side * this.apronDist;
      const m = new THREE.Mesh(this.ribbon(Math.min(a, b), Math.max(a, b), 0.015, 10, 0.2), vergeMat);
      m.receiveShadow = true;
      group.add(m);
    }

    // Barriers with sponsor panels.
    const wallTex = makeBarrierTexture();
    const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.5, side: THREE.DoubleSide });
    for (const side of [-1, 1]) {
      const m = new THREE.Mesh(this.wall(side * this.wallDist, 0, 1.25, 16, side > 0), wallMat);
      m.castShadow = true;
      m.receiveShadow = true;
      group.add(m);
    }
    const railMat = new THREE.MeshStandardMaterial({ color: 0xd8dde3, metalness: 0.8, roughness: 0.3 });
    for (const side of [-1, 1]) {
      const m = new THREE.Mesh(this.wall(side * this.wallDist, 1.25, 1.5, 16), railMat);
      group.add(m);
    }

    this.buildStartLine(group);
    this.buildBoostPads(group);
    return group;
  }

  // Flat road-like strip between two lateral offsets.
  ribbon(latA, latB, y, vScale, uScale = 1) {
    const N = this.N;
    const reps = Math.max(1, Math.round(this.length / vScale));
    vScale = this.length / reps;
    const pos = new Float32Array((N + 1) * 2 * 3);
    const uv = new Float32Array((N + 1) * 2 * 2);
    const nor = new Float32Array((N + 1) * 2 * 3);
    const idx = [];
    for (let i = 0; i <= N; i++) {
      const k = i % N;
      const ax = this.px[k] + this.nx[k] * latA;
      const az = this.pz[k] + this.nz[k] * latA;
      const bx = this.px[k] + this.nx[k] * latB;
      const bz = this.pz[k] + this.nz[k] * latB;
      pos.set([ax, y, az, bx, y, bz], i * 6);
      nor.set([0, 1, 0, 0, 1, 0], i * 6);
      const v = (i * this.step) / vScale;
      const uw = uScale === 1 ? 1 : (latB - latA) * uScale;
      uv.set([0, v, uw, v], i * 4);
      if (i < N) {
        const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
        idx.push(a, b, c, b, d, c);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    return g;
  }

  // flipU keeps sponsor text readable from the track side on the right-hand wall.
  wall(lat, y0, y1, uScale, flipU = false) {
    const N = this.N;
    const reps = Math.max(1, Math.round(this.length / uScale));
    uScale = this.length / reps;
    const pos = new Float32Array((N + 1) * 2 * 3);
    const uv = new Float32Array((N + 1) * 2 * 2);
    const idx = [];
    for (let i = 0; i <= N; i++) {
      const k = i % N;
      const x = this.px[k] + this.nx[k] * lat;
      const z = this.pz[k] + this.nz[k] * lat;
      pos.set([x, y0, z, x, y1, z], i * 6);
      const u = ((i * this.step) / uScale) * (flipU ? -1 : 1);
      uv.set([u, 0, u, 1], i * 4);
      if (i < N) {
        const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  buildStartLine(group) {
    const tex = canvasTexture(256, 32, (g, w, h) => {
      const n = 16;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < 2; j++) {
          g.fillStyle = (i + j) % 2 ? '#111' : '#f5f5f5';
          g.fillRect((i * w) / n, (j * h) / 2, w / n, h / 2);
        }
      }
    });
    const geo = new THREE.PlaneGeometry(this.halfWidth * 2, 2.5);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }));
    const s = this.sample(0);
    m.position.set(s.x, 0.04, s.z);
    m.rotation.y = s.heading;
    m.receiveShadow = true;
    group.add(m);

    // Painted starting grid slots.
    const slotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 });
    for (let k = 0; k < 8; k++) {
      const gs = this.sample(-12 - k * 7, (k % 2 ? 1 : -1) * 6);
      const bar = new THREE.Mesh(new THREE.PlaneGeometry(5, 0.3).rotateX(-Math.PI / 2), slotMat);
      bar.position.set(gs.x, 0.035, gs.z);
      bar.rotation.y = gs.heading;
      group.add(bar);
    }
  }

  buildBoostPads(group) {
    this.padTexture = canvasTexture(64, 128, (g, w, h) => {
      const grd = g.createLinearGradient(0, 0, 0, h);
      grd.addColorStop(0, 'rgba(0,240,255,0.15)');
      grd.addColorStop(1, 'rgba(0,140,255,0.35)');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#7ff9ff';
      g.lineWidth = 9;
      g.lineCap = 'round';
      for (let k = 0; k < 2; k++) {
        const y = 20 + k * 64;
        g.beginPath();
        g.moveTo(10, y + 30);
        g.lineTo(w / 2, y);
        g.lineTo(w - 10, y + 30);
        g.stroke();
      }
    }, { repeat: [1, 2] });
    const mat = new THREE.MeshBasicMaterial({
      map: this.padTexture, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, color: 0xbfffff,
    });
    for (const pad of this.boostPads) {
      const geo = new THREE.PlaneGeometry(pad.halfW * 2, pad.len);
      geo.rotateX(-Math.PI / 2);
      geo.rotateY(Math.PI); // chevrons point in driving direction
      const m = new THREE.Mesh(geo, mat);
      const s = this.sample(pad.s, pad.lat);
      m.position.set(s.x, 0.05, s.z);
      m.rotation.y = s.heading;
      group.add(m);
    }
  }

  update(dt) {
    if (this.padTexture) this.padTexture.offset.y -= dt * 1.6;
  }
}

function makeAsphaltTexture() {
  return canvasTexture(512, 1024, (g, w, h) => {
    g.fillStyle = '#3b3e44';
    g.fillRect(0, 0, w, h);
    const r = mulberry32(42);
    // Aggregate speckles
    for (let i = 0; i < 60000; i++) {
      const v = Math.floor(40 + r() * 50);
      g.fillStyle = `rgba(${v},${v},${v + 4},${0.25 + r() * 0.35})`;
      g.fillRect(r() * w, r() * h, 1 + r() * 1.5, 1 + r() * 1.5);
    }
    // Rubbered-in racing groove
    const grd = g.createLinearGradient(0, 0, w, 0);
    grd.addColorStop(0.0, 'rgba(0,0,0,0)');
    grd.addColorStop(0.35, 'rgba(0,0,0,0.18)');
    grd.addColorStop(0.5, 'rgba(0,0,0,0.05)');
    grd.addColorStop(0.65, 'rgba(0,0,0,0.18)');
    grd.addColorStop(1.0, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    // Edge lines
    g.fillStyle = '#f2f2f2';
    g.fillRect(w * 0.03, 0, w * 0.022, h);
    g.fillRect(w * 0.948, 0, w * 0.022, h);
    // Centre dashes
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fillRect(w * 0.494, 0, w * 0.012, h * 0.45);
    // Cracks
    g.strokeStyle = 'rgba(20,20,22,0.5)';
    g.lineWidth = 1.2;
    for (let i = 0; i < 14; i++) {
      let x = r() * w, y = r() * h;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 6; k++) {
        x += (r() - 0.5) * 30;
        y += (r() - 0.5) * 30;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  });
}

function makeAsphaltRoughness() {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#d0d0d0';
    g.fillRect(0, 0, w, h);
    const r = mulberry32(3);
    for (let i = 0; i < 8000; i++) {
      const v = Math.floor(150 + r() * 100);
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(r() * w, r() * h, 2, 2);
    }
  }, { srgb: false, repeat: [1, 4] });
}

function makeBarrierTexture() {
  const brands = ['TURBO', 'NITRO', 'APEX', 'VELOCITY', 'DRIFT', 'KART+'];
  const colors = [['#0b4fd8', '#fff'], ['#f4f4f4', '#d6161f'], ['#ffcc00', '#111'], ['#111', '#00e5ff'], ['#d6161f', '#fff'], ['#0d8a3c', '#fff']];
  return canvasTexture(1024, 128, (g, w, h) => {
    const n = brands.length;
    for (let i = 0; i < n; i++) {
      const [bg, fg] = colors[i];
      g.fillStyle = bg;
      g.fillRect((i * w) / n, 0, w / n, h);
      g.fillStyle = fg;
      g.font = 'italic 900 64px Arial Black, Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(brands[i], ((i + 0.5) * w) / n, h / 2 + 4);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect((i * w) / n, 0, 3, h);
    }
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(0, h - 10, w, 10);
  }, { repeat: [1, 1] });
}

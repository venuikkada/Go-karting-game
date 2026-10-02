import * as THREE from 'three';

// Pooled GPU point-sprite particles (smoke, sparks, nitro flames).
export class Particles {
  constructor(scene, max, { additive = false } = {}) {
    this.max = max;
    this.count = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.gravity = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.cursor = 0;

    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('aColor', this.colAttr);
    g.setAttribute('aSize', this.sizeAttr);
    g.setAttribute('aAlpha', this.alphaAttr);
    this.geometry = g;

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { scale: { value: 600 } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
        uniform float scale;
        varying vec3 vColor; varying float vAlpha;
        void main() {
          vColor = aColor; vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * scale / max(-mv.z, 0.1);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor; varying float vAlpha;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          float a = smoothstep(0.5, 0.0, d);
          if (a * vAlpha < 0.003) discard;
          gl_FragColor = vec4(vColor, a * vAlpha);
        }`,
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  spawn(x, y, z, vx, vy, vz, { life = 1, size = 1, grow = 1, r = 1, g = 1, b = 1, alpha = 1, drag = 1, gravity = 0 } = {}) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = r; this.col[i * 3 + 1] = g; this.col[i * 3 + 2] = b;
    this.size[i] = size;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.grow[i] = grow;
    this.drag[i] = drag;
    this.gravity[i] = gravity;
    this.a0[i] = alpha;
    this.alpha[i] = alpha;
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const k = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= k;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * k - this.gravity[i] * dt;
      this.vel[i * 3 + 2] *= k;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      this.alpha[i] = this.a0[i] * t;
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
  }

  setScale(h) { this.material.uniforms.scale.value = h * 0.7; }
}

// Ring buffer of quads laid on the asphalt while drifting / braking hard.
export class SkidMarks {
  constructor(scene, maxQuads = 1500) {
    this.max = maxQuads;
    this.cursor = 0;
    const pos = new Float32Array(maxQuads * 4 * 3);
    const alpha = new Float32Array(maxQuads * 4);
    const idx = new Uint32Array(maxQuads * 6);
    for (let q = 0; q < maxQuads; q++) {
      const v = q * 4;
      idx.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], q * 6);
    }
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('aAlpha', this.alphaAttr);
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      vertexShader: `attribute float aAlpha; varying float vA;
        void main(){ vA = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `varying float vA; void main(){ gl_FragColor = vec4(0.03,0.03,0.035, vA); }`,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.pos = pos;
    this.alpha = alpha;
  }

  // a,b are {x,z,px,pz} — current and previous wheel contact points.
  add(x0, z0, x1, z1, width, alpha) {
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 0.01 || len > 6) return;
    const nx = (-dz / len) * width * 0.5, nz = (dx / len) * width * 0.5;
    const q = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const y = 0.07;
    this.pos.set([x0 - nx, y, z0 - nz, x0 + nx, y, z0 + nz, x1 - nx, y, z1 - nz, x1 + nx, y, z1 + nz], q * 12);
    this.alpha.set([alpha, alpha, alpha, alpha], q * 4);
    this.posAttr.needsUpdate = true;
    this.alphaAttr.needsUpdate = true;
  }
}

// 2D overlay: anime-style speed lines when going fast / boosting.
export class SpeedLines {
  constructor(canvas) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.lines = [];
    for (let i = 0; i < 70; i++) this.lines.push({ a: Math.random() * Math.PI * 2, r: Math.random(), w: Math.random() });
  }

  resize(w, h, dpr) {
    this.c.width = Math.floor(w * dpr * 0.5);
    this.c.height = Math.floor(h * dpr * 0.5);
  }

  draw(intensity, dt) {
    const { g, c } = this;
    g.clearRect(0, 0, c.width, c.height);
    if (intensity <= 0.01) return;
    const cx = c.width / 2, cy = c.height * 0.45;
    const R = Math.hypot(c.width, c.height) * 0.6;
    g.lineCap = 'round';
    for (const l of this.lines) {
      l.r += dt * (1.6 + l.w * 2.5);
      if (l.r > 1) { l.r = 0.25 + Math.random() * 0.2; l.a = Math.random() * Math.PI * 2; l.w = Math.random(); }
      const r0 = R * (0.35 + l.r * 0.65);
      const r1 = r0 + R * (0.08 + 0.16 * intensity);
      const cos = Math.cos(l.a), sin = Math.sin(l.a);
      g.strokeStyle = `rgba(255,255,255,${(0.06 + 0.22 * l.w) * intensity})`;
      g.lineWidth = 1 + l.w * 2.5;
      g.beginPath();
      g.moveTo(cx + cos * r0, cy + sin * r0);
      g.lineTo(cx + cos * r1, cy + sin * r1);
      g.stroke();
    }
  }
}

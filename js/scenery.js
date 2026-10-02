import * as THREE from 'three';
import { canvasTexture, mulberry32 } from './utils.js';

// Builds everything around the circuit: sky, ground, mountains, trees,
// grandstands, start gantry, lamps, clouds and a lake.
export function buildScenery(scene, track, theme) {
  const group = new THREE.Group();
  scene.add(group);
  const rnd = mulberry32(1337);

  group.add(makeSky(theme));
  group.add(makeGround(theme));
  group.add(makeMountains(theme, rnd));
  const lake = makeLake(track, theme);
  if (lake) group.add(lake);
  group.add(makeTrees(track, theme, rnd, lake));
  group.add(makeGrandstands(track, theme, rnd));
  group.add(makeGantry(track, theme));
  group.add(makeLamps(track, theme));
  group.add(makeFlags(track, rnd));
  group.add(makeTireStacks(track, rnd));
  if (theme.name !== 'night') group.add(makeClouds(theme, rnd));
  return group;
}

function makeSky(theme) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: new THREE.Color(theme.skyTop) },
      horizon: { value: new THREE.Color(theme.skyHorizon) },
      bottom: { value: new THREE.Color(theme.skyBottom) },
      sunDir: { value: theme.sunDir.clone().normalize() },
      sunColor: { value: new THREE.Color(theme.sunGlow) },
      stars: { value: theme.name === 'night' ? 1 : 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top, horizon, bottom, sunDir, sunColor;
      uniform float stars;
      varying vec3 vDir;
      float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = h > 0.0 ? mix(horizon, top, pow(h, 0.55)) : mix(horizon, bottom, pow(-h, 0.4));
        float sd = max(dot(d, sunDir), 0.0);
        col += sunColor * (pow(sd, 900.0) * 6.0 + pow(sd, 18.0) * 0.45 + pow(sd, 3.0) * 0.12);
        if (stars > 0.5 && h > 0.0) {
          vec3 c = floor(d * 380.0);
          float s = hash(c);
          col += vec3(step(0.9975, s)) * (0.6 + 0.4 * hash(c + 1.0)) * smoothstep(0.0, 0.3, h);
        }
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(3500, 32, 16), mat);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  return sky;
}

function makeGround(theme) {
  const tex = canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = theme.grass;
    g.fillRect(0, 0, w, h);
    const r = mulberry32(11);
    for (let i = 0; i < 9000; i++) {
      const light = r() < 0.5;
      g.fillStyle = light ? `rgba(255,255,200,${r() * 0.07})` : `rgba(0,30,0,${r() * 0.12})`;
      g.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 3);
    }
  }, { repeat: [600, 600] });
  // Large-scale variation so the grass doesn't look tiled from far away.
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1 });
  const geo = new THREE.PlaneGeometry(7000, 7000);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, mat);
  // Sit well below the paved surfaces so the grass can never z-fight through the road.
  m.position.y = -0.25;
  m.receiveShadow = true;
  return m;
}

function makeMountains(theme, rnd) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: theme.mountain, flatShading: true, roughness: 1 });
  const snow = new THREE.MeshStandardMaterial({ color: theme.snow, flatShading: true, roughness: 0.9 });
  for (let i = 0; i < 42; i++) {
    const a = (i / 42) * Math.PI * 2 + rnd() * 0.1;
    const dist = 1300 + rnd() * 700;
    const r = 180 + rnd() * 260;
    const h = 160 + rnd() * 360;
    const geo = new THREE.ConeGeometry(r, h, 7 + Math.floor(rnd() * 4), 3);
    // Roughen the silhouette.
    const pos = geo.attributes.position;
    for (let k = 0; k < pos.count; k++) {
      if (pos.getY(k) < h / 2 - 1) {
        pos.setX(k, pos.getX(k) * (0.8 + rnd() * 0.4));
        pos.setZ(k, pos.getZ(k) * (0.8 + rnd() * 0.4));
      }
    }
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat);
    m.position.set(Math.cos(a) * dist, h / 2 - 5, Math.sin(a) * dist);
    m.rotation.y = rnd() * 6;
    group.add(m);
    if (h > 330) {
      const cap = new THREE.Mesh(new THREE.ConeGeometry(r * 0.32, h * 0.3, 7, 1), snow);
      cap.position.set(m.position.x, h - h * 0.15 - 5 + 1, m.position.z);
      cap.rotation.y = m.rotation.y;
      group.add(cap);
    }
  }
  return group;
}

function makeLake(track, theme) {
  // Pick the open spot furthest from the circuit within the infield region.
  let best = null;
  for (let x = -480; x <= 480; x += 20) {
    for (let z = -360; z <= 540; z += 20) {
      const d = track.distanceTo(x, z);
      if (!best || d > best.d) best = { x, z, d };
    }
  }
  if (!best || best.d < 60) return null;
  const r = Math.min(best.d - track.apronDist - 18, 140);
  const geo = new THREE.CircleGeometry(r, 48);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({
    color: theme.water, metalness: 0.9, roughness: 0.08, envMapIntensity: 1.2,
  });
  const lake = new THREE.Mesh(geo, mat);
  lake.position.set(best.x, 0.05, best.z);
  lake.receiveShadow = true;
  const shoreGeo = new THREE.RingGeometry(r, r + 6, 48);
  shoreGeo.rotateX(-Math.PI / 2);
  const shore = new THREE.Mesh(shoreGeo, new THREE.MeshStandardMaterial({ color: 0xcdb98a, roughness: 1 }));
  shore.position.y = -0.02;
  lake.add(shore);
  lake.userData = { x: best.x, z: best.z, r: r + 8 };
  return lake;
}

function makeTrees(track, theme, rnd, lake) {
  const group = new THREE.Group();
  const pine = [];
  const round = [];
  let tries = 0;
  while (pine.length + round.length < 650 && tries < 20000) {
    tries++;
    const x = (rnd() - 0.5) * 1700;
    const z = (rnd() - 0.5) * 1500 + 100;
    const d = track.distanceTo(x, z);
    if (d < track.apronDist + 12) continue;
    if (lake && Math.hypot(x - lake.userData.x, z - lake.userData.z) < lake.userData.r) continue;
    // Denser near the track for a sense of speed.
    if (d > 120 && rnd() < 0.55) continue;
    const s = 0.8 + rnd() * 0.9;
    (rnd() < 0.6 ? pine : round).push({ x, z, s, r: rnd() * 6 });
  }

  const trunkGeo = new THREE.CylinderGeometry(0.35, 0.5, 3, 6);
  trunkGeo.translate(0, 1.5, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a3b22, roughness: 1 });

  const pineGeo = mergeCones();
  const pineMat = new THREE.MeshStandardMaterial({ color: theme.pine, flatShading: true, roughness: 0.9 });
  const roundGeo = new THREE.IcosahedronGeometry(3.2, 0);
  roundGeo.translate(0, 5.2, 0);
  const roundMat = new THREE.MeshStandardMaterial({ color: theme.leaf, flatShading: true, roughness: 0.9 });

  const all = pine.concat(round);
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, all.length);
  const pines = new THREE.InstancedMesh(pineGeo, pineMat, pine.length);
  const rounds = new THREE.InstancedMesh(roundGeo, roundMat, round.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const color = new THREE.Color();
  all.forEach((t, i) => {
    q.setFromEuler(e.set(0, t.r, 0));
    m.compose(new THREE.Vector3(t.x, 0, t.z), q, new THREE.Vector3(t.s, t.s, t.s));
    trunks.setMatrixAt(i, m);
  });
  pine.forEach((t, i) => {
    q.setFromEuler(e.set(0, t.r, 0));
    m.compose(new THREE.Vector3(t.x, 0, t.z), q, new THREE.Vector3(t.s, t.s * 1.1, t.s));
    pines.setMatrixAt(i, m);
    pines.setColorAt(i, color.setHSL(0.3 + rnd() * 0.05, 0.5, 0.75 + rnd() * 0.25));
  });
  round.forEach((t, i) => {
    q.setFromEuler(e.set(0, t.r, 0));
    m.compose(new THREE.Vector3(t.x, 0, t.z), q, new THREE.Vector3(t.s, t.s, t.s));
    rounds.setMatrixAt(i, m);
    rounds.setColorAt(i, color.setHSL(0.22 + rnd() * 0.1, 0.6, 0.75 + rnd() * 0.25));
  });
  for (const im of [trunks, pines, rounds]) {
    im.castShadow = true;
    im.receiveShadow = true;
    group.add(im);
  }
  return group;
}

function mergeCones() {
  const parts = [
    [3.2, 4.0, 3.2],
    [2.5, 3.4, 5.4],
    [1.7, 2.8, 7.4],
  ];
  const positions = [];
  const indices = [];
  let offset = 0;
  for (const [r, h, y] of parts) {
    const c = new THREE.ConeGeometry(r, h, 7, 1).toNonIndexed();
    c.translate(0, y, 0);
    const p = c.attributes.position.array;
    for (let i = 0; i < p.length; i++) positions.push(p[i]);
    for (let i = 0; i < p.length / 3; i++) indices.push(offset + i);
    offset += p.length / 3;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

function makeGrandstands(track, theme, rnd) {
  const group = new THREE.Group();
  const standMat = new THREE.MeshStandardMaterial({ color: 0x8c96a3, roughness: 0.8 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xe8ecf2, roughness: 0.4, metalness: 0.3 });
  const seatColors = [0xd81e2c, 0x0b4fd8, 0xffcc00, 0xffffff, 0x20b050, 0xff6a00, 0x222222, 0xff4fa0];
  const crowdGeo = new THREE.BoxGeometry(0.6, 1.0, 0.5);
  crowdGeo.translate(0, 0.5, 0);
  const crowdMat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
  const crowd = [];

  const placements = [
    { s: -60, side: -1, len: 90 },
    { s: 55, side: -1, len: 70 },
    { s: 0, side: 1, len: 60 },
    { s: track.length * 0.5, side: -1, len: 60 },
  ];
  for (const p of placements) {
    const c = track.sample(p.s);
    const base = track.wallDist + 9;
    const stand = new THREE.Group();
    stand.position.set(c.x + c.nx * base * p.side, 0, c.z + c.nz * base * p.side);
    stand.rotation.y = c.heading + (p.side > 0 ? Math.PI : 0);
    // Track lies towards local -x; rows climb outward along +x.
    const rows = 7;
    for (let r = 0; r < rows; r++) {
      const h = 1.2 + r * 1.2;
      const step = new THREE.Mesh(new THREE.BoxGeometry(2, h, p.len), standMat);
      step.position.set(r * 2, h / 2, 0);
      step.castShadow = true;
      step.receiveShadow = true;
      stand.add(step);
      for (let k = 0; k < p.len / 0.9; k++) {
        if (rnd() < 0.18) continue;
        crowd.push({ stand, lx: r * 2, ly: h, lz: -p.len / 2 + k * 0.9 + 0.45, c: seatColors[Math.floor(rnd() * seatColors.length)] });
      }
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(rows * 2 + 4, 0.4, p.len + 4), roofMat);
    roof.position.set(rows - 1, 13, 0);
    roof.castShadow = true;
    stand.add(roof);
    for (const z of [-p.len / 2, 0, p.len / 2]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 13), roofMat);
      pole.position.set(rows * 2, 6.5, z);
      stand.add(pole);
    }
    group.add(stand);
    stand.updateMatrixWorld(true);
  }

  const inst = new THREE.InstancedMesh(crowdGeo, crowdMat, crowd.length);
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const col = new THREE.Color();
  crowd.forEach((c, i) => {
    v.set(c.lx, c.ly, c.lz);
    c.stand.localToWorld(v);
    m.makeRotationY(c.stand.rotation.y);
    m.setPosition(v);
    inst.setMatrixAt(i, m);
    inst.setColorAt(i, col.setHex(c.c));
  });
  inst.castShadow = true;
  group.add(inst);
  return group;
}

function makeGantry(track, theme) {
  const group = new THREE.Group();
  const s = track.sample(0);
  group.position.set(s.x, 0, s.z);
  group.rotation.y = s.heading;
  const metal = new THREE.MeshStandardMaterial({ color: 0x2a2f38, metalness: 0.7, roughness: 0.35 });
  const span = track.halfWidth + 3;
  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 10, 1.2), metal);
    pillar.position.set(side * span, 5, 0);
    pillar.castShadow = true;
    group.add(pillar);
  }
  const bannerTex = canvasTexture(1024, 128, (g, w, h) => {
    g.fillStyle = '#0a0d14';
    g.fillRect(0, 0, w, h);
    const sq = 16;
    for (let i = 0; i < w / sq; i++) {
      for (let j = 0; j < 2; j++) {
        g.fillStyle = (i + j) % 2 ? '#fff' : '#111';
        g.fillRect(i * sq, j * sq, sq, sq);
        g.fillRect(i * sq, h - (j + 1) * sq, sq, sq);
      }
    }
    g.font = 'italic 900 62px Arial Black, Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const grd = g.createLinearGradient(0, 0, w, 0);
    grd.addColorStop(0, '#ffcc00');
    grd.addColorStop(1, '#ff3d00');
    g.fillStyle = grd;
    g.fillText('TURBO KART  •  START / FINISH', w / 2, h / 2 + 3);
  });
  const banner = new THREE.Mesh(
    new THREE.BoxGeometry(span * 2 + 1.2, 2.4, 0.8),
    [metal, metal, metal, metal,
      new THREE.MeshStandardMaterial({ map: bannerTex, emissive: 0xffffff, emissiveMap: bannerTex, emissiveIntensity: theme.name === 'night' ? 0.9 : 0.25 }),
      new THREE.MeshStandardMaterial({ map: bannerTex, emissive: 0xffffff, emissiveMap: bannerTex, emissiveIntensity: theme.name === 'night' ? 0.9 : 0.25 })]
  );
  banner.position.set(0, 10, 0);
  banner.castShadow = true;
  group.add(banner);

  // Start lights (driven by the countdown).
  const lights = [];
  for (let i = 0; i < 5; i++) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0x000000, emissiveIntensity: 3 });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 8), mat);
    bulb.position.set((i - 2) * 1.3, 8.2, -0.5);
    group.add(bulb);
    lights.push(mat);
  }
  const housing = new THREE.Mesh(new THREE.BoxGeometry(7.2, 1.4, 0.6), metal);
  housing.position.set(0, 8.2, -0.1);
  group.add(housing);
  group.userData.lights = lights;
  track.startLights = lights;
  return group;
}

function makeLamps(track, theme) {
  const group = new THREE.Group();
  const night = theme.name === 'night';
  const spacing = 55;
  const count = Math.floor(track.length / spacing);
  const poleGeo = new THREE.CylinderGeometry(0.18, 0.25, 11, 6);
  poleGeo.translate(0, 5.5, 0);
  const armGeo = new THREE.BoxGeometry(0.2, 0.2, 4);
  armGeo.translate(0, 11, 2);
  const headGeo = new THREE.BoxGeometry(0.9, 0.3, 1.6);
  headGeo.translate(0, 10.85, 4);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.6, roughness: 0.4 });
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, emissive: 0xfff1c8, emissiveIntensity: night ? 6 : 0.2,
  });
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, count);
  const arms = new THREE.InstancedMesh(armGeo, poleMat, count);
  const heads = new THREE.InstancedMesh(headGeo, headMat, count);
  const m = new THREE.Matrix4();
  const pools = [];
  for (let i = 0; i < count; i++) {
    const side = i % 2 ? 1 : -1;
    const c = track.sample(i * spacing + 20);
    const lat = side * (track.wallDist + 1.5);
    const x = c.x + c.nx * lat;
    const z = c.z + c.nz * lat;
    // Arm points towards track centre.
    const yaw = Math.atan2(-c.nx * side, -c.nz * side);
    m.makeRotationY(yaw);
    m.setPosition(x, 0, z);
    poles.setMatrixAt(i, m);
    arms.setMatrixAt(i, m);
    heads.setMatrixAt(i, m);
    pools.push({ x: x - c.nx * side * 13, z: z - c.nz * side * 13 });
  }
  poles.castShadow = true;
  group.add(poles, arms, heads);

  if (night) {
    // Fake light pools on the asphalt — cheap and convincing.
    const poolTex = canvasTexture(128, 128, (g, w, h) => {
      const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      grd.addColorStop(0, 'rgba(255,236,190,0.9)');
      grd.addColorStop(0.5, 'rgba(255,220,160,0.25)');
      grd.addColorStop(1, 'rgba(255,220,160,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
    });
    const poolGeo = new THREE.PlaneGeometry(30, 30);
    poolGeo.rotateX(-Math.PI / 2);
    const poolMat = new THREE.MeshBasicMaterial({
      map: poolTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const inst = new THREE.InstancedMesh(poolGeo, poolMat, pools.length);
    pools.forEach((p, i) => {
      m.makeTranslation(p.x, 0.08, p.z);
      inst.setMatrixAt(i, m);
    });
    group.add(inst);
  }
  return group;
}

function makeFlags(track, rnd) {
  const group = new THREE.Group();
  const colors = ['#ffcc00', '#00e5ff', '#ff3d6e', '#7cff4f', '#ffffff'];
  const poleMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.5, roughness: 0.4 });
  const flags = [];
  for (let i = 0; i < 26; i++) {
    const s = rnd() * track.length;
    const side = rnd() < 0.5 ? -1 : 1;
    const c = track.sample(s, side * (track.wallDist + 4 + rnd() * 3));
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 7, 5), poleMat);
    pole.position.set(c.x, 3.5, c.z);
    group.add(pole);
    const col = colors[Math.floor(rnd() * colors.length)];
    const tex = canvasTexture(64, 128, (g, w, h) => {
      g.fillStyle = col;
      g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.font = 'bold 40px Arial';
      g.save();
      g.translate(w / 2, h / 2);
      g.rotate(-Math.PI / 2);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('GO!', 0, 0);
      g.restore();
    });
    const geo = new THREE.PlaneGeometry(1.2, 3, 6, 1);
    geo.translate(0.6, 0, 0);
    const flag = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, side: THREE.DoubleSide, roughness: 0.8 }));
    flag.position.set(c.x, 5.3, c.z);
    flag.rotation.y = rnd() * 6;
    flag.userData.phase = rnd() * 6;
    group.add(flag);
    flags.push(flag);
  }
  group.userData.update = (t) => {
    for (const f of flags) {
      const pos = f.geometry.attributes.position;
      for (let k = 0; k < pos.count; k++) {
        const x = pos.getX(k);
        pos.setZ(k, Math.sin(t * 6 + x * 3 + f.userData.phase) * 0.18 * x);
      }
      pos.needsUpdate = true;
    }
  };
  return group;
}

function makeTireStacks(track, rnd) {
  // Tyre walls on the outside of the sharpest corners.
  const spots = [];
  for (let i = 0; i < track.N; i += 6) {
    const turn = track.turnAhead(i * track.step, 30);
    if (Math.abs(turn) > 0.55) spots.push({ s: i * track.step, side: turn > 0 ? -1 : 1 });
  }
  const geo = new THREE.TorusGeometry(0.42, 0.2, 6, 10);
  geo.rotateX(Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.9 });
  const count = spots.length * 3;
  const inst = new THREE.InstancedMesh(geo, mat, Math.max(1, count));
  const m = new THREE.Matrix4();
  const col = new THREE.Color();
  let k = 0;
  for (const sp of spots) {
    const c = track.sample(sp.s, sp.side * (track.wallDist - 0.6));
    for (let h = 0; h < 3; h++) {
      m.makeTranslation(c.x, 0.2 + h * 0.4, c.z);
      inst.setMatrixAt(k, m);
      inst.setColorAt(k, h === 1 ? col.setHex(rnd() < 0.5 ? 0xd81e2c : 0xf0f0f0) : col.setHex(0x1b1b1b));
      k++;
    }
  }
  inst.count = k;
  inst.castShadow = true;
  return inst;
}

function makeClouds(theme, rnd) {
  const group = new THREE.Group();
  const tex = canvasTexture(256, 128, (g, w, h) => {
    for (let i = 0; i < 26; i++) {
      const x = w * 0.15 + rnd() * w * 0.7;
      const y = h * 0.4 + rnd() * h * 0.3;
      const r = 18 + rnd() * 34;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(255,255,255,0.55)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
    }
  });
  const mat = new THREE.SpriteMaterial({ map: tex, color: theme.cloud, transparent: true, depthWrite: false, fog: false });
  for (let i = 0; i < 24; i++) {
    const s = new THREE.Sprite(mat);
    const a = rnd() * Math.PI * 2;
    const d = 700 + rnd() * 1300;
    s.position.set(Math.cos(a) * d, 220 + rnd() * 260, Math.sin(a) * d);
    const sc = 300 + rnd() * 400;
    s.scale.set(sc, sc * 0.45, 1);
    group.add(s);
  }
  return group;
}

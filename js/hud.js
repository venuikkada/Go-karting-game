import { formatTime, ordinal, clamp } from './utils.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor(track) {
    this.track = track;
    this.el = {
      hud: $('hud'), posNum: $('pos-num'), posSuf: $('pos-suf'), posOf: $('pos-of'),
      lapNum: $('lap-num'), lapTotal: $('lap-total'), timer: $('timer'), best: $('best'),
      msg: $('msg'), countdown: $('countdown'), wrong: $('wrongway'), leaderboard: $('leaderboard'),
      driftMeter: $('drift-meter'), driftFill: $('drift-fill'), driftLabel: $('drift-label'),
      vignette: $('vignette'), flash: $('flash'), nitroFill: $('nitro-btn-fill'), nitroBtn: $('btn-nitro'),
    };
    this.speedo = $('speedo').getContext('2d');
    this.mini = $('minimap').getContext('2d');
    this.prepareMinimap();
    this.lbTimer = 0;
    this.last = {};
  }

  prepareMinimap() {
    const t = this.track;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < t.N; i++) {
      minX = Math.min(minX, t.px[i]); maxX = Math.max(maxX, t.px[i]);
      minZ = Math.min(minZ, t.pz[i]); maxZ = Math.max(maxZ, t.pz[i]);
    }
    const size = 200, pad = 22;
    const sc = (size - pad * 2) / Math.max(maxX - minX, maxZ - minZ);
    const ox = size / 2 - ((minX + maxX) / 2) * sc;
    const oz = size / 2 - ((minZ + maxZ) / 2) * sc;
    // Mirror X so the map matches the driver's left/right view.
    this.mapXY = (x, z) => [size - (x * sc + ox), size - (z * sc + oz)];
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.lineJoin = 'round';
    const path = () => {
      g.beginPath();
      for (let i = 0; i <= t.N; i += 4) {
        const [x, y] = this.mapXY(t.px[i % t.N], t.pz[i % t.N]);
        i === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
      }
      g.closePath();
    };
    path(); g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 10; g.stroke();
    path(); g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 6; g.stroke();
    path(); g.strokeStyle = '#3a4250'; g.lineWidth = 3; g.stroke();
    const [sx, sy] = this.mapXY(t.px[0], t.pz[0]);
    g.fillStyle = '#ffcc00';
    g.fillRect(sx - 4, sy - 4, 8, 8);
    this.miniBg = c;
  }

  show(v) { this.el.hud.classList.toggle('hidden', !v); }

  setLaps(n) { this.el.lapTotal.textContent = n; }

  message(text, color = '#fff') {
    const m = this.el.msg;
    m.textContent = text;
    m.style.color = color;
    m.classList.remove('pop');
    void m.offsetWidth;
    m.classList.add('pop');
  }

  countdown(text) {
    const c = this.el.countdown;
    c.textContent = text;
    c.classList.remove('tick');
    void c.offsetWidth;
    if (text) c.classList.add('tick');
  }

  flash(strength = 0.5) {
    const f = this.el.flash;
    f.style.transition = 'none';
    f.style.opacity = strength;
    requestAnimationFrame(() => {
      f.style.transition = 'opacity 0.35s';
      f.style.opacity = 0;
    });
  }

  update(dt, game) {
    const p = game.player;
    const e = this.el;
    const rank = game.ranking.indexOf(p) + 1;
    if (this.last.rank !== rank) {
      e.posNum.textContent = rank;
      e.posSuf.textContent = ordinal(rank).replace(/\d+/, '');
      e.posOf.textContent = '/' + game.karts.length;
      this.last.rank = rank;
    }
    const lapShown = clamp(p.lap + 1, 1, game.laps);
    if (this.last.lap !== lapShown) { e.lapNum.textContent = lapShown; this.last.lap = lapShown; }
    const lapTime = game.state === 'race' ? game.time - p.lapStart : 0;
    e.timer.textContent = formatTime(game.state === 'race' || game.state === 'finished' ? (p.finished ? p.finishTime : game.time) : 0);
    e.best.textContent = `LAP ${formatTime(lapTime)}  ·  BEST ${formatTime(p.bestLap)}`;
    e.wrong.classList.toggle('show', p.wrongWay && game.state === 'race');

    // Drift meter
    const showDrift = p.drifting;
    e.driftMeter.classList.toggle('show', showDrift);
    if (showDrift) {
      const t = p.driftTime;
      const frac = t < 1 ? t / 1 : t < 2.2 ? (t - 1) / 1.2 : 1;
      e.driftFill.style.width = `${frac * 100}%`;
      e.driftFill.className = p.driftLevel === 2 ? 'l2' : p.driftLevel === 1 ? 'l1' : '';
      e.driftLabel.textContent = p.driftLevel === 2 ? 'SUPER TURBO!' : p.driftLevel === 1 ? 'TURBO' : 'DRIFT';
    }
    e.vignette.classList.toggle('boost', p.isBoosting);
    if (e.nitroFill) {
      e.nitroFill.style.height = `${p.nitro * 100}%`;
      e.nitroBtn.classList.toggle('ready', p.nitro > 0.3);
    }

    this.drawSpeedo(p);
    this.drawMinimap(game);
    this.lbTimer -= dt;
    if (this.lbTimer <= 0) { this.drawLeaderboard(game); this.lbTimer = 0.25; }
  }

  drawSpeedo(p) {
    const g = this.speedo;
    const W = 260, cx = 130, cy = 140, R = 104;
    g.clearRect(0, 0, W, W);
    const kmh = Math.abs(p.speed) * 3.6;
    const maxK = 400;
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    const frac = clamp(kmh / maxK, 0, 1);

    g.lineCap = 'round';
    // Backplate
    g.beginPath();
    g.arc(cx, cy, R + 14, 0, Math.PI * 2);
    g.fillStyle = 'rgba(8,12,22,0.55)';
    g.fill();
    // Track arc
    g.beginPath();
    g.arc(cx, cy, R, a0, a1);
    g.strokeStyle = 'rgba(255,255,255,0.15)';
    g.lineWidth = 12;
    g.stroke();
    // Speed arc
    const grd = g.createLinearGradient(0, W, W, 0);
    grd.addColorStop(0, '#00e5ff');
    grd.addColorStop(0.6, '#ffcc00');
    grd.addColorStop(1, '#ff3d00');
    g.beginPath();
    g.arc(cx, cy, R, a0, a0 + (a1 - a0) * frac);
    g.strokeStyle = grd;
    g.lineWidth = 12;
    g.stroke();
    // Ticks
    g.strokeStyle = 'rgba(255,255,255,0.6)';
    g.lineWidth = 2;
    for (let i = 0; i <= 13; i++) {
      const a = a0 + ((a1 - a0) * i) / 13;
      const r0 = R - 16, r1 = R - (i % 2 ? 20 : 26);
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      g.stroke();
    }
    // Nitro ring
    g.beginPath();
    g.arc(cx, cy, R - 34, a0, a1);
    g.strokeStyle = 'rgba(0,229,255,0.15)';
    g.lineWidth = 8;
    g.stroke();
    if (p.nitro > 0.001) {
      g.beginPath();
      g.arc(cx, cy, R - 34, a0, a0 + (a1 - a0) * p.nitro);
      g.strokeStyle = p.isBoosting ? '#ffffff' : '#00e5ff';
      g.shadowColor = '#00e5ff';
      g.shadowBlur = p.nitro > 0.3 ? 12 : 0;
      g.lineWidth = 8;
      g.stroke();
      g.shadowBlur = 0;
    }
    // Digits
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    g.font = 'italic 900 58px Arial, sans-serif';
    g.fillText(String(Math.round(kmh)), cx, cy + 14);
    g.font = 'italic 800 16px Arial, sans-serif';
    g.fillStyle = '#9aa6b8';
    g.fillText('KM/H', cx, cy + 36);
    g.fillStyle = p.isBoosting ? '#00e5ff' : 'rgba(0,229,255,0.7)';
    g.font = 'italic 900 15px Arial, sans-serif';
    g.fillText(p.isBoosting ? 'BOOST!' : 'NITRO', cx, cy + 70);
  }

  drawMinimap(game) {
    const g = this.mini;
    g.clearRect(0, 0, 200, 200);
    g.drawImage(this.miniBg, 0, 0);
    for (const k of game.karts) {
      if (k === game.player) continue;
      const [x, y] = this.mapXY(k.x, k.z);
      g.beginPath();
      g.arc(x, y, 5, 0, Math.PI * 2);
      g.fillStyle = '#' + k.color.toString(16).padStart(6, '0');
      g.fill();
      g.strokeStyle = '#000';
      g.lineWidth = 1.5;
      g.stroke();
    }
    const p = game.player;
    const [x, y] = this.mapXY(p.x, p.z);
    g.save();
    g.translate(x, y);
    // World forward (sin h, cos h) maps to screen (-sin h, -cos h) on this mirrored map.
    g.rotate(-p.heading);
    g.beginPath();
    g.moveTo(0, -9);
    g.lineTo(7, 7);
    g.lineTo(0, 3);
    g.lineTo(-7, 7);
    g.closePath();
    g.fillStyle = '#ffcc00';
    g.fill();
    g.strokeStyle = '#000';
    g.lineWidth = 2;
    g.stroke();
    g.restore();
  }

  drawLeaderboard(game) {
    const rows = game.ranking.map((k, i) => {
      const leader = game.ranking[0];
      const gap = i === 0 ? '' : `+${((leader.progress - k.progress) / Math.max(20, Math.abs(leader.speed) || 30)).toFixed(1)}s`;
      const col = '#' + k.color.toString(16).padStart(6, '0');
      return `<div class="${k === game.player ? 'me' : ''}"><b>${i + 1}</b><i style="background:${col}"></i>${k.name}<span class="gap">${k.finished ? '🏁' : gap}</span></div>`;
    });
    this.el.leaderboard.innerHTML = rows.join('');
  }
}

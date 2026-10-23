/** バトル画面の描画（背景・牛・角・エフェクト・HUD）。物理は持たず、ビューとイベントだけを使う */
import { MATERIALS, MatchEvent, Poly, WORLD } from '@kinggnu/shared';
import { sfx } from '../game/audio';
import { drawCowBody, drawCowHead, roundRect } from './cow';
import { drawHorn } from './hornRender';
import { MatchView } from './view';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  kind: 'spark' | 'chip' | 'shard' | 'drop' | 'dust' | 'star' | 'ember';
  rot: number;
}

interface Popup {
  x: number;
  y: number;
  text: string;
  color: string;
  life: number;
  size: number;
  vy: number;
}

interface Debris {
  poly: Poly;
  cx: number;
  cy: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  life: number;
  color: string;
  stroke: string;
  alpha: number;
}

interface Puddle {
  x: number;
  r: number;
}

export const TEAM_COLORS = ['#e74c3c', '#2e86de'];

export class Scene {
  particles: Particle[] = [];
  popups: Popup[] = [];
  debris: Debris[] = [];
  puddles: Puddle[] = [];
  shake = 0;
  flash = 0;
  t = 0;
  you: number | null = 0;
  private dripT = [0, 0];
  private emberT = [0, 0];
  private burnT = [0, 0];
  private burnSfxT = 0;
  private lastCount = -1;
  private chargeTick = [0, 0];
  koText = '';
  koT = 0;

  reset() {
    this.particles = [];
    this.popups = [];
    this.debris = [];
    this.puddles = [];
    this.shake = 0;
    this.flash = 0;
    this.koT = 0;
    this.koText = '';
    this.lastCount = -1;
  }

  handleEvents(events: MatchEvent[], view: MatchView) {
    for (const e of events) {
      switch (e.type) {
        case 'start':
          this.popups.push({ x: WORLD.width / 2, y: 250, text: 'FIGHT!', color: '#ffd34d', life: 1, size: 84, vy: 0 });
          sfx.countdown(true);
          break;
        case 'hit': {
          const att = view.fighters[e.a];
          const mat = MATERIALS[att.material];
          const big = e.dmg >= 120;
          this.burst(e.x, e.y, big ? 26 : 12, mat.id === 'glass' ? '#e8fbff' : '#ffe27a', 'spark', 260 + e.dmg * 2);
          if (big) this.burst(e.x, e.y, 6, '#ffffff', 'star', 300);
          const jx = (Math.random() - 0.5) * 40;
          if (e.dmg > 0)
            this.popups.push({
              x: e.x + jx,
              y: e.y - 20,
              text: `${e.dmg}`,
              color: big ? '#ff4d4d' : '#ffffff',
              life: 1.1,
              size: 26 + Math.min(40, e.dmg / 5),
              vy: -90,
            });
          if (e.whip) this.popups.push({ x: e.x + 30 + jx, y: e.y - 55, text: 'WHIP!', color: '#ff9a3c', life: 0.9, size: 24, vy: -60 });
          if (e.block) this.popups.push({ x: e.x - 30 + jx, y: e.y - 55, text: 'BLOCK', color: '#cfd8dc', life: 0.7, size: 18, vy: -50 });
          else if (e.guard) this.popups.push({ x: e.x - 30, y: e.y - 55, text: 'GUARD', color: '#8fd3ff', life: 0.8, size: 20, vy: -50 });
          if (e.recoil > 0) {
            const hx = att.x + att.facing * 90;
            this.popups.push({ x: hx, y: WORLD.groundY - 210, text: `反動 -${e.recoil}`, color: '#c39bff', life: 1, size: 18 + Math.min(14, e.recoil / 6), vy: -50 });
            if (e.recoil > 10) sfx.recoil();
          }
          this.shake = Math.max(this.shake, Math.min(22, 3 + e.dmg / 9));
          if (big) this.flash = 0.12;
          sfx.hit(e.dmg, mat.id, e.whip);
          break;
        }
        case 'clash':
          this.burst(e.x, e.y, 8 + Math.round(e.power * 14), '#ffffff', 'spark', 200 + e.power * 400);
          this.shake = Math.max(this.shake, 3 + e.power * 8);
          sfx.clash(e.power);
          break;
        case 'crack': {
          const mat = MATERIALS[view.fighters[e.f].material];
          this.burst(e.x, e.y, 6, mat.id === 'glass' ? '#ffffff' : mat.color.accent, mat.id === 'glass' ? 'shard' : 'chip', 160);
          this.popups.push({ x: e.x, y: e.y - 30, text: mat.id === 'plastic' ? '白化!' : 'ヒビ!', color: '#ffffff', life: 0.8, size: 18, vy: -40 });
          sfx.crack();
          break;
        }
        case 'chip': {
          const mat = MATERIALS[view.fighters[e.f].material];
          this.burst(e.x, e.y, 10, mat.color.fill, 'chip', 220);
          this.popups.push({ x: e.x, y: e.y - 30, text: '欠けた!', color: '#ffe0b0', life: 0.8, size: 18, vy: -40 });
          sfx.crack();
          break;
        }
        case 'break': {
          const mat = MATERIALS[view.fighters[e.f].material];
          let cx = 0;
          let cy = 0;
          for (const [x, y] of e.debris) {
            cx += x;
            cy += y;
          }
          cx /= e.debris.length;
          cy /= e.debris.length;
          if (e.shatter) {
            this.burst(cx, cy, 40, '#e8fbff', 'shard', 500);
            this.popups.push({ x: cx, y: cy - 40, text: '砕けた!!', color: '#bfe9ff', life: 1.3, size: 34, vy: -50 });
            sfx.shatter();
          } else {
            this.burst(cx, cy, 16, mat.color.fill, 'chip', 300);
            this.popups.push({ x: cx, y: cy - 40, text: '折れた!!', color: '#ffd2a0', life: 1.3, size: 32, vy: -50 });
            sfx.snap();
          }
          this.debris.push({
            poly: e.debris.map(([x, y]) => [x - cx, y - cy]),
            cx,
            cy,
            vx: e.vx,
            vy: e.vy,
            rot: 0,
            vr: (Math.random() - 0.5) * 12,
            life: 4,
            color: mat.color.fill,
            stroke: mat.color.stroke,
            alpha: e.shatter ? 0.5 : 1,
          });
          this.shake = Math.max(this.shake, 16);
          this.flash = 0.15;
          break;
        }
        case 'burn': {
          this.embers(e.x, e.y, 6, 140);
          this.popups.push({ x: e.x + (Math.random() - 0.5) * 30, y: e.y - 24, text: `${e.dmg}`, color: '#ff9a3c', life: 0.8, size: 16 + Math.min(10, e.dmg / 2), vy: -70 });
          if (this.t - this.burnSfxT > 0.25) {
            this.burnSfxT = this.t;
            sfx.burn();
          }
          break;
        }
        case 'bend':
          this.burst(e.x, e.y, 6, '#fff2a8', 'spark', 180);
          this.popups.push({ x: e.x, y: e.y - 30, text: '曲がった!', color: '#ffd84d', life: 0.9, size: 18 + Math.min(10, e.amount * 20), vy: -40 });
          sfx.bend();
          break;
        case 'meltcut':
          this.drop(e.x, e.y, 5);
          sfx.drip();
          break;
        case 'swing':
          sfx.swing(e.power);
          if (e.power > 0.6) {
            const f = view.fighters[e.f];
            this.burst(f.x - f.facing * 60, WORLD.groundY - 4, 6, '#c8b48a', 'dust', 120);
          }
          break;
        case 'ko':
          this.koT = 2.2;
          this.koText = e.loser === null ? 'DOUBLE K.O.' : 'K.O.!';
          this.shake = 24;
          this.flash = 0.25;
          sfx.ko();
          break;
        case 'end':
          if (e.reason === 'timeup' || e.reason === 'draw') this.koText = e.reason === 'draw' ? 'DRAW' : 'TIME UP';
          if (e.reason === 'horn') this.koText = '角が折れた!';
          if (e.reason === 'melt') this.koText = 'とけちゃった…';
          if (e.reason === 'forfeit') this.koText = '不戦勝';
          this.koT = Math.max(this.koT, 2.2);
          break;
      }
    }
  }

  private burst(x: number, y: number, n: number, color: string, kind: Particle['kind'], speed: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.7);
      const max = kind === 'dust' ? 0.6 : 0.5 + Math.random() * 0.5;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - (kind === 'shard' || kind === 'chip' ? 200 : 0),
        life: max,
        max,
        size: kind === 'spark' ? 2 + Math.random() * 3 : kind === 'star' ? 8 : 3 + Math.random() * 4,
        color,
        kind,
        rot: Math.random() * 6,
      });
    }
    if (this.particles.length > 600) this.particles.splice(0, this.particles.length - 600);
  }

  private embers(x: number, y: number, n: number, speed: number) {
    for (let i = 0; i < n; i++) {
      const max = 0.5 + Math.random() * 0.5;
      this.particles.push({
        x: x + (Math.random() - 0.5) * 10,
        y: y + (Math.random() - 0.5) * 10,
        vx: (Math.random() - 0.5) * speed,
        vy: -Math.random() * speed,
        life: max,
        max,
        size: 2 + Math.random() * 3,
        color: Math.random() < 0.5 ? '#ffd24d' : '#ff7a1a',
        kind: 'ember',
        rot: 0,
      });
    }
    if (this.particles.length > 600) this.particles.splice(0, this.particles.length - 600);
  }

  private drop(x: number, y: number, n = 1) {
    for (let i = 0; i < n; i++)
      this.particles.push({ x: x + (Math.random() - 0.5) * 8, y, vx: (Math.random() - 0.5) * 40, vy: 0, life: 2, max: 2, size: 3 + Math.random() * 2, color: '#8e5a70', kind: 'drop', rot: 0 });
  }

  update(dt: number, view: MatchView) {
    this.t += dt;
    this.shake = Math.max(0, this.shake - dt * 40);
    this.flash = Math.max(0, this.flash - dt);
    this.koT = Math.max(0, this.koT - dt);
    // あずきアイスのしずく（溶け具合に応じて増える）
    for (const f of view.fighters) {
      if (f.material !== 'azuki' || f.destroyed || view.state !== 'fight') continue;
      this.dripT[f.idx] -= dt * (0.6 + f.melt * 3);
      if (this.dripT[f.idx] <= 0) {
        this.dripT[f.idx] = 0.25 + Math.random() * 0.5;
        const n = f.nodesX.length;
        const k = 2 + Math.floor(Math.random() * Math.max(1, n - 2));
        this.drop(f.nodesX[Math.min(n - 1, k)], f.nodesY[Math.min(n - 1, k)] + 4);
      }
    }
    // 炎の角の火の粉 / 燃えている牛の炎
    for (const f of view.fighters) {
      if (f.material === 'fire' && !f.destroyed) {
        this.emberT[f.idx] -= dt;
        if (this.emberT[f.idx] <= 0) {
          this.emberT[f.idx] = 0.05 + Math.random() * 0.06;
          const n = f.nodesX.length;
          const k = 1 + Math.floor(Math.random() * Math.max(1, n - 1));
          this.embers(f.nodesX[Math.min(n - 1, k)], f.nodesY[Math.min(n - 1, k)], 1, 60);
        }
      }
      if (f.burn > 0 && view.state !== 'over') {
        this.burnT[f.idx] -= dt;
        if (this.burnT[f.idx] <= 0) {
          this.burnT[f.idx] = 0.04;
          this.embers(f.x + (Math.random() - 0.5) * 120, WORLD.groundY - 70 - Math.random() * 60, 1, 90);
        }
      }
    }
    // カウントダウン音
    if (view.state === 'countdown') {
      const c = Math.ceil(view.countdown);
      if (c !== this.lastCount && c > 0) {
        this.lastCount = c;
        sfx.countdown(false);
      }
    }
    // チャージ音（自分のみ）
    for (const f of view.fighters) {
      if (f.idx !== this.you) continue;
      if (f.phase === 'charge') {
        const lv = Math.floor(f.charge * 5);
        if (lv !== this.chargeTick[f.idx]) {
          this.chargeTick[f.idx] = lv;
          sfx.charge(f.charge);
        }
      } else this.chargeTick[f.idx] = -1;
    }
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === 'ember') {
        p.vy -= 260 * dt;
        p.vx *= 1 - 2 * dt;
        p.size *= 1 - 0.8 * dt;
      } else if (p.kind !== 'spark' && p.kind !== 'star') p.vy += 1200 * dt;
      else {
        p.vx *= 1 - 4 * dt;
        p.vy *= 1 - 4 * dt;
      }
      if (p.kind === 'dust') {
        p.vy -= 1300 * dt;
        p.size += dt * 20;
      }
      p.rot += dt * 8;
      if (p.y > WORLD.groundY && p.kind !== 'dust' && p.kind !== 'ember') {
        p.y = WORLD.groundY;
        if (p.kind === 'drop') {
          this.addPuddle(p.x, p.size);
          p.life = 0;
        } else {
          p.vy *= -0.3;
          p.vx *= 0.6;
        }
      }
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const p of this.popups) {
      p.life -= dt;
      p.y += p.vy * dt;
      p.vy *= 1 - 2 * dt;
    }
    this.popups = this.popups.filter((p) => p.life > 0);
    for (const d of this.debris) {
      d.life -= dt;
      d.vy += 1400 * dt;
      d.cx += d.vx * dt;
      d.cy += d.vy * dt;
      d.rot += d.vr * dt;
      if (d.cy > WORLD.groundY - 8) {
        d.cy = WORLD.groundY - 8;
        d.vy *= -0.35;
        d.vx *= 0.7;
        d.vr *= 0.6;
      }
    }
    this.debris = this.debris.filter((d) => d.life > 0);
  }

  private addPuddle(x: number, r: number) {
    for (const p of this.puddles) {
      if (Math.abs(p.x - x) < p.r + 6) {
        p.r = Math.min(70, p.r + r * 0.25);
        return;
      }
    }
    if (this.puddles.length < 30) this.puddles.push({ x, r: r * 1.5 });
  }

  /** world 座標で描画（呼び出し側でスケール済み） */
  draw(ctx: CanvasRenderingContext2D, view: MatchView, extraW: number) {
    const sx = (Math.random() - 0.5) * this.shake;
    const sy = (Math.random() - 0.5) * this.shake;
    ctx.save();
    ctx.translate(sx, sy);
    drawBackground(ctx, this.t, extraW);
    // 水たまり
    for (const p of this.puddles) {
      ctx.fillStyle = 'rgba(120,70,95,0.45)';
      ctx.beginPath();
      ctx.ellipse(p.x, WORLD.groundY + 3, p.r, Math.max(2, p.r * 0.16), 0, 0, Math.PI * 2);
      ctx.fill();
    }
    const ko = view.state === 'ko' || view.state === 'over';
    for (const f of view.fighters) drawCowBody(ctx, f, this.t, TEAM_COLORS[f.idx]);
    for (const f of view.fighters) {
      if (!f.destroyed && f.nodesX.length >= 2)
        drawHorn(ctx, {
          model: f.model,
          nodesX: f.nodesX,
          nodesY: f.nodesY,
          facing: f.facing,
          widthScale: f.widthScale,
          material: f.material,
          stress: f.stress,
          crackLevel: f.crackLevel,
          cracks: f.cracks,
          melt: f.melt,
          time: this.t,
          flash: f.flash,
        });
      drawCowHead(ctx, f, this.t, ko && f.hp <= 0);
    }
    for (const d of this.debris) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, d.life) * d.alpha;
      ctx.translate(d.cx, d.cy);
      ctx.rotate(d.rot);
      ctx.beginPath();
      d.poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fillStyle = d.color;
      ctx.fill();
      ctx.strokeStyle = d.stroke;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }
    for (const p of this.particles) {
      const a = Math.max(0, p.life / p.max);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      if (p.kind === 'spark') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
        ctx.stroke();
      } else if (p.kind === 'star') {
        star(ctx, p.x, p.y, p.size * (1 + (1 - a)), p.rot);
      } else if (p.kind === 'shard') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.beginPath();
        ctx.moveTo(0, -p.size);
        ctx.lineTo(p.size * 0.6, p.size);
        ctx.lineTo(-p.size * 0.6, p.size * 0.4);
        ctx.closePath();
        ctx.globalAlpha = a * 0.8;
        ctx.fill();
        ctx.strokeStyle = 'rgba(120,190,220,0.9)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
      } else if (p.kind === 'ember') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = a * 0.25;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
      } else if (p.kind === 'dust') {
        ctx.globalAlpha = a * 0.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        if (p.kind === 'drop') ctx.ellipse(p.x, p.y, p.size * 0.7, p.size, 0, 0, Math.PI * 2);
        else ctx.rect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    for (const p of this.popups) {
      ctx.globalAlpha = Math.min(1, p.life * 2);
      ctx.font = `900 ${p.size}px "M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = Math.max(3, p.size / 7);
      ctx.strokeStyle = 'rgba(20,20,30,0.9)';
      ctx.strokeText(p.text, p.x, p.y);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${this.flash * 2.5})`;
      ctx.fillRect(-extraW, 0, WORLD.width + extraW * 2, WORLD.height);
    }
  }

  drawHud(ctx: CanvasRenderingContext2D, view: MatchView, opts: { you: number | null; labels: [string, string]; localCharge?: number }) {
    const W = WORLD.width;
    for (const f of view.fighters) {
      const left = f.idx === 0;
      const bw = 440;
      const x = left ? 30 : W - 30 - bw;
      const y = 22;
      const mat = MATERIALS[f.material];
      ctx.fillStyle = 'rgba(15,20,18,0.7)';
      roundRect(ctx, x - 8, y - 8, bw + 16, 70, 14);
      ctx.fill();
      // HP
      ctx.fillStyle = '#2c2c2c';
      roundRect(ctx, x, y + 22, bw, 22, 8);
      ctx.fill();
      const lostMax = Math.max(0, 1 - f.maxHp / f.baseMaxHp);
      const r = Math.max(0, f.hp / f.baseMaxHp);
      const col = r > 0.5 ? '#5bd66b' : r > 0.25 ? '#f2c14e' : '#ef5350';
      ctx.fillStyle = col;
      const w = bw * r;
      roundRect(ctx, left ? x : x + bw - w, y + 22, Math.max(4, w), 22, 8);
      ctx.fill();
      if (lostMax > 0) {
        // 溶けて失った最大HP
        ctx.fillStyle = 'rgba(142,90,112,0.75)';
        const lw = bw * lostMax;
        ctx.fillRect(left ? x + bw - lw : x, y + 22, lw, 22);
      }
      ctx.fillStyle = '#fff';
      ctx.font = '700 15px system-ui, sans-serif';
      ctx.textAlign = left ? 'left' : 'right';
      const you = opts.you === f.idx ? '  (YOU)' : '';
      ctx.fillText(`${opts.labels[f.idx]}${you}`, left ? x : x + bw, y + 12);
      ctx.textAlign = left ? 'right' : 'left';
      ctx.fillStyle = mat.color.accent === '#ffffff' ? '#bfe9ff' : mat.color.fill;
      ctx.fillText(mat.name, left ? x + bw : x, y + 12);
      ctx.fillStyle = '#fff';
      ctx.font = '800 14px system-ui, sans-serif';
      ctx.textAlign = left ? 'left' : 'right';
      ctx.fillText(`${Math.ceil(f.hp)} / ${f.maxHp}`, left ? x + 8 : x + bw - 8, y + 38);
      // 融解ゲージ
      if (f.material === 'azuki') {
        const mw = 200;
        const mx = left ? x : x + bw - mw;
        ctx.fillStyle = '#123';
        ctx.fillRect(mx, y + 50, mw, 6);
        const tg = ctx.createLinearGradient(mx, 0, mx + mw, 0);
        tg.addColorStop(0, '#7fd3ff');
        tg.addColorStop(1, '#ff6a3d');
        ctx.fillStyle = tg;
        ctx.fillRect(mx, y + 50, mw * (1 - f.melt), 6);
        ctx.font = '700 11px system-ui, sans-serif';
        ctx.fillStyle = '#cfe8ff';
        ctx.textAlign = left ? 'left' : 'right';
        const temp = (-18 + f.melt * 18).toFixed(1);
        ctx.fillText(`${temp}℃  ${f.melt > 0.75 ? 'もう限界…' : f.melt > 0.4 ? 'とけてきた' : 'カチカチ'}`, left ? mx + mw + 8 : mx - 8, y + 57);
      }
      if (f.burn > 0) {
        ctx.font = '800 13px system-ui, sans-serif';
        ctx.fillStyle = '#ffb04d';
        ctx.textAlign = left ? 'right' : 'left';
        ctx.fillText('🔥 炎上中！', left ? x + bw : x, y + 60);
      }
      if (f.crackLevel > 0 && (f.material === 'glass' || f.material === 'wood' || f.material === 'coral')) {
        ctx.font = '700 12px system-ui, sans-serif';
        ctx.fillStyle = '#ffd0d0';
        ctx.textAlign = left ? 'left' : 'right';
        ctx.fillText('ヒビあり：耐久低下', left ? x + 230 : x + bw - 230, y + 12);
      }
    }
    // タイマー
    ctx.fillStyle = 'rgba(15,20,18,0.8)';
    roundRect(ctx, W / 2 - 46, 14, 92, 54, 14);
    ctx.fill();
    ctx.fillStyle = view.timeLeft < 10 ? '#ff6b6b' : '#fff';
    ctx.font = '900 34px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${Math.ceil(view.timeLeft)}`, W / 2, 54);

    // チャージゲージ
    for (const f of view.fighters) {
      const c = f.idx === opts.you && opts.localCharge !== undefined ? opts.localCharge : f.phase === 'charge' ? f.charge : 0;
      if (c <= 0) continue;
      const gx = f.x - 50;
      const gy = WORLD.groundY + 22;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      roundRect(ctx, gx, gy, 100, 14, 7);
      ctx.fill();
      const gg = ctx.createLinearGradient(gx, 0, gx + 100, 0);
      gg.addColorStop(0, '#ffe066');
      gg.addColorStop(1, '#ff4d4d');
      ctx.fillStyle = gg;
      roundRect(ctx, gx + 2, gy + 2, 96 * c, 10, 5);
      ctx.fill();
      if (c >= 1) {
        ctx.font = '900 14px system-ui, sans-serif';
        ctx.fillStyle = '#ffec99';
        ctx.textAlign = 'center';
        ctx.fillText('MAX!', f.x, gy + 32);
      }
    }
    if (opts.you !== null) {
      const f = view.fighters[opts.you];
      const ax = f.x;
      const ay = WORLD.groundY - 290 + Math.sin(this.t * 4) * 5;
      ctx.fillStyle = TEAM_COLORS[f.idx];
      ctx.beginPath();
      ctx.moveTo(ax - 10, ay);
      ctx.lineTo(ax + 10, ay);
      ctx.lineTo(ax, ay + 12);
      ctx.closePath();
      ctx.fill();
      ctx.font = '900 14px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('YOU', ax, ay - 4);
    }
    // カウントダウン
    if (view.state === 'countdown') {
      const c = Math.ceil(view.countdown);
      const frac = view.countdown - Math.floor(view.countdown);
      ctx.save();
      ctx.translate(W / 2, 260);
      ctx.scale(1 + frac * 0.6, 1 + frac * 0.6);
      ctx.font = '900 120px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 10;
      ctx.strokeStyle = '#1a1a1a';
      ctx.strokeText(`${c}`, 0, 40);
      ctx.fillStyle = '#ffd34d';
      ctx.fillText(`${c}`, 0, 40);
      ctx.restore();
    }
    if (this.koT > 0 && this.koText) {
      ctx.save();
      const s = 1 + Math.max(0, this.koT - 1.8) * 2;
      ctx.translate(W / 2, 270);
      ctx.scale(s, s);
      ctx.rotate(-0.06);
      ctx.font = '900 110px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.lineWidth = 12;
      ctx.strokeStyle = '#1a1a1a';
      ctx.strokeText(this.koText, 0, 30);
      ctx.fillStyle = '#ff4d4d';
      ctx.fillText(this.koText, 0, 30);
      ctx.restore();
    }
  }
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = rot + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.closePath();
  ctx.fill();
}

let bgCache: { canvas: HTMLCanvasElement; extra: number } | null = null;

export function drawBackground(ctx: CanvasRenderingContext2D, t: number, extraW: number) {
  const W = WORLD.width;
  const H = WORLD.height;
  const ex = Number.isFinite(extraW) ? Math.max(0, Math.ceil(extraW)) : 0;
  if (!bgCache || bgCache.extra !== ex) {
    const c = document.createElement('canvas');
    c.width = W + ex * 2;
    c.height = H;
    const g = c.getContext('2d')!;
    g.translate(ex, 0);
    const sky = g.createLinearGradient(0, 0, 0, WORLD.groundY);
    sky.addColorStop(0, '#79c3ff');
    sky.addColorStop(0.7, '#cfeeff');
    sky.addColorStop(1, '#fff6d8');
    g.fillStyle = sky;
    g.fillRect(-ex, 0, W + ex * 2, WORLD.groundY);
    g.fillStyle = '#fff3b0';
    g.beginPath();
    g.arc(W - 170, 140, 52, 0, Math.PI * 2);
    g.fill();
    // 遠くの丘
    g.fillStyle = '#9bd18a';
    g.beginPath();
    g.moveTo(-ex, 470);
    for (let x = -ex; x <= W + ex; x += 20) g.lineTo(x, 455 - Math.sin(x / 140) * 35 - Math.sin(x / 57) * 10);
    g.lineTo(W + ex, WORLD.groundY);
    g.lineTo(-ex, WORLD.groundY);
    g.fill();
    g.fillStyle = '#7fc06e';
    g.beginPath();
    g.moveTo(-ex, 520);
    for (let x = -ex; x <= W + ex; x += 20) g.lineTo(x, 510 - Math.sin(x / 90 + 1) * 22);
    g.lineTo(W + ex, WORLD.groundY);
    g.lineTo(-ex, WORLD.groundY);
    g.fill();
    // 柵
    g.strokeStyle = '#8a6136';
    g.lineWidth = 6;
    for (let x = -ex + 20; x < W + ex; x += 90) {
      g.beginPath();
      g.moveTo(x, WORLD.groundY - 10);
      g.lineTo(x, WORLD.groundY - 80);
      g.stroke();
    }
    g.lineWidth = 5;
    for (const y of [WORLD.groundY - 66, WORLD.groundY - 36]) {
      g.beginPath();
      g.moveTo(-ex, y);
      g.lineTo(W + ex, y);
      g.stroke();
    }
    // 地面
    const gr = g.createLinearGradient(0, WORLD.groundY, 0, H);
    gr.addColorStop(0, '#5aa64a');
    gr.addColorStop(1, '#3a7a33');
    g.fillStyle = gr;
    g.fillRect(-ex, WORLD.groundY, W + ex * 2, H - WORLD.groundY);
    g.fillStyle = '#6cc05a';
    for (let x = -ex; x < W + ex; x += 7) {
      g.fillRect(x, WORLD.groundY - 3 + (Math.sin(x * 1.7) * 2), 3, 6);
    }
    bgCache = { canvas: c, extra: ex };
  }
  ctx.drawImage(bgCache.canvas, -ex, 0);
  // 雲
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  for (let i = 0; i < 4; i++) {
    const x = ((t * (8 + i * 3) + i * 360) % (W + 400)) - 200;
    const y = 90 + i * 45;
    ctx.beginPath();
    ctx.ellipse(x, y, 60, 18, 0, 0, Math.PI * 2);
    ctx.ellipse(x + 40, y - 10, 40, 20, 0, 0, Math.PI * 2);
    ctx.ellipse(x - 35, y - 4, 32, 14, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

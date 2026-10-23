/**
 * 1対1の試合シミュレーション（CPU戦ではクライアント、オンライン戦ではサーバーが実行）
 * 固定タイムステップ。高速時は速度に応じてサブステップ数を増やし、すり抜けを防止する。
 */
import { DAMAGE, HORN, MATCH, MELT, SIM_DT, MAX_STEPS_PER_UPDATE, WORLD, COW } from '../config/game';
import { MaterialId } from '../config/materials';
import { Poly, Pt, convexHullFlat } from '../geometry/polygon';
import { Binding, buildHornModel } from '../horn/model';
import { aabbOverlap, sat } from '../physics/collision';
import { HornBody } from '../physics/hornBody';
import { computeBodyHit, computeClash, selfStressFromRecoil } from './damage';
import { Fighter, FighterInput, PHASES } from './fighter';

export type MatchState = 'countdown' | 'fight' | 'ko' | 'over';
export type EndReason = 'ko' | 'horn' | 'melt' | 'timeup' | 'draw' | 'forfeit' | 'double';

export interface MatchResult {
  winner: 0 | 1 | null;
  reason: EndReason;
  time: number;
}

export type MatchEvent =
  | { type: 'start' }
  | { type: 'hit'; a: number; x: number; y: number; dmg: number; recoil: number; whip: boolean; head: boolean; speed: number; guard: boolean; block?: boolean }
  | { type: 'clash'; x: number; y: number; power: number }
  | { type: 'crack'; f: number; x: number; y: number; level: number }
  | { type: 'break'; f: number; debris: Poly; vx: number; vy: number; shatter: boolean }
  | { type: 'chip'; f: number; x: number; y: number }
  | { type: 'meltcut'; f: number; x: number; y: number }
  | { type: 'swing'; f: number; power: number }
  | { type: 'ko'; loser: number | null }
  | { type: 'end'; winner: number | null; reason: EndReason };

export interface HornSetup {
  polygon: Poly;
  material: MaterialId;
  name?: string;
}

interface Candidate {
  closing: number;
  relSpeed: number;
  flex: number;
  x: number;
  y: number;
  nx: number;
  ny: number;
  b: Binding;
  b2?: Binding;
  localMass: number;
  localMass2?: number;
  head: boolean;
  /** 角同士: 各自の角が相手へ向かう速さ・しなり速度 */
  own?: [number, number];
  flex2?: [number, number];
}

interface Episode {
  last: number;
  start: number;
  dmg: number;
  recoil: number;
}

const BODY_SHARE = 0.12;

export class Match {
  fighters: [Fighter, Fighter];
  state: MatchState = 'countdown';
  countdown: number = MATCH.countdown;
  time = 0;
  tick = 0;
  timeLimit: number = MATCH.duration;
  result: MatchResult | null = null;
  events: MatchEvent[] = [];
  timeScale = 1;
  private slowTimer = 0;
  private koTimer = 0;
  private acc = 0;
  private episodes = new Map<string, Episode>();
  private cands = new Map<string, Candidate>();
  private hulls: number[][][] = [[], []];
  private hullScratch: number[] = [];
  /** 角の形状が変わるたびに増える（オンライン同期用） */
  hornRev: [number, number] = [0, 0];
  private chipCooldown = [0, 0];
  paused = false;

  constructor(a: HornSetup, b: HornSetup, opts: { countdown?: number; timeLimit?: number } = {}) {
    const ma = buildHornModel(a.polygon);
    const mb = buildHornModel(b.polygon);
    this.fighters = [new Fighter(0, ma, a.material, 380), new Fighter(1, mb, b.material, WORLD.width - 380)];
    this.fighters[0].name = a.name ?? 'P1';
    this.fighters[1].name = b.name ?? 'P2';
    if (opts.countdown !== undefined) this.countdown = opts.countdown;
    if (opts.timeLimit !== undefined) this.timeLimit = opts.timeLimit;
    if (this.countdown <= 0) {
      this.state = 'fight';
      this.events.push({ type: 'start' });
    }
  }

  setInput(i: number, input: FighterInput) {
    const f = this.fighters[i];
    if (f) f.input = { charge: !!input.charge, move: input.move === 1 ? 1 : input.move === -1 ? -1 : 0 };
  }

  get timeRemaining() {
    return Math.max(0, this.timeLimit - this.time);
  }

  /** 実時間を渡す。内部で固定ステップに分割（スローモーション込み） */
  update(realDt: number) {
    if (this.paused || this.state === 'over') return;
    realDt = Math.min(realDt, 0.1);
    if (this.slowTimer > 0) {
      this.slowTimer -= realDt;
      if (this.slowTimer <= 0 && this.state !== 'ko') this.timeScale = 1;
    }
    if (this.state === 'ko') {
      this.koTimer -= realDt;
      if (this.koTimer <= 0) {
        this.state = 'over';
        this.timeScale = 1;
        return;
      }
    }
    this.acc += realDt * this.timeScale;
    let steps = 0;
    while (this.acc >= SIM_DT && steps < MAX_STEPS_PER_UPDATE) {
      this.step();
      this.acc -= SIM_DT;
      steps++;
    }
    if (steps >= MAX_STEPS_PER_UPDATE) this.acc = 0;
  }

  drainEvents(): MatchEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  step() {
    const dt = SIM_DT;
    this.tick++;
    const active = this.state === 'fight';
    if (this.state === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.state = 'fight';
        this.events.push({ type: 'start' });
      }
    }
    for (const f of this.fighters) {
      const prevPhase = f.phase;
      f.updateControl(dt, active);
      if (prevPhase === 'charge' && f.phase === 'swing') this.events.push({ type: 'swing', f: f.idx, power: f.swingCharge });
    }
    // サブステップ数：最大節点速度から決める（細い角でもすり抜けない移動量に抑える）
    let maxSpeed = 0;
    for (const f of this.fighters) {
      const h = f.horn;
      for (let i = 0; i < h.n; i++) {
        const v = Math.hypot(h.x[i] - h.px[i], h.y[i] - h.py[i]) / h.lastDt;
        if (v > maxSpeed) maxSpeed = v;
      }
      maxSpeed = Math.max(maxSpeed, Math.abs(f.omega) * (h.length + 60) + Math.abs(f.vx));
    }
    const sub = Math.max(2, Math.min(10, Math.ceil((maxSpeed * dt) / (HORN.minHalfWidth * 1.1))));
    const h = dt / sub;
    this.cands.clear();
    for (let s = 0; s < sub; s++) {
      for (const f of this.fighters) f.integrate(h);
      this.separateBodies();
      for (const f of this.fighters) {
        f.updateShapes();
        f.horn.step(h, f.frame());
        f.horn.skin();
      }
      this.collide();
      for (const f of this.fighters) f.horn.skin();
    }
    if (this.state === 'fight') this.resolveContacts();
    for (const f of this.fighters) this.updateMelt(f, dt);
    this.chipCooldown[0] = Math.max(0, this.chipCooldown[0] - dt);
    this.chipCooldown[1] = Math.max(0, this.chipCooldown[1] - dt);
    if (this.state === 'fight') {
      this.time += dt;
      this.checkEnd();
    }
  }

  private separateBodies() {
    const [a, b] = this.fighters;
    const d = b.x - a.x;
    const min = COW.minSeparation;
    if (Math.abs(d) < min) {
      const push = (min - Math.abs(d)) / 2;
      const s = d >= 0 ? 1 : -1;
      this.shift(a, -push * s);
      this.shift(b, push * s);
      const rel = (b.vx - a.vx) * s;
      if (rel < 0) {
        const avg = (a.vx + b.vx) / 2;
        a.vx = avg;
        b.vx = avg;
      }
    }
  }

  private pieceHulls(horn: HornBody, out: number[][]) {
    const pieces = horn.model.pieces;
    out.length = pieces.length;
    for (let p = 0; p < pieces.length; p++) {
      const ids = pieces[p];
      const pts = this.hullScratch;
      pts.length = 0;
      for (const v of ids) pts.push(horn.vertX[v], horn.vertY[v]);
      out[p] = convexHullFlat(pts, out[p] ?? []);
    }
  }

  private deepestPieceVertex(horn: HornBody, piece: number[], nx: number, ny: number): number {
    let best = piece[0];
    let bd = Infinity;
    for (const v of piece) {
      const d = horn.vertX[v] * nx + horn.vertY[v] * ny;
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    return best;
  }

  private candidate(key: string, c: Candidate) {
    const prev = this.cands.get(key);
    if (!prev || c.closing > prev.closing) this.cands.set(key, c);
  }

  private collide() {
    const F = this.fighters;
    for (let i = 0; i < 2; i++) {
      if (F[i].horn.destroyed) {
        this.hulls[i].length = 0;
        continue;
      }
      this.pieceHulls(F[i].horn, this.hulls[i]);
    }
    // 角 vs 相手の体・頭
    for (let i = 0; i < 2; i++) {
      const att = F[i];
      const tgt = F[1 - i];
      const horn = att.horn;
      if (horn.destroyed) continue;
      const pieces = horn.model.pieces;
      for (const [poly, head] of [
        [tgt.headPoly, true],
        [tgt.bodyPoly, false],
      ] as [number[], boolean][]) {
        for (let p = 0; p < pieces.length; p++) {
          const hull = this.hulls[i][p];
          if (!hull || !aabbOverlap(hull, poly)) continue;
          const m = sat(hull, poly);
          if (!m) continue;
          const vi = this.deepestPieceVertex(horn, pieces[p], m.nx, m.ny);
          const b = horn.model.bindings[vi];
          const vx = horn.vertX[vi];
          const vy = horn.vertY[vi];
          const vh = horn.velocityAt(b);
          let tvx = tgt.vx;
          let tvy = 0;
          if (head) {
            const rx = (vx - tgt.pivotX) * tgt.facing;
            const ry = vy - tgt.pivotY;
            tvx += tgt.facing * tgt.omega * -ry;
            tvy += tgt.omega * rx;
          }
          const rvx = vh[0] - tvx;
          const rvy = vh[1] - tvy;
          // 攻撃力は「角を振った速さ」が主。相手が自分から突っ込んできた分は一部だけ加算する
          const closing = -(vh[0] * m.nx + vh[1] * m.ny) + 0.35 * (tvx * m.nx + tvy * m.ny);
          const rig = horn.rigidVelocity(vx, vy, att.frame());
          const flex = Math.hypot(vh[0] - rig[0], vh[1] - rig[1]);
          this.candidate(`h${i}${head ? 'H' : 'B'}`, {
            closing,
            relSpeed: Math.hypot(rvx, rvy),
            flex,
            x: vx,
            y: vy,
            nx: m.nx,
            ny: m.ny,
            b,
            localMass: horn.localMass(b),
            head,
          });
          // 位置補正：柔らかい角は変形で、硬い角は頭の回転と体の押し合いで受け止める
          const depth = Math.min(m.depth, 30);
          const cpl = horn.mat.coupling;
          const dDef = depth * (1 - BODY_SHARE) * (1 - cpl);
          const dRig = depth * (1 - BODY_SHARE) * cpl;
          if (dRig > 0) this.rigidPush(att, vx, vy, m.nx * dRig * 0.7, m.ny * dRig * 0.7, closing > 0 ? cpl : 0);
          this.shift(att, m.nx * dRig * 0.3);
          const ok = horn.applyCorrection(b, m.nx * dDef, m.ny * dDef, 1);
          if (ok) {
            this.shift(tgt, -m.nx * depth * BODY_SHARE);
            // 接近速度を消す（非弾性寄り、弾性に応じて少し跳ね返る）
            if (closing > 0) {
              const e = 0.15 + horn.mat.elasticity * 0.35;
              horn.addVelocity(b, m.nx * closing * (1 + e) * 0.8, m.ny * closing * (1 + e) * 0.8);
            }
          } else {
            this.shift(att, m.nx * depth * 0.5);
            this.shift(tgt, -m.nx * depth * 0.5);
          }
        }
      }
    }
    // 角 vs 角
    const A = F[0].horn;
    const B = F[1].horn;
    if (!A.destroyed && !B.destroyed) {
      for (let p = 0; p < A.model.pieces.length; p++) {
        const ha = this.hulls[0][p];
        for (let q = 0; q < B.model.pieces.length; q++) {
          const hb = this.hulls[1][q];
          if (!ha || !hb || !aabbOverlap(ha, hb)) continue;
          const m = sat(ha, hb);
          if (!m) continue;
          const va = this.deepestPieceVertex(A, A.model.pieces[p], m.nx, m.ny);
          const vb = this.deepestPieceVertex(B, B.model.pieces[q], -m.nx, -m.ny);
          const ba = A.model.bindings[va];
          const bb = B.model.bindings[vb];
          const vA = A.velocityAt(ba);
          const vB = B.velocityAt(bb);
          const rvx = vA[0] - vB[0];
          const rvy = vA[1] - vB[1];
          const closing = -(rvx * m.nx + rvy * m.ny);
          const rA = A.rigidVelocity(A.vertX[va], A.vertY[va], F[0].frame());
          const rB = B.rigidVelocity(B.vertX[vb], B.vertY[vb], F[1].frame());
          this.candidate('hh', {
            closing,
            relSpeed: Math.hypot(rvx, rvy),
            flex: 0,
            own: [-(vA[0] * m.nx + vA[1] * m.ny), vB[0] * m.nx + vB[1] * m.ny],
            flex2: [Math.hypot(vA[0] - rA[0], vA[1] - rA[1]), Math.hypot(vB[0] - rB[0], vB[1] - rB[1])],
            x: (A.vertX[va] + B.vertX[vb]) / 2,
            y: (A.vertY[va] + B.vertY[vb]) / 2,
            nx: m.nx,
            ny: m.ny,
            b: ba,
            b2: bb,
            localMass: A.localMass(ba),
            localMass2: B.localMass(bb),
            head: false,
          });
          const mA = A.localMass(ba);
          const mB = B.localMass(bb);
          const depth = Math.min(m.depth, 30);
          const sA = mB / (mA + mB);
          const cA = A.mat.coupling;
          const cB = B.mat.coupling;
          const dA = depth * sA;
          const dB = depth * (1 - sA);
          this.rigidPush(F[0], A.vertX[va], A.vertY[va], m.nx * dA * cA * 0.7, m.ny * dA * cA * 0.7, closing > 0 ? cA * 0.5 : 0);
          this.rigidPush(F[1], B.vertX[vb], B.vertY[vb], -m.nx * dB * cB * 0.7, -m.ny * dB * cB * 0.7, closing > 0 ? cB * 0.5 : 0);
          this.shift(F[0], m.nx * (dA * cA + dB * cB) * 0.15);
          this.shift(F[1], -m.nx * (dA * cA + dB * cB) * 0.15);
          const okA = A.applyCorrection(ba, m.nx * dA * (1 - cA), m.ny * dA * (1 - cA), 1);
          const okB = B.applyCorrection(bb, -m.nx * dB * (1 - cB), -m.ny * dB * (1 - cB), 1);
          if (!okA && !okB) {
            this.shift(F[0], m.nx * depth * 0.5);
            this.shift(F[1], -m.nx * depth * 0.5);
          }
          // 摩擦（フックが引っ掛かる）：接線方向の相対速度を減らす
          const tx = -m.ny;
          const ty = m.nx;
          const vt = rvx * tx + rvy * ty;
          const fr = 0.35;
          A.addVelocity(ba, -tx * vt * fr * sA, -ty * vt * fr * sA);
          B.addVelocity(bb, tx * vt * fr * (1 - sA), ty * vt * fr * (1 - sA));
          if (closing > 0) {
            const e = 0.2 + (A.mat.elasticity + B.mat.elasticity) * 0.2;
            A.addVelocity(ba, m.nx * closing * (1 + e) * sA * 0.8, m.ny * closing * (1 + e) * sA * 0.8);
            B.addVelocity(bb, -m.nx * closing * (1 + e) * (1 - sA) * 0.8, -m.ny * closing * (1 + e) * (1 - sA) * 0.8);
            // 頭への反作用トルク
            const J = closing * (mA * mB) / (mA + mB) * 0.02;
            this.torqueFromContact(F[0], A.vertX[va], A.vertY[va], m.nx * J, m.ny * J);
            this.torqueFromContact(F[1], B.vertX[vb], B.vertY[vb], -m.nx * J, -m.ny * J);
          }
        }
      }
    }
    // 頭 vs 頭・相手の体（めり込まないよう体ごと押し戻す）
    for (const [pa, pb] of [
      [F[0].headPoly, F[1].headPoly],
      [F[0].headPoly, F[1].bodyPoly],
      [F[0].bodyPoly, F[1].headPoly],
    ] as [number[], number[]][]) {
      if (!aabbOverlap(pa, pb)) continue;
      const m = sat(pa, pb);
      if (!m) continue;
      const dir = F[0].x < F[1].x ? 1 : -1;
      const push = Math.min(m.depth, 20) * 0.5;
      this.shift(F[0], -push * dir);
      this.shift(F[1], push * dir);
      F[0].updateShapes();
      F[1].updateShapes();
    }
    // 角 vs 地面
    for (const f of F) {
      const horn = f.horn;
      if (horn.destroyed) continue;
      for (let v = 0; v < horn.vertY.length; v++) {
        const pen = horn.vertY[v] - WORLD.groundY;
        if (pen > 0) {
          const b = horn.model.bindings[v];
          horn.applyCorrection(b, 0, -Math.min(pen, 20), 1);
          // 下向き速度を消し、地面との摩擦
          const vel = horn.velocityAt(b);
          horn.addVelocity(b, -vel[0] * 0.25, vel[1] > 0 ? -vel[1] : 0);
        }
      }
    }
  }

  /** 硬い角の接触：頭を回転させて接触点を (dx,dy) だけ動かす（位置レベル） */
  private rigidPush(f: Fighter, px: number, py: number, dx: number, dy: number, brake: number) {
    const rx = px - f.pivotX;
    const ry = py - f.pivotY;
    const r2 = rx * rx + ry * ry;
    if (r2 < 1) return;
    const dth = (rx * dy - ry * dx) / r2;
    f.theta += f.facing * dth;
    f.horn.rotateAbout(f.pivotX, f.pivotY, dth);
    if (brake > 0 && Math.sign(f.omega) === -Math.sign(f.facing * dth)) f.omega *= 1 - 0.35 * brake;
  }

  /** 体を位置レベルで押す（角も一緒に剛体移動させ、見かけの速度を生まない） */
  private shift(f: Fighter, dx: number) {
    if (!dx) return;
    f.x += dx;
    f.horn.translate(dx, 0);
  }

  private torqueFromContact(f: Fighter, x: number, y: number, jx: number, jy: number) {
    const rx = x - f.pivotX;
    const ry = y - f.pivotY;
    f.applyAngularImpulse(rx * jy - ry * jx);
  }

  /**
   * 接触エピソード単位でダメージを確定する。
   * 同じ接触が続いている間は追加計上しないが、接触中にさらに強く当たった（しなりで先端が後から加速した等）
   * 場合は「差分」だけを加算する。これで一度の接触による重複計上を防ぎつつ、最も強い瞬間を評価できる。
   */
  private resolveContacts() {
    const now = this.tick * SIM_DT;
    for (let i = 0; i < 2; i++) {
      const ch = this.cands.get(`h${i}H`);
      const cb = this.cands.get(`h${i}B`);
      const c = ch && (!cb || ch.closing >= cb.closing * 0.8) ? ch : cb;
      if (!c) continue;
      const key = `h${i}`;
      let ep = this.episodes.get(key);
      if (!ep || now - ep.last > DAMAGE.episodeGap) {
        if (this.fighters[i].cooldown > 0) {
          if (ep) ep.last = now;
          continue;
        }
        ep = { last: now, start: now, dmg: 0, recoil: 0 };
        this.episodes.set(key, ep);
      }
      ep.last = now;
      if (now - ep.start > 0.3) continue;
      this.bodyHit(this.fighters[i], this.fighters[1 - i], c, ep);
    }
    const cc = this.cands.get('hh');
    if (cc) {
      let ep = this.episodes.get('hh');
      const isNew = !ep || now - ep.last > DAMAGE.episodeGap;
      if (isNew) ep = { last: now, start: now, dmg: 0, recoil: 0 };
      ep!.last = now;
      this.episodes.set('hh', ep!);
      if (isNew) this.clash(cc);
    }
  }

  private bodyHit(att: Fighter, tgt: Fighter, c: Candidate, ep: Episode) {
    const res = computeBodyHit({
      attacker: att.horn.mat,
      closingSpeed: c.closing,
      relSpeed: c.relSpeed,
      flexSpeed: c.flex,
      localMass: c.localMass,
      hornMass: att.horn.totalMass,
      headHit: c.head,
      targetGuarding: tgt.guard,
      targetCharging: tgt.phase === 'charge',
      attackerCracked: att.horn.crackLevel > 0,
      targetHardness: 0.3,
    });
    const dInc = res.damage - ep.dmg;
    if (res.damage <= 0 || (ep.dmg > 0 && dInc < 8)) return;
    const rInc = Math.max(0, res.recoil - ep.recoil);
    const first = ep.dmg === 0;
    ep.dmg = res.damage;
    ep.recoil = Math.max(ep.recoil, res.recoil);
    att.cooldown = DAMAGE.attackerCooldown;
    tgt.hp = Math.max(0, tgt.hp - dInc);
    att.hp = Math.max(0, att.hp - rInc);
    att.stats.dealt += dInc;
    att.stats.recoilTaken += rInc;
    if (first) att.stats.hits++;
    if (res.whip > res.direct && first) att.stats.whipHits++;
    att.stats.maxHit = Math.max(att.stats.maxHit, res.damage);
    att.stats.maxImpactSpeed = Math.max(att.stats.maxImpactSpeed, Math.round(c.closing));
    tgt.stats.taken += dInc;
    // ノックバック（n は相手→角の向き。相手は -n 方向へ押される）
    const kb = ((first ? res.impulse : res.impulse * (dInc / res.damage)) * DAMAGE.knockback) / COW.bodyMass;
    tgt.vx += -c.nx * Math.min(900, kb);
    att.vx += c.nx * Math.min(500, kb * 0.3);
    this.torqueFromContact(att, c.x, c.y, c.nx * res.impulse * 0.35, c.ny * res.impulse * 0.35);
    if (c.head) this.torqueFromContact(tgt, c.x, c.y, -c.nx * res.impulse * 0.4, -c.ny * res.impulse * 0.4);
    tgt.flinch(dInc);
    att.hitFlash = rInc > 15 ? 0.12 : att.hitFlash;
    this.events.push({
      type: 'hit',
      a: att.idx,
      x: c.x,
      y: c.y,
      dmg: dInc,
      recoil: rInc,
      whip: res.whip > res.direct && dInc >= 25,
      head: c.head,
      speed: Math.round(c.closing),
      guard: tgt.guard,
    });
    if (att.horn.mat.special === 'melt') att.heat += MELT.impactHeat * Math.min(2, res.impulse / 20000);
    this.hornStress(att, selfStressFromRecoil(att.horn.mat, res.impulse), c.b);
    if (res.damage >= 150 && first && this.state === 'fight') {
      this.timeScale = 0.3;
      this.slowTimer = 0.3;
    }
  }

  private clash(c: Candidate) {
    const [F0, F1] = this.fighters;
    const r = computeClash({
      matA: F0.horn.mat,
      matB: F1.horn.mat,
      closingSpeed: c.closing,
      massA: c.localMass,
      massB: c.localMass2 ?? c.localMass,
      hornMassA: F0.horn.totalMass,
      hornMassB: F1.horn.totalMass,
      crackedA: F0.horn.crackLevel > 0,
      crackedB: F1.horn.crackLevel > 0,
    });
    if (r.impulse <= 0) return;
    this.events.push({ type: 'clash', x: c.x, y: c.y, power: Math.min(1, r.impulse / 25000) });
    F0.hp = Math.max(0, F0.hp - r.recoilA);
    F1.hp = Math.max(0, F1.hp - r.recoilB);
    F0.stats.recoilTaken += r.recoilA;
    F1.stats.recoilTaken += r.recoilB;
    F0.stats.maxImpactSpeed = Math.max(F0.stats.maxImpactSpeed, Math.round(c.closing));
    F1.stats.maxImpactSpeed = Math.max(F1.stats.maxImpactSpeed, Math.round(c.closing));
    if (F0.horn.mat.special === 'melt') F0.heat += MELT.impactHeat * 0.5;
    if (F1.horn.mat.special === 'melt') F1.heat += MELT.impactHeat * 0.5;
    // HPは牛と角が一体：角で受けても（軽減されるが）ダメージは通る。振っていた側が与える
    if (c.own && c.flex2) {
      for (const i of [0, 1] as const) {
        const att = this.fighters[i];
        const tgt = this.fighters[1 - i];
        const own = c.own[i] + 0.35 * Math.max(0, c.own[1 - i]);
        if (own <= DAMAGE.minClosingSpeed || att.cooldown > 0) continue;
        const res = computeBodyHit({
          attacker: att.horn.mat,
          closingSpeed: own,
          relSpeed: Math.max(own, c.relSpeed),
          flexSpeed: c.flex2[i],
          localMass: i === 0 ? c.localMass : (c.localMass2 ?? c.localMass),
          hornMass: att.horn.totalMass,
          headHit: false,
          targetGuarding: tgt.guard,
          targetCharging: false,
          attackerCracked: att.horn.crackLevel > 0,
          targetHardness: tgt.horn.mat.hardness,
        });
        const dmg = Math.round(res.damage * DAMAGE.hornBlockMultiplier);
        if (dmg <= 0) continue;
        att.cooldown = DAMAGE.attackerCooldown;
        tgt.hp = Math.max(0, tgt.hp - dmg);
        att.stats.dealt += dmg;
        att.stats.hits++;
        if (res.whip > res.direct) att.stats.whipHits++;
        att.stats.maxHit = Math.max(att.stats.maxHit, dmg);
        tgt.stats.taken += dmg;
        tgt.flinch(dmg * 0.7);
        tgt.vx += (i === 0 ? 1 : -1) * Math.min(500, (res.impulse * 0.5) / COW.bodyMass);
        this.events.push({ type: 'hit', a: i, x: c.x, y: c.y, dmg, recoil: 0, whip: res.whip > res.direct && dmg >= 25, head: false, speed: Math.round(own), guard: tgt.guard, block: true });
      }
    }
    this.hornStress(F0, r.stressA, c.b);
    if (c.b2) this.hornStress(F1, r.stressB, c.b2);
  }

  /** 角の局所破損（材質ごとの壊れ方） */
  private hornStress(f: Fighter, stress: number, b: Binding) {
    const horn = f.horn;
    const mat = horn.mat;
    if (horn.destroyed || stress <= 0) return;
    const cracked = horn.crackLevel > 0;
    horn.integrity -= stress * 0.35;
    const [px, py] = horn.pointAt(b);
    switch (mat.breakMode) {
      case 'deform':
        horn.stress = Math.min(1, horn.stress + stress / 60);
        return;
      case 'whiten':
        horn.stress = Math.min(1, horn.stress + stress / 120);
        if (stress >= mat.crackStress) {
          // 塑性変形：その節点付近の静止角を少し曲げる
          const i = Math.min(horn.n - 1, Math.max(2, b.s + 1));
          horn.model.restAngle[i] += (Math.random() < 0.5 ? -1 : 1) * Math.min(0.12, stress / 600);
          horn.crackLevel = Math.min(3, horn.crackLevel + 1);
          this.events.push({ type: 'crack', f: f.idx, x: px, y: py, level: horn.crackLevel });
        }
        return;
      case 'chip':
        if (stress >= mat.crackStress && this.chipCooldown[f.idx] <= 0) {
          this.chipCooldown[f.idx] = 0.4;
          this.chipHorn(f, b);
          this.events.push({ type: 'chip', f: f.idx, x: px, y: py });
        }
        return;
      default:
        break;
    }
    // snap / shatter / melt（脆性）
    const breakAt = mat.breakStress * (cracked ? 0.5 : 1);
    if (stress >= breakAt || horn.integrity <= 0) {
      // 根元は頭に埋まっていて丈夫なので、根元付近では折れない
      const arc = Math.max(horn.length * 0.3, horn.model.arc[b.s] + b.t * horn.model.segLen[b.s] - 6);
      const r = horn.cut(arc, f.frame());
      this.hornRev[f.idx]++;
      const tv = horn.tipVelocity();
      if (r.debris) this.events.push({ type: 'break', f: f.idx, debris: r.debris, vx: tv[0] * 0.3, vy: tv[1] * 0.3 - 200, shatter: mat.breakMode === 'shatter' });
      horn.integrity = mat.integrity * 0.5;
      horn.crackLevel = 1;
      return;
    }
    if (stress >= mat.crackStress * (cracked ? 0.6 : 1)) {
      horn.crackLevel = Math.min(3, horn.crackLevel + 1);
      horn.cracks.push({ b: { ...b }, len: 8 + stress * 0.4, ang: (Math.random() - 0.5) * 2, seed: (Math.random() * 1e6) | 0 });
      if (horn.cracks.length > 10) horn.cracks.shift();
      // ひびで剛性と耐久が落ちる
      horn.stiffness *= 0.93;
      this.hornRev[f.idx]++;
      this.events.push({ type: 'crack', f: f.idx, x: px, y: py, level: horn.crackLevel });
    }
  }

  /** コルクの欠け：接触部の輪郭を中心線側へ削る */
  private chipHorn(f: Fighter, b: Binding) {
    const horn = f.horn;
    const model = horn.model;
    const poly = model.polygon.map((p) => [p[0], p[1]] as Pt);
    let changed = false;
    for (let v = 0; v < poly.length; v++) {
      const bv = model.bindings[v];
      if (Math.abs(bv.s + bv.t - (b.s + b.t)) < 0.9) {
        // 法線方向オフセットを 18% 縮める
        const k = 0.82;
        const nodes = model.nodes;
        const P: Pt = [nodes[bv.s][0] + (nodes[bv.s + 1][0] - nodes[bv.s][0]) * bv.t, nodes[bv.s][1] + (nodes[bv.s + 1][1] - nodes[bv.s][1]) * bv.t];
        const nx = poly[v][0] - P[0];
        const ny = poly[v][1] - P[1];
        if (Math.hypot(nx, ny) > HORN.minHalfWidth + 1) {
          poly[v] = [P[0] + nx * k, P[1] + ny * k];
          changed = true;
        }
      }
    }
    if (!changed) return;
    try {
      const nm = buildHornModel(poly);
      if (nm.stats.length >= 12) {
        horn.setModel(nm, f.frame());
        this.hornRev[f.idx]++;
      }
    } catch {
      /* 形状が破綻する場合は欠けを見送る */
    }
  }

  private updateMelt(f: Fighter, dt: number) {
    if (f.horn.mat.special !== 'melt' || this.state !== 'fight') return;
    const heat = f.heat;
    f.heat = 0;
    const tip = f.horn.n > 0 ? [f.horn.x[f.horn.n - 1], f.horn.y[f.horn.n - 1]] : [0, 0];
    const r = f.horn.updateMelt(dt, heat, f.frame());
    // 最大HPの低下
    f.maxHp = Math.round(f.baseMaxHp * (1 - MELT.maxHpLoss * f.horn.melt));
    f.hp = Math.min(f.hp, f.maxHp);
    if (r.cut) {
      this.hornRev[f.idx]++;
      this.events.push({ type: 'meltcut', f: f.idx, x: tip[0], y: tip[1] });
    }
  }

  private lost(f: Fighter): EndReason | null {
    if (f.hp <= 0) return 'ko';
    if (f.horn.destroyed) return f.horn.mat.special === 'melt' ? 'melt' : 'horn';
    if (f.horn.length < f.horn.originalLength * MATCH.hornLossRatio) return f.horn.mat.special === 'melt' ? 'melt' : 'horn';
    return null;
  }

  private checkEnd() {
    const la = this.lost(this.fighters[0]);
    const lb = this.lost(this.fighters[1]);
    if (la && lb) return this.finish(null, 'double');
    if (la) return this.finish(1, la);
    if (lb) return this.finish(0, lb);
    if (this.time >= this.timeLimit) {
      const [a, b] = this.fighters;
      const ra = a.hp / a.baseMaxHp;
      const rb = b.hp / b.baseMaxHp;
      if (Math.abs(ra - rb) < MATCH.drawHpRatio) return this.finish(null, 'draw');
      return this.finish(ra > rb ? 0 : 1, 'timeup');
    }
  }

  finish(winner: 0 | 1 | null, reason: EndReason) {
    if (this.result) return;
    this.result = { winner, reason, time: Math.round(this.time * 10) / 10 };
    this.events.push({ type: 'ko', loser: winner === null ? null : 1 - winner });
    this.events.push({ type: 'end', winner, reason });
    if (reason === 'forfeit') {
      this.state = 'over';
      return;
    }
    this.state = 'ko';
    this.koTimer = MATCH.koSlowmo;
    this.timeScale = 0.25;
  }

  /* ---------------- 同期用スナップショット ---------------- */

  snapshot(): MatchSnapshot {
    return {
      tick: this.tick,
      time: Math.round(this.time * 1000) / 1000,
      st: this.state,
      cd: Math.max(0, Math.round(this.countdown * 100) / 100),
      ts: this.timeScale,
      f: this.fighters.map((f) => {
        const h = f.horn;
        const nodes: number[] = [];
        for (let i = 0; i < h.n; i++) nodes.push(Math.round(h.x[i] * 10) / 10, Math.round(h.y[i] * 10) / 10);
        return [
          Math.round(f.x * 10) / 10,
          Math.round(f.theta * 1000) / 1000,
          PHASES.indexOf(f.phase),
          Math.round(f.charge * 100) / 100,
          Math.round(f.hp),
          f.maxHp,
          f.guard ? 1 : 0,
          Math.round(f.stun * 100) / 100,
          Math.round(h.melt * 1000) / 1000,
          Math.round(h.widthScale * 1000) / 1000,
          this.hornRev[f.idx],
          Math.round(h.stress * 100) / 100,
          h.crackLevel,
          h.destroyed ? 1 : 0,
          Math.round(f.vx),
          Math.round(f.hitFlash * 100) / 100,
          nodes,
        ] as FighterSnap;
      }) as [FighterSnap, FighterSnap],
    };
  }

  hornShape(i: number): HornShapeSnap {
    const h = this.fighters[i].horn;
    return {
      rev: this.hornRev[i],
      polygon: h.model.polygon,
      cracks: h.cracks.map((c) => [c.b.s, Math.round(c.b.t * 1000) / 1000, Math.round(c.b.a * 10) / 10, Math.round(c.b.d * 10) / 10, Math.round(c.len), Math.round(c.ang * 100) / 100, c.seed]),
    };
  }

  /** 切断などで勝負を強制終了（切断・放棄） */
  forfeit(loser: 0 | 1) {
    this.finish(loser === 0 ? 1 : 0, 'forfeit');
  }
}

export type FighterSnap = [
  x: number,
  theta: number,
  phase: number,
  charge: number,
  hp: number,
  maxHp: number,
  guard: number,
  stun: number,
  melt: number,
  widthScale: number,
  hornRev: number,
  stress: number,
  crackLevel: number,
  destroyed: number,
  vx: number,
  flash: number,
  nodes: number[],
];

export interface MatchSnapshot {
  tick: number;
  time: number;
  st: MatchState;
  cd: number;
  ts: number;
  f: [FighterSnap, FighterSnap];
}

export interface HornShapeSnap {
  rev: number;
  polygon: Poly;
  cracks: number[][];
}

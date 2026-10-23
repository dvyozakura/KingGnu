/**
 * CPU の思考。
 * 自分の角の実形状・首の慣性・突進を使って「チャージ量×間合い→当たったときの衝突速度」を
 * 事前にシミュレーションした表（スイングプラン）を持ち、それと現在の物理状態
 * （距離・自分の角の揺れ・相手の状態）を見て入力を決める。
 *  EASY  : 反応が遅く、間合いとチャージ量の選び方が雑
 *  NORMAL: プランどおり適切な間合い・チャージ量で攻撃
 *  HARD  : さらに角のしなりの位相や相手の隙・チャージを読んでタイミングを調整、ガードも使う
 */
import { COW, DAMAGE, SIM_DT } from '../config/game';
import { pointInConvex } from '../physics/collision';
import { Fighter, FighterInput } from './fighter';
import { Match } from './match';

export type Difficulty = 'easy' | 'normal' | 'hard';

interface Params {
  reaction: number;
  jitter: number;
  guardChance: number;
  rangeError: number;
  whipTiming: boolean;
  punish: boolean;
  aggression: number;
  pickBest: number;
}

const PARAMS: Record<Difficulty, Params> = {
  easy: { reaction: 0.55, jitter: 0.25, guardChance: 0.05, rangeError: 70, whipTiming: false, punish: false, aggression: 0.45, pickBest: 0.35 },
  normal: { reaction: 0.22, jitter: 0.07, guardChance: 0.3, rangeError: 20, whipTiming: false, punish: true, aggression: 0.7, pickBest: 0.8 },
  hard: { reaction: 0.08, jitter: 0.02, guardChance: 0.65, rangeError: 5, whipTiming: true, punish: true, aggression: 0.85, pickBest: 1 },
};

/** 決定的な疑似乱数（再現性のため） */
function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SwingPlan {
  charges: number[];
  dists: number[];
  /** score[ci][di] = 当たったときの法線方向の衝突速度（px/s）。当たらなければ 0 */
  score: number[][];
  version: number;
}

const CHARGES = [0.2, 0.4, 0.6, 0.8, 1.0];
const DISTS: number[] = [];
for (let d = COW.minSeparation; d <= 760; d += 30) DISTS.push(d);

/**
 * 自分の角を剛体とみなしてスイングを前進シミュレーションし、
 * 間合いごとの衝突速度を求める（相手は静止した標準的な牛として扱う）
 */
export function planSwing(src: Fighter, opp?: Fighter): SwingPlan {
  const score = CHARGES.map(() => DISTS.map(() => 0));
  const poly = src.horn.model.polygon;
  // 相手（静止）。頭と体の実際の当たり形状を使い、相手の角は「先に当たると防がれる」障害物として扱う
  const oppModel = opp ? opp.horn.model : src.horn.model;
  const dummy = new Fighter(1, oppModel, opp ? opp.material : src.material, 0);
  // 相手の角の凸ピース（相手の体中心 x=0 基準）
  const oppHulls: number[][] = [];
  const oppBox = [Infinity, Infinity, -Infinity, -Infinity];
  // 炎の角は角どうしですり抜けるので、防がれる障害物として扱わない
  if (opp && opp.horn.mat.special !== 'burn' && src.horn.mat.special !== 'burn') {
    dummy.x = 0;
    dummy.updateShapes();
    const ofr = dummy.frame();
    for (const piece of oppModel.pieces) {
      const hull: number[] = [];
      for (const v of piece) {
        const [hx, hy] = dummy.horn.toWorld(oppModel.polygon[v][0], oppModel.polygon[v][1], ofr);
        hull.push(hx, hy);
        oppBox[0] = Math.min(oppBox[0], hx);
        oppBox[1] = Math.min(oppBox[1], hy);
        oppBox[2] = Math.max(oppBox[2], hx);
        oppBox[3] = Math.max(oppBox[3], hy);
      }
      oppHulls.push(hull);
    }
  }
  for (let ci = 0; ci < CHARGES.length; ci++) {
    const f = new Fighter(0, src.horn.model, src.material, 400);
    f.input = { charge: true, move: 0 };
    const steps = Math.ceil((CHARGES[ci] * 0.9) / SIM_DT);
    for (let i = 0; i < steps; i++) {
      f.updateControl(SIM_DT, true);
      f.integrate(SIM_DT);
    }
    f.input = { charge: false, move: 0 };
    const startX = f.x;
    const done = DISTS.map(() => false);
    for (let i = 0; i < 90; i++) {
      f.updateControl(SIM_DT, true);
      f.integrate(SIM_DT);
      const fr = f.frame();
      const wpts: [number, number][] = [];
      for (let v = 0; v < poly.length; v += 3) wpts.push(f.horn.toWorld(poly[v][0], poly[v][1], fr));
      for (let di = 0; di < DISTS.length; di++) {
        if (done[di]) continue;
        const ox = startX + DISTS[di];
        if (ox - f.x < COW.minSeparation - 2) {
          done[di] = true;
          continue;
        }
        dummy.x = ox;
        dummy.updateShapes();
        let best = 0;
        let touched = false;
        if (oppHulls.length) {
          // 相手の角（静止形状）に先に当たったら防がれたとみなす
          let blocked = false;
          let bs = 0;
          for (const [wx, wy] of wpts) {
            const lx = wx - ox;
            if (lx < oppBox[0] || lx > oppBox[2] || wy < oppBox[1] || wy > oppBox[3]) continue;
            for (const hull of oppHulls) {
              if (pointInConvex(lx, wy, hull)) {
                blocked = true;
                const [vx, vy] = f.horn.rigidVelocity(wx, wy, fr);
                bs = Math.max(bs, Math.hypot(vx, vy) * 0.6);
                break;
              }
            }
          }
          if (blocked) {
            // 角で受けられる：ダメージは軽減される
            done[di] = true;
            score[ci][di] = bs >= DAMAGE.minClosingSpeed ? bs * DAMAGE.hornBlockMultiplier : 0;
            continue;
          }
        }
        for (const shape of [dummy.headPoly, dummy.bodyPoly]) {
          for (const [wx, wy] of wpts) {
            if (!pointInConvex(wx, wy, shape)) continue;
            touched = true;
            const [nx, ny] = nearestEdgeNormal(shape, wx, wy);
            const [vx, vy] = f.horn.rigidVelocity(wx, wy, fr);
            const closing = -(vx * nx + vy * ny);
            if (closing > best) best = closing;
          }
        }
        if (touched) {
          done[di] = true;
          score[ci][di] = best >= DAMAGE.minClosingSpeed ? best : 0;
        }
      }
    }
  }
  return { charges: CHARGES, dists: DISTS, score, version: src.horn.version * 1000 + (opp?.horn.version ?? 0) };
}

/** 凸多角形の、点に最も近い辺の外向き法線 */
function nearestEdgeNormal(p: number[], x: number, y: number): [number, number] {
  const n = p.length / 2;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    cx += p[i * 2];
    cy += p[i * 2 + 1];
  }
  cx /= n;
  cy /= n;
  let best = Infinity;
  let res: [number, number] = [0, -1];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = p[i * 2];
    const ay = p[i * 2 + 1];
    const ex = p[j * 2] - ax;
    const ey = p[j * 2 + 1] - ay;
    const l = Math.hypot(ex, ey) || 1;
    let nx = -ey / l;
    let ny = ex / l;
    if ((ax - cx) * nx + (ay - cy) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    const d = (ax - x) * nx + (ay - y) * ny;
    if (d < best) {
      best = d;
      res = [nx, ny];
    }
  }
  return res;
}

export class CpuBrain {
  p: Params;
  private rnd: () => number;
  private think = 0;
  private targetCharge = 0.7;
  private releaseJitter = 0;
  private guardT = 0;
  private lastLag = 0;
  private lagRising = false;
  private rangeErr = 0;
  private plan: SwingPlan | null = null;

  constructor(public difficulty: Difficulty, seed = 1234) {
    this.p = PARAMS[difficulty];
    this.rnd = mulberry(seed);
  }

  private planFor(me: Fighter, op: Fighter) {
    const v = me.horn.version * 1000 + op.horn.version;
    if (!this.plan || this.plan.version !== v) this.plan = planSwing(me, op);
    return this.plan;
  }

  /** 距離 dist でチャージ c のときの期待衝突速度（線形補間） */
  private scoreAt(plan: SwingPlan, ci: number, dist: number) {
    const d = plan.dists;
    if (dist <= d[0]) return plan.score[ci][0];
    if (dist >= d[d.length - 1]) return 0;
    const k = Math.floor((dist - d[0]) / (d[1] - d[0]));
    const u = (dist - d[k]) / (d[1] - d[0]);
    return plan.score[ci][k] * (1 - u) + plan.score[ci][k + 1] * u;
  }

  private scoreAtCharge(plan: SwingPlan, charge: number, dist: number) {
    const c = plan.charges;
    if (charge <= c[0]) return this.scoreAt(plan, 0, dist);
    let k = 0;
    while (k < c.length - 2 && c[k + 1] < charge) k++;
    const u = Math.max(0, Math.min(1, (charge - c[k]) / (c[k + 1] - c[k])));
    const a = this.scoreAt(plan, k, dist);
    const b = this.scoreAt(plan, k + 1, dist);
    // どちらかが外れなら控えめに
    return a > 0 && b > 0 ? a * (1 - u) + b * u : u < 0.5 ? a * (1 - u * 2) : b * (u * 2 - 1);
  }

  private bestChargeAt(plan: SwingPlan, dist: number): { ci: number; s: number } {
    let best = { ci: -1, s: 0 };
    for (let ci = 0; ci < plan.charges.length; ci++) {
      const s = this.scoreAt(plan, ci, dist) * (0.85 + 0.15 * plan.charges[ci]);
      if (s > best.s) best = { ci, s };
    }
    return best;
  }

  /** 攻撃が成立する最寄りの間合い */
  private bestDistance(plan: SwingPlan, dist: number): number | null {
    let bestD: number | null = null;
    let bestCost = Infinity;
    for (let di = 0; di < plan.dists.length; di++) {
      const s = Math.max(...plan.score.map((r) => r[di]));
      if (s < DAMAGE.minClosingSpeed * 2) continue;
      const cost = Math.abs(plan.dists[di] - dist) - s * 0.05;
      if (cost < bestCost) {
        bestCost = cost;
        bestD = plan.dists[di];
      }
    }
    return bestD;
  }

  update(match: Match, idx: 0 | 1, dt: number): FighterInput {
    const me = match.fighters[idx];
    const op = match.fighters[1 - idx];
    if (match.state === 'countdown') this.planFor(me, op);
    if (match.state !== 'fight') return { charge: false, move: 0 };
    const plan = this.planFor(me, op);
    const out: FighterInput = { charge: me.input.charge, move: me.input.move };
    const dist = Math.abs(op.x - me.x) + this.rangeErr;

    // しなりの位相：先端の遅れ（静止形状からのずれ）が増えているか
    const lag = me.horn.tipDeflection();
    this.lagRising = lag > this.lastLag + 0.05;
    this.lastLag = lag;
    this.guardT = Math.max(0, this.guardT - dt);
    this.think -= dt;

    if (me.phase === 'charge') {
      // いまのチャージ量で放したときに当たるか（チャージ量方向にも補間）
      const now = this.scoreAtCharge(plan, me.charge, dist);
      let release = me.charge >= this.targetCharge + this.releaseJitter && now >= DAMAGE.minClosingSpeed * 1.5;
      if (this.p.punish && op.phase === 'recover' && now > DAMAGE.minClosingSpeed * 2) release = true;
      // しなる角は、先端が後ろに遅れきった瞬間に振ると鞭のように加速する
      if (this.p.whipTiming && release && me.horn.mat.stiffness < 0.5 && this.lagRising && me.charge < 0.98) release = false;
      // 届かないなら近づきながら溜める
      out.move = now < DAMAGE.minClosingSpeed && dist > COW.minSeparation + 60 ? 1 : 0;
      if (me.charge >= 1 && me.phaseT > 1.6 + this.rnd() * 0.6) release = true;
      if (this.difficulty === 'easy' && me.charge >= this.targetCharge + this.releaseJitter) release = true;
      out.charge = !release;
      return out;
    }

    if (this.think > 0) return out;
    this.think = this.p.reaction * (0.6 + this.rnd() * 0.8);
    this.rangeErr = (this.rnd() - 0.5) * 2 * this.p.rangeError;

    // ガード：相手が溜めていて間合い内、または振ってきた
    const danger = dist < COW.minSeparation + 260;
    if (op.phase === 'charge' && op.charge > 0.45 && danger && this.rnd() < this.p.guardChance) this.guardT = 0.3 + this.rnd() * 0.3;
    if (op.phase === 'swing' && danger && this.rnd() < this.p.guardChance * 0.5) this.guardT = 0.25;
    if (this.guardT > 0) return { charge: false, move: -1 };

    if (me.phase === 'swing' || me.phase === 'recover') {
      return { charge: false, move: this.difficulty === 'easy' ? 0 : dist < COW.minSeparation + 40 ? -1 : 0 };
    }

    // idle：この間合いで当たるチャージ量があれば溜め始める
    const here = this.bestChargeAt(plan, dist);
    if (here.ci >= 0 && here.s > DAMAGE.minClosingSpeed * 2 && this.rnd() < this.p.aggression) {
      const pick = this.rnd() < this.p.pickBest ? here.ci : Math.floor(this.rnd() * plan.charges.length);
      this.targetCharge = plan.charges[pick] - 0.05;
      this.releaseJitter = (this.rnd() - 0.5) * 2 * this.p.jitter;
      return { charge: true, move: 0 };
    }
    // 当たる間合いへ移動
    const target = this.bestDistance(plan, dist);
    if (target === null) {
      this.targetCharge = 0.4 + this.rnd() * 0.6;
      return { charge: this.rnd() < 0.5, move: dist > 420 ? 1 : -1 };
    }
    if (Math.abs(target - dist) < 14) {
      const b = this.bestChargeAt(plan, target);
      this.targetCharge = b.ci >= 0 ? plan.charges[b.ci] - 0.05 : 0.6;
      return { charge: this.rnd() < this.p.aggression, move: 0 };
    }
    // 目標の間合いが今より遠ければ下がる（move は相手方向が +1）
    return { charge: false, move: target > dist ? -1 : 1 };
  }
}

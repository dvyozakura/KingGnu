/**
 * 角の多節点物理（Verlet + Position Based Dynamics）
 *
 *  - 節点 0,1 は頭に固定（根元）
 *  - 距離拘束：節点間の長さを保つ
 *  - 曲げ拘束：隣接セグメントの相対角を静止角へ戻す（stiffness）
 *  - 形状保持：根元フレームでの静止位置へ引き戻す（shapeMatch, 硬い材質ほど強い）
 *  - 内部減衰：剛体運動からのずれ（＝変形速度）だけを減衰させる
 *
 * 頭が回転すると柔らかい角は慣性で遅れ、時間差で先端が加速する（鞭）。
 * ガラスやアイスは形状保持が強いので頭の動きがそのまま角全体に伝わる。
 */
import { COW, HORN, MELT, WORLD } from '../config/game';
import { MATERIALS, MaterialDef, MaterialId } from '../config/materials';
import { Poly, Pt } from '../geometry/polygon';
import { Binding, HornModel, buildHornModel, cutHornPolygon } from '../horn/model';

export const MASS_PER_AREA = 0.008;
export const GRAVITY = 900;
const MAX_NODE_SPEED = 4200;

export interface HeadFrame {
  /** 首の回転中心（ワールド） */
  px: number;
  py: number;
  theta: number;
  omega: number;
  vx: number;
  vy: number;
  facing: 1 | -1;
}

export interface CrackMark {
  b: Binding;
  len: number;
  ang: number;
  seed: number;
}

/** 材質の「剛体らしさ」0..1：直接打撃の有効質量や頭への慣性の伝わり方に使う */
export function rigidity(m: MaterialDef) {
  return m.coupling;
}

export class HornBody {
  model: HornModel;
  mat: MaterialDef;
  facing: 1 | -1;
  n = 0;
  x = new Float64Array(0);
  y = new Float64Array(0);
  px = new Float64Array(0);
  py = new Float64Array(0);
  mass = new Float64Array(0);
  invMass = new Float64Array(0);
  tgtX = new Float64Array(0);
  tgtY = new Float64Array(0);
  tgtPX = new Float64Array(0);
  tgtPY = new Float64Array(0);
  vertX = new Float64Array(0);
  vertY = new Float64Array(0);
  /** 直近サブステップのdt（速度推定用） */
  lastDt = 1 / 120;
  widthScale = 1;
  stiffness: number;
  shapeMatch: number;
  integrity: number;
  crackLevel = 0;
  cracks: CrackMark[] = [];
  /** 変形（プラスチックの白化・ゴムの伸び）表現 0..1 */
  stress = 0;
  version = 0;
  originalLength: number;
  melt = 0;
  destroyed = false;
  totalMass = 0;
  /** 金：関節ごとの累積の曲がり（rad） */
  bendTotal = new Float64Array(0);
  private meltCutLength: number;

  constructor(model: HornModel, material: MaterialId, frame: HeadFrame) {
    this.mat = MATERIALS[material];
    this.facing = frame.facing;
    this.model = model;
    this.stiffness = this.mat.stiffness;
    this.shapeMatch = this.mat.shapeMatch;
    this.integrity = this.mat.integrity;
    this.originalLength = model.stats.length;
    this.meltCutLength = model.stats.length;
    this.setModel(model, frame);
  }

  get length() {
    return this.model.stats.length;
  }

  setModel(model: HornModel, frame: HeadFrame) {
    this.model = model;
    const n = model.nodes.length;
    this.n = n;
    this.x = new Float64Array(n);
    this.y = new Float64Array(n);
    this.px = new Float64Array(n);
    this.py = new Float64Array(n);
    this.mass = new Float64Array(n);
    this.invMass = new Float64Array(n);
    this.tgtX = new Float64Array(n);
    this.tgtY = new Float64Array(n);
    this.tgtPX = new Float64Array(n);
    this.tgtPY = new Float64Array(n);
    this.vertX = new Float64Array(model.polygon.length);
    this.vertY = new Float64Array(model.polygon.length);
    this.bendTotal = new Float64Array(n);
    this.updateMasses();
    this.computeTargets(frame);
    for (let i = 0; i < n; i++) {
      this.x[i] = this.px[i] = this.tgtX[i];
      this.y[i] = this.py[i] = this.tgtY[i];
      this.tgtPX[i] = this.tgtX[i];
      this.tgtPY[i] = this.tgtY[i];
    }
    this.cracks = this.cracks.filter((c) => c.b.s < n - 1);
    this.skin();
    this.version++;
  }

  updateMasses() {
    const ms = this.mat.special === 'melt' ? this.widthScale : 1;
    let total = 0;
    for (let i = 0; i < this.n; i++) {
      const m = Math.max(0.05, this.model.nodeArea[i] * this.mat.density * MASS_PER_AREA * ms);
      this.mass[i] = m;
      this.invMass[i] = i < 2 ? 0 : 1 / m;
      total += m;
    }
    this.totalMass = total;
  }

  /** 首まわりの慣性モーメント（静止形状、角の剛体らしさで重み付け） */
  inertiaAboutPivot(): number {
    let I = 0;
    for (let i = 0; i < this.n; i++) {
      const lx = COW.anchorX + this.model.nodes[i][0];
      const ly = COW.anchorY + this.model.nodes[i][1];
      I += this.mass[i] * (lx * lx + ly * ly);
    }
    return I * (0.35 + 0.65 * rigidity(this.mat));
  }

  /** 角ローカル → ワールド */
  toWorld(lx: number, ly: number, f: HeadFrame): Pt {
    const c = Math.cos(f.theta);
    const s = Math.sin(f.theta);
    const qx = COW.anchorX + lx;
    const qy = COW.anchorY + ly;
    return [f.px + f.facing * (qx * c - qy * s), f.py + (qx * s + qy * c)];
  }

  /** 剛体として頭と一緒に動いた場合のワールド速度 */
  rigidVelocity(wx: number, wy: number, f: HeadFrame): Pt {
    const rx = (wx - f.px) * f.facing;
    const ry = wy - f.py;
    return [f.vx + f.facing * f.omega * -ry, f.vy + f.omega * rx];
  }

  private computeTargets(f: HeadFrame) {
    const c = Math.cos(f.theta);
    const s = Math.sin(f.theta);
    for (let i = 0; i < this.n; i++) {
      const qx = COW.anchorX + this.model.nodes[i][0];
      const qy = COW.anchorY + this.model.nodes[i][1];
      this.tgtX[i] = f.px + f.facing * (qx * c - qy * s);
      this.tgtY[i] = f.py + (qx * s + qy * c);
    }
  }

  step(dt: number, f: HeadFrame) {
    const n = this.n;
    this.lastDt = dt;
    this.facing = f.facing;
    for (let i = 0; i < n; i++) {
      this.tgtPX[i] = this.tgtX[i];
      this.tgtPY[i] = this.tgtY[i];
    }
    this.computeTargets(f);
    const g = GRAVITY * this.mat.gravityScale * dt * dt;
    const damp = Math.min(0.5, this.mat.damping * 0.35);
    const maxD = MAX_NODE_SPEED * dt;
    for (let i = 0; i < n; i++) {
      const vx = this.x[i] - this.px[i];
      const vy = this.y[i] - this.py[i];
      this.px[i] = this.x[i];
      this.py[i] = this.y[i];
      if (i < 2) {
        this.x[i] = this.tgtX[i];
        this.y[i] = this.tgtY[i];
        continue;
      }
      // 剛体運動からのずれだけを減衰
      const rx = this.tgtX[i] - this.tgtPX[i];
      const ry = this.tgtY[i] - this.tgtPY[i];
      let dx = vx - (vx - rx) * damp;
      let dy = vy - (vy - ry) * damp;
      const dl = Math.hypot(dx, dy);
      if (dl > maxD) {
        dx *= maxD / dl;
        dy *= maxD / dl;
      }
      this.x[i] += dx;
      this.y[i] += dy + g;
    }

    const K = Math.min(16, 6 + Math.round(10 * this.stiffness));
    const kBend = 1 - Math.pow(1 - Math.min(0.9999, this.stiffness), 1 / K);
    const kShape = 1 - Math.pow(1 - Math.min(0.9999, this.shapeMatch), 1 / K);
    const seg = this.model.segLen;
    const rest = this.model.restAngle;
    const fs = this.facing;
    for (let it = 0; it < K; it++) {
      // 距離拘束
      for (let i = 1; i < n; i++) {
        const w0 = this.invMass[i - 1];
        const w1 = this.invMass[i];
        const w = w0 + w1;
        if (w === 0) continue;
        const dx = this.x[i] - this.x[i - 1];
        const dy = this.y[i] - this.y[i - 1];
        const d = Math.hypot(dx, dy) || 1e-6;
        const c = (d - seg[i - 1]) / (d * w);
        this.x[i - 1] += dx * c * w0;
        this.y[i - 1] += dy * c * w0;
        this.x[i] -= dx * c * w1;
        this.y[i] -= dy * c * w1;
      }
      // 曲げ拘束
      for (let i = 2; i < n; i++) {
        const wa = this.invMass[i - 2];
        const wb = this.invMass[i];
        const w = wa + wb;
        if (w === 0) continue;
        const ox = this.x[i - 1];
        const oy = this.y[i - 1];
        const ax = ox - this.x[i - 2];
        const ay = oy - this.y[i - 2];
        const bx = this.x[i] - ox;
        const by = this.y[i] - oy;
        const cur = Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
        let e = fs * rest[i] - cur;
        if (e > Math.PI) e -= Math.PI * 2;
        if (e < -Math.PI) e += Math.PI * 2;
        const wp = this.invMass[i - 1];
        const k = kBend * e;
        // 回転量を逆質量で配分（中央節点も含めて運動量を保存する）
        const wsum = wa + wb + (wp > 0 ? wp * 0.5 : 0);
        const rb = (k * wb) / wsum;
        let dbx = 0;
        let dby = 0;
        let dax = 0;
        let day = 0;
        if (rb !== 0) {
          const c = Math.cos(rb);
          const s = Math.sin(rb);
          dbx = ox + bx * c - by * s - this.x[i];
          dby = oy + bx * s + by * c - this.y[i];
        }
        const ra = (-k * wa) / wsum;
        if (ra !== 0) {
          const c = Math.cos(ra);
          const s = Math.sin(ra);
          const qx = this.x[i - 2] - ox;
          const qy = this.y[i - 2] - oy;
          dax = ox + qx * c - qy * s - this.x[i - 2];
          day = oy + qx * s + qy * c - this.y[i - 2];
        }
        this.x[i] += dbx;
        this.y[i] += dby;
        this.x[i - 2] += dax;
        this.y[i - 2] += day;
        if (wp > 0) {
          const mb = wb > 0 ? 1 / wb : 0;
          const ma = wa > 0 ? 1 / wa : 0;
          this.x[i - 1] -= (mb * dbx + ma * dax) * wp;
          this.y[i - 1] -= (mb * dby + ma * day) * wp;
        }
      }
      // 形状保持
      if (kShape > 0) {
        for (let i = 2; i < n; i++) {
          this.x[i] += (this.tgtX[i] - this.x[i]) * kShape;
          this.y[i] += (this.tgtY[i] - this.y[i]) * kShape;
        }
      }
    }
    // 地面
    for (let i = 2; i < n; i++) {
      if (this.y[i] > WORLD.groundY - 2) {
        this.y[i] = WORLD.groundY - 2;
        this.px[i] += (this.x[i] - this.px[i]) * 0.3;
      }
    }
  }

  /** 節点 → 輪郭頂点（しなりに合わせて当たり判定も変形） */
  skin() {
    skinPoints(this.model.bindings, this.x, this.y, this.n, this.facing, this.widthScale, this.vertX, this.vertY);
  }

  /** バインディング位置のワールド座標 */
  pointAt(b: Binding): Pt {
    const s = b.s;
    const t = b.t;
    return [this.x[s] + (this.x[s + 1] - this.x[s]) * t, this.y[s] + (this.y[s + 1] - this.y[s]) * t];
  }

  /** 頂点バインディングでの実速度（節点速度の補間） */
  velocityAt(b: Binding): Pt {
    const s = b.s;
    const t = b.t;
    const dt = this.lastDt;
    const v0x = (this.x[s] - this.px[s]) / dt;
    const v0y = (this.y[s] - this.py[s]) / dt;
    const v1x = (this.x[s + 1] - this.px[s + 1]) / dt;
    const v1y = (this.y[s + 1] - this.py[s + 1]) / dt;
    return [v0x + (v1x - v0x) * t, v0y + (v1y - v0y) * t];
  }

  /** 接触点付近の局所質量 */
  localMass(b: Binding) {
    const s = b.s;
    let m = this.mass[s] * (1 - b.t) + this.mass[s + 1] * b.t;
    if (s + 2 < this.n) m += this.mass[s + 2] * 0.5;
    if (s - 1 >= 0) m += this.mass[s - 1] * 0.25;
    return m;
  }

  /** 先端の速度（ワールド） */
  tipVelocity(): Pt {
    const i = this.n - 1;
    return [(this.x[i] - this.px[i]) / this.lastDt, (this.y[i] - this.py[i]) / this.lastDt];
  }

  /**
   * バインディング位置を (dx,dy) 動かすように節点を補正。
   * 固定節点のみで動かせない場合は false
   */
  applyCorrection(b: Binding, dx: number, dy: number, keepVelocity = 0): boolean {
    const s = b.s;
    const c0 = 1 - b.t;
    const c1 = b.t;
    const w0 = this.invMass[s];
    const w1 = this.invMass[s + 1];
    let denom = c0 * c0 * w0 + c1 * c1 * w1;
    let i2 = -1;
    if (denom === 0) {
      // 根元セグメント：次の節点を代わりに動かす
      if (s + 2 < this.n) {
        i2 = s + 2;
        denom = this.invMass[i2] * 0.25;
      }
      if (denom === 0) return false;
    }
    if (i2 >= 0) {
      const k = (0.5 * this.invMass[i2]) / denom;
      this.x[i2] += dx * k;
      this.y[i2] += dy * k;
      if (keepVelocity) {
        this.px[i2] += dx * k * keepVelocity;
        this.py[i2] += dy * k * keepVelocity;
      }
      return true;
    }
    const k0 = (c0 * w0) / denom;
    const k1 = (c1 * w1) / denom;
    this.x[s] += dx * k0;
    this.y[s] += dy * k0;
    this.x[s + 1] += dx * k1;
    this.y[s + 1] += dy * k1;
    if (keepVelocity) {
      this.px[s] += dx * k0 * keepVelocity;
      this.py[s] += dy * k0 * keepVelocity;
      this.px[s + 1] += dx * k1 * keepVelocity;
      this.py[s + 1] += dy * k1 * keepVelocity;
    }
    return true;
  }

  /** 接触点に速度変化を与える（節点の前回位置をずらす） */
  addVelocity(b: Binding, dvx: number, dvy: number) {
    const dt = this.lastDt;
    for (const [i, w] of [
      [b.s, 1 - b.t],
      [b.s + 1, b.t],
    ] as [number, number][]) {
      if (this.invMass[i] === 0) continue;
      this.px[i] -= dvx * dt * w;
      this.py[i] -= dvy * dt * w;
    }
  }

  /** 位置レベルの補正で頭ごと動かすとき、速度を生まないよう状態全体を剛体変換する */
  translate(dx: number, dy: number) {
    for (let i = 0; i < this.n; i++) {
      this.x[i] += dx;
      this.y[i] += dy;
      this.px[i] += dx;
      this.py[i] += dy;
      this.tgtX[i] += dx;
      this.tgtY[i] += dy;
      this.tgtPX[i] += dx;
      this.tgtPY[i] += dy;
    }
    for (let v = 0; v < this.vertX.length; v++) {
      this.vertX[v] += dx;
      this.vertY[v] += dy;
    }
  }

  rotateAbout(cx: number, cy: number, ang: number) {
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const rot = (X: Float64Array, Y: Float64Array) => {
      for (let i = 0; i < X.length; i++) {
        const x = X[i] - cx;
        const y = Y[i] - cy;
        X[i] = cx + x * c - y * s;
        Y[i] = cy + x * s + y * c;
      }
    };
    rot(this.x, this.y);
    rot(this.px, this.py);
    rot(this.tgtX, this.tgtY);
    rot(this.tgtPX, this.tgtPY);
    rot(this.vertX, this.vertY);
  }

  /** 変形量（先端の静止位置からのずれ）。UI・AI 用 */
  tipDeflection(): number {
    const i = this.n - 1;
    return Math.hypot(this.x[i] - this.tgtX[i], this.y[i] - this.tgtY[i]);
  }

  /** 弧長位置 arc で切断。切れた破片の多角形（ワールド座標）を返す */
  cut(arc: number, frame: HeadFrame): { debris: Poly | null; destroyed: boolean } {
    const { kept, debris } = cutHornPolygon(this.model, arc);
    let worldDebris: Poly | null = null;
    if (debris && debris.length >= 3) worldDebris = debris.map(([x, y]) => this.toWorld(x, y, frame));
    if (!kept) {
      this.destroyed = true;
      return { debris: worldDebris, destroyed: true };
    }
    const model = buildHornModel(kept);
    if (model.stats.length < this.originalLength * 0.12 || model.stats.length < 12) {
      this.destroyed = true;
      return { debris: worldDebris, destroyed: true };
    }
    // 現在の変形と速度はリセットせず、静止姿勢へ置き直してから元の先端付近の速度を残す
    const tipV = this.n > 2 ? this.tipVelocity() : ([0, 0] as Pt);
    this.setModel(model, frame);
    const dt = this.lastDt;
    for (let i = 2; i < this.n; i++) {
      const w = i / (this.n - 1);
      this.px[i] -= tipV[0] * dt * w * 0.5;
      this.py[i] -= tipV[1] * dt * w * 0.5;
    }
    return { debris: worldDebris, destroyed: false };
  }

  /**
   * 永久変形（金）：関節 i（節点 i-1 まわり）の静止形状を dAng だけ曲げる。
   * 静止角と静止節点（形状保持の目標）の両方を書き換えるので、曲がったまま戻らない。
   * 戻り値：実際に曲げた量
   */
  bendJoint(i: number, dAng: number, maxTotal: number): number {
    if (i < 2 || i >= this.n || this.destroyed) return 0;
    const cur = this.bendTotal[i];
    const next = Math.max(-maxTotal, Math.min(maxTotal, cur + dAng));
    const d = next - cur;
    if (Math.abs(d) < 1e-4) return 0;
    this.bendTotal[i] = next;
    this.model.restAngle[i] += d;
    const nodes = this.model.nodes;
    const [ox, oy] = nodes[i - 1];
    const c = Math.cos(d);
    const s = Math.sin(d);
    for (let j = i; j < nodes.length; j++) {
      const qx = nodes[j][0] - ox;
      const qy = nodes[j][1] - oy;
      nodes[j] = [ox + qx * c - qy * s, oy + qx * s + qy * c];
    }
    this.version++;
    return d;
  }

  /** あずきのアイスの融解。戻り値: 切断が起きたら true */
  updateMelt(dt: number, heat: number, frame: HeadFrame): { cut: boolean; vanished: boolean } {
    if (this.mat.special !== 'melt' || this.destroyed) return { cut: false, vanished: false };
    this.melt = Math.min(1, this.melt + (dt + heat) / MELT.duration);
    this.widthScale = Math.max(0.2, 1 - MELT.widthLoss * this.melt);
    this.stiffness = this.mat.stiffness * (1 - MELT.stiffnessLoss * this.melt);
    this.shapeMatch = this.mat.shapeMatch * (1 - MELT.stiffnessLoss * this.melt);
    this.updateMasses();
    if (this.melt >= 1) {
      this.destroyed = true;
      return { cut: false, vanished: true };
    }
    const target = this.originalLength * (1 - MELT.lengthLoss * this.melt);
    const step = this.originalLength / MELT.lengthSteps;
    if (this.meltCutLength - target >= step && this.length > HORN.minLength * 0.4) {
      this.meltCutLength = target;
      // 先端から1ステップ分を溶かし落とす
      const r = this.cut(Math.max(8, this.length - step), frame);
      if (r.destroyed) return { cut: true, vanished: true };
      return { cut: true, vanished: false };
    }
    return { cut: false, vanished: false };
  }
}

/**
 * 中心線フレームでのバインディング → ワールド座標（物理・描画で共通）
 */
export function skinPoints(
  B: Binding[],
  X: ArrayLike<number>,
  Y: ArrayLike<number>,
  n: number,
  facing: number,
  ws: number,
  outX: { [i: number]: number },
  outY: { [i: number]: number },
) {
  const tx = new Float64Array(n);
  const ty = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    const dx = X[b] - X[a];
    const dy = Y[b] - Y[a];
    const l = Math.hypot(dx, dy) || 1;
    tx[i] = dx / l;
    ty[i] = dy / l;
  }
  for (let v = 0; v < B.length; v++) {
    const b = B[v];
    const s = Math.min(b.s, n - 2);
    const t = b.t;
    const px = X[s] + (X[s + 1] - X[s]) * t;
    const py = Y[s] + (Y[s + 1] - Y[s]) * t;
    let ux = tx[s] + (tx[s + 1] - tx[s]) * t;
    let uy = ty[s] + (ty[s + 1] - ty[s]) * t;
    const l = Math.hypot(ux, uy) || 1;
    ux /= l;
    uy /= l;
    const nx = -uy * facing;
    const ny = ux * facing;
    const a = b.a > 0 && s === n - 2 ? b.a * ws : b.a;
    outX[v] = px + ux * a + nx * b.d * ws;
    outY[v] = py + uy * a + ny * b.d * ws;
  }
}

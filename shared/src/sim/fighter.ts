/** 牛（ファイター）：体の移動、首の回転（PD制御）、チャージ攻撃の状態機械 */
import { CONTROL, COW, WORLD } from '../config/game';
import { MaterialId } from '../config/materials';
import { HornModel } from '../horn/model';
import { HeadFrame, HornBody } from '../physics/hornBody';
import { computeMaxHP } from './damage';

export type Phase = 'idle' | 'charge' | 'swing' | 'recover';
export const PHASES: Phase[] = ['idle', 'charge', 'swing', 'recover'];

export interface FighterInput {
  charge: boolean;
  /** 相手に向かって +1 / 後退 -1（後退中はガード） */
  move: -1 | 0 | 1;
}

export interface FighterStats {
  dealt: number;
  taken: number;
  recoilTaken: number;
  maxImpactSpeed: number;
  maxHit: number;
  hits: number;
  whipHits: number;
}

const REF_INERTIA = COW.headInertia + 1.6e5;

export class Fighter {
  idx: 0 | 1;
  facing: 1 | -1;
  x: number;
  vx = 0;
  theta = 0;
  omega = 0;
  phase: Phase = 'idle';
  phaseT = 0;
  charge = 0;
  swingCharge = 0;
  swingDur = 0;
  recoverDur = 0;
  input: FighterInput = { charge: false, move: 0 };
  hp: number;
  maxHp: number;
  baseMaxHp: number;
  material: MaterialId;
  horn: HornBody;
  guard = false;
  stun = 0;
  hitFlash = 0;
  /** 前サブステップの首位置（速度推定） */
  bob = 0;
  bodyPoly: number[] = [];
  headPoly: number[] = [];
  stats: FighterStats = { dealt: 0, taken: 0, recoilTaken: 0, maxImpactSpeed: 0, maxHit: 0, hits: 0, whipHits: 0 };
  cooldown = 0;
  heat = 0;
  name = '';

  constructor(idx: 0 | 1, model: HornModel, material: MaterialId, x: number) {
    this.idx = idx;
    this.facing = idx === 0 ? 1 : -1;
    this.x = x;
    this.material = material;
    this.horn = new HornBody(model, material, this.frame());
    this.baseMaxHp = computeMaxHP(this.horn.mat, model.stats);
    this.maxHp = this.baseMaxHp;
    this.hp = this.maxHp;
    this.updateShapes();
  }

  get pivotX() {
    return this.x + this.facing * COW.pivotX;
  }
  get pivotY() {
    return WORLD.groundY + COW.pivotY + this.bob;
  }

  frame(): HeadFrame {
    return { px: this.pivotX, py: this.pivotY, theta: this.theta, omega: this.omega, vx: this.vx, vy: 0, facing: this.facing };
  }

  inertia() {
    return COW.headInertia + this.horn.inertiaAboutPivot();
  }

  /** 操作入力 → 状態遷移（固定ステップごと） */
  updateControl(dt: number, active: boolean) {
    const inp = active ? this.input : { charge: false, move: 0 as const };
    this.phaseT += dt;
    this.stun = Math.max(0, this.stun - dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.cooldown = Math.max(0, this.cooldown - dt);
    switch (this.phase) {
      case 'idle':
        if (inp.charge && active) this.setPhase('charge');
        break;
      case 'charge':
        this.charge = Math.min(1, this.charge + dt / CONTROL.chargeTime);
        if (!inp.charge) this.release();
        break;
      case 'swing':
        if (this.phaseT >= this.swingDur) {
          this.recoverDur = CONTROL.recoverBase + CONTROL.recoverCharge * this.swingCharge;
          this.setPhase('recover');
        }
        break;
      case 'recover':
        if (this.phaseT >= this.recoverDur) this.setPhase('idle');
        break;
    }
    this.guard = active && inp.move < 0 && (this.phase === 'idle' || this.phase === 'recover');
    // 歩行
    const canWalk = this.phase !== 'swing';
    const want = canWalk ? inp.move * this.facing : 0;
    const maxV = COW.walkMax * (this.phase === 'charge' ? 0.45 : this.guard ? 0.8 : 1);
    if (want !== 0 && Math.abs(this.vx) <= maxV + 1) {
      this.vx += want * COW.walkAccel * dt;
      this.vx = Math.max(-maxV, Math.min(maxV, this.vx));
    } else {
      const fr = COW.friction * (this.phase === 'swing' ? 0.55 : 1) * dt;
      if (Math.abs(this.vx) <= fr) this.vx = 0;
      else this.vx -= Math.sign(this.vx) * fr;
    }
  }

  private setPhase(p: Phase) {
    this.phase = p;
    this.phaseT = 0;
    if (p === 'charge') this.charge = 0;
  }

  private release() {
    this.swingCharge = this.charge;
    this.swingDur = CONTROL.swingTimeBase + CONTROL.swingTimeCharge * this.charge;
    const lunge = COW.lungeBase + COW.lungeCharge * this.charge;
    this.vx = this.facing * Math.max(this.vx * this.facing, lunge);
    this.charge = 0;
    this.setPhase('swing');
  }

  /** 被弾でチャージが乱れる */
  flinch(damage: number) {
    this.stun = Math.max(this.stun, Math.min(0.5, 0.12 + damage / 400));
    this.hitFlash = 0.15;
    if (this.phase === 'charge' && damage > 50) this.charge = Math.max(0, this.charge - damage / 250);
  }

  /** 首と体の積分（サブステップ） */
  integrate(dt: number) {
    let target = 0;
    let kp: number = CONTROL.idleKp;
    let kd: number = CONTROL.idleKd;
    let amax: number = CONTROL.maxIdleAccel;
    if (this.phase === 'charge') target = CONTROL.chargeAngle * (0.25 + 0.75 * this.charge);
    else if (this.phase === 'swing') {
      target = CONTROL.swingAngle;
      kp = CONTROL.swingKp;
      kd = CONTROL.swingKd;
      amax = CONTROL.swingAccelBase + CONTROL.swingAccelCharge * this.swingCharge;
    }
    const ratio = Math.max(0.3, Math.min(2.2, REF_INERTIA / this.inertia()));
    let alpha = (kp * (target - this.theta) - kd * this.omega) * ratio;
    const lim = amax * ratio;
    alpha = Math.max(-lim, Math.min(lim, alpha));
    this.omega += alpha * dt;
    const wmax = this.phase === 'swing' ? CONTROL.maxOmegaBase + CONTROL.maxOmegaCharge * this.swingCharge : CONTROL.maxOmegaBase;
    this.omega = Math.max(-wmax * 1.6, Math.min(wmax * 1.6, this.omega));
    if (this.phase === 'swing') this.omega = Math.min(this.omega, wmax / Math.sqrt(Math.max(0.5, this.inertia() / REF_INERTIA)));
    this.theta += this.omega * dt;
    if (this.theta < CONTROL.thetaMin) {
      this.theta = CONTROL.thetaMin;
      if (this.omega < 0) this.omega *= -0.2;
    }
    if (this.theta > CONTROL.thetaMax) {
      this.theta = CONTROL.thetaMax;
      if (this.omega > 0) this.omega *= -0.2;
    }
    this.x += this.vx * dt;
    if (this.x < WORLD.arenaMinX) {
      this.x = WORLD.arenaMinX;
      this.vx = Math.max(0, this.vx);
    }
    if (this.x > WORLD.arenaMaxX) {
      this.x = WORLD.arenaMaxX;
      this.vx = Math.min(0, this.vx);
    }
    this.bob = this.phase === 'charge' ? 6 * this.charge : 0;
  }

  /** 首まわりに角速度インパルスを与える（反作用） */
  applyAngularImpulse(worldTorque: number) {
    this.omega += (this.facing * worldTorque) / this.inertia();
  }

  updateShapes() {
    const f = this.facing;
    const cy = WORLD.groundY + COW.bodyCenterY;
    const hw = COW.bodyHalfW;
    const hh = COW.bodyHalfH;
    const r = 18;
    const pts: number[] = [];
    const corners: [number, number, number][] = [
      [hw - r, -hh + r, -Math.PI / 2],
      [hw - r, hh - r, 0],
      [-hw + r, hh - r, Math.PI / 2],
      [-hw + r, -hh + r, Math.PI],
    ];
    for (const [ox, oy, a0] of corners) {
      for (let k = 0; k <= 2; k++) {
        const a = a0 + (k / 2) * (Math.PI / 2);
        pts.push(this.x + ox + Math.cos(a) * r, cy + oy + Math.sin(a) * r);
      }
    }
    this.bodyPoly = pts;
    const hp: number[] = [];
    const c = Math.cos(this.theta);
    const s = Math.sin(this.theta);
    const px = this.pivotX;
    const py = this.pivotY;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const lx = COW.headCX + Math.cos(a) * COW.headRX;
      const ly = COW.headCY + Math.sin(a) * COW.headRY;
      hp.push(px + f * (lx * c - ly * s), py + (lx * s + ly * c));
    }
    this.headPoly = hp;
  }

  /** 体の前面のx（相手側） */
  frontX() {
    return this.x + this.facing * COW.bodyHalfW;
  }
}

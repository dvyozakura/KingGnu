/**
 * ダメージ計算（すべてここに集約）
 *
 * 直接衝突ダメージ: 衝突インパルス J = 有効質量 × 法線方向の接近速度 × (1+反発)
 *                    × 硬度係数 × 衝突角度係数
 * しなり攻撃ダメージ: 接触点の速度のうち「頭と一体の剛体運動」で説明できない成分（＝しなり由来）
 *                    の運動エネルギー × 弾性
 * 反作用ダメージ   : 攻撃側が受ける。インパルス × 材質の反作用倍率 × 相手の硬さ
 *                    （物理的な押し返しは衝突解決で別途かかる。これはHP上の表現）
 */
import { DAMAGE } from '../config/game';
import { MaterialDef } from '../config/materials';
import { HornStats } from '../horn/model';
import { rigidity } from '../physics/hornBody';

export interface BodyHitInput {
  attacker: MaterialDef;
  /** 法線方向の接近速度 (px/s, >0) */
  closingSpeed: number;
  /** 相対速度の大きさ */
  relSpeed: number;
  /** しなり由来の速度（接触点の実速度 - 剛体速度） */
  flexSpeed: number;
  /** 接触点の局所質量 */
  localMass: number;
  /** 角全体の質量 */
  hornMass: number;
  headHit: boolean;
  targetGuarding: boolean;
  targetCharging: boolean;
  attackerCracked: boolean;
  /** 被弾側の硬さ（牛の体=0.3） */
  targetHardness: number;
}

export interface BodyHitResult {
  damage: number;
  direct: number;
  whip: number;
  recoil: number;
  impulse: number;
  effectiveMass: number;
}

export function effectiveMass(mat: MaterialDef, localMass: number, hornMass: number) {
  const r = rigidity(mat);
  return localMass + r * (hornMass * 0.6 + DAMAGE.headEquivMass);
}

/** テスト・バランス調整用のフック */
export const damageHooks: { onBodyHit?: (input: BodyHitInput, result: BodyHitResult) => void } = {};

export function computeBodyHit(h: BodyHitInput): BodyHitResult {
  const r = computeBodyHitInner(h);
  damageHooks.onBodyHit?.(h, r);
  return r;
}

function computeBodyHitInner(h: BodyHitInput): BodyHitResult {
  const zero = { damage: 0, direct: 0, whip: 0, recoil: 0, impulse: 0, effectiveMass: 0 };
  if (h.closingSpeed < DAMAGE.minClosingSpeed) return zero;
  const mEff = effectiveMass(h.attacker, h.localMass, h.hornMass);
  const impulse = mEff * h.closingSpeed * (1 + DAMAGE.bodyRestitution);
  // 正面から当たるほど威力が乗る
  const angle = Math.min(1, h.closingSpeed / Math.max(1, h.relSpeed));
  const hardF = 0.3 + h.attacker.hardness;
  let direct = DAMAGE.direct * impulse * hardF * (0.4 + 0.6 * angle);
  const flex = Math.max(0, h.flexSpeed - 120);
  let whip = DAMAGE.whip * 0.5 * h.localMass * flex * flex * h.attacker.elasticity * (0.5 + 0.5 * Math.sqrt(angle));
  let mult = 1;
  if (h.headHit) mult *= DAMAGE.headMultiplier;
  if (h.targetGuarding) mult *= DAMAGE.guardMultiplier;
  if (h.targetCharging) mult *= DAMAGE.chargingMultiplier;
  direct *= mult;
  whip *= mult;
  // 大きな一撃ほど伸びが鈍る飽和カーブ（順序は保ったまま極端な値を抑える）
  const raw = direct + whip;
  let damage = raw > 0 ? DAMAGE.softCap * (1 - Math.exp(-raw / DAMAGE.softCap)) : 0;
  const k = raw > 0 ? damage / raw : 0;
  direct *= k;
  whip *= k;
  damage = Math.min(DAMAGE.maxSingleDamage, damage);
  // しきい値付近はなだらかに
  const ramp = Math.min(1, (h.closingSpeed - DAMAGE.minClosingSpeed) / 120);
  damage *= ramp;
  let recoil =
    DAMAGE.recoil * impulse * h.attacker.recoilMultiplier * (0.4 + h.targetHardness) * (h.attackerCracked ? DAMAGE.crackedRecoilMultiplier : 1);
  if (h.targetGuarding) recoil *= DAMAGE.guardRecoilBonus;
  recoil *= ramp;
  return {
    damage: Math.round(damage),
    direct: Math.round(direct * ramp),
    whip: Math.round(whip * ramp),
    recoil: Math.round(recoil),
    impulse,
    effectiveMass: mEff,
  };
}

export interface ClashInput {
  matA: MaterialDef;
  matB: MaterialDef;
  closingSpeed: number;
  massA: number;
  massB: number;
  hornMassA: number;
  hornMassB: number;
  crackedA: boolean;
  crackedB: boolean;
}

export interface ClashResult {
  impulse: number;
  /** 角の構造へのストレス（ひび・破損判定用） */
  stressA: number;
  stressB: number;
  recoilA: number;
  recoilB: number;
}

/** 角同士の衝突 */
export function computeClash(c: ClashInput): ClashResult {
  if (c.closingSpeed < DAMAGE.minClosingSpeed * 0.7) return { impulse: 0, stressA: 0, stressB: 0, recoilA: 0, recoilB: 0 };
  const mA = effectiveMass(c.matA, c.massA, c.hornMassA);
  const mB = effectiveMass(c.matB, c.massB, c.hornMassB);
  const mRed = (mA * mB) / (mA + mB);
  const impulse = mRed * c.closingSpeed * 1.3;
  // 相手が硬いほど、自分が脆いほどストレスが大きい
  const sA = (DAMAGE.clashStress * impulse * (0.3 + c.matB.hardness)) / Math.max(0.15, c.matA.toughness);
  const sB = (DAMAGE.clashStress * impulse * (0.3 + c.matA.hardness)) / Math.max(0.15, c.matB.toughness);
  const rA = DAMAGE.clashRecoil * impulse * c.matA.recoilMultiplier * (0.3 + c.matB.hardness) * (c.crackedA ? DAMAGE.crackedRecoilMultiplier : 1);
  const rB = DAMAGE.clashRecoil * impulse * c.matB.recoilMultiplier * (0.3 + c.matA.hardness) * (c.crackedB ? DAMAGE.crackedRecoilMultiplier : 1);
  return { impulse, stressA: sA * (c.crackedA ? 1.6 : 1), stressB: sB * (c.crackedB ? 1.6 : 1), recoilA: Math.round(rA), recoilB: Math.round(rB) };
}

/** 被弾・自傷による角の構造ストレス（反作用の一部が角自身に返る） */
export function selfStressFromRecoil(mat: MaterialDef, impulse: number) {
  return (DAMAGE.clashStress * 0.6 * impulse * (0.3 + mat.hardness)) / Math.max(0.15, mat.toughness);
}

/** 最大HP：材質 × 形状補正（巨大化だけで無敵にならないよう上限付き） */
export function computeMaxHP(mat: MaterialDef, stats: HornStats): number {
  const areaF = Math.max(0.85, Math.min(1.18, 0.85 + (stats.area / 7000) * 0.33));
  const lenF = Math.max(0.94, Math.min(1.06, 1.06 - (stats.length - 60) / 1500));
  return Math.round(mat.maxHP * areaF * lenF);
}

/** ゲーム全体の定数（調整用） */

export const WORLD = {
  width: 1200,
  height: 675,
  groundY: 590,
  arenaMinX: 110,
  arenaMaxX: 1090,
} as const;

/** 物理は固定タイムステップ */
export const SIM_DT = 1 / 120;
export const MAX_STEPS_PER_UPDATE = 12;

export const MATCH = {
  duration: 90,
  countdown: 3,
  koSlowmo: 2.2,
  /** HP差がこの割合未満なら時間切れ引き分け */
  drawHpRatio: 0.02,
  /** 角の残り長さがこれ未満になると敗北 */
  hornLossRatio: 0.15,
} as const;

/** 角の形状処理 */
export const HORN = {
  nodes: 10,
  cell: 3,
  maxRadius: 240,
  maxArea: 16000,
  minLength: 40,
  minHalfWidth: 5,
  rootTolerance: 26,
  maxCleanVertices: 64,
  maxRawPoints: 600,
  /** 通信・保存時に受け付ける最大頂点数 */
  maxNetVertices: 160,
  coordLimit: 400,
} as const;

/** 牛の体格（facing-local 座標, x前方, y下向き） */
export const COW = {
  bodyHalfW: 74,
  bodyHalfH: 40,
  bodyCenterY: -86,
  pivotX: 60,
  pivotY: -112,
  headCX: 36,
  headCY: 10,
  headRX: 34,
  headRY: 27,
  /** 頭上の角の根元（pivot基準） */
  anchorX: 30,
  anchorY: -16,
  bodyMass: 60,
  headInertia: 4.0e4,
  minSeparation: 250,
  walkAccel: 1100,
  walkMax: 150,
  friction: 1500,
  lungeBase: 190,
  lungeCharge: 560,
} as const;

export const CONTROL = {
  chargeTime: 0.9,
  chargeAngle: -0.95,
  swingAngle: 1.15,
  swingTimeBase: 0.16,
  swingTimeCharge: 0.12,
  recoverBase: 0.22,
  recoverCharge: 0.42,
  idleKp: 70,
  idleKd: 13,
  swingKp: 260,
  swingKd: 10,
  swingAccelBase: 45,
  swingAccelCharge: 95,
  maxIdleAccel: 90,
  maxOmegaBase: 5.5,
  maxOmegaCharge: 5.5,
  thetaMin: -1.35,
  thetaMax: 1.55,
} as const;

/** ダメージ計算の係数（damage.ts から参照） */
export const DAMAGE = {
  minClosingSpeed: 140,
  direct: 0.0046,
  whip: 1.6e-5,
  recoil: 0.0011,
  bodyRestitution: 0.25,
  headMultiplier: 1.2,
  guardMultiplier: 0.62,
  /** 角で受けたときのダメージ倍率 */
  hornBlockMultiplier: 0.5,
  guardRecoilBonus: 1.25,
  chargingMultiplier: 1.15,
  headEquivMass: 26,
  episodeGap: 0.12,
  attackerCooldown: 0.18,
  maxSingleDamage: 300,
  softCap: 260,
  knockback: 1.0,
  clashStress: 0.0011,
  clashRecoil: 0.0005,
  crackedRecoilMultiplier: 1.5,
} as const;

export const MELT = {
  /** 何秒で完全に溶けるか（調整可能） */
  duration: 75,
  /** 被弾/衝突で溶けが進む量（秒換算） */
  impactHeat: 0.6,
  maxHpLoss: 0.55,
  widthLoss: 0.6,
  lengthLoss: 0.85,
  lengthSteps: 14,
  stiffnessLoss: 0.25,
} as const;

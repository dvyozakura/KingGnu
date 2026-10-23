/**
 * 材質パラメータ（バランス調整はこのファイルに集約）
 *
 * 物理的に異なる性質は分離して持つ:
 *  - hardness   : 硬度。直接打撃の威力、反作用の大きさに効く
 *  - stiffness  : 曲げ剛性（節点間の角度拘束の強さ 0..1）
 *  - shapeMatch : 全体の形状保持（根元フレームへの引き戻し 0..1）。硬い材質ほど剛体に近づく
 *  - elasticity : 弾性。しなり攻撃のエネルギー変換効率・反発
 *  - density    : 密度（面積あたり質量）
 *  - damping    : 振動減衰（内部減衰）
 *  - toughness  : 破壊への耐性（大きいほど割れにくい）
 *  - maxHP      : 基本最大HP（形状補正前）
 *  - recoilMultiplier : 反作用ダメージ倍率
 *  - coupling   : 角と頭の結合の剛さ。直接打撃で牛の体重がどれだけ乗るか（0..1）
 */
export type MaterialId = 'cork' | 'rubber' | 'plastic' | 'wood' | 'glass' | 'azuki';

export const MATERIAL_IDS: MaterialId[] = ['cork', 'rubber', 'plastic', 'wood', 'glass', 'azuki'];

export type SpecialEffect = 'absorb' | 'whip' | 'balanced' | 'crack' | 'shatter' | 'melt';

/** 角が限界に達したときの壊れ方 */
export type BreakMode = 'chip' | 'deform' | 'whiten' | 'snap' | 'shatter' | 'melt';

export interface MaterialDef {
  id: MaterialId;
  name: string;
  nameEn: string;
  description: string;
  hardness: number;
  stiffness: number;
  shapeMatch: number;
  elasticity: number;
  density: number;
  damping: number;
  toughness: number;
  maxHP: number;
  recoilMultiplier: number;
  coupling: number;
  /** 角の構造耐久値（局所破損の管理用。HPとは別） */
  integrity: number;
  /** この値以上の単発ストレスでひびが入る */
  crackStress: number;
  /** この値以上の単発ストレスで（ひび有りなら半分で）折れる/砕ける */
  breakStress: number;
  breakMode: BreakMode;
  special: SpecialEffect;
  /** 重力の影響係数（見た目の垂れ具合） */
  gravityScale: number;
  /** 描画色 */
  color: { fill: string; stroke: string; accent: string; alpha: number };
}

export const MATERIALS: Record<MaterialId, MaterialDef> = {
  cork: {
    id: 'cork',
    name: 'コルク',
    nameEn: 'CORK',
    description: '軽くて反応が速い。衝撃を吸収するので反作用は小さいが、重い相手との正面衝突に弱い。',
    hardness: 0.2,
    stiffness: 0.22,
    shapeMatch: 0.0,
    elasticity: 0.35,
    density: 0.32,
    damping: 0.32,
    toughness: 0.75,
    maxHP: 860,
    recoilMultiplier: 0.3,
    coupling: 0.3,
    integrity: 100,
    crackStress: 30,
    breakStress: 9999,
    breakMode: 'chip',
    special: 'absorb',
    gravityScale: 0.6,
    color: { fill: '#c9a26b', stroke: '#7a5a32', accent: '#a37b45', alpha: 1 },
  },
  rubber: {
    id: 'rubber',
    name: 'ゴム',
    nameEn: 'RUBBER',
    description: '鞭のように大きくしなる。タイミングよく振ると先端が加速して大ダメージ。直接打撃とHPは控えめ。',
    hardness: 0.22,
    stiffness: 0.12,
    shapeMatch: 0.0,
    elasticity: 0.95,
    density: 1.0,
    damping: 0.03,
    toughness: 1.0,
    maxHP: 900,
    recoilMultiplier: 0.12,
    coupling: 0.05,
    integrity: 100,
    crackStress: 9999,
    breakStress: 9999,
    breakMode: 'deform',
    special: 'whip',
    gravityScale: 0.45,
    color: { fill: '#e8553d', stroke: '#8f2a1b', accent: '#ff9a7a', alpha: 1 },
  },
  plastic: {
    id: 'plastic',
    name: 'プラスチック',
    nameEn: 'PLASTIC',
    description: 'しなりと直接打撃を両立するバランス型。初心者向け。強い衝撃で白化・変形する。',
    hardness: 0.5,
    stiffness: 0.28,
    shapeMatch: 0.02,
    elasticity: 0.62,
    density: 0.85,
    damping: 0.14,
    toughness: 0.7,
    maxHP: 1000,
    recoilMultiplier: 0.6,
    coupling: 0.42,
    integrity: 100,
    crackStress: 45,
    breakStress: 9999,
    breakMode: 'whiten',
    special: 'balanced',
    gravityScale: 0.6,
    color: { fill: '#3d8ee8', stroke: '#1b4f8f', accent: '#a9d3ff', alpha: 1 },
  },
  wood: {
    id: 'wood',
    name: '木',
    nameEn: 'WOOD',
    description: '安定した直接攻撃。中程度の重さ。過度な衝撃でひび割れ、限界を超えると折れる。',
    hardness: 0.68,
    stiffness: 0.42,
    shapeMatch: 0.1,
    elasticity: 0.38,
    density: 0.8,
    damping: 0.22,
    toughness: 0.6,
    maxHP: 1100,
    recoilMultiplier: 0.9,
    coupling: 0.66,
    integrity: 100,
    crackStress: 45,
    breakStress: 190,
    breakMode: 'snap',
    special: 'crack',
    gravityScale: 0.6,
    color: { fill: '#b8793e', stroke: '#5e3a17', accent: '#8c5524', alpha: 1 },
  },
  glass: {
    id: 'glass',
    name: 'ガラス',
    nameEn: 'GLASS',
    description: '非常に硬く一撃が重い。HPも高いが、強い衝撃でひび割れ、さらに強い衝撃で砕ける。反作用も大きい。',
    hardness: 0.9,
    stiffness: 0.985,
    shapeMatch: 0.88,
    elasticity: 0.2,
    density: 1.35,
    damping: 0.3,
    toughness: 0.25,
    maxHP: 1250,
    recoilMultiplier: 1.2,
    coupling: 0.9,
    integrity: 100,
    crackStress: 50,
    breakStress: 140,
    breakMode: 'shatter',
    special: 'shatter',
    gravityScale: 0.6,
    color: { fill: '#bfe9ff', stroke: '#5aa6c9', accent: '#ffffff', alpha: 0.55 },
  },
  azuki: {
    id: 'azuki',
    name: 'あずきのアイス',
    nameEn: 'AZUKI ICE',
    description: '全材質で最も硬くHPも極めて高い隠しボス級。ただし戦闘中ずっと溶け続け、細く短くなり、最後は消える。',
    hardness: 1.0,
    stiffness: 0.995,
    shapeMatch: 0.95,
    elasticity: 0.12,
    density: 1.15,
    damping: 0.35,
    toughness: 0.8,
    maxHP: 1500,
    recoilMultiplier: 1.15,
    coupling: 1.0,
    integrity: 100,
    crackStress: 55,
    breakStress: 180,
    breakMode: 'melt',
    special: 'melt',
    gravityScale: 0.6,
    color: { fill: '#7b4a5e', stroke: '#3e1f2c', accent: '#b98aa0', alpha: 1 },
  },
};

/** 材質カード比較用の 0..1 指標（UI表示） */
export function materialBars(id: MaterialId) {
  const m = MATERIALS[id];
  const maxHp = Math.max(...MATERIAL_IDS.map((k) => MATERIALS[k].maxHP));
  const maxRecoil = Math.max(...MATERIAL_IDS.map((k) => MATERIALS[k].recoilMultiplier));
  return {
    hardness: m.hardness,
    flex: Math.max(0.03, Math.min(1, 1 - (m.stiffness - 0.12) / 0.45) * (1 - m.shapeMatch)),
    hp: m.maxHP / maxHp,
    recoil: m.recoilMultiplier / maxRecoil,
  };
}

export function isMaterialId(v: unknown): v is MaterialId {
  return typeof v === 'string' && (MATERIAL_IDS as string[]).includes(v);
}

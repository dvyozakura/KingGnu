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
 *  - speed      : 移動・攻撃の速さの倍率（コルク＞炎＞プラスチック＞木＞珊瑚＞ゴム＞金＞ガラス＞あずきのアイス＞鉄）
 *  - coupling   : 角と頭の結合の剛さ。直接打撃で牛の体重がどれだけ乗るか（0..1）
 */
export type MaterialId = 'cork' | 'rubber' | 'plastic' | 'wood' | 'glass' | 'azuki' | 'fire' | 'iron' | 'gold' | 'coral';

export const MATERIAL_IDS: MaterialId[] = ['cork', 'rubber', 'plastic', 'wood', 'glass', 'azuki', 'fire', 'iron', 'gold', 'coral'];

export type SpecialEffect = 'absorb' | 'whip' | 'balanced' | 'crack' | 'shatter' | 'melt' | 'burn' | 'heavy' | 'bend' | 'reef';

/** 角が限界に達したときの壊れ方（none: 壊れない / bend: 硬いものに叩かれると曲がったまま戻らない） */
export type BreakMode = 'chip' | 'deform' | 'whiten' | 'snap' | 'shatter' | 'melt' | 'none' | 'bend';

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
  speed: number;
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
  /** 図説・材質選択に出す特性（短文） */
  traits: string[];
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
    speed: 1.3,
    integrity: 100,
    crackStress: 30,
    breakStress: 9999,
    breakMode: 'chip',
    special: 'absorb',
    gravityScale: 0.6,
    color: { fill: '#c9a26b', stroke: '#7a5a32', accent: '#a37b45', alpha: 1 },
    traits: ['軽くて最速', '反作用が小さい', '強い衝撃で欠ける', 'あずきに触れると溶かす'],
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
    speed: 0.9,
    integrity: 100,
    crackStress: 9999,
    breakStress: 9999,
    breakMode: 'deform',
    special: 'whip',
    gravityScale: 0.45,
    color: { fill: '#e8553d', stroke: '#8f2a1b', accent: '#ff9a7a', alpha: 1 },
    traits: ['鞭のようにしなる', '先端が加速してしなりダメージ', '壊れない', '珊瑚に弱い'],
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
    speed: 1.15,
    integrity: 100,
    crackStress: 45,
    breakStress: 9999,
    breakMode: 'whiten',
    special: 'balanced',
    gravityScale: 0.6,
    color: { fill: '#3d8ee8', stroke: '#1b4f8f', accent: '#a9d3ff', alpha: 1 },
    traits: ['しなりと打撃のバランス型', '強い衝撃で白化・少し変形'],
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
    speed: 1.0,
    integrity: 100,
    crackStress: 45,
    breakStress: 190,
    breakMode: 'snap',
    special: 'crack',
    gravityScale: 0.6,
    color: { fill: '#b8793e', stroke: '#5e3a17', accent: '#8c5524', alpha: 1 },
    traits: ['安定した打撃', 'ひび割れ → 折れる'],
  },
  glass: {
    id: 'glass',
    name: 'ガラス',
    nameEn: 'GLASS',
    description: '非常に硬く一撃が重い。HPも高い。炎が効かない。強い衝撃でひび割れ、さらに強い衝撃で砕ける。',
    hardness: 0.9,
    stiffness: 0.985,
    shapeMatch: 0.88,
    elasticity: 0.2,
    density: 1.35,
    damping: 0.3,
    toughness: 0.4,
    maxHP: 1300,
    recoilMultiplier: 0.85,
    coupling: 0.9,
    speed: 0.8,
    integrity: 100,
    crackStress: 65,
    breakStress: 185,
    breakMode: 'shatter',
    special: 'shatter',
    gravityScale: 0.6,
    color: { fill: '#bfe9ff', stroke: '#5aa6c9', accent: '#ffffff', alpha: 0.55 },
    traits: ['硬く一撃が重い', '炎が効かない', 'ひび割れ → 砕ける'],
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
    speed: 0.7,
    integrity: 100,
    crackStress: 55,
    breakStress: 180,
    breakMode: 'melt',
    special: 'melt',
    gravityScale: 0.6,
    color: { fill: '#7b4a5e', stroke: '#3e1f2c', accent: '#b98aa0', alpha: 1 },
    traits: ['最硬・最大HP', '時間とともに溶けて細く短くなる', '炎・コルクで溶けが加速'],
  },
  fire: {
    id: 'fire',
    name: '炎',
    nameEn: 'FIRE',
    description: '燃えさかる角。打撃は軽いが、触れた相手を焼いてダメージを与え、しばらく燃やし続ける。ガラスには効かない。',
    hardness: 0.12,
    stiffness: 0.3,
    shapeMatch: 0.0,
    elasticity: 0.3,
    density: 0.3,
    damping: 0.4,
    toughness: 1.0,
    maxHP: 950,
    recoilMultiplier: 0.08,
    coupling: 0.15,
    speed: 1.2,
    integrity: 100,
    crackStress: 9999,
    breakStress: 9999,
    breakMode: 'none',
    special: 'burn',
    gravityScale: -0.25,
    color: { fill: '#ff7a1a', stroke: '#b3260b', accent: '#ffe36b', alpha: 0.92 },
    traits: ['触れるだけで接触ダメージ', '当てた相手を数秒燃やす', 'ガラスには無効', 'あずきを溶かす', '打撃は軽い'],
  },
  iron: {
    id: 'iron',
    name: '鉄',
    nameEn: 'IRON',
    description: '溶けないあずきのアイス。めちゃくちゃ硬くて重いが、叩いた反動がとても大きい。動きも一番遅い。',
    hardness: 1.0,
    stiffness: 0.995,
    shapeMatch: 0.95,
    elasticity: 0.1,
    density: 1.5,
    damping: 0.35,
    toughness: 1.0,
    maxHP: 1300,
    recoilMultiplier: 3.5,
    coupling: 1.0,
    speed: 0.62,
    integrity: 100,
    crackStress: 9999,
    breakStress: 9999,
    breakMode: 'none',
    special: 'heavy',
    gravityScale: 0.6,
    color: { fill: '#6f7780', stroke: '#2d3238', accent: '#c5ccd4', alpha: 1 },
    traits: ['最硬クラス・溶けない', '壊れない', '反動ダメージが特大', '全材質で最も遅い'],
  },
  gold: {
    id: 'gold',
    name: '金',
    nameEn: 'GOLD',
    description: '重くて柔らかい金属。硬い角に叩かれるとグニャリと曲がり、そのままの形で戦い続ける。',
    hardness: 0.6,
    stiffness: 0.6,
    shapeMatch: 0.35,
    elasticity: 0.2,
    density: 1.6,
    damping: 0.3,
    toughness: 1.0,
    maxHP: 1300,
    recoilMultiplier: 0.45,
    coupling: 0.6,
    speed: 0.85,
    integrity: 100,
    crackStress: 9999,
    breakStress: 9999,
    breakMode: 'bend',
    special: 'bend',
    gravityScale: 0.6,
    color: { fill: '#e6b422', stroke: '#8a6508', accent: '#fff2a8', alpha: 1 },
    traits: ['重く打撃が重い', '反動は控えめ', '硬い角に叩かれると曲がる（戻らない）', '折れない'],
  },
  coral: {
    id: 'coral',
    name: '珊瑚',
    nameEn: 'CORAL',
    description: 'ザラザラした硬い骨格。ゴムを引き裂くので、ゴム相手に大ダメージ。強い衝撃でポキッと折れる。',
    hardness: 0.7,
    stiffness: 0.9,
    shapeMatch: 0.6,
    elasticity: 0.25,
    density: 0.9,
    damping: 0.25,
    toughness: 0.5,
    maxHP: 1050,
    recoilMultiplier: 0.75,
    coupling: 0.78,
    speed: 0.95,
    integrity: 100,
    crackStress: 55,
    breakStress: 200,
    breakMode: 'snap',
    special: 'reef',
    gravityScale: 0.6,
    color: { fill: '#ff8a80', stroke: '#a23b3b', accent: '#ffd1c9', alpha: 1 },
    traits: ['ゴム相手にダメージ大幅アップ', '硬めの打撃型', 'ひび割れ → 折れる'],
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
    speed: (m.speed - 0.5) / (Math.max(...MATERIAL_IDS.map((k) => MATERIALS[k].speed)) - 0.5),
  };
}

/** オンライン対戦で一時的に使用禁止の材質（サーバーでも拒否する） */
export const ONLINE_BANNED: MaterialId[] = ['rubber'];

export function isOnlineAllowed(id: MaterialId): boolean {
  return !ONLINE_BANNED.includes(id);
}

export function isMaterialId(v: unknown): v is MaterialId {
  return typeof v === 'string' && (MATERIAL_IDS as string[]).includes(v);
}

/**
 * 材質どうしの相性（図説に表示する。実際の処理は sim/match.ts・sim/damage.ts）
 * a の角が b に対して働く効果
 */
export const MATERIAL_MATCHUPS: { a: MaterialId; b: MaterialId | '*'; text: string }[] = [
  { a: 'fire', b: '*', text: '炎の角に触れると燃える（接触ダメージ＋数秒の延焼）' },
  { a: 'fire', b: 'glass', text: 'ガラスは燃えない（接触ダメージ無効）' },
  { a: 'fire', b: 'azuki', text: '触れている間、あずきのアイスがどんどん溶ける' },
  { a: 'cork', b: 'azuki', text: '触れている間・ぶつかったとき、あずきのアイスの溶ける速度が大きく上がる' },
  { a: 'coral', b: 'rubber', text: 'ゴムへのダメージが大幅アップ' },
  { a: 'gold', b: '*', text: '硬い角（木・ガラス・あずき・鉄・珊瑚など）とぶつかると曲がる' },
  { a: 'iron', b: '*', text: '当てるたびに大きな反動ダメージを受ける' },
];

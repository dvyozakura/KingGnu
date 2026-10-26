/**
 * アカウント・課金・エメラルド・スキン・レート戦の設定（クライアントとサーバー共通）
 * 実際の付与・消費はすべてサーバーが行う（クライアントの申告は信用しない）。
 */
import { MATERIAL_IDS, MaterialId } from './materials';

/** 最初から使える材質 */
export const FREE_MATERIALS: MaterialId[] = ['plastic', 'wood', 'rubber'];
/** 材質1つの解放に必要なエメラルド */
export const MATERIAL_UNLOCK_COST = 20;
/** ログインボーナス（1日1回、日本時間で日付が変わったら） */
export const DAILY_BONUS = 10;
/** 角の保存枠 */
export const HORN_SLOTS_FREE = 2;
export const HORN_SLOTS_PREMIUM = 8;

/* ---------------- 課金アイテム ---------------- */

export type ProductId = 'kinghorn.emerald100' | 'kinghorn.slots8' | 'kinghorn.noads';

export interface ProductDef {
  id: ProductId;
  name: string;
  description: string;
  /** 表示用の目安価格（実際の価格はストアの表示に従う） */
  priceJpy: number;
  /** consumable: 何度でも買える / nonconsumable: 一度買えばずっと有効 */
  kind: 'consumable' | 'nonconsumable';
  emeralds?: number;
}

export const PRODUCTS: Record<ProductId, ProductDef> = {
  'kinghorn.emerald100': { id: 'kinghorn.emerald100', name: 'エメラルド ×100', description: '材質の解放やスキンに使えます', priceJpy: 120, kind: 'consumable', emeralds: 100 },
  'kinghorn.slots8': { id: 'kinghorn.slots8', name: '角の保存枠 8つに拡張', description: `保存できる角が ${HORN_SLOTS_FREE} → ${HORN_SLOTS_PREMIUM} つになります`, priceJpy: 360, kind: 'nonconsumable' },
  'kinghorn.noads': { id: 'kinghorn.noads', name: '広告削除', description: '試合後の広告が出なくなります', priceJpy: 120, kind: 'nonconsumable' },
};
export const PRODUCT_IDS = Object.keys(PRODUCTS) as ProductId[];

export function isProductId(v: unknown): v is ProductId {
  return typeof v === 'string' && v in PRODUCTS;
}

/* ---------------- 牛のスキン（見た目だけ。能力差なし） ---------------- */

export type SkinPattern = 'holstein' | 'plain' | 'dots' | 'stripes' | 'panda' | 'stars';

export interface SkinDef {
  id: string;
  name: string;
  price: number;
  body: [string, string];
  spot: string;
  pattern: SkinPattern;
  snout: string;
  leg: string;
  hoof: string;
}

export const DEFAULT_SKIN = 'holstein';
export const SKIN_PRICE = 100;

export const SKINS: SkinDef[] = [
  { id: 'holstein', name: 'ホルスタイン', price: 0, body: ['#fffdf8', '#e4ddd0'], spot: '#2f2925', pattern: 'holstein', snout: '#f3a8a0', leg: '#efe9df', hoof: '#3a302a' },
  { id: 'jersey', name: 'ジャージー', price: SKIN_PRICE, body: ['#d9a46a', '#b47a40'], spot: '#8a5a2b', pattern: 'plain', snout: '#3b2a20', leg: '#c8925a', hoof: '#2a1d14' },
  { id: 'wagyu', name: '黒毛', price: SKIN_PRICE, body: ['#3a3532', '#1d1a18'], spot: '#000000', pattern: 'plain', snout: '#6d5f5a', leg: '#2b2725', hoof: '#111111' },
  { id: 'strawberry', name: 'いちごミルク', price: SKIN_PRICE, body: ['#ffe3ea', '#f6bccb'], spot: '#e8476b', pattern: 'dots', snout: '#ff9db3', leg: '#ffd3de', hoof: '#b8324f' },
  { id: 'panda', name: 'パンダ', price: SKIN_PRICE, body: ['#ffffff', '#e9e9e9'], spot: '#1e1e1e', pattern: 'panda', snout: '#d9d9d9', leg: '#1e1e1e', hoof: '#000000' },
  { id: 'zebra', name: 'しまうま', price: SKIN_PRICE, body: ['#ffffff', '#ececec'], spot: '#151515', pattern: 'stripes', snout: '#3a3a3a', leg: '#f2f2f2', hoof: '#111111' },
  { id: 'golden', name: '金ピカ', price: SKIN_PRICE, body: ['#ffe27a', '#d9a514'], spot: '#b8860b', pattern: 'dots', snout: '#ffcf6b', leg: '#f5cf3c', hoof: '#8a6508' },
  { id: 'galaxy', name: '星空', price: SKIN_PRICE, body: ['#3b3f8f', '#1b1d4a'], spot: '#fff6b0', pattern: 'stars', snout: '#8c8fe0', leg: '#2c2f6e', hoof: '#0d0e26' },
];
export const SKIN_IDS = SKINS.map((s) => s.id);

export function skinDef(id: string | undefined): SkinDef {
  return SKINS.find((s) => s.id === id) ?? SKINS[0];
}

export function isSkinId(v: unknown): v is string {
  return typeof v === 'string' && SKIN_IDS.includes(v);
}

/* ---------------- プロフィール ---------------- */

export type AuthProvider = 'guest' | 'apple' | 'google';

export interface SavedHornSlot {
  name: string;
  material: MaterialId;
  vertices: [number, number][];
  savedAt: number;
}

/** クライアントに見せるプロフィール（サーバーが正） */
export interface Profile {
  id: string;
  name: string;
  emeralds: number;
  materials: MaterialId[];
  skins: string[];
  skin: string;
  slots: number;
  horns: (SavedHornSlot | null)[];
  noAds: boolean;
  rating: number;
  ranked: { games: number; wins: number; losses: number; draws: number };
  providers: AuthProvider[];
}

export function ownsMaterial(p: Pick<Profile, 'materials'> | null | undefined, m: MaterialId): boolean {
  return FREE_MATERIALS.includes(m) || !!p?.materials.includes(m);
}

export function lockedMaterials(p: Pick<Profile, 'materials'> | null | undefined): MaterialId[] {
  return MATERIAL_IDS.filter((m) => !ownsMaterial(p, m));
}

/** 日本時間の日付（ログインボーナスの判定用） */
export function jstDay(now: number): string {
  return new Date(now + 9 * 3600_000).toISOString().slice(0, 10);
}

/* ---------------- レート戦 ---------------- */

export const RATING = {
  initial: 1500,
  k: 32,
  min: 100,
  /** マッチングで許容するレート差（待ち時間とともに広がる） */
  baseWindow: 100,
  windowPerSec: 25,
  /** この時間内に人間の相手が見つからなければ CPU と対戦（ms、範囲内でランダム） */
  botAfterMs: [7000, 14000] as [number, number],
} as const;

/** Elo レーティング。score: 1=勝ち 0.5=引き分け 0=負け */
export function eloDelta(mine: number, opp: number, score: 0 | 0.5 | 1, k: number = RATING.k): number {
  const expected = 1 / (1 + Math.pow(10, (opp - mine) / 400));
  return Math.round(k * (score - expected));
}

/** レート戦の CPU に使う名前（人間のプレイヤーと同じように表示する） */
export const BOT_NAMES = [
  'ごくろう', 'くどしん', 'うしまる', 'つのっち', 'モーモー', 'ひろ', 'ゆうと', 'あおい', 'さくら', 'ケンタ',
  'たけし', 'みゆ', 'りく', 'はると', 'こはる', 'そら', 'Taro', 'mikan', 'Kei', 'nana', 'ushi_king', 'tsuno',
  'hornet', 'beef', 'ぎゅうたん', 'ミルク', 'まきば', 'ぼくじょう', 'カウボーイ', 'ベコ',
];

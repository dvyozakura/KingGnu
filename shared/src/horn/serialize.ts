/**
 * 角データのJSONシリアライズと検証
 * 能力値（HP・硬度など）は保存しない。読み込み側（サーバー）が材質と形状から再計算する。
 */
import { HORN } from '../config/game';
import { MaterialId, isMaterialId } from '../config/materials';
import { Poly, Pt } from '../geometry/polygon';

export const HORN_DATA_VERSION = 1;

export interface HornData {
  version: number;
  name: string;
  material: MaterialId;
  /** 角ローカル座標（根元=(0,0), x=前方, y=下向き）の閉じた輪郭 */
  vertices: Pt[];
}

export interface ValidationResult<T> {
  ok: boolean;
  value?: T;
  error?: string;
}

export function sanitizeName(raw: unknown, fallback: string, max = 20): string {
  if (typeof raw !== 'string') return fallback;
  // 制御文字・山括弧を除去
  const s = raw.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max);
  return s || fallback;
}

/** 外部から来た角データを検証（改ざんされたステータス等は無視・拒否） */
export function validateHornData(input: unknown): ValidationResult<HornData> {
  if (!input || typeof input !== 'object') return { ok: false, error: 'データ形式が不正です' };
  const o = input as Record<string, unknown>;
  if (o.version !== HORN_DATA_VERSION) return { ok: false, error: '未対応のバージョンです' };
  if (!isMaterialId(o.material)) return { ok: false, error: '材質が不正です' };
  const v = o.vertices;
  if (!Array.isArray(v)) return { ok: false, error: '頂点データがありません' };
  if (v.length < 3 || v.length > HORN.maxNetVertices) return { ok: false, error: `頂点数は3〜${HORN.maxNetVertices}にしてください` };
  const verts: Pt[] = [];
  for (const p of v) {
    if (!Array.isArray(p) || p.length !== 2) return { ok: false, error: '頂点の形式が不正です' };
    const x = p[0];
    const y = p[1];
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y))
      return { ok: false, error: '頂点座標が不正です' };
    if (Math.abs(x) > HORN.coordLimit || Math.abs(y) > HORN.coordLimit) return { ok: false, error: '角が大きすぎます' };
    verts.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
  }
  const known = new Set(['version', 'name', 'material', 'vertices', 'createdAt']);
  const extras = Object.keys(o).filter((k) => !known.has(k));
  if (extras.some((k) => /hp|hard|stiff|damage|power|stat/i.test(k)))
    return { ok: false, error: '能力値の直接指定は受け付けません（形状と材質から自動計算されます）' };
  return {
    ok: true,
    value: { version: HORN_DATA_VERSION, name: sanitizeName(o.name, 'My Horn', 24), material: o.material, vertices: verts },
  };
}

export function hornDataToJSON(h: HornData): string {
  return JSON.stringify({ version: h.version, name: h.name, material: h.material, vertices: h.vertices }, null, 2);
}

export function makeHornData(name: string, material: MaterialId, poly: Poly): HornData {
  return { version: HORN_DATA_VERSION, name: sanitizeName(name, 'My Horn', 24), material, vertices: poly.map(([x, y]) => [x, y]) };
}

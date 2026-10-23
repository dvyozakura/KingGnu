/** 角のテンプレート（初心者用・CPU用プリセット） */
import { Poly, Pt } from '../geometry/polygon';

export interface HornTemplate {
  id: string;
  name: string;
  build: () => Poly;
}

/** 中心線と幅プロファイルから輪郭を生成 */
export function strokeOutline(center: Pt[], width: (t: number) => number, samples = 28): Poly {
  // Catmull-Rom で中心線を補間
  const pts: Pt[] = [];
  const c = center;
  for (let i = 0; i < samples; i++) {
    const u = (i / (samples - 1)) * (c.length - 1);
    const k = Math.min(c.length - 2, Math.floor(u));
    const t = u - k;
    const p0 = c[Math.max(0, k - 1)];
    const p1 = c[k];
    const p2 = c[k + 1];
    const p3 = c[Math.min(c.length - 1, k + 2)];
    const t2 = t * t;
    const t3 = t2 * t;
    const f = (a: number, b: number, cc: number, d: number) =>
      0.5 * (2 * b + (-a + cc) * t + (2 * a - 5 * b + 4 * cc - d) * t2 + (-a + 3 * b - 3 * cc + d) * t3);
    pts.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
  }
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    let tx = b[0] - a[0];
    let ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1;
    tx /= l;
    ty /= l;
    const w = width(i / (pts.length - 1)) / 2;
    left.push([pts[i][0] - ty * w, pts[i][1] + tx * w]);
    right.push([pts[i][0] + ty * w, pts[i][1] - tx * w]);
  }
  return [...left, ...right.reverse()].map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as Pt);
}

const taper = (base: number, tip = 4) => (t: number) => base * (1 - t) + tip * t;

export const HORN_TEMPLATES: HornTemplate[] = [
  {
    id: 'classic',
    name: 'クラシック',
    build: () =>
      strokeOutline(
        [
          [0, 4],
          [22, -30],
          [55, -62],
          [95, -78],
        ],
        taper(34, 6),
      ),
  },
  {
    id: 'spear',
    name: 'ロングスピア',
    build: () =>
      strokeOutline(
        [
          [0, 2],
          [60, -20],
          [130, -38],
          [190, -50],
        ],
        taper(26, 5),
      ),
  },
  {
    id: 'hook',
    name: 'フック',
    build: () =>
      strokeOutline(
        [
          [0, 4],
          [28, -50],
          [70, -96],
          [118, -96],
          [130, -62],
          [110, -42],
        ],
        taper(30, 8),
        36,
      ),
  },
  {
    id: 'stub',
    name: 'ショート',
    build: () =>
      strokeOutline(
        [
          [0, 4],
          [24, -18],
          [52, -30],
        ],
        taper(38, 10),
      ),
  },
  {
    id: 'whip',
    name: 'ウィップ',
    build: () =>
      strokeOutline(
        [
          [0, 3],
          [40, -40],
          [90, -60],
          [140, -50],
          [185, -70],
        ],
        taper(22, 7),
        34,
      ),
  },
  {
    id: 'club',
    name: 'こん棒',
    build: () =>
      strokeOutline(
        [
          [0, 2],
          [40, -30],
          [80, -55],
          [110, -70],
        ],
        (t) => 18 + 34 * t * t,
      ),
  },
  {
    id: 'antler',
    name: 'アントラー',
    build: () => {
      // 枝分かれは和集合で表現するため、ここでは代表的な1本＋枝を1つの輪郭にまとめる
      const main = strokeOutline(
        [
          [0, 2],
          [30, -45],
          [55, -95],
          [80, -140],
        ],
        taper(26, 6),
      );
      return main;
    },
  },
];

export const ANTLER_BRANCH: Poly = strokeOutline(
  [
    [40, -60],
    [80, -78],
    [118, -80],
  ],
  taper(16, 5),
  14,
);

export function templateStrokes(id: string): Poly[] {
  const t = HORN_TEMPLATES.find((h) => h.id === id) ?? HORN_TEMPLATES[0];
  if (t.id === 'antler') return [t.build(), ANTLER_BRANCH];
  return [t.build()];
}

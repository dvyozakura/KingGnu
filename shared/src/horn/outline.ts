/**
 * 手描き輪郭 → 物理演算に使えるクリーンな単純多角形 への変換
 *  - 点列の重複除去 / サイズ制限（根元からの最大半径・最大面積）
 *  - 非ゼロ巻き数でラスタ化 → 自己交差・ねじれを「塗り」として解釈して解消
 *  - 根元（牛の頭）につながらない部分を除去、根元が少し外れていれば橋渡し
 *  - 極端に細い部分を最小太さまで補正
 *  - 外周追跡 → 平滑化 → 簡略化（頂点数上限）→ 単純多角形チェック
 */
import { HORN } from '../config/game';
import {
  Grid,
  Poly,
  Pt,
  chaikin,
  dijkstra,
  distanceTransform,
  fillHoles,
  isSimple,
  keepComponent,
  makeGrid,
  rasterizeNonZero,
  rdpClosed,
  removeDuplicates,
  signedArea,
  traceOuterContour,
} from '../geometry/polygon';

export interface OutlineResult {
  ok: boolean;
  polygon: Poly;
  error?: string;
  warnings: string[];
}

export function cellIndexOf(g: Grid, x: number, y: number): [number, number] {
  return [Math.floor((x - g.x0) / g.cell), Math.floor((y - g.y0) / g.cell)];
}

export function paintDisk(g: Grid, x: number, y: number, r: number) {
  const [ci, cj] = cellIndexOf(g, x, y);
  const rc = Math.ceil(r / g.cell) + 1;
  for (let j = cj - rc; j <= cj + rc; j++) {
    for (let i = ci - rc; i <= ci + rc; i++) {
      if (i < 0 || j < 0 || i >= g.w || j >= g.h) continue;
      const cx = g.x0 + (i + 0.5) * g.cell;
      const cy = g.y0 + (j + 0.5) * g.cell;
      if ((cx - x) ** 2 + (cy - y) ** 2 <= r * r) g.data[j * g.w + i] = 1;
    }
  }
}

function paintCapsule(g: Grid, ax: number, ay: number, bx: number, by: number, r: number) {
  const len = Math.hypot(bx - ax, by - ay);
  const steps = Math.max(1, Math.ceil(len / (g.cell * 0.5)));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    paintDisk(g, ax + (bx - ax) * t, ay + (by - ay) * t, r);
  }
}

/** 根元セル（なければ許容範囲内で最寄りの塗りセル）を探す */
export function findRootCell(g: Grid, tolerance: number): { k: number; bridged: Pt | null } | null {
  const [ri, rj] = cellIndexOf(g, 0, 0);
  if (ri >= 0 && rj >= 0 && ri < g.w && rj < g.h && g.data[rj * g.w + ri]) return { k: rj * g.w + ri, bridged: null };
  let best = -1;
  let bestD = Infinity;
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      if (!g.data[j * g.w + i]) continue;
      const cx = g.x0 + (i + 0.5) * g.cell;
      const cy = g.y0 + (j + 0.5) * g.cell;
      const d = Math.hypot(cx, cy);
      if (d < bestD) {
        bestD = d;
        best = j * g.w + i;
      }
    }
  }
  if (best < 0 || bestD > tolerance) return null;
  const i = best % g.w;
  const j = (best / g.w) | 0;
  return { k: best, bridged: [g.x0 + (i + 0.5) * g.cell, g.y0 + (j + 0.5) * g.cell] };
}

/** 根元から最も遠い（測地距離）セルへの「中央寄り」経路 */
export function medialPath(g: Grid, rootK: number, dt?: Float32Array): { path: Pt[]; dt: Float32Array } {
  const d = dt ?? distanceTransform(g);
  const geo = dijkstra(g, rootK, () => 1);
  let tip = rootK;
  let far = -1;
  for (let k = 0; k < geo.dist.length; k++) {
    const v = geo.dist[k];
    if (v !== Infinity && v > far) {
      far = v;
      tip = k;
    }
  }
  const med = dijkstra(g, rootK, (k) => 1 + 5 / (d[k] + 0.35));
  const cells: number[] = [];
  let k = tip;
  let guard = 0;
  while (k >= 0 && guard++ < g.w * g.h) {
    cells.push(k);
    if (k === rootK) break;
    k = med.prev[k];
  }
  cells.reverse();
  const path: Pt[] = cells.map((c) => [g.x0 + ((c % g.w) + 0.5) * g.cell, g.y0 + (((c / g.w) | 0) + 0.5) * g.cell]);
  return { path, dt: d };
}

export function pathLength(path: Pt[]): number {
  let L = 0;
  for (let i = 1; i < path.length; i++) L += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  return L;
}

/** グリッドから単純多角形（頂点数上限付き）を得る */
export function polygonFromGrid(g: Grid, maxVerts: number = HORN.maxCleanVertices): Poly | null {
  const raw = traceOuterContour(g);
  if (raw.length < 3) return null;
  const smooth = chaikin(raw, 2);
  let eps = g.cell * 0.45;
  let best: Poly | null = null;
  for (let iter = 0; iter < 24; iter++) {
    const s = rdpClosed(smooth, eps);
    if (s.length >= 3 && s.length <= maxVerts && isSimple(s)) {
      best = s;
      break;
    }
    eps *= 1.25;
  }
  if (!best) {
    // フォールバック：生の外周を強めに簡略化
    let e = g.cell;
    for (let iter = 0; iter < 30 && !best; iter++) {
      const s = rdpClosed(raw, e);
      if (s.length >= 3 && s.length <= maxVerts && isSimple(s)) best = s;
      e *= 1.3;
    }
  }
  if (!best) return null;
  if (signedArea(best) < 0) best.reverse();
  return best.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10] as Pt);
}

function boundsOf(polys: Poly[]) {
  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;
  for (const p of polys)
    for (const [x, y] of p) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  return { minX, minY, maxX, maxY };
}

function rasterize(polys: Poly[]): Grid {
  const b = boundsOf(polys);
  const pad = HORN.minHalfWidth * 2 + HORN.rootTolerance;
  const g = makeGrid(b.minX - pad, b.minY - pad, b.maxX + pad, b.maxY + pad, HORN.cell, 2);
  for (const p of polys) {
    const before = g.data.reduce((a, v) => a + v, 0);
    rasterizeNonZero(g, p);
    const added = g.data.reduce((a, v) => a + v, 0) - before;
    // 線のように潰れた輪郭は、なぞった線そのものを最小太さで角とみなす
    let perim = 0;
    for (let i = 0; i < p.length; i++) perim += Math.hypot(p[(i + 1) % p.length][0] - p[i][0], p[(i + 1) % p.length][1] - p[i][1]);
    if (added * g.cell < perim * 0.6) {
      for (let i = 0; i < p.length; i++) {
        const q = p[(i + 1) % p.length];
        paintCapsule(g, p[i][0], p[i][1], q[0], q[1], HORN.minHalfWidth);
      }
    }
  }
  fillHoles(g);
  return g;
}

/**
 * strokes: 角のローカル座標（根元 = (0,0)、x = 牛の前方、y = 下向き）の輪郭（複数可、和集合になる）
 */
export function processOutline(strokesIn: Poly[]): OutlineResult {
  const warnings: string[] = [];
  let strokes = strokesIn
    .map((s) =>
      removeDuplicates(
        s.slice(0, HORN.maxRawPoints).map(([x, y]) => [
          Math.max(-HORN.coordLimit, Math.min(HORN.coordLimit, x)),
          Math.max(-HORN.coordLimit, Math.min(HORN.coordLimit, y)),
        ] as Pt),
        0.75,
      ),
    )
    .filter((s) => s.length >= 3 && Math.abs(signedArea(s)) > 4);
  if (!strokes.length) return { ok: false, polygon: [], error: '輪郭が小さすぎます。もう少し大きく描いてください。', warnings };

  // 最大半径制限（形を保ったまま縮小）
  let maxR = 0;
  for (const s of strokes) for (const [x, y] of s) maxR = Math.max(maxR, Math.hypot(x, y));
  if (maxR > HORN.maxRadius) {
    const k = HORN.maxRadius / maxR;
    strokes = strokes.map((s) => s.map(([x, y]) => [x * k, y * k] as Pt));
    warnings.push('角が大きすぎたため最大サイズに縮小しました。');
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const g = rasterize(strokes);
    const root = findRootCell(g, HORN.rootTolerance);
    if (!root) return { ok: false, polygon: [], error: '角の根元が頭から離れています。頭の上の印から描き始めてください。', warnings };
    if (root.bridged) {
      paintCapsule(g, 0, 0, root.bridged[0], root.bridged[1], HORN.minHalfWidth + 1);
      warnings.push('根元を頭につなげました。');
    }
    const [ri, rj] = cellIndexOf(g, 0, 0);
    const rootK = rj * g.w + ri;
    const total = g.data.reduce((a, v) => a + v, 0);
    const kept = keepComponent(g, ri, rj);
    if (kept < total) warnings.push('頭につながっていない部分を取り除きました。');

    const area = kept * g.cell * g.cell;
    if (area > HORN.maxArea && attempt < 2) {
      const k = Math.sqrt(HORN.maxArea / area) * 0.97;
      strokes = strokes.map((s) => s.map(([x, y]) => [x * k, y * k] as Pt));
      warnings.push('面積が大きすぎたため縮小しました。');
      continue;
    }

    // 極端に細い部分の補正：距離場の稜線上で薄いところに最小太さの円を塗る
    const dt = distanceTransform(g);
    const minHalfCells = HORN.minHalfWidth / g.cell;
    let thinCells = 0;
    for (let j = 1; j < g.h - 1; j++) {
      for (let i = 1; i < g.w - 1; i++) {
        const k = j * g.w + i;
        const v = dt[k];
        if (!v || v >= minHalfCells) continue;
        if (v >= dt[k - 1] && v >= dt[k + 1] && v >= dt[k - g.w] && v >= dt[k + g.w]) {
          paintDisk(g, g.x0 + (i + 0.5) * g.cell, g.y0 + (j + 0.5) * g.cell, HORN.minHalfWidth);
          if (v < minHalfCells * 0.5) thinCells++;
        }
      }
    }
    paintDisk(g, 0, 0, HORN.minHalfWidth + 2);
    if (thinCells > 8) warnings.push('細すぎる部分を補強しました。');
    fillHoles(g);
    keepComponent(g, ri, rj);

    const { path } = medialPath(g, rootK);
    const len = pathLength(path);
    if (len < HORN.minLength) return { ok: false, polygon: [], error: '角が短すぎます。もう少し長く描いてください。', warnings };

    const poly = polygonFromGrid(g);
    if (!poly) return { ok: false, polygon: [], error: '輪郭を解釈できませんでした。描き直してください。', warnings };
    return { ok: true, polygon: poly, warnings: [...new Set(warnings)] };
  }
  return { ok: false, polygon: [], error: '角が大きすぎます。', warnings };
}

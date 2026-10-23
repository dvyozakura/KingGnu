/**
 * クリーンな角の多角形 → 物理モデル（材質非依存の幾何データ）
 *  - 中心線（中央寄りの測地経路）を近似し、節点を生成
 *  - 各頂点を中心線フレームにバインド（しなりに合わせて輪郭が変形）
 *  - ラスタセルを各節点に割り当てて質量分布・重心・慣性モーメントを算出
 *  - 凸分解ピース（当たり判定）
 *
 * 決定的に計算されるので、クライアントとサーバーで同じ多角形から同じモデルが得られる。
 */
import { HORN } from '../config/game';
import { convexDecompose } from '../geometry/decompose';
import { Grid, Poly, Pt, fillHoles, makeGrid, rasterizeNonZero, signedArea } from '../geometry/polygon';
import { cellIndexOf, findRootCell, medialPath, paintDisk, pathLength, polygonFromGrid } from './outline';

export interface Binding {
  /** セグメント番号（節点 s と s+1 の間） */
  s: number;
  t: number;
  /** 中心線フレームでの接線方向オフセット */
  a: number;
  /** 法線方向オフセット */
  d: number;
}

export interface HornStats {
  length: number;
  area: number;
  avgWidth: number;
  maxWidth: number;
  centroid: Pt;
  /** 根元まわりの断面2次モーメント相当（面積×距離²） */
  inertiaRoot: number;
  /** 前方（x）への最大到達距離 */
  reachForward: number;
  tip: Pt;
}

export interface HornModel {
  polygon: Poly;
  nodes: Pt[];
  segLen: number[];
  /** 各節点 i>=2 の静止相対角（セグメント i-2→i-1 と i-1→i のなす角） */
  restAngle: number[];
  /** 各節点の接線（静止時） */
  tangents: Pt[];
  /** 各節点に割り当てられた面積 */
  nodeArea: number[];
  /** 各節点の半幅（静止時） */
  halfWidth: number[];
  /** 根元からの弧長（節点ごと） */
  arc: number[];
  bindings: Binding[];
  pieces: number[][];
  stats: HornStats;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function smoothPath(path: Pt[], win = 3): Pt[] {
  if (path.length < 5) return path;
  const out: Pt[] = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    let sx = 0;
    let sy = 0;
    let c = 0;
    for (let k = -win; k <= win; k++) {
      const j = Math.max(0, Math.min(path.length - 1, i + k));
      sx += path[j][0];
      sy += path[j][1];
      c++;
    }
    out.push([sx / c, sy / c]);
  }
  out.push(path[path.length - 1]);
  return out;
}

function resample(path: Pt[], n: number): Pt[] {
  const L = pathLength(path);
  const out: Pt[] = [];
  let seg = 0;
  let acc = 0;
  for (let k = 0; k < n; k++) {
    const target = (L * k) / (n - 1);
    while (seg < path.length - 2) {
      const l = Math.hypot(path[seg + 1][0] - path[seg][0], path[seg + 1][1] - path[seg][1]);
      if (acc + l >= target) break;
      acc += l;
      seg++;
    }
    const a = path[seg];
    const b = path[Math.min(seg + 1, path.length - 1)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const t = Math.max(0, Math.min(1, (target - acc) / l));
    out.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t)]);
  }
  return out;
}

export function wrapAngle(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** 点を中心線ポリラインの最寄り位置へ射影 */
export function projectToCenterline(nodes: Pt[], x: number, y: number): { s: number; t: number; dist: number } {
  let best = { s: 0, t: 0, dist: Infinity };
  for (let s = 0; s < nodes.length - 1; s++) {
    const a = nodes[s];
    const b = nodes[s + 1];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy || 1;
    let t = ((x - a[0]) * dx + (y - a[1]) * dy) / l2;
    t = Math.max(0, Math.min(1, t));
    const px = a[0] + dx * t;
    const py = a[1] + dy * t;
    const d = Math.hypot(x - px, y - py);
    if (d < best.dist - 1e-9) best = { s, t, dist: d };
  }
  return best;
}

/** 静止時フレームで点をバインド */
export function bindPoint(model: Pick<HornModel, 'nodes' | 'tangents'>, x: number, y: number): Binding {
  const { s, t } = projectToCenterline(model.nodes, x, y);
  const a = model.nodes[s];
  const b = model.nodes[s + 1];
  const px = lerp(a[0], b[0], t);
  const py = lerp(a[1], b[1], t);
  let tx = lerp(model.tangents[s][0], model.tangents[s + 1][0], t);
  let ty = lerp(model.tangents[s][1], model.tangents[s + 1][1], t);
  const tl = Math.hypot(tx, ty) || 1;
  tx /= tl;
  ty /= tl;
  const nx = -ty;
  const ny = tx;
  const vx = x - px;
  const vy = y - py;
  return { s, t, a: vx * tx + vy * ty, d: vx * nx + vy * ny };
}

export function computeTangents(nodes: Pt[]): Pt[] {
  const n = nodes.length;
  const tang: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = nodes[Math.max(0, i - 1)];
    const b = nodes[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0];
    let ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1;
    tx /= l;
    ty /= l;
    tang.push([tx, ty]);
  }
  return tang;
}

export function rasterizePolygon(poly: Poly): Grid {
  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;
  for (const [x, y] of poly) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const g = makeGrid(minX - 8, minY - 8, maxX + 8, maxY + 8, HORN.cell, 2);
  rasterizeNonZero(g, poly);
  fillHoles(g);
  return g;
}

export function buildHornModel(polygonIn: Poly): HornModel {
  const polygon: Poly = signedArea(polygonIn) < 0 ? polygonIn.slice().reverse() : polygonIn.slice();
  const g = rasterizePolygon(polygon);
  const root = findRootCell(g, HORN.rootTolerance * 2);
  if (root?.bridged) paintDisk(g, 0, 0, HORN.minHalfWidth);
  const [ri, rj] = cellIndexOf(g, 0, 0);
  let rootK = rj * g.w + ri;
  if (!g.data[rootK]) {
    paintDisk(g, 0, 0, HORN.minHalfWidth);
    rootK = rj * g.w + ri;
  }
  const { path: rawPath, dt } = medialPath(g, rootK);
  let path = smoothPath([[0, 0], ...rawPath.slice(1)]);
  if (path.length < 2) path = [[0, 0], [HORN.minLength, 0]];
  const length = Math.max(1, pathLength(path));
  const N = Math.max(4, Math.min(HORN.nodes, Math.round(length / 16) + 2));
  const nodes = resample(path, N);
  const tangents = computeTangents(nodes);
  const segLen: number[] = [];
  const arc: number[] = [0];
  for (let i = 0; i < N - 1; i++) {
    const l = Math.hypot(nodes[i + 1][0] - nodes[i][0], nodes[i + 1][1] - nodes[i][1]);
    segLen.push(Math.max(1e-3, l));
    arc.push(arc[i] + l);
  }
  const restAngle: number[] = new Array(N).fill(0);
  for (let i = 2; i < N; i++) {
    const ax = nodes[i - 1][0] - nodes[i - 2][0];
    const ay = nodes[i - 1][1] - nodes[i - 2][1];
    const bx = nodes[i][0] - nodes[i - 1][0];
    const by = nodes[i][1] - nodes[i - 1][1];
    restAngle[i] = Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
  }

  // 質量分布（セル → 節点）
  const nodeArea = new Array(N).fill(0);
  const halfWidth = new Array(N).fill(0);
  const cellA = g.cell * g.cell;
  let area = 0;
  let cx = 0;
  let cy = 0;
  let inertia = 0;
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      const k = j * g.w + i;
      if (!g.data[k]) continue;
      const x = g.x0 + (i + 0.5) * g.cell;
      const y = g.y0 + (j + 0.5) * g.cell;
      const p = projectToCenterline(nodes, x, y);
      nodeArea[p.s] += (1 - p.t) * cellA;
      nodeArea[p.s + 1] += p.t * cellA;
      const ni = p.t < 0.5 ? p.s : p.s + 1;
      halfWidth[ni] = Math.max(halfWidth[ni], p.dist);
      area += cellA;
      cx += x * cellA;
      cy += y * cellA;
      inertia += (x * x + y * y) * cellA;
    }
  }
  for (let i = 0; i < N; i++) halfWidth[i] = Math.max(HORN.minHalfWidth, halfWidth[i]);

  let maxWidth = 0;
  for (const [x, y] of path) {
    const [i, j] = cellIndexOf(g, x, y);
    if (i >= 0 && j >= 0 && i < g.w && j < g.h) maxWidth = Math.max(maxWidth, dt[j * g.w + i] * g.cell * 2);
  }

  const partial = { nodes, tangents };
  const bindings = polygon.map(([x, y]) => bindPoint(partial, x, y));
  const pieces = convexDecompose(polygon);
  let reach = -Infinity;
  for (const [x] of polygon) reach = Math.max(reach, x);

  return {
    polygon,
    nodes,
    segLen,
    restAngle,
    tangents,
    nodeArea,
    halfWidth,
    arc,
    bindings,
    pieces,
    stats: {
      length,
      area,
      avgWidth: area / length,
      maxWidth,
      centroid: area > 0 ? [cx / area, cy / area] : [0, 0],
      inertiaRoot: inertia,
      reachForward: reach,
      tip: nodes[N - 1],
    },
  };
}

/** 静止時のバインディングから頂点の位置を復元（テスト・プレビュー用） */
export function restVertex(model: HornModel, b: Binding): Pt {
  const a = model.nodes[b.s];
  const c = model.nodes[b.s + 1];
  const px = lerp(a[0], c[0], b.t);
  const py = lerp(a[1], c[1], b.t);
  let tx = lerp(model.tangents[b.s][0], model.tangents[b.s + 1][0], b.t);
  let ty = lerp(model.tangents[b.s][1], model.tangents[b.s + 1][1], b.t);
  const l = Math.hypot(tx, ty) || 1;
  tx /= l;
  ty /= l;
  return [px + tx * b.a - ty * b.d, py + ty * b.a + tx * b.d];
}

/**
 * 角を根元からの弧長 cutArc で切断する。
 * 戻り値: 残った角の多角形と、切り離された破片の多角形（角ローカル座標）
 */
export function cutHornPolygon(model: HornModel, cutArc: number): { kept: Poly | null; debris: Poly | null } {
  const g = rasterizePolygon(model.polygon);
  const removed: Grid = { ...g, data: new Uint8Array(g.data.length) };
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      const k = j * g.w + i;
      if (!g.data[k]) continue;
      const x = g.x0 + (i + 0.5) * g.cell;
      const y = g.y0 + (j + 0.5) * g.cell;
      const p = projectToCenterline(model.nodes, x, y);
      const arc = model.arc[p.s] + p.t * model.segLen[p.s];
      if (arc >= cutArc) {
        g.data[k] = 0;
        removed.data[k] = 1;
      }
    }
  }
  const [ri, rj] = cellIndexOf(g, 0, 0);
  let kept: Poly | null = null;
  if (ri >= 0 && rj >= 0 && ri < g.w && rj < g.h) {
    if (!g.data[rj * g.w + ri]) paintDisk(g, 0, 0, HORN.minHalfWidth);
    const before = g.data.reduce((a, v) => a + v, 0);
    keepComponent2(g, ri, rj, removed);
    if (before > 0) kept = polygonFromGrid(g);
  }
  const debris = removed.data.some((v) => v) ? polygonFromGrid(removed, 40) : null;
  return { kept, debris };
}

/** 根元成分以外を removed 側へ移す */
function keepComponent2(g: Grid, si: number, sj: number, removed: Grid) {
  const keep = new Uint8Array(g.w * g.h);
  const stack = [sj * g.w + si];
  keep[stack[0]] = 1;
  while (stack.length) {
    const k = stack.pop()!;
    const i = k % g.w;
    const j = (k / g.w) | 0;
    for (const [a, b] of [
      [i + 1, j],
      [i - 1, j],
      [i, j + 1],
      [i, j - 1],
    ]) {
      if (a < 0 || b < 0 || a >= g.w || b >= g.h) continue;
      const q = b * g.w + a;
      if (g.data[q] && !keep[q]) {
        keep[q] = 1;
        stack.push(q);
      }
    }
  }
  for (let k = 0; k < g.data.length; k++) {
    if (g.data[k] && !keep[k]) removed.data[k] = 1;
  }
  g.data = keep;
}

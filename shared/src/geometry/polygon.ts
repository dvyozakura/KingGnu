/** 多角形・グリッド処理（角の輪郭のクリーンアップと解析） */

export type Pt = [number, number];
export type Poly = Pt[];

export function signedArea(poly: Poly): number {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function polygonCentroid(poly: Poly): Pt {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    const c = p[0] * q[1] - q[0] * p[1];
    a += c;
    cx += (p[0] + q[0]) * c;
    cy += (p[1] + q[1]) * c;
  }
  if (Math.abs(a) < 1e-9) {
    let sx = 0;
    let sy = 0;
    for (const p of poly) {
      sx += p[0];
      sy += p[1];
    }
    return [sx / poly.length, sy / poly.length];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

export function pointInPolygon(x: number, y: number, poly: Poly): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}

function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number) {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

export function segmentsIntersect(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1 = orient(c[0], c[1], d[0], d[1], a[0], a[1]);
  const d2 = orient(c[0], c[1], d[0], d[1], b[0], b[1]);
  const d3 = orient(a[0], a[1], b[0], b[1], c[0], c[1]);
  const d4 = orient(a[0], a[1], b[0], b[1], d[0], d[1]);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** 自己交差の有無 */
export function isSimple(poly: Poly): boolean {
  const n = poly.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const c = poly[j];
      const d = poly[(j + 1) % n];
      if (segmentsIntersect(a, b, c, d)) return false;
    }
  }
  return true;
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = a[0] + dx * t - p[0];
  const y = a[1] + dy * t - p[1];
  return Math.hypot(x, y);
}

function rdpOpen(pts: Poly, eps: number): Poly {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = distToSegment(pts[i], pts[s], pts[e]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > eps) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** 閉じた多角形の Ramer–Douglas–Peucker 簡略化 */
export function rdpClosed(poly: Poly, eps: number): Poly {
  if (poly.length < 4) return poly.slice();
  // 最も離れた2点で分割
  let far = 0;
  let best = -1;
  for (let i = 1; i < poly.length; i++) {
    const d = Math.hypot(poly[i][0] - poly[0][0], poly[i][1] - poly[0][1]);
    if (d > best) {
      best = d;
      far = i;
    }
  }
  const a = rdpOpen(poly.slice(0, far + 1), eps);
  const b = rdpOpen([...poly.slice(far), poly[0]], eps);
  const out = [...a.slice(0, -1), ...b.slice(0, -1)];
  return out.length >= 3 ? out : poly.slice();
}

export function chaikin(poly: Poly, iterations = 1): Poly {
  let p = poly;
  for (let k = 0; k < iterations; k++) {
    const out: Poly = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i];
      const b = p[(i + 1) % p.length];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    p = out;
  }
  return p;
}

export function removeDuplicates(poly: Poly, minDist = 0.5): Poly {
  const out: Poly = [];
  for (const p of poly) {
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue;
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= minDist) out.push([p[0], p[1]]);
  }
  while (out.length > 2) {
    const f = out[0];
    const l = out[out.length - 1];
    if (Math.hypot(f[0] - l[0], f[1] - l[1]) < minDist) out.pop();
    else break;
  }
  return out;
}

/** Andrew's monotone chain（flat配列版：[x0,y0,x1,y1,...]） */
export function convexHullFlat(pts: number[], out: number[]): number[] {
  const n = pts.length / 2;
  out.length = 0;
  if (n < 3) {
    for (const v of pts) out.push(v);
    return out;
  }
  const idx: number[] = [];
  for (let i = 0; i < n; i++) idx.push(i);
  idx.sort((a, b) => pts[a * 2] - pts[b * 2] || pts[a * 2 + 1] - pts[b * 2 + 1]);
  const h: number[] = [];
  const cross = (o: number, a: number, b: number) =>
    (pts[a * 2] - pts[o * 2]) * (pts[b * 2 + 1] - pts[o * 2 + 1]) -
    (pts[a * 2 + 1] - pts[o * 2 + 1]) * (pts[b * 2] - pts[o * 2]);
  for (const i of idx) {
    while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], i) <= 0) h.pop();
    h.push(i);
  }
  const lower = h.length + 1;
  for (let k = idx.length - 2; k >= 0; k--) {
    const i = idx[k];
    while (h.length >= lower && cross(h[h.length - 2], h[h.length - 1], i) <= 0) h.pop();
    h.push(i);
  }
  h.pop();
  for (const i of h) out.push(pts[i * 2], pts[i * 2 + 1]);
  return out;
}

/* ---------------------------------------------------------------- */
/* グリッド（ラスタ）処理                                              */
/* ---------------------------------------------------------------- */

export interface Grid {
  x0: number;
  y0: number;
  cell: number;
  w: number;
  h: number;
  data: Uint8Array;
}

export function makeGrid(minX: number, minY: number, maxX: number, maxY: number, cell: number, pad = 3): Grid {
  const x0 = Math.floor(minX / cell - pad) * cell;
  const y0 = Math.floor(minY / cell - pad) * cell;
  const w = Math.ceil((maxX - x0) / cell) + pad;
  const h = Math.ceil((maxY - y0) / cell) + pad;
  return { x0, y0, cell, w, h, data: new Uint8Array(w * h) };
}

export function cellCenter(g: Grid, i: number, j: number): Pt {
  return [g.x0 + (i + 0.5) * g.cell, g.y0 + (j + 0.5) * g.cell];
}

/** 非ゼロ巻き数規則でラスタ化して OR 合成（自己交差した輪郭も「塗りつぶし」として解釈） */
export function rasterizeNonZero(g: Grid, poly: Poly) {
  const n = poly.length;
  const xs: { x: number; w: number }[] = [];
  for (let j = 0; j < g.h; j++) {
    const y = g.y0 + (j + 0.5) * g.cell;
    xs.length = 0;
    for (let k = 0; k < n; k++) {
      const a = poly[k];
      const b = poly[(k + 1) % n];
      if (a[1] === b[1]) continue;
      const up = a[1] <= y && b[1] > y;
      const down = b[1] <= y && a[1] > y;
      if (!up && !down) continue;
      const t = (y - a[1]) / (b[1] - a[1]);
      xs.push({ x: a[0] + t * (b[0] - a[0]), w: up ? 1 : -1 });
    }
    if (!xs.length) continue;
    xs.sort((p, q) => p.x - q.x);
    let wind = 0;
    for (let k = 0; k < xs.length - 1; k++) {
      wind += xs[k].w;
      if (wind !== 0) {
        const i0 = Math.max(0, Math.ceil((xs[k].x - g.x0) / g.cell - 0.5));
        const i1 = Math.min(g.w - 1, Math.floor((xs[k + 1].x - g.x0) / g.cell - 0.5));
        for (let i = i0; i <= i1; i++) g.data[j * g.w + i] = 1;
      }
    }
  }
}

/** 外側から到達できない空セル（穴）を埋める */
export function fillHoles(g: Grid) {
  const outside = new Uint8Array(g.w * g.h);
  const stack: number[] = [];
  const push = (i: number, j: number) => {
    if (i < 0 || j < 0 || i >= g.w || j >= g.h) return;
    const k = j * g.w + i;
    if (outside[k] || g.data[k]) return;
    outside[k] = 1;
    stack.push(k);
  };
  for (let i = 0; i < g.w; i++) {
    push(i, 0);
    push(i, g.h - 1);
  }
  for (let j = 0; j < g.h; j++) {
    push(0, j);
    push(g.w - 1, j);
  }
  while (stack.length) {
    const k = stack.pop()!;
    const i = k % g.w;
    const j = (k / g.w) | 0;
    push(i + 1, j);
    push(i - 1, j);
    push(i, j + 1);
    push(i, j - 1);
  }
  for (let k = 0; k < g.data.length; k++) if (!outside[k]) g.data[k] = 1;
}

/** (si,sj) を含む4連結成分だけを残す。セル数を返す */
export function keepComponent(g: Grid, si: number, sj: number): number {
  const keep = new Uint8Array(g.w * g.h);
  const start = sj * g.w + si;
  if (!g.data[start]) return 0;
  const stack = [start];
  keep[start] = 1;
  let count = 0;
  while (stack.length) {
    const k = stack.pop()!;
    count++;
    const i = k % g.w;
    const j = (k / g.w) | 0;
    const nb = [
      [i + 1, j],
      [i - 1, j],
      [i, j + 1],
      [i, j - 1],
    ];
    for (const [a, b] of nb) {
      if (a < 0 || b < 0 || a >= g.w || b >= g.h) continue;
      const q = b * g.w + a;
      if (g.data[q] && !keep[q]) {
        keep[q] = 1;
        stack.push(q);
      }
    }
  }
  g.data = keep;
  return count;
}

/** 2パスのチャンファー距離変換（最寄りの空セルまでの距離、セル単位） */
export function distanceTransform(g: Grid): Float32Array {
  const INF = 1e9;
  const d = new Float32Array(g.w * g.h);
  for (let k = 0; k < d.length; k++) d[k] = g.data[k] ? INF : 0;
  const D1 = 1;
  const D2 = Math.SQRT2;
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      const k = j * g.w + i;
      if (!d[k]) continue;
      let v = d[k];
      if (i > 0) v = Math.min(v, d[k - 1] + D1);
      if (j > 0) {
        v = Math.min(v, d[k - g.w] + D1);
        if (i > 0) v = Math.min(v, d[k - g.w - 1] + D2);
        if (i < g.w - 1) v = Math.min(v, d[k - g.w + 1] + D2);
      }
      d[k] = v;
    }
  }
  for (let j = g.h - 1; j >= 0; j--) {
    for (let i = g.w - 1; i >= 0; i--) {
      const k = j * g.w + i;
      if (!d[k]) continue;
      let v = d[k];
      if (i < g.w - 1) v = Math.min(v, d[k + 1] + D1);
      if (j < g.h - 1) {
        v = Math.min(v, d[k + g.w] + D1);
        if (i < g.w - 1) v = Math.min(v, d[k + g.w + 1] + D2);
        if (i > 0) v = Math.min(v, d[k + g.w - 1] + D2);
      }
      d[k] = v;
    }
  }
  // 境界セルは 0.5 程度の厚み
  for (let k = 0; k < d.length; k++) if (d[k]) d[k] -= 0.5;
  return d;
}

/** グリッドの外周輪郭を追跡（セル角の頂点列、正の符号付き面積） */
export function traceOuterContour(g: Grid): Poly {
  const W = g.w + 1;
  const key = (x: number, y: number) => y * W + x;
  const out = new Map<number, number[]>(); // start vertex -> list of edge ids
  const ex0: number[] = [];
  const ey0: number[] = [];
  const ex1: number[] = [];
  const ey1: number[] = [];
  const filled = (i: number, j: number) => i >= 0 && j >= 0 && i < g.w && j < g.h && g.data[j * g.w + i] === 1;
  const addEdge = (x0: number, y0: number, x1: number, y1: number) => {
    const id = ex0.length;
    ex0.push(x0);
    ey0.push(y0);
    ex1.push(x1);
    ey1.push(y1);
    const k = key(x0, y0);
    const l = out.get(k);
    if (l) l.push(id);
    else out.set(k, [id]);
  };
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      if (!filled(i, j)) continue;
      if (!filled(i, j - 1)) addEdge(i, j, i + 1, j);
      if (!filled(i + 1, j)) addEdge(i + 1, j, i + 1, j + 1);
      if (!filled(i, j + 1)) addEdge(i + 1, j + 1, i, j + 1);
      if (!filled(i - 1, j)) addEdge(i, j + 1, i, j);
    }
  }
  const used = new Uint8Array(ex0.length);
  let best: Poly = [];
  let bestArea = 0;
  for (let s = 0; s < ex0.length; s++) {
    if (used[s]) continue;
    const loop: Poly = [];
    let e = s;
    let guard = 0;
    while (!used[e] && guard++ < ex0.length + 5) {
      used[e] = 1;
      loop.push([ex0[e], ey0[e]]);
      const dx = ex1[e] - ex0[e];
      const dy = ey1[e] - ey0[e];
      const cands = out.get(key(ex1[e], ey1[e]));
      if (!cands) break;
      let next = -1;
      if (cands.length === 1) next = cands[0];
      else {
        // 右折優先（ピンチ点で輪郭を分離する）
        const rx = -dy;
        const ry = dx;
        for (const c of cands) {
          if (used[c]) continue;
          const cx = ex1[c] - ex0[c];
          const cy = ey1[c] - ey0[c];
          if (cx === rx && cy === ry) next = c;
        }
        if (next < 0) next = cands.find((c) => !used[c]) ?? -1;
      }
      if (next < 0) break;
      e = next;
    }
    const a = signedArea(loop);
    if (a > bestArea) {
      bestArea = a;
      best = loop;
    }
  }
  // 共線頂点を除去
  const res: Poly = [];
  for (let i = 0; i < best.length; i++) {
    const p = best[(i + best.length - 1) % best.length];
    const c = best[i];
    const q = best[(i + 1) % best.length];
    if ((c[0] - p[0]) * (q[1] - c[1]) - (c[1] - p[1]) * (q[0] - c[0]) !== 0) res.push(c);
  }
  return res.map(([x, y]) => [g.x0 + x * g.cell, g.y0 + y * g.cell] as Pt);
}

/* 二分ヒープ（Dijkstra用） */
export class MinHeap {
  private k: number[] = [];
  private v: number[] = [];
  get size() {
    return this.k.length;
  }
  push(key: number, val: number) {
    this.k.push(key);
    this.v.push(val);
    let i = this.k.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.k[p] <= this.k[i]) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): [number, number] {
    const rk = this.k[0];
    const rv = this.v[0];
    const lk = this.k.pop()!;
    const lv = this.v.pop()!;
    if (this.k.length) {
      this.k[0] = lk;
      this.v[0] = lv;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.k.length && this.k[l] < this.k[m]) m = l;
        if (r < this.k.length && this.k[r] < this.k[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return [rk, rv];
  }
  private swap(a: number, b: number) {
    [this.k[a], this.k[b]] = [this.k[b], this.k[a]];
    [this.v[a], this.v[b]] = [this.v[b], this.v[a]];
  }
}

/** 8近傍 Dijkstra。cost(k) はセル k に入るときの重み */
export function dijkstra(g: Grid, start: number, weight: (k: number) => number): { dist: Float64Array; prev: Int32Array } {
  const dist = new Float64Array(g.w * g.h).fill(Infinity);
  const prev = new Int32Array(g.w * g.h).fill(-1);
  const heap = new MinHeap();
  dist[start] = 0;
  heap.push(0, start);
  const di = [1, -1, 0, 0, 1, 1, -1, -1];
  const dj = [0, 0, 1, -1, 1, -1, 1, -1];
  while (heap.size) {
    const [d, k] = heap.pop();
    if (d > dist[k]) continue;
    const i = k % g.w;
    const j = (k / g.w) | 0;
    for (let n = 0; n < 8; n++) {
      const a = i + di[n];
      const b = j + dj[n];
      if (a < 0 || b < 0 || a >= g.w || b >= g.h) continue;
      const q = b * g.w + a;
      if (!g.data[q]) continue;
      // 対角移動は両隣が埋まっているときのみ
      if (n >= 4 && (!g.data[j * g.w + a] || !g.data[b * g.w + i])) continue;
      const step = n >= 4 ? Math.SQRT2 : 1;
      const nd = d + step * weight(q);
      if (nd < dist[q]) {
        dist[q] = nd;
        prev[q] = k;
        heap.push(nd, q);
      }
    }
  }
  return { dist, prev };
}

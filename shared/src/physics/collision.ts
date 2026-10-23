/** 凸多角形同士の分離軸判定（SAT） */

export interface Manifold {
  /** a を b から押し出す方向（単位ベクトル） */
  nx: number;
  ny: number;
  depth: number;
}

function project(p: number[], ax: number, ay: number): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < p.length; i += 2) {
    const d = p[i] * ax + p[i + 1] * ay;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return [min, max];
}

function centroidOf(p: number[]): [number, number] {
  let x = 0;
  let y = 0;
  const n = p.length / 2;
  for (let i = 0; i < p.length; i += 2) {
    x += p[i];
    y += p[i + 1];
  }
  return [x / n, y / n];
}

export function aabbOverlap(a: number[], b: number[], margin = 0): boolean {
  let aminx = Infinity;
  let aminy = Infinity;
  let amaxx = -Infinity;
  let amaxy = -Infinity;
  for (let i = 0; i < a.length; i += 2) {
    aminx = Math.min(aminx, a[i]);
    amaxx = Math.max(amaxx, a[i]);
    aminy = Math.min(aminy, a[i + 1]);
    amaxy = Math.max(amaxy, a[i + 1]);
  }
  for (let i = 0; i < b.length; i += 2) {
    if (b[i] >= aminx - margin && b[i] <= amaxx + margin && b[i + 1] >= aminy - margin && b[i + 1] <= amaxy + margin) return true;
  }
  let bminx = Infinity;
  let bminy = Infinity;
  let bmaxx = -Infinity;
  let bmaxy = -Infinity;
  for (let i = 0; i < b.length; i += 2) {
    bminx = Math.min(bminx, b[i]);
    bmaxx = Math.max(bmaxx, b[i]);
    bminy = Math.min(bminy, b[i + 1]);
    bmaxy = Math.max(bmaxy, b[i + 1]);
  }
  return !(amaxx < bminx - margin || bmaxx < aminx - margin || amaxy < bminy - margin || bmaxy < aminy - margin);
}

export function sat(a: number[], b: number[]): Manifold | null {
  if (a.length < 6 || b.length < 6) return null;
  let best = Infinity;
  let bx = 0;
  let by = 0;
  for (const poly of [a, b]) {
    const n = poly.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      let ex = poly[j * 2] - poly[i * 2];
      let ey = poly[j * 2 + 1] - poly[i * 2 + 1];
      const l = Math.hypot(ex, ey);
      if (l < 1e-6) continue;
      const ax = -ey / l;
      const ay = ex / l;
      const [amin, amax] = project(a, ax, ay);
      const [bmin, bmax] = project(b, ax, ay);
      const o = Math.min(amax, bmax) - Math.max(amin, bmin);
      if (o <= 0) return null;
      if (o < best) {
        best = o;
        bx = ax;
        by = ay;
      }
      ex = 0;
      ey = 0;
    }
  }
  const ca = centroidOf(a);
  const cb = centroidOf(b);
  if ((ca[0] - cb[0]) * bx + (ca[1] - cb[1]) * by < 0) {
    bx = -bx;
    by = -by;
  }
  return { nx: bx, ny: by, depth: best };
}

/** 方向 n に対して最も b 側へ食い込んでいる a の頂点（n の逆向きに最も遠い） */
export function deepestVertex(a: number[], nx: number, ny: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < a.length; i += 2) {
    const d = a[i] * nx + a[i + 1] * ny;
    if (d < bestD) {
      bestD = d;
      best = i / 2;
    }
  }
  return best;
}

export function pointInConvex(x: number, y: number, p: number[]): boolean {
  const n = p.length / 2;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const c = (p[j * 2] - p[i * 2]) * (y - p[i * 2 + 1]) - (p[j * 2 + 1] - p[i * 2 + 1]) * (x - p[i * 2]);
    if (c !== 0) {
      const s = c > 0 ? 1 : -1;
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
  }
  return true;
}

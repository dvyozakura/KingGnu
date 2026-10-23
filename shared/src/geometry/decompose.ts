/**
 * 凹多角形の凸分解
 *  1. 耳切り法で三角形分割
 *  2. Hertel–Mehlhorn 法で凸性を保ったまま対角線を取り除き、凸ピースにまとめる
 * 戻り値は頂点インデックスの配列（元多角形の頂点を参照するので、変形時もそのまま追従できる）
 */
import { Poly, signedArea } from './polygon';

function cross(o: number[], a: number[], b: number[]) {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

function pointInTri(p: number[], a: number[], b: number[], c: number[], sign: number) {
  const d1 = cross(a, b, p) * sign;
  const d2 = cross(b, c, p) * sign;
  const d3 = cross(c, a, p) * sign;
  return d1 >= -1e-9 && d2 >= -1e-9 && d3 >= -1e-9;
}

export function earClip(poly: Poly): [number, number, number][] {
  const n = poly.length;
  const tris: [number, number, number][] = [];
  if (n < 3) return tris;
  const sign = signedArea(poly) >= 0 ? 1 : -1;
  const idx: number[] = [];
  for (let i = 0; i < n; i++) idx.push(i);
  let guard = 0;
  while (idx.length > 3 && guard++ < n * n) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      const ia = idx[(k + idx.length - 1) % idx.length];
      const ib = idx[k];
      const ic = idx[(k + 1) % idx.length];
      const a = poly[ia];
      const b = poly[ib];
      const c = poly[ic];
      const cr = cross(a, b, c) * sign;
      if (cr <= 1e-9) continue; // 凹頂点
      let ok = true;
      for (const j of idx) {
        if (j === ia || j === ib || j === ic) continue;
        if (pointInTri(poly[j], a, b, c, sign)) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      tris.push([ia, ib, ic]);
      idx.splice(k, 1);
      clipped = true;
      break;
    }
    if (!clipped) {
      // 退化ケース：最も「凸」な頂点を強制的に切る
      let best = 0;
      let bestCr = -Infinity;
      for (let k = 0; k < idx.length; k++) {
        const a = poly[idx[(k + idx.length - 1) % idx.length]];
        const b = poly[idx[k]];
        const c = poly[idx[(k + 1) % idx.length]];
        const cr = cross(a, b, c) * sign;
        if (cr > bestCr) {
          bestCr = cr;
          best = k;
        }
      }
      tris.push([idx[(best + idx.length - 1) % idx.length], idx[best], idx[(best + 1) % idx.length]]);
      idx.splice(best, 1);
    }
  }
  if (idx.length === 3) tris.push([idx[0], idx[1], idx[2]]);
  return tris;
}

function isConvex(poly: Poly, ids: number[], sign: number) {
  const n = ids.length;
  for (let i = 0; i < n; i++) {
    const a = poly[ids[i]];
    const b = poly[ids[(i + 1) % n]];
    const c = poly[ids[(i + 2) % n]];
    if (cross(a, b, c) * sign < -1e-7) return false;
  }
  return true;
}

export function convexDecompose(poly: Poly, maxPieceVerts = 8): number[][] {
  const sign = signedArea(poly) >= 0 ? 1 : -1;
  const pieces: number[][] = earClip(poly).map((t) => [...t]);
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let p = 0; p < pieces.length; p++) {
      const A = pieces[p];
      for (let q = p + 1; q < pieces.length; q++) {
        const B = pieces[q];
        if (A.length + B.length - 2 > maxPieceVerts) continue;
        // 共有辺 (A[i]->A[i+1]) == (B[j+1]->B[j])
        for (let i = 0; i < A.length; i++) {
          const a0 = A[i];
          const a1 = A[(i + 1) % A.length];
          for (let j = 0; j < B.length; j++) {
            const b0 = B[j];
            const b1 = B[(j + 1) % B.length];
            if (a0 === b1 && a1 === b0) {
              // A を a1 から一周 → B の b1(=a0)の次から b0(=a1)の手前まで
              const res: number[] = [];
              for (let k = 0; k < A.length; k++) res.push(A[(i + 1 + k) % A.length]);
              // res: a1 ... a0
              for (let k = 2; k < B.length; k++) res.push(B[(j + k) % B.length]);
              if (isConvex(poly, res, sign)) {
                pieces[p] = res;
                pieces.splice(q, 1);
                merged = true;
                break outer;
              }
            }
          }
        }
      }
    }
  }
  return pieces;
}

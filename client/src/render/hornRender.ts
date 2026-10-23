/** 角の描画：変形した輪郭（物理と同じスキニング）に材質ごとの質感を載せる */
import { Binding, CrackMark, HornModel, MATERIALS, MaterialId, bindPoint, pointInPolygon, skinPoints } from '@kinggnu/shared';

interface Deco {
  speckles: Binding[];
  grain: Binding[][];
  highlight: Binding[];
}

const decoCache = new WeakMap<HornModel, Deco>();

function prng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function decoFor(model: HornModel): Deco {
  let d = decoCache.get(model);
  if (d) return d;
  const rnd = prng(model.polygon.length * 7919 + Math.round(model.stats.area));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of model.polygon) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const speckles: Binding[] = [];
  const target = Math.min(90, Math.round(model.stats.area / 60));
  for (let k = 0; k < target * 4 && speckles.length < target; k++) {
    const x = minX + rnd() * (maxX - minX);
    const y = minY + rnd() * (maxY - minY);
    if (pointInPolygon(x, y, model.polygon)) speckles.push(bindPoint(model, x, y));
  }
  const grain: Binding[][] = [];
  for (const f of [-0.65, -0.3, 0.05, 0.4, 0.72]) {
    const line: Binding[] = [];
    for (let i = 0; i < model.nodes.length; i++) {
      const s = Math.min(i, model.nodes.length - 2);
      line.push({ s, t: i === model.nodes.length - 1 ? 1 : 0, a: 0, d: f * model.halfWidth[i] * (0.9 + rnd() * 0.15) });
    }
    grain.push(line);
  }
  const highlight: Binding[] = [];
  for (let i = 0; i < model.nodes.length; i++) {
    const s = Math.min(i, model.nodes.length - 2);
    highlight.push({ s, t: i === model.nodes.length - 1 ? 1 : 0, a: 0, d: -0.45 * model.halfWidth[i] });
  }
  d = { speckles, grain, highlight };
  decoCache.set(model, d);
  return d;
}

const scratchX: number[] = [];
const scratchY: number[] = [];

function skinB(bs: Binding[], nx: ArrayLike<number>, ny: ArrayLike<number>, n: number, facing: number, ws: number) {
  scratchX.length = bs.length;
  scratchY.length = bs.length;
  skinPoints(bs, nx, ny, n, facing, ws, scratchX, scratchY);
  return [scratchX.slice(), scratchY.slice()];
}

export interface HornDrawOpts {
  model: HornModel;
  nodesX: ArrayLike<number>;
  nodesY: ArrayLike<number>;
  facing: number;
  widthScale: number;
  material: MaterialId;
  stress: number;
  crackLevel: number;
  cracks: CrackMark[];
  melt: number;
  time: number;
  flash?: number;
  ghost?: boolean;
}

export function drawHorn(ctx: CanvasRenderingContext2D, o: HornDrawOpts) {
  const m = o.model;
  const n = Math.min(m.nodes.length, o.nodesX.length);
  if (n < 2) return;
  const mat = MATERIALS[o.material];
  const vx: number[] = new Array(m.bindings.length);
  const vy: number[] = new Array(m.bindings.length);
  skinPoints(m.bindings, o.nodesX, o.nodesY, n, o.facing, o.widthScale, vx, vy);

  const path = new Path2D();
  path.moveTo(vx[0], vy[0]);
  for (let i = 1; i < vx.length; i++) {
    const mx = (vx[i - 1] + vx[i]) / 2;
    const my = (vy[i - 1] + vy[i]) / 2;
    path.quadraticCurveTo(vx[i - 1], vy[i - 1], mx, my);
  }
  path.quadraticCurveTo(vx[vx.length - 1], vy[vx.length - 1], (vx[vx.length - 1] + vx[0]) / 2, (vy[vx.length - 1] + vy[0]) / 2);
  path.closePath();

  ctx.save();
  ctx.globalAlpha = o.ghost ? 0.35 : 1;
  // ベース
  const bx = o.nodesX[0];
  const by = o.nodesY[0];
  const tx = o.nodesX[n - 1];
  const ty = o.nodesY[n - 1];
  const grad = ctx.createLinearGradient(bx, by, tx, ty);
  const d = decoFor(m);
  switch (mat.id) {
    case 'glass':
      grad.addColorStop(0, 'rgba(190,235,255,0.55)');
      grad.addColorStop(1, 'rgba(240,252,255,0.35)');
      break;
    case 'azuki': {
      const wet = o.melt;
      grad.addColorStop(0, shade(mat.color.fill, -0.15 + wet * 0.1));
      grad.addColorStop(1, shade(mat.color.fill, 0.08 + wet * 0.15));
      break;
    }
    default:
      grad.addColorStop(0, shade(mat.color.fill, -0.12));
      grad.addColorStop(1, shade(mat.color.fill, 0.12));
  }
  ctx.fillStyle = grad;
  ctx.fill(path);

  ctx.save();
  ctx.clip(path);
  const nx = o.nodesX;
  const ny = o.nodesY;
  if (mat.id === 'wood') {
    ctx.strokeStyle = 'rgba(70,38,12,0.45)';
    ctx.lineWidth = 1.6;
    for (const line of d.grain) {
      const [lx, ly] = skinB(line, nx, ny, n, o.facing, o.widthScale);
      ctx.beginPath();
      ctx.moveTo(lx[0], ly[0]);
      for (let i = 1; i < lx.length; i++) ctx.quadraticCurveTo(lx[i - 1], ly[i - 1], (lx[i - 1] + lx[i]) / 2, (ly[i - 1] + ly[i]) / 2);
      ctx.lineTo(lx[lx.length - 1], ly[ly.length - 1]);
      ctx.stroke();
    }
    // 節
    const [sx, sy] = skinB(d.speckles.slice(0, 3), nx, ny, n, o.facing, o.widthScale);
    ctx.fillStyle = 'rgba(80,42,14,0.5)';
    for (let i = 0; i < sx.length; i++) {
      ctx.beginPath();
      ctx.ellipse(sx[i], sy[i], 3.5, 2, 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (mat.id === 'cork') {
    const [sx, sy] = skinB(d.speckles, nx, ny, n, o.facing, o.widthScale);
    for (let i = 0; i < sx.length; i++) {
      ctx.fillStyle = i % 3 === 0 ? 'rgba(90,60,25,0.55)' : 'rgba(230,200,150,0.5)';
      ctx.beginPath();
      ctx.arc(sx[i], sy[i], 1.2 + (i % 4) * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (mat.id === 'azuki') {
    const [sx, sy] = skinB(d.speckles, nx, ny, n, o.facing, o.widthScale);
    for (let i = 0; i < sx.length; i++) {
      if (i % 2) continue;
      ctx.fillStyle = '#4a1626';
      ctx.beginPath();
      ctx.ellipse(sx[i], sy[i], 3.2, 2.2, i * 0.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,220,230,0.35)';
      ctx.beginPath();
      ctx.arc(sx[i] - 0.8, sy[i] - 0.8, 0.9, 0, Math.PI * 2);
      ctx.fill();
    }
    // 霜（溶けると消え、濡れたつやになる）
    ctx.fillStyle = `rgba(255,255,255,${0.18 * (1 - o.melt)})`;
    for (let i = 1; i < sx.length; i += 2) ctx.fillRect(sx[i], sy[i], 1.5, 1.5);
  }
  // つや
  if (mat.id === 'rubber' || mat.id === 'plastic' || mat.id === 'glass' || mat.id === 'azuki') {
    const [hx, hy] = skinB(d.highlight, nx, ny, n, o.facing, o.widthScale);
    ctx.strokeStyle = mat.id === 'glass' ? 'rgba(255,255,255,0.85)' : mat.id === 'azuki' ? `rgba(255,230,240,${0.15 + o.melt * 0.4})` : 'rgba(255,255,255,0.45)';
    ctx.lineWidth = mat.id === 'glass' ? 2.5 : 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(hx[1], hy[1]);
    for (let i = 2; i < hx.length - 1; i++) ctx.lineTo(hx[i], hy[i]);
    ctx.stroke();
  }
  // プラスチックの白化 / ゴムの伸び
  if (o.stress > 0.02 && (mat.id === 'plastic' || mat.id === 'rubber')) {
    ctx.fillStyle = mat.id === 'plastic' ? `rgba(255,255,255,${Math.min(0.55, o.stress * 0.6)})` : `rgba(255,190,170,${Math.min(0.35, o.stress * 0.4)})`;
    ctx.fill(path);
  }
  // ひび
  if (o.cracks.length) {
    ctx.strokeStyle = mat.id === 'glass' ? 'rgba(255,255,255,0.95)' : mat.id === 'azuki' ? 'rgba(255,240,245,0.7)' : 'rgba(40,20,5,0.8)';
    ctx.lineWidth = mat.id === 'glass' ? 1.4 : 1.8;
    for (const c of o.cracks) {
      if (c.b.s >= n - 1) continue;
      const [cx, cy] = skinB([c.b], nx, ny, n, o.facing, o.widthScale);
      const r = prng(c.seed);
      ctx.beginPath();
      let px = cx[0];
      let py = cy[0];
      ctx.moveTo(px, py);
      let ang = c.ang + Math.PI / 2;
      const steps = 4;
      for (let k = 0; k < steps; k++) {
        ang += (r() - 0.5) * 1.2;
        px += Math.cos(ang) * (c.len / steps);
        py += Math.sin(ang) * (c.len / steps);
        ctx.lineTo(px, py);
        if (mat.id === 'glass' && r() < 0.5) {
          const a2 = ang + (r() < 0.5 ? 1 : -1) * 0.9;
          ctx.moveTo(px, py);
          ctx.lineTo(px + Math.cos(a2) * c.len * 0.3, py + Math.sin(a2) * c.len * 0.3);
          ctx.moveTo(px, py);
        }
      }
      ctx.stroke();
    }
  }
  if (o.flash && o.flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${Math.min(0.7, o.flash * 5)})`;
    ctx.fill(path);
  }
  ctx.restore();

  ctx.lineJoin = 'round';
  ctx.strokeStyle = mat.color.stroke;
  ctx.lineWidth = mat.id === 'glass' ? 1.6 : 2.4;
  ctx.stroke(path);
  ctx.restore();
}

export function shade(hex: string, amt: number): string {
  const c = parseInt(hex.slice(1), 16);
  let r = (c >> 16) & 255;
  let g = (c >> 8) & 255;
  let b = c & 255;
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt))));
  r = f(r);
  g = f(g);
  b = f(b);
  return `rgb(${r},${g},${b})`;
}

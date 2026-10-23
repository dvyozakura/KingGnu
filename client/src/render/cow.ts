/** 牛の描画（オリジナルのシンプルなキャラクター） */
import { COW, WORLD } from '@kinggnu/shared';
import { FighterView } from './view';

const SPOTS: [number, number, number, number][] = [
  [-30, -98, 22, 15],
  [18, -72, 16, 12],
  [-52, -70, 11, 9],
  [36, -100, 10, 8],
];

export function drawCowBody(ctx: CanvasRenderingContext2D, f: FighterView, t: number, tint: string) {
  const g = WORLD.groundY;
  ctx.save();
  ctx.translate(f.x, g);
  ctx.scale(f.facing, 1);
  // 影
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath();
  ctx.ellipse(0, 4, 95, 12, 0, 0, Math.PI * 2);
  ctx.fill();
  const crouch = f.phase === 'charge' ? f.charge * 8 : 0;
  const walk = Math.abs(f.vx) > 20 ? Math.sin(t * 14 + f.idx) * Math.min(1, Math.abs(f.vx) / 150) : 0;
  // 脚
  ctx.strokeStyle = '#2b2622';
  ctx.lineCap = 'round';
  const legs: [number, number][] = [
    [-50, 1],
    [-30, -1],
    [34, -1],
    [54, 1],
  ];
  for (const [lx, ph] of legs) {
    const sw = walk * 12 * ph;
    ctx.lineWidth = 15;
    ctx.strokeStyle = '#efe9df';
    ctx.beginPath();
    ctx.moveTo(lx, -60 + crouch);
    ctx.lineTo(lx + sw, -8);
    ctx.stroke();
    ctx.lineWidth = 15;
    ctx.strokeStyle = '#3a302a';
    ctx.beginPath();
    ctx.moveTo(lx + sw, -10);
    ctx.lineTo(lx + sw, -2);
    ctx.stroke();
  }
  // しっぽ
  ctx.strokeStyle = '#efe9df';
  ctx.lineWidth = 5;
  ctx.beginPath();
  const tw = Math.sin(t * 5 + f.idx * 2) * 8;
  ctx.moveTo(-COW.bodyHalfW + 4, -110 + crouch);
  ctx.quadraticCurveTo(-COW.bodyHalfW - 22, -90 + tw, -COW.bodyHalfW - 16, -62 + tw);
  ctx.stroke();
  ctx.fillStyle = '#3a302a';
  ctx.beginPath();
  ctx.ellipse(-COW.bodyHalfW - 16, -58 + tw, 5, 8, 0.2, 0, Math.PI * 2);
  ctx.fill();
  // 胴体
  const cy = COW.bodyCenterY + crouch * 0.6;
  const bodyGrad = ctx.createLinearGradient(0, cy - COW.bodyHalfH, 0, cy + COW.bodyHalfH);
  bodyGrad.addColorStop(0, '#fffdf8');
  bodyGrad.addColorStop(1, '#e4ddd0');
  ctx.fillStyle = bodyGrad;
  ctx.strokeStyle = '#2b2622';
  ctx.lineWidth = 3;
  roundRect(ctx, -COW.bodyHalfW, cy - COW.bodyHalfH, COW.bodyHalfW * 2, COW.bodyHalfH * 2, 30);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = '#2f2925';
  for (const [sx, sy, rx, ry] of SPOTS) {
    ctx.beginPath();
    ctx.ellipse(sx, sy + crouch * 0.6, rx, ry, 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  // チームカラーの首輪
  ctx.restore();
  ctx.stroke();
  ctx.fillStyle = tint;
  ctx.beginPath();
  ctx.ellipse(COW.pivotX - 14, COW.pivotY + 12 + crouch * 0.6, 9, 20, 0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffd34d';
  ctx.beginPath();
  ctx.arc(COW.pivotX - 8, COW.pivotY + 28 + crouch * 0.6, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#8a6a00';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

export function drawCowHead(ctx: CanvasRenderingContext2D, f: FighterView, t: number, ko: boolean) {
  const px = f.x + f.facing * COW.pivotX;
  const py = WORLD.groundY + COW.pivotY + (f.phase === 'charge' ? 6 * f.charge : 0);
  ctx.save();
  ctx.translate(px, py);
  ctx.scale(f.facing, 1);
  ctx.rotate(f.theta);
  const hx = COW.headCX;
  const hy = COW.headCY;
  // 耳
  ctx.fillStyle = '#efe9df';
  ctx.strokeStyle = '#2b2622';
  ctx.lineWidth = 2.5;
  const earWig = Math.sin(t * 3 + f.idx) * 0.1 - (f.stun > 0 ? 0.4 : 0);
  ctx.save();
  ctx.translate(hx - 22, hy - 16);
  ctx.rotate(-0.9 + earWig);
  ctx.beginPath();
  ctx.ellipse(-12, 0, 16, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#f3b5ac';
  ctx.beginPath();
  ctx.ellipse(-12, 0, 10, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // 頭
  const hg = ctx.createRadialGradient(hx - 6, hy - 10, 4, hx, hy, COW.headRX + 6);
  hg.addColorStop(0, '#ffffff');
  hg.addColorStop(1, '#e8e0d2');
  ctx.fillStyle = hg;
  ctx.beginPath();
  ctx.ellipse(hx, hy, COW.headRX, COW.headRY, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // ぶち
  ctx.save();
  ctx.clip();
  ctx.fillStyle = '#2f2925';
  ctx.beginPath();
  ctx.ellipse(hx - 18, hy - 14, 14, 10, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // 鼻づら
  ctx.fillStyle = '#f3a8a0';
  ctx.beginPath();
  ctx.ellipse(hx + 24, hy + 10, 17, 14, -0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#7a3a35';
  ctx.beginPath();
  ctx.ellipse(hx + 22, hy + 6, 2.8, 4, 0.2, 0, Math.PI * 2);
  ctx.ellipse(hx + 32, hy + 9, 2.8, 4, 0.2, 0, Math.PI * 2);
  ctx.fill();
  // 目
  const ex = hx + 6;
  const ey = hy - 6;
  ctx.lineWidth = 2.5;
  if (ko || f.hp <= 0) {
    ctx.strokeStyle = '#1d1d1d';
    xEye(ctx, ex, ey, 6);
  } else if (f.stun > 0.05) {
    ctx.strokeStyle = '#1d1d1d';
    ctx.beginPath();
    for (let a = 0; a < Math.PI * 4; a += 0.4) {
      const r = a * 0.9;
      const x = ex + Math.cos(a + t * 10) * r * 0.7;
      const y = ey + Math.sin(a + t * 10) * r * 0.7;
      if (a === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  } else {
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.ellipse(ex, ey, 7, f.guard ? 3 : 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1d1d1d';
    ctx.stroke();
    ctx.fillStyle = '#1d1d1d';
    ctx.beginPath();
    ctx.arc(ex + 2.5, ey + 0.5, f.phase === 'charge' ? 2.6 : 3.4, 0, Math.PI * 2);
    ctx.fill();
    if (f.phase === 'charge' || f.phase === 'swing') {
      // 怒り眉
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(ex - 8, ey - 12);
      ctx.lineTo(ex + 8, ey - 6);
      ctx.stroke();
    }
  }
  // 口
  ctx.strokeStyle = '#5a2a26';
  ctx.lineWidth = 2;
  ctx.beginPath();
  if (f.phase === 'swing') {
    ctx.ellipse(hx + 22, hy + 22, 5, 4, 0, 0, Math.PI * 2);
  } else {
    ctx.moveTo(hx + 14, hy + 20);
    ctx.quadraticCurveTo(hx + 22, hy + (f.stun > 0 ? 18 : 25), hx + 30, hy + 20);
  }
  ctx.stroke();
  ctx.restore();
}

function xEye(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x - r, y - r);
  ctx.lineTo(x + r, y + r);
  ctx.moveTo(x + r, y - r);
  ctx.lineTo(x - r, y + r);
  ctx.stroke();
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 角のプレビュー。animate=true のとき頭を振って、材質のしなりを実際の物理で見せる */
import { useEffect, useRef, useState } from 'react';
import { COW, HeadFrame, HornBody, MaterialId, Poly, WORLD, buildHornModel } from '@kinggnu/shared';
import { drawCowBody, drawCowHead } from '../render/cow';
import { drawHorn } from '../render/hornRender';
import { FighterView } from '../render/view';

interface Props {
  polygon: Poly;
  material: MaterialId;
  width?: number;
  height?: number;
  animate?: boolean;
  showBody?: boolean;
  /** 親要素の幅いっぱいに広げる（高さは幅×aspect） */
  fluid?: boolean;
  aspect?: number;
  /** 牛のスキン */
  skin?: string;
}

export function fakeFighter(x: number, theta: number, extra: Partial<FighterView> = {}): FighterView {
  return {
    idx: 0,
    facing: 1,
    name: '',
    material: 'plastic',
    x,
    vx: 0,
    theta,
    phase: 'idle',
    charge: 0,
    hp: 1,
    maxHp: 1,
    baseMaxHp: 1,
    guard: false,
    stun: 0,
    flash: 0,
    melt: 0,
    widthScale: 1,
    stress: 0,
    crackLevel: 0,
    destroyed: false,
    model: undefined as never,
    nodesX: [],
    nodesY: [],
    cracks: [],
    burn: 0,
    ...extra,
  };
}

export function HornPreview({ polygon, material, width: w0 = 260, height: h0 = 200, animate = false, showBody = false, fluid = false, aspect = 0.7, skin }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [fw, setFw] = useState(0);
  useEffect(() => {
    if (!fluid || !boxRef.current) return;
    const el = boxRef.current;
    const ro = new ResizeObserver(() => setFw(Math.round(el.clientWidth)));
    ro.observe(el);
    setFw(Math.round(el.clientWidth));
    return () => ro.disconnect();
  }, [fluid]);
  const width = fluid ? Math.max(80, fw) : w0;
  const height = fluid ? Math.round(width * aspect) : h0;
  useEffect(() => {
    if (fluid && !fw) return;
    const cv = ref.current;
    if (!cv || polygon.length < 3) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = width * dpr;
    cv.height = height * dpr;
    const ctx = cv.getContext('2d')!;
    let model;
    try {
      model = buildHornModel(polygon);
    } catch {
      return;
    }
    const fx = 0;
    const frame = (theta: number, omega: number): HeadFrame => ({
      px: fx + COW.pivotX,
      py: WORLD.groundY + COW.pivotY,
      theta,
      omega,
      vx: 0,
      vy: 0,
      facing: 1,
    });
    const horn = new HornBody(model, material, frame(0, 0));
    // 表示範囲
    // 振り回しても収まるよう、根元からの最大半径で表示範囲を決める
    let R = 60;
    for (const [x, y] of polygon) R = Math.max(R, Math.hypot(x, y));
    const minX = -Math.max(animate ? 110 : 70, R * (animate ? 0.75 : 0.25)) - (showBody ? 60 : 0);
    const maxX = R + 25;
    const minY = -R - 25;
    const maxY = Math.max(55, animate ? R * 0.7 : 55);
    const ax = fx + COW.pivotX + COW.anchorX;
    const ay = WORLD.groundY + COW.pivotY + COW.anchorY;
    const scale = Math.min(width / (maxX - minX), height / (maxY - minY)) * 0.92;
    let raf = 0;
    let t = 0;
    let theta = 0;
    let last = performance.now();
    const draw = () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += dt;
      if (animate) {
        // 振りかぶって→振り下ろす、を繰り返す
        const cyc = t % 2.2;
        const target = cyc < 0.9 ? -0.9 * (cyc / 0.9) : cyc < 1.15 ? 1.05 : 0;
        const prev = theta;
        theta += (target - theta) * Math.min(1, dt * (cyc < 0.9 ? 4 : cyc < 1.15 ? 16 : 5));
        const omega = (theta - prev) / Math.max(dt, 1e-3);
        const steps = 4;
        for (let s = 0; s < steps; s++) horn.step(dt / steps, frame(prev + ((theta - prev) * (s + 1)) / steps, omega));
      } else {
        horn.step(1 / 120, frame(0, 0));
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.save();
      ctx.translate(width / 2, height / 2);
      ctx.scale(scale, scale);
      ctx.translate(-(ax + (minX + maxX) / 2), -(ay + (minY + maxY) / 2));
      const f = fakeFighter(fx, theta, { material, skin });
      if (showBody) drawCowBody(ctx, f, t, '#e74c3c');
      drawHorn(ctx, {
        model,
        nodesX: horn.x,
        nodesY: horn.y,
        facing: 1,
        widthScale: 1,
        material,
        stress: 0,
        crackLevel: 0,
        cracks: [],
        melt: 0,
        time: t,
      });
      drawCowHead(ctx, f, t, false);
      ctx.restore();
      if (animate) raf = requestAnimationFrame(draw);
    };
    draw();
    if (!animate) {
      // 静止表示でも数フレーム回して落ち着かせる
      for (let i = 0; i < 30; i++) horn.step(1 / 120, frame(0, 0));
      draw();
    }
    return () => cancelAnimationFrame(raf);
  }, [polygon, material, width, height, animate, showBody, fluid, fw, skin]);
  if (fluid)
    return (
      <div ref={boxRef} className="horn-preview-box">
        <canvas ref={ref} style={{ width, height }} className="horn-preview" />
      </div>
    );
  return <canvas ref={ref} style={{ width, height }} className="horn-preview" />;
}

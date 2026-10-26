/** 牛の全身プレビュー（スキン選択用） */
import { useEffect, useRef } from 'react';
import { WORLD } from '@kinggnu/shared';
import { drawCowBody, drawCowHead } from '../render/cow';
import { fakeFighter } from './HornPreview';

export function CowPreview({ skin, width = 170, height = 120 }: { skin: string; width?: number; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = width * dpr;
    cv.height = height * dpr;
    const ctx = cv.getContext('2d')!;
    // 牛の範囲（x: しっぽ〜鼻先, y: 頭の上〜足元）
    const minX = -110;
    const maxX = 140;
    const minY = WORLD.groundY - 160;
    const maxY = WORLD.groundY + 16;
    const s = Math.min(width / (maxX - minX), height / (maxY - minY));
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (width / 2 - ((minX + maxX) / 2) * s), dpr * (height / 2 - ((minY + maxY) / 2) * s));
    const f = fakeFighter(0, -0.15, { skin });
    drawCowBody(ctx, f, 0.3, '#e74c3c');
    drawCowHead(ctx, f, 0.3, false);
  }, [skin, width, height]);
  return <canvas ref={ref} style={{ width, height }} className="horn-preview" />;
}

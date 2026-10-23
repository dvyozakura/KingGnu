/** バトル画面：描画ループと入力（PC: マウス/スペース長押し・←→/AD、スマホ: 長押し・移動ボタン） */
import { useEffect, useRef, useState } from 'react';
import { WORLD } from '@kinggnu/shared';
import { unlockAudio } from '../game/audio';
import { BattleResult, BattleSource } from '../game/source';
import { Scene } from '../render/scene';

interface Props {
  source: BattleSource;
  onEnd: (r: BattleResult) => void;
  onQuit: () => void;
  banner?: string;
}

export function Battle({ source, onEnd, onQuit, banner }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const input = useRef({ charge: false, keyCharge: false, ptrCharge: false, left: false, right: false });
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  pausedRef.current = paused;
  const endRef = useRef(onEnd);
  endRef.current = onEnd;
  const pushRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    const cv = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = cv.getContext('2d')!;
    const scene = new Scene();
    scene.you = source.you;
    let raf = 0;
    let last = performance.now();
    let endTimer = -1;
    let ended = false;
    const you = source.you;
    const facing = you === 0 ? 1 : -1;

    const pushInput = () => {
      const i = input.current;
      const worldDir = (i.right ? 1 : 0) - (i.left ? 1 : 0);
      const move = (worldDir * facing) as -1 | 0 | 1;
      source.setInput({ charge: i.keyCharge || i.ptrCharge, move });
    };

    const frame = () => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!pausedRef.current) source.update(dt);
      const view = source.view();
      const rect = wrap.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = rect.width;
      const h = rect.height;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
      }
      const scale = Math.min(w / WORLD.width, h / WORLD.height);
      const ox = (w - WORLD.width * scale) / 2;
      const oy = (h - WORLD.height * scale) / 2;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#3a7a33';
      ctx.fillRect(0, 0, w, h);
      if (view) {
        scene.handleEvents(source.drainEvents(), view);
        scene.update(dt * (view.state === 'ko' ? 0.5 : 1), view);
        ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
        scene.draw(ctx, view, ox / scale);
        scene.drawHud(ctx, view, { you, labels: source.labels, localCharge: source.localCharge?.() });
      } else {
        ctx.fillStyle = '#fff';
        ctx.font = '700 20px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText('接続中…', w / 2, h / 2);
      }
      const res = source.result();
      if (res && !ended) {
        ended = true;
        endTimer = window.setTimeout(() => endRef.current(res), 1400);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const onKey = (e: KeyboardEvent, down: boolean) => {
      const k = e.key;
      if (k === ' ' || k === 'Enter') {
        input.current.keyCharge = down;
        e.preventDefault();
      } else if (k === 'ArrowLeft' || k === 'a' || k === 'A') input.current.left = down;
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') input.current.right = down;
      else if (k === 'Escape' && down) setPaused((p) => !p);
      else return;
      if (e.repeat) return;
      unlockAudio();
      pushInput();
    };
    const kd = (e: KeyboardEvent) => onKey(e, true);
    const ku = (e: KeyboardEvent) => onKey(e, false);
    const blur = () => {
      input.current = { charge: false, keyCharge: false, ptrCharge: false, left: false, right: false };
      pushInput();
    };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', blur);
    pushRef.current = pushInput;
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(endTimer);
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('blur', blur);
    };
  }, [source]);

  const push = () => pushRef.current();
  const setPtr = (v: boolean) => {
    input.current.ptrCharge = v;
    push();
  };
  const setDir = (dir: 'left' | 'right', v: boolean) => {
    input.current[dir] = v;
    push();
  };

  return (
    <div className="screen battle" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="battle-canvas"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          unlockAudio();
          (e.target as Element).setPointerCapture(e.pointerId);
          setPtr(true);
        }}
        onPointerUp={() => setPtr(false)}
        onPointerCancel={() => setPtr(false)}
        onContextMenu={(e) => e.preventDefault()}
        style={{ touchAction: 'none' }}
      />
      <div className="move-pad">
        <button
          className="pad"
          onPointerDown={(e) => {
            e.stopPropagation();
            (e.target as Element).setPointerCapture(e.pointerId);
            setDir('left', true);
          }}
          onPointerUp={() => setDir('left', false)}
          onPointerCancel={() => setDir('left', false)}
        >
          ◀
        </button>
        <button
          className="pad"
          onPointerDown={(e) => {
            e.stopPropagation();
            (e.target as Element).setPointerCapture(e.pointerId);
            setDir('right', true);
          }}
          onPointerUp={() => setDir('right', false)}
          onPointerCancel={() => setDir('right', false)}
        >
          ▶
        </button>
      </div>
      <div className="battle-tip">長押しで溜めて、離して振る ／ 相手から離れる方向へ移動でガード</div>
      <div className="rotate-hint">📱 横向きにすると大きく遊べます</div>
      {banner && <div className="net-banner">{banner}</div>}
      <button className="pause-btn" onClick={() => setPaused((p) => !p)} aria-label="メニュー">
        ❚❚
      </button>
      {paused && (
        <div className="overlay">
          <div className="panel">
            <h3>ポーズ</h3>
            <button className="primary" onClick={() => setPaused(false)}>
              再開
            </button>
            <button onClick={onQuit}>やめる</button>
          </div>
        </div>
      )}
    </div>
  );
}

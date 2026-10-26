/** 角の作成画面：指/マウスで輪郭を描く → その場でクリーンな多角形・中心線・当たり判定を生成 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import {
  COW,
  HORN,
  HORN_TEMPLATES,
  HornModel,
  MATERIALS,
  MaterialId,
  Poly,
  Pt,
  WORLD,
  buildHornModel,
  computeMaxHP,
  hornDataToJSON,
  makeHornData,
  processOutline,
  templateStrokes,
  validateHornData,
} from '@kinggnu/shared';
import { sfx } from '../game/audio';
import { downloadText } from '../game/storage';
import { account, accountErrorText, useAccount } from '../account/session';
import { HORN_SLOTS_PREMIUM, ownsMaterial } from '@kinggnu/shared';
import { drawCowBody, drawCowHead } from '../render/cow';
import { drawHorn } from '../render/hornRender';
import { fakeFighter } from '../components/HornPreview';

export interface HornDraft {
  name: string;
  strokes: Poly[];
  polygon: Poly;
  material: MaterialId;
}

interface Props {
  initial: HornDraft;
  onDone: (d: HornDraft) => void;
  onBack: () => void;
  onShop?: () => void;
}

const VIEW = { minX: -170, maxX: 290, minY: -290, maxY: 130 };

export function HornEditor({ initial, onDone, onBack, onShop }: Props) {
  const { profile, status } = useAccount();
  const [material, setMaterial] = useState(initial.material);
  const [slotBusy, setSlotBusy] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [strokes, setStrokes] = useState<Poly[]>(initial.strokes.length ? initial.strokes : initial.polygon.length ? [initial.polygon] : []);
  const [name, setName] = useState(initial.name);
  const [showHit, setShowHit] = useState(false);
  const [message, setMessageRaw] = useState<string>('');
  const [msgId, setMsgId] = useState(0);
  const [msgVisible, setMsgVisible] = useState(false);
  const setMessage = (m: string) => {
    setMessageRaw(m);
    if (m) setMsgId((i) => i + 1);
  };
  // 修正・エラーのお知らせは数秒でフェードアウト
  useEffect(() => {
    if (!msgId) return;
    setMsgVisible(true);
    const t1 = setTimeout(() => setMsgVisible(false), 2600);
    const t2 = setTimeout(() => setMessageRaw(''), 3300);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [msgId]);
  const [importText, setImportText] = useState('');
  const [showIO, setShowIO] = useState(false);
  const drawing = useRef<Pt[] | null>(null);
  const [, force] = useState(0);
  const sizeRef = useRef({ w: 600, h: 520, scale: 1, ox: 0, oy: 0 });

  const outline = useMemo(() => (strokes.length ? processOutline(strokes) : null), [strokes]);
  const model: HornModel | null = useMemo(() => {
    if (!outline?.ok) return null;
    try {
      return buildHornModel(outline.polygon);
    } catch {
      return null;
    }
  }, [outline]);

  useEffect(() => {
    if (outline && !outline.ok && outline.error) setMessage(outline.error);
    else if (outline?.warnings.length) setMessage(outline.warnings.join(' '));
    else setMessage('');
  }, [outline]);

  // 描画
  useEffect(() => {
    const cv = canvasRef.current;
    const wrap = wrapRef.current;
    if (!cv || !wrap) return;
    let raf = 0;
    const render = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(200, rect.width);
      const h = Math.max(200, rect.height);
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
        cv.style.width = `${w}px`;
        cv.style.height = `${h}px`;
      }
      const scale = Math.min(w / (VIEW.maxX - VIEW.minX), h / (VIEW.maxY - VIEW.minY));
      const ox = (w - (VIEW.maxX - VIEW.minX) * scale) / 2 - VIEW.minX * scale;
      const oy = (h - (VIEW.maxY - VIEW.minY) * scale) / 2 - VIEW.minY * scale;
      sizeRef.current = { w, h, scale, ox, oy };
      const ctx = cv.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.translate(ox, oy);
      ctx.scale(scale, scale);
      // グリッド
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1 / scale;
      for (let x = Math.ceil(VIEW.minX / 20) * 20; x <= VIEW.maxX; x += 20) {
        ctx.beginPath();
        ctx.moveTo(x, VIEW.minY);
        ctx.lineTo(x, VIEW.maxY);
        ctx.stroke();
      }
      for (let y = Math.ceil(VIEW.minY / 20) * 20; y <= VIEW.maxY; y += 20) {
        ctx.beginPath();
        ctx.moveTo(VIEW.minX, y);
        ctx.lineTo(VIEW.maxX, y);
        ctx.stroke();
      }
      // 最大サイズ
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = 'rgba(255,211,77,0.35)';
      ctx.lineWidth = 2 / scale;
      ctx.beginPath();
      ctx.arc(0, 0, HORN.maxRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      // 牛（頭の上の印が角の根元）
      ctx.save();
      ctx.translate(0, -(WORLD.groundY + COW.pivotY + COW.anchorY));
      const f = fakeFighter(-COW.anchorX - COW.pivotX, 0, { material: material });
      drawCowBody(ctx, f, 0, '#e74c3c');
      ctx.restore();
      // 角
      if (model) {
        const nodesX = model.nodes.map((p) => p[0]);
        const nodesY = model.nodes.map((p) => p[1]);
        drawHorn(ctx, {
          model,
          nodesX,
          nodesY,
          facing: 1,
          widthScale: 1,
          material: material,
          stress: 0,
          crackLevel: 0,
          cracks: [],
          melt: 0,
          time: 0,
        });
        if (showHit) {
          // 凸分解された当たり判定ピースと中心線・節点
          model.pieces.forEach((piece, i) => {
            ctx.beginPath();
            piece.forEach((v, k) => (k ? ctx.lineTo(model.polygon[v][0], model.polygon[v][1]) : ctx.moveTo(model.polygon[v][0], model.polygon[v][1])));
            ctx.closePath();
            ctx.fillStyle = `hsla(${(i * 67) % 360},80%,60%,0.25)`;
            ctx.fill();
            ctx.strokeStyle = `hsla(${(i * 67) % 360},90%,70%,0.9)`;
            ctx.lineWidth = 1.2 / scale;
            ctx.stroke();
          });
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2 / scale;
          ctx.beginPath();
          model.nodes.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
          ctx.stroke();
          for (const [x, y] of model.nodes) {
            ctx.fillStyle = '#ffd34d';
            ctx.beginPath();
            ctx.arc(x, y, 3.5 / scale + 1.5, 0, Math.PI * 2);
            ctx.fill();
          }
          const [cx, cy] = model.stats.centroid;
          ctx.strokeStyle = '#ff4d4d';
          ctx.lineWidth = 2 / scale;
          ctx.beginPath();
          ctx.moveTo(cx - 6, cy);
          ctx.lineTo(cx + 6, cy);
          ctx.moveTo(cx, cy - 6);
          ctx.lineTo(cx, cy + 6);
          ctx.stroke();
        }
      }
      ctx.save();
      ctx.translate(0, -(WORLD.groundY + COW.pivotY + COW.anchorY));
      drawCowHead(ctx, f, 0, false);
      ctx.restore();
      // 根元の印
      ctx.strokeStyle = '#ffd34d';
      ctx.lineWidth = 3 / scale;
      ctx.beginPath();
      ctx.arc(0, 0, 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#ffd34d';
      ctx.beginPath();
      ctx.arc(0, 0, 3, 0, Math.PI * 2);
      ctx.fill();
      // 描きかけ
      const cur = drawing.current;
      if (cur && cur.length > 1) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3 / scale;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        cur.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(cur[cur.length - 1][0], cur[cur.length - 1][1]);
        ctx.lineTo(cur[0][0], cur[0][1]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (!strokes.length && !cur) {
        ctx.font = `700 ${16 / scale}px system-ui, sans-serif`;
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.textAlign = 'left';
        ctx.fillText('← 黄色い印から角の輪郭をぐるっと描こう', 16, 6);
      }
      ctx.restore();
      raf = requestAnimationFrame(render);
    };
    render();
    return () => cancelAnimationFrame(raf);
  }, [model, showHit, strokes.length, material]);

  const toLocal = (e: RPointerEvent): Pt => {
    const r = canvasRef.current!.getBoundingClientRect();
    const { scale, ox, oy } = sizeRef.current;
    return [(e.clientX - r.left - ox) / scale, (e.clientY - r.top - oy) / scale];
  };

  const onDown = (e: RPointerEvent) => {
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    drawing.current = [toLocal(e)];
  };
  const onMove = (e: RPointerEvent) => {
    const cur = drawing.current;
    if (!cur) return;
    const p = toLocal(e);
    const last = cur[cur.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= 2.5 && cur.length < HORN.maxRawPoints) cur.push(p);
  };
  const onUp = () => {
    const cur = drawing.current;
    drawing.current = null;
    if (!cur || cur.length < 6) {
      force((n) => n + 1);
      return;
    }
    const next = [...strokes, cur];
    const r = processOutline(next);
    if (!r.ok) {
      // 不正な輪郭は採用せず描き直しへ誘導
      setMessage(r.error ?? '描き直してください');
      force((n) => n + 1);
      return;
    }
    sfx.click();
    setStrokes(next);
  };

  const finalize = () => {
    if (!outline?.ok) return;
    sfx.click();
    onDone({ name: name || 'My Horn', strokes, polygon: outline.polygon, material: material });
  };

  const loadPoly = (poly: Poly, nm?: string) => {
    setStrokes([poly]);
    if (nm) setName(nm);
  };

  const doImport = (text: string) => {
    try {
      const v = validateHornData(JSON.parse(text));
      if (!v.ok || !v.value) {
        setMessage(`読み込めません: ${v.error}`);
        return;
      }
      const r = processOutline([v.value.vertices]);
      if (!r.ok) {
        setMessage(`読み込めません: ${r.error}`);
        return;
      }
      loadPoly(r.polygon, v.value.name);
      setImportText('');
      setShowIO(false);
    } catch {
      setMessage('JSON の形式が正しくありません');
    }
  };

  const stats = model?.stats;
  const mat = MATERIALS[material];
  const mass = stats ? (stats.area * mat.density * 0.008).toFixed(1) : '-';

  return (
    <div className="screen editor">
      <header className="bar">
        <button className="ghost" onClick={onBack}>
          ← 戻る
        </button>
        <h2>角をデザインする</h2>
        <input className="name-input" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} placeholder="角の名前" />
      </header>
      <div className="editor-body">
        <div className="editor-canvas" ref={wrapRef}>
          <canvas
            ref={canvasRef}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            style={{ touchAction: 'none' }}
          />
          {message && <div className={`toast fade ${msgVisible ? '' : 'out'} ${outline?.ok ? 'info' : 'warn'}`}>{message}</div>}
        </div>
        <aside className="editor-side">
          <div className="btn-row">
            <button onClick={() => setStrokes((s) => s.slice(0, -1))} disabled={!strokes.length}>
              ↶ 一つ戻る
            </button>
            <button onClick={() => setStrokes([])} disabled={!strokes.length}>
              リセット
            </button>
          </div>
          <p className="hint">輪郭は何回でも描き足せます（重ねた部分は1つの角になります）。ねじれた線や離れた部分は自動で修正します。</p>
          <h4>テンプレート</h4>
          <div className="tpl-grid">
            {HORN_TEMPLATES.map((t) => (
              <button key={t.id} className="small" onClick={() => setStrokes(templateStrokes(t.id))}>
                {t.name}
              </button>
            ))}
          </div>
          <h4>形状ステータス</h4>
          {stats ? (
            <table className="stats">
              <tbody>
                <tr>
                  <th>長さ</th>
                  <td>{stats.length.toFixed(0)} px</td>
                </tr>
                <tr>
                  <th>平均の太さ</th>
                  <td>{stats.avgWidth.toFixed(1)} px</td>
                </tr>
                <tr>
                  <th>最大の太さ</th>
                  <td>{stats.maxWidth.toFixed(1)} px</td>
                </tr>
                <tr>
                  <th>面積</th>
                  <td>{stats.area.toFixed(0)} px²</td>
                </tr>
                <tr>
                  <th>重心</th>
                  <td>
                    ({stats.centroid[0].toFixed(0)}, {(-stats.centroid[1]).toFixed(0)})
                  </td>
                </tr>
                <tr>
                  <th>慣性モーメント</th>
                  <td>{(stats.inertiaRoot / 1e6).toFixed(2)} M</td>
                </tr>
                <tr>
                  <th>前方リーチ</th>
                  <td>{stats.reachForward.toFixed(0)} px</td>
                </tr>
                <tr>
                  <th>質量（{mat.name}）</th>
                  <td>{mass}</td>
                </tr>
                <tr>
                  <th>最大HP（{mat.name}）</th>
                  <td>{computeMaxHP(mat, stats)}</td>
                </tr>
                <tr>
                  <th>頂点 / 凸ピース / 節点</th>
                  <td>
                    {model!.polygon.length} / {model!.pieces.length} / {model!.nodes.length}
                  </td>
                </tr>
              </tbody>
            </table>
          ) : (
            <p className="hint">まだ角がありません</p>
          )}
          <label className="check">
            <input type="checkbox" checked={showHit} onChange={(e) => setShowHit(e.target.checked)} /> 当たり判定（凸分解）と節点を表示
          </label>
          <h4>
            角の保存 <small className="muted">（{profile?.slots ?? 2}枠）</small>
          </h4>
          <div className="slot-list">
            {Array.from({ length: profile?.slots ?? 2 }, (_, i) => {
              const h = profile?.horns[i] ?? null;
              const online = status === 'online';
              const save = async () => {
                if (!outline?.ok) return;
                if (h && !window.confirm(`「${h.name}」に上書きしますか？`)) return;
                setSlotBusy(true);
                const r = await account.op({ op: 'saveHorn', slot: i, horn: makeHornData(name || 'My Horn', material, outline.polygon) });
                setSlotBusy(false);
                setMessage(r.ok ? `枠${i + 1}に保存しました` : accountErrorText(r.error));
              };
              return (
                <div key={i} className={`slot-item ${h ? '' : 'empty'}`}>
                  <span className="slot-no">{i + 1}</span>
                  {h ? (
                    <button
                      className="link"
                      onClick={() => {
                        loadPoly(h.vertices, h.name);
                        if (ownsMaterial(profile, h.material)) setMaterial(h.material);
                        setMessage(`「${h.name}」を読み込みました`);
                      }}
                    >
                      {h.name} <span className="muted">({MATERIALS[h.material].name})</span>
                    </button>
                  ) : (
                    <span className="muted">空き</span>
                  )}
                  <button className="small" disabled={!outline?.ok || !online || slotBusy} onClick={save} title={h ? '上書き保存' : '保存'}>
                    💾
                  </button>
                  {h && (
                    <button
                      className="x"
                      aria-label="削除"
                      disabled={!online || slotBusy}
                      onClick={async () => {
                        if (!window.confirm(`「${h.name}」を削除しますか？`)) return;
                        const r = await account.op({ op: 'deleteHorn', slot: i });
                        if (!r.ok) setMessage(accountErrorText(r.error));
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {status !== 'online' && <p className="hint">保存はサーバーに接続中のみできます</p>}
          {(profile?.slots ?? 2) < HORN_SLOTS_PREMIUM && (
            <button className="small" onClick={onShop}>
              保存枠を {HORN_SLOTS_PREMIUM} つに増やす（ショップ）
            </button>
          )}
          <h4>共有</h4>
          <div className="btn-row">
            <button
              className="small"
              disabled={!outline?.ok}
              onClick={() => outline?.ok && downloadText(`${(name || 'horn').replace(/[^\w\-]+/g, '_')}.json`, hornDataToJSON(makeHornData(name, material, outline.polygon)))}
            >
              ⬇ JSON書き出し
            </button>
            <button className="small" onClick={() => setShowIO((v) => !v)}>
              ⬆ 読み込み
            </button>
          </div>
          {showIO && (
            <div className="io">
              <input
                type="file"
                accept="application/json,.json"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) doImport(await f.text());
                }}
              />
              <textarea value={importText} onChange={(e) => setImportText(e.target.value)} placeholder='{"version":1,"name":"...","material":"rubber","vertices":[[0,0],...]}' />
              <button className="small" onClick={() => doImport(importText)}>
                貼り付けたJSONを読み込む
              </button>
            </div>
          )}
          <button className="primary big" disabled={!outline?.ok} onClick={finalize}>
            完成 → 材質を選ぶ
          </button>
        </aside>
      </div>
    </div>
  );
}

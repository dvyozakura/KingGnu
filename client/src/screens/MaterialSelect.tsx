/** 材質選択画面：材質カード + しなりが分かる物理プレビュー */
import { useMemo, useState } from 'react';
import { MATERIALS, MATERIAL_IDS, MATERIAL_UNLOCK_COST, MaterialId, Poly, buildHornModel, computeMaxHP, ownsMaterial } from '@kinggnu/shared';
import { account, accountErrorText, useAccount } from '../account/session';
import { EmeraldIcon, Emeralds } from '../components/Emerald';
import { HornPreview } from '../components/HornPreview';
import { MaterialBars, materialBadge } from '../components/MaterialBars';
import { sfx } from '../game/audio';
import { Guide } from './Guide';

interface Props {
  polygon: Poly;
  initial: MaterialId;
  onDone: (m: MaterialId) => void;
  onBack: () => void;
  nextLabel: string;
  /** 選べない材質（オンラインで使用禁止など） */
  disabled?: MaterialId[];
  disabledLabel?: string;
  onShop?: () => void;
}

export function MaterialSelect({ polygon, initial, onDone, onBack, nextLabel, disabled = [], disabledLabel = '使用不可', onShop }: Props) {
  const { profile, status } = useAccount();
  const usable = (k: MaterialId) => !disabled.includes(k) && ownsMaterial(profile, k);
  const [sel, setSel] = useState<MaterialId>(usable(initial) ? initial : (MATERIAL_IDS.find(usable) ?? 'plastic'));
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const locked = !ownsMaterial(profile, sel);
  const unlock = async () => {
    sfx.click();
    setBusy(true);
    const r = await account.op({ op: 'buyMaterial', material: sel });
    setBusy(false);
    setMsg(r.ok ? `${MATERIALS[sel].name}を解放しました！` : accountErrorText(r.error));
  };
  const [guide, setGuide] = useState(false);
  const stats = useMemo(() => buildHornModel(polygon).stats, [polygon]);
  const m = MATERIALS[sel];
  return (
    <div className="screen material">
      <header className="bar">
        <button className="ghost" onClick={onBack}>
          ← 角を描き直す
        </button>
        <h2>材質を選ぶ</h2>
        <div className="bar-right">
          <button className="ghost small" onClick={onShop}>
            <Emeralds n={profile?.emeralds ?? '-'} />
          </button>
          <button
            className="ghost"
            onClick={() => {
              sfx.click();
              setGuide(true);
            }}
          >
            📖 図説
          </button>
        </div>
      </header>
      <div className="material-body">
        <div className="cards">
          {MATERIAL_IDS.map((id) => {
            const mat = MATERIALS[id];
            const badge = materialBadge(id);
            const off = disabled.includes(id);
            return (
              <button
                key={id}
                disabled={off}
                title={off ? disabledLabel : undefined}
                className={`card mat-${id} ${sel === id ? 'selected' : ''} ${off ? 'banned' : ''} ${!ownsMaterial(profile, id) ? 'locked' : ''}`}
                onClick={() => {
                  sfx.click();
                  setMsg('');
                  setSel(id);
                }}
              >
                <div className="swatch" style={{ background: mat.color.fill, opacity: id === 'glass' ? 0.7 : 1 }} />
                <div className="card-title">
                  {mat.name}
                  {off ? (
                    <span className="badge ban">{disabledLabel}</span>
                  ) : !ownsMaterial(profile, id) ? (
                    <span className="badge lock">🔒 {MATERIAL_UNLOCK_COST}</span>
                  ) : (
                    badge && <span className="badge">{badge}</span>
                  )}
                </div>
                <MaterialBars id={id} />
              </button>
            );
          })}
        </div>
        <div className="mat-detail">
          <HornPreview polygon={polygon} material={sel} width={300} height={240} animate />
          <h3>{m.name}</h3>
          <p>{m.description}</p>
          <ul className="traits compact">
            {m.traits.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <table className="stats">
            <tbody>
              <tr>
                <th>この角の最大HP</th>
                <td>{computeMaxHP(m, stats)}</td>
              </tr>
              <tr>
                <th>角の質量</th>
                <td>{(stats.area * m.density * 0.008).toFixed(1)}</td>
              </tr>
              <tr>
                <th>反作用倍率</th>
                <td>×{m.recoilMultiplier}</td>
              </tr>
              <tr>
                <th>速さ</th>
                <td>×{m.speed}</td>
              </tr>
            </tbody>
          </table>
          {locked ? (
            <>
              <button className="primary big" disabled={busy || status !== 'online' || (profile?.emeralds ?? 0) < MATERIAL_UNLOCK_COST} onClick={unlock}>
                <EmeraldIcon size={22} /> {MATERIAL_UNLOCK_COST} で解放する
              </button>
              {status !== 'online' ? (
                <p className="hint">解放にはサーバーへの接続が必要です</p>
              ) : (profile?.emeralds ?? 0) < MATERIAL_UNLOCK_COST ? (
                <button onClick={onShop}>エメラルドが足りません → ショップへ</button>
              ) : null}
            </>
          ) : (
            <button
              className="primary big"
              onClick={() => {
                sfx.click();
                onDone(sel);
              }}
            >
              {nextLabel}
            </button>
          )}
          {msg && <div className="toast info static">{msg}</div>}
        </div>
      </div>
      {guide && <Guide polygon={polygon} initial={sel} onClose={() => setGuide(false)} />}
    </div>
  );
}

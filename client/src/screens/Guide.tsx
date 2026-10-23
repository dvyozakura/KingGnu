/** 材質図説：全材質の性質・特性・相性と、ダメージの仕組みをまとめて見られる画面（オーバーレイ） */
import { useMemo, useState } from 'react';
import { MATERIALS, MATERIAL_IDS, MATERIAL_MATCHUPS, MaterialId, Poly, buildHornModel, computeMaxHP, processOutline, templateStrokes } from '@kinggnu/shared';
import { HornPreview } from '../components/HornPreview';
import { MaterialBars, materialBadge } from '../components/MaterialBars';
import { sfx } from '../game/audio';

interface Props {
  onClose: () => void;
  /** プレビューに使う角（未指定ならお手本の角） */
  polygon?: Poly;
  initial?: MaterialId;
}

const demoPoly = processOutline(templateStrokes('classic')).polygon;

const BREAK_TEXT: Record<string, string> = {
  chip: '強い衝撃で欠ける',
  deform: '壊れない（大きく伸びる）',
  whiten: '強い衝撃で白くなり、少し変形する',
  snap: 'ひびが入り、限界を超えると折れる',
  shatter: 'ひびが入り、限界を超えると砕け散る',
  melt: '時間とともに溶けて細く短くなり、最後は消える',
  none: '壊れない',
  bend: '硬い角に叩かれると曲がり、元に戻らない',
};

function matchupsFor(id: MaterialId) {
  return MATERIAL_MATCHUPS.filter((m) => m.a === id || m.b === id).map((m) => {
    const from = MATERIALS[m.a].name;
    const to = m.b === '*' ? 'すべての相手' : MATERIALS[m.b].name;
    return { key: `${m.a}-${m.b}`, head: `${from} → ${to}`, text: m.text, mine: m.a === id };
  });
}

export function Guide({ onClose, polygon, initial }: Props) {
  const [sel, setSel] = useState<MaterialId>(initial ?? 'cork');
  const [tab, setTab] = useState<'materials' | 'rules'>('materials');
  const poly = polygon ?? demoPoly;
  const stats = useMemo(() => buildHornModel(poly).stats, [poly]);
  const m = MATERIALS[sel];
  const ups = matchupsFor(sel);
  const fastest = [...MATERIAL_IDS].sort((a, b) => MATERIALS[b].speed - MATERIALS[a].speed);
  return (
    <div className="guide-overlay" role="dialog" aria-label="材質図説">
      <header className="bar">
        <button
          className="ghost"
          onClick={() => {
            sfx.click();
            onClose();
          }}
        >
          ← 閉じる
        </button>
        <h2>材質図説</h2>
        <div className="seg">
          <button className={tab === 'materials' ? 'on' : ''} onClick={() => setTab('materials')}>
            材質
          </button>
          <button className={tab === 'rules' ? 'on' : ''} onClick={() => setTab('rules')}>
            しくみ
          </button>
        </div>
      </header>
      {tab === 'materials' ? (
        <div className="guide-body">
          <nav className="guide-list">
            {MATERIAL_IDS.map((id) => {
              const mat = MATERIALS[id];
              const badge = materialBadge(id);
              return (
                <button
                  key={id}
                  className={`guide-item mat-${id} ${sel === id ? 'selected' : ''}`}
                  onClick={() => {
                    sfx.click();
                    setSel(id);
                  }}
                >
                  <span className="swatch mini" style={{ background: mat.color.fill, opacity: id === 'glass' ? 0.7 : 1 }} />
                  <span className="gi-name">{mat.name}</span>
                  {badge && <span className="badge">{badge}</span>}
                </button>
              );
            })}
          </nav>
          <article className="guide-detail">
            <div className="gd-top">
              <HornPreview polygon={poly} material={sel} width={260} height={210} animate />
              <div className="gd-head">
                <h3>
                  {m.name} <small>{m.nameEn}</small>
                </h3>
                <p>{m.description}</p>
                <div className="gd-bars">
                  <MaterialBars id={sel} />
                </div>
              </div>
            </div>
            <section>
              <h4>特性</h4>
              <ul className="traits">
                {m.traits.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </section>
            {ups.length > 0 && (
              <section>
                <h4>相性・特殊効果</h4>
                <ul className="matchups">
                  {ups.map((u) => (
                    <li key={u.key} className={u.mine ? 'mine' : 'theirs'}>
                      <b>{u.head}</b>
                      <span>{u.text}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section>
              <h4>数値</h4>
              <table className="stats">
                <tbody>
                  <tr>
                    <th>基本HP（{polygon ? 'この角' : 'お手本の角'}での最大HP）</th>
                    <td>
                      {m.maxHP}（{computeMaxHP(m, stats)}）
                    </td>
                  </tr>
                  <tr>
                    <th>反作用倍率</th>
                    <td>×{m.recoilMultiplier}</td>
                  </tr>
                  <tr>
                    <th>速さ（移動・攻撃）</th>
                    <td>
                      ×{m.speed}（{fastest.indexOf(sel) + 1}位 / {MATERIAL_IDS.length}）
                    </td>
                  </tr>
                  <tr>
                    <th>重さ（密度）</th>
                    <td>{m.density}</td>
                  </tr>
                  <tr>
                    <th>壊れ方</th>
                    <td>{BREAK_TEXT[m.breakMode]}</td>
                  </tr>
                </tbody>
              </table>
            </section>
          </article>
        </div>
      ) : (
        <div className="guide-rules">
          <section className="panel">
            <h4>ダメージの種類</h4>
            <dl>
              <dt>直接打撃</dt>
              <dd>角を相手に当てた速さ × 角の重さ × 硬さ。正面から当てるほど強い。硬い・重い材質（鉄・あずき・ガラス・金）が得意。</dd>
              <dt>しなり（WHIP!）</dt>
              <dd>振った直後に遅れてしなった先端が戻る瞬間に当てると加速して大ダメージ。ゴム・コルク・炎などの柔らかい角が得意。</dd>
              <dt>反作用（反動）</dt>
              <dd>硬い角で強く叩くほど自分もダメージを受ける。鉄が最大。ガードしている相手を叩くと増える。</dd>
              <dt>接触ダメージ（炎）</dt>
              <dd>炎の角は触れているだけで相手を焼き、離れた後もしばらく燃え続ける。ガラスは燃えない。炎の角は実体がないので角どうしでは押し合わず、すり抜ける。</dd>
              <dt>BLOCK</dt>
              <dd>角で受けるとダメージは半分になる（ゼロにはならない）。</dd>
              <dt>GUARD</dt>
              <dd>相手から離れる方向に動いている間はダメージ軽減。</dd>
            </dl>
          </section>
          <section className="panel">
            <h4>角が壊れる・変わる</h4>
            <ul>
              {MATERIAL_IDS.map((id) => (
                <li key={id}>
                  <b>{MATERIALS[id].name}</b>：{BREAK_TEXT[MATERIALS[id].breakMode]}
                </li>
              ))}
            </ul>
            <p className="muted">角が元の長さの15%未満になるか、消えてしまうと負け。</p>
          </section>
          <section className="panel">
            <h4>相性まとめ</h4>
            <ul className="matchups">
              {MATERIAL_MATCHUPS.map((u) => (
                <li key={`${u.a}-${u.b}`} className="mine">
                  <b>
                    {MATERIALS[u.a].name} → {u.b === '*' ? 'すべての相手' : MATERIALS[u.b].name}
                  </b>
                  <span>{u.text}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="panel">
            <h4>速さの順番</h4>
            <p className="speed-order">{fastest.map((id) => MATERIALS[id].name).join(' ＞ ')}</p>
          </section>
        </div>
      )}
    </div>
  );
}

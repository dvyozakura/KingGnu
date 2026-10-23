/** 材質選択画面：6種類のカード + しなりが分かる物理プレビュー */
import { useMemo, useState } from 'react';
import { MATERIALS, MATERIAL_IDS, MaterialId, Poly, buildHornModel, computeMaxHP, materialBars } from '@kinggnu/shared';
import { HornPreview } from '../components/HornPreview';
import { sfx } from '../game/audio';

interface Props {
  polygon: Poly;
  initial: MaterialId;
  onDone: (m: MaterialId) => void;
  onBack: () => void;
  nextLabel: string;
}

function Bar({ label, v, color }: { label: string; v: number; color: string }) {
  return (
    <div className="bar-row">
      <span>{label}</span>
      <div className="meter">
        <div style={{ width: `${Math.round(Math.max(0.03, v) * 100)}%`, background: color }} />
      </div>
    </div>
  );
}

export function MaterialSelect({ polygon, initial, onDone, onBack, nextLabel }: Props) {
  const [sel, setSel] = useState<MaterialId>(initial);
  const stats = useMemo(() => buildHornModel(polygon).stats, [polygon]);
  const m = MATERIALS[sel];
  return (
    <div className="screen material">
      <header className="bar">
        <button className="ghost" onClick={onBack}>
          ← 角を描き直す
        </button>
        <h2>材質を選ぶ</h2>
        <span />
      </header>
      <div className="material-body">
        <div className="cards">
          {MATERIAL_IDS.map((id) => {
            const mat = MATERIALS[id];
            const b = materialBars(id);
            return (
              <button
                key={id}
                className={`card mat-${id} ${sel === id ? 'selected' : ''}`}
                onClick={() => {
                  sfx.click();
                  setSel(id);
                }}
              >
                <div className="swatch" style={{ background: mat.color.fill, opacity: id === 'glass' ? 0.7 : 1 }} />
                <div className="card-title">
                  {mat.name}
                  {id === 'azuki' && <span className="badge">BOSS</span>}
                </div>
                <Bar label="硬度" v={b.hardness} color="#f2c14e" />
                <Bar label="しなり" v={b.flex} color="#5bd66b" />
                <Bar label="HP" v={b.hp} color="#ef5350" />
                <Bar label="反作用" v={b.recoil} color="#b388ff" />
              </button>
            );
          })}
        </div>
        <div className="mat-detail">
          <HornPreview polygon={polygon} material={sel} width={300} height={240} animate />
          <h3>{m.name}</h3>
          <p>{m.description}</p>
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
            </tbody>
          </table>
          <button
            className="primary big"
            onClick={() => {
              sfx.click();
              onDone(sel);
            }}
          >
            {nextLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

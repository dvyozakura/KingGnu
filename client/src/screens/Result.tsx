/** リザルト画面 */
import { useEffect } from 'react';
import { EndReason, MATERIALS } from '@kinggnu/shared';
import { sfx } from '../game/audio';
import { BattleResult } from '../game/source';

const REASON: Record<EndReason, string> = {
  ko: 'K.O.',
  horn: '角が折れて戦闘不能',
  melt: 'アイスが溶けきった',
  timeup: '時間切れ（HP判定）',
  draw: '時間切れ引き分け',
  forfeit: '相手の切断・離脱',
  double: '相打ち',
};

interface Props {
  result: BattleResult;
  actions: { label: string; onClick: () => void; primary?: boolean; disabled?: boolean }[];
  note?: string;
}

export function Result({ result, actions, note }: Props) {
  const win = result.winner === result.you;
  const draw = result.winner === null;
  useEffect(() => {
    if (draw) return;
    if (win) sfx.win();
    else sfx.lose();
  }, [win, draw]);
  const rows: [string, (i: 0 | 1) => string][] = [
    ['与えたダメージ', (i) => `${Math.round(result.stats[i].dealt)}`],
    ['受けた反作用ダメージ', (i) => `${Math.round(result.stats[i].recoilTaken)}`],
    ['最大衝突速度', (i) => `${result.stats[i].maxImpactSpeed} px/s`],
    ['最大単発ダメージ', (i) => `${result.stats[i].maxHit}`],
    ['ヒット数（しなり）', (i) => `${result.stats[i].hits}（${result.stats[i].whipHits}）`],
  ];
  return (
    <div className="screen result">
      <div className="panel result-panel">
        <h1 className={draw ? 'draw' : win ? 'win' : 'lose'}>{draw ? 'DRAW' : win ? 'YOU WIN!' : 'YOU LOSE…'}</h1>
        <p className="reason">
          {REASON[result.reason]} ／ 戦闘時間 {result.time.toFixed(1)} 秒
        </p>
        <table className="result-table">
          <thead>
            <tr>
              <th />
              {[0, 1].map((i) => (
                <th key={i} className={i === result.you ? 'you' : ''}>
                  {result.names[i]}
                  {i === result.you ? '（あなた）' : ''}
                  <div className="muted">{MATERIALS[result.materials[i]].name}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, fn]) => (
              <tr key={label}>
                <th>{label}</th>
                <td>{fn(0)}</td>
                <td>{fn(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {note && <p className="hint">{note}</p>}
        <div className="btn-col">
          {actions.map((a) => (
            <button key={a.label} className={a.primary ? 'primary big' : ''} onClick={a.onClick} disabled={a.disabled}>
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

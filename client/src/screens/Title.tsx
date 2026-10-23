/** タイトル画面 */
import { useState } from 'react';
import { HornPreview } from '../components/HornPreview';
import { isMuted, setMuted, sfx, unlockAudio } from '../game/audio';
import { processOutline, templateStrokes } from '@kinggnu/shared';
import { Guide } from './Guide';

interface Props {
  onCpu: () => void;
  onOnline: () => void;
}

const demo = processOutline(templateStrokes('whip')).polygon;

export function Title({ onCpu, onOnline }: Props) {
  const [help, setHelp] = useState(false);
  const [guide, setGuide] = useState(false);
  const [mute, setMute] = useState(isMuted());
  const go = (fn: () => void) => () => {
    unlockAudio();
    sfx.click();
    fn();
  };
  return (
    <div className="screen title">
      <div className="title-wrap">
        <div className="logo">
          <span className="logo-king">KING</span>
          <span className="logo-gnu">GNU</span>
        </div>
        <p className="tagline">自分で描いた角で殴り合え。</p>
        <div className="title-demo">
          <HornPreview polygon={demo} material="rubber" width={280} height={190} animate showBody />
        </div>
        <div className="btn-col">
          <button className="primary big" onClick={go(onCpu)}>
            GAME START <small>CPU BATTLE</small>
          </button>
          <button className="big alt" onClick={go(onOnline)}>
            ONLINE BATTLE
          </button>
          <div className="btn-row stretch">
            <button className="ghost" onClick={() => setHelp(true)}>
              操作説明
            </button>
            <button className="ghost" onClick={go(() => setGuide(true))}>
              📖 材質図説
            </button>
          </div>
          <button
            className="ghost small"
            onClick={() => {
              setMuted(!mute);
              setMute(!mute);
            }}
          >
            {mute ? '🔇 サウンドOFF' : '🔊 サウンドON'}
          </button>
        </div>
      </div>
      {help && (
        <div className="overlay" onClick={() => setHelp(false)}>
          <div className="panel help" onClick={(e) => e.stopPropagation()}>
            <h3>遊び方</h3>
            <ol>
              <li>牛の頭の上の印から、角の輪郭を指やマウスでぐるっと描く（何度でも描き足せる）。</li>
              <li>材質を選ぶ。形と材質で重さ・しなり・HP・当たり判定がすべて変わる。</li>
              <li>バトル：押している間チャージ → 離すと突進しながら角を振る。</li>
            </ol>
            <table className="stats">
              <tbody>
                <tr>
                  <th>チャージ / 攻撃</th>
                  <td>PC: 左クリック or スペース長押し → 離す ／ スマホ: 画面長押し → 離す</td>
                </tr>
                <tr>
                  <th>移動</th>
                  <td>PC: ← → / A D ／ スマホ: 左下の ◀ ▶</td>
                </tr>
                <tr>
                  <th>ガード</th>
                  <td>相手から離れる方向へ移動中はダメージ軽減（攻撃側の反作用が増える）</td>
                </tr>
                <tr>
                  <th>ポーズ</th>
                  <td>Esc / 右上のボタン</td>
                </tr>
              </tbody>
            </table>
            <h4>コツ</h4>
            <ul>
              <li>柔らかい角（ゴム・コルク）は振った直後に先端が遅れてしなる。先端が戻ってくる瞬間に当てると「WHIP!」で大ダメージ。</li>
              <li>硬い角（ガラス・あずきのアイス・鉄）は一撃が重いが、自分にも反作用ダメージ。ガラスはヒビが入ると脆くなる。</li>
              <li>あずきのアイスは時間とともに溶けて細く短くなる。炎やコルクに触れると溶けが速い。短期決戦で！</li>
              <li>炎は触れるだけで燃やす。金は硬い角とぶつかると曲がる。珊瑚はゴムに強い。くわしくは「材質図説」へ。</li>
              <li>長い角は届くが重くて振りが遅い。短い角は速い。</li>
            </ul>
            <button className="primary" onClick={() => setHelp(false)}>
              閉じる
            </button>
          </div>
        </div>
      )}
      {guide && <Guide onClose={() => setGuide(false)} />}
    </div>
  );
}

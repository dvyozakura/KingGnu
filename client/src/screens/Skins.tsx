/** 牛のスキン（見た目だけ。能力差なし） */
import { useState } from 'react';
import { SKINS } from '@kinggnu/shared';
import { account, accountErrorText, useAccount } from '../account/session';
import { EmeraldIcon, Emeralds } from '../components/Emerald';
import { CowPreview } from '../components/CowPreview';
import { sfx } from '../game/audio';


export function Skins({ onBack, onShop }: { onBack: () => void; onShop: () => void }) {
  const { profile, status } = useAccount();
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const online = status === 'online';
  const act = async (id: string, buy: boolean) => {
    sfx.click();
    setBusy(id);
    const r = await account.op(buy ? { op: 'buySkin', skin: id } : { op: 'equipSkin', skin: id });
    setBusy('');
    setMsg(r.ok ? (buy ? '購入して装備しました！' : '装備しました') : accountErrorText(r.error));
  };
  return (
    <div className="screen skins">
      <header className="bar">
        <button className="ghost" onClick={onBack}>
          ← 戻る
        </button>
        <h2>牛のスキン</h2>
        <button className="ghost" onClick={onShop}>
          <Emeralds n={profile?.emeralds ?? '-'} />
        </button>
      </header>
      <div className="skins-body">
        <p className="hint">見た目だけが変わります（強さは変わりません）。オンライン対戦の相手にも見えます。</p>
        {!online && <div className="toast warn static">サーバーに接続できません。購入・装備は接続中のみできます</div>}
        <div className="skin-grid">
          {SKINS.map((s) => {
            const have = s.price === 0 || !!profile?.skins.includes(s.id);
            const equipped = (profile?.skin ?? 'holstein') === s.id;
            return (
              <div key={s.id} className={`skin-card ${equipped ? 'selected' : ''}`}>
                <CowPreview skin={s.id} />
                <b>{s.name}</b>
                {equipped ? (
                  <span className="badge">装備中</span>
                ) : have ? (
                  <button className="small" disabled={!online || !!busy} onClick={() => act(s.id, false)}>
                    装備する
                  </button>
                ) : (
                  <button className="small primary" disabled={!online || !!busy || (profile?.emeralds ?? 0) < s.price} onClick={() => act(s.id, true)}>
                    <EmeraldIcon size={14} /> {s.price}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {msg && <div className="toast info static">{msg}</div>}
      </div>
    </div>
  );
}

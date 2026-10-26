/** ショップ：エメラルド・保存枠拡張・広告削除の購入、材質の解放 */
import { useEffect, useState } from 'react';
import { FREE_MATERIALS, MATERIALS, MATERIAL_IDS, MATERIAL_UNLOCK_COST, PRODUCTS, PRODUCT_IDS, ProductId, ownsMaterial } from '@kinggnu/shared';
import native from '@native-bridge';
import { account, accountErrorText, useAccount } from '../account/session';
import { EmeraldIcon, Emeralds } from '../components/Emerald';
import { sfx } from '../game/audio';

interface Props {
  onBack: () => void;
  onSkins: () => void;
}

/** Web 版でもテスト購入できるようにする（開発時のみ。サーバー側でも ALLOW_TEST_PURCHASES=1 が必要） */
export const TEST_PURCHASES = import.meta.env.DEV || import.meta.env.VITE_TEST_PURCHASES === '1';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function Shop({ onBack, onSkins }: Props) {
  const { profile, status } = useAccount();
  const [prices, setPrices] = useState<Partial<Record<ProductId, string>>>({});
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const online = status === 'online';

  useEffect(() => {
    native.prices().then(setPrices, () => undefined);
  }, []);

  const owned = (p: ProductId) => (p === 'kinghorn.slots8' ? (profile?.slots ?? 0) >= 8 : p === 'kinghorn.noads' ? !!profile?.noAds : false);

  const buy = async (p: ProductId) => {
    sfx.click();
    setMsg('');
    setBusy(p);
    try {
      if (native.platform === 'web') {
        if (!TEST_PURCHASES) {
          setMsg('購入はアプリ版（iPhone / Android）でできます');
          return;
        }
        const r = await account.op({ op: 'testPurchase', product: p });
        setMsg(r.ok ? `テスト購入しました：${PRODUCTS[p].name}` : accountErrorText(r.error));
        return;
      }
      try {
        await native.purchase(p);
      } catch (e) {
        if ((e as Error).message === 'cancelled') return;
        setMsg(`購入できませんでした：${(e as Error).message}`);
        return;
      }
      // ストアの反映に少し時間がかかることがあるので数回確認する
      for (let i = 0; i < 4; i++) {
        const r = await account.op({ op: 'syncPurchases' });
        if (r.ok && r.granted?.includes(p)) {
          setMsg(`購入しました：${PRODUCTS[p].name}`);
          return;
        }
        if (!r.ok && r.error !== 'purchases_unreachable') {
          setMsg(accountErrorText(r.error));
          return;
        }
        await sleep(1500 * (i + 1));
      }
      setMsg('購入の反映に時間がかかっています。しばらくしてから「購入を復元」を押してください');
    } finally {
      setBusy('');
    }
  };

  const restore = async () => {
    sfx.click();
    setMsg('');
    setBusy('restore');
    try {
      if (native.platform !== 'web') await native.restore();
      const r = await account.op({ op: 'syncPurchases' });
      setMsg(r.ok ? (r.granted?.length ? `復元しました（${r.granted.length}件）` : '復元するものはありませんでした') : accountErrorText(r.error));
    } catch (e) {
      setMsg(`復元できませんでした：${(e as Error).message}`);
    } finally {
      setBusy('');
    }
  };

  const unlock = async (m: (typeof MATERIAL_IDS)[number]) => {
    sfx.click();
    setBusy(m);
    const r = await account.op({ op: 'buyMaterial', material: m });
    setBusy('');
    setMsg(r.ok ? `${MATERIALS[m].name}を解放しました！` : accountErrorText(r.error));
  };

  return (
    <div className="screen shop">
      <header className="bar">
        <button className="ghost" onClick={onBack}>
          ← 戻る
        </button>
        <h2>ショップ</h2>
        <Emeralds n={profile?.emeralds ?? '-'} />
      </header>
      <div className="shop-body">
        {!online && <div className="toast warn static">{status === 'connecting' ? 'サーバーに接続中…' : 'サーバーに接続できません。購入・解放は接続中のみできます'}</div>}
        <section className="panel">
          <h3>アイテム</h3>
          <div className="products">
            {PRODUCT_IDS.map((p) => {
              const d = PRODUCTS[p];
              const have = owned(p);
              return (
                <div key={p} className={`product ${have ? 'owned' : ''}`}>
                  <div className="product-icon">{d.emeralds ? <EmeraldIcon size={34} /> : p === 'kinghorn.slots8' ? '🗂️' : '🚫'}</div>
                  <div className="product-text">
                    <b>{d.name}</b>
                    <span>{d.description}</span>
                  </div>
                  <button className={have ? '' : 'primary'} disabled={have || !online || !!busy} onClick={() => buy(p)}>
                    {have ? '購入済み' : busy === p ? '…' : (prices[p] ?? `¥${d.priceJpy}`)}
                  </button>
                </div>
              );
            })}
          </div>
          <div className="btn-row">
            <button className="small" disabled={!online || !!busy} onClick={restore}>
              購入を復元
            </button>
            {native.platform === 'web' && <span className="hint">{TEST_PURCHASES ? '開発モード：ストアを通さないテスト購入になります' : '購入はアプリ版でできます'}</span>}
          </div>
        </section>
        <section className="panel">
          <h3>
            材質の解放 <small className="muted">各 {MATERIAL_UNLOCK_COST} エメラルド</small>
          </h3>
          <div className="unlock-list">
            {MATERIAL_IDS.map((m) => {
              const mat = MATERIALS[m];
              const have = ownsMaterial(profile, m);
              return (
                <div key={m} className={`unlock-item mat-${m} ${have ? 'owned' : ''}`}>
                  <span className="swatch mini" style={{ background: mat.color.fill }} />
                  <span className="gi-name">{mat.name}</span>
                  {FREE_MATERIALS.includes(m) ? (
                    <span className="muted small">最初から</span>
                  ) : have ? (
                    <span className="muted small">解放済み</span>
                  ) : (
                    <button className="small primary" disabled={!online || !!busy || (profile?.emeralds ?? 0) < MATERIAL_UNLOCK_COST} onClick={() => unlock(m)}>
                      <EmeraldIcon size={14} /> {MATERIAL_UNLOCK_COST}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
        <section className="panel">
          <h3>牛のスキン</h3>
          <p className="hint">見た目だけが変わります（強さは変わりません）。</p>
          <button onClick={onSkins}>スキンを見る →</button>
        </section>
        <p className="hint">毎日ログインすると エメラルドが 10 個もらえます。</p>
        {msg && <div className="toast info static">{msg}</div>}
      </div>
    </div>
  );
}

/** ログインボーナスの表示と、アカウント（サインイン・引き継ぎ）パネル */
import { useState } from 'react';
import native from '@native-bridge';
import { account, accountErrorText, useAccount } from '../account/session';
import { sfx } from '../game/audio';
import { EmeraldIcon, Emeralds } from './Emerald';

export function LoginBonus() {
  const { bonus, profile } = useAccount();
  if (!bonus) return null;
  return (
    <div className="overlay" onClick={() => account.clearBonus()}>
      <div className="panel bonus" onClick={(e) => e.stopPropagation()}>
        <h3>ログインボーナス！</h3>
        <div className="bonus-gem">
          <EmeraldIcon size={64} />
          <b>+{bonus}</b>
        </div>
        <p>
          所持エメラルド：<Emeralds n={profile?.emeralds ?? bonus} />
        </p>
        <p className="hint">毎日ログインすると 10 個もらえます。</p>
        <button
          className="primary"
          onClick={() => {
            sfx.click();
            account.clearBonus();
          }}
        >
          受け取る
        </button>
      </div>
    </div>
  );
}

export function AccountPanel({ onClose }: { onClose: () => void }) {
  const { profile, status, error } = useAccount();
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const signIn = async (p: 'apple' | 'google') => {
    sfx.click();
    setBusy(true);
    const r = await account.signIn(p);
    setBusy(false);
    setMsg(r.ok ? 'サインインしました。機種変更しても同じアカウントで遊べます' : accountErrorText(r.error));
  };
  const linked = profile?.providers.filter((p) => p !== 'guest') ?? [];
  return (
    <div className="overlay" onClick={onClose}>
      <div className="panel account" onClick={(e) => e.stopPropagation()}>
        <h3>アカウント</h3>
        <table className="stats">
          <tbody>
            <tr>
              <th>状態</th>
              <td>{status === 'online' ? 'オンライン' : status === 'connecting' ? '接続中…' : 'オフライン'}</td>
            </tr>
            <tr>
              <th>ID</th>
              <td className="mono">{profile?.id ?? '-'}</td>
            </tr>
            <tr>
              <th>引き継ぎ</th>
              <td>{linked.length ? linked.map((p) => (p === 'apple' ? 'Apple' : 'Google')).join(' / ') : '未設定（この端末だけ）'}</td>
            </tr>
            <tr>
              <th>エメラルド</th>
              <td>
                <Emeralds n={profile?.emeralds ?? '-'} />
              </td>
            </tr>
            <tr>
              <th>レート</th>
              <td>
                {profile ? `${profile.rating}（${profile.ranked.wins}勝 ${profile.ranked.losses}敗${profile.ranked.draws ? ` ${profile.ranked.draws}分` : ''}）` : '-'}
              </td>
            </tr>
          </tbody>
        </table>
        {native.platform === 'web' ? (
          <p className="hint">
            Web版はこのブラウザだけのアカウントです。アプリ版では「Appleでサインイン」「Googleでサインイン」で機種変更しても引き継げます。
          </p>
        ) : (
          <>
            <p className="hint">サインインしておくと、機種変更・再インストールしてもエメラルドや購入したものを引き継げます。</p>
            <div className="btn-col">
              {native.platform === 'ios' && !linked.includes('apple') && (
                <button className="signin apple" disabled={busy || status !== 'online'} onClick={() => signIn('apple')}>
                   Appleでサインイン
                </button>
              )}
              {!linked.includes('google') && (
                <button className="signin google" disabled={busy || status !== 'online'} onClick={() => signIn('google')}>
                  G Googleでサインイン
                </button>
              )}
            </div>
          </>
        )}
        {status === 'offline' && <button onClick={() => account.reconnect()}>再接続</button>}
        {(msg || error) && <div className="toast info static">{msg || error}</div>}
        <button className="primary" onClick={onClose}>
          閉じる
        </button>
      </div>
    </div>
  );
}

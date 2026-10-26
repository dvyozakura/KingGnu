/** 試合後の広告（アプリ版のみ。広告削除を買っていれば出さない） */
import native from '@native-bridge';
import { account } from './session';

let matches = 0;
/** 何試合ごとに広告を出すか */
const EVERY = 2;

export async function afterMatchAd() {
  if (native.platform === 'web') return;
  if (account.state.profile?.noAds) return;
  matches++;
  if (matches % EVERY !== 0) return;
  try {
    await native.showInterstitial();
  } catch {
    /* 広告が無い・読み込めないときは何もしない */
  }
}

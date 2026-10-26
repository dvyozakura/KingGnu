/**
 * アプリ版（iOS / Android）の課金・広告・サインイン。
 * client/vite.config.ts で VITE_NATIVE=1 のとき @native-bridge としてこのファイルが使われる。
 *
 *  - 課金   : RevenueCat（@revenuecat/purchases-capacitor）。レシート検証は RevenueCat、付与は自宅サーバー
 *  - 広告   : AdMob（@capacitor-community/admob）。ID 未設定ならテスト広告
 *  - サインイン : Apple / Google（@capgo/capacitor-social-login）。ID トークンをサーバーで検証する
 *
 * ※ この環境ではネイティブのビルドができないため、実機での動作確認はまだ（README 参照）。
 */
import { Capacitor } from '@capacitor/core';
import { PRODUCT_CATEGORY, PURCHASES_ERROR_CODE, Purchases } from '@revenuecat/purchases-capacitor';
import { AdMob } from '@capacitor-community/admob';
import { SocialLogin } from '@capgo/capacitor-social-login';
import type { ProductId } from '@kinggnu/shared';
import type { NativeBridge, Platform } from '../../client/src/native/types';

const env = import.meta.env;
const platform = Capacitor.getPlatform() as Platform;

/** Google が公開しているテスト用広告ユニット（本番の ID が未設定のときに使う） */
const TEST_INTERSTITIAL = {
  ios: 'ca-app-pub-3940256099942544/4411468910',
  android: 'ca-app-pub-3940256099942544/1033173712',
};
const PRODUCT_IDS: ProductId[] = ['kinghorn.emerald100', 'kinghorn.slots8', 'kinghorn.noads'];

let purchasesReady = false;
let currentUser = '';

function rcKey(): string | undefined {
  return platform === 'ios' ? env.VITE_REVENUECAT_IOS_KEY : env.VITE_REVENUECAT_ANDROID_KEY;
}

function interstitialId(): { adId: string; isTesting: boolean } {
  const real = platform === 'ios' ? env.VITE_ADMOB_INTERSTITIAL_IOS : env.VITE_ADMOB_INTERSTITIAL_ANDROID;
  return real ? { adId: real, isTesting: false } : { adId: platform === 'ios' ? TEST_INTERSTITIAL.ios : TEST_INTERSTITIAL.android, isTesting: true };
}

const bridge: NativeBridge = {
  platform,

  async init() {
    try {
      await AdMob.initialize({});
      if (platform === 'ios') {
        // iOS の「トラッキングの許可」ダイアログ（拒否されても広告は出る。パーソナライズされないだけ）
        const { status } = await AdMob.trackingAuthorizationStatus();
        if (status === 'notDetermined') await AdMob.requestTrackingAuthorization();
      }
    } catch (e) {
      console.warn('admob init failed', e);
    }
    try {
      await SocialLogin.initialize({
        apple: {},
        google: { webClientId: env.VITE_GOOGLE_WEB_CLIENT_ID, iOSClientId: env.VITE_GOOGLE_IOS_CLIENT_ID, mode: 'online' },
      });
    } catch (e) {
      console.warn('social login init failed', e);
    }
  },

  async signIn(provider) {
    const res = await SocialLogin.login(
      provider === 'apple' ? { provider: 'apple', options: { scopes: ['email'] } } : { provider: 'google', options: { scopes: ['profile', 'email'] } },
    );
    const r = res.result as { idToken?: string | null; identityToken?: string | null };
    const token = r.idToken ?? r.identityToken;
    if (!token) throw new Error('signin_failed');
    return token;
  },

  async setUser(accountId) {
    const apiKey = rcKey();
    if (!apiKey || accountId === currentUser) return;
    if (!purchasesReady) {
      await Purchases.configure({ apiKey, appUserID: accountId });
      purchasesReady = true;
    } else {
      await Purchases.logIn({ appUserID: accountId });
    }
    currentUser = accountId;
  },

  async purchase(product) {
    if (!purchasesReady) throw new Error('課金の準備ができていません');
    const { products } = await Purchases.getProducts({ productIdentifiers: [product], type: PRODUCT_CATEGORY.NON_SUBSCRIPTION });
    if (!products.length) throw new Error('商品が見つかりません');
    try {
      await Purchases.purchaseStoreProduct({ product: products[0] });
    } catch (e) {
      const err = e as { userCancelled?: boolean; code?: string };
      if (err.userCancelled || err.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR) throw new Error('cancelled');
      throw e;
    }
  },

  async restore() {
    if (!purchasesReady) throw new Error('課金の準備ができていません');
    await Purchases.restorePurchases();
  },

  async prices() {
    if (!purchasesReady) return {};
    const { products } = await Purchases.getProducts({ productIdentifiers: PRODUCT_IDS, type: PRODUCT_CATEGORY.NON_SUBSCRIPTION });
    const out: Partial<Record<ProductId, string>> = {};
    for (const p of products) out[p.identifier as ProductId] = p.priceString;
    return out;
  },

  async showInterstitial() {
    await AdMob.prepareInterstitial(interstitialId());
    await AdMob.showInterstitial();
  },
};

export default bridge;

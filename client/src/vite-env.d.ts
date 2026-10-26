/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** オンライン対戦サーバーの WebSocket URL（例: wss://kinggnu.yein.jp）。末尾の /ws は自動で補う */
  readonly VITE_SERVER_URL?: string;
  readonly VITE_BASE?: string;
  /** アプリ版ビルド（Capacitor）なら '1' */
  readonly VITE_NATIVE?: string;
  /** Web 版でテスト購入ボタンを出す（開発用。サーバー側 ALLOW_TEST_PURCHASES=1 も必要） */
  readonly VITE_TEST_PURCHASES?: string;
  /** RevenueCat の公開 SDK キー（アプリ内に入る前提のキー。シークレットキーではない） */
  readonly VITE_REVENUECAT_IOS_KEY?: string;
  readonly VITE_REVENUECAT_ANDROID_KEY?: string;
  /** AdMob の広告ユニットID（未設定ならテスト広告） */
  readonly VITE_ADMOB_INTERSTITIAL_IOS?: string;
  readonly VITE_ADMOB_INTERSTITIAL_ANDROID?: string;
  /** Google サインインの OAuth クライアントID */
  readonly VITE_GOOGLE_WEB_CLIENT_ID?: string;
  readonly VITE_GOOGLE_IOS_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

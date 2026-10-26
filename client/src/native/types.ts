/**
 * アプリ（iOS / Android）固有の機能の窓口。
 * Web 版では web.ts（何もしない実装）、アプリ版では mobile/src/native.ts が使われる（vite.config.ts の @native-bridge）。
 */
import type { ProductId } from '@kinggnu/shared';

export type Platform = 'web' | 'ios' | 'android';

export interface NativeBridge {
  platform: Platform;
  /** 起動時に1回。課金・広告 SDK の初期化 */
  init(): Promise<void>;
  /** Apple / Google でサインインして ID トークンを返す（サーバーで検証する） */
  signIn(provider: 'apple' | 'google'): Promise<string>;
  /** 課金 SDK にアカウントIDを伝える（購入履歴をサーバー側で照合するため） */
  setUser(accountId: string): Promise<void>;
  /** ストアの購入画面を出す。完了したら resolve、キャンセルは 'cancelled' で reject */
  purchase(product: ProductId): Promise<void>;
  /** 購入の復元（機種変更時など） */
  restore(): Promise<void>;
  /** ストアの表示価格（取得できたものだけ） */
  prices(): Promise<Partial<Record<ProductId, string>>>;
  /** 全画面広告（試合の合間） */
  showInterstitial(): Promise<void>;
}

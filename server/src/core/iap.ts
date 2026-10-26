/**
 * 課金の確認（RevenueCat 経由）。
 * App Store / Google Play のレシート検証は RevenueCat が行い、サーバーは RevenueCat の REST API で
 * 「このアカウント（app_user_id）が買ったもの」を取得して、未付与のトランザクションだけを付与する。
 * シークレットキーはサーバーの環境変数（REVENUECAT_SECRET_KEY）にだけ置き、リポジトリやアプリには入れない。
 */
import { FetchJson } from './auth';

export interface StoreTransaction {
  product: string;
  id: string;
  sandbox: boolean;
  at: number;
}

export interface PurchaseVerifier {
  transactions(appUserId: string): Promise<StoreTransaction[]>;
}

interface RcNonSub {
  id?: string;
  store_transaction_id?: string;
  purchase_date?: string;
  is_sandbox?: boolean;
}

export class RevenueCatVerifier implements PurchaseVerifier {
  constructor(
    private secretKey: string,
    private fetchJson: FetchJson,
    private base = 'https://api.revenuecat.com/v1',
  ) {}

  async transactions(appUserId: string): Promise<StoreTransaction[]> {
    const res = await this.fetchJson(`${this.base}/subscribers/${encodeURIComponent(appUserId)}`, {
      headers: { Authorization: `Bearer ${this.secretKey}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) throw new Error(`revenuecat ${res.status}`);
    const body = (await res.json()) as { subscriber?: { non_subscriptions?: Record<string, RcNonSub[]> } };
    const out: StoreTransaction[] = [];
    for (const [product, list] of Object.entries(body.subscriber?.non_subscriptions ?? {})) {
      for (const t of list ?? []) {
        const id = t.store_transaction_id || t.id;
        if (!id) continue;
        out.push({ product, id: String(id), sandbox: !!t.is_sandbox, at: t.purchase_date ? Date.parse(t.purchase_date) || 0 : 0 });
      }
    }
    return out;
  }
}

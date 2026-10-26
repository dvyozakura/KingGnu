/**
 * アカウントとゲーム内経済（エメラルド・材質解放・スキン・角の保存枠・課金アイテム・レート）。
 * すべての増減はここを通す。クライアントからの申告（所持数・価格など）は一切使わない。
 */
import { randomBytes } from 'node:crypto';
import {
  DAILY_BONUS,
  DEFAULT_SKIN,
  FREE_MATERIALS,
  HORN_SLOTS_FREE,
  HORN_SLOTS_PREMIUM,
  HornData,
  MATERIAL_UNLOCK_COST,
  MaterialId,
  PRODUCTS,
  Profile,
  ProductId,
  RATING,
  SKINS,
  isProductId,
  jstDay,
  makeToken,
  processOutline,
  sanitizeName,
  skinDef,
} from '@kinggnu/shared';
import { APPLE_ID_CONFIG, AuthError, GOOGLE_ID_CONFIG, IdTokenVerifier } from './auth';
import { PurchaseVerifier } from './iap';
import { AccountRecord, AccountStore, hashToken } from './store';

export class AcctError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export interface AccountOptions {
  appleAudiences: string[];
  googleAudiences: string[];
  allowTestPurchases: boolean;
  maxSessions: number;
}

const DEFAULTS: AccountOptions = { appleAudiences: [], googleAudiences: [], allowTestPurchases: false, maxSessions: 5 };

export class AccountService {
  opts: AccountOptions;

  constructor(
    public store: AccountStore,
    private verifier: IdTokenVerifier | null = null,
    private purchases: PurchaseVerifier | null = null,
    opts: Partial<AccountOptions> = {},
  ) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  /* ---------------- 認証 ---------------- */

  private newRecord(now: number): AccountRecord {
    let id = 'u' + randomBytes(9).toString('base64url');
    while (this.store.get(id)) id = 'u' + randomBytes(9).toString('base64url');
    return {
      id,
      name: 'Player',
      created: now,
      lastSeen: now,
      providers: {},
      sessions: [],
      emeralds: 0,
      materials: [],
      skins: [DEFAULT_SKIN],
      skin: DEFAULT_SKIN,
      slotsPremium: false,
      noAds: false,
      horns: new Array(HORN_SLOTS_FREE).fill(null),
      rating: RATING.initial,
      ranked: { games: 0, wins: 0, losses: 0, draws: 0 },
      lastBonusDay: '',
      txns: [],
      purchases: [],
      ledger: [],
    };
  }

  private issueSession(rec: AccountRecord, now: number): string {
    const token = makeToken();
    rec.sessions.push({ hash: hashToken(token), created: now, lastUsed: now });
    // 古いセッションから失効
    rec.sessions.sort((a, b) => b.lastUsed - a.lastUsed);
    rec.sessions = rec.sessions.slice(0, this.opts.maxSessions);
    return token;
  }

  /** ゲスト（端末だけに紐づくアカウント）を作る */
  createGuest(now = Date.now()): { rec: AccountRecord; session: string } {
    const rec = this.newRecord(now);
    rec.providers.guest = true;
    const session = this.issueSession(rec, now);
    this.store.save(rec);
    return { rec, session };
  }

  bySession(token: string, now = Date.now()): AccountRecord {
    const rec = this.store.findBySession(token);
    if (!rec) throw new AcctError('session_invalid');
    const h = hashToken(token);
    const s = rec.sessions.find((x) => x.hash === h);
    if (s) s.lastUsed = now;
    rec.lastSeen = now;
    this.store.save(rec);
    return rec;
  }

  /**
   * Apple / Google でサインイン。
   *  - 既にそのアカウントがあればそれにログイン（機種変更・再インストール）
   *  - 無ければ、link（今使っているゲストのセッション）があればそのデータに紐づける。無ければ新規作成
   */
  async signIn(provider: 'apple' | 'google', idToken: string, link: string | undefined, now = Date.now()): Promise<{ rec: AccountRecord; session: string; created: boolean }> {
    if (!this.verifier) throw new AcctError('provider_unavailable');
    let sub: string;
    try {
      const cfg = provider === 'apple' ? APPLE_ID_CONFIG(this.opts.appleAudiences) : GOOGLE_ID_CONFIG(this.opts.googleAudiences);
      sub = (await this.verifier.verify(idToken, cfg, now)).sub;
    } catch (e) {
      throw new AcctError(e instanceof AuthError && e.message === 'provider not configured' ? 'provider_unavailable' : 'signin_failed');
    }
    let rec = this.store.findByProvider(provider, sub);
    let created = false;
    if (!rec && link) {
      const cur = this.store.findBySession(link);
      if (cur && !cur.providers[provider]) rec = cur;
    }
    if (!rec) {
      rec = this.newRecord(now);
      created = true;
    }
    rec.providers[provider] = sub;
    rec.lastSeen = now;
    const session = this.issueSession(rec, now);
    this.store.save(rec);
    return { rec, session, created };
  }

  /** ログインボーナス。今日まだなら付与して付与数を返す */
  dailyBonus(rec: AccountRecord, now = Date.now()): number {
    const day = jstDay(now);
    if (rec.lastBonusDay === day) return 0;
    rec.lastBonusDay = day;
    this.addEmeralds(rec, DAILY_BONUS, 'daily', now);
    this.store.save(rec);
    return DAILY_BONUS;
  }

  /* ---------------- 経済 ---------------- */

  private addEmeralds(rec: AccountRecord, delta: number, reason: string, now: number) {
    if (rec.emeralds + delta < 0) throw new AcctError('not_enough_emeralds');
    rec.emeralds += delta;
    rec.ledger.push({ at: now, delta, reason });
    if (rec.ledger.length > 200) rec.ledger.splice(0, rec.ledger.length - 200);
  }

  buyMaterial(rec: AccountRecord, m: MaterialId, now = Date.now()) {
    if (FREE_MATERIALS.includes(m) || rec.materials.includes(m)) throw new AcctError('already_owned');
    this.addEmeralds(rec, -MATERIAL_UNLOCK_COST, `material:${m}`, now);
    rec.materials.push(m);
    this.store.save(rec);
  }

  buySkin(rec: AccountRecord, skin: string, now = Date.now()) {
    const def = SKINS.find((s) => s.id === skin);
    if (!def) throw new AcctError('unknown_skin');
    if (rec.skins.includes(skin)) throw new AcctError('already_owned');
    this.addEmeralds(rec, -def.price, `skin:${skin}`, now);
    rec.skins.push(skin);
    rec.skin = skin;
    this.store.save(rec);
  }

  equipSkin(rec: AccountRecord, skin: string) {
    if (!rec.skins.includes(skin)) throw new AcctError('not_owned');
    rec.skin = skin;
    this.store.save(rec);
  }

  ownsSkin(rec: AccountRecord | null, skin: string | undefined): boolean {
    if (!skin || skin === DEFAULT_SKIN) return true;
    return !!rec?.skins.includes(skin);
  }

  slots(rec: AccountRecord) {
    return rec.slotsPremium ? HORN_SLOTS_PREMIUM : HORN_SLOTS_FREE;
  }

  private normalizeSlots(rec: AccountRecord) {
    const n = this.slots(rec);
    while (rec.horns.length < n) rec.horns.push(null);
  }

  saveHorn(rec: AccountRecord, slot: number, horn: HornData, now = Date.now()) {
    this.normalizeSlots(rec);
    if (slot < 0 || slot >= this.slots(rec)) throw new AcctError('slot_locked');
    // 保存前にサーバー側で輪郭をクリーンアップ・検証（壊れた角を保存しない）
    const out = processOutline([horn.vertices]);
    if (!out.ok) throw new AcctError('invalid_horn');
    rec.horns[slot] = { name: horn.name, material: horn.material, vertices: out.polygon.map(([x, y]) => [x, y] as [number, number]), savedAt: now };
    this.store.save(rec);
  }

  deleteHorn(rec: AccountRecord, slot: number) {
    this.normalizeSlots(rec);
    if (slot < 0 || slot >= rec.horns.length) throw new AcctError('slot_locked');
    rec.horns[slot] = null;
    this.store.save(rec);
  }

  setName(rec: AccountRecord, name: string) {
    rec.name = sanitizeName(name, 'Player', 16);
    this.store.save(rec);
  }

  /* ---------------- 課金 ---------------- */

  /** 課金アイテムを付与（同じトランザクションは1回だけ）。付与したら true */
  grantProduct(rec: AccountRecord, product: ProductId, tx: string, source: 'revenuecat' | 'test', sandbox: boolean, now = Date.now()): boolean {
    if (rec.txns.includes(tx)) return false;
    const def = PRODUCTS[product];
    rec.txns.push(tx);
    rec.purchases.push({ product, tx, at: now, source, sandbox });
    if (def.emeralds) this.addEmeralds(rec, def.emeralds, `purchase:${product}`, now);
    if (product === 'kinghorn.slots8') {
      rec.slotsPremium = true;
      this.normalizeSlots(rec);
    }
    if (product === 'kinghorn.noads') rec.noAds = true;
    this.store.save(rec);
    return true;
  }

  /** ストアの購入履歴を取り込み、未付与のものを付与する */
  async syncPurchases(rec: AccountRecord, now = Date.now()): Promise<string[]> {
    if (!this.purchases) throw new AcctError('purchases_unavailable');
    let list;
    try {
      list = await this.purchases.transactions(rec.id);
    } catch {
      throw new AcctError('purchases_unreachable');
    }
    const granted: string[] = [];
    for (const t of list) {
      if (!isProductId(t.product)) continue;
      if (this.grantProduct(rec, t.product, `rc:${t.id}`, 'revenuecat', t.sandbox, now)) granted.push(t.product);
    }
    return granted;
  }

  /** 開発用：ストアを通さずに購入したことにする（サーバー設定で許可したときだけ） */
  testPurchase(rec: AccountRecord, product: ProductId, now = Date.now()): string[] {
    if (!this.opts.allowTestPurchases) throw new AcctError('test_purchase_disabled');
    this.grantProduct(rec, product, `test:${now}:${Math.random().toString(36).slice(2)}`, 'test', true, now);
    return [product];
  }

  /* ---------------- レート ---------------- */

  applyRating(rec: AccountRecord, delta: number, score: 0 | 0.5 | 1) {
    rec.rating = Math.max(RATING.min, rec.rating + delta);
    rec.ranked.games++;
    if (score === 1) rec.ranked.wins++;
    else if (score === 0) rec.ranked.losses++;
    else rec.ranked.draws++;
    this.store.save(rec);
  }

  /* ---------------- 表示用 ---------------- */

  profile(rec: AccountRecord): Profile {
    this.normalizeSlots(rec);
    return {
      id: rec.id,
      name: rec.name,
      emeralds: rec.emeralds,
      materials: [...rec.materials],
      skins: [...rec.skins],
      skin: skinDef(rec.skin).id,
      slots: this.slots(rec),
      horns: rec.horns.slice(0, this.slots(rec)),
      noAds: rec.noAds,
      rating: rec.rating,
      ranked: { ...rec.ranked },
      providers: (['guest', 'apple', 'google'] as const).filter((p) => !!rec.providers[p]),
    };
  }
}

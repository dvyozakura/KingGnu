/**
 * アカウント（ゲスト / Apple / Google）とプロフィールの管理。
 * 対戦とは別の WebSocket 接続でサーバーとやり取りする。エメラルドなどの値はサーバーが正で、
 * ここで持っているのは表示用のコピー（オフライン時は最後に取得したものを表示）。
 */
import { useSyncExternalStore } from 'react';
import { AcctOp, AuthMethod, Profile, ServerMsg, validateHornData } from '@kinggnu/shared';
import native from '@native-bridge';
import { NetClient, defaultServerUrl } from '../net/client';

const SESSION_KEY = 'kinghorn.session';
const PROFILE_KEY = 'kinghorn.profile';

export type AcctResult = Extract<ServerMsg, { t: 'acct' }>;

export interface AccountState {
  status: 'offline' | 'connecting' | 'online';
  profile: Profile | null;
  /** 直近のログインボーナス（表示したら clearBonus） */
  bonus: number;
  error: string;
}

export const ACCOUNT_ERRORS: Record<string, string> = {
  not_enough_emeralds: 'エメラルドが足りません',
  already_owned: 'すでに持っています',
  not_owned: 'まだ持っていません',
  slot_locked: 'この保存枠は使えません（8枠に拡張すると使えます）',
  invalid_horn: '角の形が正しくありません',
  session_invalid: 'ログインし直してください',
  signin_failed: 'サインインできませんでした',
  provider_unavailable: 'このサインイン方法はサーバーで準備中です',
  purchases_unavailable: '購入の確認がサーバーで準備中です',
  purchases_unreachable: '購入の確認に失敗しました。しばらくしてから「購入を復元」してください',
  test_purchase_disabled: 'テスト購入はサーバーで無効になっています',
  no_auth: 'サーバーに接続されていません',
  accounts_unavailable: 'このサーバーはアカウントに対応していません',
  offline: 'サーバーに接続できません。通信環境を確認してください',
  timeout: 'サーバーから応答がありません',
  rate_limited: '操作が速すぎます',
  promo_ended: '無料配布は終了しました',
};

export function accountErrorText(code: string | undefined): string {
  return (code && ACCOUNT_ERRORS[code]) || code || 'エラーが発生しました';
}

function load<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}

function store(key: string, v: unknown) {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, typeof v === 'string' ? v : JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

class AccountSession {
  state: AccountState = { status: 'offline', profile: load<Profile>(PROFILE_KEY), bonus: 0, error: '' };
  private listeners = new Set<() => void>();
  private client: NetClient | null = null;
  private rid = 1;
  private pending = new Map<number, (m: AcctResult) => void>();
  private retry = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private started = false;

  get session(): string | null {
    try {
      return localStorage.getItem(SESSION_KEY);
    } catch {
      return null;
    }
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = () => this.state;

  private set(patch: Partial<AccountState>) {
    this.state = { ...this.state, ...patch };
    if (patch.profile) store(PROFILE_KEY, patch.profile);
    for (const l of this.listeners) l();
  }

  clearBonus() {
    this.set({ bonus: 0 });
  }

  /** アプリ起動時に呼ぶ */
  start() {
    if (this.started) return;
    this.started = true;
    void native.init().catch(() => undefined);
    void this.connect();
  }

  /** 接続先サーバーを変えたときなど */
  reconnect() {
    this.client?.close();
    this.client = null;
    this.retry = 0;
    void this.connect();
  }

  private scheduleRetry() {
    if (this.retryTimer) return;
    const delay = Math.min(30_000, 2000 * 2 ** Math.min(4, this.retry++));
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, delay);
  }

  private async connect() {
    if (this.client && this.client.status === 'open') return;
    this.set({ status: 'connecting' });
    const cl = new NetClient(defaultServerUrl());
    this.client = cl;
    cl.on((m) => {
      if (m.t === 'acct') {
        const res = this.pending.get(m.rid);
        if (res) {
          this.pending.delete(m.rid);
          res(m);
        }
      }
    });
    cl.onStatus((s) => {
      if (s === 'closed' && this.client === cl) {
        this.client = null;
        for (const [, res] of this.pending) res({ t: 'acct', rid: -1, ok: false, error: 'offline' });
        this.pending.clear();
        this.set({ status: 'offline' });
        this.scheduleRetry();
      }
    });
    try {
      await cl.connect();
    } catch {
      if (this.client === cl) {
        this.client = null;
        this.set({ status: 'offline' });
        this.scheduleRetry();
      }
      return;
    }
    // セッションがあればそれで、無ければゲストとして登録
    let r = this.session ? await this.authOn(cl, 'session', this.session) : await this.authOn(cl, 'guest');
    if (!r.ok && r.error === 'session_invalid') {
      store(SESSION_KEY, null);
      r = await this.authOn(cl, 'guest');
    }
    if (!r.ok) {
      this.set({ status: 'offline', error: accountErrorText(r.error) });
      return;
    }
    this.retry = 0;
    this.accept(r);
    this.set({ status: 'online', error: '' });
    void this.migrateLocalHorns();
  }

  /** 以前のバージョンでブラウザに保存していた角を、空いている保存枠に1回だけ移す */
  private async migrateLocalHorns() {
    const OLD_KEY = 'kinggnu.horns.v1';
    const DONE_KEY = 'kinghorn.migrated';
    try {
      if (localStorage.getItem(DONE_KEY)) return;
      const old = JSON.parse(localStorage.getItem(OLD_KEY) ?? '[]') as unknown[];
      const p = this.state.profile;
      if (!Array.isArray(old) || !old.length || !p) {
        localStorage.setItem(DONE_KEY, '1');
        return;
      }
      let slot = 0;
      for (const o of old) {
        const h = validateHornData(o);
        if (!h.ok || !h.value) continue;
        while (slot < p.slots && p.horns[slot]) slot++;
        if (slot >= p.slots) break;
        const r = await this.op({ op: 'saveHorn', slot, horn: h.value });
        if (!r.ok) break;
        slot++;
      }
      localStorage.setItem(DONE_KEY, '1');
    } catch {
      /* 失敗しても次回また試す */
    }
  }

  private accept(r: AcctResult) {
    if (r.session) store(SESSION_KEY, r.session);
    if (r.profile) {
      this.set({ profile: r.profile });
      void native.setUser(r.profile.id).catch(() => undefined);
    }
    if (r.bonus) this.set({ bonus: r.bonus });
  }

  private request(cl: NetClient, msg: Record<string, unknown>): Promise<AcctResult> {
    const rid = this.rid++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(rid);
        resolve({ t: 'acct', rid, ok: false, error: 'timeout' });
      }, 15_000);
      this.pending.set(rid, (m) => {
        clearTimeout(timer);
        resolve(m);
      });
      cl.send({ ...msg, rid } as never);
    });
  }

  private authOn(cl: NetClient, method: AuthMethod, token?: string, link?: string) {
    return this.request(cl, { t: 'auth', method, token, link });
  }

  /** アカウント操作。結果のプロフィールは自動で反映される */
  async op(op: AcctOp): Promise<AcctResult> {
    const cl = this.client;
    if (!cl || this.state.status !== 'online') return { t: 'acct', rid: -1, ok: false, error: 'offline' };
    const r = await this.request(cl, { t: 'acct', ...op });
    if (r.profile) this.set({ profile: r.profile });
    return r;
  }

  /** Apple / Google でサインイン（今のゲストのデータを引き継ぐ） */
  async signIn(provider: 'apple' | 'google'): Promise<AcctResult> {
    const cl = this.client;
    if (!cl || this.state.status !== 'online') return { t: 'acct', rid: -1, ok: false, error: 'offline' };
    let idToken: string;
    try {
      idToken = await native.signIn(provider);
    } catch (e) {
      return { t: 'acct', rid: -1, ok: false, error: (e as Error).message || 'signin_failed' };
    }
    const r = await this.authOn(cl, provider, idToken, this.session ?? undefined);
    if (r.ok) this.accept(r);
    return r;
  }

  /** 対戦用の接続を同じアカウントでログインさせる */
  async authorize(cl: NetClient): Promise<AcctResult> {
    const s = this.session;
    if (!s) return { t: 'acct', rid: -1, ok: false, error: 'no_auth' };
    // 対戦用接続の応答もこのクラスで受け取れるように、その接続の acct も拾う
    const rid = this.rid++;
    return new Promise((resolve) => {
      const off = cl.on((m) => {
        if (m.t === 'acct' && m.rid === rid) {
          off();
          clearTimeout(timer);
          if (m.profile) this.set({ profile: m.profile });
          resolve(m);
        }
      });
      const timer = setTimeout(() => {
        off();
        resolve({ t: 'acct', rid, ok: false, error: 'timeout' });
      }, 10_000);
      cl.send({ t: 'auth', rid, method: 'session', token: s });
    });
  }
}

export const account = new AccountSession();

export function useAccount(): AccountState {
  return useSyncExternalStore(account.subscribe, account.getSnapshot, account.getSnapshot);
}

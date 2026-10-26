/**
 * アカウントの保存先。
 *  - MemoryAccountStore : テスト・保存なし用
 *  - FileAccountStore   : JSON ファイルに保存（書き込みは一時ファイル→リネームで原子的に、毎日バックアップ）
 *
 * 規模は個人サーバー想定（数千〜数万アカウント）。それ以上になったらデータベースに置き換える。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { MaterialId, SavedHornSlot } from '@kinggnu/shared';

export interface SessionRecord {
  hash: string;
  created: number;
  lastUsed: number;
}

export interface PurchaseRecord {
  product: string;
  tx: string;
  at: number;
  source: 'revenuecat' | 'test';
  sandbox?: boolean;
}

export interface AccountRecord {
  id: string;
  name: string;
  created: number;
  lastSeen: number;
  providers: { guest?: boolean; apple?: string; google?: string };
  sessions: SessionRecord[];
  emeralds: number;
  materials: MaterialId[];
  skins: string[];
  skin: string;
  slotsPremium: boolean;
  noAds: boolean;
  horns: (SavedHornSlot | null)[];
  rating: number;
  ranked: { games: number; wins: number; losses: number; draws: number };
  lastBonusDay: string;
  /** 付与済みの課金トランザクションID（二重付与防止） */
  txns: string[];
  purchases: PurchaseRecord[];
  /** エメラルドの増減履歴（直近のみ。問い合わせ対応用） */
  ledger: { at: number; delta: number; reason: string }[];
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface AccountStore {
  get(id: string): AccountRecord | undefined;
  findByProvider(provider: 'apple' | 'google', sub: string): AccountRecord | undefined;
  findBySession(token: string): AccountRecord | undefined;
  /** 新規作成・更新（呼んだら保存予約される） */
  save(rec: AccountRecord): void;
  size(): number;
  flush(): void;
}

export class MemoryAccountStore implements AccountStore {
  protected byId = new Map<string, AccountRecord>();
  protected byProvider = new Map<string, string>();
  protected bySession = new Map<string, string>();

  get(id: string) {
    return this.byId.get(id);
  }
  findByProvider(provider: 'apple' | 'google', sub: string) {
    const id = this.byProvider.get(`${provider}:${sub}`);
    return id ? this.byId.get(id) : undefined;
  }
  findBySession(token: string) {
    const id = this.bySession.get(hashToken(token));
    return id ? this.byId.get(id) : undefined;
  }
  save(rec: AccountRecord) {
    this.index(rec);
    this.dirty();
  }
  size() {
    return this.byId.size;
  }
  flush() {
    /* メモリのみ */
  }
  protected dirty() {
    /* サブクラスで保存 */
  }
  protected index(rec: AccountRecord) {
    // 古いインデックスを消してから付け直す（セッションの失効・連携の付け替えに対応）
    for (const [k, v] of this.bySession) if (v === rec.id) this.bySession.delete(k);
    for (const [k, v] of this.byProvider) if (v === rec.id) this.byProvider.delete(k);
    this.byId.set(rec.id, rec);
    for (const s of rec.sessions) this.bySession.set(s.hash, rec.id);
    if (rec.providers.apple) this.byProvider.set(`apple:${rec.providers.apple}`, rec.id);
    if (rec.providers.google) this.byProvider.set(`google:${rec.providers.google}`, rec.id);
  }
}

export class FileAccountStore extends MemoryAccountStore {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private file: string;
  private backupDir: string;

  constructor(
    dir: string,
    private log: (...a: unknown[]) => void = console.log,
    private keepBackups = 30,
  ) {
    super();
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, 'accounts.json');
    this.backupDir = join(dir, 'backup');
    mkdirSync(this.backupDir, { recursive: true });
    this.load();
  }

  private load() {
    const src = existsSync(this.file) ? this.file : existsSync(this.file + '.tmp') ? this.file + '.tmp' : null;
    if (!src) return;
    const data = JSON.parse(readFileSync(src, 'utf8')) as { accounts: AccountRecord[] };
    for (const rec of data.accounts ?? []) this.index(rec);
    this.log(`accounts loaded: ${this.byId.size}`);
  }

  protected dirty() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, 1000);
  }

  flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const json = JSON.stringify({ version: 1, savedAt: Date.now(), accounts: [...this.byId.values()] });
    const tmp = this.file + '.tmp';
    writeFileSync(tmp, json);
    renameSync(tmp, this.file);
    this.backup();
  }

  /** 1日1つバックアップを残し、古いものは消す */
  private backup() {
    const day = new Date().toISOString().slice(0, 10);
    const dest = join(this.backupDir, `accounts-${day}.json`);
    if (!existsSync(dest)) {
      copyFileSync(this.file, dest);
      const files = readdirSync(this.backupDir)
        .filter((f) => /^accounts-\d{4}-\d{2}-\d{2}\.json$/.test(f))
        .sort();
      for (const f of files.slice(0, Math.max(0, files.length - this.keepBackups))) unlinkSync(join(this.backupDir, f));
    }
  }
}

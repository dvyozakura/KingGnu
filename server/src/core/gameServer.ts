/**
 * 対戦サーバー本体（トランスポート非依存）。Node(ws) と Cloudflare Durable Object の両方から使う。
 *
 * サーバー権威型：
 *  - クライアントは操作入力（チャージ押下中か・移動方向）だけを送る
 *  - 物理演算・衝突判定・HP・勝敗はすべてサーバーの Match が決める
 *  - 角のHPや硬度はクライアントから受け取らず、材質と輪郭からサーバーで計算する
 *  - 入力は接続に紐づいたスロットにしか適用されないので、他プレイヤーの入力は偽装できない
 */
import {
  AcctOp,
  BOT_NAMES,
  ClientMsg,
  CpuBrain,
  DEFAULT_SKIN,
  Difficulty,
  HORN_TEMPLATES,
  HornData,
  MATERIAL_IDS,
  RATING,
  SKIN_IDS,
  eloDelta,
  ownsMaterial,
  templateStrokes,
  INPUT_RATE_LIMIT,
  MATCH,
  Match,
  MatchEvent,
  MaterialId,
  isOnlineAllowed,
  Poly,
  PublicPlayer,
  SNAPSHOT_HZ,
  ServerMsg,
  buildHornModel,
  computeMaxHP,
  makeRoomCode,
  makeToken,
  MATERIALS,
  parseClientMsg,
  processOutline,
} from '@kinggnu/shared';
import { TokenBucket } from './rateLimit';
import { AccountService, AcctError } from './accounts';
import { AccountRecord } from './store';

export interface Conn {
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface ServerOptions {
  maxClients: number;
  maxRooms: number;
  /** 切断から不戦敗までの猶予（ms） */
  reconnectGrace: number;
  lobbyIdleMs: number;
  endedIdleMs: number;
  clientIdleMs: number;
  quickAutoStartMs: number;
  /** レート戦で人間の相手が見つからないとき CPU と当てるまでの時間（ms, 範囲内でランダム） */
  rankedBotAfterMs: [number, number];
  log: (...a: unknown[]) => void;
}

export const DEFAULT_OPTIONS: ServerOptions = {
  maxClients: 400,
  maxRooms: 200,
  reconnectGrace: 20_000,
  lobbyIdleMs: 10 * 60_000,
  endedIdleMs: 5 * 60_000,
  clientIdleMs: 45_000,
  quickAutoStartMs: 3_000,
  rankedBotAfterMs: [...RATING.botAfterMs] as [number, number],
  log: () => undefined,
};

interface HornInfo {
  name: string;
  polygon: Poly;
  material: MaterialId;
  maxHp: number;
}

interface Client {
  id: string;
  token: string;
  conn: Conn | null;
  name: string;
  horn: HornInfo | null;
  room: Room | null;
  slot: 0 | 1;
  queued: boolean;
  lastSeen: number;
  disconnectedAt: number | null;
  msgBucket: TokenBucket;
  inputBucket: TokenBucket;
  violations: number;
  failedJoins: number[];
  lastSeq: number;
  account: AccountRecord | null;
  skin: string;
  guestCreated: boolean;
  rankedSince: number;
  botAt: number;
  /** レート戦の CPU（サーバー内で動く。人間と同じように見せる） */
  bot: { brain: CpuBrain; rating: number } | null;
}

interface Room {
  code: string;
  quick: boolean;
  players: [Client | null, Client | null];
  ready: [boolean, boolean];
  state: 'lobby' | 'playing' | 'ended';
  match: Match | null;
  rematch: [boolean, boolean];
  lastActive: number;
  createdAt: number;
  autoStartAt: number | null;
  snapAcc: number;
  events: MatchEvent[];
  sentRev: [number, number];
  endSent: boolean;
  ranked: boolean;
}

let idSeq = 0;

export class GameServer {
  opts: ServerOptions;
  clients = new Map<string, Client>();
  tokens = new Map<string, Client>();
  rooms = new Map<string, Room>();
  queue: Client[] = [];
  rankedQueue: Client[] = [];

  constructor(
    opts: Partial<ServerOptions> = {},
    public accounts: AccountService | null = null,
  ) {
    this.opts = { ...DEFAULT_OPTIONS, ...opts };
  }

  get stats() {
    let playing = 0;
    for (const r of this.rooms.values()) if (r.state === 'playing') playing++;
    return { clients: this.clients.size, rooms: this.rooms.size, playing, queue: this.queue.length, ranked: this.rankedQueue.length, accounts: this.accounts?.store.size() ?? 0 };
  }

  /* ---------------- 接続 ---------------- */

  connect(conn: Conn, now = Date.now()): Client | null {
    if (this.clients.size >= this.opts.maxClients) {
      this.raw(conn, { t: 'err', code: 'server_full', msg: 'server full' });
      conn.close(1013, 'server full');
      return null;
    }
    const c: Client = {
      id: `c${(++idSeq).toString(36)}`,
      token: makeToken(),
      conn,
      name: 'Guest',
      horn: null,
      room: null,
      slot: 0,
      queued: false,
      lastSeen: now,
      disconnectedAt: null,
      msgBucket: new TokenBucket(60, 90, now),
      inputBucket: new TokenBucket(INPUT_RATE_LIMIT, INPUT_RATE_LIMIT, now),
      violations: 0,
      failedJoins: [],
      lastSeq: -1,
      account: null,
      skin: DEFAULT_SKIN,
      guestCreated: false,
      rankedSince: 0,
      botAt: 0,
      bot: null,
    };
    this.clients.set(c.id, c);
    this.tokens.set(c.token, c);
    return c;
  }

  message(c: Client, raw: unknown, now = Date.now()) {
    if (!c.conn) return;
    c.lastSeen = now;
    if (!c.msgBucket.take(now)) return this.violation(c, 'rate_limited');
    const { msg, error } = parseClientMsg(raw);
    if (!msg) {
      if (error === 'too_large') return this.violation(c, 'too_large', true);
      if (error?.startsWith('horn:')) return this.err(c, 'invalid_horn', error.slice(5));
      if (error === 'version') return this.err(c, 'version', 'protocol version mismatch');
      return this.violation(c, error ?? 'bad_message');
    }
    this.handle(c, msg, now);
  }

  disconnect(c: Client, now = Date.now()) {
    if (!c.conn) return;
    c.conn = null;
    this.dequeue(c);
    const r = c.room;
    if (r && r.state === 'playing') {
      // 試合中は再接続を待つ（その間 試合は一時停止。クライアント側で勝手に進むことはない）
      c.disconnectedAt = now;
      this.sendTo(r.players[1 - c.slot], { t: 'opp', status: 'disconnected' });
      return;
    }
    this.removeClient(c);
  }

  private removeClient(c: Client) {
    this.leaveRoom(c, false);
    this.dequeue(c);
    this.clients.delete(c.id);
    this.tokens.delete(c.token);
    c.conn = null;
  }

  private violation(c: Client, code: string, fatal = false) {
    c.violations++;
    this.err(c, code === 'rate_limited' ? 'rate_limited' : 'bad_message', code);
    if (fatal || c.violations > 50) {
      c.conn?.close(1008, 'policy violation');
      this.disconnect(c);
      this.removeClient(c);
    }
  }

  /* ---------------- メッセージ処理 ---------------- */

  private handle(c: Client, m: ClientMsg, now: number) {
    switch (m.t) {
      case 'ping':
        this.sendTo(c, { t: 'pong', ts: m.ts, server: now });
        return;
      case 'hello':
        return this.hello(c, m.name, m.horn, m.skin);
      case 'resume':
        return this.resume(c, m.token, now);
      case 'auth':
        return void this.auth(c, m.rid, m.method, m.token, m.link, now);
      case 'acct':
        return void this.acct(c, m.rid, m, now);
    }
    if (!c.horn) return this.err(c, 'no_hello', 'hello first');
    switch (m.t) {
      case 'quick':
        if (c.room) return this.err(c, 'already_in_room', 'leave first');
        if (!c.queued) {
          c.queued = true;
          this.queue.push(c);
          this.sendTo(c, { t: 'queued' });
          this.matchmake(now);
        }
        return;
      case 'ranked':
        if (c.room) return this.err(c, 'already_in_room', 'leave first');
        if (this.accounts && !c.account) return this.err(c, 'no_auth', 'sign in first');
        if (!c.queued) {
          c.queued = true;
          c.rankedSince = now;
          const [lo, hi] = this.opts.rankedBotAfterMs;
          c.botAt = now + lo + Math.random() * Math.max(0, hi - lo);
          this.rankedQueue.push(c);
          this.sendTo(c, { t: 'queued' });
          this.matchmakeRanked(now);
        }
        return;
      case 'cancel':
        this.dequeue(c);
        this.sendTo(c, { t: 'left' });
        return;
      case 'create': {
        if (c.room) return this.err(c, 'already_in_room', 'leave first');
        if (this.rooms.size >= this.opts.maxRooms) return this.err(c, 'server_full', 'too many rooms');
        this.dequeue(c);
        const room = this.newRoom(false, now);
        this.seat(room, c, 0);
        this.broadcastRoom(room);
        return;
      }
      case 'join': {
        if (c.room) return this.err(c, 'already_in_room', 'leave first');
        c.failedJoins = c.failedJoins.filter((t) => now - t < 60_000);
        if (c.failedJoins.length >= 8) return this.err(c, 'too_many_attempts', 'too many failed joins');
        const room = this.rooms.get(m.code);
        if (!room || room.quick) {
          c.failedJoins.push(now);
          return this.err(c, 'room_not_found', 'room not found');
        }
        const slot = room.players[0] ? (room.players[1] ? -1 : 1) : 0;
        if (slot < 0 || room.state !== 'lobby') return this.err(c, 'room_full', 'room full');
        this.dequeue(c);
        this.seat(room, c, slot as 0 | 1);
        this.broadcastRoom(room);
        return;
      }
      case 'ready': {
        const r = c.room;
        if (!r || r.state !== 'lobby') return this.err(c, 'not_in_room', 'not in lobby');
        r.ready[c.slot] = m.ready;
        r.lastActive = now;
        this.broadcastRoom(r);
        if (r.ready[0] && r.ready[1] && r.players[0] && r.players[1]) this.startMatch(r, now);
        return;
      }
      case 'in': {
        const r = c.room;
        if (!r || r.state !== 'playing' || !r.match) return;
        if (!c.inputBucket.take(now)) return; // 送りすぎは捨てる
        if (m.seq <= c.lastSeq && c.lastSeq - m.seq < 1e6) return; // 古い入力
        c.lastSeq = m.seq;
        // 自分のスロットにだけ適用される（他人の入力は偽装できない）
        r.match.setInput(c.slot, { charge: m.c, move: m.m });
        r.lastActive = now;
        return;
      }
      case 'rematch': {
        const r = c.room;
        if (!r || r.state !== 'ended' || r.ranked) return;
        r.rematch[c.slot] = true;
        r.lastActive = now;
        this.broadcast(r, { t: 'rematch', votes: [...r.rematch] as [boolean, boolean] });
        if (r.rematch[0] && r.rematch[1] && r.players[0]?.conn && r.players[1]?.conn) this.startMatch(r, now);
        return;
      }
      case 'leave':
        this.dequeue(c);
        this.leaveRoom(c, true);
        this.sendTo(c, { t: 'left' });
        return;
    }
  }

  private hello(c: Client, name: string, horn: HornData, skin?: string) {
    if (!isOnlineAllowed(horn.material)) return this.err(c, 'banned_material', `material ${horn.material} is not allowed online`);
    if (this.accounts) {
      // 課金・エメラルドで解放するものはサーバーが持ち主か確認する
      if (!c.account) return this.err(c, 'no_auth', 'sign in first');
      if (!ownsMaterial(c.account, horn.material)) return this.err(c, 'locked_material', `material ${horn.material} is locked`);
      c.skin = skin && this.accounts.ownsSkin(c.account, skin) ? skin : DEFAULT_SKIN;
    } else {
      c.skin = skin ?? DEFAULT_SKIN;
    }
    // 角はサーバーで改めてクリーンアップし、HP を材質と形状から計算する（クライアント申告値は使わない）
    const out = processOutline([horn.vertices]);
    if (!out.ok) return this.err(c, 'invalid_horn', out.error ?? 'invalid');
    let maxHp: number;
    try {
      const model = buildHornModel(out.polygon);
      maxHp = computeMaxHP(MATERIALS[horn.material], model.stats);
    } catch {
      return this.err(c, 'invalid_horn', 'model');
    }
    c.name = name;
    c.horn = { name: horn.name, polygon: out.polygon, material: horn.material, maxHp };
    this.sendTo(c, { t: 'welcome', id: c.id, token: c.token, horn: { polygon: out.polygon, material: horn.material, maxHp, warnings: out.warnings } });
    if (c.room && c.room.state === 'lobby') {
      c.room.ready[c.slot] = false;
      this.broadcastRoom(c.room);
    }
  }

  private resume(c: Client, token: string, now: number) {
    const old = this.tokens.get(token);
    if (!old || old === c || old.conn) return this.err(c, 'resume_failed', 'cannot resume');
    // 新しい接続を古いクライアントに付け替える
    old.conn = c.conn;
    old.lastSeen = now;
    old.disconnectedAt = null;
    old.msgBucket = c.msgBucket;
    if (c.account && !old.account) old.account = c.account;
    c.conn = null;
    this.clients.delete(c.id);
    this.tokens.delete(c.token);
    if (this.onReattach) this.onReattach(c, old);
    if (old.horn) this.sendTo(old, { t: 'welcome', id: old.id, token: old.token, horn: { ...old.horn, warnings: [] } });
    const r = old.room;
    if (r) {
      this.sendTo(r.players[1 - old.slot], { t: 'opp', status: 'reconnected' });
      this.broadcastRoom(r);
      if (r.state === 'playing' && r.match) {
        this.sendTo(old, { t: 'start', you: old.slot, players: this.publicPlayers(r) as PublicPlayer[], countdown: 0 });
        for (const i of [0, 1] as const) this.sendTo(old, { t: 'horn', f: i, shape: r.match.hornShape(i) });
      }
    }
  }

  /** トランスポート側が接続オブジェクトとクライアントの対応を付け替えるためのフック */
  onReattach: ((from: Client, to: Client) => void) | null = null;

  /* ---------------- ルーム ---------------- */

  private newRoom(quick: boolean, now: number, ranked = false): Room {
    let code = makeRoomCode();
    while (this.rooms.has(code)) code = makeRoomCode();
    const r: Room = {
      code,
      quick,
      players: [null, null],
      ready: [false, false],
      state: 'lobby',
      match: null,
      rematch: [false, false],
      lastActive: now,
      createdAt: now,
      autoStartAt: null,
      snapAcc: 0,
      events: [],
      sentRev: [0, 0],
      endSent: false,
      ranked,
    };
    this.rooms.set(code, r);
    return r;
  }

  private seat(r: Room, c: Client, slot: 0 | 1) {
    r.players[slot] = c;
    r.ready[slot] = false;
    c.room = r;
    c.slot = slot;
  }

  private leaveRoom(c: Client, notify: boolean) {
    const r = c.room;
    if (!r) return;
    const other = r.players[1 - c.slot];
    if (r.state === 'playing' && r.match && !r.match.result) {
      r.match.forfeit(c.slot);
      this.flushEnd(r);
    }
    r.players[c.slot] = null;
    r.ready = [false, false];
    r.rematch = [false, false];
    c.room = null;
    if (other) {
      if (notify || true) this.sendTo(other, { t: 'opp', status: 'left' });
      if (r.state !== 'playing') {
        if (r.quick) {
          // ランダムマッチの部屋は解散
          other.room = null;
          this.rooms.delete(r.code);
          this.sendTo(other, { t: 'left' });
          return;
        }
        r.state = 'lobby';
        r.match = null;
        this.broadcastRoom(r);
      }
    }
    if (!r.players[0] && !r.players[1]) this.rooms.delete(r.code);
  }

  private dequeue(c: Client) {
    if (!c.queued) return;
    c.queued = false;
    this.queue = this.queue.filter((q) => q !== c);
    this.rankedQueue = this.rankedQueue.filter((q) => q !== c);
  }

  private matchmake(now: number) {
    this.queue = this.queue.filter((q) => q.conn && q.queued && !q.room);
    while (this.queue.length >= 2 && this.rooms.size < this.opts.maxRooms) {
      const a = this.queue.shift()!;
      const b = this.queue.shift()!;
      a.queued = b.queued = false;
      const r = this.newRoom(true, now);
      this.seat(r, a, 0);
      this.seat(r, b, 1);
      // マッチング成立：双方の角を見せてから自動で開始
      r.autoStartAt = now + this.opts.quickAutoStartMs;
      this.broadcastRoom(r);
    }
  }

  private publicPlayers(r: Room): (PublicPlayer | null)[] {
    return r.players.map((p, i) =>
      p && p.horn
        ? {
            name: p.name,
            material: p.horn.material,
            polygon: p.horn.polygon,
            maxHp: p.horn.maxHp,
            ready: r.ready[i],
            connected: !!p.conn,
            skin: p.skin,
            rating: r.ranked ? Math.round(p.bot ? p.bot.rating : (p.account?.rating ?? RATING.initial)) : undefined,
          }
        : null,
    );
  }

  private broadcastRoom(r: Room) {
    const players = this.publicPlayers(r);
    for (const i of [0, 1] as const) {
      const p = r.players[i];
      if (p) this.sendTo(p, { t: 'room', code: r.code, you: i, players, state: r.state, quick: r.quick, ranked: r.ranked });
    }
  }

  private startMatch(r: Room, now: number) {
    const [a, b] = r.players;
    if (!a?.horn || !b?.horn) return;
    r.match = new Match(
      { polygon: a.horn.polygon, material: a.horn.material, name: a.name },
      { polygon: b.horn.polygon, material: b.horn.material, name: b.name },
      { countdown: MATCH.countdown },
    );
    r.state = 'playing';
    r.ready = [false, false];
    r.rematch = [false, false];
    r.autoStartAt = null;
    r.events = [];
    r.snapAcc = 0;
    r.sentRev = [0, 0];
    r.endSent = false;
    r.lastActive = now;
    a.lastSeq = b.lastSeq = -1;
    const players = this.publicPlayers(r) as PublicPlayer[];
    this.sendTo(a, { t: 'start', you: 0, players, countdown: MATCH.countdown });
    this.sendTo(b, { t: 'start', you: 1, players, countdown: MATCH.countdown });
  }

  private flushEnd(r: Room) {
    const m = r.match;
    if (!m || !m.result || r.endSent) return;
    r.endSent = true;
    // 最後のスナップショットとイベントも送る
    this.broadcast(r, { t: 's', snap: m.snapshot(), ev: [...r.events, ...m.drainEvents()] });
    r.events = [];
    this.broadcast(r, {
      t: 'end',
      winner: m.result.winner,
      reason: m.result.reason,
      time: m.result.time,
      stats: m.fighters.map((f) => ({ ...f.stats })),
    });
    if (r.ranked) this.applyRanked(r, m.result.winner);
    r.state = 'ended';
    r.lastActive = Date.now();
  }

  /* ---------------- 定期処理 ---------------- */

  /** 60Hz 程度で呼ぶ。dt は秒 */
  tick(dt: number, now = Date.now()) {
    if (this.rankedQueue.length) this.matchmakeRanked(now);
    for (const r of [...this.rooms.values()]) {
      if (r.state === 'lobby') {
        if (r.autoStartAt && now >= r.autoStartAt && r.players[0]?.conn && r.players[1]?.conn) this.startMatch(r, now);
        if (now - r.lastActive > this.opts.lobbyIdleMs) this.closeRoom(r, 'idle');
        continue;
      }
      if (r.state === 'ended') {
        if (now - r.lastActive > this.opts.endedIdleMs) this.closeRoom(r, 'idle');
        continue;
      }
      const m = r.match!;
      // 切断中のプレイヤーがいれば一時停止、猶予を過ぎたら不戦敗
      let paused = false;
      for (const i of [0, 1] as const) {
        const p = r.players[i];
        if (!p || p.conn) continue;
        paused = true;
        if (p.disconnectedAt !== null && now - p.disconnectedAt > this.opts.reconnectGrace) {
          m.forfeit(i);
          this.flushEnd(r);
          this.removeClient(p);
          paused = false;
          break;
        }
      }
      if (r.state !== 'playing') continue;
      m.paused = paused;
      if (!paused) {
        for (const i of [0, 1] as const) {
          const b = r.players[i]?.bot;
          if (b) m.setInput(i, b.brain.update(m, i, dt * m.timeScale));
        }
      }
      m.update(dt);
      r.events.push(...m.drainEvents());
      for (const i of [0, 1] as const) {
        if (m.hornRev[i] !== r.sentRev[i]) {
          r.sentRev[i] = m.hornRev[i];
          this.broadcast(r, { t: 'horn', f: i, shape: m.hornShape(i) });
        }
      }
      r.snapAcc += dt;
      if (r.snapAcc >= 1 / SNAPSHOT_HZ) {
        r.snapAcc = 0;
        this.broadcast(r, { t: 's', snap: m.snapshot(), ev: r.events });
        r.events = [];
      }
      if (m.state === 'over') this.flushEnd(r);
      // 異常に長い試合の保険
      if (now - r.lastActive > 5 * 60_000) this.closeRoom(r, 'idle');
    }
    // 無応答クライアント
    for (const c of [...this.clients.values()]) {
      if (c.conn && now - c.lastSeen > this.opts.clientIdleMs) {
        c.conn.close(1001, 'idle');
        this.disconnect(c, now);
      } else if (!c.conn && c.disconnectedAt !== null && now - c.disconnectedAt > this.opts.reconnectGrace && (!c.room || c.room.state !== 'playing')) {
        this.removeClient(c);
      }
    }
  }

  /* ---------------- アカウント ---------------- */

  private async auth(c: Client, rid: number, method: string, token: string | undefined, link: string | undefined, now: number) {
    const acc = this.accounts;
    if (!acc) return this.sendTo(c, { t: 'acct', rid, ok: false, error: 'accounts_unavailable' });
    try {
      let rec: AccountRecord;
      let session: string | undefined;
      if (method === 'guest') {
        if (c.guestCreated) throw new AcctError('rate_limited');
        c.guestCreated = true;
        ({ rec, session } = acc.createGuest(now));
      } else if (method === 'session') {
        rec = acc.bySession(token!, now);
      } else {
        ({ rec, session } = await acc.signIn(method as 'apple' | 'google', token!, link, now));
      }
      if (!c.conn) return;
      c.account = rec;
      const bonus = acc.dailyBonus(rec, now);
      this.sendTo(c, { t: 'acct', rid, ok: true, profile: acc.profile(rec), session, bonus: bonus || undefined });
    } catch (e) {
      this.sendTo(c, { t: 'acct', rid, ok: false, error: e instanceof AcctError ? e.code : 'internal' });
      if (!(e instanceof AcctError)) this.opts.log('auth error', e);
    }
  }

  private async acct(c: Client, rid: number, op: AcctOp, now: number) {
    const acc = this.accounts;
    if (!acc) return this.sendTo(c, { t: 'acct', rid, ok: false, error: 'accounts_unavailable' });
    const rec = c.account;
    if (!rec) return this.sendTo(c, { t: 'acct', rid, ok: false, error: 'no_auth' });
    try {
      let granted: string[] | undefined;
      switch (op.op) {
        case 'profile':
          break;
        case 'buyMaterial':
          acc.buyMaterial(rec, op.material, now);
          break;
        case 'buySkin':
          acc.buySkin(rec, op.skin, now);
          break;
        case 'equipSkin':
          acc.equipSkin(rec, op.skin);
          break;
        case 'saveHorn':
          acc.saveHorn(rec, op.slot, op.horn, now);
          break;
        case 'deleteHorn':
          acc.deleteHorn(rec, op.slot);
          break;
        case 'setName':
          acc.setName(rec, op.name);
          break;
        case 'syncPurchases':
          granted = await acc.syncPurchases(rec, now);
          break;
        case 'testPurchase':
          granted = acc.testPurchase(rec, op.product, now);
          break;
      }
      this.sendTo(c, { t: 'acct', rid, ok: true, profile: acc.profile(rec), granted });
    } catch (e) {
      this.sendTo(c, { t: 'acct', rid, ok: false, error: e instanceof AcctError ? e.code : 'internal', profile: acc.profile(rec) });
      if (!(e instanceof AcctError)) this.opts.log('acct error', e);
    }
  }

  /* ---------------- レート戦 ---------------- */

  private ratingOf(c: Client): number {
    return c.bot ? c.bot.rating : (c.account?.rating ?? RATING.initial);
  }

  private matchmakeRanked(now: number) {
    this.rankedQueue = this.rankedQueue.filter((q) => q.conn && q.queued && !q.room);
    const q = this.rankedQueue;
    // レートの近い人どうし。待つほど許容差が広がる
    for (let i = 0; i < q.length; i++) {
      const a = q[i];
      const wa = RATING.baseWindow + (RATING.windowPerSec * (now - a.rankedSince)) / 1000;
      let best = -1;
      let bestDiff = Infinity;
      for (let j = i + 1; j < q.length; j++) {
        const b = q[j];
        const wb = RATING.baseWindow + (RATING.windowPerSec * (now - b.rankedSince)) / 1000;
        const d = Math.abs(this.ratingOf(a) - this.ratingOf(b));
        if (d <= Math.max(wa, wb) && d < bestDiff && a.account?.id !== b.account?.id) {
          best = j;
          bestDiff = d;
        }
      }
      if (best >= 0 && this.rooms.size < this.opts.maxRooms) {
        const b = q[best];
        q.splice(best, 1);
        q.splice(i, 1);
        i--;
        a.queued = b.queued = false;
        const r = this.newRoom(true, now, true);
        this.seat(r, a, 0);
        this.seat(r, b, 1);
        r.autoStartAt = now + this.opts.quickAutoStartMs;
        this.broadcastRoom(r);
      }
    }
    // 見つからないまま時間が来たら CPU と当てる
    for (const a of [...this.rankedQueue]) {
      if (now < a.botAt || this.rooms.size >= this.opts.maxRooms) continue;
      this.rankedQueue = this.rankedQueue.filter((x) => x !== a);
      a.queued = false;
      const bot = this.makeBot(this.ratingOf(a));
      const r = this.newRoom(true, now, true);
      const slot = Math.random() < 0.5 ? 0 : 1;
      this.seat(r, a, slot);
      this.seat(r, bot, (1 - slot) as 0 | 1);
      r.autoStartAt = now + this.opts.quickAutoStartMs;
      this.broadcastRoom(r);
    }
  }

  private makeBot(nearRating: number): Client {
    const rnd = <T>(arr: readonly T[]) => arr[Math.floor(Math.random() * arr.length)];
    const rating = Math.max(RATING.min, Math.round(nearRating + (Math.random() - 0.5) * 120));
    const difficulty: Difficulty = rating < 1350 ? 'easy' : rating < 1650 ? 'normal' : 'hard';
    const tpl = rnd(HORN_TEMPLATES);
    const out = processOutline(templateStrokes(tpl.id));
    const material = rnd(MATERIAL_IDS.filter((m) => isOnlineAllowed(m)));
    const polygon = out.polygon;
    const maxHp = computeMaxHP(MATERIALS[material], buildHornModel(polygon).stats);
    const noop: Conn = { send: () => undefined, close: () => undefined };
    return {
      id: `b${(++idSeq).toString(36)}`,
      token: makeToken(),
      conn: noop,
      name: rnd(BOT_NAMES),
      horn: { name: tpl.name, polygon, material, maxHp },
      room: null,
      slot: 1,
      queued: false,
      lastSeen: Date.now(),
      disconnectedAt: null,
      msgBucket: new TokenBucket(1, 1, Date.now()),
      inputBucket: new TokenBucket(1, 1, Date.now()),
      violations: 0,
      failedJoins: [],
      lastSeq: -1,
      account: null,
      skin: rnd(SKIN_IDS),
      guestCreated: true,
      rankedSince: 0,
      botAt: 0,
      bot: { brain: new CpuBrain(difficulty, (Math.random() * 1e9) | 0), rating },
    };
  }

  private applyRanked(r: Room, winner: 0 | 1 | null) {
    const ratings = r.players.map((p) => (p ? this.ratingOf(p) : RATING.initial));
    for (const i of [0, 1] as const) {
      const p = r.players[i];
      if (!p || p.bot || !p.account || !this.accounts) continue;
      const score: 0 | 0.5 | 1 = winner === null ? 0.5 : winner === i ? 1 : 0;
      const before = p.account.rating;
      const delta = eloDelta(before, ratings[1 - i], score);
      this.accounts.applyRating(p.account, delta, score);
      this.sendTo(p, { t: 'rating', before, after: p.account.rating, delta: p.account.rating - before });
    }
  }

  private closeRoom(r: Room, reason: string) {
    this.opts.log('close room', r.code, reason);
    for (const p of r.players) {
      if (!p) continue;
      p.room = null;
      this.sendTo(p, { t: 'left' });
      if (!p.conn) this.removeClient(p);
    }
    this.rooms.delete(r.code);
  }

  /* ---------------- 送信 ---------------- */

  private raw(conn: Conn, m: ServerMsg) {
    try {
      conn.send(JSON.stringify(m));
    } catch {
      /* 送信失敗は切断扱いに任せる */
    }
  }

  private sendTo(c: Client | null | undefined, m: ServerMsg) {
    if (c?.conn) this.raw(c.conn, m);
  }

  private broadcast(r: Room, m: ServerMsg) {
    const s = JSON.stringify(m);
    for (const p of r.players) {
      if (p?.conn) {
        try {
          p.conn.send(s);
        } catch {
          /* ignore */
        }
      }
    }
  }

  private err(c: Client, code: string, msg: string) {
    this.sendTo(c, { t: 'err', code, msg });
  }
}

export type { Client, Room };

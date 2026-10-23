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
  ClientMsg,
  HornData,
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
}

let idSeq = 0;

export class GameServer {
  opts: ServerOptions;
  clients = new Map<string, Client>();
  tokens = new Map<string, Client>();
  rooms = new Map<string, Room>();
  queue: Client[] = [];

  constructor(opts: Partial<ServerOptions> = {}) {
    this.opts = { ...DEFAULT_OPTIONS, ...opts };
  }

  get stats() {
    let playing = 0;
    for (const r of this.rooms.values()) if (r.state === 'playing') playing++;
    return { clients: this.clients.size, rooms: this.rooms.size, playing, queue: this.queue.length };
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
        return this.hello(c, m.name, m.horn);
      case 'resume':
        return this.resume(c, m.token, now);
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
        if (!r || r.state !== 'ended') return;
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

  private hello(c: Client, name: string, horn: HornData) {
    if (!isOnlineAllowed(horn.material)) return this.err(c, 'banned_material', `material ${horn.material} is not allowed online`);
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

  private newRoom(quick: boolean, now: number): Room {
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
        ? { name: p.name, material: p.horn.material, polygon: p.horn.polygon, maxHp: p.horn.maxHp, ready: r.ready[i], connected: !!p.conn }
        : null,
    );
  }

  private broadcastRoom(r: Room) {
    const players = this.publicPlayers(r);
    for (const i of [0, 1] as const) {
      const p = r.players[i];
      if (p) this.sendTo(p, { t: 'room', code: r.code, you: i, players, state: r.state, quick: r.quick });
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
    r.state = 'ended';
    r.lastActive = Date.now();
  }

  /* ---------------- 定期処理 ---------------- */

  /** 60Hz 程度で呼ぶ。dt は秒 */
  tick(dt: number, now = Date.now()) {
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

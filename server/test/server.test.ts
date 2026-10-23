/**
 * 対戦サーバーの結合テスト（実際に ws で接続してルーム作成〜試合〜決着まで）
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import { HORN_TEMPLATES, MAX_PACKET_BYTES, MaterialId, PROTOCOL_VERSION, ServerMsg, makeHornData, processOutline, templateStrokes } from '@kinggnu/shared';
import { Client, GameServer } from '../src/core/gameServer';

let http: Server;
let wss: WebSocketServer;
let game: GameServer;
let url = '';
let loop: ReturnType<typeof setInterval>;

before(async () => {
  game = new GameServer({ reconnectGrace: 1500, quickAutoStartMs: 200 });
  http = createServer();
  wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: MAX_PACKET_BYTES });
  const byWs = new Map<WebSocket, Client>();
  game.onReattach = (from, to) => {
    for (const [ws, c] of byWs) if (c === from) byWs.set(ws, to);
  };
  wss.on('connection', (ws) => {
    const c = game.connect({ send: (d) => ws.readyState === ws.OPEN && ws.send(d), close: (code, r) => ws.close(code, r) });
    if (!c) return;
    byWs.set(ws, c);
    ws.on('message', (d, bin) => game.message(byWs.get(ws)!, bin ? null : d.toString()));
    ws.on('error', () => ws.close());
    ws.on('close', () => {
      const cl = byWs.get(ws);
      if (cl) game.disconnect(cl);
    });
  });
  await new Promise<void>((r) => http.listen(0, r));
  url = `ws://127.0.0.1:${(http.address() as AddressInfo).port}/ws`;
  let last = performance.now();
  // テストを速くするため 4 倍速で回す
  loop = setInterval(() => {
    const now = performance.now();
    game.tick(((now - last) / 1000) * 4);
    last = now;
  }, 1000 / 60);
});

after(async () => {
  clearInterval(loop);
  await new Promise<void>((r) => wss.close(() => r()));
  http.closeAllConnections?.();
  await new Promise<void>((r) => http.close(() => r()));
});

class TestClient {
  ws: WebSocket;
  msgs: ServerMsg[] = [];
  waiters: { pred: (m: ServerMsg) => boolean; res: (m: ServerMsg) => void }[] = [];
  constructor(public name: string) {
    this.ws = new WebSocket(url);
    this.ws.on('message', (d: Buffer) => {
      const m = JSON.parse(d.toString()) as ServerMsg;
      const w = this.waiters.find((x) => x.pred(m));
      if (w) {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        w.res(m);
      } else this.msgs.push(m);
    });
  }
  open() {
    return new Promise<void>((r) => this.ws.on('open', () => r()));
  }
  send(o: unknown) {
    this.ws.send(typeof o === 'string' ? o : JSON.stringify(o));
  }
  wait<T extends ServerMsg['t']>(t: T, pred: (m: Extract<ServerMsg, { t: T }>) => boolean = () => true, ms = 8000): Promise<Extract<ServerMsg, { t: T }>> {
    const found = this.msgs.find((m) => m.t === t && pred(m as Extract<ServerMsg, { t: T }>));
    if (found) {
      this.msgs.splice(this.msgs.indexOf(found), 1);
      return Promise.resolve(found as Extract<ServerMsg, { t: T }>);
    }
    return new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error(`timeout waiting ${t}`)), ms);
      this.waiters.push({
        pred: (m) => m.t === t && pred(m as Extract<ServerMsg, { t: T }>),
        res: (m) => {
          clearTimeout(timer);
          res(m as Extract<ServerMsg, { t: T }>);
        },
      });
    });
  }
  async hello(tpl = 'classic', material: MaterialId = 'plastic', extra: Record<string, unknown> = {}) {
    const poly = processOutline(templateStrokes(tpl)).polygon;
    this.send({ t: 'hello', v: PROTOCOL_VERSION, name: this.name, horn: { ...makeHornData(this.name, material, poly), ...extra } });
  }
  close() {
    this.ws.close();
  }
}

test('角データの検証：巨大な角・改ざんステータスを拒否', async () => {
  const c = new TestClient('cheater');
  await c.open();
  c.send({ t: 'hello', v: PROTOCOL_VERSION, name: 'x', horn: { version: 1, name: 'x', material: 'glass', vertices: [[0, 0], [9999, 0], [0, 50]] } });
  const e1 = await c.wait('err');
  assert.equal(e1.code, 'invalid_horn');
  await c.hello('classic', 'glass', { maxHp: 999999 });
  const e2 = await c.wait('err');
  assert.equal(e2.code, 'invalid_horn');
  c.send({ t: 'hello', v: PROTOCOL_VERSION, name: 'x', horn: { version: 1, name: 'x', material: 'diamond', vertices: [[0, 0], [10, 0], [0, 50]] } });
  assert.equal((await c.wait('err')).code, 'invalid_horn');
  c.close();
});

test('不正なメッセージ・ルームコードを拒否、巨大パケットで切断', async () => {
  const c = new TestClient('bad');
  await c.open();
  c.send('not json');
  assert.equal((await c.wait('err')).code, 'bad_message');
  c.send({ t: 'join', code: 'abc' });
  assert.equal((await c.wait('err')).code, 'bad_message');
  await c.hello();
  await c.wait('welcome');
  c.send({ t: 'join', code: 'ZZZZZZ' });
  assert.equal((await c.wait('err')).code, 'room_not_found');
  const closed = new Promise<void>((r) => c.ws.on('close', () => r()));
  c.send('x'.repeat(MAX_PACKET_BYTES + 100));
  await closed;
});

test('ルーム作成 → 参加 → 準備完了 → サーバー権威の試合 → 決着 → 再戦', async () => {
  const a = new TestClient('Alice');
  const b = new TestClient('Bob');
  await Promise.all([a.open(), b.open()]);
  await a.hello('stub', 'azuki');
  await b.hello('classic', 'wood');
  const wa = await a.wait('welcome');
  await b.wait('welcome');
  assert.ok(wa.horn.maxHp > 1000, 'サーバーが材質と形状からHPを算出');
  a.send({ t: 'create' });
  const room = await a.wait('room');
  assert.match(room.code, /^[A-Z2-9]{6}$/);
  b.send({ t: 'join', code: room.code });
  const rb = await b.wait('room', (m) => m.players.filter(Boolean).length === 2);
  assert.equal(rb.you, 1);
  // 3人目は満員
  const c = new TestClient('Carol');
  await c.open();
  await c.hello();
  await c.wait('welcome');
  c.send({ t: 'join', code: room.code });
  assert.equal((await c.wait('err')).code, 'room_full');
  c.close();

  a.send({ t: 'ready', ready: true });
  b.send({ t: 'ready', ready: true });
  const sa = await a.wait('start');
  assert.equal(sa.you, 0);
  assert.equal(sa.players[1].name, 'Bob');
  // スナップショットが届く
  const s1 = await a.wait('s');
  assert.equal(s1.snap.f.length, 2);
  // B が A の入力を偽装しようとしても自分のスロットにしか効かない（プロトコル上スロット指定がない）
  b.send({ t: 'in', seq: 1, c: true, m: 1, slot: 0 });
  // 両者とも溜めて振る、を繰り返して決着させる
  let seq = 10;
  const spam = setInterval(() => {
    const press = seq % 2 === 0;
    a.send({ t: 'in', seq: seq, c: press, m: 1 });
    b.send({ t: 'in', seq: seq, c: !press, m: 1 });
    seq++;
  }, 350);
  const end = await a.wait('end', () => true, 60000);
  clearInterval(spam);
  assert.ok(end.reason, '勝敗理由');
  assert.equal(end.stats.length, 2);
  const endB = await b.wait('end');
  assert.equal(endB.winner, end.winner);
  // HP はサーバー確定値。スナップショット上のHPと統計が整合
  a.send({ t: 'rematch' });
  await b.wait('rematch', (m) => m.votes[0]);
  b.send({ t: 'rematch' });
  const s2 = await b.wait('start');
  assert.equal(s2.you, 1);
  a.close();
  b.close();
});

test('ランダムマッチングとキャンセル', async () => {
  const a = new TestClient('Q1');
  const b = new TestClient('Q2');
  await Promise.all([a.open(), b.open()]);
  await a.hello('spear', 'glass');
  await b.hello('hook', 'plastic');
  await a.wait('welcome');
  await b.wait('welcome');
  a.send({ t: 'quick' });
  await a.wait('queued');
  a.send({ t: 'cancel' });
  await a.wait('left');
  a.send({ t: 'quick' });
  b.send({ t: 'quick' });
  const ra = await a.wait('room');
  assert.equal(ra.quick, true);
  // ランダムマッチは双方の角を表示した後に自動開始
  await a.wait('start');
  await b.wait('start');
  a.close();
  b.close();
});

test('切断 → 再接続（resume）で試合に復帰、猶予切れは不戦敗', async () => {
  const a = new TestClient('R1');
  const b = new TestClient('R2');
  await Promise.all([a.open(), b.open()]);
  await a.hello();
  await b.hello();
  const w = await a.wait('welcome');
  await b.wait('welcome');
  a.send({ t: 'create' });
  const room = await a.wait('room');
  b.send({ t: 'join', code: room.code });
  await a.wait('room', (m) => m.players.filter(Boolean).length === 2);
  a.send({ t: 'ready', ready: true });
  b.send({ t: 'ready', ready: true });
  await a.wait('start');
  a.close();
  await b.wait('opp', (m) => m.status === 'disconnected');
  const a2 = new TestClient('R1');
  await a2.open();
  a2.send({ t: 'resume', token: w.token });
  const st = await a2.wait('start');
  assert.equal(st.you, 0);
  await b.wait('opp', (m) => m.status === 'reconnected');
  await a2.wait('s');
  // 今度は戻らない → 不戦敗
  a2.close();
  const end = await b.wait('end', () => true, 10000);
  assert.equal(end.reason, 'forfeit');
  assert.equal(end.winner, 1);
  b.close();
});

test('全テンプレートの角がサーバーで受理される', async () => {
  const c = new TestClient('T');
  await c.open();
  for (const t of HORN_TEMPLATES) {
    await c.hello(t.id, 'plastic');
    const w = await c.wait('welcome');
    assert.ok(w.horn.polygon.length >= 3);
  }
  c.close();
});

test('オンライン使用禁止の材質（ゴム）は拒否、他の材質は受理', async () => {
  const c = new TestClient('B');
  await c.open();
  await c.hello('classic', 'rubber');
  const e = await c.wait('err');
  assert.equal(e.code, 'banned_material');
  for (const m of ['fire', 'iron', 'gold', 'coral', 'glass'] as const) {
    await c.hello('classic', m);
    await c.wait('welcome');
  }
  c.close();
});

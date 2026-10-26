/**
 * 対戦サーバーの結合テスト（実際に ws で接続してルーム作成〜試合〜決着まで）
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import { HORN_TEMPLATES, MATERIAL_IDS, MAX_PACKET_BYTES, MaterialId, PROTOCOL_VERSION, ServerMsg, makeHornData, processOutline, templateStrokes } from '@kinggnu/shared';
import { Client, GameServer } from '../src/core/gameServer';
import { AccountService } from '../src/core/accounts';
import { IdTokenVerifier, type FetchJson } from '../src/core/auth';
import { StoreTransaction } from '../src/core/iap';
import { MemoryAccountStore } from '../src/core/store';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';

/* テスト用の「Appleの鍵」と「ストアの購入履歴」 */
export const appleKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const appleJwk = { ...(appleKeys.publicKey.export({ format: 'jwk' }) as Record<string, unknown>), kid: 'test-kid', alg: 'RS256', use: 'sig' };
const fakeFetch: FetchJson = async (u) => ({ ok: true, status: 200, json: async () => (u.includes('apple') ? { keys: [appleJwk] } : { keys: [] }) });
export const storeTx: StoreTransaction[] = [];
export function appleToken(sub: string, opts: { aud?: string; exp?: number; key?: typeof appleKeys.privateKey } = {}) {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = enc({ alg: 'RS256', kid: 'test-kid' });
  const body = enc({ iss: 'https://appleid.apple.com', aud: opts.aud ?? 'jp.yein.kinghorn', sub, iat: Math.floor(Date.now() / 1000), exp: opts.exp ?? Math.floor(Date.now() / 1000) + 600 });
  const sig = cryptoSign('RSA-SHA256', Buffer.from(`${head}.${body}`), opts.key ?? appleKeys.privateKey).toString('base64url');
  return `${head}.${body}.${sig}`;
}

let http: Server;
let wss: WebSocketServer;
let game: GameServer;
let url = '';
let loop: ReturnType<typeof setInterval>;

before(async () => {
  const accounts = new AccountService(new MemoryAccountStore(), new IdTokenVerifier(fakeFetch), { transactions: async () => [...storeTx] }, {
    appleAudiences: ['jp.yein.kinghorn'],
    allowTestPurchases: true,
  });
  game = new GameServer({ reconnectGrace: 1500, quickAutoStartMs: 200, rankedBotAfterMs: [400, 400] }, accounts);
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

let ridSeq = 1;

class TestClient {
  ws: WebSocket;
  session = '';
  accountId = '';
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
  async rpc(o: Record<string, unknown>) {
    const rid = ridSeq++;
    this.send({ ...o, rid });
    return this.wait('acct', (m) => m.rid === rid);
  }
  /** ゲストでログイン。unlockAll なら全材質を解放した状態にする（対戦テスト用） */
  async auth(unlockAll = true) {
    const r = this.session ? await this.rpc({ t: 'auth', method: 'session', token: this.session }) : await this.rpc({ t: 'auth', method: 'guest' });
    assert.ok(r.ok, r.error ?? "");
    if (r.session) this.session = r.session;
    this.accountId = r.profile!.id;
    if (unlockAll) {
      const rec = game.accounts!.store.get(this.accountId)!;
      rec.materials = [...MATERIAL_IDS];
    }
    return r;
  }
  async hello(tpl = 'classic', material: MaterialId = 'plastic', extra: Record<string, unknown> = {}) {
    if (!this.accountId) await this.auth();
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

test('全材質（ゴム含む）がオンラインで受理される', async () => {
  const c = new TestClient('B');
  await c.open();
  for (const m of MATERIAL_IDS) {
    await c.hello('classic', m);
    const w = await c.wait('welcome');
    assert.equal(w.horn.material, m);
  }
  c.close();
});

/* ---------------- アカウント・経済 ---------------- */

test('ゲスト登録：初期状態・ログボは1日1回・同じセッションで再ログイン', async () => {
  const c = new TestClient('G');
  await c.open();
  const r = await c.auth(false);
  assert.equal(r.bonus, 10);
  const p = r.profile!;
  assert.equal(p.emeralds, 10);
  assert.deepEqual(p.materials, []);
  assert.equal(p.slots, 2);
  assert.equal(p.horns.length, 2);
  assert.equal(p.skin, 'holstein');
  assert.equal(p.rating, 1500);
  c.close();
  const c2 = new TestClient('G');
  await c2.open();
  c2.session = c.session;
  const r2 = await c2.auth(false);
  assert.equal(r2.profile!.id, p.id, '同じアカウント');
  assert.equal(r2.bonus, undefined, '同じ日は2回目のログボなし');
  assert.equal(r2.profile!.emeralds, 10);
  // 1接続でゲストを何個も作れない
  const r3 = await c2.rpc({ t: 'auth', method: 'guest' });
  assert.equal(r3.ok, true);
  const r4 = await c2.rpc({ t: 'auth', method: 'guest' });
  assert.equal(r4.ok, false);
  // 偽セッション
  const r5 = await c2.rpc({ t: 'auth', method: 'session', token: 'x'.repeat(32) });
  assert.equal(r5.error, 'session_invalid');
  c2.close();
});

test('材質の解放：エメラルド不足は拒否、解放するとオンラインで使える。未解放はサーバーが拒否', async () => {
  const c = new TestClient('M');
  await c.open();
  await c.auth(false);
  await c.hello('classic', 'glass');
  assert.equal((await c.wait('err')).code, 'locked_material');
  await c.hello('classic', 'rubber');
  await c.wait('welcome'); // 無料材質
  // 10 エメラルドでは 20 の材質は買えない
  let r = await c.rpc({ t: 'acct', op: 'buyMaterial', material: 'fire' });
  assert.equal(r.error, 'not_enough_emeralds');
  r = await c.rpc({ t: 'acct', op: 'testPurchase', product: 'kinghorn.emerald100' });
  assert.ok(r.ok);
  assert.equal(r.profile!.emeralds, 110);
  r = await c.rpc({ t: 'acct', op: 'buyMaterial', material: 'fire' });
  assert.ok(r.ok);
  assert.equal(r.profile!.emeralds, 90);
  assert.deepEqual(r.profile!.materials, ['fire']);
  r = await c.rpc({ t: 'acct', op: 'buyMaterial', material: 'fire' });
  assert.equal(r.error, 'already_owned');
  r = await c.rpc({ t: 'acct', op: 'buyMaterial', material: 'plastic' });
  assert.equal(r.error, 'already_owned', '無料材質は買えない');
  await c.hello('classic', 'fire');
  await c.wait('welcome');
  // クライアントがエメラルド数を偽っても無視（そもそもメッセージに含められない）
  c.send({ t: 'acct', rid: 999, op: 'buyMaterial', material: 'iron', emeralds: 99999, price: 0 });
  const r2 = await c.wait('acct', (m) => m.rid === 999);
  assert.ok(r2.ok);
  assert.equal(r2.profile!.emeralds, 70);
  c.close();
});

test('スキン：購入・装備・未所持は使えない（能力差なし）', async () => {
  const a = new TestClient('SkinA');
  const b = new TestClient('SkinB');
  await Promise.all([a.open(), b.open()]);
  await a.auth(false);
  await b.auth(false);
  let r = await a.rpc({ t: 'acct', op: 'buySkin', skin: 'galaxy' });
  assert.equal(r.error, 'not_enough_emeralds');
  await a.rpc({ t: 'acct', op: 'testPurchase', product: 'kinghorn.emerald100' });
  r = await a.rpc({ t: 'acct', op: 'buySkin', skin: 'galaxy' });
  assert.ok(r.ok);
  assert.equal(r.profile!.skin, 'galaxy');
  assert.equal(r.profile!.emeralds, 10);
  r = await a.rpc({ t: 'acct', op: 'equipSkin', skin: 'panda' });
  assert.equal(r.error, 'not_owned');
  // 対戦相手にはスキンが見える。未所持のスキンを名乗っても既定に戻される
  const poly = processOutline(templateStrokes('classic')).polygon;
  a.send({ t: 'hello', v: PROTOCOL_VERSION, name: 'A', horn: makeHornData('A', 'plastic', poly), skin: 'galaxy' });
  b.send({ t: 'hello', v: PROTOCOL_VERSION, name: 'B', horn: makeHornData('B', 'plastic', poly), skin: 'golden' });
  await a.wait('welcome');
  await b.wait('welcome');
  a.send({ t: 'create' });
  const room = await a.wait('room');
  b.send({ t: 'join', code: room.code });
  const rb = await b.wait('room', (m) => !!m.players[1]);
  assert.equal(rb.players[0]!.skin, 'galaxy');
  assert.equal(rb.players[1]!.skin, 'holstein');
  a.close();
  b.close();
});

test('角の保存枠：無料は2つ、360円の拡張で8つ。広告削除フラグ', async () => {
  const c = new TestClient('Slot');
  await c.open();
  await c.auth(false);
  const horn = makeHornData('H', 'plastic', processOutline(templateStrokes('hook')).polygon);
  for (const slot of [0, 1]) assert.ok((await c.rpc({ t: 'acct', op: 'saveHorn', slot, horn })).ok);
  let r = await c.rpc({ t: 'acct', op: 'saveHorn', slot: 2, horn });
  assert.equal(r.error, 'slot_locked');
  r = await c.rpc({ t: 'acct', op: 'testPurchase', product: 'kinghorn.slots8' });
  assert.equal(r.profile!.slots, 8);
  assert.equal(r.profile!.horns.length, 8);
  r = await c.rpc({ t: 'acct', op: 'saveHorn', slot: 7, horn });
  assert.ok(r.ok);
  assert.equal(r.profile!.horns[7]!.name, 'H');
  assert.equal(r.profile!.horns.filter(Boolean).length, 3);
  r = await c.rpc({ t: 'acct', op: 'deleteHorn', slot: 0 });
  assert.equal(r.profile!.horns[0], null);
  // 壊れた角は保存できない
  r = await c.rpc({ t: 'acct', op: 'saveHorn', slot: 1, horn: { ...horn, vertices: [[0, 0], [1, 0], [0, 1]] } });
  assert.equal(r.ok, false);
  assert.equal(r.profile?.noAds ?? false, false);
  r = await c.rpc({ t: 'acct', op: 'testPurchase', product: 'kinghorn.noads' });
  assert.equal(r.profile!.noAds, true);
  c.close();
});

test('ストア購入の取り込み：同じトランザクションは1回だけ付与', async () => {
  const c = new TestClient('Iap');
  await c.open();
  await c.auth(false);
  storeTx.push({ product: 'kinghorn.emerald100', id: 'T1', sandbox: false, at: 0 }, { product: 'kinghorn.noads', id: 'T2', sandbox: false, at: 0 }, { product: 'unknown.item', id: 'T3', sandbox: false, at: 0 });
  let r = await c.rpc({ t: 'acct', op: 'syncPurchases' });
  assert.deepEqual(r.granted?.sort(), ['kinghorn.emerald100', 'kinghorn.noads']);
  assert.equal(r.profile!.emeralds, 110);
  assert.equal(r.profile!.noAds, true);
  r = await c.rpc({ t: 'acct', op: 'syncPurchases' });
  assert.deepEqual(r.granted, []);
  assert.equal(r.profile!.emeralds, 110);
  storeTx.push({ product: 'kinghorn.emerald100', id: 'T4', sandbox: true, at: 0 });
  r = await c.rpc({ t: 'acct', op: 'syncPurchases' });
  assert.equal(r.profile!.emeralds, 210);
  storeTx.length = 0;
  c.close();
});

test('Appleでサインイン：ゲストのデータを引き継ぎ、機種変更後も同じアカウント。偽トークンは拒否', async () => {
  const c = new TestClient('Apple');
  await c.open();
  await c.auth(false);
  await c.rpc({ t: 'acct', op: 'testPurchase', product: 'kinghorn.emerald100' });
  const r = await c.rpc({ t: 'auth', method: 'apple', token: appleToken('apple-sub-1'), link: c.session });
  assert.ok(r.ok, r.error ?? "");
  assert.equal(r.profile!.id, c.accountId, 'ゲストのアカウントに紐づく');
  assert.deepEqual(r.profile!.providers.sort(), ['apple', 'guest']);
  assert.equal(r.profile!.emeralds, 110);
  c.close();
  // 別の端末（新しい接続・セッションなし）から同じ Apple ID でサインイン
  const d = new TestClient('Apple2');
  await d.open();
  const r2 = await d.rpc({ t: 'auth', method: 'apple', token: appleToken('apple-sub-1') });
  assert.equal(r2.profile!.id, c.accountId);
  assert.equal(r2.profile!.emeralds, 110);
  // 偽造（別の鍵で署名）・宛先違い・期限切れ
  const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
  for (const bad of [appleToken('x', { key: other.privateKey }), appleToken('x', { aud: 'com.evil.app' }), appleToken('x', { exp: 1000 })]) {
    const e = await d.rpc({ t: 'auth', method: 'apple', token: bad });
    assert.equal(e.error, 'signin_failed');
  }
  // Google は未設定
  const g = await d.rpc({ t: 'auth', method: 'google', token: appleToken('x') });
  assert.equal(g.error, 'provider_unavailable');
  d.close();
});

test('レート戦：相手がいなければCPU（CPUとは表示しない）。決着でレートが変わる', async () => {
  const c = new TestClient('Ranked');
  await c.open();
  await c.hello();
  await c.wait('welcome');
  c.send({ t: 'ranked' });
  await c.wait('queued');
  const room = await c.wait('room', (m) => !!m.ranked && !!m.players[0] && !!m.players[1], 5000);
  const opp = room.players[1 - room.you]!;
  assert.equal(room.quick, true);
  assert.ok(!/cpu/i.test(opp.name), `CPUと分からない名前: ${opp.name}`);
  assert.ok(typeof opp.rating === 'number' && Math.abs(opp.rating - 1500) <= 60);
  assert.equal(opp.connected, true);
  await c.wait('start');
  // 試合を放棄 → 負け扱いでレートが下がる
  c.send({ t: 'leave' });
  const rt = await c.wait('rating');
  assert.ok(rt.delta < 0);
  assert.equal(rt.after, rt.before + rt.delta);
  const p = await c.rpc({ t: 'acct', op: 'profile' });
  assert.equal(p.profile!.rating, rt.after);
  assert.equal(p.profile!.ranked.losses, 1);
  c.close();
});

test('レート戦：人間どうしが待っていれば人間と当たる', async () => {
  const a = new TestClient('RA');
  const b = new TestClient('RB');
  await Promise.all([a.open(), b.open()]);
  await a.hello();
  await b.hello();
  await a.wait('welcome');
  await b.wait('welcome');
  a.send({ t: 'ranked' });
  b.send({ t: 'ranked' });
  const ra = await a.wait('room', (m) => !!m.ranked && !!m.players[0] && !!m.players[1]);
  const names = ra.players.map((p) => p!.name).sort();
  assert.deepEqual(names, ['RA', 'RB']);
  await a.wait('start');
  b.send({ t: 'leave' });
  const [x, y] = await Promise.all([a.wait('rating'), b.wait('rating')]);
  assert.ok(x.delta > 0 && y.delta < 0);
  // レート戦は再戦なし
  a.send({ t: 'rematch' });
  a.close();
  b.close();
});

test('レート戦のCPUは実際に戦う（放置すると負ける）', { timeout: 60000 }, async () => {
  const c = new TestClient('Idle');
  await c.open();
  await c.hello('classic', 'cork');
  await c.wait('welcome');
  c.send({ t: 'ranked' });
  const room = await c.wait('room', (m) => !!m.ranked && !!m.players[0] && !!m.players[1], 5000);
  await c.wait('start');
  const end = await c.wait('end', () => true, 50000);
  const botIdx = 1 - room.you;
  assert.ok(end.stats[botIdx].dealt > 0, 'CPUがダメージを与えた');
  assert.notEqual(end.winner, room.you, '放置したほうは勝てない');
  const rt = await c.wait('rating');
  assert.ok(rt.delta <= 0);
  c.close();
});

test('事前登録特典：ショップのアイテムがすべて無料', async () => {
  const c = new TestClient('Free');
  await c.open();
  await c.auth(false);
  let r = await c.rpc({ t: 'acct', op: 'promoClaim', product: 'kinghorn.emerald100' });
  assert.ok(r.ok);
  assert.equal(r.profile!.emeralds, 110);
  r = await c.rpc({ t: 'acct', op: 'promoClaim', product: 'kinghorn.emerald100' });
  assert.equal(r.profile!.emeralds, 210);
  r = await c.rpc({ t: 'acct', op: 'promoClaim', product: 'kinghorn.slots8' });
  assert.equal(r.profile!.slots, 8);
  r = await c.rpc({ t: 'acct', op: 'promoClaim', product: 'kinghorn.noads' });
  assert.equal(r.profile!.noAds, true);
  r = await c.rpc({ t: 'acct', op: 'promoClaim', product: 'kinghorn.noads' });
  assert.equal(r.error, 'already_owned');
  c.close();
});

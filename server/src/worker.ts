/**
 * Cloudflare Workers + Durable Objects 版（オプション）
 *
 * 1つの Durable Object（名前 "global"）がロビー・ランダムマッチ・全ルームの試合を受け持つ。
 * リアルタイム物理を 60Hz で回すため WebSocket Hibernation API は使わず、試合中は常時起動する。
 *  - CPU時間の上限はリクエスト/受信メッセージごとにリセットされる（入力が届き続けるので試合中は問題になりにくい）
 *  - ただし接続中は「実時間」で Duration 課金される（詳細は README）
 * 本格運用や大人数では Node 版（src/node.ts）を推奨。
 */
import { MAX_PACKET_BYTES } from '@kinggnu/shared';
import { Client, GameServer } from './core/gameServer';

/* Workers ランタイムの最小限の型（@cloudflare/workers-types を入れれば不要） */
interface CfWebSocket {
  accept(): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'message', fn: (ev: { data: unknown }) => void): void;
  addEventListener(type: 'close' | 'error', fn: () => void): void;
}
declare const WebSocketPair: { new (): { 0: CfWebSocket; 1: CfWebSocket } };
interface DurableObjectId {}
interface DurableObjectStub {
  fetch(req: Request): Promise<Response>;
}
interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}
interface Env {
  GAME: DurableObjectNamespace;
  ALLOWED_ORIGINS?: string;
}

function allowed(origin: string | null, env: Env) {
  const list = (env.ALLOWED_ORIGINS ?? '*').split(',').map((s) => s.trim());
  return list.includes('*') || (origin !== null && list.includes(origin));
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/health') return new Response(JSON.stringify({ ok: true, name: 'kinggnu-worker' }), { headers: { 'content-type': 'application/json' } });
    if (url.pathname !== '/ws') return new Response('KingGnu server', { status: 200 });
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    if (!allowed(req.headers.get('Origin'), env)) return new Response('origin not allowed', { status: 403 });
    const stub = env.GAME.get(env.GAME.idFromName('global'));
    return stub.fetch(req);
  },
};

export class GameRoomDO {
  private game = new GameServer();
  private timer: ReturnType<typeof setInterval> | null = null;
  private last = Date.now();
  private sockets = new Map<CfWebSocket, Client>();

  constructor(_state: unknown, _env: Env) {
    this.game.onReattach = (from, to) => {
      for (const [ws, c] of this.sockets) if (c === from) this.sockets.set(ws, to);
    };
  }

  async fetch(_req: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    const c = this.game.connect({ send: (d) => server.send(d), close: (code, reason) => server.close(code, reason) });
    if (c) {
      this.sockets.set(server, c);
      server.addEventListener('message', (ev) => {
        const cl = this.sockets.get(server);
        if (!cl) return;
        const data = typeof ev.data === 'string' && ev.data.length <= MAX_PACKET_BYTES ? ev.data : null;
        this.game.message(cl, data);
      });
      const onClose = () => {
        const cl = this.sockets.get(server);
        this.sockets.delete(server);
        if (cl) this.game.disconnect(cl);
        this.maybeStop();
      };
      server.addEventListener('close', onClose);
      server.addEventListener('error', onClose);
      this.ensureLoop();
    }
    return new Response(null, { status: 101, webSocket: client } as ResponseInit & { webSocket: CfWebSocket });
  }

  private ensureLoop() {
    if (this.timer) return;
    this.last = Date.now();
    this.timer = setInterval(() => {
      const now = Date.now();
      this.game.tick((now - this.last) / 1000, now);
      this.last = now;
      this.maybeStop();
    }, 1000 / 60);
  }

  /** 誰もいなければループを止めて Durable Object を休止させる */
  private maybeStop() {
    if (this.timer && this.game.clients.size === 0) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

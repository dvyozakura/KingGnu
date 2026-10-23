/**
 * Node.js 常駐 WebSocket サーバー
 *   既定: 127.0.0.1:8787 で待ち受け（Cloudflare Tunnel 経由でだけ外部公開する）
 *   環境変数: PORT / HOST / ALLOWED_ORIGINS（カンマ区切り）/ MAX_CONN_PER_IP
 */
import { createServer, type IncomingMessage } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { MAX_PACKET_BYTES } from '@kinggnu/shared';
import { Client, GameServer } from './core/gameServer';

const PORT = Number(process.env.PORT ?? 8787);
/** トンネル（cloudflared）からだけ届くよう、既定はループバックのみ */
const HOST = process.env.HOST ?? '127.0.0.1';
/** 許可するフロントエンドの Origin（パスは付けない） */
const DEFAULT_ORIGINS = 'https://dvyozakura.github.io,http://localhost:5173';
const ORIGINS = (process.env.ALLOWED_ORIGINS ?? DEFAULT_ORIGINS)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const MAX_PER_IP = Number(process.env.MAX_CONN_PER_IP ?? 8);

const game = new GameServer({ log: (...a) => console.log(new Date().toISOString(), ...a) });

const http = createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ ok: true, name: 'kinggnu', ...game.stats }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const perIp = new Map<string, number>();

/** Cloudflare Tunnel 経由では接続元が 127.0.0.1 になるので、Cloudflare が付ける実IPヘッダーを使う */
function clientIp(req: IncomingMessage): string {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && cf) return cf;
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff) return xff.split(',')[0].trim();
  return req.socket.remoteAddress ?? '';
}

const wss = new WebSocketServer({
  server: http,
  path: '/ws',
  maxPayload: MAX_PACKET_BYTES,
  verifyClient: (info, cb) => {
    const origin = info.origin ?? '';
    if (!ORIGINS.includes('*') && !ORIGINS.includes(origin)) return cb(false, 403, 'origin not allowed');
    const ip = clientIp(info.req);
    if ((perIp.get(ip) ?? 0) >= MAX_PER_IP) return cb(false, 429, 'too many connections');
    cb(true);
  },
});

const byWs = new Map<WebSocket, Client>();
game.onReattach = (from, to) => {
  for (const [ws, c] of byWs) if (c === from) byWs.set(ws, to);
};

wss.on('connection', (ws, req) => {
  const ip = clientIp(req);
  perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
  const client = game.connect({
    send: (d) => {
      if (ws.readyState === ws.OPEN) ws.send(d);
    },
    close: (code, reason) => ws.close(code, reason),
  });
  if (!client) return;
  byWs.set(ws, client);
  ws.on('message', (data, isBinary) => {
    const c = byWs.get(ws);
    if (!c) return;
    if (isBinary) return game.message(c, null);
    game.message(c, data.toString());
  });
  ws.on('close', () => {
    perIp.set(ip, Math.max(0, (perIp.get(ip) ?? 1) - 1));
    if ((perIp.get(ip) ?? 0) === 0) perIp.delete(ip);
    const c = byWs.get(ws);
    byWs.delete(ws);
    if (c) game.disconnect(c);
  });
  ws.on('error', () => ws.close());
});

// 物理は 60Hz で回す（Match 内部で 120Hz の固定ステップに分割）
let last = performance.now();
setInterval(() => {
  const now = performance.now();
  const dt = (now - last) / 1000;
  last = now;
  game.tick(dt);
}, 1000 / 60);

http.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') console.error(`ポート ${PORT} は既に使われています。PORT 環境変数で別の番号を指定してください。`);
  else console.error(e);
  process.exit(1);
});
http.listen(PORT, HOST, () =>
  console.log(`KingGnu server listening on http://${HOST}:${PORT} (ws path /ws, origins: ${ORIGINS.join(', ')})`),
);

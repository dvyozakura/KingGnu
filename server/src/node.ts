/**
 * Node.js 常駐 WebSocket サーバー（推奨構成）
 *   PORT=8787 ALLOWED_ORIGINS=https://<user>.github.io node dist/server.mjs
 */
import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { MAX_PACKET_BYTES } from '@kinggnu/shared';
import { Client, GameServer } from './core/gameServer';

const PORT = Number(process.env.PORT ?? 8787);
const ORIGINS = (process.env.ALLOWED_ORIGINS ?? '*')
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

const wss = new WebSocketServer({
  server: http,
  path: '/ws',
  maxPayload: MAX_PACKET_BYTES,
  verifyClient: (info, cb) => {
    const origin = info.origin ?? '';
    if (!ORIGINS.includes('*') && !ORIGINS.includes(origin)) return cb(false, 403, 'origin not allowed');
    const ip = (info.req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0].trim() ?? info.req.socket.remoteAddress ?? '';
    if ((perIp.get(ip) ?? 0) >= MAX_PER_IP) return cb(false, 429, 'too many connections');
    cb(true);
  },
});

const byWs = new Map<WebSocket, Client>();
game.onReattach = (from, to) => {
  for (const [ws, c] of byWs) if (c === from) byWs.set(ws, to);
};

wss.on('connection', (ws, req) => {
  const ip = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0].trim() ?? req.socket.remoteAddress ?? '';
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

http.listen(PORT, () => console.log(`KingGnu server listening on :${PORT} (ws path /ws, origins: ${ORIGINS.join(',')})`));

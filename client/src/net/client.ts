/** WebSocket クライアント（自動再接続・RTT計測付き） */
import { ClientMsg, ServerMsg } from '@kinggnu/shared';

export type NetStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

/** v2: 以前保存された一時URL（trycloudflare など）は使わない */
const URL_KEY = 'kinggnu.serverUrl.v2';

/**
 * 既定の接続先。
 *  - 本番ビルド（GitHub Pages）: client/.env.production の VITE_SERVER_URL（wss://kinggnu.yein.jp）
 *  - 開発（npm run dev）       : 未設定なので手元の対戦サーバー ws://localhost:8787/ws
 */
export const DEFAULT_SERVER_URL: string = import.meta.env.VITE_SERVER_URL ?? 'ws://localhost:8787/ws';

export function defaultServerUrl(): string {
  try {
    const saved = localStorage.getItem(URL_KEY);
    if (saved) return saved;
  } catch {
    /* ignore */
  }
  return DEFAULT_SERVER_URL;
}

/** 手入力したURLを保存（既定と同じなら保存しない） */
export function saveServerUrl(url: string) {
  try {
    if (url && normalizeServerUrl(url) !== normalizeServerUrl(DEFAULT_SERVER_URL)) localStorage.setItem(URL_KEY, url);
    else localStorage.removeItem(URL_KEY);
    localStorage.removeItem('kinggnu.serverUrl');
  } catch {
    /* ignore */
  }
}

/** https:// → wss:// への置き換えと、末尾の /ws の付け忘れを補う */
export function normalizeServerUrl(raw: string): string {
  let u = raw.trim();
  if (!u) return u;
  if (u.startsWith('https://')) u = 'wss://' + u.slice(8);
  else if (u.startsWith('http://')) u = 'ws://' + u.slice(7);
  else if (!/^wss?:\/\//.test(u)) u = 'wss://' + u;
  try {
    const p = new URL(u);
    if (p.pathname === '' || p.pathname === '/') p.pathname = '/ws';
    return p.toString().replace(/\/$/, '');
  } catch {
    return u;
  }
}

export class NetClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<(m: ServerMsg) => void>();
  private statusListeners = new Set<(s: NetStatus) => void>();
  status: NetStatus = 'idle';
  token: string | null = null;
  rtt = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private retries = 0;
  private wantOpen = false;
  /** 再接続時に resume を送るか（ルーム/試合中） */
  resumable = false;
  /** 最後に送った hello。再接続で復帰できなかったとき（サーバー再起動など）に送り直す */
  hello: ClientMsg | null = null;

  constructor(public url: string) {
    this.url = normalizeServerUrl(url);
  }

  connect(): Promise<void> {
    this.wantOpen = true;
    return new Promise((resolve, reject) => {
      this.setStatus(this.retries > 0 ? 'reconnecting' : 'connecting');
      let ws: WebSocket;
      try {
        ws = new WebSocket(this.url);
      } catch (e) {
        this.setStatus('closed');
        reject(e);
        return;
      }
      this.ws = ws;
      let opened = false;
      const timeout = setTimeout(() => {
        if (!opened) {
          ws.close();
          reject(new Error('timeout'));
        }
      }, 8000);
      ws.onopen = () => {
        opened = true;
        clearTimeout(timeout);
        this.retries = 0;
        this.setStatus('open');
        if (this.resumable && this.token) this.send({ t: 'resume', token: this.token });
        this.pingTimer = setInterval(() => this.send({ t: 'ping', ts: performance.now() }), 2000);
        resolve();
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return;
        let msg: ServerMsg;
        try {
          msg = JSON.parse(ev.data) as ServerMsg;
        } catch {
          return;
        }
        if (msg.t === 'pong') this.rtt = this.rtt ? this.rtt * 0.8 + (performance.now() - msg.ts) * 0.2 : performance.now() - msg.ts;
        if (msg.t === 'welcome') this.token = msg.token;
        // 復帰に失敗（サーバー再起動でトークンが消えた等）→ 新しい接続として名乗り直す
        if (msg.t === 'err' && (msg.code === 'resume_failed' || msg.code === 'no_hello') && this.hello) this.send(this.hello);
        for (const l of this.listeners) l(msg);
      };
      ws.onerror = () => {
        if (!opened) {
          clearTimeout(timeout);
          reject(new Error('connect_failed'));
        }
      };
      ws.onclose = () => {
        clearTimeout(timeout);
        if (this.pingTimer) clearInterval(this.pingTimer);
        this.pingTimer = null;
        if (this.ws !== ws) return;
        this.ws = null;
        if (this.wantOpen && this.resumable && this.retries < 6) {
          this.retries++;
          this.setStatus('reconnecting');
          setTimeout(() => this.connect().catch(() => undefined), 500 * this.retries);
        } else {
          this.setStatus('closed');
        }
      };
    });
  }

  private setStatus(s: NetStatus) {
    this.status = s;
    for (const l of this.statusListeners) l(s);
  }

  sendHello(msg: Extract<ClientMsg, { t: 'hello' }>) {
    this.hello = msg;
    this.send(msg);
  }

  send(msg: ClientMsg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  on(fn: (m: ServerMsg) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onStatus(fn: (s: NetStatus) => void) {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  close() {
    this.wantOpen = false;
    this.resumable = false;
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.ws?.close();
    this.ws = null;
    this.setStatus('closed');
  }
}

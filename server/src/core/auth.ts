/**
 * 「Appleでサインイン」「Googleでサインイン」の ID トークン（JWT, RS256）をサーバーで検証する。
 * 公開鍵は各社の JWKS から取得してキャッシュする。トークンの中身（sub）だけを信用し、
 * クライアントが申告したユーザーIDは使わない。
 */
import { createPublicKey, verify as cryptoVerify } from 'node:crypto';

export interface IdTokenConfig {
  jwksUrl: string;
  issuers: string[];
  audiences: string[];
}

export const APPLE_ID_CONFIG = (audiences: string[]): IdTokenConfig => ({
  jwksUrl: 'https://appleid.apple.com/auth/keys',
  issuers: ['https://appleid.apple.com'],
  audiences,
});

export const GOOGLE_ID_CONFIG = (audiences: string[]): IdTokenConfig => ({
  jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
  issuers: ['https://accounts.google.com', 'accounts.google.com'],
  audiences,
});

export type FetchJson = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

interface Jwk {
  kid?: string;
  kty?: string;
  n?: string;
  e?: string;
  [k: string]: unknown;
}

export class AuthError extends Error {}

function b64urlJson(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;
}

export class IdTokenVerifier {
  private cache = new Map<string, { at: number; keys: Jwk[] }>();

  constructor(
    private fetchJson: FetchJson,
    private ttlMs = 60 * 60_000,
  ) {}

  private async keys(url: string, now: number, force = false): Promise<Jwk[]> {
    const hit = this.cache.get(url);
    if (hit && !force && now - hit.at < this.ttlMs) return hit.keys;
    const res = await this.fetchJson(url);
    if (!res.ok) throw new AuthError(`jwks ${res.status}`);
    const body = (await res.json()) as { keys?: Jwk[] };
    const keys = Array.isArray(body.keys) ? body.keys : [];
    this.cache.set(url, { at: now, keys });
    return keys;
  }

  /** 検証に成功したら payload を返す。失敗は AuthError */
  async verify(token: string, cfg: IdTokenConfig, now = Date.now()): Promise<{ sub: string; email?: string }> {
    if (!cfg.audiences.length) throw new AuthError('provider not configured');
    const parts = token.split('.');
    if (parts.length !== 3) throw new AuthError('malformed');
    let header: Record<string, unknown>;
    let payload: Record<string, unknown>;
    try {
      header = b64urlJson(parts[0]);
      payload = b64urlJson(parts[1]);
    } catch {
      throw new AuthError('malformed');
    }
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new AuthError('alg');
    let jwk = (await this.keys(cfg.jwksUrl, now)).find((k) => k.kid === header.kid);
    // 鍵のローテーション直後はキャッシュに無いので1回だけ取り直す
    if (!jwk) jwk = (await this.keys(cfg.jwksUrl, now, true)).find((k) => k.kid === header.kid);
    if (!jwk) throw new AuthError('unknown key');
    const key = createPublicKey({ key: jwk, format: 'jwk' } as unknown as Parameters<typeof createPublicKey>[0]);
    const ok = cryptoVerify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'));
    if (!ok) throw new AuthError('signature');
    const sec = Math.floor(now / 1000);
    if (typeof payload.exp !== 'number' || payload.exp < sec - 30) throw new AuthError('expired');
    if (typeof payload.iat === 'number' && payload.iat > sec + 300) throw new AuthError('iat');
    if (typeof payload.iss !== 'string' || !cfg.issuers.includes(payload.iss)) throw new AuthError('iss');
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!aud.some((a) => typeof a === 'string' && cfg.audiences.includes(a))) throw new AuthError('aud');
    if (typeof payload.sub !== 'string' || !payload.sub) throw new AuthError('sub');
    return { sub: payload.sub, email: typeof payload.email === 'string' ? payload.email : undefined };
  }
}

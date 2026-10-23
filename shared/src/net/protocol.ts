/** オンライン対戦のメッセージ定義と検証（クライアント・サーバー共通） */
import { HornData, sanitizeName, validateHornData } from '../horn/serialize';
import { Poly } from '../geometry/polygon';
import { MaterialId } from '../config/materials';
import { EndReason, HornShapeSnap, MatchEvent, MatchSnapshot } from '../sim/match';
import { FighterStats } from '../sim/fighter';

export const PROTOCOL_VERSION = 1;
export const MAX_PACKET_BYTES = 16 * 1024;
export const ROOM_CODE_LENGTH = 6;
/** 紛らわしい文字（0/O, 1/I/L）を除いた32文字 */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const SNAPSHOT_HZ = 30;
export const INPUT_RATE_LIMIT = 40; // msgs/sec

export type ClientMsg =
  | { t: 'hello'; v: number; name: string; horn: HornData }
  | { t: 'quick' }
  | { t: 'create' }
  | { t: 'join'; code: string }
  | { t: 'cancel' }
  | { t: 'ready'; ready: boolean }
  | { t: 'in'; seq: number; c: boolean; m: -1 | 0 | 1 }
  | { t: 'rematch' }
  | { t: 'leave' }
  | { t: 'resume'; token: string }
  | { t: 'ping'; ts: number };

export interface PublicPlayer {
  name: string;
  material: MaterialId;
  polygon: Poly;
  maxHp: number;
  ready: boolean;
  connected: boolean;
}

export type ServerMsg =
  | { t: 'welcome'; id: string; token: string; horn: { polygon: Poly; material: MaterialId; maxHp: number; warnings: string[] } }
  | { t: 'err'; code: string; msg: string }
  | { t: 'queued' }
  | { t: 'room'; code: string; you: 0 | 1; players: (PublicPlayer | null)[]; state: 'lobby' | 'playing' | 'ended'; quick: boolean }
  | { t: 'start'; you: 0 | 1; players: PublicPlayer[]; countdown: number }
  | { t: 's'; snap: MatchSnapshot; ev: MatchEvent[] }
  | { t: 'horn'; f: 0 | 1; shape: HornShapeSnap }
  | { t: 'end'; winner: 0 | 1 | null; reason: EndReason; stats: FighterStats[]; time: number }
  | { t: 'rematch'; votes: [boolean, boolean] }
  | { t: 'opp'; status: 'left' | 'disconnected' | 'reconnected' }
  | { t: 'left' }
  | { t: 'pong'; ts: number; server: number };

const ROOM_RE = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

export function isValidRoomCode(code: unknown): code is string {
  return typeof code === 'string' && ROOM_RE.test(code);
}

export function normalizeRoomCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, ROOM_CODE_LENGTH);
}

/** 生の文字列を検証してクライアントメッセージにする。不正なら null */
export function parseClientMsg(raw: unknown): { msg?: ClientMsg; error?: string } {
  if (typeof raw !== 'string') return { error: 'binary_not_supported' };
  if (raw.length > MAX_PACKET_BYTES) return { error: 'too_large' };
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return { error: 'bad_json' };
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return { error: 'bad_shape' };
  const m = o as Record<string, unknown>;
  switch (m.t) {
    case 'hello': {
      if (m.v !== PROTOCOL_VERSION) return { error: 'version' };
      const h = validateHornData(m.horn);
      if (!h.ok || !h.value) return { error: 'horn:' + (h.error ?? 'invalid') };
      return { msg: { t: 'hello', v: PROTOCOL_VERSION, name: sanitizeName(m.name, 'Guest', 16), horn: h.value } };
    }
    case 'quick':
    case 'create':
    case 'cancel':
    case 'rematch':
    case 'leave':
      return { msg: { t: m.t } as ClientMsg };
    case 'join':
      if (!isValidRoomCode(m.code)) return { error: 'bad_code' };
      return { msg: { t: 'join', code: m.code } };
    case 'ready':
      return { msg: { t: 'ready', ready: m.ready === true } };
    case 'in': {
      if (typeof m.seq !== 'number' || !Number.isInteger(m.seq) || m.seq < 0) return { error: 'bad_input' };
      if (typeof m.c !== 'boolean') return { error: 'bad_input' };
      if (m.m !== -1 && m.m !== 0 && m.m !== 1) return { error: 'bad_input' };
      return { msg: { t: 'in', seq: m.seq, c: m.c, m: m.m } };
    }
    case 'resume':
      if (typeof m.token !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(m.token)) return { error: 'bad_token' };
      return { msg: { t: 'resume', token: m.token } };
    case 'ping':
      if (typeof m.ts !== 'number' || !Number.isFinite(m.ts)) return { error: 'bad_ping' };
      return { msg: { t: 'ping', ts: m.ts } };
    default:
      return { error: 'unknown_type' };
  }
}

/** 暗号学的乱数でルームコード・トークンを生成 */
export function randomString(len: number, alphabet: string): string {
  const out: string[] = [];
  const buf = new Uint8Array(len * 2);
  const max = 256 - (256 % alphabet.length);
  while (out.length < len) {
    (globalThis as unknown as { crypto: { getRandomValues(a: Uint8Array): Uint8Array } }).crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b < max) out.push(alphabet[b % alphabet.length]);
      if (out.length >= len) break;
    }
  }
  return out.join('');
}

export function makeRoomCode() {
  return randomString(ROOM_CODE_LENGTH, ROOM_CODE_ALPHABET);
}

export function makeToken() {
  return randomString(32, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-');
}

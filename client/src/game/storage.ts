/** ローカル保存（自作角・ニックネーム） */
import { HornData, validateHornData } from '@kinggnu/shared';

const KEY = 'kinggnu.horns.v1';
const NAME_KEY = 'kinggnu.nickname';

export interface SavedHorn extends HornData {
  id: string;
  savedAt: number;
}

function read(): SavedHorn[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    const out: SavedHorn[] = [];
    for (const o of arr) {
      const v = validateHornData(o);
      if (v.ok && v.value) out.push({ ...v.value, id: String(o.id ?? Math.random()), savedAt: Number(o.savedAt) || Date.now() });
    }
    return out;
  } catch {
    return [];
  }
}

function write(list: SavedHorn[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, 40)));
  } catch {
    /* 容量超過などは無視 */
  }
}

export const hornStore = {
  list: read,
  save(h: HornData): SavedHorn {
    const list = read();
    const item: SavedHorn = { ...h, id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, savedAt: Date.now() };
    list.unshift(item);
    write(list);
    return item;
  },
  remove(id: string) {
    write(read().filter((h) => h.id !== id));
  },
};

export function loadNickname(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveNickname(n: string) {
  try {
    localStorage.setItem(NAME_KEY, n);
  } catch {
    /* ignore */
  }
}

export function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

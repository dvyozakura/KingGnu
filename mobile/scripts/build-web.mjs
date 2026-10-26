/** Web 版のコードをアプリ用にビルドして mobile/www に出力する（Windows / Mac / Linux 共通） */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const client = fileURLToPath(new URL('../../client', import.meta.url));
const r = spawnSync('npx', ['vite', 'build'], {
  cwd: client,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, VITE_NATIVE: '1', VITE_BASE: './' },
});
process.exit(r.status ?? 1);

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages: https://<user>.github.io/kinggnu/ で配信するため本番ビルドは /kinggnu/ をベースにする。
// 独自ドメイン等で配信する場合は VITE_BASE=/ を指定してビルドする。
export default defineConfig(({ command }) => ({
  base: command === 'build' ? process.env.VITE_BASE ?? '/kinggnu/' : '/',
  plugins: [react()],
  server: { port: 5173, host: true },
  build: { target: 'es2020', sourcemap: false },
}));

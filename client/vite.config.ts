import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// GitHub Pages: https://<user>.github.io/<repo>/ で配信するため本番ビルドは /<repo>/ をベースにする（VITE_BASE）。
// アプリ版（Capacitor）は VITE_NATIVE=1 VITE_BASE=./ でビルドし、課金・広告・サインインの実装を mobile/ から読み込む。
const native = process.env.VITE_NATIVE === '1';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? process.env.VITE_BASE ?? '/kinggnu/' : '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@native-bridge': fileURLToPath(new URL(native ? '../mobile/src/native.ts' : './src/native/web.ts', import.meta.url)),
    },
  },
  server: { port: 5173, host: true },
  build: { target: 'es2020', sourcemap: false, outDir: native ? '../mobile/www' : 'dist', emptyOutDir: true },
}));

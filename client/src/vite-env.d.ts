/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** オンライン対戦サーバーの WebSocket URL（例: wss://kinggnu.yein.jp）。末尾の /ws は自動で補う */
  readonly VITE_SERVER_URL?: string;
  readonly VITE_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

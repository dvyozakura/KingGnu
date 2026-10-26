/** Web 版：アプリ固有の機能は無し（課金・広告・Apple/Google サインインはアプリ版のみ） */
import type { NativeBridge } from './types';

const unsupported = () => Promise.reject(new Error('アプリ版でのみ利用できます'));

const bridge: NativeBridge = {
  platform: 'web',
  init: async () => undefined,
  signIn: unsupported,
  setUser: async () => undefined,
  purchase: unsupported,
  restore: unsupported,
  prices: async () => ({}),
  showInterstitial: async () => undefined,
};

export default bridge;

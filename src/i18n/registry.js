import chinese from './locales/zh-CN/index.js';
import english from './locales/en/index.js';

// Add a complete language pack here. Views discover the menu from this registry.
// Future packs can use load: () => import('./locales/ja/index.js').
export const LANGUAGES = Object.freeze([
  { code: 'zh-CN', label: '中文', dir: 'ltr', messages: chinese },
  { code: 'en', label: 'EN', dir: 'ltr', messages: english },
]);

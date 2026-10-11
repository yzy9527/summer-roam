import { createTranslator } from './core.js';
import { LANGUAGES } from './registry.js';

export function createI18n({ languages = LANGUAGES, initialLocale = 'zh-CN' } = {}) {
  const fallbackLanguage = languages.find((language) => language.code === 'zh-CN') ?? languages[0];
  if (!fallbackLanguage?.messages) throw new Error('A bundled fallback language is required');
  const packs = new Map(languages.filter((l) => l.messages).map((l) => [l.code, l.messages]));
  const pending = new Map();
  const listeners = new Set();
  let current =
    languages.find((l) => l.code === initialLocale && packs.has(l.code)) ?? fallbackLanguage;
  let translator = createTranslator(
    packs.get(current.code),
    current.code,
    fallbackLanguage.messages,
  );
  let revision = 0;
  const api = {
    languages,
    getLocale: () => current.code,
    getLanguage: () => current,
    t: (code, params) => translator.t(code, params),
    format: (value) => translator.format(value),
    number: (value, options) => translator.number(value, options),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async setLocale(code) {
      const request = ++revision;
      const language = languages.find((l) => l.code === code) ?? fallbackLanguage;
      if (!packs.has(language.code)) {
        if (!pending.has(language.code)) {
          const loading = Promise.resolve()
            .then(language.load)
            .then((pack) => {
              const messages = pack.default ?? pack;
              packs.set(language.code, messages);
              return messages;
            })
            .finally(() => pending.delete(language.code));
          pending.set(language.code, loading);
        }
        await pending.get(language.code);
      }
      if (request !== revision) return false;
      if (current.code === language.code) return true;
      current = language;
      translator = createTranslator(
        packs.get(current.code),
        current.code,
        fallbackLanguage.messages,
      );
      for (const listener of listeners) listener(current);
      return true;
    },
  };
  // Bundled languages are immediate. A remembered lazy language starts loading
  // before the first frame; failure keeps the bundled fallback and can retry.
  api.ready = api.setLocale(initialLocale).catch(() => false);
  return api;
}

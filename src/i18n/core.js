const tokens = /\{([a-zA-Z][a-zA-Z0-9]*)\}/g;

// Pure formatting: no application state, storage, scene or DOM dependencies.
export function createTranslator(messages, locale, fallback = {}) {
  const numbers = new Map();
  const plurals = new Intl.PluralRules(locale);
  function number(value, options = {}) {
    const key = JSON.stringify(options);
    if (!numbers.has(key)) numbers.set(key, new Intl.NumberFormat(locale, options));
    return numbers.get(key).format(value);
  }
  function t(code, params = {}) {
    let template = messages[code] ?? fallback[code];
    if (template == null) throw new Error(`Unknown message: ${code}`);
    if (typeof template === 'object')
      template = template[plurals.select(params.count)] ?? template.other;
    return template.replace(tokens, (_, name) => {
      if (!Object.hasOwn(params, name)) throw new Error(`Missing ${name} for ${code}`);
      const value = params[name];
      return value?.code
        ? format(value)
        : typeof value === 'number'
          ? number(value)
          : String(value);
    });
  }
  function format(value) {
    return value?.code ? t(value.code, value.params) : String(value ?? '');
  }
  return { t, format, number };
}

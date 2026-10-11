export const LANGUAGE_STORAGE_KEY = 'field-language';

export function readLanguagePreference(storage) {
  try {
    storage ??= globalThis.localStorage;
    return storage?.getItem(LANGUAGE_STORAGE_KEY) ?? 'zh-CN';
  } catch {
    return 'zh-CN';
  }
}

// DOM and persistence live at the application boundary, outside the formatter.
export function bindLanguageSettings({ doc, i18n, storage }) {
  try {
    storage ??= globalThis.localStorage;
  } catch {
    /* Storage access may be disabled. */
  }
  const host = doc.getElementById('language-controls');
  const bindings = new Map();
  const controls = [];
  const setText = (element, description) => {
    bindings.set(element, description);
    element.textContent = i18n.format(description);
  };
  const choose = async (code) => {
    try {
      if (!(await i18n.setLocale(code))) return;
      try {
        storage?.setItem(LANGUAGE_STORAGE_KEY, i18n.getLocale());
      } catch {
        /* Preferences are optional when storage is unavailable. */
      }
    } catch {
      paint(); // Failed language downloads leave the current page and game intact.
    }
  };
  if (i18n.languages.length <= 2) {
    for (const language of i18n.languages) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.lang = language.code;
      button.textContent = language.label;
      button.dataset.locale = language.code;
      button.addEventListener('click', () => void choose(language.code));
      controls.push(button);
      host.append(button);
    }
  } else {
    const select = doc.createElement('select');
    select.id = 'language-select';
    for (const language of i18n.languages) {
      const option = doc.createElement('option');
      option.value = language.code;
      option.lang = language.code;
      option.textContent = language.label;
      select.append(option);
    }
    select.addEventListener('change', () => void choose(select.value));
    controls.push(select);
    host.append(select);
  }
  function paint() {
    const language = i18n.getLanguage();
    doc.documentElement.lang = language.code;
    doc.documentElement.dir = language.dir;
    doc.title = i18n.t('common.title');
    doc
      .querySelector('meta[name="description"]')
      ?.setAttribute('content', i18n.t('common.description'));
    host.setAttribute('aria-label', i18n.t('common.language'));
    for (const node of doc.querySelectorAll('[data-i18n]'))
      node.textContent = i18n.t(node.dataset.i18n);
    for (const attribute of ['title', 'aria-label'])
      for (const node of doc.querySelectorAll(`[data-i18n-${attribute}]`))
        node.setAttribute(attribute, i18n.t(node.getAttribute(`data-i18n-${attribute}`)));
    for (const [node, description] of bindings) node.textContent = i18n.format(description);
    for (const control of controls) {
      if (control.tagName === 'SELECT') {
        control.value = language.code;
        control.setAttribute('aria-label', i18n.t('common.language'));
      } else control.setAttribute('aria-pressed', String(control.dataset.locale === language.code));
    }
  }
  const unsubscribe = i18n.subscribe(paint);
  paint();
  return { setText, dispose: unsubscribe };
}

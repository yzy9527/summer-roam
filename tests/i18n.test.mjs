import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createI18n } from '../src/i18n/index.js';
import { createTranslator } from '../src/i18n/core.js';
import { LANGUAGES } from '../src/i18n/registry.js';
import { MESSAGE_SCHEMA } from '../src/i18n/schema.js';
import { validateMessages } from '../src/i18n/validate.js';
import { message } from '../src/messages.js';
import { bindLanguageSettings, readLanguagePreference } from '../src/app/language-settings.js';
import { createActionMenu } from '../src/action-menu.js';
import { createSceneActions } from '../src/scene-actions.js';
import { uiDocument } from './helpers/ui-document.mjs';

test('every released language has every message and the same parameter contracts', async () => {
  for (const language of LANGUAGES) {
    const pack = language.messages ?? (await language.load());
    assert.deepEqual(validateMessages(pack.default ?? pack, MESSAGE_SCHEMA, language.code), []);
  }
  for (const [key, value] of Object.entries(
    LANGUAGES.find((language) => language.code === 'en').messages,
  ))
    assert.doesNotMatch(JSON.stringify(value), /\p{Script=Han}/u, key);
  const incomplete = { ...LANGUAGES[0].messages, 'common.brand': '' };
  delete incomplete['tasks.milkCooldown'];
  incomplete['tasks.remaining'] = 'Still {minutes}';
  const errors = validateMessages(incomplete, MESSAGE_SCHEMA, 'zh-CN');
  assert(errors.includes('Empty message: common.brand'));
  assert(errors.includes('Missing message: tasks.milkCooldown'));
  assert(errors.includes('Parameter mismatch: tasks.remaining'));
});

test('all literal UI message references resolve to a declared key', () => {
  function inspect(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'i18n' && entry.name !== 'assets') inspect(path);
      } else if (path.endsWith('.js') || path.endsWith('.html')) {
        const source = readFileSync(path, 'utf8');
        for (const match of source.matchAll(
          /(?:\b(?:message|t)\(\s*['"]|data-i18n(?:-title|-aria-label)?=")([\w.-]+)['"]/g,
        ))
          assert(Object.hasOwn(MESSAGE_SCHEMA, match[1]), `${path}: ${match[1]}`);
      }
    }
  }
  inspect(resolve(import.meta.dirname, '../src'));
});

test('nested task descriptions switch language without changing the underlying data', async () => {
  const i18n = createI18n();
  const status = message('tasks.ploughStatus', {
    blocked: message('tasks.blocked'),
    phase: message('tasks.paddyPloughing'),
    remaining: message('tasks.remaining', { seconds: 9 }),
  });
  const before = JSON.stringify(status);
  assert.match(i18n.format(status), /剩余 9 秒/);
  await i18n.setLocale('en');
  assert.equal(i18n.format(status), 'Path blocked; waiting · Ploughing · 9 s remaining');
  assert.equal(JSON.stringify(status), before);
  assert.equal(i18n.t('actions.leopard'), 'baola');
  assert.equal(i18n.t('actions.calf'), 'niulai');
  assert.throws(() => i18n.t('tasks.remaining'), /Missing seconds/);
});

test('formatter uses locale plural categories, parameter order and number formatting', () => {
  const translator = createTranslator(
    {
      count: { one: '{count} animal', other: '{count} animals' },
      order: '{second} then {first}',
    },
    'en',
  );
  assert.equal(translator.t('count', { count: 1 }), '1 animal');
  assert.equal(translator.t('count', { count: 0 }), '0 animals');
  assert.equal(translator.t('count', { count: 2000 }), '2,000 animals');
  assert.equal(translator.t('order', { first: 'A', second: 'B' }), 'B then A');
  assert.deepEqual(
    validateMessages({ count: { other: '{count} animals' } }, { count: ['count'] }, 'en'),
    ['Missing one for count'],
  );
});

test('a third registered language works through the same interface and menu', async () => {
  const languages = [
    ...LANGUAGES,
    {
      code: 'fr',
      label: 'Français',
      dir: 'ltr',
      messages: { ...LANGUAGES[0].messages, 'common.brand': 'Un été à la campagne' },
    },
  ];
  const i18n = createI18n({ languages });
  const doc = uiDocument();
  const host = doc.createElement('div');
  host.id = 'language-controls';
  const title = doc.createElement('strong');
  title.dataset.i18n = 'common.brand';
  const ui = bindLanguageSettings({ doc, i18n, storage: {} });
  const select = host.children[0];
  assert.equal(select.tagName, 'SELECT');
  assert.deepEqual(
    select.children.map((option) => option.value),
    ['zh-CN', 'en', 'fr'],
  );
  await i18n.setLocale('fr');
  assert.equal(title.textContent, 'Un été à la campagne');
  assert.equal(select.value, 'fr');
  assert.equal(doc.documentElement.lang, 'fr');
  ui.dispose();
});

test('lazy language loading is shared, latest selection wins, and failure can retry', async () => {
  let resolveLoad,
    attempts = 0;
  const languages = [
    ...LANGUAGES,
    {
      code: 'fr',
      label: 'Français',
      dir: 'ltr',
      load: () => {
        attempts++;
        return new Promise((resolve) => {
          resolveLoad = resolve;
        });
      },
    },
  ];
  const i18n = createI18n({ languages });
  const first = i18n.setLocale('fr'),
    second = i18n.setLocale('fr');
  await Promise.resolve();
  assert.equal(attempts, 1);
  await i18n.setLocale('en');
  resolveLoad({ ...LANGUAGES[0].messages });
  assert.equal(await first, false);
  assert.equal(await second, false);
  assert.equal(i18n.getLocale(), 'en');
  await i18n.setLocale('fr');
  assert.equal(attempts, 1);
  const failing = createI18n({
    languages: [
      ...LANGUAGES,
      {
        code: 'de',
        label: 'Deutsch',
        dir: 'ltr',
        load: () => {
          throw new Error('offline');
        },
      },
    ],
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(failing.setLocale('de'), /offline/);
    assert.equal(failing.getLocale(), 'zh-CN');
  }
});

test('a remembered lazy language restores after loading and respects a newer user choice', async () => {
  let complete;
  const languages = [
    ...LANGUAGES,
    {
      code: 'fr',
      label: 'Français',
      dir: 'ltr',
      load: () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    },
  ];
  const restored = createI18n({ languages, initialLocale: 'fr' });
  assert.equal(restored.getLocale(), 'zh-CN');
  await Promise.resolve();
  complete({ default: { ...LANGUAGES[0].messages, 'common.brand': 'Un été à la campagne' } });
  assert.equal(await restored.ready, true);
  assert.equal(restored.getLocale(), 'fr');
  const interrupted = createI18n({ languages, initialLocale: 'fr' });
  await Promise.resolve();
  await interrupted.setLocale('en');
  complete(LANGUAGES[0].messages);
  assert.equal(await interrupted.ready, false);
  assert.equal(interrupted.getLocale(), 'en');
});

test('language settings preserve dynamic descriptions, input state and optional storage', async () => {
  const i18n = createI18n();
  const doc = uiDocument();
  const host = doc.createElement('div');
  host.id = 'language-controls';
  const start = doc.createElement('button');
  start.dataset.i18n = 'common.loading';
  start.disabled = false;
  const slider = doc.createElement('input');
  slider.value = '12';
  const storage = {
    getItem() {
      throw new Error('denied');
    },
    setItem() {
      throw new Error('denied');
    },
  };
  assert.equal(readLanguagePreference(storage), 'zh-CN');
  const ui = bindLanguageSettings({ doc, i18n, storage });
  ui.setText(start, message('common.start'));
  slider.focus();
  await host.children[1].listeners.get('click')();
  await Promise.resolve();
  assert.equal(start.textContent, 'Start exploring');
  assert.equal(start.disabled, false);
  assert.equal(slider.value, '12');
  assert.equal(doc.activeElement, slider);
  assert.equal(host.children[1].getAttribute('aria-pressed'), 'true');
  await i18n.setLocale('unsupported');
  assert.equal(i18n.getLocale(), 'zh-CN');
  ui.dispose();
});

test('an open action menu updates target, reasons and labels without changing slots or task state', async () => {
  const doc = uiDocument(),
    host = doc.createElement('main');
  const i18n = createI18n();
  const state = { phase: 'feeding', taps: 0 };
  const menu = createActionMenu({
    host,
    i18n,
    onOpen() {},
    onResult() {},
    execute() {
      state.taps++;
      return { ok: true, message: '' };
    },
    actions: () => [
      { id: 'tap', label: message('actions.tap'), reason: message('reason.drinking') },
      { id: 'milk', label: message('actions.cancelMilk') },
    ],
    status: () => message('reason.drinking'),
  });
  const target = {
    type: 'animal',
    name: message('actions.leopard'),
    animal: { id: 'baola-leopard' },
  };
  menu.show(target, { clientX: 400, clientY: 300 });
  const focused = host.querySelector('[data-action="milk"]');
  focused.focus();
  await i18n.setLocale('en');
  assert.equal(state.phase, 'feeding');
  assert.equal(state.taps, 0);
  const milk = host.querySelector('[data-action="milk"]');
  assert.equal(milk.dataset.slot, '7');
  assert.equal(doc.activeElement, milk);
  assert.match(milk.textContent, /Cancel milk/);
  const tap = host.querySelector('[data-action="tap"]');
  assert.equal(tap.dataset.slot, '1');
  assert.equal(tap.getAttribute('aria-disabled'), 'true');
  assert.match(tap.getAttribute('aria-label'), /niulai is drinking milk/);
  assert.match(host.textContent, /baola/);
  assert.doesNotMatch(host.textContent, /Selected object/);
  menu.dispose();
});

test('giant carry style checks reason codes regardless of translated wording', async () => {
  let busy = true;
  const task = {
    manualAvailability: () =>
      busy ? message('reason.giantBusy') : message('reason.heistCooldown'),
    snapshot: () => ({ phase: 'waiting', carryMode: 'underarm' }),
  };
  const actions = createSceneActions({
    getField: () => ({ animals: { animal: () => ({}) }, calfHeist: task }),
    getCar: () => ({}),
  });
  const target = { type: 'actor', id: 'pvz-gargantuar' };
  const i18n = createI18n({ initialLocale: 'en' });
  assert.equal(
    actions.actions(target).find((action) => action.id === 'carry-mode').reason.code,
    'reason.carryBeforeTask',
  );
  assert.match(i18n.format(task.manualAvailability()), /Giant Zombie/);
  busy = false;
  assert.equal(actions.actions(target).find((action) => action.id === 'carry-mode').reason, '');
});

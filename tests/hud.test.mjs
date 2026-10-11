import test from 'node:test';
import assert from 'node:assert/strict';
import { bindGameHud } from '../src/app/hud.js';
import { createI18n } from '../src/i18n/index.js';
import { uiDocument } from './helpers/ui-document.mjs';

function fixture(t, saved = {}, storageOverride) {
  const doc = uiDocument();
  const node = (id, tag = 'button', parent) => {
    const element = doc.createElement(tag);
    element.id = id;
    element.tabIndex = 0;
    parent?.append(element);
    return element;
  };
  node('game', 'main');
  const panel = node('pause-panel', 'section');
  node('pause-settings-tab', 'button', panel);
  node('pause-help-tab', 'button', panel);
  const settings = node('pause-settings', 'div', panel);
  const help = node('pause-help', 'div', panel);
  node('show-hints', 'input', settings);
  node('show-compass', 'input', settings);
  node('help-link', 'a', help);
  node('resume', 'button', panel);
  node('reset-pause', 'button', panel);
  for (const id of [
    'help-open',
    'intro-help',
    'intro-settings',
    'hint-dismiss',
    'pause',
    'time-toggle',
  ])
    node(id);
  node('compass', 'div');
  node('hud-hint', 'div');
  node('hud-hint-text', 'span');
  const lights = node('light-cluster', 'div');
  node('light-menu-toggle', 'button', lights);
  const options = node('vehicle-light-controls', 'div', lights);
  options.hidden = true;
  for (const id of ['off', 'low', 'high']) node('light-' + id, 'button', options);
  let mode = 'intro',
    time = 'day',
    writes = 0,
    unlocks = 0;
  const storage = storageOverride ?? {
    getItem: () => JSON.stringify(saved),
    setItem: () => writes++,
  };
  const i18n = createI18n();
  const $ = (id) => doc.getElementById(id);
  let hud;
  const setMode = (next) => {
    mode = next;
    hud?.modeChanged();
  };
  hud = bindGameHud({
    doc,
    i18n,
    getMode: () => mode,
    setMode,
    getTimeOfDay: () => time,
    storage,
    onResume: () => unlocks++,
  });
  t.after(() => hud.dispose());
  const click = (id) => {
    $(id).focus();
    $(id).listeners.get('click')();
  };
  const key = (key, shiftKey = false) => {
    const event = {
      key,
      shiftKey,
      prevented: false,
      stopped: false,
      preventDefault() {
        this.prevented = true;
      },
      stopPropagation() {
        this.stopped = true;
      },
    };
    doc.listeners.get('keydown')(event);
    return event;
  };
  return {
    doc,
    $,
    hud,
    i18n,
    click,
    key,
    setMode,
    setTime(next) {
      time = next;
      hud.refreshTime();
    },
    get mode() {
      return mode;
    },
    get writes() {
      return writes;
    },
    get unlocks() {
      return unlocks;
    },
  };
}

test('help during loading returns to the intro; play help resumes the same mode and focus', (t) => {
  const f = fixture(t);
  f.click('intro-help');
  assert.equal(f.mode, 'paused');
  assert.equal(f.$('pause-help').hidden, false);
  assert.equal(f.$('resume').textContent, '返回');
  assert.equal(f.$('reset-pause').hidden, true);
  f.click('resume');
  assert.equal(f.mode, 'intro');
  assert.equal(f.doc.activeElement, f.$('intro-help'));
  assert.equal(f.unlocks, 0);
  f.setMode('playing');
  f.click('help-open');
  f.click('resume');
  assert.equal(f.mode, 'playing');
  assert.equal(f.doc.activeElement, f.$('help-open'));
  assert.equal(f.unlocks, 1);
});

test('tutorial progress persists once per lesson, stays quiet on repeated events, and is recoverable', (t) => {
  const f = fixture(t);
  f.hud.activity('drive');
  assert.equal(f.writes, 0);
  f.setMode('playing');
  assert.match(f.$('hud-hint-text').textContent, /WASD/);
  f.hud.activity('drive');
  assert.match(f.$('hud-hint-text').textContent, /右键/);
  for (let i = 0; i < 10000; i++) f.hud.activity('drive');
  assert.equal(f.writes, 1);
  f.hud.activity('camera');
  f.hud.activity('actions');
  assert.equal(f.$('hud-hint').hidden, true);
  f.$('show-hints').checked = true;
  f.$('show-hints').listeners.get('change')();
  assert.equal(f.$('hud-hint').hidden, false);
  f.click('hint-dismiss');
  assert.equal(f.$('show-hints').checked, false);
  assert.equal(f.$('hud-hint').hidden, true);
});

test('language changes preserve help selection, focus, preferences and time control meaning', async (t) => {
  const f = fixture(t, { learned: ['drive', 'camera', 'actions'], compass: true });
  f.setMode('playing');
  assert.equal(f.$('hud-hint').hidden, true);
  assert.equal(f.hud.showCompass, true);
  f.click('help-open');
  f.setTime('night');
  await f.i18n.setLocale('en');
  assert.equal(f.$('pause-help').hidden, false);
  assert.equal(f.doc.activeElement, f.$('pause-help-tab'));
  assert.equal(f.$('time-toggle').textContent, '☾ Night');
  assert.equal(f.$('time-toggle').getAttribute('aria-label'), 'Switch to day');
  assert.equal(f.$('show-compass').checked, true);
  assert.equal(f.mode, 'paused');
  f.click('pause');
  assert.equal(f.mode, 'playing');
});

test('focus is contained in visible modal controls and Escape first closes the light popup', (t) => {
  const f = fixture(
    t,
    {},
    {
      getItem() {
        throw new Error('denied');
      },
      setItem() {
        throw new Error('denied');
      },
    },
  );
  f.setMode('playing');
  f.click('light-menu-toggle');
  assert.equal(f.$('vehicle-light-controls').hidden, false);
  assert.equal(f.$('light-menu-toggle').getAttribute('aria-expanded'), 'true');
  const escaped = f.key('Escape');
  assert.equal(escaped.stopped, true);
  assert.equal(f.mode, 'playing');
  assert.equal(f.$('vehicle-light-controls').hidden, true);
  f.click('help-open');
  f.$('reset-pause').focus();
  assert.equal(f.key('Tab').prevented, true);
  assert.equal(f.doc.activeElement, f.$('pause-help-tab'));
  f.$('pause-help-tab').focus();
  f.key('Tab', true);
  assert.equal(f.doc.activeElement, f.$('reset-pause'));
  const errorPanel = f.doc.createElement('section');
  errorPanel.id = 'error-panel';
  errorPanel.classList = { contains: () => false };
  assert.equal(f.key('Tab').prevented, false, 'load errors must not trap focus behind the alert');
  f.hud.dispose();
  assert.equal(f.doc.listeners.size, 0);
});

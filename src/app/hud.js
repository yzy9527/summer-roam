const STORAGE_KEY = 'field-hud';
const LESSONS = ['drive', 'camera', 'actions'];

// Event-driven presentation only. The game remains the owner of its mode,
// vehicle, camera, audio and tasks; this module never runs in the frame loop.
export function bindGameHud({ doc, i18n, getMode, setMode, getTimeOfDay, onResume, storage }) {
  const $ = (id) => doc.getElementById(id);
  try {
    storage ??= globalThis.localStorage;
  } catch {
    /* Optional preferences must not prevent playing. */
  }
  let saved = {};
  try {
    saved = JSON.parse(storage?.getItem(STORAGE_KEY) || '{}') ?? {};
  } catch {
    /* Ignore unavailable or invalid storage. */
  }
  const learned = new Set(
    Array.isArray(saved.learned) ? saved.learned.filter((id) => LESSONS.includes(id)) : [],
  );
  let always = saved.always === true,
    compass = saved.compass === true,
    section = 'settings',
    previousMode = getMode(),
    returnMode = 'playing',
    returnFocus = null;
  const listeners = [];
  const listen = (node, type, callback) => {
    node.addEventListener(type, callback);
    listeners.push(() => node.removeEventListener(type, callback));
  };
  function save() {
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify({ learned: [...learned], always, compass }));
    } catch {
      /* In-memory settings remain usable. */
    }
  }
  function paintHint() {
    const lesson = LESSONS.find((id) => !learned.has(id));
    $('hud-hint').hidden = getMode() !== 'playing' || (!always && !lesson);
    $('hud-hint-text').textContent = i18n.t(
      always ? 'common.hintAlways' : `common.hint${lesson ?? 'drive'}`,
    );
    $('show-hints').checked = always;
  }
  function selectSection(next, focus = false) {
    section = next;
    for (const id of ['settings', 'help']) {
      const selected = id === section;
      $('pause-' + id).hidden = !selected;
      const tab = $('pause-' + id + '-tab');
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }
    if (focus) $('pause-' + section + '-tab').focus();
  }
  function paint() {
    paintHint();
    $('show-compass').checked = compass;
    $('compass').hidden = !compass;
    const time = getTimeOfDay();
    $('time-toggle').textContent = i18n.t(time === 'night' ? 'common.night' : 'common.day');
    const next = i18n.t(time === 'night' ? 'common.switchDay' : 'common.switchNight');
    $('time-toggle').setAttribute('aria-label', next);
    $('time-toggle').setAttribute('title', next);
    $('resume').textContent = i18n.t(returnMode === 'intro' ? 'common.back' : 'common.explore');
  }
  function closeLights(restore = false) {
    if ($('vehicle-light-controls').hidden) return;
    $('vehicle-light-controls').hidden = true;
    $('light-menu-toggle').setAttribute('aria-expanded', 'false');
    if (restore) $('light-menu-toggle').focus();
  }
  function open(next) {
    if (getMode() !== 'paused') setMode('paused');
    selectSection(next);
    $('pause-' + section + '-tab').focus();
  }
  function modeChanged() {
    const mode = getMode();
    if (mode === 'paused' && previousMode !== 'paused') {
      returnMode = previousMode;
      returnFocus = doc.activeElement;
      // The normal pause button opens settings; a help button can select help
      // immediately after the same mode transition.
      selectSection('settings');
      $('resume').focus();
    } else if (previousMode === 'paused' && mode !== 'paused') {
      returnFocus?.focus?.({ preventScroll: true });
    }
    previousMode = mode;
    $('game').dataset.mode = mode;
    $('reset-pause').hidden = returnMode === 'intro';
    closeLights();
    paint();
  }
  function resume() {
    if (returnMode === 'playing') onResume?.();
    setMode(returnMode);
  }
  // Only the first meaningful use of each control writes preferences or UI.
  function activity(lesson) {
    if (getMode() !== 'playing' || learned.has(lesson) || !LESSONS.includes(lesson)) return;
    learned.add(lesson);
    save();
    paintHint();
  }
  for (const id of ['help-open', 'intro-help']) listen($(id), 'click', () => open('help'));
  listen($('intro-settings'), 'click', () => open('settings'));
  listen($('resume'), 'click', resume);
  listen($('pause'), 'click', () => (getMode() === 'paused' ? resume() : setMode('paused')));
  for (const id of ['settings', 'help']) {
    const tab = $('pause-' + id + '-tab');
    listen(tab, 'click', () => selectSection(id));
    listen(tab, 'keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      selectSection(
        event.key === 'Home'
          ? 'settings'
          : event.key === 'End'
            ? 'help'
            : id === 'help'
              ? 'settings'
              : 'help',
        true,
      );
    });
  }
  listen($('show-hints'), 'change', () => {
    always = $('show-hints').checked;
    save();
    paintHint();
  });
  listen($('show-compass'), 'change', () => {
    compass = $('show-compass').checked;
    save();
    $('compass').hidden = !compass;
  });
  listen($('hint-dismiss'), 'click', () => {
    always = false;
    for (const id of LESSONS) learned.add(id);
    save();
    paintHint();
  });
  listen($('light-menu-toggle'), 'click', () => {
    const open = $('vehicle-light-controls').hidden;
    $('vehicle-light-controls').hidden = !open;
    $('light-menu-toggle').setAttribute('aria-expanded', String(open));
    if (open) $('light-off').focus();
  });
  for (const id of ['off', 'low', 'high'])
    listen($('light-' + id), 'click', () => closeLights(true));
  listen(doc, 'pointerdown', (event) => {
    if (!$('light-cluster').contains(event.target)) closeLights();
  });
  listen(doc, 'keydown', (event) => {
    const errorPanel = $('error-panel');
    if (errorPanel && !errorPanel.classList.contains('hidden')) return;
    if (event.key === 'Escape' && !$('vehicle-light-controls').hidden) {
      event.preventDefault();
      event.stopPropagation();
      closeLights(true);
      return;
    }
    if (getMode() !== 'paused' || event.key !== 'Tab') return;
    const controls = [
      ...$('pause-panel').querySelectorAll('button, input, select, a[href]'),
    ].filter((node) => !node.disabled && node.tabIndex !== -1 && node.getClientRects().length);
    const first = controls[0],
      last = controls.at(-1);
    if (
      event.shiftKey &&
      (doc.activeElement === first || !$('pause-panel').contains(doc.activeElement))
    ) {
      event.preventDefault();
      last?.focus();
    } else if (
      !event.shiftKey &&
      (doc.activeElement === last || !$('pause-panel').contains(doc.activeElement))
    ) {
      event.preventDefault();
      first?.focus();
    }
  });
  const unsubscribe = i18n.subscribe(paint);
  selectSection('settings');
  modeChanged();
  return {
    activity,
    modeChanged,
    resume,
    refreshTime: paint,
    closeLights,
    get showCompass() {
      return compass;
    },
    dispose() {
      unsubscribe();
      for (const remove of listeners) remove();
    },
  };
}

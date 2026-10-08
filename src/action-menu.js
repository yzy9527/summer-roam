const ANIMAL_SLOTS = { tap: 1, call: 2, graze: 3, turn: 4, rest: 5, wake: 5, mountain: 6, tree: 6 };
const SHORT_LABELS = {
  'start-plough': '开始耕田',
  'stop-plough': '结束耕田',
  tap: '拍一拍',
  call: '叫一声',
  graze: '吃草',
  turn: '转身',
  rest: '休息',
  wake: '起身',
  'hold-calf': '抱起小牛',
  'put-down': '放下小牛',
  'recapture-calf': '追回小牛',
  'carry-mode': '切换抱法',
  'capture-calf': '出车抓牛',
  'cancel-heist': '取消任务',
  'cancel-rescue': '取消追回',
  'open-gate': '开门',
  'close-gate': '关门',
  'guard-close': '请关门',
  'ring-bell': '摇铃铛',
  'calf-alarm': '离群警报',
  camera: '视角复位',
  'light-off': '关闭车灯',
  'light-low': '近光灯',
  'light-high': '远光灯',
  'reset-car': '回到起点',
};
const ICONS = {
  tap: 'M8 13V5a2 2 0 0 1 4 0v6-7a2 2 0 0 1 4 0v8-5a2 2 0 0 1 4 0v8c0 5-3 8-7 8h-1c-2 0-3-1-4-3l-4-6a2 2 0 0 1 3-2l2 2',
  call: 'M11 5 6 9H3v6h3l5 4z M15 8a6 6 0 0 1 0 8 M18 5a10 10 0 0 1 0 14',
  graze: 'M12 21v-9 M12 15C4 15 3 10 3 5c6 0 9 3 9 10 M12 12c0-6 3-9 9-9 0 6-3 9-9 9',
  turn: 'M20 9a8 8 0 1 0 0 7 M20 3v6h-6',
  rest: 'M20 15a9 9 0 1 1-11-12 7 7 0 0 0 11 12',
  wake: 'M12 3v2 M12 19v2 M3 12h2 M19 12h2 M5 5l2 2 M17 17l2 2 M19 5l-2 2 M7 17l-2 2 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  mountain: 'm2 20 8-15 5 9 3-5 4 11z M7 11l3 2 3-2',
  tree: 'm12 2-6 7h3l-5 6h5l-3 4h12l-3-4h5l-5-6h3z M12 19v3',
  'ring-bell': 'M9 4a3 3 0 0 1 6 0 M6 16c2-2 1-9 6-9s4 7 6 9H6z M10 20h4',
  'calf-alarm': 'm12 3 10 18H2z M12 9v5 M12 17h.01',
  hold: 'M3 10h4l3 4h4l3-4h4 M3 16h4l3 4h4l3-4h4 M8 4h8v6H8z',
  down: 'M12 3v12 M7 10l5 5 5-5 M4 18v3h16v-3',
  cart: 'M2 5h3l3 11h12l2-8H6 M10 21h.01 M18 21h.01',
  gate: 'M4 21V3h16v18 M8 21V7h8v14 M12 12h1',
  camera: 'M3 7h5l2-3h4l2 3h5v13H3z M16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  light: 'M15 5v14c-6 0-10-3-10-7s4-7 10-7 M18 6h4 M18 10h4 M18 14h4 M18 18h4',
  cancel: 'M6 6l12 12 M18 6 6 18',
};
function iconName(id) {
  if (id.startsWith('cancel')) return 'cancel';
  if (id.startsWith('light')) return 'light';
  return (
    {
      'hold-calf': 'hold',
      'put-down': 'down',
      'capture-calf': 'cart',
      'recapture-calf': 'turn',
      'carry-mode': 'hold',
      'open-gate': 'gate',
      'close-gate': 'gate',
      'guard-close': 'gate',
      'reset-car': 'turn',
    }[id] || id
  );
}
function createIcon(doc, id) {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICONS[iconName(id)] || ICONS.turn);
  svg.append(path);
  return svg;
}
export function createActionMenu({ host, actions, execute, status = () => '', onOpen, onResult }) {
  const doc = host.ownerDocument;
  const menu = doc.createElement('section');
  menu.className = 'action-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-label', '对象动作圈');
  menu.tabIndex = -1;
  host.append(menu);
  let target = null,
    previousFocus = null,
    timer = null,
    anchor = null,
    signature = '',
    slots = [];
  function close(restoreFocus = false) {
    if (menu.hidden) return;
    menu.hidden = true;
    target = null;
    slots = [];
    clearInterval(timer);
    timer = null;
    if (restoreFocus) previousFocus?.focus?.({ preventScroll: true });
  }
  function place() {
    const rect = host.getBoundingClientRect();
    const width = Math.min(rect.width, doc.defaultView.innerWidth - rect.left);
    const height = Math.min(rect.height, doc.defaultView.innerHeight - rect.top);
    const size = Math.max(180, Math.min(280, width - 16, height - 16));
    menu.style.setProperty('--action-size', size + 'px');
    const radius = size * 0.34;
    const count = target.type === 'animal' ? 6 : slots.length;
    for (const { slot, button } of slots) {
      const angle = ((-90 + ((slot - 1) * 360) / count) * Math.PI) / 180;
      button.style.left = `calc(50% + ${Math.cos(angle) * radius}px)`;
      button.style.top = `calc(50% + ${Math.sin(angle) * radius}px)`;
    }
    menu.style.left =
      Math.max(8, Math.min(anchor.x - rect.left - size / 2, width - size - 8)) + 'px';
    menu.style.top =
      Math.max(8, Math.min(anchor.y - rect.top - size / 2, height - menu.offsetHeight - 8)) + 'px';
  }
  function choose(id) {
    if (!target || menu.hidden) return;
    const result = execute(target, id);
    if (result.ok) close(true);
    else render();
    onResult(result.message);
  }
  function render() {
    const list = actions(target),
      current = status(target);
    if (!list.length) return close(true);
    const nextSignature = JSON.stringify([
      current,
      list.map(({ id, label, reason, detail }) => [id, label, reason, detail]),
    ]);
    if (nextSignature === signature) return;
    signature = nextSignature;
    const focused = doc.activeElement?.dataset.action;
    menu.replaceChildren();
    slots = [];
    const wheel = doc.createElement('div'),
      hub = doc.createElement('header'),
      title = doc.createElement('strong'),
      hint = doc.createElement('span'),
      dismiss = doc.createElement('button'),
      note = doc.createElement('p');
    wheel.className = 'action-menu-wheel';
    hub.className = 'action-menu-hub';
    title.textContent = target.name;
    hint.textContent = '当前对象';
    hint.className = 'action-menu-target';
    dismiss.type = 'button';
    dismiss.textContent = '取消 · Esc';
    dismiss.setAttribute('aria-label', '关闭动作圈');
    dismiss.onclick = () => close(true);
    hub.append(hint, title, dismiss);
    wheel.append(hub);
    note.className = 'action-menu-status';
    note.id = 'action-menu-status';
    note.setAttribute('role', 'status');
    const defaultNote = current;
    note.textContent = defaultNote;
    for (const [index, action] of list.entries()) {
      const slot = target.type === 'animal' ? (ANIMAL_SLOTS[action.id] ?? index + 1) : index + 1;
      const button = doc.createElement('button'),
        label = doc.createElement('span'),
        key = doc.createElement('kbd');
      button.type = 'button';
      button.className = 'action-menu-item';
      button.dataset.action = action.id;
      button.dataset.slot = String(slot);
      button.setAttribute('aria-disabled', String(!!action.reason));
      button.setAttribute(
        'aria-label',
        `${action.label}，快捷键 ${slot}${action.reason ? '，' + action.reason : ''}`,
      );
      button.setAttribute('aria-describedby', note.id);
      if (action.reason) button.setAttribute('title', action.reason);
      label.textContent = ['mountain', 'tree'].includes(action.id)
        ? action.label
        : action.id === 'tap' && target.animal?.id === 'reference-wolf'
          ? '触摸'
          : action.id === 'graze' && ['reference-wolf', 'baola-leopard'].includes(target.animal?.id)
            ? '嗅地'
            : SHORT_LABELS[action.id] || action.label;
      key.textContent = String(slot);
      button.append(createIcon(doc, action.id), label, key);
      const describe = () => {
        note.textContent = action.reason || action.detail || action.label;
      };
      button.addEventListener('pointerenter', describe);
      button.addEventListener('focus', describe);
      button.addEventListener('pointerleave', () => {
        note.textContent = defaultNote;
      });
      button.onclick = () => choose(action.id);
      wheel.append(button);
      slots.push({ slot, button, id: action.id });
    }
    menu.append(wheel, note);
    if (focused) menu.querySelector(`[data-action="${focused}"]`)?.focus({ preventScroll: true });
    place();
  }
  function handleKey(event) {
    if (
      menu.hidden ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.target.matches?.('input, textarea, select, [contenteditable="true"]')
    )
      return false;
    const digit =
      /^(?:Digit|Numpad)([1-9])$/.exec(event.code)?.[1] ||
      (/^[1-9]$/.test(event.key) ? event.key : null);
    const cancel = event.code === 'Escape' || event.key === 'Escape' || event.code === 'KeyE';
    if (!digit && !cancel) return false;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) {
      if (cancel) close(true);
      else {
        const action = slots.find(({ slot }) => String(slot) === digit);
        if (action) choose(action.id);
      }
    }
    return true;
  }
  doc.addEventListener(
    'pointerdown',
    (event) => {
      if (!menu.hidden && !menu.contains(event.target)) close();
    },
    true,
  );
  menu.addEventListener('contextmenu', (event) => event.preventDefault());
  menu.addEventListener('keydown', (event) => {
    if (handleKey(event)) return;
    if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      const items = slots.map(({ button }) => button),
        index = items.indexOf(doc.activeElement);
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? items.length - 1
            : index < 0
              ? ['ArrowUp', 'ArrowLeft'].includes(event.key)
                ? items.length - 1
                : 0
              : (index + (['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1) + items.length) %
                items.length;
      items[next]?.focus();
    }
  });
  doc.defaultView.addEventListener('resize', () => close());
  return {
    get open() {
      return !menu.hidden;
    },
    close,
    handleKey,
    show(selected, event) {
      close();
      if (!actions(selected).length) return;
      previousFocus = doc.activeElement;
      target = selected;
      signature = '';
      anchor = { x: event.clientX, y: event.clientY };
      onOpen();
      menu.hidden = false;
      render();
      menu.focus({ preventScroll: true });
      if (!menu.hidden) timer = setInterval(render, 400);
    },
  };
}

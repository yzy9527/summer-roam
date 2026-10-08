import test from 'node:test';
import assert from 'node:assert/strict';
import { createActionMenu } from '../src/action-menu.js';

function fixture(t) {
  class Element {
    constructor(tag, doc) {
      this.tagName = tag.toUpperCase();
      this.ownerDocument = doc;
      this.children = [];
      this.dataset = {};
      this.attributes = {};
      this.handlers = {};
      this.hidden = false;
      this.style = {
        setProperty(name, value) {
          this[name] = value;
        },
      };
      this.offsetHeight = 280;
    }
    setAttribute(name, value) {
      this.attributes[name] = value;
    }
    getAttribute(name) {
      return this.attributes[name];
    }
    append(...children) {
      this.children.push(...children);
    }
    replaceChildren() {
      this.children = [];
    }
    addEventListener(name, fn) {
      this.handlers[name] = fn;
    }
    contains(element) {
      return this === element || this.children.some((c) => c.contains(element));
    }
    focus() {
      this.ownerDocument.activeElement = this;
      this.handlers.focus?.({});
    }
    matches(selector) {
      if (selector.startsWith('.')) return this.className === selector.slice(1);
      const action = /^\[data-action="(.*)"\]$/.exec(selector);
      if (action) return this.dataset.action === action[1];
      return selector.toUpperCase() === this.tagName;
    }
    querySelectorAll(selector) {
      const parts = selector.split(' '),
        result = [];
      for (const child of this.children) {
        if (child.matches(parts[0])) {
          if (parts.length === 1) result.push(child);
          else result.push(...child.querySelectorAll(parts.slice(1).join(' ')));
        }
        result.push(...child.querySelectorAll(selector));
      }
      return result;
    }
    querySelector(selector) {
      return this.querySelectorAll(selector)[0];
    }
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 800, height: 600 };
    }
  }
  const handlers = {};
  const doc = {
    activeElement: null,
    defaultView: {
      innerWidth: 800,
      innerHeight: 600,
      addEventListener: (name, fn) => {
        handlers[name] = fn;
      },
    },
    createElement: (tag) => new Element(tag, doc),
    createElementNS: (_, tag) => new Element(tag, doc),
    addEventListener: (name, fn) => {
      handlers[name] = fn;
    },
  };
  const host = new Element('main', doc),
    canvas = new Element('canvas', doc);
  doc.activeElement = canvas;
  let opens = 0;
  const executed = [],
    messages = [];
  const animalActions = [
    { id: 'tap', label: '拍一拍' },
    { id: 'call', label: '叫一声' },
    { id: 'graze', label: '吃草' },
    { id: 'turn', label: '转身' },
    { id: 'rest', label: '休息', reason: '夜间才能休息' },
  ];
  const actions = (target) => (target?.type === 'animal' ? target.actions || animalActions : []);
  const menu = createActionMenu({
    host,
    actions,
    execute(target, id) {
      const action = actions(target).find((a) => a.id === id);
      if (!action || action.reason) return { ok: false, message: action?.reason || '目标已不可用' };
      executed.push({ target, id });
      return { ok: true, message: action.label };
    },
    onOpen: () => opens++,
    onResult: (message) => messages.push(message),
  });
  t.after(() => menu.close());
  const calf = { type: 'animal', name: '小牛', animal: { id: 'hornless-calf' } };
  const wolf = {
    type: 'animal',
    name: '狼',
    animal: { id: 'reference-wolf' },
    actions: [...animalActions, { id: 'mountain', label: '登山' }],
  };
  const element = host.children[0];
  const show = (target = calf) => menu.show(target, { clientX: 700, clientY: 500 });
  const key = (code, extra = {}) => {
    const event = {
      code,
      key: code === 'Escape' ? 'Escape' : '',
      target: doc.activeElement,
      preventDefault() {
        this.prevented = true;
      },
      stopPropagation() {
        this.stopped = true;
      },
      ...extra,
    };
    const consumed = menu.handleKey(event);
    return { ...event, consumed };
  };
  return {
    menu,
    element,
    host,
    doc,
    handlers,
    canvas,
    calf,
    wolf,
    animalActions,
    executed,
    messages,
    show,
    key,
    get opens() {
      return opens;
    },
  };
}

test('opening, switching and cancelling select an exact target without executing a touch', (t) => {
  const f = fixture(t);
  f.show();
  assert.equal(f.menu.open, true);
  assert.equal(f.executed.length, 0);
  assert.equal(f.element.querySelector('strong').textContent, '小牛');
  f.show(f.wolf);
  assert.equal(f.element.querySelector('strong').textContent, '狼');
  assert.equal(f.executed.length, 0);
  f.key('Escape');
  assert.equal(f.menu.open, false);
  assert.equal(f.executed.length, 0);
  assert.equal(f.key('Digit1').consumed, false);
});

test('shared numeric slots act on the selected animal and have the same position across species', (t) => {
  const f = fixture(t);
  f.show();
  const before = f.element.querySelector('[data-action="call"]');
  const position = [before.style.left, before.style.top];
  f.key('Digit1');
  assert.deepEqual(f.executed[0], { target: f.calf, id: 'tap' });
  assert.equal(f.menu.open, false);
  f.show(f.wolf);
  const after = f.element.querySelector('[data-action="call"]');
  assert.deepEqual([after.style.left, after.style.top], position);
  f.key('Numpad1');
  assert.deepEqual(f.executed[1], { target: f.wolf, id: 'tap' });
  f.show(f.wolf);
  f.key('Digit6');
  assert.equal(f.executed[2].id, 'mountain');
});

test('disabled and now-busy actions stay open and are checked at execution; modifiers/repeats do not trigger', (t) => {
  const f = fixture(t);
  f.show();
  f.key('Digit5');
  assert.equal(f.executed.length, 0);
  assert.equal(f.menu.open, true);
  assert.equal(f.messages[0], '夜间才能休息');
  assert.equal(f.key('Digit1', { ctrlKey: true }).consumed, false);
  f.key('Digit1', { repeat: true });
  assert.equal(f.executed.length, 0);
  f.animalActions[0].reason = '正在被抱着';
  f.key('Digit1');
  assert.equal(f.executed.length, 0);
  assert.equal(f.messages.at(-1), '正在被抱着');
  assert.equal(
    f.element.querySelector('[data-action="tap"]').getAttribute('aria-disabled'),
    'true',
  );
  f.key('KeyE');
  assert.equal(f.menu.open, false);
});

test('missing actions retain their numeric identity; outside canvas click is allowed to select another target', (t) => {
  const f = fixture(t);
  f.show({ ...f.calf, actions: [f.animalActions[1], { id: 'wake', label: '起身' }] });
  assert.equal(f.element.querySelector('[data-action="call"]').dataset.slot, '2');
  assert.equal(f.element.querySelector('[data-action="wake"]').dataset.slot, '5');
  f.key('Digit1');
  assert.equal(f.executed.length, 0);
  assert.equal(f.menu.open, true);
  let blocked = false;
  f.handlers.pointerdown({
    target: f.canvas,
    button: 0,
    stopPropagation() {
      blocked = true;
    },
    preventDefault() {
      blocked = true;
    },
  });
  assert.equal(f.menu.open, false);
  assert.equal(blocked, false);
  f.show(f.wolf);
  f.key('Digit2');
  assert.equal(f.executed.at(-1).target, f.wolf);
});

test('menu fits near edges, arrow navigation works, and resize/empty targets close without actions', (t) => {
  const f = fixture(t);
  f.show();
  assert.equal(f.element.style.left, '512px');
  assert.equal(f.element.style.top, '312px');
  f.element.handlers.keydown({
    key: 'Home',
    target: f.doc.activeElement,
    preventDefault() {},
    stopPropagation() {},
  });
  assert.equal(f.doc.activeElement.dataset.action, 'tap');
  f.handlers.resize();
  assert.equal(f.menu.open, false);
  f.menu.show({ type: 'world' }, { clientX: 20, clientY: 20 });
  assert.equal(f.menu.open, false);
  assert.equal(f.executed.length, 0);
});

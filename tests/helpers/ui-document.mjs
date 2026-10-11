// A small DOM contract fixture for UI state tests. Browser layout is verified
// separately against the actual game, not inferred from this fixture.
export function uiDocument() {
  const nodes = [];
  class Element {
    constructor(tag) {
      this.tagName = tag.toUpperCase();
      this.ownerDocument = doc;
      this.dataset = {};
      this.attributes = {};
      this.children = [];
      this.listeners = new Map();
      this.style = { setProperty() {} };
      this.hidden = false;
      this.text = '';
      this.offsetHeight = 340;
      nodes.push(this);
    }
    get textContent() {
      return this.text + this.children.map((child) => child.textContent).join('');
    }
    set textContent(value) {
      this.text = String(value);
      this.children = [];
    }
    setAttribute(key, value) {
      this.attributes[key] = String(value);
    }
    getAttribute(key) {
      return this.attributes[key] ?? null;
    }
    append(...children) {
      for (const child of children) {
        child.parent = this;
        this.children.push(child);
      }
    }
    replaceChildren(...children) {
      this.children = [];
      this.text = '';
      this.append(...children);
    }
    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }
    removeEventListener(type) {
      this.listeners.delete(type);
    }
    contains(target) {
      return this === target || this.children.some((child) => child.contains(target));
    }
    focus() {
      doc.activeElement = this;
    }
    remove() {
      if (this.parent)
        this.parent.children = this.parent.children.filter((child) => child !== this);
    }
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 1440, height: 900 };
    }
    getClientRects() {
      for (let node = this; node; node = node.parent) if (node.hidden) return [];
      return [this.getBoundingClientRect()];
    }
    querySelectorAll(selector) {
      const tags = selector.split(',').map((part) => part.trim().split('[')[0].toUpperCase());
      return nodes.filter((node) => this.contains(node) && tags.includes(node.tagName));
    }
    querySelector(selector) {
      const match = /\[data-action="([^"]+)"\]/.exec(selector);
      return nodes.find((node) => this.contains(node) && node.dataset.action === match?.[1]);
    }
  }
  const doc = {
    activeElement: null,
    documentElement: {},
    defaultView: {
      innerWidth: 1440,
      innerHeight: 900,
      addEventListener() {},
      removeEventListener() {},
    },
    createElement: (tag) => new Element(tag),
    createElementNS: (_, tag) => new Element(tag),
    getElementById: (id) => nodes.find((node) => node.id === id),
    listeners: new Map(),
    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    },
    removeEventListener(type) {
      this.listeners.delete(type);
    },
    querySelector(selector) {
      return selector.startsWith('meta') ? nodes.find((node) => node.tagName === 'META') : null;
    },
    querySelectorAll(selector) {
      const match = /^\[([^\]]+)\]$/.exec(selector);
      return nodes.filter(
        (node) =>
          match &&
          (node.getAttribute(match[1]) != null || (match[1] === 'data-i18n' && node.dataset.i18n)),
      );
    },
    nodes,
  };
  return doc;
}

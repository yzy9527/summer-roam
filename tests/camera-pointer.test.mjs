import test from 'node:test';
import assert from 'node:assert/strict';
import { bindCameraPointer } from '../src/camera-pointer.js';

function fixture() {
  const handlers = new Map(),
    captures = new Set();
  const canvas = {
    style: {},
    addEventListener: (name, fn) => handlers.set(name, fn),
    setPointerCapture: (id) => captures.add(id),
    hasPointerCapture: (id) => captures.has(id),
    releasePointerCapture: (id) => captures.delete(id),
  };
  const state = {
    playing: true,
    inspection: true,
    selections: 0,
    drag: null,
  };
  const inspectionMoves = [],
    orbitMoves = [];
  const input = bindCameraPointer(canvas, {
    isPlaying: () => state.playing,
    getInspection: () => ({
      active: state.inspection,
      rotate: (...move) => inspectionMoves.push(move),
    }),
    rotateOrbit: (...move) => orbitMoves.push(move),
    onSelect: () => state.selections++,
    onDrag: (drag) => {
      state.drag = drag;
    },
  });
  const send = (name, extra = {}) =>
    handlers.get(name)({ pointerId: 1, button: 2, clientX: 100, clientY: 100, ...extra });
  return { state, input, canvas, captures, send, inspectionMoves, orbitMoves };
}

test('right drag rotates the inspection; stationary right clicks never select or touch', () => {
  const f = fixture();
  f.send('pointerdown');
  f.send('pointermove', { clientX: 140, clientY: 125 });
  f.send('pointerup', { clientX: 140, clientY: 125 });
  assert.deepEqual(f.inspectionMoves, [[40, 25]]);
  assert.deepEqual(f.orbitMoves, []);
  assert.equal(f.state.selections, 0);
  assert.equal(f.state.drag, null);
  assert.equal(f.captures.size, 0);
  f.send('pointerdown');
  f.send('pointerup');
  assert.equal(f.state.selections, 0);
  let prevented = false;
  f.send('contextmenu', {
    preventDefault: () => {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
});

test('left click selects on release; small jitter never rotates either camera', () => {
  const f = fixture();
  for (const inspection of [false, true]) {
    f.state.inspection = inspection;
    f.send('pointerdown', { button: 0 });
    assert.equal(f.state.selections, inspection ? 1 : 0);
    f.send('pointermove', { button: -1, clientX: 103, clientY: 102 });
    f.send('pointerup', { button: 0, clientX: 103, clientY: 102 });
  }
  assert.equal(f.state.selections, 2);
  assert.deepEqual(f.inspectionMoves, []);
  assert.deepEqual(f.orbitMoves, []);
});

test('left drags cancel selection even after returning to the initial position and never rotate', () => {
  const f = fixture();
  for (const inspection of [false, true]) {
    f.state.inspection = inspection;
    for (const end of [100, 106, 160]) {
      f.send('pointerdown', { button: 0 });
      f.send('pointermove', { button: -1, clientX: 106 });
      f.send('pointermove', { button: -1, clientX: end });
      f.send('pointerup', { button: 0, clientX: end });
    }
  }
  assert.equal(f.state.selections, 0);
  assert.deepEqual(f.inspectionMoves, []);
  assert.deepEqual(f.orbitMoves, []);
});

test('right jitter does not rotate, and another pointer or wrong release cannot finish selection', () => {
  const f = fixture();
  f.send('pointerdown');
  f.send('pointermove', { clientX: 103, clientY: 102 });
  f.send('pointerup');
  assert.deepEqual(f.inspectionMoves, []);
  assert.equal(f.state.selections, 0);
  f.send('pointerdown', { button: 0 });
  f.send('pointermove', { pointerId: 2, clientX: 250 });
  f.send('pointerup', { pointerId: 2, button: 0 });
  f.send('pointerup', { button: 2 });
  assert(f.state.drag);
  f.send('pointerup', { button: 0 });
  assert.equal(f.state.selections, 1);
});

test('normal right drag rotates the orbit; pause, cancellation and button loss release capture without selection', () => {
  const f = fixture();
  f.state.inspection = false;
  f.send('pointerdown');
  f.send('pointermove', { clientX: 110 });
  f.send('pointerup', { clientX: 110 });
  assert.deepEqual(f.orbitMoves, [[10, 0]]);
  for (const type of ['pointercancel', 'lostpointercapture']) {
    f.send('pointerdown', { button: 0 });
    f.send(type);
    f.send('pointerup', { button: 0 });
  }
  f.send('pointerdown', { button: 0 });
  f.state.playing = false;
  f.send('pointermove', { clientX: 120 });
  assert.equal(f.state.drag, null);
  assert.equal(f.captures.size, 0);
  f.send('pointerdown', { button: 0 });
  assert.equal(f.state.drag, null);
  f.state.playing = true;
  f.send('pointerdown', { button: 0 });
  f.input.cancel();
  f.send('pointerup', { button: 0 });
  f.send('pointerdown');
  f.send('pointermove', { buttons: 1 });
  assert.equal(f.state.drag, null);
  f.send('pointerdown', { button: 0 });
  f.send('pointermove', { buttons: 2 });
  assert.equal(f.state.drag, null);
  assert.equal(f.state.selections, 0);
  assert.equal(f.captures.size, 0);
  f.send('pointerdown', { button: 1 });
  assert.equal(f.state.drag, null);
});

test('fixed cursor survives motion, camera dragging, clicks and pause without target queries', () => {
  const f = fixture();
  assert.equal(f.canvas.style.cursor, 'pointer');
  for (let i = 0; i < 600; i++)
    f.send('pointermove', { button: -1, clientX: 100 + i, timeStamp: i * 16.7 });
  assert.equal(f.canvas.style.cursor, 'pointer');
  assert.equal(f.state.selections, 0);
  f.send('pointerdown');
  f.send('pointermove', { clientX: 140, clientY: 125 });
  f.send('pointerup', { clientX: 140, clientY: 125 });
  assert.equal(f.canvas.style.cursor, 'pointer');
  assert.equal(f.state.selections, 0);
  assert.deepEqual(f.inspectionMoves, [[40, 25]]);
  f.send('pointerdown', { button: 0 });
  f.send('pointerup', { button: 0 });
  assert.equal(f.state.selections, 1);
  f.state.playing = false;
  f.input.cancel();
  f.send('pointerdown', { button: 0 });
  f.send('pointerup', { button: 0 });
  assert.equal(f.state.selections, 1);
  assert.equal(f.canvas.style.cursor, 'pointer');
});

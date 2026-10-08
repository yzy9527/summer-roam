import test from 'node:test';
import assert from 'node:assert/strict';
import { createLookoutBell } from '../src/lookout-bell.js';

test('lookout bell schedules two spatial strikes, rejects overlap and stops future sound without replay', () => {
  const nodes = [];
  const ctx = {
    currentTime: 10,
    createGain() {
      return {
        gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect() {
          return this;
        },
        disconnect() {},
      };
    },
    createOscillator() {
      const node = {
        frequency: {},
        starts: [],
        stops: [],
        connect() {
          return this;
        },
        start(t) {
          this.starts.push(t);
        },
        stop(t) {
          this.stops.push(t);
        },
        disconnect() {},
      };
      nodes.push(node);
      return node;
    },
  };
  const bell = createLookoutBell(ctx, {}),
    event = { x: 146, z: 23 };
  assert.equal(bell.play(event, { x: 0, z: 0 }), false);
  assert.equal(bell.play(event, event), true);
  assert.equal(nodes.length, 6);
  assert.deepEqual([...new Set(nodes.flatMap((n) => n.starts))], [10, 10.45]);
  assert.equal(bell.play(event, event), false);
  bell.stop();
  assert.equal(bell.snapshot().active, 0);
  assert(nodes.every((n) => n.stops.length === 2));
  assert.equal(bell.play(event, event), true);
  for (const node of nodes) node.onended();
  assert.equal(bell.snapshot().active, 0);
});

test('single game-time strikes share one ringing session, with no scheduled second strike', () => {
  const starts = [];
  const ctx = {
    currentTime: 2,
    createGain: () => ({
      gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
      connect() {
        return this;
      },
      disconnect() {},
    }),
    createOscillator: () => ({
      frequency: {},
      connect() {
        return this;
      },
      disconnect() {},
      stop() {},
      start(t) {
        starts.push(t);
      },
    }),
  };
  const bell = createLookoutBell(ctx, {});
  assert(bell.play({ x: 0, z: 0, single: true, ringId: 1 }, null));
  assert.deepEqual(starts, [2, 2, 2]);
  ctx.currentTime = 2.6;
  assert(bell.play({ x: 0, z: 0, single: true, ringId: 1 }, null));
  assert.deepEqual(starts, [2, 2, 2, 2.6, 2.6, 2.6]);
  assert.equal(bell.play({ x: 0, z: 0, single: true, ringId: 2 }, null), false);
  bell.stop();
  assert.equal(bell.snapshot().active, 0);
  assert.equal(bell.play({ x: 0, z: 0, single: true, ringId: 1 }, null), false);
  assert.equal(bell.play({ x: 0, z: 0, single: true, ringId: 2 }, null), true);
});

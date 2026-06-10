import { test } from 'node:test';
import assert from 'node:assert/strict';
import { balance } from '../src/balance.js';
import {
  EMPTY, DIRS, mulberry32, levelSeed, rampFor,
  pathClear, buildBoard, simulateWaves,
} from '../src/generator.js';

test('mulberry32 is deterministic per seed', () => {
  const a = mulberry32(42), b = mulberry32(42), c = mulberry32(43);
  const seqA = [a(), a(), a(), a(), a()];
  const seqB = [b(), b(), b(), b(), b()];
  const seqC = [c(), c(), c(), c(), c()];
  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, seqC);
  for (const v of seqA) assert.ok(v >= 0 && v < 1);
});

test('levelSeed differs across levels and candidates', () => {
  assert.notEqual(levelSeed(1, 0), levelSeed(2, 0));
  assert.notEqual(levelSeed(1, 0), levelSeed(1, 1));
});

test('rampFor returns the right bracket', () => {
  assert.deepEqual(rampFor(1, balance), { cols: 4, rows: 5, minArrows: 6, maxArrows: 10 });
  assert.deepEqual(rampFor(10, balance), { cols: 4, rows: 5, minArrows: 6, maxArrows: 10 });
  assert.deepEqual(rampFor(11, balance), { cols: 5, rows: 7, minArrows: 12, maxArrows: 18 });
  assert.deepEqual(rampFor(301, balance), { cols: 8, rows: 11, minArrows: 55, maxArrows: 70 });
});

test('pathClear sees blockers in the path only', () => {
  const cols = 3, rows = 3;
  const board = new Int8Array(cols * rows).fill(EMPTY);
  // center cell, empty board: all directions clear
  for (let dir = 0; dir < 4; dir++) assert.ok(pathClear(board, cols, rows, 1, 1, dir));
  board[0 * cols + 1] = 2; // blocker above center
  assert.equal(pathClear(board, cols, rows, 1, 1, 0), false); // up now blocked
  assert.equal(pathClear(board, cols, rows, 1, 1, 2), true);  // down still clear
});

test('buildBoard is deterministic and well-formed', () => {
  const { board: b1, count: c1 } = buildBoard(mulberry32(7), 5, 7, 15);
  const { board: b2, count: c2 } = buildBoard(mulberry32(7), 5, 7, 15);
  assert.deepEqual(Array.from(b1), Array.from(b2));
  assert.equal(c1, c2);
  assert.ok(c1 > 0 && c1 <= 15);
  let placed = 0;
  for (const v of b1) {
    assert.ok(v === EMPTY || (v >= 0 && v <= 3));
    if (v !== EMPTY) placed++;
  }
  assert.equal(placed, c1);
});

test('every built board is solvable by wave removal', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const { board, count } = buildBoard(mulberry32(seed), 8, 11, 70);
    const { cleared } = simulateWaves(board, 8, 11);
    assert.ok(cleared, `seed ${seed} (count ${count}) did not clear`);
  }
});

test('simulateWaves counts waves and detects the dense-chain shape', () => {
  // 1×4 row, all pointing left: only the leftmost is ever free → 4 waves
  const cols = 4, rows = 1;
  const chain = new Int8Array([3, 3, 3, 3]);
  const r = simulateWaves(chain, cols, rows);
  assert.equal(r.cleared, true);
  assert.equal(r.waves, 4);
  // simulateWaves must not mutate its input
  assert.deepEqual(Array.from(chain), [3, 3, 3, 3]);
});

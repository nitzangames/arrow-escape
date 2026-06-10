import { test } from 'node:test';
import assert from 'node:assert/strict';
import { balance } from '../src/balance.js';
import {
  EMPTY, DIRS, mulberry32, levelSeed, rampFor,
  pathClear, buildBoard, simulateWaves,
  scoreBoard, targetDifficulty, isBreather, pickCandidate, generateLevel,
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

test('scoreBoard ranks a forced chain above a free spread', () => {
  // chain: 1×4 all pointing left → waves 4, only 1 of 4 free
  const chain = new Int8Array([3, 3, 3, 3]);
  // spread: 4×4 with 4 arrows each having a clear exit → waves 1, all free
  const spread = new Int8Array(16).fill(EMPTY);
  spread[0] = 0; spread[5] = 3; spread[10] = 1; spread[15] = 2;
  const w = balance.scoreWeights;
  assert.ok(scoreBoard(chain, 4, 1, w) > scoreBoard(spread, 4, 4, w));
  assert.equal(scoreBoard(new Int8Array(16).fill(EMPTY), 4, 4, w), 0);
});

test('simulateWaves reports cleared:false on an unsolvable board', () => {
  // 2×2 rotational deadlock: each arrow blocked by the next
  // (r=0,c=0)=right blocked by (r=0,c=1); (r=0,c=1)=down blocked by (r=1,c=1);
  // (r=1,c=1)=left blocked by (r=1,c=0); (r=1,c=0)=up blocked by (r=0,c=0)
  const lock = new Int8Array([1, 2, 0, 3]);
  const r = simulateWaves(lock, 2, 2);
  assert.equal(r.cleared, false);
});

test('targetDifficulty rises with level and dips on breathers', () => {
  assert.ok(targetDifficulty(100, balance) > targetDifficulty(11, balance));
  assert.ok(targetDifficulty(300, balance) > targetDifficulty(100, balance));
  // level 10 is a breather (10 % 5 === 0): below both neighbours
  assert.ok(isBreather(10, balance));
  assert.ok(!isBreather(11, balance));
  assert.ok(targetDifficulty(10, balance) < targetDifficulty(9, balance));
  assert.ok(targetDifficulty(10, balance) < targetDifficulty(11, balance));
  // level 1 is never a breather
  assert.ok(!isBreather(1, balance));
});

test('pickCandidate selects the closest score, first on ties', () => {
  assert.equal(pickCandidate([3, 7, 1], 6.5), 1);
  assert.equal(pickCandidate([5, 5], 5), 0);
  assert.equal(pickCandidate([9], 2), 0);
});

test('generateLevel is deterministic and always solvable', () => {
  for (const level of [1, 7, 25, 55, 150, 400]) {
    const g1 = generateLevel(level, balance);
    const g2 = generateLevel(level, balance);
    assert.deepEqual(Array.from(g1.board), Array.from(g2.board), `level ${level} not deterministic`);
    assert.equal(g1.count, g2.count);
    const { cleared } = simulateWaves(g1.board, g1.cols, g1.rows);
    assert.ok(cleared, `level ${level} not solvable`);
    assert.ok(g1.count > 0);
  }
});

test('difficulty broadly rises across the ramp', () => {
  const w = balance.scoreWeights;
  let early = 0, late = 0;
  for (let n = 1; n <= 30; n++) early += generateLevel(n, balance).score;
  for (let n = 220; n <= 250; n++) late += generateLevel(n, balance).score;
  assert.ok(late / 31 > early / 30, `late mean ${late / 31} not above early mean ${early / 30}`);
});

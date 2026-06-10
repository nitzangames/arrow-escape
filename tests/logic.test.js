import { test } from 'node:test';
import assert from 'node:assert/strict';
import { balance } from '../src/balance.js';
import { allocGameData } from '../src/gameData.js';
import { EMPTY } from '../src/generator.js';
// Task 6 extends this import with awardClear, nextLevel, useHint, refillHearts.
// Importing them now would crash Node (missing exports), so don't.
import { startLevel, tapCell, tick, distToEdge } from '../src/logic.js';

// Build a gd with a hand-crafted board (bypasses the generator).
function makeGd(cols, rows, cells) {
  const gd = allocGameData(balance);
  gd.screen = 'game';
  gd.cols = cols;
  gd.rows = rows;
  gd.board = new Int8Array(cols * rows).fill(EMPTY);
  for (const [c, r, dir] of cells) gd.board[r * cols + c] = dir;
  gd.remaining = cells.length;
  gd.bumpT = new Float32Array(cols * rows);
  return gd;
}

function runTicks(gd, seconds) {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) tick(gd, balance, dt);
}

test('startLevel produces a playable board', () => {
  const gd = allocGameData(balance);
  gd.level = 3;
  startLevel(gd, balance);
  assert.equal(gd.screen, 'game');
  assert.ok(gd.cols > 0 && gd.rows > 0);
  assert.equal(gd.board.length, gd.cols * gd.rows);
  assert.ok(gd.remaining > 0);
  assert.equal(gd.hearts, balance.hearts);
  assert.equal(gd.flawless, true);
  assert.equal(gd.hintIndex, -1);
});

test('tapping a free arrow flies it; tapping a blocked arrow bumps and costs a heart', () => {
  // 2×1: (0,0) points left (free), (1,0) points left (blocked by (0,0))
  const gd = makeGd(2, 1, [[0, 0, 3], [1, 0, 3]]);
  assert.equal(tapCell(gd, balance, 1, 0), 'bump');
  assert.equal(gd.hearts, balance.hearts - 1);
  assert.equal(gd.flawless, false);
  assert.ok(gd.bumpT[1] > 0);
  assert.ok(gd.shakeT > 0);
  assert.equal(gd.remaining, 2); // bump removes nothing

  assert.equal(tapCell(gd, balance, 0, 0), 'fly');
  assert.equal(gd.board[0], EMPTY);
  assert.equal(gd.remaining, 1);
  assert.equal(gd.flights.count, 1);

  // empty cell and mid-bump cell are inert
  assert.equal(tapCell(gd, balance, 0, 0), 'none');
  assert.equal(tapCell(gd, balance, 1, 0), 'none'); // still bumping
});

test('distToEdge measures cells to leave the board', () => {
  const gd = makeGd(4, 5, []);
  assert.equal(distToEdge(gd, 0, 0, 0), 1); // up from top row
  assert.equal(distToEdge(gd, 0, 0, 3), 1); // left from left col
  assert.equal(distToEdge(gd, 0, 0, 1), 4); // right across 4 cols
  assert.equal(distToEdge(gd, 0, 0, 2), 5); // down across 5 rows
});

test('flights despawn and the level clears after the last arrow leaves', () => {
  const gd = makeGd(2, 1, [[0, 0, 3], [1, 0, 3]]);
  assert.equal(tapCell(gd, balance, 0, 0), 'fly');
  assert.equal(tapCell(gd, balance, 1, 0), 'fly'); // now unblocked
  assert.equal(gd.remaining, 0);
  assert.ok(gd.clearTimer > 0);
  // clearTimer must hold (not count down) while flights are still airborne
  const timerBefore = gd.clearTimer;
  tick(gd, balance, 1 / 60);
  assert.ok(gd.flights.count > 0);
  assert.equal(gd.clearTimer, timerBefore);
  const goldBefore = gd.gold;
  runTicks(gd, 3);
  assert.equal(gd.flights.count, 0);
  assert.equal(gd.screen, 'clear');
  // flawless clear: base + bonus awarded exactly once
  assert.equal(gd.gold, goldBefore + balance.goldPerClear + balance.flawlessBonus);
  assert.equal(gd.goldEarnedClear, balance.goldPerClear);
  assert.equal(gd.goldEarnedBonus, balance.flawlessBonus);
});

test('losing all hearts fails the level', () => {
  // (0,0) points right, permanently blocked by (1,0). Tap it 3 times.
  const gd = makeGd(2, 1, [[0, 0, 1], [1, 0, 0]]);
  // wait out the bump between taps
  tapCell(gd, balance, 0, 0); runTicks(gd, 0.3);
  tapCell(gd, balance, 0, 0); runTicks(gd, 0.3);
  assert.equal(tapCell(gd, balance, 0, 0), 'bump');
  assert.equal(gd.hearts, 0);
  assert.ok(gd.failTimer > 0);
  runTicks(gd, 1);
  assert.equal(gd.screen, 'fail');
  // taps are inert once dead
  assert.equal(tapCell(gd, balance, 1, 0), 'none');
});

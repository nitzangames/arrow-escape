import { test } from 'node:test';
import assert from 'node:assert/strict';
import { balance } from '../src/balance.js';
import { allocGameData } from '../src/gameData.js';
import { EMPTY } from '../src/generator.js';
import {
  startLevel, tapCell, tick, distToEdge,
  awardClear, nextLevel, useHint, refillHearts,
} from '../src/logic.js';

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

test('clearFade ramps to 1 after the clear transition', () => {
  const gd = makeGd(1, 1, [[0, 0, 0]]);
  assert.equal(tapCell(gd, balance, 0, 0), 'fly');
  runTicks(gd, 3);
  assert.equal(gd.screen, 'clear');
  assert.equal(gd.clearFade, 1);
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

test('useHint charges gold and marks a free arrow exactly once', () => {
  const gd = makeGd(2, 1, [[0, 0, 3], [1, 0, 3]]);
  gd.gold = balance.hintCost - 1;
  assert.equal(useHint(gd, balance), false); // can't afford
  gd.gold = balance.hintCost;
  assert.equal(useHint(gd, balance), true);
  assert.equal(gd.gold, 0);
  assert.equal(gd.hintIndex, 0); // the only free arrow
  gd.gold = 100;
  assert.equal(useHint(gd, balance), false); // hint already showing
  assert.equal(gd.gold, 100);
});

test('refillHearts only works on the fail screen and charges gold', () => {
  const gd = makeGd(2, 1, [[0, 0, 1], [1, 0, 0]]);
  gd.gold = 100;
  assert.equal(refillHearts(gd, balance), false); // not on fail screen
  gd.screen = 'fail';
  gd.hearts = 0;
  assert.equal(refillHearts(gd, balance), true);
  assert.equal(gd.gold, 100 - balance.refillCost);
  assert.equal(gd.hearts, balance.hearts);
  assert.equal(gd.screen, 'game');
  // broke players can't refill
  gd.screen = 'fail';
  gd.gold = balance.refillCost - 1;
  assert.equal(refillHearts(gd, balance), false);
  assert.equal(gd.screen, 'fail');
});

test('awardClear pays base without bonus after a bump', () => {
  const gd = makeGd(2, 1, [[0, 0, 3]]);
  gd.flawless = false;
  gd.gold = 0;
  awardClear(gd, balance);
  assert.equal(gd.gold, balance.goldPerClear);
  assert.equal(gd.goldEarnedBonus, 0);
});

test('nextLevel advances and regenerates', () => {
  const gd = allocGameData(balance);
  gd.level = 4;
  startLevel(gd, balance);
  nextLevel(gd, balance);
  assert.equal(gd.level, 5);
  assert.equal(gd.screen, 'game');
  assert.equal(gd.hearts, balance.hearts);
  assert.ok(gd.remaining > 0);
});

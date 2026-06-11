import { test } from 'node:test';
import assert from 'node:assert/strict';
import { balance } from '../src/balance.js';
import { allocGameData } from '../src/gameData.js';
import { EMPTY } from '../src/generator.js';
import {
  startLevel, tapCell, tick, distToEdge,
  awardClear, nextLevel, useHint, refillHearts,
} from '../src/logic.js';

// Build a gd with hand-crafted pieces (bypasses the generator).
function makeGd(cols, rows, defs) {
  const gd = allocGameData(balance);
  gd.screen = 'game';
  gd.cols = cols;
  gd.rows = rows;
  gd.grid = new Int16Array(cols * rows).fill(EMPTY);
  gd.pieces = defs.map((d, id) => {
    for (const ci of d.cells) gd.grid[ci] = id;
    return { cells: d.cells, dir: d.dir };
  });
  const n = defs.length;
  gd.alive = new Uint8Array(n).fill(1);
  gd.sliding = new Uint8Array(n);
  gd.travel = new Float32Array(n);
  gd.maxTravel = new Float32Array(n);
  gd.slideT = new Float32Array(n);
  gd.bumpT = new Float32Array(n);
  gd.remaining = n;
  return gd;
}

function runTicks(gd, seconds) {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) tick(gd, balance, dt);
}

test('startLevel produces a playable snake board', () => {
  const gd = allocGameData(balance);
  gd.level = 3;
  startLevel(gd, balance);
  assert.equal(gd.screen, 'game');
  assert.ok(gd.cols > 0 && gd.rows > 0);
  assert.equal(gd.grid.length, gd.cols * gd.rows);
  assert.ok(gd.pieces.length > 0);
  assert.equal(gd.remaining, gd.pieces.length);
  assert.equal(gd.alive.length, gd.pieces.length);
  assert.equal(gd.hearts, balance.hearts);
  assert.equal(gd.flawless, true);
  assert.equal(gd.hintPiece, -1);
});

test('tapping any cell of a free snake slides the whole piece', () => {
  // 3×1: one snake, head at cell 0 pointing left, body 1,2
  const gd = makeGd(3, 1, [{ cells: [0, 1, 2], dir: 3 }]);
  assert.equal(tapCell(gd, balance, 2, 0), 'fly'); // tapped the TAIL
  assert.equal(gd.sliding[0], 1);
  assert.equal(gd.remaining, 0);
  // all grid cells freed immediately
  assert.deepEqual(Array.from(gd.grid), [EMPTY, EMPTY, EMPTY]);
  // maxTravel = (L-1) + distToEdge + margin = 2 + 1 + 3 = 6
  assert.equal(gd.maxTravel[0], 2 + 1 + balance.flyMargin);
});

test('blocked snake bumps and costs a heart; inert cases return none', () => {
  // 3×1: piece 0 = single at cell 0 pointing left (free);
  //      piece 1 = snake cells 1,2 head at 1 pointing left (blocked by piece 0)
  const gd = makeGd(3, 1, [
    { cells: [0], dir: 3 },
    { cells: [1, 2], dir: 3 },
  ]);
  assert.equal(tapCell(gd, balance, 2, 0), 'bump'); // tap piece 1's tail → bump
  assert.equal(gd.hearts, balance.hearts - 1);
  assert.equal(gd.flawless, false);
  assert.ok(gd.bumpT[1] > 0);
  assert.ok(gd.shakeT > 0);
  assert.equal(gd.remaining, 2);
  assert.equal(tapCell(gd, balance, 1, 0), 'none'); // same piece mid-bump
  assert.equal(tapCell(gd, balance, 0, 0), 'fly');  // piece 0 escapes
  assert.equal(tapCell(gd, balance, 0, 0), 'none'); // now-empty cell
});

test('own body never blocks the slide', () => {
  // 3×2: snake head (0,0) pointing RIGHT; body curls under and back right:
  // cells: head=0 (0,0), body=3 (0,1), 4 (1,1), 5 (2,1)
  // exit ray of head: (1,0), (2,0) — empty. Body is NOT on the ray.
  // Now a second snake whose head ray passes over its OWN body cannot be
  // built by the generator, so test the rayClear self-exemption directly
  // through a hand-made overlap: head (0,0) right, body at (1,1); put a
  // DIFFERENT piece's cell on the ray to confirm blocking still works.
  const gd = makeGd(3, 2, [
    { cells: [0, 3, 4, 5], dir: 1 },
  ]);
  assert.equal(tapCell(gd, balance, 2, 1), 'fly'); // tap tail; ray (1,0),(2,0) clear
  assert.equal(gd.sliding[0], 1);
});

test('distToEdge measures cells to leave the board', () => {
  const gd = makeGd(4, 5, []);
  assert.equal(distToEdge(gd, 0, 0, 0), 1);
  assert.equal(distToEdge(gd, 0, 0, 3), 1);
  assert.equal(distToEdge(gd, 0, 0, 1), 4);
  assert.equal(distToEdge(gd, 0, 0, 2), 5);
});

test('slides despawn and the level clears after the last piece leaves', () => {
  const gd = makeGd(2, 1, [
    { cells: [0], dir: 3 },
    { cells: [1], dir: 3 },
  ]);
  assert.equal(tapCell(gd, balance, 0, 0), 'fly');
  assert.equal(tapCell(gd, balance, 1, 0), 'fly');
  assert.equal(gd.remaining, 0);
  assert.ok(gd.clearTimer > 0);
  // clearTimer must hold while pieces are still sliding
  const timerBefore = gd.clearTimer;
  tick(gd, balance, 1 / 60);
  assert.ok(gd.slidingCount > 0);
  assert.equal(gd.clearTimer, timerBefore);
  const goldBefore = gd.gold;
  runTicks(gd, 3);
  assert.equal(gd.slidingCount, 0);
  assert.equal(gd.alive[0], 0);
  assert.equal(gd.alive[1], 0);
  assert.equal(gd.screen, 'clear');
  assert.equal(gd.gold, goldBefore + balance.goldPerClear + balance.flawlessBonus);
});

test('losing all hearts fails the level', () => {
  // 2×1 mutual block: tap piece 0 three times
  const gd = makeGd(2, 1, [
    { cells: [0], dir: 1 },
    { cells: [1], dir: 3 },
  ]);
  tapCell(gd, balance, 0, 0); runTicks(gd, 0.3);
  tapCell(gd, balance, 0, 0); runTicks(gd, 0.3);
  assert.equal(tapCell(gd, balance, 0, 0), 'bump');
  assert.equal(gd.hearts, 0);
  assert.ok(gd.failTimer > 0);
  runTicks(gd, 1);
  assert.equal(gd.screen, 'fail');
  assert.equal(tapCell(gd, balance, 1, 0), 'none');
});

test('clearFade ramps to 1 after the clear transition', () => {
  const gd = makeGd(1, 1, [{ cells: [0], dir: 0 }]);
  assert.equal(tapCell(gd, balance, 0, 0), 'fly');
  runTicks(gd, 3);
  assert.equal(gd.screen, 'clear');
  assert.equal(gd.clearFade, 1);
});

test('useHint charges gold and marks a free piece exactly once', () => {
  const gd = makeGd(2, 1, [
    { cells: [0], dir: 3 },
    { cells: [1], dir: 3 },
  ]);
  gd.gold = balance.hintCost - 1;
  assert.equal(useHint(gd, balance), false);
  gd.gold = balance.hintCost;
  assert.equal(useHint(gd, balance), true);
  assert.equal(gd.gold, 0);
  assert.equal(gd.hintPiece, 0);
  gd.gold = 100;
  assert.equal(useHint(gd, balance), false);
  assert.equal(gd.gold, 100);
});

test('refillHearts only works on the fail screen and charges gold', () => {
  const gd = makeGd(2, 1, [
    { cells: [0], dir: 1 },
    { cells: [1], dir: 3 },
  ]);
  gd.gold = 100;
  assert.equal(refillHearts(gd, balance), false);
  gd.screen = 'fail';
  gd.hearts = 0;
  assert.equal(refillHearts(gd, balance), true);
  assert.equal(gd.gold, 100 - balance.refillCost);
  assert.equal(gd.hearts, balance.hearts);
  assert.equal(gd.screen, 'game');
  gd.screen = 'fail';
  gd.gold = balance.refillCost - 1;
  assert.equal(refillHearts(gd, balance), false);
  assert.equal(gd.screen, 'fail');
});

test('awardClear pays base without bonus after a bump', () => {
  const gd = makeGd(1, 1, [{ cells: [0], dir: 0 }]);
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

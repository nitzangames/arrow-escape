import { test } from 'node:test';
import assert from 'node:assert/strict';
import { balance } from '../src/balance.js';
import { allocGameData } from '../src/gameData.js';
import { EMPTY, WALL } from '../src/generator.js';
import {
  startLevel, tapCell, tick, distToEdge, heartTick, grantAdHeart, buyGoldPack,
  awardClear, nextLevel, useHint, refillHearts, openShop, closeShop,
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

test('startLevel produces a playable, completely filled snake board', () => {
  const gd = allocGameData(balance);
  gd.level = 3;
  gd.hearts = 2;
  startLevel(gd, balance);
  assert.equal(gd.screen, 'game');
  assert.ok(gd.cols > 0 && gd.rows > 0);
  assert.equal(gd.grid.length, gd.cols * gd.rows);
  assert.ok(!Array.from(gd.grid).includes(EMPTY), 'board has empty cells');
  assert.ok(gd.pieces.length > 0);
  assert.equal(gd.remaining, gd.pieces.length);
  assert.equal(gd.alive.length, gd.pieces.length);
  assert.equal(gd.hearts, 2, 'startLevel must not touch the persistent heart pool');
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
  assert.equal(gd.hearts, balance.heartCap - 1);
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

test('hearts hitting 0 gates the level and resets the per-gate ad flag', () => {
  const gd = makeGd(2, 1, [
    { cells: [0], dir: 1 },
    { cells: [1], dir: 3 },
  ]);
  gd.hearts = 2;
  gd.adUsedThisGate = true; // stale from a previous gating
  tapCell(gd, balance, 0, 0); runTicks(gd, 0.3);
  assert.equal(gd.hearts, 1);
  assert.equal(tapCell(gd, balance, 0, 0), 'bump');
  assert.equal(gd.hearts, 0);
  assert.equal(gd.adUsedThisGate, false, 'entering the gate re-arms the ad button');
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

test('refillHearts works from the gate and the menu, fills to cap, clears the timer', () => {
  const gd = makeGd(2, 1, [
    { cells: [0], dir: 1 },
    { cells: [1], dir: 3 },
  ]);
  gd.gold = 100;
  gd.hearts = 2;
  assert.equal(refillHearts(gd, balance), false, 'not from the game screen');
  gd.screen = 'fail';
  gd.hearts = 0;
  gd.heartT = 12345;
  assert.equal(refillHearts(gd, balance), true);
  assert.equal(gd.gold, 100 - balance.refillCost);
  assert.equal(gd.hearts, balance.heartCap);
  assert.equal(gd.heartT, null);
  assert.equal(gd.screen, 'game', 'continues the board in place');
  gd.screen = 'menu';
  gd.hearts = 1;
  assert.equal(refillHearts(gd, balance), true, 'menu refill below cap allowed');
  assert.equal(gd.screen, 'menu');
  assert.equal(refillHearts(gd, balance), false, 'already at cap');
  gd.screen = 'fail';
  gd.hearts = 0;
  gd.gold = balance.refillCost - 1;
  assert.equal(refillHearts(gd, balance), false, 'insufficient gold');
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
  gd.hearts = 3;
  nextLevel(gd, balance);
  assert.equal(gd.level, 5);
  assert.equal(gd.screen, 'game');
  assert.equal(gd.hearts, 3, 'hearts persist across levels');
  assert.ok(gd.remaining > 0);
});

test('tapping a wall cell is inert', () => {
  const gd = makeGd(2, 1, [{ cells: [0], dir: 3 }]);
  gd.grid[1] = WALL;
  assert.equal(tapCell(gd, balance, 1, 0), 'none');
  assert.equal(gd.hearts, balance.heartCap);
  assert.equal(gd.remaining, 1);
});

test('heartTick: regen math with injected timestamps', () => {
  const gd = makeGd(1, 1, [{ cells: [0], dir: 0 }]);
  const HOUR = balance.heartRegenMs;
  // at cap: no timer
  gd.hearts = balance.heartCap;
  gd.heartT = 999;
  assert.equal(heartTick(gd, balance, 1000), true);
  assert.equal(gd.heartT, null);
  // below cap, no timer -> timer starts one hour out
  gd.hearts = 2;
  assert.equal(heartTick(gd, balance, 5000), true);
  assert.equal(gd.heartT, 5000 + HOUR);
  // not yet due -> nothing
  assert.equal(heartTick(gd, balance, 5000 + HOUR - 1), false);
  assert.equal(gd.hearts, 2);
  // due -> +1, timer advances by exactly one hour (no drift)
  assert.equal(heartTick(gd, balance, 5000 + HOUR + 250), true);
  assert.equal(gd.hearts, 3);
  assert.equal(gd.heartT, 5000 + 2 * HOUR);
  // long absence -> grants up to cap, timer cleared
  assert.equal(heartTick(gd, balance, 5000 + 10 * HOUR), true);
  assert.equal(gd.hearts, balance.heartCap);
  assert.equal(gd.heartT, null);
});

test('heartTick auto-resumes a gated level when a heart arrives', () => {
  const gd = makeGd(2, 1, [
    { cells: [0], dir: 1 },
    { cells: [1], dir: 3 },
  ]);
  gd.screen = 'fail';
  gd.hearts = 0;
  gd.heartT = 1000;
  assert.equal(heartTick(gd, balance, 2000), true);
  assert.equal(gd.hearts, 1);
  assert.equal(gd.screen, 'game', 'gate lifts the moment a heart regenerates');
  assert.equal(gd.failTimer, 0);
});

test('grantAdHeart: +1, once per gating, resumes the board', () => {
  const gd = makeGd(2, 1, [
    { cells: [0], dir: 1 },
    { cells: [1], dir: 3 },
  ]);
  gd.screen = 'fail';
  gd.hearts = 0;
  gd.adUsedThisGate = false;
  assert.equal(grantAdHeart(gd, balance), true);
  assert.equal(gd.hearts, 1);
  assert.equal(gd.screen, 'game');
  assert.equal(gd.adUsedThisGate, true);
  assert.equal(grantAdHeart(gd, balance), false, 'only one ad heart per gating');
  gd.adUsedThisGate = false;
  gd.hearts = balance.heartCap;
  assert.equal(grantAdHeart(gd, balance), false, 'no grant at cap');
});

test('buyGoldPack adds the pack gold', () => {
  const gd = makeGd(1, 1, [{ cells: [0], dir: 0 }]);
  gd.gold = 10;
  buyGoldPack(gd, balance, 1);
  assert.equal(gd.gold, 10 + balance.goldPacks[1].gold);
});

test('openShop/closeShop round-trip and preserve a gated board', () => {
  const gd = makeGd(2, 1, [
    { cells: [0], dir: 1 },
    { cells: [1], dir: 3 },
  ]);
  gd.screen = 'fail';
  openShop(gd);
  assert.equal(gd.screen, 'shop');
  assert.equal(gd.shopFrom, 'fail');
  closeShop(gd);
  assert.equal(gd.screen, 'fail');
  gd.screen = 'menu';
  openShop(gd);
  closeShop(gd);
  assert.equal(gd.screen, 'menu');
});

test('a heart arriving while the shop covers the gate lifts the gate underneath', () => {
  const gd = makeGd(2, 1, [
    { cells: [0], dir: 1 },
    { cells: [1], dir: 3 },
  ]);
  gd.screen = 'fail';
  gd.hearts = 0;
  gd.heartT = 1000;
  openShop(gd);
  assert.equal(heartTick(gd, balance, 2000), true);
  assert.equal(gd.hearts, 1);
  assert.equal(gd.screen, 'shop', 'shop stays open');
  closeShop(gd);
  assert.equal(gd.screen, 'game', 'returns to the resumed board, not a stale gate');
});

test('a heart arriving while the gate is still pending cancels it', () => {
  const gd = makeGd(2, 1, [
    { cells: [0], dir: 1 },
    { cells: [1], dir: 3 },
  ]);
  gd.hearts = 1;
  gd.heartT = 1000;
  assert.equal(tapCell(gd, balance, 0, 0), 'bump'); // hearts -> 0, failTimer starts
  assert.ok(gd.failTimer > 0);
  assert.equal(heartTick(gd, balance, 2000), true); // regen lands in the window
  assert.equal(gd.hearts, 1);
  runTicks(gd, 1);
  assert.equal(gd.screen, 'game', 'gate never fires once a heart is back');
});

test('heartTick repairs far-future and NaN timers', () => {
  const gd = makeGd(1, 1, [{ cells: [0], dir: 0 }]);
  const HOUR = balance.heartRegenMs;
  gd.hearts = 1;
  gd.heartT = 1000 + 100 * HOUR; // clock was corrected backwards
  assert.equal(heartTick(gd, balance, 1000), true);
  assert.equal(gd.heartT, 1000 + HOUR, 'never wait more than one period');
  gd.heartT = NaN; // corrupted save
  assert.equal(heartTick(gd, balance, 2000), true);
  assert.equal(gd.heartT, 2000 + HOUR);
});

test('heartTick clamps an overfull corrupted pool', () => {
  const gd = makeGd(1, 1, [{ cells: [0], dir: 0 }]);
  gd.hearts = 99;
  gd.heartT = null;
  assert.equal(heartTick(gd, balance, 1000), true);
  assert.equal(gd.hearts, balance.heartCap);
});

test('grantAdHeart works from the menu and refuses other screens', () => {
  const gd = makeGd(1, 1, [{ cells: [0], dir: 0 }]);
  gd.screen = 'menu';
  gd.hearts = 0;
  gd.adUsedThisGate = false;
  assert.equal(grantAdHeart(gd, balance), true);
  assert.equal(gd.screen, 'menu', 'no screen flip from the menu');
  gd.screen = 'game';
  gd.adUsedThisGate = false;
  gd.hearts = 1;
  assert.equal(grantAdHeart(gd, balance), false, 'no ad grants mid-game');
});

test('buyGoldPack bounds-checks the pack index', () => {
  const gd = makeGd(1, 1, [{ cells: [0], dir: 0 }]);
  gd.gold = 10;
  assert.equal(buyGoldPack(gd, balance, 7), false);
  assert.equal(gd.gold, 10);
  assert.equal(buyGoldPack(gd, balance, 0), true);
  assert.equal(gd.gold, 10 + balance.goldPacks[0].gold);
});

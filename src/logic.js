// Pure game logic. No DOM — runs under Node for tests.
// Every function takes (gd, balance, ...) and mutates gd in place.

import { generateLevel, findHint, rayClear, EMPTY } from './generator.js';

export function startLevel(gd, balance) {
  const gen = generateLevel(gd.level, balance);
  gd.cols = gen.cols;
  gd.rows = gen.rows;
  gd.pieces = gen.pieces;
  gd.grid = gen.grid;
  const n = gen.pieces.length;
  gd.alive = new Uint8Array(n).fill(1);
  gd.sliding = new Uint8Array(n);
  gd.travel = new Float32Array(n);
  gd.maxTravel = new Float32Array(n);
  gd.slideT = new Float32Array(n);
  gd.bumpT = new Float32Array(n);
  gd.slidingCount = 0;
  gd.remaining = n;
  gd.hearts = balance.hearts;
  gd.flawless = true;
  gd.hintPiece = -1;
  gd.hintPulse = 0;
  gd.shakeT = 0;
  gd.clearTimer = 0;
  gd.clearFade = 0;
  gd.failTimer = 0;
  gd.goldEarnedClear = 0;
  gd.goldEarnedBonus = 0;
  gd.screen = 'game';
  gd.dirty = true;
}

export function distToEdge(gd, c, r, dir) {
  if (dir === 0) return r + 1;
  if (dir === 1) return gd.cols - c;
  if (dir === 2) return gd.rows - r;
  return c + 1;
}

export function tapCell(gd, balance, c, r) {
  if (gd.screen !== 'game' || gd.hearts <= 0) return 'none';
  if (c < 0 || c >= gd.cols || r < 0 || r >= gd.rows) return 'none';
  const p = gd.grid[r * gd.cols + c];
  if (p < 0 || gd.bumpT[p] > 0) return 'none'; // p < 0: EMPTY or WALL
  gd.dirty = true;
  const piece = gd.pieces[p];
  const head = piece.cells[0];
  const hc = head % gd.cols, hr = (head / gd.cols) | 0;
  if (rayClear(gd.grid, gd.cols, gd.rows, p, hc, hr, piece.dir)) {
    for (const ci of piece.cells) gd.grid[ci] = EMPTY; // stops blocking immediately
    gd.sliding[p] = 1;
    gd.travel[p] = 0;
    gd.slideT[p] = 0;
    gd.maxTravel[p] = (piece.cells.length - 1) + distToEdge(gd, hc, hr, piece.dir) + balance.flyMargin;
    gd.slidingCount++;
    gd.remaining--;
    if (gd.hintPiece === p) gd.hintPiece = -1;
    if (gd.remaining === 0) gd.clearTimer = balance.clearDelay;
    return 'fly';
  }
  gd.bumpT[p] = balance.bumpDur;
  gd.hearts--;
  gd.flawless = false;
  gd.shakeT = balance.shakeDur;
  if (gd.hearts === 0) gd.failTimer = balance.failDelay;
  return 'bump';
}

// Callers must clamp dt (the rAF loop caps at 1/30 s) — a multi-second dt
// from a tab restore would expire timers and snap slides in one tick.
export function tick(gd, balance, dt) {
  if (gd.screen === 'clear' && gd.clearFade < 1) {
    gd.clearFade = Math.min(1, gd.clearFade + dt * 3);
    gd.dirty = true;
    return;
  }
  if (gd.screen !== 'game') return;
  let animating = false;

  for (let p = 0; p < gd.pieces.length; p++) {
    if (gd.sliding[p]) {
      gd.slideT[p] += dt;
      gd.travel[p] += (balance.flySpeed + balance.flyAccel * gd.slideT[p]) * dt;
      if (gd.travel[p] >= gd.maxTravel[p]) {
        gd.sliding[p] = 0;
        gd.alive[p] = 0;
        gd.slidingCount--;
      }
      animating = true;
    }
    if (gd.bumpT[p] > 0) {
      gd.bumpT[p] = Math.max(0, gd.bumpT[p] - dt);
      animating = true;
    }
  }

  if (gd.shakeT > 0) {
    gd.shakeT = Math.max(0, gd.shakeT - dt);
    animating = true;
  }
  if (gd.hintPiece >= 0) {
    gd.hintPulse += dt;
    animating = true;
  }

  // Clear overlay waits for the last slide to leave the screen.
  if (gd.clearTimer > 0 && gd.slidingCount === 0) {
    gd.clearTimer -= dt;
    if (gd.clearTimer <= 0) {
      awardClear(gd, balance);
      gd.screen = 'clear';
    }
    animating = true;
  }
  // Unlike clearTimer, failTimer doesn't wait for slides: fail comes from a
  // bump, and with current balance all slides drain well within failDelay.
  if (gd.failTimer > 0) {
    gd.failTimer -= dt;
    if (gd.failTimer <= 0) gd.screen = 'fail';
    animating = true;
  }

  if (animating) gd.dirty = true;
}

export function awardClear(gd, balance) {
  gd.goldEarnedClear = balance.goldPerClear;
  gd.goldEarnedBonus = gd.flawless ? balance.flawlessBonus : 0;
  gd.gold += gd.goldEarnedClear + gd.goldEarnedBonus;
}

export function nextLevel(gd, balance) {
  gd.level++;
  startLevel(gd, balance);
}

export function useHint(gd, balance) {
  if (gd.screen !== 'game' || gd.hintPiece >= 0 || gd.gold < balance.hintCost) return false;
  // hintable = alive and not sliding (a sliding piece's grid cells are already
  // EMPTY, so it would look "free" with gain 0 and could win ties)
  let idx = -1;
  {
    const mask = new Uint8Array(gd.pieces.length);
    for (let p = 0; p < gd.pieces.length; p++) mask[p] = gd.alive[p] && !gd.sliding[p] ? 1 : 0;
    idx = findHint(gd.pieces, gd.grid, gd.cols, gd.rows, mask);
  }
  if (idx < 0) return false;
  gd.gold -= balance.hintCost;
  gd.hintPiece = idx;
  gd.hintPulse = 0;
  gd.dirty = true;
  return true;
}

export function refillHearts(gd, balance) {
  if (gd.screen !== 'fail' || gd.gold < balance.refillCost) return false;
  gd.gold -= balance.refillCost;
  gd.hearts = balance.hearts;
  gd.failTimer = 0;
  gd.screen = 'game';
  gd.dirty = true;
  return true;
}

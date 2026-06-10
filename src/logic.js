// Pure game logic. No DOM — runs under Node for tests.
// Every function takes (gd, balance, ...) and mutates gd in place.

import { generateLevel, findHint, pathClear, EMPTY } from './generator.js';

export function startLevel(gd, balance) {
  const gen = generateLevel(gd.level, balance);
  gd.cols = gen.cols;
  gd.rows = gen.rows;
  gd.board = gen.board;
  gd.remaining = gen.count;
  gd.bumpT = new Float32Array(gen.cols * gen.rows);
  gd.flights.active.fill(0);
  gd.flights.count = 0;
  gd.hearts = balance.hearts;
  gd.flawless = true;
  gd.hintIndex = -1;
  gd.hintPulse = 0;
  gd.shakeT = 0;
  gd.clearTimer = 0;
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

function spawnFlight(gd, balance, c, r, dir) {
  const f = gd.flights;
  for (let k = 0; k < f.active.length; k++) {
    if (f.active[k]) continue;
    f.active[k] = 1;
    f.c[k] = c;
    f.r[k] = r;
    f.dir[k] = dir;
    f.dist[k] = 0;
    f.t[k] = 0;
    f.maxDist[k] = distToEdge(gd, c, r, dir) + balance.flyMargin;
    f.count++;
    return;
  }
  // Pool exhausted: the arrow simply vanishes (caller decrements remaining).
}

export function tapCell(gd, balance, c, r) {
  if (gd.screen !== 'game' || gd.hearts <= 0) return 'none';
  if (c < 0 || c >= gd.cols || r < 0 || r >= gd.rows) return 'none';
  const i = r * gd.cols + c;
  const dir = gd.board[i];
  if (dir === EMPTY || gd.bumpT[i] > 0) return 'none';
  gd.dirty = true;
  if (pathClear(gd.board, gd.cols, gd.rows, c, r, dir)) {
    gd.board[i] = EMPTY;
    spawnFlight(gd, balance, c, r, dir);
    gd.remaining--;
    if (gd.hintIndex === i) gd.hintIndex = -1;
    if (gd.remaining === 0) gd.clearTimer = balance.clearDelay;
    return 'fly';
  }
  gd.bumpT[i] = balance.bumpDur;
  gd.hearts--;
  gd.flawless = false;
  gd.shakeT = balance.shakeDur;
  if (gd.hearts === 0) gd.failTimer = balance.failDelay;
  return 'bump';
}

// Callers must clamp dt (the rAF loop caps at 1/30 s) — a multi-second dt
// from a tab restore would expire timers and snap flights in one tick.
export function tick(gd, balance, dt) {
  if (gd.screen !== 'game') return;
  let animating = false;

  const f = gd.flights;
  for (let k = 0; k < f.active.length; k++) {
    if (!f.active[k]) continue;
    f.t[k] += dt;
    f.dist[k] += (balance.flySpeed + balance.flyAccel * f.t[k]) * dt;
    if (f.dist[k] >= f.maxDist[k]) {
      f.active[k] = 0;
      f.count--;
    }
    animating = true;
  }

  for (let i = 0; i < gd.bumpT.length; i++) {
    if (gd.bumpT[i] > 0) {
      gd.bumpT[i] = Math.max(0, gd.bumpT[i] - dt);
      animating = true;
    }
  }

  if (gd.shakeT > 0) {
    gd.shakeT = Math.max(0, gd.shakeT - dt);
    animating = true;
  }
  if (gd.hintIndex >= 0) {
    gd.hintPulse += dt;
    animating = true;
  }

  // Clear overlay waits for the last flight to leave the screen.
  if (gd.clearTimer > 0 && f.count === 0) {
    gd.clearTimer -= dt;
    if (gd.clearTimer <= 0) {
      awardClear(gd, balance);
      gd.screen = 'clear';
    }
    animating = true;
  }
  // Unlike clearTimer, failTimer doesn't wait for flights: fail comes from a
  // bump, and with current balance all flights drain well within failDelay.
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
  if (gd.screen !== 'game' || gd.hintIndex >= 0 || gd.gold < balance.hintCost) return false;
  const idx = findHint(gd.board, gd.cols, gd.rows);
  if (idx < 0) return false;
  gd.gold -= balance.hintCost;
  gd.hintIndex = idx;
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

// Pure game logic. No DOM — runs under Node for tests.
// Every function takes (gd, balance, ...) and mutates gd in place.

import { getLevel, findHint, rayClear, EMPTY } from './generator.js';

export function startLevel(gd, balance) {
  const gen = getLevel(gd.level, balance, gd.baked);
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
  gd.wrongT = new Float32Array(n);
  gd.slidingCount = 0;
  gd.remaining = n;
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
  gd.wrongT[p] = balance.wrongDur; // the wrong arrow shows red while this drains
  gd.hearts--;
  gd.flawless = false;
  gd.shakeT = balance.shakeDur;
  if (gd.hearts === 0) {
    gd.failTimer = balance.failDelay; // -> 'fail' = the out-of-hearts gate
    gd.adUsedThisGate = false;        // each gating re-arms the one ad grant
  }
  return 'bump';
}

// Callers must clamp dt (the rAF loop caps at 1/30 s) — a multi-second dt
// from a tab restore would expire timers and snap slides in one tick.
export function tick(gd, balance, dt) {
  if (gd.popupT > 0) {
    gd.popupT = Math.max(0, gd.popupT - dt);
    if (gd.popupT === 0) gd.popupText = '';
    gd.dirty = true;
  }
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
    if (gd.wrongT[p] > 0) {
      gd.wrongT[p] = Math.max(0, gd.wrongT[p] - dt);
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
  // The gate waits for in-flight slides to finish (16-cell snakes can outlive
  // failDelay) — a frozen mid-slide piece under the overlay looks broken.
  if (gd.failTimer > 0 && gd.slidingCount === 0) {
    gd.failTimer -= dt;
    if (gd.failTimer <= 0 && gd.hearts === 0) gd.screen = 'fail';
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

// Full refill for gold. From the gate ('fail') it resumes the preserved board
// in place; from the menu it just tops up. Never from mid-game or the shop.
export function refillHearts(gd, balance) {
  if (gd.screen !== 'fail' && gd.screen !== 'menu') return false;
  if (gd.gold < balance.refillCost || gd.hearts >= balance.heartCap) return false;
  gd.gold -= balance.refillCost;
  gd.hearts = balance.heartCap;
  gd.heartT = null;
  liftGate(gd);
  gd.dirty = true;
  return true;
}

// A heart became available — cancel any pending or active out-of-hearts gate.
// If the shop is covering a gated board, retarget its return to the live game.
function liftGate(gd) {
  if (gd.hearts <= 0) return;
  gd.failTimer = 0;
  if (gd.screen === 'fail') gd.screen = 'game';
  else if (gd.screen === 'shop' && gd.shopFrom === 'fail') gd.shopFrom = 'game';
}

// The single heart-regen authority. `now` is injected (epoch ms) — pure logic
// never reads the clock. Grants every elapsed hour below the cap; the timer
// advances in exact hour steps so regen never drifts. If a heart arrives
// while the out-of-hearts gate is up, the level resumes in place.
export function heartTick(gd, balance, now) {
  let changed = false;
  if (gd.hearts >= balance.heartCap) {
    if (gd.hearts > balance.heartCap) { gd.hearts = balance.heartCap; changed = true; } // corrupted save
    if (gd.heartT !== null) { gd.heartT = null; changed = true; }
    if (changed) gd.dirty = true;
    return changed;
  }
  if (gd.heartT === null) {
    gd.heartT = now + balance.heartRegenMs;
    return true;
  }
  // Clock corrected backwards (timer set under a fast clock) or corrupted
  // save (NaN): never make the player wait more than one full regen period.
  // The !(<=) form also catches NaN.
  if (!(gd.heartT <= now + balance.heartRegenMs)) {
    gd.heartT = now + balance.heartRegenMs;
    changed = true;
  }
  while (gd.heartT !== null && now >= gd.heartT) {
    gd.hearts++;
    changed = true;
    gd.heartT = gd.hearts < balance.heartCap ? gd.heartT + balance.heartRegenMs : null;
  }
  if (changed) liftGate(gd);
  if (changed) gd.dirty = true;
  return changed;
}

// Reward for a completed rewarded ad: +1 heart, at most once per gating.
// The SDK call (and its dev fallback) lives in main.js — by the time this
// runs, the ad was already watched.
export function grantAdHeart(gd, balance) {
  if (gd.screen !== 'fail' && gd.screen !== 'menu') return false;
  if (gd.adUsedThisGate || gd.hearts >= balance.heartCap) return false;
  gd.hearts++;
  gd.adUsedThisGate = true;
  liftGate(gd);
  gd.dirty = true;
  return true;
}

// Credit a purchased pack. The NBucks spend (and rejection handling) lives in
// main.js — this runs only after the platform confirmed the charge.
export function buyGoldPack(gd, balance, packIndex) {
  const pack = balance.goldPacks[packIndex];
  if (!pack) return false;
  gd.gold += pack.gold;
  gd.dirty = true;
  return true;
}

export function openShop(gd) {
  if (gd.screen !== 'menu' && gd.screen !== 'fail') return;
  gd.shopFrom = gd.screen;
  gd.shopMsg = '';
  gd.screen = 'shop';
  gd.dirty = true;
}

export function closeShop(gd) {
  if (gd.screen !== 'shop') return;
  gd.screen = gd.shopFrom;
  gd.dirty = true;
}

// Celebration card over the shop after a confirmed purchase. Counts down in
// tick; any tap dismisses it early (main's pointerdown swallows that tap).
export function showPopup(gd, balance, text) {
  gd.popupText = text;
  gd.popupT = balance.popupDur;
  gd.dirty = true;
}

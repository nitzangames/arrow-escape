# Arrow Escape — Monetization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hearts become a persistent pool (cap 5, +1/hour regen); running out gates play behind a rewarded ad (+1) or a 50-gold refill; a shop sells gold for NBucks (150g/15, 500g/40, 1500g/100).

**Architecture:** All heart/shop rules live in pure `src/logic.js` with time injected as an explicit `now` argument (`heartTick(gd, balance, now)`) — no `Date.now()` in pure code. `src/main.js` owns the platform edges: `PlaySDK.showRewardedAd()` / `PlaySDK.nbucks.spend()` wrappers with dev fallbacks, per-second heart ticking, and the extended save schema. `src/render.js` gains a shop screen, the out-of-hearts overlay, a 5-heart HUD, and a `visibleButtons(gd)` helper shared by drawing and hit-testing.

**Tech Stack:** unchanged (vanilla JS, node --test, Playwright). Platform APIs per `GamesPlatform/docs/game-developer-guide.md`.

**Spec:** `docs/superpowers/specs/2026-06-10-arrow-escape-design.md` (rev 5). Base: branch `main` @ 9f69487 (v0.1.24, deployed), 42 tests passing. **Work on a new branch:** `git checkout -b monetization main` — main is live.

---

## Shared concepts (read first)

- **Persistent hearts:** `gd.hearts` (0..`balance.heartCap`=5) survives across levels; `startLevel` no longer touches it. Every bump costs 1. `gd.heartT` = epoch ms when the next heart arrives (null at cap).
- **`heartTick(gd, balance, now)`** is the single regen authority: at cap → clears `heartT`; below cap with no timer → starts one; otherwise grants every elapsed hour (multi-hour absences grant several at once, capped). If a heart arrives while the player stares at the OUT OF HEARTS overlay (`screen === 'fail'`), the game auto-resumes in place. Returns `true` if anything changed (drives the dirty flag).
- **Gating:** hearts hitting 0 in `tapCell` starts the existing `failTimer` flow → `screen 'fail'` (now meaning "out of hearts", not "level failed" — the board is preserved and continues in place after any refill). Entering the gate resets `gd.adUsedThisGate = false`; the ad button grants at most once per gating.
- **The 'fail' screen keeps its internal name** (`screen: 'fail'`, `failTimer`, `renderFail`) to minimize churn; its meaning and UI become the out-of-hearts gate.
- **Shop:** `screen: 'shop'`, entered from menu or the gate; `gd.shopFrom` remembers where to return. While shopping mid-level the board state is untouched (`tick` ignores non-game screens).
- **Platform pitfalls (verbatim from platform docs):** the spend method is exactly `PlaySDK.nbucks.spend({amount, itemDescription, itemId})` and its promise REJECTS on cancel/insufficient funds (nothing charged). `PlaySDK.adsAvailable` is true on mobile, false on web; web `showRewardedAd()` grants without an ad. Dev fallback (no PlaySDK): ads auto-grant, purchases succeed free.
- **Time plumbing:** `main.js` stamps `gd.nowMs = Date.now()` every frame; render uses it only to format countdowns. Pure logic only ever sees `now` as a parameter.

---

### Task 1: Heart economy + shop grants — pure logic, balance, gameData, tests

**Files:**
- Modify: `src/balance.js`
- Modify: `src/gameData.js`
- Modify: `src/logic.js`
- Modify: `tests/logic.test.js`

- [ ] **Step 0: Branch.** `git checkout -b monetization main`

- [ ] **Step 1: Update `src/balance.js`** — replace the line `hearts: 3,` with:

```js
  heartCap: 5,            // persistent heart pool (carries across levels)
  heartRegenMs: 3600000,  // +1 heart per hour, up to the cap
```

and after the `refillCost: 50,` line add:

```js
  // NBucks → gold packs (100 NBucks = $1). itemId goes to purchase analytics.
  goldPacks: [
    { id: 'gold-small', gold: 150, nbucks: 15 },
    { id: 'gold-medium', gold: 500, nbucks: 40 },
    { id: 'gold-large', gold: 1500, nbucks: 100 },
  ],
```

- [ ] **Step 2: Update `src/gameData.js`** — replace the lines

```js
    hearts: balance.hearts,
    flawless: true,
```

with:

```js
    hearts: balance.heartCap,
    heartT: null,           // epoch ms of the next heart regen; null at cap
    adUsedThisGate: false,  // one rewarded-ad heart per out-of-hearts gating
    adsAvailable: true,     // set by main at boot from PlaySDK.adsAvailable
    nowMs: 0,               // stamped by main each frame; render-only countdowns
    shopFrom: 'menu',       // screen to return to when the shop closes
    shopMsg: '',            // transient purchase feedback ("+150 gold!" / cancelled)
    flawless: true,
```

and update the screen comment to `// 'menu' | 'game' | 'clear' | 'fail' (= out of hearts) | 'shop'`.

- [ ] **Step 3: Update `tests/logic.test.js`.**

3a. Extend the logic import line to:

```js
import {
  startLevel, tapCell, tick, distToEdge, heartTick, grantAdHeart, buyGoldPack,
  awardClear, nextLevel, useHint, refillHearts, openShop, closeShop,
} from '../src/logic.js';
```

3b. In `makeGd`, the alloc already carries the new fields; no change needed there.

3c. Replace the test `'startLevel produces a playable, completely filled snake board'` assertions about hearts: change the line `assert.equal(gd.hearts, balance.hearts);` to:

```js
  assert.equal(gd.hearts, 2, 'startLevel must not touch the persistent heart pool');
```

and directly before the `startLevel(gd, balance);` call in that test add:

```js
  gd.hearts = 2;
```

3d. In the test `'blocked snake bumps and costs a heart; inert cases return none'`, replace both `balance.hearts` references with `balance.heartCap`.

3e. Replace the test `'losing all hearts fails the level'` with:

```js
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
```

3f. Replace the test `'refillHearts only works on the fail screen and charges gold'` with:

```js
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
```

3g. In the test `'nextLevel advances and regenerates'`: delete the line `assert.equal(gd.hearts, balance.hearts);`, add `gd.hearts = 3;` directly before the `nextLevel(gd, balance);` call, and add this assertion after it:

```js
  assert.equal(gd.hearts, 3, 'hearts persist across levels');
```

3h. Add these new tests at the end of the file:

```js
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
```

- [ ] **Step 4: Run `npm test` — expect FAIL** (`heartTick` etc. not exported; `balance.heartCap` undefined until Step 1 lands — Steps 1–2 may be done first, the test step still fails on logic exports).

- [ ] **Step 5: Update `src/logic.js`.**

5a. In `startLevel`, DELETE the line `gd.hearts = balance.hearts;` (hearts persist).

5b. In `tapCell`, replace:

```js
  gd.bumpT[p] = balance.bumpDur;
  gd.hearts--;
  gd.flawless = false;
  gd.shakeT = balance.shakeDur;
  if (gd.hearts === 0) gd.failTimer = balance.failDelay;
  return 'bump';
```

with:

```js
  gd.bumpT[p] = balance.bumpDur;
  gd.hearts--;
  gd.flawless = false;
  gd.shakeT = balance.shakeDur;
  if (gd.hearts === 0) {
    gd.failTimer = balance.failDelay; // -> 'fail' = the out-of-hearts gate
    gd.adUsedThisGate = false;        // each gating re-arms the one ad grant
  }
  return 'bump';
```

5c. Replace `refillHearts` with:

```js
// Full refill for gold. From the gate ('fail') it resumes the preserved board
// in place; from the menu it just tops up. Never from mid-game or the shop.
export function refillHearts(gd, balance) {
  if (gd.screen !== 'fail' && gd.screen !== 'menu') return false;
  if (gd.gold < balance.refillCost || gd.hearts >= balance.heartCap) return false;
  gd.gold -= balance.refillCost;
  gd.hearts = balance.heartCap;
  gd.heartT = null;
  if (gd.screen === 'fail') {
    gd.failTimer = 0;
    gd.screen = 'game';
  }
  gd.dirty = true;
  return true;
}
```

5d. Add these functions at the end of the file:

```js
// The single heart-regen authority. `now` is injected (epoch ms) — pure logic
// never reads the clock. Grants every elapsed hour below the cap; the timer
// advances in exact hour steps so regen never drifts. If a heart arrives
// while the out-of-hearts gate is up, the level resumes in place.
export function heartTick(gd, balance, now) {
  let changed = false;
  if (gd.hearts >= balance.heartCap) {
    if (gd.heartT !== null) { gd.heartT = null; changed = true; }
    return changed;
  }
  if (gd.heartT === null) {
    gd.heartT = now + balance.heartRegenMs;
    return true;
  }
  while (gd.heartT !== null && now >= gd.heartT) {
    gd.hearts++;
    changed = true;
    gd.heartT = gd.hearts < balance.heartCap ? gd.heartT + balance.heartRegenMs : null;
  }
  if (changed && gd.screen === 'fail' && gd.hearts > 0) {
    gd.failTimer = 0;
    gd.screen = 'game';
  }
  if (changed) gd.dirty = true;
  return changed;
}

// Reward for a completed rewarded ad: +1 heart, at most once per gating.
// The SDK call (and its dev fallback) lives in main.js — by the time this
// runs, the ad was already watched.
export function grantAdHeart(gd, balance) {
  if (gd.adUsedThisGate || gd.hearts >= balance.heartCap) return false;
  gd.hearts++;
  gd.adUsedThisGate = true;
  if (gd.screen === 'fail') {
    gd.failTimer = 0;
    gd.screen = 'game';
  }
  gd.dirty = true;
  return true;
}

// Credit a purchased pack. The NBucks spend (and rejection handling) lives in
// main.js — this runs only after the platform confirmed the charge.
export function buyGoldPack(gd, balance, packIndex) {
  gd.gold += balance.goldPacks[packIndex].gold;
  gd.dirty = true;
}

export function openShop(gd) {
  if (gd.screen !== 'menu' && gd.screen !== 'fail') return;
  gd.shopFrom = gd.screen;
  gd.screen = 'shop';
  gd.dirty = true;
}

export function closeShop(gd) {
  if (gd.screen !== 'shop') return;
  gd.screen = gd.shopFrom;
  gd.dirty = true;
}
```

- [ ] **Step 6: Run `npm test` — expect PASS: 47 tests, 0 failures** (6 shapes + 23 generator + 18 logic).

- [ ] **Step 7: Bump version and commit.** `VERSION = 'v0.1.25'` in `src/balance.js`, `"version": "0.1.25"` in `package.json`.

```bash
git add src/balance.js src/gameData.js src/logic.js tests/logic.test.js package.json
git commit -m "feat: persistent heart economy — cap 5, hourly regen, ad/gold gate, shop grants (pure logic) (v0.1.25)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

NOTE: the game still RUNS after this commit (render shows 5 hearts wherever it drew 3 via `balance.heartCap`? No — render reads `balance.hearts` which no longer exists). Check `src/render.js` for `balance.hearts`: `renderGame` draws `for (let i = 0; i < balance.hearts; i++)`. That breaks at runtime (NaN loop bound is harmless — loop just doesn't run — but hearts vanish). This is acceptable for one commit on a feature branch; Task 2 immediately rewires the UI. Do NOT deploy between tasks.

---

### Task 2: UI + platform integration — render screens, SDK wrappers, save schema, browser verification

**Files:**
- Modify: `src/render.js`
- Modify: `src/main.js`

- [ ] **Step 1: `src/render.js` — buttons and visibility.** Replace the `BUTTONS` constant with:

```js
// Same-purpose buttons share identical sizes (platform rule).
const BUTTONS = {
  menu: [
    { id: 'play', x: 290, y: 1180, w: 500, h: 140, label: 'PLAY' },
    { id: 'ad', x: 80, y: 1370, w: 440, h: 100, label: 'AD' },
    { id: 'refill', x: 560, y: 1370, w: 440, h: 100, label: 'REFILL' },
    { id: 'shop', x: 290, y: 1510, w: 500, h: 100, label: 'SHOP' },
    { id: 'sound', x: 290, y: 1650, w: 500, h: 100, label: 'SOUND' },
  ],
  game: [
    { id: 'hint', x: 80, y: 1720, w: 440, h: 120, label: 'HINT' },
    { id: 'restart', x: 560, y: 1720, w: 440, h: 120, label: 'RESTART' },
  ],
  clear: [
    { id: 'next', x: 290, y: 1180, w: 500, h: 140, label: 'NEXT' },
  ],
  fail: [
    { id: 'ad', x: 80, y: 1180, w: 440, h: 140, label: 'AD' },
    { id: 'refill', x: 560, y: 1180, w: 440, h: 140, label: 'REFILL' },
    { id: 'shop', x: 290, y: 1380, w: 500, h: 100, label: 'GET GOLD' },
    { id: 'menu', x: 290, y: 1520, w: 500, h: 100, label: 'MENU' },
  ],
  shop: [
    { id: 'pack0', x: 90, y: 760, w: 900, h: 170, label: '' },
    { id: 'pack1', x: 90, y: 970, w: 900, h: 170, label: '' },
    { id: 'pack2', x: 90, y: 1180, w: 900, h: 170, label: '' },
    { id: 'back', x: 290, y: 1450, w: 500, h: 120, label: 'BACK' },
  ],
};

// Buttons that exist right now, given game state. Shared by rendering and
// hit-testing so a hidden button can never be tapped.
function visibleButtons(gd) {
  const btns = BUTTONS[gd.screen];
  if (!btns) return null;
  return btns.filter((b) => {
    if (b.id === 'ad') {
      return gd.hearts === 0 && !gd.adUsedThisGate && gd.adsAvailable;
    }
    if (b.id === 'refill') {
      if (gd.screen === 'menu') return gd.hearts === 0;
      return true; // gate: always offered (disabled state shows if gold short)
    }
    return true;
  });
}
```

- [ ] **Step 2: `src/render.js` — shared heart row + countdown helpers.** Add after `drawHeart`:

```js
// Row of heartCap hearts centered on (cx, y); filled up to gd.hearts.
// The just-lost heart flashes while the shake plays (game screen only).
function drawHeartRow(c, gd, balance, cx, y, size, gap, flashing) {
  const n = balance.heartCap;
  for (let i = 0; i < n; i++) {
    let color = i < gd.hearts ? THEME.accent : THEME.heartEmpty;
    if (flashing && i === gd.hearts && gd.shakeT > 0) {
      color = Math.sin(gd.shakeT * 40) > 0 ? THEME.accent : THEME.heartEmpty;
    }
    drawHeart(c, cx + (i - (n - 1) / 2) * gap, y, size, color);
  }
}

// "Next ♥ in 42:13" — gd.nowMs is stamped by main each frame.
function heartCountdownText(gd) {
  if (gd.heartT === null) return '';
  const ms = Math.max(0, gd.heartT - gd.nowMs);
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return 'next ♥ in ' + m + ':' + String(s).padStart(2, '0');
}
```

- [ ] **Step 3: `src/render.js` — menu.** In `renderMenu`, replace the block from `c.fillStyle = THEME.ink;` + `c.font = FONT.heading;` + `c.fillText('LEVEL ' + gd.level, ...)` down to the gold line (`c.fillText('● ' + gd.gold + ' gold', W / 2, 1560);`) with:

```js
  c.fillStyle = THEME.ink;
  c.font = FONT.heading;
  c.fillText('LEVEL ' + gd.level, W / 2, 980);

  drawHeartRow(c, gd, balance, W / 2, 1040, 48, 76, false);
  if (gd.hearts < balance.heartCap) {
    c.fillStyle = THEME.inkSoft;
    c.font = FONT.body;
    c.fillText(heartCountdownText(gd), W / 2, 1140);
  }

  for (const b of visibleButtons(gd)) {
    if (b.id === 'play') drawButton(c, b, false, gd.hearts === 0);
    else if (b.id === 'ad') drawButton(c, b, true, false, 'AD · +1 ♥', FONT.bodyLarge);
    else if (b.id === 'refill') {
      drawButton(c, b, true, gd.gold < balance.refillCost,
        'REFILL · ' + balance.refillCost, FONT.bodyLarge);
    } else if (b.id === 'shop') drawButton(c, b, false, false, 'SHOP', FONT.bodyLarge);
    else if (b.id === 'sound') {
      drawButton(c, b, true, false, 'SOUND: ' + (gd.sound ? 'ON' : 'OFF'), FONT.bodyLarge);
    }
  }

  c.fillStyle = THEME.inkSoft;
  c.font = FONT.body;
  c.fillText('● ' + gd.gold + ' gold', W / 2, 1810);
```

(The old `drawButton(c, BUTTONS.menu[0], ...)` and `drawButton(c, BUTTONS.menu[1], ...)` lines are part of the replaced block — remove them. `renderMenu` needs `balance`; it already receives it.)

- [ ] **Step 4: `src/render.js` — game HUD hearts.** In `renderGame`, replace the hearts loop (`for (let i = 0; i < balance.hearts; i++) { ... }` including the flash logic and `drawHeart` call) with:

```js
  drawHeartRow(c, gd, balance, W / 2, 270, 48, 76, true);
```

- [ ] **Step 5: `src/render.js` — gate overlay.** Replace `renderFail` with:

```js
function renderFail(c, gd, balance) {
  c.fillStyle = THEME.overlay;
  c.fillRect(0, 0, W, H);
  c.fillStyle = THEME.ink;
  c.textAlign = 'center';
  c.font = FONT.title;
  c.fillText('OUT OF HEARTS', W / 2, 760);
  drawHeartRow(c, gd, balance, W / 2, 830, 48, 76, false);
  c.fillStyle = THEME.inkSoft;
  c.font = FONT.bodyLarge;
  c.fillText(heartCountdownText(gd), W / 2, 990);
  c.font = FONT.body;
  c.fillText('● ' + gd.gold + ' gold', W / 2, 1060);
  for (const b of visibleButtons(gd)) {
    if (b.id === 'ad') drawButton(c, b, false, false, 'AD · +1 ♥', FONT.bodyLarge);
    else if (b.id === 'refill') {
      drawButton(c, b, false, gd.gold < balance.refillCost,
        'REFILL · ' + balance.refillCost, FONT.bodyLarge);
    } else if (b.id === 'shop') drawButton(c, b, true, false, 'GET GOLD', FONT.bodyLarge);
    else if (b.id === 'menu') drawButton(c, b, true, false, 'MENU', FONT.bodyLarge);
  }
  drawVersion(c, true);
}
```

- [ ] **Step 6: `src/render.js` — shop screen.** Add after `renderFail`:

```js
function renderShop(c, gd, balance) {
  c.fillStyle = THEME.bg;
  c.fillRect(0, 0, W, H);
  c.fillStyle = THEME.ink;
  c.textAlign = 'center';
  c.font = FONT.title;
  c.fillText('GOLD SHOP', W / 2, 380);
  c.fillStyle = THEME.inkSoft;
  c.font = FONT.bodyLarge;
  c.fillText('● ' + gd.gold + ' gold', W / 2, 500);
  c.font = FONT.body;
  c.fillText('100 NBucks = $1', W / 2, 580);

  const packs = balance.goldPacks;
  for (let i = 0; i < packs.length; i++) {
    const b = BUTTONS.shop[i];
    c.fillStyle = THEME.buttonSoftBg;
    roundRect(c, b.x, b.y, b.w, b.h, 32);
    c.fill();
    c.fillStyle = THEME.ink;
    c.textAlign = 'left';
    c.font = FONT.subheading;
    c.fillText('● ' + packs[i].gold + ' gold', b.x + 60, b.y + b.h / 2 + 22);
    c.fillStyle = THEME.accent;
    c.textAlign = 'right';
    c.fillText(packs[i].nbucks + ' NB', b.x + b.w - 60, b.y + b.h / 2 + 22);
  }
  c.textAlign = 'center';
  if (gd.shopMsg) {
    c.fillStyle = THEME.inkSoft;
    c.font = FONT.body;
    c.fillText(gd.shopMsg, W / 2, 1420);
  }
  drawButton(c, BUTTONS.shop[3], false, false, 'BACK', FONT.bodyLarge);
  drawVersion(c, true);
}
```

- [ ] **Step 7: `src/render.js` — wire up.** In the exported `render`, after the menu branch add a shop branch (shop fully replaces the screen, even mid-level):

```js
  if (gd.screen === 'shop') {
    renderShop(ctx, gd, balance);
    return;
  }
```

and update the fail call to `renderFail(ctx, gd, balance)` (it now takes balance — it already did; verify). In `hitTest`, replace `const btns = BUTTONS[gd.screen];` with `const btns = visibleButtons(gd);`.

- [ ] **Step 8: `src/main.js` — state stamps, SDK wrappers, save schema, buttons.**

8a. Extend `saveProgress` to persist hearts:

```js
function saveProgress(levelOverride) {
  sdkSave('progress', JSON.stringify({
    level: levelOverride ?? gd.level,
    gold: gd.gold,
    sound: gd.sound,
    hearts: gd.hearts,
    heartT: gd.heartT,
  }));
}
```

8b. In `boot()`, extend the save-restore block: after `gd.sound = s.sound !== false;` add:

```js
      if (Number.isFinite(s.hearts) && s.hearts >= 0) {
        gd.hearts = Math.min(Math.floor(s.hearts), balance.heartCap);
      }
      gd.heartT = Number.isFinite(s.heartT) ? s.heartT : null;
```

(Old saves without hearts keep the alloc default: full pool.) After `booted = true;` add:

```js
  gd.adsAvailable = window.PlaySDK ? !!PlaySDK.adsAvailable : true; // dev: show ad button
  heartTick(gd, balance, Date.now()); // apply offline regen before first render
```

8c. Add the SDK wrappers near `sdkSave`/`sdkLoad`:

```js
// Rewarded ad. Dev fallback (no PlaySDK): auto-grant so flows are testable.
// On platform web, showRewardedAd grants without showing an ad (per docs).
async function sdkRewardedAd() {
  if (window.PlaySDK && typeof PlaySDK.showRewardedAd === 'function') {
    try {
      const r = await PlaySDK.showRewardedAd();
      return !!(r && r.rewarded);
    } catch (err) {
      return false;
    }
  }
  return true;
}

// NBucks spend. The method is exactly PlaySDK.nbucks.spend and the promise
// REJECTS on cancel/insufficient funds — rejection means nothing was charged.
async function sdkSpendNbucks(amount, itemDescription, itemId) {
  if (window.PlaySDK && PlaySDK.nbucks && typeof PlaySDK.nbucks.spend === 'function') {
    try {
      await PlaySDK.nbucks.spend({ amount, itemDescription, itemId });
      return true;
    } catch (err) {
      return false;
    }
  }
  return true; // dev fallback: free
}
```

8d. Replace `onButton` with (async; a `busy` flag prevents double-fires while an ad/purchase modal is up):

```js
let busy = false;

async function onButton(id) {
  if (busy) return;
  switch (id) {
    case 'play':
    case 'retry':
      if (gd.hearts > 0) startLevel(gd, balance);
      break;
    case 'sound': gd.sound = !gd.sound; saveProgress(); break;
    case 'hint': if (useHint(gd, balance)) saveProgress(); break;
    case 'restart': if (gd.remaining > 0 && gd.hearts > 0) startLevel(gd, balance); break;
    case 'next': if (gd.hearts > 0) { nextLevel(gd, balance); saveProgress(); } break;
    case 'refill': if (refillHearts(gd, balance)) saveProgress(); break;
    case 'menu': gd.screen = 'menu'; gd.dirty = true; break;
    case 'shop': openShop(gd); break;
    case 'back': closeShop(gd); break;
    case 'ad': {
      busy = true;
      const rewarded = await sdkRewardedAd();
      busy = false;
      if (rewarded && grantAdHeart(gd, balance)) saveProgress();
      break;
    }
    case 'pack0':
    case 'pack1':
    case 'pack2': {
      const i = Number(id.slice(4));
      const pack = balance.goldPacks[i];
      busy = true;
      const ok = await sdkSpendNbucks(pack.nbucks, pack.gold + ' gold', pack.id);
      busy = false;
      if (ok) {
        buyGoldPack(gd, balance, i);
        gd.shopMsg = '+' + pack.gold + ' gold!';
        saveProgress();
      } else {
        gd.shopMsg = 'purchase cancelled';
      }
      gd.dirty = true;
      break;
    }
  }
}
```

Update the logic import line in main.js to:

```js
import {
  startLevel, nextLevel, tapCell, tick, useHint, refillHearts,
  heartTick, grantAdHeart, buyGoldPack, openShop, closeShop,
} from './logic.js';
```

(`gd.shopMsg` was initialized in Task 1's gameData block.)

8e. In `frame()`, after `tick(gd, balance, dt);` add the per-second heart pulse:

```js
  gd.nowMs = Date.now();
  const sec = (gd.nowMs / 1000) | 0;
  if (sec !== lastHeartSec) {
    lastHeartSec = sec;
    heartTick(gd, balance, gd.nowMs);
    // countdown text changes every second on these screens
    if (gd.heartT !== null && gd.screen !== 'game' && gd.screen !== 'clear') gd.dirty = true;
  }
```

with `let lastHeartSec = 0;` declared next to `lastT`. Also: `'fail'` no longer banks anything — verify the clear-banking block (`saveProgress(gd.level + 1)`) is untouched.

8f. Screenshot mode: after `gd.level = 40;` add `gd.hearts = balance.heartCap;` (full hearts for the capture).

- [ ] **Step 9: Run `npm test`** — still 47 passing (pure modules untouched by this task).

- [ ] **Step 10: Browser verification** (server on 8092; Playwright at `/Users/nitzanwilnai/Programming/Claude/GamesPlatform/node_modules/playwright/index.mjs`; canvas mapping + level-jump via localStorage as in previous tasks; read every screenshot):
  - Fresh save → menu shows 5 red hearts, SHOP button, PLAY enabled; no countdown (at cap).
  - Seed a low-heart save: `localStorage.setItem('arrow-escape:progress', JSON.stringify({level: 3, gold: 60, sound: true, hearts: 2, heartT: Date.now() + 3540000}))` → menu shows 2/5 hearts + "next ♥ in 58:xx" countdown ticking each second.
  - Bump twice in level 3 (compute two blocked pieces in Node) → hearts 0 → OUT OF HEARTS overlay: countdown, AD · +1 ♥, REFILL · 50, GET GOLD, MENU.
  - Tap AD (dev fallback auto-grants) → +1 heart, board resumes in place, ad button gone if re-gated (bump once more → overlay again → no AD button this time… note: `adUsedThisGate` resets on each NEW gating, so the button SHOULD reappear — verify it does).
  - REFILL with enough gold → 5 hearts, resumes; gold −50.
  - GET GOLD → shop over the gated board; buy the 150g pack (dev: free) → "+150 gold!", balance up; BACK → returns to the gate (or resumed game if refilled).
  - Shop from menu: all three packs purchasable; BACK → menu.
  - Reload → hearts/heartT persist (check localStorage JSON has 5 fields).
  - Seed `{hearts: 0, heartT: Date.now() + 5000}` → menu: PLAY disabled (greyed), AD + REFILL visible; wait ~6 s → heart arrives, PLAY enables, countdown updates.
  - Old-save migration: seed `{level: 2, gold: 80, sound: true}` (no hearts) → 5 hearts.
  - Zero console errors throughout.

- [ ] **Step 11: Bump version and commit.** `VERSION = 'v0.1.26'`, package.json `0.1.26`.

```bash
git add src/render.js src/main.js src/gameData.js src/balance.js package.json
git commit -m "feat: monetization UI — out-of-hearts gate, gold shop, rewarded-ad and NBucks wiring (v0.1.26)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Verification summary

| What | How |
|------|-----|
| Regen math | logic tests with injected timestamps (drift-free hour steps, multi-hour grants, cap behavior) |
| Gate semantics | logic tests: gate at 0, ad once-per-gating with re-arm, refill resume, auto-resume on regen |
| Shop grants | logic test + browser purchase flow (dev fallback) with cancel-path message |
| Save schema | browser: round-trip hearts/heartT; old saves migrate to full pool |
| Platform pitfalls | exact `PlaySDK.nbucks.spend` name; rejection handled as neutral cancel; `adsAvailable` gates the ad button |
| UI | Playwright screenshots of menu (full/low/zero hearts), gate overlay, shop, resumed board |
| No deploy | main is live — all work stays on the `monetization` branch until the user verifies |

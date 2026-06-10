# Arrow Escape Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Arrow Escape v1 — an Easybrain-style arrow puzzle (tap arrows to fly them off a grid; blocked arrows bounce and cost hearts) with endless seeded levels, gold/hint economy, and full nitzan.games platform integration.

**Architecture:** Vanilla JS ES modules drawing to a single 1080×1920 2D canvas. Pure, node-testable game core (`generator.js`, `logic.js`, `gameData.js`) separated from DOM-touching shell (`render.js`, `audio.js`, `main.js`). Boards are flat `Int8Array`s (−1 = empty, 0–3 = arrow direction); levels are generated at runtime by seeded reverse construction (provably solvable) with 8-candidate difficulty scoring.

**Tech Stack:** Vanilla JS (no dependencies), `node --test` for unit tests, Python `http.server` for local dev, PlaySDK (injected by the platform at deploy; localStorage fallback for dev).

**Spec:** `docs/superpowers/specs/2026-06-10-arrow-escape-design.md` — read it first.

---

## Context an engineer needs

- **Repo root:** `/Users/nitzanwilnai/Programming/Claude/JSGames/ArrowEscape` (its own git repo, branch `main`). All paths below are relative to it.
- **Platform conventions** live in `/Users/nitzanwilnai/Programming/Claude/GamesPlatform/docs/game-dev-notes.md`. Key ones already baked into this plan: 1080×1920 canvas with flexbox centering and `object-fit: contain`; `touch-action: none` on the canvas element; no per-frame allocations; `requestAnimationFrame` only; visible `VERSION` string bumped on **every commit** (in `src/balance.js` AND `package.json`).
- **PlaySDK** is NOT included via a script tag — the platform's deploy pipeline injects it into `index.html`. Code must guard `window.PlaySDK` and fall back to bare `localStorage` for local dev (see `main.js` in Task 8). Never add extra readiness gates or timeouts around `PlaySDK.save/load` — they internally defer to `onReady`.
- **Dev server:** a server may already be running on port 8092 serving `mockups/`. Restart it from the repo root:
  ```bash
  lsof -ti :8092 | xargs kill 2>/dev/null; sleep 1
  cd /Users/nitzanwilnai/Programming/Claude/JSGames/ArrowEscape && python3 -m http.server 8092 &
  ```
  Game: http://localhost:8092/ · Theme mockup: http://localhost:8092/mockups/theme-explorer.html
- **Board representation (used everywhere):** `Int8Array(cols * rows)`; cell index `i = r * cols + c`; value `-1` (EMPTY) or direction `0`=up, `1`=right, `2`=down, `3`=left. `DIRS = [[0,-1],[1,0],[0,1],[-1,0]]`.
- **Type ladder canvas-px values:** Display 144 / Title 126 / Heading 90 / Subheading 66 / Body Large 48 / Body 36 / Caption 21.

## File structure (final)

```
ArrowEscape/
  index.html                 # canvas + CSS shell, loads src/main.js as module
  meta.json                  # platform metadata (slug arrow-escape)
  package.json               # version + "npm test" → node --test
  thumbnail.png              # 512×512, generated via mockups/thumbnail.html
  .zipignore                 # excludes dev files from deploy zip
  GDD.md                     # exists — pointer to spec
  src/
    balance.js               # VERSION + ALL tuning constants (pure data)
    generator.js             # seeded RNG, board builder, scorer, hint (pure, node-safe)
    gameData.js              # allocGameData(balance) — the one mutable state object
    logic.js                 # startLevel/tapCell/tick/economy (pure, node-safe)
    render.js                # theme, layout, sprites, draw, hit-testing (DOM)
    audio.js                 # procedural Web Audio SFX (DOM)
    main.js                  # boot, input, rAF loop, PlaySDK, screenshot mode (DOM)
  tests/
    generator.test.js
    logic.test.js
  mockups/
    theme-explorer.html      # exists
    thumbnail.html           # renders + downloads thumbnail.png
  docs/                      # specs + this plan
```

`src/generator.js`, `src/logic.js`, `src/gameData.js`, `src/balance.js` must never reference `window`, `document`, or `performance` — the tests import them under Node.

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `.zipignore`
- Create: `meta.json`
- Create: `index.html`
- Create: `src/balance.js`
- Create: `src/main.js` (temporary stub, replaced in Task 7/8)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "arrow-escape",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "scripts": {
    "test": "node --test tests/"
  }
}
```

- [ ] **Step 2: Create `.zipignore`**

```
.git/*
docs/*
mockups/*
tests/*
GDD.md
package.json
.zipignore
```

- [ ] **Step 3: Create `meta.json`**

```json
{
  "slug": "arrow-escape",
  "title": "Arrow Escape",
  "description": "Set every arrow free! Tap arrows to send them flying off the board — but if another arrow blocks the way, you lose a heart. Calm, clever, endless logic puzzles.",
  "tags": ["puzzle", "logic", "relaxing"],
  "author": "Nitzan",
  "thumbnail": "thumbnail.png"
}
```

- [ ] **Step 4: Create `index.html`**

Note: no PlaySDK script tag — the platform injects it at deploy time.

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<title>Arrow Escape</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: 100%; height: 100%; overflow: hidden;
    background: #f4f1ea;
    display: flex; align-items: center; justify-content: center;
  }
  canvas {
    display: block;
    max-width: 100%; max-height: 100%;
    object-fit: contain;
    touch-action: none;
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    -webkit-tap-highlight-color: transparent;
  }
</style>
</head>
<body>
<canvas id="game" width="1080" height="1920"></canvas>
<script type="module" src="src/main.js"></script>
</body>
</html>
```

- [ ] **Step 5: Create `src/balance.js`**

Every tuning number in the game lives here. Set at load, never mutated.

```js
export const VERSION = 'v0.1.0';

export const balance = {
  canvasW: 1080,
  canvasH: 1920,

  // Level ramp brackets: [maxLevel, cols, rows, minArrows, maxArrows]
  ramp: [
    [10, 4, 5, 6, 10],
    [30, 5, 7, 12, 18],
    [60, 6, 8, 20, 28],
    [120, 7, 9, 30, 42],
    [300, 7, 10, 40, 55],
    [Infinity, 8, 11, 55, 70],
  ],
  candidates: 8,          // boards generated per level, best-matching picked
  breatherEvery: 5,       // every 5th level is an easier "breather"
  breatherEase: 0.55,     // breather difficulty target multiplier
  rampEndLevel: 300,      // difficulty target reaches max here
  minTarget: 2,           // difficulty target at level 1
  maxTarget: 16,          // difficulty target at rampEndLevel+
  scoreWeights: { wave: 1.0, blocked: 6.0, count: 0.05 },

  hearts: 3,

  startGold: 60,
  goldPerClear: 10,
  flawlessBonus: 5,
  hintCost: 25,
  refillCost: 50,

  flySpeed: 14,           // cells/s at launch
  flyAccel: 50,           // cells/s²
  flyMargin: 3,           // extra cells past the edge before a flight despawns
  bumpDur: 0.25,          // s
  bumpDist: 26,           // px of bump travel at the 150px reference cell size
  shakeDur: 0.3,          // s
  clearDelay: 0.6,        // s between last escape and the clear overlay
  failDelay: 0.6,         // s between fatal bump and the fail overlay
  maxFlights: 16,
};
```

- [ ] **Step 6: Create stub `src/main.js`** (proves the page loads; replaced in Task 7)

```js
import { VERSION } from './balance.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
ctx.fillStyle = '#f4f1ea';
ctx.fillRect(0, 0, 1080, 1920);
ctx.fillStyle = '#2b2b2e';
ctx.font = '800 144px -apple-system, system-ui, sans-serif';
ctx.textAlign = 'center';
ctx.fillText('ARROW', 540, 800);
ctx.fillText('ESCAPE', 540, 960);
ctx.font = '500 21px -apple-system, system-ui, sans-serif';
ctx.fillText(VERSION, 540, 1880);
```

- [ ] **Step 7: Verify the page serves and renders**

```bash
lsof -ti :8092 | xargs kill 2>/dev/null; sleep 1
cd /Users/nitzanwilnai/Programming/Claude/JSGames/ArrowEscape && (python3 -m http.server 8092 >/dev/null 2>&1 &); sleep 1
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8092/index.html
```

Expected: `200`. Open http://localhost:8092/ in a browser: off-white page, "ARROW ESCAPE" title, `v0.1.0` at the bottom, no console errors.

- [ ] **Step 8: Commit**

```bash
git add package.json .zipignore meta.json index.html src/
git commit -m "feat: project scaffold — canvas shell, balance constants, meta (v0.1.0)"
```

---

### Task 2: Generator core — RNG, board building, solvability

**Files:**
- Create: `src/generator.js`
- Create: `tests/generator.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/generator.test.js`:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/nitzanwilnai/Programming/Claude/JSGames/ArrowEscape && npm test
```

Expected: FAIL — `Cannot find module .../src/generator.js`.

- [ ] **Step 3: Create `src/generator.js`** (only what the tests need; scoring comes in Task 3)

```js
// Pure board generation and analysis. No DOM — runs under Node for tests.
//
// Board representation: Int8Array(cols*rows); index i = r*cols + c;
// value EMPTY (-1) or direction 0=up 1=right 2=down 3=left.

export const EMPTY = -1;
export const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Deterministic seed for level N, candidate k — same board for every player forever.
export function levelSeed(level, candidate) {
  return ((level * 374761393 + candidate * 668265263) ^ 0x9E3779B9) >>> 0;
}

export function rampFor(level, balance) {
  for (const [maxLevel, cols, rows, minArrows, maxArrows] of balance.ramp) {
    if (level <= maxLevel) return { cols, rows, minArrows, maxArrows };
  }
}

// True if the straight path from (c,r) to the board edge in `dir` is empty.
export function pathClear(board, cols, rows, c, r, dir) {
  const dx = DIRS[dir][0], dy = DIRS[dir][1];
  let x = c + dx, y = r + dy;
  while (x >= 0 && x < cols && y >= 0 && y < rows) {
    if (board[y * cols + x] !== EMPTY) return false;
    x += dx; y += dy;
  }
  return true;
}

// Reverse construction: each arrow is placed only where it has a clear exit
// at placement time, so removing arrows in reverse placement order always
// solves the board — solvability is guaranteed by construction.
export function buildBoard(rng, cols, rows, targetArrows) {
  const board = new Int8Array(cols * rows).fill(EMPTY);
  let count = 0;
  let guard = targetArrows * 60;
  while (count < targetArrows && guard-- > 0) {
    const c = (rng() * cols) | 0;
    const r = (rng() * rows) | 0;
    if (board[r * cols + c] !== EMPTY) continue;
    const d0 = (rng() * 4) | 0;
    for (let k = 0; k < 4; k++) {
      const dir = (d0 + k) % 4;
      if (pathClear(board, cols, rows, c, r, dir)) {
        board[r * cols + c] = dir;
        count++;
        break;
      }
    }
  }
  return { board, count };
}

// Solve by waves: repeatedly remove every currently-free arrow at once.
// waves = number of passes needed (sequential-dependency depth).
// Non-mutating (works on a copy).
export function simulateWaves(board, cols, rows) {
  const work = Int8Array.from(board);
  let remaining = 0;
  for (let i = 0; i < work.length; i++) if (work[i] !== EMPTY) remaining++;
  let waves = 0;
  while (remaining > 0) {
    const freeIdx = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = work[r * cols + c];
        if (v !== EMPTY && pathClear(work, cols, rows, c, r, v)) freeIdx.push(r * cols + c);
      }
    }
    if (freeIdx.length === 0) return { waves, cleared: false };
    for (const i of freeIdx) work[i] = EMPTY;
    remaining -= freeIdx.length;
    waves++;
  }
  return { waves, cleared: true };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test
```

Expected: PASS — 7 tests, 0 failures.

- [ ] **Step 5: Bump version and commit**

In `src/balance.js` set `VERSION = 'v0.1.1'`; in `package.json` set `"version": "0.1.1"`.

```bash
git add src/generator.js tests/generator.test.js src/balance.js package.json
git commit -m "feat: seeded reverse-construction board generator with guaranteed solvability (v0.1.1)"
```

---

### Task 3: Difficulty scoring and level selection

**Files:**
- Modify: `src/generator.js` (append)
- Modify: `tests/generator.test.js` (append)

- [ ] **Step 1: Append failing tests to `tests/generator.test.js`**

Add to the existing import from `../src/generator.js`: `scoreBoard, targetDifficulty, isBreather, pickCandidate, generateLevel`.

```js
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
```

- [ ] **Step 2: Run tests to verify the new ones fail**

```bash
npm test
```

Expected: FAIL — `scoreBoard` etc. are not exported.

- [ ] **Step 3: Append to `src/generator.js`**

```js
// Difficulty score: more waves (forced ordering), more initially-blocked
// arrows, and more arrows overall = harder. Weights live in balance.scoreWeights.
export function scoreBoard(board, cols, rows, weights) {
  let arrowCount = 0, freeCount = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v = board[r * cols + c];
      if (v === EMPTY) continue;
      arrowCount++;
      if (pathClear(board, cols, rows, c, r, v)) freeCount++;
    }
  }
  if (arrowCount === 0) return 0;
  const freeRatio = freeCount / arrowCount;
  const { waves } = simulateWaves(board, cols, rows);
  return waves * weights.wave + (1 - freeRatio) * weights.blocked + arrowCount * weights.count;
}

export function isBreather(level, balance) {
  return level > 1 && level % balance.breatherEvery === 0;
}

export function targetDifficulty(level, balance) {
  const t = Math.min(level / balance.rampEndLevel, 1);
  let target = balance.minTarget + (balance.maxTarget - balance.minTarget) * t;
  if (isBreather(level, balance)) target *= balance.breatherEase;
  return target;
}

export function pickCandidate(scores, target) {
  let best = 0;
  let bestDist = Math.abs(scores[0] - target);
  for (let i = 1; i < scores.length; i++) {
    const d = Math.abs(scores[i] - target);
    if (d < bestDist) { best = i; bestDist = d; }
  }
  return best;
}

// Level N: generate `balance.candidates` boards from derived seeds, score
// each, return the one closest to the level's difficulty target.
export function generateLevel(level, balance) {
  const { cols, rows, minArrows, maxArrows } = rampFor(level, balance);
  const boards = [];
  const scores = [];
  for (let k = 0; k < balance.candidates; k++) {
    const rng = mulberry32(levelSeed(level, k));
    const targetArrows = minArrows + ((rng() * (maxArrows - minArrows + 1)) | 0);
    const built = buildBoard(rng, cols, rows, targetArrows);
    boards.push(built);
    scores.push(scoreBoard(built.board, cols, rows, balance.scoreWeights));
  }
  const pick = pickCandidate(scores, targetDifficulty(level, balance));
  return { cols, rows, board: boards[pick].board, count: boards[pick].count, score: scores[pick] };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test
```

Expected: PASS — 12 tests, 0 failures. If `difficulty broadly rises across the ramp` fails, the score weights in `balance.js` need adjusting (raise `count` weight) — do NOT weaken the test below "late mean > early mean".

- [ ] **Step 5: Bump version and commit**

`VERSION = 'v0.1.2'`, package.json `0.1.2`.

```bash
git add src/generator.js tests/generator.test.js src/balance.js package.json
git commit -m "feat: difficulty scoring, sawtooth targets, 8-candidate level selection (v0.1.2)"
```

---

### Task 4: Hint finder

**Files:**
- Modify: `src/generator.js` (append)
- Modify: `tests/generator.test.js` (append)

- [ ] **Step 1: Append failing tests**

Add `findHint` to the generator import.

```js
test('findHint returns the only free arrow', () => {
  // 3×1 row all pointing left: only index 0 is free
  const board = new Int8Array([3, 3, 3]);
  assert.equal(findHint(board, 3, 1), 0);
});

test('findHint prefers the free arrow that unblocks the most others', () => {
  // 3×2 grid:
  //   (1,0)=up    free, unblocks nothing
  //   (2,0)=right free, unblocks (2,1)
  //   (2,1)=up    blocked by (2,0)
  const cols = 3, rows = 2;
  const board = new Int8Array(cols * rows).fill(EMPTY);
  board[0 * cols + 1] = 0;
  board[0 * cols + 2] = 1;
  board[1 * cols + 2] = 0;
  assert.equal(findHint(board, cols, rows), 0 * cols + 2);
});

test('findHint returns -1 on an empty board and never mutates', () => {
  assert.equal(findHint(new Int8Array(9).fill(EMPTY), 3, 3), -1);
  const g = generateLevel(33, balance);
  const before = Array.from(g.board);
  const idx = findHint(g.board, g.cols, g.rows);
  assert.deepEqual(Array.from(g.board), before);
  // hint must be a real, currently-free arrow
  assert.ok(idx >= 0);
  const c = idx % g.cols, r = (idx / g.cols) | 0;
  assert.notEqual(g.board[idx], EMPTY);
  assert.ok(pathClear(g.board, g.cols, g.rows, c, r, g.board[idx]));
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

```bash
npm test
```

Expected: FAIL — `findHint` not exported.

- [ ] **Step 3: Append `findHint` to `src/generator.js`**

```js
// Hint: among currently-free arrows, pick the one whose removal frees the
// most blocked arrows (ties → lowest index). Returns a cell index, or -1.
// Temporarily toggles cells but always restores them before returning.
export function findHint(board, cols, rows) {
  let bestIdx = -1;
  let bestGain = -1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const v = board[i];
      if (v === EMPTY || !pathClear(board, cols, rows, c, r, v)) continue;
      let gain = 0;
      for (let r2 = 0; r2 < rows; r2++) {
        for (let c2 = 0; c2 < cols; c2++) {
          const j = r2 * cols + c2;
          const v2 = board[j];
          if (j === i || v2 === EMPTY) continue;
          const freeBefore = pathClear(board, cols, rows, c2, r2, v2);
          if (freeBefore) continue;
          board[i] = EMPTY;
          const freeAfter = pathClear(board, cols, rows, c2, r2, v2);
          board[i] = v;
          if (freeAfter) gain++;
        }
      }
      if (gain > bestGain) { bestGain = gain; bestIdx = i; }
    }
  }
  return bestIdx;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test
```

Expected: PASS — 15 tests, 0 failures.

- [ ] **Step 5: Bump version and commit**

`VERSION = 'v0.1.3'`, package.json `0.1.3`.

```bash
git add src/generator.js tests/generator.test.js src/balance.js package.json
git commit -m "feat: hint finder picks the free arrow that unblocks the most (v0.1.3)"
```

---

### Task 5: Game state and core logic — taps, flights, hearts, win/fail

**Files:**
- Create: `src/gameData.js`
- Create: `src/logic.js`
- Create: `tests/logic.test.js`

- [ ] **Step 1: Create `src/gameData.js`** (trivial allocation module — written first so the tests can import it)

```js
// The single mutable state object. Allocated once at boot; per-level arrays
// are reallocated in startLevel (level start, not per-frame — allowed).
export function allocGameData(balance) {
  const mf = balance.maxFlights;
  return {
    screen: 'menu', // 'menu' | 'game' | 'clear' | 'fail'
    level: 1,
    gold: balance.startGold,
    sound: true,

    cols: 0,
    rows: 0,
    board: null,      // Int8Array(cols*rows): EMPTY or dir 0..3
    remaining: 0,     // arrows still on the board or in flight
    bumpT: null,      // Float32Array per cell, counts down while bumping
    hearts: balance.hearts,
    flawless: true,

    // Flying arrows (visual only — already removed from board)
    flights: {
      active: new Uint8Array(mf),
      c: new Int16Array(mf),
      r: new Int16Array(mf),
      dir: new Int8Array(mf),
      dist: new Float32Array(mf),     // cells travelled
      maxDist: new Float32Array(mf),  // despawn distance
      t: new Float32Array(mf),        // seconds in flight
      count: 0,
    },

    hintIndex: -1,
    hintPulse: 0,
    shakeT: 0,
    clearTimer: 0,
    failTimer: 0,
    goldEarnedClear: 0,
    goldEarnedBonus: 0,

    dirty: true, // render-on-demand flag for static screens
  };
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/logic.test.js`:

```js
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
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npm test
```

Expected: FAIL — `Cannot find module .../src/logic.js`.

- [ ] **Step 4: Create `src/logic.js`**

```js
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
  // Pool exhausted: the arrow simply vanishes (remaining already decremented).
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
```

(`awardClear` is defined here because `tick` calls it; its dedicated tests come in Task 6.)

- [ ] **Step 5: Run tests to verify they pass**

```bash
npm test
```

Expected: PASS — 20 tests, 0 failures.

- [ ] **Step 6: Bump version and commit**

`VERSION = 'v0.1.4'`, package.json `0.1.4`.

```bash
git add src/gameData.js src/logic.js tests/logic.test.js src/balance.js package.json
git commit -m "feat: core game logic — taps, flights, bumps, hearts, win/fail (v0.1.4)"
```

---

### Task 6: Economy logic — hints, heart refill, next level

**Files:**
- Modify: `src/logic.js` (append)
- Modify: `tests/logic.test.js` (extend import + append)

- [ ] **Step 1: Append failing tests**

Change the logic import line in `tests/logic.test.js` to:

```js
import {
  startLevel, tapCell, tick, distToEdge,
  awardClear, nextLevel, useHint, refillHearts,
} from '../src/logic.js';
```

Append:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test
```

Expected: FAIL — `nextLevel`, `useHint`, `refillHearts` not exported.

- [ ] **Step 3: Append to `src/logic.js`**

```js
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test
```

Expected: PASS — 24 tests, 0 failures.

- [ ] **Step 5: Bump version and commit**

`VERSION = 'v0.1.5'`, package.json `0.1.5`.

```bash
git add src/logic.js tests/logic.test.js src/balance.js package.json
git commit -m "feat: economy logic — hints, heart refill, level advance (v0.1.5)"
```

---

### Task 7: Renderer and playable loop

No unit tests here — this is DOM/visual code, verified manually in the browser. Keep all game rules in `logic.js`; render reads `gd`, never mutates it (except the module-local geometry cache).

**Files:**
- Create: `src/render.js`
- Modify: `src/main.js` (replace the Task 1 stub with a minimal playable loop — extended with saves/SDK in Task 8)

- [ ] **Step 1: Create `src/render.js`**

```js
// All drawing + screen layout + hit-testing. Reads gd, never mutates it.
// Paper Minimal theme, validated in mockups/theme-explorer.html (theme A).

import { EMPTY, DIRS } from './generator.js';
import { VERSION } from './balance.js';

const W = 1080;
const H = 1920;

const THEME = {
  bg: '#f4f1ea',
  boardBg: '#ece8df',
  gridLine: '#dcd7cb',
  tile: '#2b2b2e',
  glyph: '#f4f1ea',
  ink: '#2b2b2e',
  inkSoft: '#8a857a',
  accent: '#e2574c',
  heartEmpty: '#d5cfc2',
  buttonBg: '#2b2b2e',
  buttonText: '#f4f1ea',
  buttonSoftBg: '#e3ded2',
  buttonSoftText: '#2b2b2e',
  overlay: 'rgba(244, 241, 234, 0.92)',
};

// Type ladder — canvas px. Only these sizes, nothing in between.
const FONT = {
  display: '800 144px -apple-system, system-ui, sans-serif',
  title: '800 126px -apple-system, system-ui, sans-serif',
  heading: '700 90px -apple-system, system-ui, sans-serif',
  subheading: '700 66px -apple-system, system-ui, sans-serif',
  bodyLarge: '600 48px -apple-system, system-ui, sans-serif',
  body: '600 36px -apple-system, system-ui, sans-serif',
  caption: '500 21px -apple-system, system-ui, sans-serif',
};

// Same-purpose buttons share identical sizes (platform rule).
const BUTTONS = {
  menu: [
    { id: 'play', x: 290, y: 1180, w: 500, h: 140, label: 'PLAY' },
    { id: 'sound', x: 290, y: 1370, w: 500, h: 100, label: 'SOUND' },
  ],
  game: [
    { id: 'hint', x: 80, y: 1720, w: 440, h: 120, label: 'HINT' },
    { id: 'restart', x: 560, y: 1720, w: 440, h: 120, label: 'RESTART' },
  ],
  clear: [
    { id: 'next', x: 290, y: 1180, w: 500, h: 140, label: 'NEXT' },
  ],
  fail: [
    { id: 'retry', x: 80, y: 1180, w: 440, h: 140, label: 'RETRY' },
    { id: 'refill', x: 560, y: 1180, w: 440, h: 140, label: 'CONTINUE' },
  ],
};

// Board geometry — cached per (cols, rows) so render allocates nothing per frame.
const BOARD_AREA = { x: 60, w: 960, y: 460, h: 1160, maxCell: 150 };
const geom = { cols: 0, rows: 0, cell: 0, bx: 0, by: 0 };

function ensureGeom(gd) {
  if (geom.cols === gd.cols && geom.rows === gd.rows) return geom;
  geom.cols = gd.cols;
  geom.rows = gd.rows;
  geom.cell = Math.min(BOARD_AREA.w / gd.cols, BOARD_AREA.h / gd.rows, BOARD_AREA.maxCell);
  geom.bx = (W - gd.cols * geom.cell) / 2;
  geom.by = BOARD_AREA.y + (BOARD_AREA.h - gd.rows * geom.cell) / 2;
  return geom;
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

// Arrow tiles pre-rendered once (4 directions) at max cell size.
const TILE = 150;
const tileSprites = [];

export function initSprites() {
  if (tileSprites.length) return;
  for (let dir = 0; dir < 4; dir++) {
    const oc = document.createElement('canvas');
    oc.width = TILE;
    oc.height = TILE;
    const c = oc.getContext('2d');
    const pad = 8;
    c.fillStyle = THEME.tile;
    roundRect(c, pad, pad, TILE - pad * 2, TILE - pad * 2, 28);
    c.fill();
    c.translate(TILE / 2, TILE / 2);
    c.rotate(dir * Math.PI / 2);
    c.fillStyle = THEME.glyph;
    c.beginPath();
    c.moveTo(0, -40); c.lineTo(30, 0); c.lineTo(12, 0); c.lineTo(12, 38);
    c.lineTo(-12, 38); c.lineTo(-12, 0); c.lineTo(-30, 0);
    c.closePath();
    c.fill();
    tileSprites.push(oc);
  }
}

function drawHeart(c, x, y, s, color) {
  c.fillStyle = color;
  c.beginPath();
  c.moveTo(x, y + s * 0.32);
  c.bezierCurveTo(x, y - s * 0.1, x - s * 0.55, y - s * 0.1, x - s * 0.55, y + s * 0.25);
  c.bezierCurveTo(x - s * 0.55, y + s * 0.55, x - s * 0.2, y + s * 0.75, x, y + s * 0.95);
  c.bezierCurveTo(x + s * 0.2, y + s * 0.75, x + s * 0.55, y + s * 0.55, x + s * 0.55, y + s * 0.25);
  c.bezierCurveTo(x + s * 0.55, y - s * 0.1, x, y - s * 0.1, x, y + s * 0.32);
  c.closePath();
  c.fill();
}

function drawButton(c, b, soft, disabled, labelOverride, font) {
  c.globalAlpha = disabled ? 0.4 : 1;
  c.fillStyle = soft ? THEME.buttonSoftBg : THEME.buttonBg;
  roundRect(c, b.x, b.y, b.w, b.h, 32);
  c.fill();
  c.fillStyle = soft ? THEME.buttonSoftText : THEME.buttonText;
  c.font = font || FONT.subheading;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(labelOverride || b.label, b.x + b.w / 2, b.y + b.h / 2 + 4);
  c.globalAlpha = 1;
  c.textBaseline = 'alphabetic';
}

function drawVersion(c, centered) {
  c.fillStyle = THEME.inkSoft;
  c.font = FONT.caption;
  c.textAlign = centered ? 'center' : 'left';
  c.fillText(VERSION, centered ? W / 2 : 24, H - 22);
}

function renderMenu(c, gd, balance) {
  c.fillStyle = THEME.ink;
  c.textAlign = 'center';
  c.font = FONT.display;
  c.fillText('ARROW', W / 2, 420);
  c.fillText('ESCAPE', W / 2, 580);
  // accent arrow under the title
  c.save();
  c.translate(W / 2, 700);
  c.rotate(Math.PI / 2);
  c.fillStyle = THEME.accent;
  c.beginPath();
  c.moveTo(0, -40); c.lineTo(30, 0); c.lineTo(12, 0); c.lineTo(12, 38);
  c.lineTo(-12, 38); c.lineTo(-12, 0); c.lineTo(-30, 0);
  c.closePath();
  c.fill();
  c.restore();

  c.fillStyle = THEME.inkSoft;
  c.font = FONT.bodyLarge;
  c.fillText('Set every arrow free', W / 2, 830);

  c.fillStyle = THEME.ink;
  c.font = FONT.heading;
  c.fillText('LEVEL ' + gd.level, W / 2, 1040);

  drawButton(c, BUTTONS.menu[0], false, false);
  drawButton(c, BUTTONS.menu[1], true, false, 'SOUND: ' + (gd.sound ? 'ON' : 'OFF'), FONT.bodyLarge);

  c.fillStyle = THEME.inkSoft;
  c.font = FONT.body;
  c.fillText('● ' + gd.gold + ' gold', W / 2, 1560);
  drawVersion(c, true);
}

function renderGame(c, gd, balance) {
  c.save();
  if (gd.shakeT > 0) {
    c.translate((Math.random() - 0.5) * 16 * gd.shakeT, (Math.random() - 0.5) * 16 * gd.shakeT);
  }

  // HUD
  c.fillStyle = THEME.ink;
  c.font = FONT.subheading;
  c.textAlign = 'left';
  c.fillText('LEVEL ' + gd.level, 80, 180);
  c.textAlign = 'right';
  c.fillText('● ' + gd.gold, W - 80, 180);
  for (let i = 0; i < balance.hearts; i++) {
    drawHeart(c, W / 2 + (i - 1) * 100, 270, 64, i < gd.hearts ? THEME.accent : THEME.heartEmpty);
  }

  // Board panel + grid
  const g = ensureGeom(gd);
  c.fillStyle = THEME.boardBg;
  roundRect(c, g.bx - 20, g.by - 20, gd.cols * g.cell + 40, gd.rows * g.cell + 40, 30);
  c.fill();
  c.strokeStyle = THEME.gridLine;
  c.lineWidth = 2;
  for (let r = 0; r <= gd.rows; r++) {
    c.beginPath();
    c.moveTo(g.bx, g.by + r * g.cell);
    c.lineTo(g.bx + gd.cols * g.cell, g.by + r * g.cell);
    c.stroke();
  }
  for (let col = 0; col <= gd.cols; col++) {
    c.beginPath();
    c.moveTo(g.bx + col * g.cell, g.by);
    c.lineTo(g.bx + col * g.cell, g.by + gd.rows * g.cell);
    c.stroke();
  }

  // Hint highlight under the tile
  if (gd.hintIndex >= 0) {
    const hc = gd.hintIndex % gd.cols;
    const hr = (gd.hintIndex / gd.cols) | 0;
    const pulse = 0.5 + 0.5 * Math.sin(gd.hintPulse * 6);
    c.globalAlpha = 0.35 + 0.55 * pulse;
    c.strokeStyle = THEME.accent;
    c.lineWidth = 10;
    roundRect(c, g.bx + hc * g.cell + 2, g.by + hr * g.cell + 2, g.cell - 4, g.cell - 4, 24);
    c.stroke();
    c.globalAlpha = 1;
  }

  // Tiles (with bump offset)
  const scale = g.cell / TILE;
  for (let r = 0; r < gd.rows; r++) {
    for (let col = 0; col < gd.cols; col++) {
      const i = r * gd.cols + col;
      const dir = gd.board[i];
      if (dir === EMPTY) continue;
      let ox = 0, oy = 0;
      if (gd.bumpT[i] > 0) {
        const k = Math.sin((1 - gd.bumpT[i] / balance.bumpDur) * Math.PI) * balance.bumpDist * scale;
        ox = DIRS[dir][0] * k;
        oy = DIRS[dir][1] * k;
      }
      c.drawImage(tileSprites[dir], g.bx + col * g.cell + ox, g.by + r * g.cell + oy, g.cell, g.cell);
    }
  }

  // Flights
  const f = gd.flights;
  for (let k = 0; k < f.active.length; k++) {
    if (!f.active[k]) continue;
    const dir = f.dir[k];
    const x = g.bx + (f.c[k] + DIRS[dir][0] * f.dist[k]) * g.cell;
    const y = g.by + (f.r[k] + DIRS[dir][1] * f.dist[k]) * g.cell;
    c.drawImage(tileSprites[dir], x, y, g.cell, g.cell);
  }

  c.restore();

  // Bottom buttons (outside the shake transform)
  const hintDisabled = gd.gold < balance.hintCost || gd.hintIndex >= 0;
  drawButton(c, BUTTONS.game[0], false, hintDisabled, 'HINT · ' + balance.hintCost, FONT.bodyLarge);
  drawButton(c, BUTTONS.game[1], true, false, 'RESTART', FONT.bodyLarge);
  drawVersion(c, false);
}

function renderClear(c, gd) {
  c.fillStyle = THEME.overlay;
  c.fillRect(0, 0, W, H);
  c.fillStyle = THEME.ink;
  c.textAlign = 'center';
  c.font = FONT.display;
  c.fillText('LEVEL CLEAR', W / 2, 800);
  c.fillStyle = THEME.accent;
  c.font = FONT.bodyLarge;
  c.fillText('+' + gd.goldEarnedClear + ' gold', W / 2, 920);
  if (gd.goldEarnedBonus > 0) {
    c.fillText('+' + gd.goldEarnedBonus + ' flawless bonus', W / 2, 990);
  }
  drawButton(c, BUTTONS.clear[0], false, false);
  drawVersion(c, true);
}

function renderFail(c, gd, balance) {
  c.fillStyle = THEME.overlay;
  c.fillRect(0, 0, W, H);
  c.fillStyle = THEME.ink;
  c.textAlign = 'center';
  c.font = FONT.title;
  c.fillText('OUT OF HEARTS', W / 2, 800);
  c.fillStyle = THEME.inkSoft;
  c.font = FONT.bodyLarge;
  c.fillText('● ' + gd.gold + ' gold', W / 2, 940);
  drawButton(c, BUTTONS.fail[0], true, false, 'RETRY', FONT.bodyLarge);
  drawButton(c, BUTTONS.fail[1], false, gd.gold < balance.refillCost,
    'CONTINUE · ' + balance.refillCost, FONT.bodyLarge);
  drawVersion(c, true);
}

export function render(ctx, gd, balance) {
  ctx.fillStyle = THEME.bg;
  ctx.fillRect(0, 0, W, H);
  if (gd.screen === 'menu') {
    renderMenu(ctx, gd, balance);
    return;
  }
  renderGame(ctx, gd, balance);
  if (gd.screen === 'clear') renderClear(ctx, gd);
  else if (gd.screen === 'fail') renderFail(ctx, gd, balance);
}

// Hit-testing shares BUTTONS and geometry with the renderer.
// Returns {type:'button', id} | {type:'cell', c, r} | null.
export function hitTest(gd, x, y) {
  const btns = BUTTONS[gd.screen];
  if (btns) {
    for (const b of btns) {
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        return { type: 'button', id: b.id };
      }
    }
  }
  if (gd.screen === 'game') {
    const g = ensureGeom(gd);
    const c = Math.floor((x - g.bx) / g.cell);
    const r = Math.floor((y - g.by) / g.cell);
    if (c >= 0 && c < gd.cols && r >= 0 && r < gd.rows) return { type: 'cell', c, r };
  }
  return null;
}
```

- [ ] **Step 2: Replace `src/main.js`** with the minimal playable loop (no saves/audio yet)

```js
import { balance } from './balance.js';
import { allocGameData } from './gameData.js';
import { startLevel, nextLevel, tapCell, tick, useHint, refillHearts } from './logic.js';
import { initSprites, render, hitTest } from './render.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const gd = allocGameData(balance);

let canvasRect = canvas.getBoundingClientRect();
function refreshRect() { canvasRect = canvas.getBoundingClientRect(); }
window.addEventListener('resize', refreshRect);

canvas.addEventListener('pointerdown', (e) => {
  const x = (e.clientX - canvasRect.left) * (canvas.width / canvasRect.width);
  const y = (e.clientY - canvasRect.top) * (canvas.height / canvasRect.height);
  const hit = hitTest(gd, x, y);
  if (!hit) return;
  gd.dirty = true;
  if (hit.type === 'button') {
    onButton(hit.id);
  } else {
    tapCell(gd, balance, hit.c, hit.r);
  }
});

function onButton(id) {
  switch (id) {
    case 'play': startLevel(gd, balance); break;
    case 'sound': gd.sound = !gd.sound; break;
    case 'hint': useHint(gd, balance); break;
    case 'restart': startLevel(gd, balance); break;
    case 'next': nextLevel(gd, balance); break;
    case 'retry': startLevel(gd, balance); break;
    case 'refill': refillHearts(gd, balance); break;
  }
}

let lastT = performance.now();
function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min((t - lastT) / 1000, 1 / 30);
  lastT = t;
  tick(gd, balance, dt);
  if (!gd.dirty) return; // static screens render only when something changed
  render(ctx, gd, balance);
  gd.dirty = false;
}

initSprites();
refreshRect();
requestAnimationFrame(frame);
```

- [ ] **Step 3: Run the full test suite (logic must be untouched)**

```bash
npm test
```

Expected: PASS — 24 tests, 0 failures.

- [ ] **Step 4: Manual verification in the browser**

Open http://localhost:8092/ (hard-refresh). Verify:

1. Menu shows title, red arrow accent, "LEVEL 1", PLAY, "SOUND: ON", gold 60, version.
2. PLAY starts a small 4×5 board with ~6–10 arrow tiles.
3. Tapping a free arrow slides it off the board smoothly; tapping a blocked arrow bumps it toward the blocker, shakes the screen, and empties a heart.
4. HINT pulses a red outline around a free arrow and deducts 25 gold; button greys out while a hint is showing or gold < 25.
5. Clearing the board shows LEVEL CLEAR with gold breakdown; NEXT starts level 2.
6. Bumping 3 times shows OUT OF HEARTS; RETRY restarts the same identical board; CONTINUE · 50 refills hearts in place when gold ≥ 50 (greyed otherwise).
7. RESTART mid-level resets the same board with 3 hearts.
8. No console errors; resizing the window keeps taps accurate.

- [ ] **Step 5: Bump version and commit**

`VERSION = 'v0.1.6'`, package.json `0.1.6`.

```bash
git add src/render.js src/main.js src/balance.js package.json
git commit -m "feat: renderer, hit-testing, playable loop — full game flow in browser (v0.1.6)"
```

---

### Task 8: PlaySDK persistence, pause/resume, screenshot mode

**Files:**
- Modify: `src/main.js` (replace with final version)

- [ ] **Step 1: Replace `src/main.js`** with the full version

Key rules honored here: bare `PlaySDK.save/load` calls (no extra readiness gates — the SDK defers internally), localStorage fallback only when PlaySDK is absent (local dev), rAF cancelled on pause.

```js
import { balance } from './balance.js';
import { allocGameData } from './gameData.js';
import { startLevel, nextLevel, tapCell, tick, useHint, refillHearts } from './logic.js';
import { initSprites, render, hitTest } from './render.js';
import { findHint } from './generator.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// --- persistence: PlaySDK on platform, bare localStorage fallback for local dev ---
const SAVE_PREFIX = 'arrow-escape:';

function sdkSave(key, value) {
  if (window.PlaySDK) {
    PlaySDK.save(key, value);
    return;
  }
  localStorage.setItem(SAVE_PREFIX + key, value);
}

function sdkLoad(key) {
  if (window.PlaySDK) return PlaySDK.load(key);
  return Promise.resolve(localStorage.getItem(SAVE_PREFIX + key));
}

const gd = allocGameData(balance);

function saveProgress() {
  sdkSave('progress', JSON.stringify({ level: gd.level, gold: gd.gold, sound: gd.sound }));
}

// --- input ---
let canvasRect = canvas.getBoundingClientRect();
function refreshRect() { canvasRect = canvas.getBoundingClientRect(); }
window.addEventListener('resize', refreshRect);

canvas.addEventListener('pointerdown', (e) => {
  const x = (e.clientX - canvasRect.left) * (canvas.width / canvasRect.width);
  const y = (e.clientY - canvasRect.top) * (canvas.height / canvasRect.height);
  const hit = hitTest(gd, x, y);
  if (!hit) return;
  gd.dirty = true;
  if (hit.type === 'button') {
    onButton(hit.id);
  } else {
    const result = tapCell(gd, balance, hit.c, hit.r);
    if (result === 'bump' && window.PlaySDK && PlaySDK.haptic) PlaySDK.haptic('medium');
  }
});

function onButton(id) {
  switch (id) {
    case 'play': startLevel(gd, balance); break;
    case 'sound': gd.sound = !gd.sound; saveProgress(); break;
    case 'hint': if (useHint(gd, balance)) saveProgress(); break;
    case 'restart': startLevel(gd, balance); break;
    case 'next': nextLevel(gd, balance); saveProgress(); break;
    case 'retry': startLevel(gd, balance); break;
    case 'refill': if (refillHearts(gd, balance)) saveProgress(); break;
  }
}

// --- loop ---
let lastT = performance.now();
let prevScreen = 'menu';
let rafId = 0;

function frame(t) {
  rafId = requestAnimationFrame(frame);
  const dt = Math.min((t - lastT) / 1000, 1 / 30);
  lastT = t;
  tick(gd, balance, dt);
  if (gd.screen === 'clear' && prevScreen !== 'clear') saveProgress(); // gold was just awarded
  prevScreen = gd.screen;
  if (!gd.dirty) return; // static screens render only when something changed
  render(ctx, gd, balance);
  gd.dirty = false;
}

// --- pause/resume (battery): stop the loop and resume cleanly ---
function pauseGame() {
  cancelAnimationFrame(rafId);
}
function resumeGame() {
  lastT = performance.now();
  rafId = requestAnimationFrame(frame);
}
if (window.PlaySDK) {
  if (PlaySDK.onPause) PlaySDK.onPause(pauseGame);
  if (PlaySDK.onResume) PlaySDK.onResume(resumeGame);
}

// --- boot ---
async function boot() {
  if (window.PlaySDK && PlaySDK.onReady) {
    await new Promise((resolve) => PlaySDK.onReady(resolve));
  }
  const raw = await sdkLoad('progress');
  if (raw) {
    try {
      const s = JSON.parse(raw);
      if (Number.isFinite(s.level) && s.level >= 1) gd.level = Math.floor(s.level);
      if (Number.isFinite(s.gold) && s.gold >= 0) gd.gold = Math.floor(s.gold);
      gd.sound = s.sound !== false;
    } catch (err) {
      // corrupted save → keep defaults
    }
  }

  initSprites();
  refreshRect();

  // Screenshot mode: skip menus, show a busy mid-game board, play a few moves.
  if (window.PlaySDK && PlaySDK.screenshotMode) {
    gd.level = 40;
    startLevel(gd, balance);
    let taps = 0;
    const auto = setInterval(() => {
      const idx = findHint(gd.board, gd.cols, gd.rows);
      if (idx >= 0) tapCell(gd, balance, idx % gd.cols, (idx / gd.cols) | 0);
      if (++taps >= 3) clearInterval(auto);
    }, 800);
  }

  rafId = requestAnimationFrame(frame);
}

boot();
```

- [ ] **Step 2: Run the test suite**

```bash
npm test
```

Expected: PASS — 24 tests, 0 failures.

- [ ] **Step 3: Manual verification**

1. Open http://localhost:8092/, play to level 2, toggle sound off, reload the page → menu shows "LEVEL 2", gold persisted, "SOUND: OFF" (dev fallback uses localStorage).
2. Screenshot mode: temporarily add this line to `index.html` directly ABOVE the module script tag, reload http://localhost:8092/ and verify the game skips the menu, shows a busy ~level-40 board, and auto-plays 3 escapes. Then REMOVE the line (the real PlaySDK provides this on the platform):
   ```html
   <script>window.PlaySDK = { screenshotMode: true, save() {}, load() { return Promise.resolve(null); }, onReady(cb) { cb(); } };</script>
   ```
   Confirm with `git diff index.html` that the temporary line is gone before committing.
3. DevTools → Application → Local Storage: key `arrow-escape:progress` holds `{"level":2,...}`.
4. No console errors.

- [ ] **Step 4: Bump version and commit**

`VERSION = 'v0.1.7'`, package.json `0.1.7`.

```bash
git add src/main.js src/balance.js package.json
git commit -m "feat: PlaySDK persistence with dev fallback, pause/resume, screenshot mode (v0.1.7)"
```

---

### Task 9: Procedural audio

**Files:**
- Create: `src/audio.js`
- Modify: `src/main.js` (wire SFX in)

- [ ] **Step 1: Create `src/audio.js`**

```js
// Procedural Web Audio SFX. AudioContext created on first user gesture.
let audioCtx = null;

export function initAudio() {
  if (audioCtx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (AC) audioCtx = new AC();
}

export function suspendAudio() {
  if (audioCtx && audioCtx.state === 'running') audioCtx.suspend();
}

export function resumeAudio() {
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}

function tone(freq, dur, type, vol, slideTo) {
  const t0 = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0 + dur);
}

// Consecutive escapes raise the whoosh pitch (spec: combo feedback).
// Audio-local state — resets on any bump or level-clear fanfare.
let combo = 0;

export function sfx(gd, name) {
  if (!gd.sound || !audioCtx) return;
  switch (name) {
    case 'tap': tone(660, 0.07, 'square', 0.10); break;
    case 'whoosh': {
      const lift = 1 + Math.min(combo, 10) * 0.06;
      tone(300 * lift, 0.25, 'sine', 0.18, 1400 * lift);
      combo++;
      break;
    }
    case 'bump': combo = 0; tone(140, 0.18, 'triangle', 0.25, 70); break;
    case 'fanfare':
      combo = 0;
      tone(523, 0.12, 'square', 0.13);
      setTimeout(() => { if (audioCtx) tone(659, 0.12, 'square', 0.13); }, 110);
      setTimeout(() => { if (audioCtx) tone(784, 0.22, 'square', 0.13); }, 220);
      break;
  }
}
```

- [ ] **Step 2: Wire audio into `src/main.js`**

Add the import:

```js
import { initAudio, sfx, suspendAudio, resumeAudio } from './audio.js';
```

In the `pointerdown` handler, make `initAudio()` the first line, and play results:

```js
canvas.addEventListener('pointerdown', (e) => {
  initAudio();
  const x = (e.clientX - canvasRect.left) * (canvas.width / canvasRect.width);
  const y = (e.clientY - canvasRect.top) * (canvas.height / canvasRect.height);
  const hit = hitTest(gd, x, y);
  if (!hit) return;
  gd.dirty = true;
  if (hit.type === 'button') {
    sfx(gd, 'tap');
    onButton(hit.id);
  } else {
    const result = tapCell(gd, balance, hit.c, hit.r);
    if (result === 'fly') sfx(gd, 'whoosh');
    else if (result === 'bump') {
      sfx(gd, 'bump');
      if (window.PlaySDK && PlaySDK.haptic) PlaySDK.haptic('medium');
    }
  }
});
```

In `frame()`, play the fanfare on the clear transition (replace the save-only line):

```js
  if (gd.screen === 'clear' && prevScreen !== 'clear') {
    sfx(gd, 'fanfare');
    saveProgress();
  }
```

In `pauseGame`/`resumeGame`, suspend/resume audio:

```js
function pauseGame() {
  cancelAnimationFrame(rafId);
  suspendAudio();
}
function resumeGame() {
  resumeAudio();
  lastT = performance.now();
  rafId = requestAnimationFrame(frame);
}
```

- [ ] **Step 3: Run tests + manual verification**

```bash
npm test
```

Expected: PASS — 24 tests.

Browser: buttons click, escapes whoosh (rising), bumps thud (falling), level clear plays a 3-note fanfare; SOUND: OFF silences everything; no console errors (including before the first tap — `sfx` guards a null context).

- [ ] **Step 4: Bump version and commit**

`VERSION = 'v0.1.8'`, package.json `0.1.8`.

```bash
git add src/audio.js src/main.js src/balance.js package.json
git commit -m "feat: procedural SFX — whoosh, bump, fanfare, suspend on pause (v0.1.8)"
```

---

### Task 10: Thumbnail, final review pass

**Files:**
- Create: `mockups/thumbnail.html`
- Create: `thumbnail.png` (generated via the page)

- [ ] **Step 1: Create `mockups/thumbnail.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Arrow Escape — thumbnail generator</title>
<style>body { background: #333; display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 24px; font-family: system-ui; color: #eee; }</style>
</head>
<body>
<canvas id="cv" width="512" height="512"></canvas>
<a id="dl" download="thumbnail.png" style="color:#9cf; font-size:18px;">Download thumbnail.png</a>
<script>
const cv = document.getElementById('cv');
const c = cv.getContext('2d');

function roundRect(x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function tile(x, y, s, dir, color, glyph) {
  c.fillStyle = color;
  roundRect(x, y, s, s, s * 0.19);
  c.fill();
  c.save();
  c.translate(x + s / 2, y + s / 2);
  c.rotate(dir * Math.PI / 2);
  const u = s / 150;
  c.fillStyle = glyph;
  c.beginPath();
  c.moveTo(0, -40 * u); c.lineTo(30 * u, 0); c.lineTo(12 * u, 0); c.lineTo(12 * u, 38 * u);
  c.lineTo(-12 * u, 38 * u); c.lineTo(-12 * u, 0); c.lineTo(-30 * u, 0);
  c.closePath();
  c.fill();
  c.restore();
}

// background
c.fillStyle = '#f4f1ea';
c.fillRect(0, 0, 512, 512);

// mini board of tiles, one accent
const S = 96, GAP = 14, X0 = 80, Y0 = 64;
const dirs = [[1, 0, 2], [3, 1, 0], [2, 0, 1]];
for (let r = 0; r < 3; r++) {
  for (let q = 0; q < 3; q++) {
    const accent = r === 1 && q === 1;
    tile(X0 + q * (S + GAP), Y0 + r * (S + GAP), S, dirs[r][q],
      accent ? '#e2574c' : '#2b2b2e', '#f4f1ea');
  }
}

// title — must be readable at ~200px wide
c.fillStyle = '#2b2b2e';
c.textAlign = 'center';
c.font = '800 64px -apple-system, system-ui, sans-serif';
c.fillText('ARROW', 256, 440);
c.fillText('ESCAPE', 256, 500);

document.getElementById('dl').href = cv.toDataURL('image/png');
</script>
</body>
</html>
```

- [ ] **Step 2: Generate `thumbnail.png`**

Open http://localhost:8092/mockups/thumbnail.html, click "Download thumbnail.png", move it to the repo root:

```bash
mv ~/Downloads/thumbnail.png /Users/nitzanwilnai/Programming/Claude/JSGames/ArrowEscape/thumbnail.png
sips -g pixelWidth -g pixelHeight /Users/nitzanwilnai/Programming/Claude/JSGames/ArrowEscape/thumbnail.png
```

Expected: `pixelWidth: 512`, `pixelHeight: 512`.

- [ ] **Step 3: Full verification pass**

```bash
npm test
```

Expected: PASS — 24 tests, 0 failures.

Manual checklist (browser, http://localhost:8092/ after hard refresh):

1. Fresh-profile run (DevTools → Application → clear Local Storage, reload): level 1, 60 gold.
2. Play levels 1–3 end-to-end: clear flow, gold accrues, save persists across reload.
3. Fail flow: bump ×3 → fail overlay → RETRY gives the identical board; CONTINUE deducts 50 and resumes.
4. Hint flow: highlight appears on a tappable arrow; tapping it removes the highlight.
5. Mobile spot-check via responsive mode (iPhone size): letterboxing correct, taps land on the right cells, text readable.
6. Performance sanity: DevTools Performance tab while clearing a busy board — no long GC pauses, render skipped on idle menu (check with the FPS meter: near-zero GPU when menu is static).

- [ ] **Step 4: Bump version and final commit**

`VERSION = 'v0.1.9'`, package.json `0.1.9`.

```bash
git add thumbnail.png mockups/thumbnail.html src/balance.js package.json
git commit -m "feat: thumbnail + final v1 polish pass (v0.1.9)"
```

---

## After the plan

- **Do NOT deploy** — per standing rule, platform deploys require explicit per-action user confirmation. Hand the build to the user for local verification first (http://localhost:8092/).
- Later versions (not this plan): daily challenges, streaks, NBucks→gold shop packs, level select, alternate themes.

## Verification summary

| What | How |
|------|-----|
| Generator correctness | `npm test` (24 unit tests: determinism, solvability, scoring, hints, logic, economy) |
| Gameplay/UI | Manual checklists in Tasks 7, 8, 9, 10 |
| Platform integration | PlaySDK save/load + screenshot mode verified after deploy (user-gated) |

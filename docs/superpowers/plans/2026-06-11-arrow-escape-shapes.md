# Arrow Escape — Shaped Boards + Bigger Ramp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Six geometric board shapes (heart, diamond, plus, donut, hourglass, triangle) appear every 3rd level from level 10, and boards grow from 5×7 (levels 1–3) to 10×14 by level 20.

**Architecture:** A new pure `src/shapes.js` module holds implicit inside/outside formulas per shape, a bbox-fitted cell-center sampler (`maskFor`) that trims empty border rows/cols, and the deterministic schedule (`shapeFor`). `generateLevel` applies the mask to every candidate build — the generator's `WALL` plumbing already exists and is tested. `tapCell` learns that any negative grid value is inert. The renderer replaces the rectangle panel + grid lines with one background tile per playable cell, so the board silhouette is the shape; hit-testing skips wall cells.

**Tech Stack:** unchanged (vanilla JS, node --test, Playwright for visual verification).

**Spec:** `docs/superpowers/specs/2026-06-10-arrow-escape-design.md` (rev 4). Base: branch `v1-implementation` @ 503f807 (v0.1.18), 31 tests passing.

---

## Shared concepts (read first)

- **Shape schedule:** a level is shaped iff `level >= balance.shapeStartLevel && (level − shapeStartLevel) % balance.shapeEvery === 0` (10, 13, 16, …). The shape cycles `SHAPE_ORDER[((level − shapeStartLevel) / shapeEvery) % 6]` with order heart → diamond → plus → donut → hourglass → triangle. So: 10 = heart (7×10 bracket), 13 = diamond (8×12), 16 = plus (9×13), 19 = donut (9×13), 22 = hourglass (10×14), 25 = triangle, 28 = heart again, …
- **Mask sampling:** each shape is `inside(x, y)` over a fixed bounding box. `maskFor(key, cols, rows)` evaluates cell centers across the bbox, then trims empty border rows/columns (pointy tips like the heart's bottom or the diamond's corners can be narrower than half a cell, leaving the outermost sampled line empty). The returned `{cols, rows, mask}` may therefore be smaller than requested — `generateLevel` uses the trimmed dims, and everything downstream (gameData, renderer geometry) follows automatically.
- **WALL flows through untouched code:** `buildBoard` already accepts a mask and writes `WALL` (−2) into the grid; `rayClear`, `simulateWaves`, `scoreBoard`, `findHint` already treat WALL as blocking. The only logic gap is `tapCell`, which checks `p === EMPTY` and would crash indexing `pieces[-2]` on a wall tap.
- **Determinism:** masks are pure functions of (shape, cols, rows); the schedule is a pure function of level. Same level → same shape → same mask → same board, for every player.

---

### Task 1: Shapes module, schedule, ramp, generator integration, logic guard — all pure Node + tests

**Files:**
- Create: `src/shapes.js`
- Create: `tests/shapes.test.js`
- Modify: `src/balance.js` (ramp + schedule constants)
- Modify: `src/generator.js` (`generateLevel` only)
- Modify: `src/logic.js` (`tapCell` one line)
- Modify: `tests/generator.test.js` (rampFor expectations, breather brackets, two new shaped-level tests)
- Modify: `tests/logic.test.js` (one new test + WALL import)

- [ ] **Step 1: Write `tests/shapes.test.js`** (full file):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { balance } from '../src/balance.js';
import { SHAPES, SHAPE_ORDER, shapeFor, maskFor } from '../src/shapes.js';

function lines(m) {
  const out = [];
  for (let r = 0; r < m.rows; r++) {
    let line = '';
    for (let c = 0; c < m.cols; c++) line += m.mask[r * m.cols + c] ? 'X' : '.';
    out.push(line);
  }
  return out;
}

test('shapeFor: rectangles before level 10, then every 3rd level cycles the six shapes', () => {
  for (let lvl = 1; lvl <= 9; lvl++) assert.equal(shapeFor(lvl, balance), null);
  assert.equal(shapeFor(10, balance), 'heart');
  assert.equal(shapeFor(11, balance), null);
  assert.equal(shapeFor(12, balance), null);
  assert.equal(shapeFor(13, balance), 'diamond');
  assert.equal(shapeFor(16, balance), 'plus');
  assert.equal(shapeFor(19, balance), 'donut');
  assert.equal(shapeFor(22, balance), 'hourglass');
  assert.equal(shapeFor(25, balance), 'triangle');
  assert.equal(shapeFor(28, balance), 'heart'); // cycle wraps
});

test('heart mask at 5x7 matches the golden grid', () => {
  const m = maskFor('heart', 5, 7);
  assert.equal(m.cols, 5);
  assert.equal(m.rows, 7);
  assert.deepEqual(lines(m), [
    'XX.XX',
    'XXXXX',
    'XXXXX',
    'XXXXX',
    '.XXX.',
    '.XXX.',
    '..X..',
  ]);
});

test('heart mask at 10x14 trims the empty bottom row and matches the golden grid', () => {
  const m = maskFor('heart', 10, 14);
  assert.equal(m.cols, 10);
  assert.equal(m.rows, 13); // pointy tip narrower than half a cell -> trimmed
  assert.deepEqual(lines(m), [
    '.XXX..XXX.',
    '.XXXXXXXX.',
    'XXXXXXXXXX',
    'XXXXXXXXXX',
    'XXXXXXXXXX',
    'XXXXXXXXXX',
    'XXXXXXXXXX',
    '.XXXXXXXX.',
    '.XXXXXXXX.',
    '.XXXXXXXX.',
    '..XXXXXX..',
    '...XXXX...',
    '....XX....',
  ]);
});

test('every shape at 10x14: sensible size, no empty interior rows or columns', () => {
  for (const key of SHAPE_ORDER) {
    const m = maskFor(key, 10, 14);
    assert.ok(m.cols >= 8 && m.cols <= 10, `${key} cols ${m.cols}`);
    assert.ok(m.rows >= 12 && m.rows <= 14, `${key} rows ${m.rows}`);
    let open = 0;
    for (const v of m.mask) open += v;
    assert.ok(open >= 60, `${key} too few open cells: ${open}`);
    for (let r = 0; r < m.rows; r++) {
      let any = false;
      for (let c = 0; c < m.cols; c++) any = any || m.mask[r * m.cols + c] === 1;
      assert.ok(any, `${key} row ${r} empty`);
    }
    for (let c = 0; c < m.cols; c++) {
      let any = false;
      for (let r = 0; r < m.rows; r++) any = any || m.mask[r * m.cols + c] === 1;
      assert.ok(any, `${key} col ${c} empty`);
    }
  }
});

test('donut at 10x14 keeps a closed 4x6 hole', () => {
  const m = maskFor('donut', 10, 14);
  assert.equal(m.cols, 10);
  assert.equal(m.rows, 14);
  for (let r = 0; r < 14; r++) {
    for (let c = 0; c < 10; c++) {
      const inHole = c >= 3 && c <= 6 && r >= 4 && r <= 9;
      assert.equal(m.mask[r * 10 + c], inHole ? 0 : 1, `cell (${c},${r})`);
    }
  }
});

test('SHAPE_ORDER covers exactly the six shapes', () => {
  assert.deepEqual([...SHAPE_ORDER].sort(),
    ['diamond', 'donut', 'heart', 'hourglass', 'plus', 'triangle']);
  for (const key of SHAPE_ORDER) assert.ok(SHAPES[key]);
});
```

- [ ] **Step 2: Run `npm test` — expect FAIL** (`src/shapes.js` does not exist; `balance.shapeStartLevel` undefined).

Run: `npm test`

- [ ] **Step 3: Create `src/shapes.js`** (full file — these constants are golden-tested, transcribe exactly):

```js
// Pure shape masks and the per-level shape schedule. No DOM — runs under
// Node for tests.
//
// Each shape is an implicit inside(x, y) formula over a fixed bounding box.
// maskFor samples cell centers across the bbox, then trims empty border
// rows/columns (pointy tips can be narrower than half a cell, leaving the
// outermost sampled line empty) — so the returned dims may be smaller than
// requested. The same formulas produce clean silhouettes at every ramp size.

const heartIn = (x, y) => {
  const a = x * x + y * y - 1;
  return a * a * a - x * x * y * y * y <= 0;
};

export const SHAPES = {
  heart:     { inside: heartIn, bbox: [-1.139, 1.139, -1.0, 1.236] },
  diamond:   { inside: (x, y) => Math.abs(x) + Math.abs(y) <= 1.02, bbox: [-1, 1, -1, 1] },
  plus:      { inside: (x, y) => Math.abs(x) <= 0.34 || Math.abs(y) <= 0.34, bbox: [-1, 1, -1, 1] },
  donut:     { inside: (x, y) => !(Math.abs(x) <= 0.45 && Math.abs(y) <= 0.45), bbox: [-1, 1, -1, 1] },
  // Waist floor 0.12 keeps a 2-cell waist on 10-wide boards (cell centers
  // sit at |x| = 0.1); the schedule only uses the hourglass at 10x14.
  hourglass: { inside: (x, y) => Math.abs(x) <= Math.max(0.12, Math.abs(y)), bbox: [-1, 1, -1, 1] },
  triangle:  { inside: (x, y) => Math.abs(x) <= (1 - y) / 2, bbox: [-1, 1, -1, 1] },
};

export const SHAPE_ORDER = ['heart', 'diamond', 'plus', 'donut', 'hourglass', 'triangle'];

// Shape key for a level, or null for a plain rectangle. Deterministic:
// every 3rd level from shapeStartLevel, cycling SHAPE_ORDER.
export function shapeFor(level, balance) {
  const start = balance.shapeStartLevel;
  if (level < start || (level - start) % balance.shapeEvery !== 0) return null;
  return SHAPE_ORDER[((level - start) / balance.shapeEvery) % SHAPE_ORDER.length];
}

// Sample a shape over a cols×rows grid, trim empty border rows/cols.
// Returns { cols, rows, mask } — mask is a Uint8Array, 1 = playable cell.
export function maskFor(shapeKey, cols, rows) {
  const { inside, bbox: [x0, x1, y0, y1] } = SHAPES[shapeKey];
  let m = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      const x = x0 + (c + 0.5) / cols * (x1 - x0);
      const y = y1 - (r + 0.5) / rows * (y1 - y0); // row 0 = top = max y
      row.push(inside(x, y) ? 1 : 0);
    }
    m.push(row);
  }
  while (m.length && m[0].every((v) => !v)) m.shift();
  while (m.length && m[m.length - 1].every((v) => !v)) m.pop();
  while (m.length && m.every((row) => !row[0])) m = m.map((row) => row.slice(1));
  while (m.length && m.every((row) => !row[row.length - 1])) m = m.map((row) => row.slice(0, -1));
  const tc = m[0].length, tr = m.length;
  const mask = new Uint8Array(tc * tr);
  for (let r = 0; r < tr; r++) for (let c = 0; c < tc; c++) mask[r * tc + c] = m[r][c];
  return { cols: tc, rows: tr, mask };
}
```

- [ ] **Step 4: Update `src/balance.js`** — replace the `ramp` array and add the schedule constants directly after it (keep the existing NOTE comment about the determinism contract and the minLen caveat comment):

```js
  // Level ramp brackets: [maxLevel, cols, rows, minLen, maxLen, longBias]
  // Boards are always 100% filled; piece count emerges from the length mix.
  // minLen is a sampling floor, not a guarantee — boxed-in walks still yield shorter pieces.
  ramp: [
    [3, 5, 7, 1, 4, 0],
    [6, 6, 9, 1, 5, 0.2],
    [10, 7, 10, 1, 5, 0.3],
    [14, 8, 12, 1, 6, 0.4],
    [19, 9, 13, 1, 6, 0.5],
    [60, 10, 14, 1, 7, 0.6],
    [Infinity, 10, 14, 1, 7, 0.7],
  ],
  shapeStartLevel: 10,    // first shaped level
  shapeEvery: 3,          // a shaped board every 3rd level from shapeStartLevel
```

- [ ] **Step 5: Update `src/generator.js`** — add the import at the top (after the header comment, before `export const EMPTY`):

```js
import { shapeFor, maskFor } from './shapes.js';
```

and replace `generateLevel` (only this function changes) with:

```js
// Level N: generate `balance.candidates` boards from derived seeds, score
// each, pick by percentile. Shaped levels carve the bracket's grid with the
// scheduled shape mask (maskFor may trim the dims). Candidates whose packing
// failed (null — rare, deepest brackets only; skipped deterministically) are
// simply left out of the pool.
export function generateLevel(level, balance) {
  const { cols: rampCols, rows: rampRows, minLen, maxLen, longBias } = rampFor(level, balance);
  const shape = shapeFor(level, balance);
  let cols = rampCols, rows = rampRows, mask = null;
  if (shape) ({ cols, rows, mask } = maskFor(shape, rampCols, rampRows));
  const boards = [];
  const scores = [];
  for (let k = 0; k < balance.candidates; k++) {
    const rng = mulberry32(levelSeed(level, k));
    const built = buildBoard(rng, cols, rows, minLen, maxLen, longBias, mask);
    if (!built) continue;
    boards.push(built);
    scores.push(scoreBoard(built.pieces, built.grid, cols, rows, balance.scoreWeights));
  }
  const pick = pickIndexForLevel(level, scores, balance);
  return {
    cols, rows, shape,
    pieces: boards[pick].pieces,
    grid: boards[pick].grid,
    count: boards[pick].pieces.length,
    score: scores[pick],
  };
}
```

- [ ] **Step 6: Update `src/logic.js`** — in `tapCell`, replace:

```js
  if (p === EMPTY || gd.bumpT[p] > 0) return 'none';
```

with:

```js
  if (p < 0 || gd.bumpT[p] > 0) return 'none'; // p < 0: EMPTY or WALL
```

- [ ] **Step 7: Update `tests/generator.test.js`:**

7a. Add to the imports:

```js
import { maskFor } from '../src/shapes.js';
```

7b. Replace the `'rampFor returns the right bracket'` test with:

```js
test('rampFor returns the right bracket', () => {
  assert.deepEqual(rampFor(1, balance), { cols: 5, rows: 7, minLen: 1, maxLen: 4, longBias: 0 });
  assert.deepEqual(rampFor(4, balance), { cols: 6, rows: 9, minLen: 1, maxLen: 5, longBias: 0.2 });
  assert.deepEqual(rampFor(20, balance), { cols: 10, rows: 14, minLen: 1, maxLen: 7, longBias: 0.6 });
  assert.deepEqual(rampFor(61, balance), { cols: 10, rows: 14, minLen: 1, maxLen: 7, longBias: 0.7 });
});
```

7c. Replace the `'breather boards are genuinely easier than neighbors in every bracket'` test with:

```js
test('breather boards are genuinely easier than neighbors in the wide brackets', () => {
  // Early brackets are 3-5 levels wide (at most one breather each) — too few
  // for a stable mean, so compare within the two wide 10x14 brackets only.
  const brackets = [[20, 60], [61, 160]];
  for (const [lo, hi] of brackets) {
    let bSum = 0, bN = 0, nSum = 0, nN = 0;
    for (let lvl = lo; lvl <= hi; lvl++) {
      const s = generateLevel(lvl, balance).score;
      if (isBreather(lvl, balance)) { bSum += s; bN++; } else { nSum += s; nN++; }
    }
    assert.ok(bSum / bN < nSum / nN,
      `bracket ${lo}-${hi}: breather mean ${bSum / bN} not below normal mean ${nSum / nN}`);
  }
});
```

7d. Add two new tests at the end of the file:

```js
test('level 10 is the heart: mask applied, full, solvable, deterministic', () => {
  const g = generateLevel(10, balance);
  assert.equal(g.shape, 'heart');
  const m = maskFor('heart', 7, 10); // level 10 bracket dims
  assert.equal(g.cols, m.cols);
  assert.equal(g.rows, m.rows);
  for (let i = 0; i < m.mask.length; i++) {
    if (m.mask[i]) assert.notEqual(g.grid[i], WALL, `cell ${i} should be playable`);
    else assert.equal(g.grid[i], WALL, `cell ${i} should be a wall`);
  }
  assertWellFormed(g, g.cols, g.rows, rampFor(10, balance).maxLen);
  assert.ok(simulateWaves(g.pieces, g.grid, g.cols, g.rows).cleared);
  assert.deepEqual(generateLevel(10, balance).pieces, g.pieces);
});

test('every shaped level through 100 is shaped, full, and solvable', () => {
  for (let lvl = 10; lvl <= 100; lvl += 3) {
    const g = generateLevel(lvl, balance);
    assert.ok(g.shape, `level ${lvl} should be shaped`);
    let walls = 0;
    for (const v of g.grid) if (v === WALL) walls++;
    assert.ok(walls > 0, `level ${lvl} has no walls`);
    assertWellFormed(g, g.cols, g.rows, rampFor(lvl, balance).maxLen);
    assert.ok(simulateWaves(g.pieces, g.grid, g.cols, g.rows).cleared, `level ${lvl} not solvable`);
  }
});
```

(Everything else in the file — including the never-wedges sweep, which now exercises shaped levels automatically — stays unchanged. `WALL`, `assertWellFormed`, `simulateWaves`, `rampFor` are already imported/defined there.)

- [ ] **Step 8: Update `tests/logic.test.js`** — change the generator import line to include WALL:

```js
import { EMPTY, WALL } from '../src/generator.js';
```

and add this test at the end of the file:

```js
test('tapping a wall cell is inert', () => {
  const gd = makeGd(2, 1, [{ cells: [0], dir: 3 }]);
  gd.grid[1] = WALL;
  assert.equal(tapCell(gd, balance, 1, 0), 'none');
  assert.equal(gd.hearts, balance.hearts);
  assert.equal(gd.remaining, 1);
});
```

- [ ] **Step 9: Run `npm test` — expect PASS: 40 tests, 0 failures** (6 shapes + 21 generator + 13 logic).

Run: `npm test`

If the breather test fails: print candidate scores for a few levels in the failing bracket and tune `percentileMin`/`percentileMax` or `scoreWeights` in balance.js — do NOT weaken the assertion. If a shaped level wedges (null all candidates → TypeError in generateLevel): check the mask is being passed through to every buildBoard call, and only then consider raising the restart cap.

- [ ] **Step 10: Sanity-print shaped boards:**

```bash
node -e "
import('./src/generator.js').then(async (G) => {
  const { balance } = await import('./src/balance.js');
  for (const lvl of [10, 19, 22, 25]) {
    const g = G.generateLevel(lvl, balance);
    console.log('level', lvl, g.shape, g.cols + 'x' + g.rows, g.count + ' pieces');
    for (let r = 0; r < g.rows; r++) {
      let line = '';
      for (let c = 0; c < g.cols; c++) {
        const v = g.grid[r * g.cols + c];
        line += v === -2 ? ' ' : String.fromCharCode(65 + (v % 26));
      }
      console.log(line);
    }
  }
});
"
```

Expected: a heart (level 10), donut with hole (19), hourglass (22), triangle (25) — letters fill exactly the shape, spaces outside it.

- [ ] **Step 11: Bump version and commit.** `VERSION = 'v0.1.19'` in `src/balance.js`, `"version": "0.1.19"` in `package.json`.

```bash
git add src/shapes.js src/balance.js src/generator.js src/logic.js tests/ package.json
git commit -m "feat: shaped boards — six geometric masks every 3rd level from 10; ramp doubled to 10x14 (v0.1.19)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

NOTE: after this commit the game logic is correct but shaped levels render with the old rectangle panel (walls drawn as empty board cells). Task 2 fixes rendering.

---

### Task 2: Per-cell board rendering + wall-aware hit-testing + browser verification

**Files:**
- Modify: `src/render.js`

- [ ] **Step 1: Update the generator import in `src/render.js`:**

```js
import { DIRS, WALL } from './generator.js';
```

- [ ] **Step 2: In `renderGame`**, replace the "Board panel + grid" block (the `roundRect` panel fill, the `strokeStyle = THEME.gridLine` assignment, and both grid-line loops — everything between `const g = ensureGeom(gd);` and the hint-highlight comment) so the section reads:

```js
  // Board cells: one tile per playable cell — the board silhouette IS the
  // shape (walls draw nothing). EMPTY cells keep their tile: vacated floor.
  const g = ensureGeom(gd);
  c.fillStyle = THEME.boardBg;
  const inset = Math.max(2, g.cell * 0.04);
  for (let r = 0; r < gd.rows; r++) {
    for (let col = 0; col < gd.cols; col++) {
      if (gd.grid[r * gd.cols + col] === WALL) continue;
      roundRect(c, g.bx + col * g.cell + inset, g.by + r * g.cell + inset,
        g.cell - 2 * inset, g.cell - 2 * inset, g.cell * 0.12);
      c.fill();
    }
  }
```

(Keep `const g = ensureGeom(gd);` as the first line of the block — it's used below.) Remove the now-unused `gridLine` key from `THEME`.

- [ ] **Step 3: In `hitTest`**, make cell hits skip walls — replace:

```js
    if (c >= 0 && c < gd.cols && r >= 0 && r < gd.rows) return { type: 'cell', c, r };
```

with:

```js
    if (c >= 0 && c < gd.cols && r >= 0 && r < gd.rows
      && gd.grid[r * gd.cols + c] !== WALL) {
      return { type: 'cell', c, r };
    }
```

- [ ] **Step 4: Run `npm test`** — still 40 passing (render has no unit tests; this catches accidental syntax/import breakage via the modules the tests do import).

- [ ] **Step 5: Browser verification.** Serve on port 8092 (check if an earlier server is still running: `curl -s -o /dev/null -w "%{http_code}" http://localhost:8092/index.html`; if not, `python3 -m http.server 8092 &` from the project root). Playwright via `/Users/nitzanwilnai/Programming/Claude/GamesPlatform/node_modules/playwright/index.mjs`; adapt the tap helper from `/tmp/ae-verify.mjs` if it still exists (canvas is 1080×1920 internal; board geometry: `cell = min(960/cols, 1160/rows, 150)`, `bx = (1080 − cols·cell)/2`, `by = 460 + (1160 − rows·cell)/2`; PLAY button center ≈ (540, 1250); jump levels via `localStorage.setItem('arrow-escape:progress', JSON.stringify({level: N, gold: 60, sound: true}))` + reload). Verify, reading every screenshot:
  - **Level 1 (5×7 rectangle):** per-cell tiles read as a clean board (this replaces the old panel + grid lines everywhere, so the rectangle look must still hold up).
  - **Level 10 (heart):** silhouette is a heart — notch at top, point at bottom; snakes fill exactly the heart; no tiles or pieces outside it.
  - **Level 19 (donut):** hole in the middle reads clearly.
  - **Level 22 (hourglass, 10×14):** full-size board, waist visible; cells at ~83 px still comfortably readable.
  - **Wall tap is inert:** on level 10, tap a canvas point inside a wall region (e.g., the top-center notch cell of the heart) — nothing happens: no bump, no heart loss, no console error.
  - **Play works:** on level 10, compute a couple of free pieces in Node (`rayClear` on heads) and tap them — snakes slide out of the heart normally; one blocked piece bumps with heart loss.
  - **Zero console errors** across the whole run.

- [ ] **Step 6: Bump version and commit.** `VERSION = 'v0.1.20'` in `src/balance.js`, `"version": "0.1.20"` in `package.json`.

```bash
git add src/render.js src/balance.js package.json
git commit -m "feat: per-cell board tiles — shaped silhouettes, wall-aware hit-testing (v0.1.20)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Verification summary

| What | How |
|------|-----|
| Schedule correctness | unit tests: null before 10, cycle order at 10/13/16/19/22/25/28 |
| Mask fidelity | golden grids (heart 5×7, heart 10×14, donut hole); structural checks for all six at 10×14 |
| Shaped boards play fair | full-coverage + solvability on every shaped level through 100; wave sim |
| Wall safety | tapCell wall test (logic), hitTest skip (render, browser-verified), inert tap in browser |
| New ramp | rampFor unit tests; never-wedges sweep 1–120 covers all new brackets |
| Visuals | Playwright screenshots: rectangle, heart, donut, hourglass; read by the controller |
| No deploy | per standing rule — user verifies locally first |

---

## Revision (2026-06-11, during execution)

Task 1's planned `buildBoard` (greedy ray-aware walks + lowest-index seeding, inherited from the full-fill plan) could not pack pocketed shapes: the heart wedged >99% of attempts at every bias/seed-order tried (its lower-flank cells have a single escape — straight up through the lobes — which early walks invariably suffocate), and level 136 crashed generateLevel. After measuring scan-order, reverse-order, most-constrained-first, and last-escape-polite walk variants (all ≥75% null on hearts), the generator was reworked to **tile-then-peel** (see the spec's "Full-fill packing" bullet): tiling guarantees coverage trivially, peeling guarantees solvability by constructing a forward solution. Validated at 0% null across all six shapes and the rectangle (10×14, maxLen 7, bias 0.7, 300 seeds each, restart cap 400). The heart-only `reverseOrder` parameter added mid-task was removed.

Constants recalibrated post-rework: diamond `1.02` → `1.3` (at 10×14 the pointy diamond has 32 statically-dead cells and never tiles; 1.3's 4-wide tips pack at 0.2% per-candidate failure) and hourglass waist restored `0.35` → `0.12` (2-cell waist, 0.0% failure with tile-then-peel). Spec-review caught both constants having been silently widened by the earlier wedging workaround.

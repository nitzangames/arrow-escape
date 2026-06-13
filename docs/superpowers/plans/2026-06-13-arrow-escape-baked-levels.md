# Arrow Escape — Pre-Baked Levels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate and validate levels 1–3000 at build time into a shipped `levels.json.gz`; load it at boot so level start is a data lookup (no generation hitch), with the runtime generator as a graceful fallback for levels past 3000 or if the file fails to load.

**Architecture:** A new pure `getLevel(level, balance, baked)` in `generator.js` returns a rehydrated baked board (fill `WALL`, stamp pieces — reproduces `generateLevel`'s grid exactly) when one exists, else `generateLevel`. `logic.js`'s `startLevel` calls it with a `gd.baked` array that `main.js` fetches + inflates (`DecompressionStream('gzip')`) at boot. A `scripts/bake-levels.js` build script generates, validates, and gzips the data; a freshness unit test asserts the shipped file matches current `generateLevel`.

**Tech Stack:** unchanged (vanilla JS, node --test). New: Node `zlib` (bake script + freshness test), browser `DecompressionStream` (loader) — both built-in, no dependencies.

**Spec:** `docs/superpowers/specs/2026-06-10-arrow-escape-design.md` (rev 7, §Pre-baked levels). Base: branch `main` @ d7e894d (v0.1.35, deployed, 57 tests). **Work on a new branch:** `git checkout -b baked-levels main` — main is live.

---

## Shared concepts (read first)

- **Baked entry:** `{ c, r, s, p }` = cols, rows, shape-key-or-null, pieces as `[dir, ...cellIndices]`. The array is indexed by `level − 1`.
- **Rehydration:** walls/grid are NOT stored. Reconstruct: `pieces = e.p.map(a => ({ dir: a[0], cells: a.slice(1) }))`, then a grid filled with `WALL` and stamped with each piece's cells. Boards are full, so for a rectangle no `WALL` survives; for a shaped board the uncovered cells stay `WALL` — identical to `generateLevel`'s grid (verified, including shaped levels).
- **getLevel return shape** matches what `startLevel` consumes from `generateLevel`: `{ cols, rows, shape, pieces, grid, count }` (no `score` — only tests/selection need that, and they call `generateLevel` directly).
- **Graceful fallback:** `gd.baked` is `null` until the loader succeeds; `getLevel` falls back to `generateLevel` whenever `baked` is null or `level` is out of range. The data file is an optimization, never a hard dependency.
- **Determinism:** `getLevel` from baked data is byte-identical to `generateLevel`; the freshness test enforces it, so the baked-vs-generated boundary at level 3000 is seamless.

---

### Task 1: `getLevel` + `gd.baked` plumbing (pure Node + tests)

**Files:**
- Modify: `src/balance.js` (add `bakeCount`)
- Modify: `src/generator.js` (add `getLevel`)
- Modify: `src/gameData.js` (add `baked`)
- Modify: `src/logic.js` (`startLevel` uses `getLevel`)
- Modify: `tests/generator.test.js`

- [ ] **Step 0: Branch.** `git checkout -b baked-levels main`

- [ ] **Step 1: Add `bakeCount` to `src/balance.js`** — directly after the `candidates: 10,` line (inside the `balance` object), add:

```js
  bakeCount: 3000,        // levels 1..bakeCount are pre-generated at build time
```

- [ ] **Step 2: Add the `getLevel` test to `tests/generator.test.js`** — add the import `getLevel` to the existing `from '../src/generator.js'` import list, then add at the end of the file:

```js
test('getLevel uses baked data when present and falls back to generation otherwise', () => {
  const baked = [];
  for (let lvl = 1; lvl <= 3; lvl++) {
    const g = generateLevel(lvl, balance);
    baked.push({ c: g.cols, r: g.rows, s: g.shape || null, p: g.pieces.map((pc) => [pc.dir, ...pc.cells]) });
  }
  // baked levels: getLevel rehydrates a board identical to generateLevel
  for (let lvl = 1; lvl <= 3; lvl++) {
    const g = generateLevel(lvl, balance);
    const b = getLevel(lvl, balance, baked);
    assert.equal(b.cols, g.cols);
    assert.equal(b.rows, g.rows);
    assert.equal(b.shape, g.shape || null);
    assert.equal(b.count, g.pieces.length);
    assert.deepEqual(b.pieces, g.pieces);
    assert.deepEqual(Array.from(b.grid), Array.from(g.grid));
  }
  // beyond the baked range -> generated
  assert.deepEqual(getLevel(50, balance, baked).pieces, generateLevel(50, balance).pieces);
  // no baked data -> generated
  assert.deepEqual(getLevel(2, balance, null).pieces, generateLevel(2, balance).pieces);
});
```

- [ ] **Step 3: Run `npm test` — expect FAIL** (`getLevel` not exported).

Run: `npm test`

- [ ] **Step 4: Implement `getLevel` in `src/generator.js`** — add directly after the `generateLevel` function:

```js
// Return the board for `level`: a rehydrated baked entry when `baked` has one
// (boards are a data lookup — no generation), else freshly generated. Baked
// entries store only pieces; the grid rebuilds by filling WALL and stamping
// piece cells, which reproduces generateLevel's grid exactly (full boards
// leave no EMPTY; shaped boards keep WALL outside the silhouette).
export function getLevel(level, balance, baked) {
  if (baked && level >= 1 && level <= baked.length) {
    const e = baked[level - 1];
    const pieces = e.p.map((a) => ({ dir: a[0], cells: a.slice(1) }));
    const grid = new Int16Array(e.c * e.r).fill(WALL);
    pieces.forEach((pc, id) => { for (const ci of pc.cells) grid[ci] = id; });
    return { cols: e.c, rows: e.r, shape: e.s, pieces, grid, count: pieces.length };
  }
  return generateLevel(level, balance);
}
```

- [ ] **Step 5: Run `npm test` — expect PASS: 58 tests, 0 failures.**

Run: `npm test`

- [ ] **Step 6: Add `baked` to `src/gameData.js`** — after the `dirty: true,` line is the last field; instead add `baked: null,` directly after the `nowMs: 0,` line (grouping it with the other main-owned fields):

```js
    nowMs: 0,               // stamped by main each frame; render-only countdowns
    baked: null,            // pre-baked levels array (set by main at boot), or null
```

- [ ] **Step 7: Wire `startLevel` to `getLevel` in `src/logic.js`** — change the import line

```js
import { generateLevel, findHint, rayClear, EMPTY } from './generator.js';
```

to

```js
import { getLevel, findHint, rayClear, EMPTY } from './generator.js';
```

and in `startLevel`, change the first line

```js
  const gen = generateLevel(gd.level, balance);
```

to

```js
  const gen = getLevel(gd.level, balance, gd.baked);
```

- [ ] **Step 8: Run `npm test` — expect PASS: 58 tests, 0 failures** (logic tests' `makeGd` sets `gd.baked = null` via alloc default, so they keep using generation).

Run: `npm test`

- [ ] **Step 9: Bump version and commit.** `VERSION = 'v0.1.36'` in `src/balance.js`, `"version": "0.1.36"` in `package.json`.

```bash
git add src/balance.js src/generator.js src/gameData.js src/logic.js tests/generator.test.js package.json
git commit -m "feat: getLevel(baked-or-generate) indirection + gd.baked plumbing (v0.1.36)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(Game still works identically — `gd.baked` is null until Task 3, so every level is generated.)

---

### Task 2: Bake script + shipped data file + freshness test

**Files:**
- Create: `scripts/bake-levels.js`
- Create: `levels.json.gz` (generated artifact, committed)
- Modify: `tests/generator.test.js` (freshness test)
- Modify: `.zipignore` (exclude `scripts/`)

- [ ] **Step 1: Create `scripts/bake-levels.js`** (full file):

```js
// Build step: generate + validate levels 1..bakeCount and write levels.json.gz
// at the game root. Run with: node scripts/bake-levels.js
// Re-run whenever generation logic (generator.js / shapes.js / balance.js) changes.
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { balance } from '../src/balance.js';
import { generateLevel, simulateWaves, EMPTY, DIRS } from '../src/generator.js';

const N = balance.bakeCount;
const out = [];
for (let lvl = 1; lvl <= N; lvl++) {
  const g = generateLevel(lvl, balance);
  // validate every shipped level — a bad board must never reach a player
  if (Array.from(g.grid).includes(EMPTY)) throw new Error(`level ${lvl}: holes (uncovered cells)`);
  if (!simulateWaves(g.pieces, g.grid, g.cols, g.rows).cleared) throw new Error(`level ${lvl}: unsolvable`);
  for (const p of g.pieces) {
    const h = p.cells[0];
    let x = (h % g.cols) + DIRS[p.dir][0], y = ((h / g.cols) | 0) + DIRS[p.dir][1];
    while (x >= 0 && x < g.cols && y >= 0 && y < g.rows) {
      if (p.cells.includes(y * g.cols + x)) throw new Error(`level ${lvl}: self-crossing arrow`);
      x += DIRS[p.dir][0]; y += DIRS[p.dir][1];
    }
  }
  out.push({ c: g.cols, r: g.rows, s: g.shape || null, p: g.pieces.map((pc) => [pc.dir, ...pc.cells]) });
  if (lvl % 500 === 0) console.log(`baked ${lvl}/${N}`);
}
const gz = gzipSync(JSON.stringify(out));
writeFileSync(new URL('../levels.json.gz', import.meta.url), gz);
console.log(`wrote levels.json.gz: ${out.length} levels, ${(gz.length / 1024).toFixed(0)} KB`);
```

- [ ] **Step 2: Run the bake script** — produces `levels.json.gz` at the game root (~50 s, validates all 3000):

Run: `node scripts/bake-levels.js`
Expected: prints `baked 500/3000` … `baked 3000/3000` then `wrote levels.json.gz: 3000 levels, ~1040 KB`, exit 0 (no validation throw).

- [ ] **Step 3: Add the freshness test to `tests/generator.test.js`** — add these imports at the top of the file (after the existing imports):

```js
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
```

then add at the end of the file:

```js
test('shipped levels.json.gz is fresh (matches current generateLevel)', () => {
  const baked = JSON.parse(gunzipSync(readFileSync(new URL('../levels.json.gz', import.meta.url))).toString());
  assert.ok(baked.length >= balance.bakeCount, `baked ${baked.length} levels < bakeCount ${balance.bakeCount}`);
  for (const lvl of [1, 2, 3, 9, 15, 67, 131, 500, 1500, 3000]) {
    const g = generateLevel(lvl, balance);
    const e = baked[lvl - 1];
    assert.equal(e.c, g.cols, `level ${lvl} cols`);
    assert.equal(e.r, g.rows, `level ${lvl} rows`);
    assert.equal(e.s, g.shape || null, `level ${lvl} shape`);
    assert.deepEqual(e.p, g.pieces.map((pc) => [pc.dir, ...pc.cells]), `level ${lvl} pieces stale — re-run scripts/bake-levels.js`);
  }
});
```

- [ ] **Step 4: Run `npm test` — expect PASS: 59 tests, 0 failures.**

Run: `npm test`

- [ ] **Step 5: Exclude `scripts/` from the deploy zip** — add a line to `.zipignore`:

```
scripts/*
```

(Verify `levels.json.gz` is NOT excluded — it sits at the game root and must ship.)

- [ ] **Step 6: Bump version and commit.** `VERSION = 'v0.1.37'`, package.json `0.1.37`.

```bash
git add scripts/bake-levels.js levels.json.gz tests/generator.test.js .zipignore src/balance.js package.json
git commit -m "feat: bake-levels build script + shipped levels.json.gz + freshness test (v0.1.37)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Boot loader + browser verification

**Files:**
- Modify: `src/main.js`

- [ ] **Step 1: Add the baked-levels loader to `src/main.js`** — add near the other SDK/load helpers (e.g., after `sdkLoad`):

```js
// Load + inflate the pre-baked levels (levels.json.gz) using the built-in
// DecompressionStream. Returns the level array, or null on any failure —
// the game then falls back to runtime generation (no hard dependency).
async function loadBakedLevels() {
  try {
    if (typeof DecompressionStream !== 'function') return null;
    const res = await fetch('levels.json.gz');
    if (!res.ok) return null;
    const stream = res.body.pipeThrough(new DecompressionStream('gzip'));
    const data = await new Response(stream).json();
    return Array.isArray(data) ? data : null;
  } catch (err) {
    return null;
  }
}
```

- [ ] **Step 2: Load baked levels during boot** — in `boot()`, the save-restore block is followed by `// FIX 1: mark boot complete …` and `booted = true;`. Insert the baked load immediately before `booted = true;` so the data is ready before the PLAY button (which calls `startLevel`) can fire:

```js
  gd.baked = await loadBakedLevels();
  // FIX 1: mark boot complete so pointerdown handler becomes active
  booted = true;
```

- [ ] **Step 3: Run `npm test`** — still 59 passing (main.js has no unit tests; this guards against an import/syntax slip).

Run: `npm test`

- [ ] **Step 4: Browser verification** (server on 8092 — `python3 -m http.server 8092` from the project root if not already up; Playwright at `/Users/nitzanwilnai/Programming/Claude/GamesPlatform/node_modules/playwright/index.mjs`; read every screenshot). Note: the local python server serves `levels.json.gz` as raw gzip bytes with no `Content-Encoding`, so the JS `DecompressionStream` inflates it — exactly the production path.
  - Fresh load → register `page.on('response')` and confirm the request for `levels.json.gz` returns **200** (proves the file is fetched and the loader path runs).
  - Jump to **level 15** (`localStorage.setItem('arrow-escape:progress', JSON.stringify({level:15, gold:999, sound:true, hearts:5, heartT:null}))` + reload + PLAY) → screenshot the 20×27 board; it must render a full, correct board instantly (this is a baked level).
  - Compute `generateLevel(15)` in Node (piece count + dims) and confirm the on-screen board matches — i.e., the baked board equals the generated one.
  - **Fallback past the baked range:** jump to **level 3500** → PLAY → a board still renders (runtime-generated). No console errors.
  - Tap a free piece on a baked level → it slides out normally (rehydrated grid is correct).
  - Zero console errors across the run.

- [ ] **Step 5: Confirm the data file ships** — verify `levels.json.gz` is included by the deploy zip rules and `scripts/` is excluded:

Run: `cd /Users/nitzanwilnai/Programming/Claude/JSGames/ArrowEscape && (zip -r /tmp/ae-test.zip . -x@.zipignore >/dev/null && unzip -l /tmp/ae-test.zip | grep -E 'levels.json.gz|scripts/' ; rm -f /tmp/ae-test.zip)`
Expected: `levels.json.gz` listed, no `scripts/` entries.

- [ ] **Step 6: Bump version and commit.** `VERSION = 'v0.1.38'`, package.json `0.1.38`.

```bash
git add src/main.js src/balance.js package.json
git commit -m "feat: boot loads pre-baked levels (DecompressionStream), runtime fallback (v0.1.38)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Post-deploy check (after the user merges + deploys).** On the live URL, confirm the baked file is served without double-encoding (a CDN that adds `Content-Encoding: gzip` to a `.gz` would make the JS double-inflate and silently fall back to generation — still playable, just no speedup):

Run: `curl -sI https://nitzan.games/play/arrow-escape/levels.json.gz | grep -iE 'http/|content-encoding|content-type'`
Expected: `200`, `content-type` of gzip/octet-stream, and **no** `content-encoding: gzip`. If `content-encoding: gzip` appears, rename the asset (e.g., `levels.bin`) so the CDN leaves it alone, and update the fetch path.

---

## Verification summary

| What | How |
|------|-----|
| Rehydration exactness | unit test: `getLevel` from a synthetic baked array deep-equals `generateLevel` (pieces + grid), incl. shaped levels |
| Fallback | unit test: `getLevel` past range / with `null` baked → generated; browser: level 3500 generates |
| Build-time validation | bake script throws on any non-full / unsolvable / self-crossing level across all 3000 |
| Freshness | unit test inflates the shipped file and matches sampled levels to `generateLevel` — stale data fails CI |
| Instant load | browser: baked level 15 renders immediately, matches the generated board |
| Packaging | zip dry-run lists `levels.json.gz`, excludes `scripts/` |
| Production serving | post-deploy `curl -I` confirms no double-encoding |
| No deploy mid-plan | main is live — all work stays on the `baked-levels` branch until the user verifies |

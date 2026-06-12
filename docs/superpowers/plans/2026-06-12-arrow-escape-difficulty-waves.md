# Arrow Escape — Difficulty Waves Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bracket ramp + every-5th-breather with oscillating difficulty waves — from level 4, board size, snake length (up to 16 cells), and hardest-of-pool candidate selection climb to a peak every 8 levels and drop back, with peaks rising across three progression tiers (to 12×16 boards).

**Architecture:** `rampFor`/`isBreather`/`bracketRange` are replaced by one pure function `waveFor(level, balance)` returning the interpolated `{cols, rows, minLen, maxLen, longBias, t, tutorial}` for a level; `pickIndexForLevel` maps the wave position `t` to a selection percentile (0.3 → 1.0). Shapes gain an optional per-shape dimension cap inside `maskFor` (only the diamond — its geometry collapses beyond 10×14, measured ~97% packing failure at 12×16). The tile-then-peel generator and all rendering/logic/monetization code are untouched.

**Tech Stack:** unchanged (vanilla JS, node --test, Playwright).

**Spec:** `docs/superpowers/specs/2026-06-10-arrow-escape-design.md` (rev 6, §Difficulty waves). Base: branch `main` @ 3f33364 (v0.1.29, deployed, 54 tests). **Work on a new branch:** `git checkout -b difficulty-waves main` — main is live.

**Feasibility (already measured against the real generator):** rectangles at 12×16/maxLen 16–18 pack with 0% candidate failure (mean ~26 pieces, ~10 pieces ≥10 cells, max-length snakes realized); hardest-of-10 selection with the new weights yields ~12 dependency waves and ~19% initially-free pieces at the tier-3 peak; all shapes pack 0% at 12×16/len16 except the diamond (capped).

---

## Shared concepts (read first)

- **Wave position:** `t = ((level − waveStart) % wavePeriod) / (wavePeriod − 1)` — 0 at a wave's start, exactly 1 on its last level. With `waveStart 4, wavePeriod 8`: waves are 4–11, 12–19, 20–27, … and levels 11, 19, 27, … are peaks.
- **Tiers** raise the ceilings; a level's tier is the first whose `maxLevel` ≥ level. Dims/maxLen interpolate `round(floor + (peak − floor) · t)`.
- **Tutorial:** levels < `waveStart` use fixed `balance.tutorial` settings, `t = 0`, easiest candidate.
- **Selection percentile:** tutorial → easiest; otherwise `p = wavePercentileMin + (1 − wavePercentileMin) · t` → `order[round(p · (n−1))]`. At `t = 1` that's the hardest of the pool.
- **Determinism reshuffle is accepted** (user-approved): every level's layout changes; saves (level/gold/hearts) are untouched.
- **Suite math:** generator tests 23 → 22 (rampFor→waveFor 1:1, isBreather test removed, breather-stats → wave-sanity 1:1, pickIndexForLevel rewritten 1:1), shapes 6 → 7 (+diamond cap), logic 25 unchanged. **Total stays 54.**

---

### Task 1: Wave system — balance, generator, shapes cap, tests (pure Node)

**Files:**
- Modify: `src/balance.js`
- Modify: `src/generator.js` (waveFor, pickIndexForLevel, generateLevel; delete isBreather/bracketRange/rampFor)
- Modify: `src/shapes.js` (diamond cap in SHAPES + maskFor clamp)
- Modify: `tests/generator.test.js`, `tests/shapes.test.js`

- [ ] **Step 0: Branch.** `git checkout -b difficulty-waves main`

- [ ] **Step 1: Update `src/balance.js`** — replace the block from the `// Level ramp brackets:` comment through `openBracketSpan: 100,   // virtual length of the final (Infinity) bracket` (i.e., the ramp array, `shapeStartLevel`, `shapeEvery`, `candidates`, `breatherEvery`, `percentileMin`, `percentileMax`, `openBracketSpan` lines — keep the NOTE comment about the determinism contract) with:

```js
  // Tutorial levels (1..waveStart-1): fixed gentle settings, easiest candidate.
  tutorial: { cols: 5, rows: 7, minLen: 2, maxLen: 5 },
  // From waveStart, difficulty oscillates in waves of wavePeriod levels: board
  // dims and maxLen interpolate floor -> peak across each wave, and candidate
  // selection climbs wavePercentileMin -> 1.0 (a wave's last level ships the
  // hardest board of its pool). Tiers raise the ceilings as players progress.
  waveStart: 4,
  wavePeriod: 8,
  wavePercentileMin: 0.3,
  minLen: 2,              // target floor past the tutorial — singles are packing fallback only
  // [maxLevel, floorCols, floorRows, floorMaxLen, peakCols, peakRows, peakMaxLen, longBias]
  tiers: [
    [27, 7, 10, 6, 10, 14, 12, 0.5],
    [59, 8, 11, 7, 11, 15, 14, 0.5],
    [Infinity, 8, 12, 8, 12, 16, 16, 0.6],
  ],
  shapeStartLevel: 10,    // first shaped level
  shapeEvery: 3,          // a shaped board every 3rd level from shapeStartLevel
  candidates: 10,         // boards generated per level, picked by wave percentile
```

and replace the `scoreWeights` line with:

```js
  scoreWeights: { wave: 1.5, blocked: 8.0, count: 0.02 },
```

(Keep `shapeStartLevel`/`shapeEvery` — they move into this block; make sure they aren't duplicated.)

- [ ] **Step 2: Update `tests/generator.test.js`.**

2a. In the imports from `'../src/generator.js'`: replace `rampFor` with `waveFor` and delete `isBreather` and `bracketRange` if present.

2b. Replace the test `'rampFor returns the right bracket'` with:

```js
test('waveFor: tutorial, wave interpolation, tier ceilings', () => {
  assert.deepEqual(waveFor(1, balance),
    { cols: 5, rows: 7, minLen: 2, maxLen: 5, longBias: 0, t: 0, tutorial: true });
  const start = waveFor(4, balance); // wave start = tier floor
  assert.equal(start.t, 0);
  assert.deepEqual([start.cols, start.rows, start.maxLen], [7, 10, 6]);
  const peak = waveFor(11, balance); // last level of the wave = tier peak
  assert.equal(peak.t, 1);
  assert.deepEqual([peak.cols, peak.rows, peak.maxLen], [10, 14, 12]);
  const next = waveFor(12, balance); // next wave drops back to the floor
  assert.equal(next.t, 0);
  assert.deepEqual([next.cols, next.rows, next.maxLen], [7, 10, 6]);
  const t3 = waveFor(67, balance); // tier-3 peak: (67-4)%8 = 7 -> t = 1
  assert.deepEqual([t3.cols, t3.rows, t3.maxLen, t3.longBias], [12, 16, 16, 0.6]);
});
```

2c. Delete the test `'isBreather flags every 5th level except level 1'`.

2d. Replace the test `'pickIndexForLevel: breathers take the easiest candidate, ramp rises within a bracket'` with:

```js
test('pickIndexForLevel climbs the wave from gentle to the hardest candidate', () => {
  const scores = [5, 9, 1, 7, 3, 8, 2, 6, 4, 10];
  // sorted candidate order by score: idx 2(1) 6(2) 4(3) 8(4) 0(5) 7(6) 3(7) 5(8) 1(9) 9(10)
  assert.equal(pickIndexForLevel(1, scores, balance), 2,  'tutorial -> easiest');
  assert.equal(pickIndexForLevel(4, scores, balance), 8,  'wave start -> p=0.3 -> order[3]');
  assert.equal(pickIndexForLevel(8, scores, balance), 3,  't=4/7 -> p=0.7 -> order[6]');
  assert.equal(pickIndexForLevel(11, scores, balance), 9, 'wave peak -> hardest');
});
```

2e. Replace the test `'breather boards are genuinely easier than neighbors in the wide brackets'` with:

```js
test('difficulty waves: within-wave rise, wave-start dip, tier growth, gentle tutorial', () => {
  const score = (lvl) => generateLevel(lvl, balance).score;
  let startSum = 0, peakSum = 0;
  for (const w of [4, 12, 20]) { startSum += score(w); peakSum += score(w + 7); }
  assert.ok(peakSum / 3 > startSum / 3, 'tier-1 wave peaks above wave starts');
  assert.ok(score(12) < score(11), 'a new wave dips below the previous peak');
  let t1 = 0, t3 = 0;
  for (const w of [11, 19, 27]) t1 += score(w);
  for (const w of [67, 75, 83]) t3 += score(w);
  assert.ok(t3 / 3 > t1 / 3, 'tier-3 peaks harder than tier-1 peaks');
  const tut = Math.max(score(1), score(2), score(3));
  assert.ok(tut < startSum / 3, 'tutorial below tier-1 wave starts');
});
```

2f. In the test `'level 10 is the heart: mask applied, full, solvable, deterministic'`: replace the hardcoded dims line `const m = maskFor('heart', 7, 10); // level 10 bracket dims` with:

```js
  const w = waveFor(10, balance);
  const m = maskFor('heart', w.cols, w.rows); // dims come from the wave now
```

and replace `rampFor(10, balance).maxLen` with `waveFor(10, balance).maxLen`.

2g. In the test `'every shaped level through 100 is shaped, full, and solvable'`: replace `rampFor(lvl, balance).maxLen` with `waveFor(lvl, balance).maxLen`.

2h. In the test `'generateLevel is deterministic, full, and always solvable'`: replace `const { maxLen } = rampFor(level, balance);` with `const { maxLen } = waveFor(level, balance);`.

- [ ] **Step 3: Add to `tests/shapes.test.js`** (at the end):

```js
test('the diamond mask is capped at 10x14 regardless of requested dims', () => {
  const m = maskFor('diamond', 12, 16);
  assert.ok(m.cols <= 10 && m.rows <= 14, `got ${m.cols}x${m.rows}`);
  const small = maskFor('diamond', 8, 12); // below the cap: unaffected
  assert.ok(small.cols <= 8 && small.rows <= 12);
});
```

- [ ] **Step 4: Run `npm test` — expect FAIL** (waveFor not exported, balance fields missing, diamond cap absent).

- [ ] **Step 5: Update `src/shapes.js`** — give the diamond a cap and teach `maskFor` to honor it. Replace the diamond's comment + entry with:

```js
  // 1.3 (not the pointier 1.02): 4-wide tips are the narrowest the tiler can
  // reliably pack — and only up to 10x14: beyond that the stair corners
  // multiply (97% packing failure at 12x16), so the diamond carries a
  // dimension cap that maskFor applies before sampling.
  diamond:   { inside: (x, y) => Math.abs(x) + Math.abs(y) <= 1.3, bbox: [-1, 1, -1, 1], cap: [10, 14] },
```

and in `maskFor`, replace the destructuring line `const { inside, bbox: [x0, x1, y0, y1] } = SHAPES[shapeKey];` with:

```js
  const shape = SHAPES[shapeKey];
  if (shape.cap) {
    cols = Math.min(cols, shape.cap[0]);
    rows = Math.min(rows, shape.cap[1]);
  }
  const { inside, bbox: [x0, x1, y0, y1] } = shape;
```

- [ ] **Step 6: Update `src/generator.js`.**

6a. Replace the whole `rampFor` function with:

```js
// Wave parameters for a level. Tutorial levels (< waveStart) use the fixed
// gentle settings at t = 0. From waveStart, t sweeps 0 -> 1 across each
// wavePeriod levels, and board dims / maxLen interpolate from the level's
// tier floor to its peak — the difficulty wave: gradually harder, then easy
// again, then harder, with ceilings rising across tiers.
export function waveFor(level, balance) {
  if (level < balance.waveStart) {
    const tut = balance.tutorial;
    return {
      cols: tut.cols, rows: tut.rows, minLen: tut.minLen, maxLen: tut.maxLen,
      longBias: 0, t: 0, tutorial: true,
    };
  }
  const t = ((level - balance.waveStart) % balance.wavePeriod) / (balance.wavePeriod - 1);
  for (const [maxLevel, fc, fr, fl, pc, pr, pl, longBias] of balance.tiers) {
    if (level <= maxLevel) {
      return {
        cols: Math.round(fc + (pc - fc) * t),
        rows: Math.round(fr + (pr - fr) * t),
        minLen: balance.minLen,
        maxLen: Math.round(fl + (pl - fl) * t),
        longBias, t, tutorial: false,
      };
    }
  }
}
```

6b. Delete the `isBreather` and `bracketRange` functions entirely.

6c. Replace `pickIndexForLevel` with:

```js
// Pick a candidate by percentile at the wave position: tutorial levels take
// the easiest board; wave levels climb from wavePercentileMin at a wave's
// start to 1.0 at its peak — the hardest board the pool produced.
export function pickIndexForLevel(level, scores, balance) {
  const order = scores.map((s, i) => i).sort((a, b) => scores[a] - scores[b] || a - b);
  const { t, tutorial } = waveFor(level, balance);
  if (tutorial) return order[0];
  const p = balance.wavePercentileMin + (1 - balance.wavePercentileMin) * t;
  return order[Math.round(p * (order.length - 1))];
}
```

6d. In `generateLevel`, replace the line `const { cols: rampCols, rows: rampRows, minLen, maxLen, longBias } = rampFor(level, balance);` with:

```js
  const { cols: waveCols, rows: waveRows, minLen, maxLen, longBias } = waveFor(level, balance);
```

and the two references `rampCols, rampRows` (in `let cols = rampCols, rows = rampRows` and `maskFor(shape, rampCols, rampRows)`) with `waveCols, waveRows`. (maskFor itself applies any per-shape cap and returns the final dims.)

- [ ] **Step 7: Run `npm test` — expect PASS: 54 tests, 0 failures** (22 generator + 7 shapes + 25 logic).

If the wave-sanity test fails: print the candidate score spread for the failing levels and tune `scoreWeights` or `wavePercentileMin` in balance.js — do NOT weaken assertions. If a shaped level fails to generate, check the cap clamp runs before sampling in `maskFor`.

- [ ] **Step 8: Difficulty sanity print** (eyeball the curve):

```bash
node -e "
import('./src/generator.js').then(async (G) => {
  const { balance } = await import('./src/balance.js');
  for (let lvl = 1; lvl <= 28; lvl++) {
    const g = G.generateLevel(lvl, balance);
    let free = 0;
    for (let p = 0; p < g.pieces.length; p++) {
      const h = g.pieces[p].cells[0];
      if (G.rayClear(g.grid, g.cols, g.rows, p, h % g.cols, (h / g.cols) | 0, g.pieces[p].dir)) free++;
    }
    const longest = Math.max(...g.pieces.map(p => p.cells.length));
    console.log(String(lvl).padStart(3), (g.cols + 'x' + g.rows).padEnd(6),
      'pieces', String(g.count).padStart(2), 'longest', String(longest).padStart(2),
      'free', String(free).padStart(2), 'score', g.score.toFixed(1), g.shape || '');
  }
});
"
```

Expected: scores climb 4→11, dip at 12, climb again to 19, dip at 20; board dims grow within each wave; longest snakes reach 11–12 near peaks.

- [ ] **Step 9: Bump version and commit.** `VERSION = 'v0.1.30'` in src/balance.js, `"version": "0.1.30"` in package.json.

```bash
git add src/balance.js src/generator.js src/shapes.js tests/ package.json
git commit -m "feat: difficulty waves — oscillating curve, snakes to 16 cells, boards to 12x16, hardest-of-pool peaks (v0.1.30)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Browser verification (no code changes expected)

**Files:** none expected; any fix lands in the touched file with a bump to v0.1.31.

- [ ] **Step 1: Verify in the browser** (server on 8092 or start one; Playwright at `/Users/nitzanwilnai/Programming/Claude/GamesPlatform/node_modules/playwright/index.mjs`; jump levels via `localStorage.setItem('arrow-escape:progress', JSON.stringify({level: N, gold: 999, sound: true, hearts: 5, heartT: null}))` + reload + PLAY at canvas (540, 1250); geometry `cell = min(960/cols, 1160/rows, 150)`; read every screenshot):
  - **Level 1** (tutorial 5×7): still gentle and readable.
  - **Level 4** (wave floor 7×10): moderate.
  - **Level 11** (tier-1 peak, 10×14, snakes to ~12): visibly hard — long winding snakes, few obvious exits; compare against the reference feel.
  - **Level 75** (tier-3 peak rectangle, 12×16, snakes to 16, ~72px cells): the stress case — pieces and arrowheads must still be readable and tappable; a 16-cell snake's slide animation must look right (tap a free piece computed in Node).
  - **Level 67** (tier-3 peak but a DIAMOND level — the per-shape cap bites): board renders within 10×14, plays normally. (Level 13 is also a diamond but sits below the cap at its wave position.)
  - Zero console errors across the run.

- [ ] **Step 2: If everything passes, no commit. If a visual fix is required**, apply it minimally, re-run `npm test` (54), bump to v0.1.31, and commit with an accurate message.

---

## Verification summary

| What | How |
|------|-----|
| Wave math | waveFor unit tests (tutorial, t=0/1, dip, tier ceilings); pickIndexForLevel exact picks |
| Curve shape | generateLevel score comparisons (peak>start, dip after peak, tier growth, gentle tutorial) |
| Long snakes feasible | pre-measured: 0% null at 12×16/len16-18; suite sweeps re-verify solvability/coverage |
| Diamond cap | shapes test (12×16 request → ≤10×14) + shaped-level sweep |
| Legibility at 72px | Playwright screenshots at levels 11/67, read by the controller |
| No deploy | main is live — user verifies before merge/deploy |

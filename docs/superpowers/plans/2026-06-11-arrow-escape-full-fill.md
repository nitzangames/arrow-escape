# Arrow Escape — Full-Fill Boards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every cell of the board is covered by exactly one snake (lengths 1–7); the grid becomes mask-ready (`WALL` cells) so future versions can ship heart/diamond-shaped boards with no generator changes.

**Architecture:** Keep the reverse-construction solvability invariant (each piece's exit ray clear of *already-placed* pieces and walls at placement time; rays over still-empty cells are fine because those pieces leave earlier). Change placement: each snake grows from the **lowest-index empty cell** (so no cell is stranded and progress is monotonic), walks through empty cells toward a target length sampled with a per-bracket **long bias**, then picks a head end whose forced direction (colinear with the end segment) has a clear ray — shrinking the walk, down to a length-1 piece with any clear direction, if needed. A wedged board restarts deterministically within the same rng stream. Logic, rendering, audio, main: unchanged.

**Tech Stack:** unchanged (vanilla JS, node --test, Playwright for visual verification).

**Spec:** `docs/superpowers/specs/2026-06-10-arrow-escape-design.md` (rev 3). Base: branch `v1-implementation` @ f1da723 (v0.1.16), 28 tests passing.

---

## Shared concepts (read first)

- **Piece:** `{ cells: [headCellIdx, ...bodyCellIdxs], dir }` — cells are a 4-connected path, head first. `dir` (0=up 1=right 2=down 3=left) points away from the body: for length ≥ 2, `cells[1]` is exactly `head − DIRS[dir]` (the arrowhead continues the path's end segment).
- **Grid:** `Int16Array(cols*rows)`, value = piece index, `EMPTY` (−1), or `WALL` (−2). WALL cells block rays exactly like pieces, never hold a piece, and are preserved by wave simulation. In v1 every generated board has zero WALLs (all-open rectangle), but `buildBoard` accepts an optional mask and tests cover it.
- **Full fill:** after generation, no cell is `EMPTY` — every open cell belongs to exactly one piece.
- **Long bias:** target length `len = min(maxLen, minLen + floor(t·(maxLen−minLen+1)))` where `t = bias + (1−bias)·rng()`. Bias 0 = uniform; bias 1 = always maxLen. Actual lengths can fall below target when the walk gets boxed in — length 1 is the always-legal fallback that makes perfect packing reliable.
- **Wedge & restart:** a placement fails only if even a length-1 piece at the seed cell has all four rays blocked by placed pieces/walls. `buildBoard` then restarts the whole board (fresh grid, same continuing rng stream), up to 50 attempts, and returns `null` if all fail. `generateLevel` skips null candidates (tests confirm this never actually happens across the ramp).

---

### Task 1: Full-fill generator — balance ramp, generator rework, tests

All pure-Node code. TDD: rewrite the test file first, watch it fail, then implement.

**Files:**
- Modify: `src/balance.js` (ramp shape)
- Rewrite: `src/generator.js`
- Rewrite: `tests/generator.test.js`
- Modify: `tests/logic.test.js` (one test gains a full-coverage assertion)

- [ ] **Step 1: Update the ramp in `src/balance.js`** (everything else in the file stays):

```js
  // Level ramp brackets: [maxLevel, cols, rows, minLen, maxLen, longBias]
  // Boards are always 100% filled; piece count emerges from the length mix.
  ramp: [
    [10, 4, 5, 1, 4, 0],
    [30, 5, 7, 1, 5, 0.2],
    [60, 6, 8, 1, 5, 0.35],
    [120, 7, 9, 1, 6, 0.5],
    [300, 7, 10, 1, 7, 0.6],
    [Infinity, 8, 11, 1, 7, 0.7],
  ],
```

- [ ] **Step 2: Rewrite `tests/generator.test.js`** (full file):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { balance } from '../src/balance.js';
import {
  EMPTY, WALL, DIRS, mulberry32, levelSeed, rampFor, rayClear,
  buildBoard, simulateWaves, scoreBoard, isBreather,
  pickIndexForLevel, generateLevel, findHint,
} from '../src/generator.js';

// Hand-built board: defs = [{cells, dir}, ...] — sparse boards are fine for
// the analysis helpers (only the generator promises full fill).
function makeBoard(cols, rows, defs) {
  const grid = new Int16Array(cols * rows).fill(EMPTY);
  const pieces = defs.map((d, id) => {
    for (const ci of d.cells) grid[ci] = id;
    return { cells: d.cells, dir: d.dir };
  });
  return { pieces, grid };
}

// Assert a board is well-formed: cells partition the open grid, paths are
// 4-connected, arrowheads continue the end segment, lengths within bounds.
function assertWellFormed(b, cols, rows, maxLen) {
  const seen = new Set();
  b.pieces.forEach((piece, id) => {
    assert.ok(piece.cells.length >= 1 && piece.cells.length <= maxLen,
      `piece ${id} length ${piece.cells.length}`);
    assert.ok(piece.dir >= 0 && piece.dir <= 3);
    piece.cells.forEach((ci) => {
      assert.ok(!seen.has(ci), 'cell overlap');
      seen.add(ci);
      assert.equal(b.grid[ci], id, 'grid consistency');
    });
    for (let j = 1; j < piece.cells.length; j++) {
      const a = piece.cells[j - 1], c2 = piece.cells[j];
      const dc = Math.abs((a % cols) - (c2 % cols));
      const dr = Math.abs(((a / cols) | 0) - ((c2 / cols) | 0));
      assert.equal(dc + dr, 1, 'path connectivity');
    }
    if (piece.cells.length > 1) {
      const head = piece.cells[0];
      const hc = head % cols, hr = (head / cols) | 0;
      const expected = (hr - DIRS[piece.dir][1]) * cols + (hc - DIRS[piece.dir][0]);
      assert.equal(piece.cells[1], expected, 'arrowhead continues the end segment');
    }
  });
  for (let i = 0; i < b.grid.length; i++) {
    if (b.grid[i] === WALL) assert.ok(!seen.has(i), 'piece on a wall');
    else assert.ok(seen.has(i), `cell ${i} not covered — board not full`);
  }
}

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
  assert.deepEqual(rampFor(1, balance), { cols: 4, rows: 5, minLen: 1, maxLen: 4, longBias: 0 });
  assert.deepEqual(rampFor(11, balance), { cols: 5, rows: 7, minLen: 1, maxLen: 5, longBias: 0.2 });
  assert.deepEqual(rampFor(301, balance), { cols: 8, rows: 11, minLen: 1, maxLen: 7, longBias: 0.7 });
});

test('rayClear sees other pieces but exempts own body', () => {
  // 4×1: piece 1 at cell 0; piece 0 occupies cells 1,2 (head 1, pointing left)
  const { grid } = makeBoard(4, 1, [
    { cells: [1, 2], dir: 3 },
    { cells: [0], dir: 3 },
  ]);
  assert.equal(rayClear(grid, 4, 1, 0, 1, 0, 3), false); // head 1 left: blocked by piece 1
  assert.equal(rayClear(grid, 4, 1, 0, 1, 0, 1), true);  // right: cell 2 is own body, cell 3 empty
  assert.equal(rayClear(grid, 4, 1, 1, 0, 0, 3), true);  // piece 1 exits left at the edge
});

test('WALL cells block rays like pieces', () => {
  const { grid } = makeBoard(4, 1, [{ cells: [0], dir: 1 }]);
  grid[2] = WALL;
  assert.equal(rayClear(grid, 4, 1, 0, 0, 0, 1), false); // right: wall at cell 2
  assert.equal(rayClear(grid, 4, 1, 0, 0, 0, 3), true);  // left: board edge
});

test('buildBoard fills every cell with well-formed snakes, deterministically', () => {
  const cols = 6, rows = 8;
  const b1 = buildBoard(mulberry32(7), cols, rows, 1, 5, 0.3);
  const b2 = buildBoard(mulberry32(7), cols, rows, 1, 5, 0.3);
  assert.ok(b1, 'buildBoard returned null');
  assert.deepEqual(b1.pieces, b2.pieces);
  assert.deepEqual(Array.from(b1.grid), Array.from(b2.grid));
  assertWellFormed(b1, cols, rows, 5);
  assert.ok(b1.pieces.some((p) => p.cells.length >= 3), 'no long snakes at all');
});

test('buildBoard respects a mask: walls stay walls, open cells fill, board solves', () => {
  // 4×4 with the four corners masked out
  const cols = 4, rows = 4;
  const mask = new Uint8Array(cols * rows).fill(1);
  for (const i of [0, 3, 12, 15]) mask[i] = 0;
  const b = buildBoard(mulberry32(11), cols, rows, 1, 4, 0.3, mask);
  assert.ok(b, 'masked buildBoard returned null');
  for (const i of [0, 3, 12, 15]) assert.equal(b.grid[i], WALL);
  assertWellFormed(b, cols, rows, 4);
  assert.equal(simulateWaves(b.pieces, b.grid, cols, rows).cleared, true);
});

test('every built board is full and solvable by wave removal', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const b = buildBoard(mulberry32(seed), 8, 11, 1, 7, 0.7);
    assert.ok(b, `seed ${seed} returned null`);
    assertWellFormed(b, 8, 11, 7);
    const { cleared } = simulateWaves(b.pieces, b.grid, 8, 11);
    assert.ok(cleared, `seed ${seed} did not clear`);
  }
});

test('simulateWaves counts waves and does not mutate', () => {
  // 4×1 chain of singles all pointing left → 4 waves
  const { pieces, grid } = makeBoard(4, 1, [
    { cells: [0], dir: 3 }, { cells: [1], dir: 3 },
    { cells: [2], dir: 3 }, { cells: [3], dir: 3 },
  ]);
  const before = Array.from(grid);
  const r = simulateWaves(pieces, grid, 4, 1);
  assert.equal(r.cleared, true);
  assert.equal(r.waves, 4);
  assert.deepEqual(Array.from(grid), before);
});

test('simulateWaves reports cleared:false on a deadlock', () => {
  // 2×1 mutual block: two singles facing each other
  const { pieces, grid } = makeBoard(2, 1, [
    { cells: [0], dir: 1 },
    { cells: [1], dir: 3 },
  ]);
  assert.equal(simulateWaves(pieces, grid, 2, 1).cleared, false);
});

test('scoreBoard ranks a forced chain above a free spread; empty board is 0', () => {
  const chain = makeBoard(4, 1, [
    { cells: [0], dir: 3 }, { cells: [1], dir: 3 },
    { cells: [2], dir: 3 }, { cells: [3], dir: 3 },
  ]);
  const spread = makeBoard(4, 4, [
    { cells: [0], dir: 0 }, { cells: [5], dir: 3 },
    { cells: [10], dir: 1 }, { cells: [15], dir: 2 },
  ]);
  const w = balance.scoreWeights;
  assert.ok(scoreBoard(chain.pieces, chain.grid, 4, 1, w) > scoreBoard(spread.pieces, spread.grid, 4, 4, w));
  assert.equal(scoreBoard([], new Int16Array(16).fill(EMPTY), 4, 4, w), 0);
});

test('isBreather flags every 5th level except level 1', () => {
  assert.ok(isBreather(10, balance));
  assert.ok(isBreather(25, balance));
  assert.ok(!isBreather(11, balance));
  assert.ok(!isBreather(1, balance));
});

test('pickIndexForLevel: breathers take the easiest candidate, ramp rises within a bracket', () => {
  const scores = [5, 9, 1, 7, 3, 8, 2, 6];
  assert.equal(pickIndexForLevel(10, scores, balance), 2);
  const early = pickIndexForLevel(31, scores, balance);
  const late = pickIndexForLevel(59, scores, balance);
  assert.ok(scores[late] > scores[early]);
  assert.equal(pickIndexForLevel(31, scores, balance), early);
});

test('generateLevel is deterministic, full, and always solvable', () => {
  for (const level of [1, 7, 25, 55, 150, 400]) {
    const g1 = generateLevel(level, balance);
    const g2 = generateLevel(level, balance);
    assert.deepEqual(g1.pieces, g2.pieces, `level ${level} not deterministic`);
    assert.deepEqual(Array.from(g1.grid), Array.from(g2.grid));
    const { maxLen } = rampFor(level, balance);
    assertWellFormed(g1, g1.cols, g1.rows, maxLen);
    const { cleared } = simulateWaves(g1.pieces, g1.grid, g1.cols, g1.rows);
    assert.ok(cleared, `level ${level} not solvable`);
    assert.ok(g1.count > 0);
  }
});

test('generation never wedges across the whole early game', () => {
  for (let lvl = 1; lvl <= 120; lvl++) {
    const g = generateLevel(lvl, balance);
    assert.ok(!Array.from(g.grid).includes(EMPTY), `level ${lvl} has holes`);
  }
});

test('breather boards are genuinely easier than neighbors in every bracket', () => {
  const brackets = [[11, 30], [31, 60], [61, 120], [121, 200]];
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

test('findHint returns the only free piece', () => {
  // 3×1 singles all pointing left: only piece 0 is free
  const { pieces, grid } = makeBoard(3, 1, [
    { cells: [0], dir: 3 }, { cells: [1], dir: 3 }, { cells: [2], dir: 3 },
  ]);
  assert.equal(findHint(pieces, grid, 3, 1), 0);
});

test('findHint prefers the free piece that unblocks the most others', () => {
  // 3×2: piece 0 at (1,0) up — free, unblocks nothing;
  //      piece 1 at (2,0) right — free, unblocks piece 2;
  //      piece 2 at (2,1) up — blocked by piece 1.
  const { pieces, grid } = makeBoard(3, 2, [
    { cells: [1], dir: 0 },
    { cells: [2], dir: 1 },
    { cells: [5], dir: 0 },
  ]);
  assert.equal(findHint(pieces, grid, 3, 2), 1);
});

test('findHint returns -1 on an empty board, never mutates, and respects alive', () => {
  assert.equal(findHint([], new Int16Array(9).fill(EMPTY), 3, 3), -1);
  const g = generateLevel(33, balance);
  const before = Array.from(g.grid);
  const idx = findHint(g.pieces, g.grid, g.cols, g.rows);
  assert.deepEqual(Array.from(g.grid), before);
  assert.ok(idx >= 0);
  const head = g.pieces[idx].cells[0];
  assert.ok(rayClear(g.grid, g.cols, g.rows, idx, head % g.cols, (head / g.cols) | 0, g.pieces[idx].dir));
  const alive = new Uint8Array(g.pieces.length);
  alive[idx] = 1;
  assert.equal(findHint(g.pieces, g.grid, g.cols, g.rows, alive), idx);
});
```

- [ ] **Step 3: Run `npm test` — expect FAIL** (`WALL` not exported, `buildBoard` signature changed, full-coverage assertions fail).

Run: `npm test`

- [ ] **Step 4: Rewrite `src/generator.js`** (full file — `mulberry32`, `levelSeed`, `rayClear`, `simulateWaves`, `scoreBoard`, `isBreather`, `bracketRange`, `pickIndexForLevel`, `findHint` bodies are identical to the current file; what changes is the header comment, `WALL`, `rampFor`, `sampleLen`/`headConfig`/`placeSnake`/`buildBoard`, and `generateLevel`):

```js
// Pure board generation and analysis. No DOM — runs under Node for tests.
//
// A piece is a snake: an ordered list of cell indices (head first) forming a
// 4-connected path, plus the head's pointing direction (away from the body,
// colinear with the path's end segment). The grid maps each cell to its
// piece index, EMPTY (-1), or WALL (-2: outside the playable mask — blocks
// rays like a piece, never holds one). Generated boards are FULL: every open
// cell belongs to exactly one piece. Index i = r*cols+c; directions
// 0=up 1=right 2=down 3=left.

export const EMPTY = -1;
export const WALL = -2;
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
  for (const [maxLevel, cols, rows, minLen, maxLen, longBias] of balance.ramp) {
    if (level <= maxLevel) return { cols, rows, minLen, maxLen, longBias };
  }
}

// True if the straight ray from a head (exclusive) to the edge is free of
// other pieces and walls. selfId cells never block: a piece's own body can't
// obstruct its slide (the body vacates along the same track).
export function rayClear(grid, cols, rows, selfId, c, r, dir) {
  const dx = DIRS[dir][0], dy = DIRS[dir][1];
  let x = c + dx, y = r + dy;
  while (x >= 0 && x < cols && y >= 0 && y < rows) {
    const v = grid[y * cols + x];
    if (v !== EMPTY && v !== selfId) return false;
    x += dx; y += dy;
  }
  return true;
}

// Target length skewed toward maxLen: t = bias + (1-bias)·u, so bias 0 is
// uniform and bias 1 always picks maxLen. Walks that get boxed in fall short
// of the target, so actual lengths spread below it.
function sampleLen(rng, minLen, maxLen, longBias) {
  const t = longBias + (1 - longBias) * rng();
  return Math.min(maxLen, minLen + ((t * (maxLen - minLen + 1)) | 0));
}

// If `startEnd`, the head is cells[0] (the walk's seed); otherwise the far
// end. The head's direction is forced: it continues the path's end segment.
// Returns the oriented candidate piece, or null if its exit ray is blocked.
function headConfig(grid, cols, rows, id, cells, startEnd) {
  const ordered = startEnd ? cells.slice() : cells.slice().reverse();
  const head = ordered[0], behind = ordered[1];
  const hc = head % cols, hr = (head / cols) | 0;
  const dc = hc - (behind % cols), dr = hr - ((behind / cols) | 0);
  const dir = dc === 1 ? 1 : dc === -1 ? 3 : dr === 1 ? 2 : 0;
  return rayClear(grid, cols, rows, id, hc, hr, dir) ? { cells: ordered, dir } : null;
}

// Grow one snake covering `start` (the lowest-index empty cell): random-walk
// through empty cells toward the sampled target length, then pick a head end
// with a clear exit ray. If neither end works, shrink the walk and retry;
// a length-1 piece may point in any clear direction. Commits the piece into
// grid/pieces and returns true, or returns false if even a single can't
// escape (board wedged — caller restarts).
function placeSnake(rng, grid, cols, rows, pieces, start, minLen, maxLen, longBias) {
  const target = sampleLen(rng, minLen, maxLen, longBias);
  const cells = [start];
  let cur = start;
  while (cells.length < target) {
    const d0 = (rng() * 4) | 0;
    let next = -1;
    for (let k = 0; k < 4; k++) {
      const wd = (d0 + k) % 4;
      const nx = (cur % cols) + DIRS[wd][0];
      const ny = ((cur / cols) | 0) + DIRS[wd][1];
      if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
      const ni = ny * cols + nx;
      if (grid[ni] !== EMPTY || cells.includes(ni)) continue;
      next = ni;
      break;
    }
    if (next < 0) break; // boxed in — settle for the length we got
    cells.push(next);
    cur = next;
  }
  const id = pieces.length;
  while (cells.length > 1) {
    const far = headConfig(grid, cols, rows, id, cells, false);
    const seed = headConfig(grid, cols, rows, id, cells, true);
    const pick = far && seed ? (rng() < 0.5 ? far : seed) : (far || seed);
    if (pick) {
      for (const ci of pick.cells) grid[ci] = id;
      pieces.push(pick);
      return true;
    }
    cells.pop(); // both ends blocked — try a shorter snake
  }
  const d0 = (rng() * 4) | 0;
  for (let k = 0; k < 4; k++) {
    const dir = (d0 + k) % 4;
    if (rayClear(grid, cols, rows, id, start % cols, (start / cols) | 0, dir)) {
      grid[start] = id;
      pieces.push({ cells: [start], dir });
      return true;
    }
  }
  return false;
}

// Reverse construction with full fill: a piece may only be placed where its
// head's exit ray is clear of already-placed pieces and walls — rays over
// still-empty cells are fine, those pieces are placed later and removed
// earlier — so removing pieces in reverse placement order always clears the
// board. Growing each snake from the lowest-index empty cell guarantees no
// cell is stranded. A wedged packing restarts (bounded, same rng stream —
// still deterministic); returns null if every attempt fails, and callers
// must skip the candidate. `mask` (optional Uint8Array, 1 = open) carves the
// playable shape; v1 always passes no mask (all-open rectangle).
export function buildBoard(rng, cols, rows, minLen, maxLen, longBias, mask) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const grid = new Int16Array(cols * rows).fill(EMPTY);
    if (mask) {
      for (let i = 0; i < grid.length; i++) if (!mask[i]) grid[i] = WALL;
    }
    const pieces = [];
    let wedged = false;
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] !== EMPTY) continue;
      if (!placeSnake(rng, grid, cols, rows, pieces, i, minLen, maxLen, longBias)) {
        wedged = true;
        break;
      }
    }
    if (!wedged) return { pieces, grid };
  }
  return null;
}

// Solve by waves: repeatedly remove every currently-free piece at once.
// waves = number of passes (sequential-dependency depth). Non-mutating.
export function simulateWaves(pieces, grid, cols, rows) {
  const g = Int16Array.from(grid);
  const alive = new Uint8Array(pieces.length).fill(1);
  let remaining = pieces.length;
  let waves = 0;
  while (remaining > 0) {
    const freeIds = [];
    for (let p = 0; p < pieces.length; p++) {
      if (!alive[p]) continue;
      const head = pieces[p].cells[0];
      if (rayClear(g, cols, rows, p, head % cols, (head / cols) | 0, pieces[p].dir)) freeIds.push(p);
    }
    if (freeIds.length === 0) return { waves, cleared: false };
    for (const p of freeIds) {
      alive[p] = 0;
      for (const ci of pieces[p].cells) g[ci] = EMPTY;
    }
    remaining -= freeIds.length;
    waves++;
  }
  return { waves, cleared: true };
}

// Difficulty score: more waves (forced ordering), more initially-blocked
// pieces, and more pieces overall = harder. Weights in balance.scoreWeights.
export function scoreBoard(pieces, grid, cols, rows, weights) {
  if (pieces.length === 0) return 0;
  let freeCount = 0;
  for (let p = 0; p < pieces.length; p++) {
    const head = pieces[p].cells[0];
    if (rayClear(grid, cols, rows, p, head % cols, (head / cols) | 0, pieces[p].dir)) freeCount++;
  }
  const freeRatio = freeCount / pieces.length;
  const { waves } = simulateWaves(pieces, grid, cols, rows);
  return waves * weights.wave + (1 - freeRatio) * weights.blocked + pieces.length * weights.count;
}

export function isBreather(level, balance) {
  return level > 1 && level % balance.breatherEvery === 0;
}

// Bracket [start..end] containing `level` (end of the open last bracket is
// virtualized to openBracketSpan levels).
export function bracketRange(level, balance) {
  let start = 1;
  for (const [maxLevel] of balance.ramp) {
    if (level <= maxLevel) {
      const end = maxLevel === Infinity ? start + balance.openBracketSpan - 1 : maxLevel;
      return { start, end };
    }
    start = maxLevel + 1;
  }
}

// Difficulty is distribution-relative: rank candidates by score, then pick
// by percentile — breathers take the easiest candidate, normal levels ramp
// from percentileMin to percentileMax across their bracket.
export function pickIndexForLevel(level, scores, balance) {
  const order = scores.map((s, i) => i).sort((a, b) => scores[a] - scores[b] || a - b);
  if (isBreather(level, balance)) return order[0];
  const { start, end } = bracketRange(level, balance);
  const pos = end > start ? Math.min((level - start) / (end - start), 1) : 1;
  const p = balance.percentileMin + (balance.percentileMax - balance.percentileMin) * pos;
  return order[Math.round(p * (order.length - 1))];
}

// Level N: generate `balance.candidates` boards from derived seeds, score
// each, pick by percentile. Candidates whose packing failed (null — never
// observed in practice, see tests) are simply left out of the pool.
export function generateLevel(level, balance) {
  const { cols, rows, minLen, maxLen, longBias } = rampFor(level, balance);
  const boards = [];
  const scores = [];
  for (let k = 0; k < balance.candidates; k++) {
    const rng = mulberry32(levelSeed(level, k));
    const built = buildBoard(rng, cols, rows, minLen, maxLen, longBias);
    if (!built) continue;
    boards.push(built);
    scores.push(scoreBoard(built.pieces, built.grid, cols, rows, balance.scoreWeights));
  }
  const pick = pickIndexForLevel(level, scores, balance);
  return {
    cols, rows,
    pieces: boards[pick].pieces,
    grid: boards[pick].grid,
    count: boards[pick].pieces.length,
    score: scores[pick],
  };
}

// Hint: among currently-free pieces (optionally restricted to `alive`), pick
// the one whose removal frees the most blocked pieces (ties → lowest index).
// Returns a piece index, or -1. Temporarily toggles grid cells but always
// restores them before returning.
export function findHint(pieces, grid, cols, rows, alive) {
  let bestIdx = -1, bestGain = -1;
  for (let p = 0; p < pieces.length; p++) {
    if (alive && !alive[p]) continue;
    const headP = pieces[p].cells[0];
    if (!rayClear(grid, cols, rows, p, headP % cols, (headP / cols) | 0, pieces[p].dir)) continue;
    let gain = 0;
    for (let q = 0; q < pieces.length; q++) {
      if (q === p || (alive && !alive[q])) continue;
      const headQ = pieces[q].cells[0];
      const qc = headQ % cols, qr = (headQ / cols) | 0;
      if (rayClear(grid, cols, rows, q, qc, qr, pieces[q].dir)) continue; // already free
      for (const ci of pieces[p].cells) grid[ci] = EMPTY;
      const freeAfter = rayClear(grid, cols, rows, q, qc, qr, pieces[q].dir);
      for (const ci of pieces[p].cells) grid[ci] = p;
      if (freeAfter) gain++;
    }
    if (gain > bestGain) { bestGain = gain; bestIdx = p; }
  }
  return bestIdx;
}
```

- [ ] **Step 5: In `tests/logic.test.js`, extend the startLevel test** — replace the test `'startLevel produces a playable snake board'` with:

```js
test('startLevel produces a playable, completely filled snake board', () => {
  const gd = allocGameData(balance);
  gd.level = 3;
  startLevel(gd, balance);
  assert.equal(gd.screen, 'game');
  assert.ok(gd.cols > 0 && gd.rows > 0);
  assert.equal(gd.grid.length, gd.cols * gd.rows);
  assert.ok(!Array.from(gd.grid).includes(EMPTY), 'board has empty cells');
  assert.ok(gd.pieces.length > 0);
  assert.equal(gd.remaining, gd.pieces.length);
  assert.equal(gd.alive.length, gd.pieces.length);
  assert.equal(gd.hearts, balance.hearts);
  assert.equal(gd.flawless, true);
  assert.equal(gd.hintPiece, -1);
});
```

(`EMPTY` is already imported in that file.)

- [ ] **Step 6: Run `npm test` — expect PASS: 31 tests, 0 failures.**

Run: `npm test`

If the breather-bracket test fails: full boards compress score variance between candidates, so investigate the score distribution per bracket (print candidate scores for a few levels) and adjust `percentileMin`/`percentileMax` or `scoreWeights` in `balance.js` — do NOT weaken the assertion. If `generation never wedges` fails: raise the restart cap in `buildBoard` (50 → 200) and check `placeSnake`'s shrink loop actually pops down to 1.

- [ ] **Step 7: Sanity-print a board** (eyeball that packing looks like the reference game):

```bash
node -e "
import('./src/generator.js').then(async (G) => {
  const { balance } = await import('./src/balance.js');
  for (const lvl of [1, 50, 301]) {
    const g = G.generateLevel(lvl, balance);
    console.log('level', lvl, '-', g.count, 'pieces, lengths',
      g.pieces.map(p => p.cells.length).join(','));
    for (let r = 0; r < g.rows; r++) {
      let line = '';
      for (let c = 0; c < g.cols; c++) line += String.fromCharCode(65 + (g.grid[r * g.cols + c] % 26)) ;
      console.log(line);
    }
  }
});
"
```

Expected: contiguous letter regions (each letter = one snake), no gaps; level 1 mostly short pieces, level 301 visibly longer ones.

- [ ] **Step 8: Bump version and commit.** `VERSION = 'v0.1.17'` in `src/balance.js`, `"version": "0.1.17"` in `package.json`.

```bash
git add src/balance.js src/generator.js tests/
git commit -m "feat: full-fill boards — every cell covered by a snake (1-7), mask-ready WALL grid (v0.1.17)"
```

NOTE: the browser game keeps working after this commit — render/logic already operate on `pieces`/`grid` and are agnostic to fill density. Task 2 is verification only.

---

### Task 2: Browser verification

No code changes expected — the renderer and logic are full-fill agnostic. This task verifies in the real game and only commits if something needs fixing.

**Files:**
- None expected. (Any fix found goes in `src/render.js` or `src/main.js` with a version bump to v0.1.18.)

- [ ] **Step 1: Serve and verify the board visually.** Serve the project on port 8092 (`python3 -m http.server 8092` from the project root — check whether the previous session's server is still running first). Playwright (use the install at `/Users/nitzanwilnai/Programming/Claude/GamesPlatform/node_modules/playwright/index.mjs`):
  - Fresh localStorage → menu shows LEVEL 1 / 60 gold / v0.1.17 → PLAY.
  - Screenshot the board: every cell of the 4×5 grid must be covered by a snake (no empty cells), pieces read clearly (arrowheads distinct, adjacent snakes visually separable by the grid gaps between strokes).
  - Capture levels 25 and 301 too (set `level` via localStorage save before reload: `localStorage.setItem('arrow-escape:progress', JSON.stringify({level: 301, gold: 60, sound: true}))`) — denser boards with long winding snakes must still read clearly.

- [ ] **Step 2: Verify play still works on a packed board.** Compute the level-1 solve order in Node (repeatedly `findHint` on the generated board with an alive mask, tap that piece's head cell, mirror removals locally — same approach as the previous rework's e2e). Tap pieces in order with ~900 ms waits; verify clear overlay appears with the gold breakdown, NEXT advances to level 2, reload persists. Tap one blocked piece first to verify bump + heart loss still reads on a full board. Zero console errors; read all screenshots.

- [ ] **Step 3: Visual judgment call.** On the packed board, if adjacent same-color snakes blur together (stroke width 0.72 × cell leaves ~0.28 × cell gaps — should be fine), the fix is reducing stroke width in `src/render.js` (`setPieceStroke` callers, 0.72 → 0.66) — only apply if screenshots actually show ambiguity, then bump to v0.1.18 and commit:

```bash
git add src/render.js src/balance.js package.json
git commit -m "fix: thinner piece strokes for packed-board legibility (v0.1.18)"
```

---

## Verification summary

| What | How |
|------|-----|
| Full coverage | unit tests: every cell of every generated board belongs to exactly one snake (levels 1–120 sweep + seed sweeps) |
| Solvability | construction invariant + wave-removal assertion on every generated board |
| Mask readiness | masked buildBoard test (corner walls): walls preserved, open cells filled, board solves |
| Determinism | same level generated twice → identical |
| Visuals | Playwright screenshots at levels 1 / 25 / 301, read by the controller |
| Playability | scripted level-1 solve in the browser, bump check, persistence check |
| No deploy | per standing rule — user verifies locally first |

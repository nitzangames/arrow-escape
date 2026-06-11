# Arrow Escape — Snake Pieces Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace single-cell arrow tiles with reference-faithful snake pieces: each piece is a 1–5 cell connected path with bends ending in an arrowhead; tapping any cell slides the whole snake out along its own track if the head's exit ray is clear.

**Architecture:** Same module layout. Board representation changes from `Int8Array` of directions to a `grid` (`Int16Array` of piece ids) + `pieces` array (`{cells: [headIdx, ...], dir}`). Reverse-construction solvability argument carries over unchanged (each piece's exit ray is clear of earlier pieces at placement). Rendering switches from pre-rendered tile sprites to per-dirty-frame thick rounded polylines (`lineCap/lineJoin: 'round'`), which also animate the train-style slide-out.

**Tech Stack:** unchanged (vanilla JS, node --test, Playwright for visual verification).

**Spec:** `docs/superpowers/specs/2026-06-10-arrow-escape-design.md` (rev 2). Base: branch `v1-implementation` @ d74bba0 (v0.1.13), 27 tests passing.

---

## Shared concepts (read first)

- **Piece:** `{ cells: [headCellIdx, ...bodyCellIdxs], dir }` — cells are a 4-connected path, head first. `dir` (0=up 1=right 2=down 3=left) points away from the body: for length ≥ 2, `cells[1]` is exactly `head − DIRS[dir]`.
- **Grid:** `Int16Array(cols*rows)`, value = piece index or `EMPTY` (−1). Cell index `i = r*cols + c`.
- **Free piece:** the straight ray from its head (exclusive) to the edge in `dir` contains no cells of *other* pieces.
- **Slide track:** the polyline tail → … → head → head+dir → head+2·dir → …. At travel `t` (cells), segment `j` (0 = head, L−1 = tail) sits at arclength `(L−1−j) + t` along this track. The piece is gone when `t ≥ maxTravel = (L−1) + distToEdge(head) + flyMargin`.
- **Generation invariant:** bodies are built by a backward random walk that never steps onto the head's own exit ray, onto occupied cells, or onto itself. So at play time a piece's own body is never on its ray (but `rayClear` still exempts `selfId` for robustness).

---

### Task 1: Core rework — balance, generator, gameData, logic, both test suites

One task because the generator API change breaks logic at the same time; all pure-Node code.

**Files:**
- Modify: `src/balance.js` (ramp shape)
- Rewrite: `src/generator.js`, `src/gameData.js`, `src/logic.js`
- Rewrite: `tests/generator.test.js`, `tests/logic.test.js`

- [ ] **Step 1: Update `src/balance.js` ramp** (everything else in the file stays):

```js
  // Level ramp brackets: [maxLevel, cols, rows, minPieces, maxPieces, minLen, maxLen]
  ramp: [
    [10, 4, 5, 4, 6, 1, 3],
    [30, 5, 7, 6, 9, 1, 4],
    [60, 6, 8, 8, 12, 2, 4],
    [120, 7, 9, 10, 15, 2, 5],
    [300, 7, 10, 12, 17, 2, 5],
    [Infinity, 8, 11, 15, 21, 2, 5],
  ],
```

- [ ] **Step 2: Rewrite `tests/generator.test.js`** (full file):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { balance } from '../src/balance.js';
import {
  EMPTY, DIRS, mulberry32, levelSeed, rampFor, rayClear,
  buildBoard, simulateWaves, scoreBoard, isBreather,
  pickIndexForLevel, generateLevel, findHint,
} from '../src/generator.js';

// Hand-built board: defs = [{cells, dir}, ...]
function makeBoard(cols, rows, defs) {
  const grid = new Int16Array(cols * rows).fill(EMPTY);
  const pieces = defs.map((d, id) => {
    for (const ci of d.cells) grid[ci] = id;
    return { cells: d.cells, dir: d.dir };
  });
  return { pieces, grid };
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
  assert.deepEqual(rampFor(1, balance), { cols: 4, rows: 5, minPieces: 4, maxPieces: 6, minLen: 1, maxLen: 3 });
  assert.deepEqual(rampFor(11, balance), { cols: 5, rows: 7, minPieces: 6, maxPieces: 9, minLen: 1, maxLen: 4 });
  assert.deepEqual(rampFor(301, balance), { cols: 8, rows: 11, minPieces: 15, maxPieces: 21, minLen: 2, maxLen: 5 });
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

test('buildBoard produces deterministic, well-formed snakes', () => {
  const cols = 6, rows = 8;
  const b1 = buildBoard(mulberry32(7), cols, rows, 10, 1, 5);
  const b2 = buildBoard(mulberry32(7), cols, rows, 10, 1, 5);
  assert.deepEqual(b1.pieces, b2.pieces);
  assert.deepEqual(Array.from(b1.grid), Array.from(b2.grid));
  assert.ok(b1.pieces.length > 0 && b1.pieces.length <= 10);
  const seen = new Set();
  b1.pieces.forEach((piece, id) => {
    assert.ok(piece.cells.length >= 1 && piece.cells.length <= 5);
    assert.ok(piece.dir >= 0 && piece.dir <= 3);
    piece.cells.forEach((ci) => {
      assert.ok(!seen.has(ci), 'cell overlap');
      seen.add(ci);
      assert.equal(b1.grid[ci], id, 'grid consistency');
    });
    for (let j = 1; j < piece.cells.length; j++) {
      const a = piece.cells[j - 1], b = piece.cells[j];
      const dc = Math.abs((a % cols) - (b % cols));
      const dr = Math.abs(((a / cols) | 0) - ((b / cols) | 0));
      assert.equal(dc + dr, 1, 'path connectivity');
    }
    if (piece.cells.length > 1) {
      const head = piece.cells[0];
      const hc = head % cols, hr = (head / cols) | 0;
      const expected = (hr - DIRS[piece.dir][1]) * cols + (hc - DIRS[piece.dir][0]);
      assert.equal(piece.cells[1], expected, 'arrowhead points away from body');
    }
  });
  for (let i = 0; i < b1.grid.length; i++) {
    if (!seen.has(i)) assert.equal(b1.grid[i], EMPTY);
  }
});

test('every built board is solvable by wave removal', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const { pieces, grid } = buildBoard(mulberry32(seed), 8, 11, 21, 2, 5);
    const { cleared } = simulateWaves(pieces, grid, 8, 11);
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

test('generateLevel is deterministic and always solvable', () => {
  for (const level of [1, 7, 25, 55, 150, 400]) {
    const g1 = generateLevel(level, balance);
    const g2 = generateLevel(level, balance);
    assert.deepEqual(g1.pieces, g2.pieces, `level ${level} not deterministic`);
    assert.deepEqual(Array.from(g1.grid), Array.from(g2.grid));
    const { cleared } = simulateWaves(g1.pieces, g1.grid, g1.cols, g1.rows);
    assert.ok(cleared, `level ${level} not solvable`);
    assert.ok(g1.count > 0);
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
  // alive mask: kill every piece except a blocked one → no free piece → -1...
  // simpler: alive only the hinted piece → hint must return it
  const alive = new Uint8Array(g.pieces.length);
  alive[idx] = 1;
  assert.equal(findHint(g.pieces, g.grid, g.cols, g.rows, alive), idx);
});
```

- [ ] **Step 3: Run `npm test` — expect FAIL** (missing/changed exports).

- [ ] **Step 4: Rewrite `src/generator.js`** (full file — keep mulberry32/levelSeed/isBreather/bracketRange/pickIndexForLevel bodies identical to current):

```js
// Pure board generation and analysis. No DOM — runs under Node for tests.
//
// A piece is a snake: an ordered list of cell indices (head first) forming a
// 4-connected path, plus the head's pointing direction (away from the body).
// The grid maps each cell to its piece index (EMPTY = -1). Index i = r*cols+c;
// directions 0=up 1=right 2=down 3=left.

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
  for (const [maxLevel, cols, rows, minPieces, maxPieces, minLen, maxLen] of balance.ramp) {
    if (level <= maxLevel) return { cols, rows, minPieces, maxPieces, minLen, maxLen };
  }
}

// True if the straight ray from a head (exclusive) to the edge is free of
// other pieces. selfId cells never block: a piece's own body can't obstruct
// its slide (the body vacates along the same track).
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

// True if (x,y) lies on the open ray from (hc,hr) in direction dir.
function onRay(hc, hr, dir, x, y) {
  const dx = DIRS[dir][0], dy = DIRS[dir][1];
  if (dx === 0) return x === hc && Math.sign(y - hr) === dy;
  return y === hr && Math.sign(x - hc) === dx;
}

// Reverse construction with snakes: each piece is placed only where its head's
// exit ray is clear of all earlier pieces, so removing pieces in reverse
// placement order always clears the board (the latest remaining piece is
// always free). The body grows backward from the head — first cell directly
// behind the head, later cells may bend — and never steps onto occupied
// cells, onto itself, or onto the head's exit ray.
export function buildBoard(rng, cols, rows, targetPieces, minLen, maxLen) {
  const grid = new Int16Array(cols * rows).fill(EMPTY);
  const pieces = [];
  let guard = targetPieces * 80;
  while (pieces.length < targetPieces && guard-- > 0) {
    const hc = (rng() * cols) | 0;
    const hr = (rng() * rows) | 0;
    if (grid[hr * cols + hc] !== EMPTY) continue;
    const d0 = (rng() * 4) | 0;
    for (let k = 0; k < 4; k++) {
      const dir = (d0 + k) % 4;
      if (!rayClear(grid, cols, rows, pieces.length, hc, hr, dir)) continue;
      const targetLen = minLen + ((rng() * (maxLen - minLen + 1)) | 0);
      const cells = [hr * cols + hc];
      let bc = hc, br = hr;
      let walkDir = (dir + 2) % 4; // first body cell sits directly behind the head
      for (let len = 1; len < targetLen; len++) {
        const turn = rng() < 0.5 ? 1 : 3;
        const tries = len === 1
          ? [walkDir]                                  // behind the head is mandatory
          : [walkDir, (walkDir + turn) % 4, (walkDir + 4 - turn) % 4];
        let moved = false;
        for (const wd of tries) {
          const nx = bc + DIRS[wd][0], ny = br + DIRS[wd][1];
          if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
          const ni = ny * cols + nx;
          if (grid[ni] !== EMPTY || cells.includes(ni) || onRay(hc, hr, dir, nx, ny)) continue;
          cells.push(ni);
          bc = nx; br = ny; walkDir = wd;
          moved = true;
          break;
        }
        if (!moved) break;
      }
      if (cells.length < minLen) continue; // couldn't grow enough — try another dir
      const id = pieces.length;
      for (const ci of cells) grid[ci] = id;
      pieces.push({ cells, dir });
      break;
    }
  }
  return { pieces, grid };
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
// each, pick by percentile.
export function generateLevel(level, balance) {
  const { cols, rows, minPieces, maxPieces, minLen, maxLen } = rampFor(level, balance);
  const boards = [];
  const scores = [];
  for (let k = 0; k < balance.candidates; k++) {
    const rng = mulberry32(levelSeed(level, k));
    const targetPieces = minPieces + ((rng() * (maxPieces - minPieces + 1)) | 0);
    const built = buildBoard(rng, cols, rows, targetPieces, minLen, maxLen);
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

- [ ] **Step 5: Rewrite `tests/logic.test.js`** (full file):

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { balance } from '../src/balance.js';
import { allocGameData } from '../src/gameData.js';
import { EMPTY } from '../src/generator.js';
import {
  startLevel, tapCell, tick, distToEdge,
  awardClear, nextLevel, useHint, refillHearts,
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

test('startLevel produces a playable snake board', () => {
  const gd = allocGameData(balance);
  gd.level = 3;
  startLevel(gd, balance);
  assert.equal(gd.screen, 'game');
  assert.ok(gd.cols > 0 && gd.rows > 0);
  assert.equal(gd.grid.length, gd.cols * gd.rows);
  assert.ok(gd.pieces.length > 0);
  assert.equal(gd.remaining, gd.pieces.length);
  assert.equal(gd.alive.length, gd.pieces.length);
  assert.equal(gd.hearts, balance.hearts);
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
  assert.equal(gd.hearts, balance.hearts - 1);
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

test('losing all hearts fails the level', () => {
  // 2×1 mutual block: tap piece 0 three times
  const gd = makeGd(2, 1, [
    { cells: [0], dir: 1 },
    { cells: [1], dir: 3 },
  ]);
  tapCell(gd, balance, 0, 0); runTicks(gd, 0.3);
  tapCell(gd, balance, 0, 0); runTicks(gd, 0.3);
  assert.equal(tapCell(gd, balance, 0, 0), 'bump');
  assert.equal(gd.hearts, 0);
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

test('refillHearts only works on the fail screen and charges gold', () => {
  const gd = makeGd(2, 1, [
    { cells: [0], dir: 1 },
    { cells: [1], dir: 3 },
  ]);
  gd.gold = 100;
  assert.equal(refillHearts(gd, balance), false);
  gd.screen = 'fail';
  gd.hearts = 0;
  assert.equal(refillHearts(gd, balance), true);
  assert.equal(gd.gold, 100 - balance.refillCost);
  assert.equal(gd.hearts, balance.hearts);
  assert.equal(gd.screen, 'game');
  gd.screen = 'fail';
  gd.gold = balance.refillCost - 1;
  assert.equal(refillHearts(gd, balance), false);
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
  nextLevel(gd, balance);
  assert.equal(gd.level, 5);
  assert.equal(gd.screen, 'game');
  assert.equal(gd.hearts, balance.hearts);
  assert.ok(gd.remaining > 0);
});
```

- [ ] **Step 6: Rewrite `src/gameData.js`:**

```js
// The single mutable state object. Allocated once at boot; per-level arrays
// are reallocated in startLevel (level start, not per-frame — allowed).
export function allocGameData(balance) {
  return {
    screen: 'menu', // 'menu' | 'game' | 'clear' | 'fail'
    level: 1,
    gold: balance.startGold,
    sound: true,

    cols: 0,
    rows: 0,
    pieces: null,    // [{cells: [headIdx, ...], dir}] from the generator
    grid: null,      // Int16Array(cols*rows): piece index or EMPTY
    alive: null,     // Uint8Array per piece: on the board or sliding out
    sliding: null,   // Uint8Array per piece: currently sliding out
    travel: null,    // Float32Array per piece: cells travelled along the track
    maxTravel: null, // Float32Array per piece: despawn distance
    slideT: null,    // Float32Array per piece: seconds sliding
    bumpT: null,     // Float32Array per piece: bump animation countdown
    slidingCount: 0,
    remaining: 0,    // pieces not yet tapped free
    hearts: balance.hearts,
    flawless: true,

    hintPiece: -1,
    hintPulse: 0,
    shakeT: 0,
    clearTimer: 0,
    clearFade: 0,
    failTimer: 0,
    goldEarnedClear: 0,
    goldEarnedBonus: 0,

    dirty: true, // render-on-demand flag for static screens
  };
}
```

- [ ] **Step 7: Rewrite `src/logic.js`:**

```js
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
  if (p === EMPTY || gd.bumpT[p] > 0) return 'none';
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
  const idx = findHint(gd.pieces, gd.grid, gd.cols, gd.rows, gd.alive);
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
```

NOTE: `findHint(..., gd.alive)` must skip sliding pieces too — a sliding piece is `alive` until despawn but its grid cells are already EMPTY, so it can never be returned as blocked, and as a "free" candidate its gain would be computed on empty cells (gain 0). To keep the hint honest, in `useHint` pass a mask of idle pieces if any are sliding... **Simpler and correct:** sliding pieces have no grid cells, so `rayClear` on their head sees the *current* grid — they'd appear free with gain 0 and could win ties. Prevent this by passing `gd.alive` AND treating sliding as not-hintable. Concretely, in `useHint` replace the `findHint` call with:

```js
  // hintable = alive and not sliding
  let idx = -1;
  {
    const mask = new Uint8Array(gd.pieces.length);
    for (let p = 0; p < gd.pieces.length; p++) mask[p] = gd.alive[p] && !gd.sliding[p] ? 1 : 0;
    idx = findHint(gd.pieces, gd.grid, gd.cols, gd.rows, mask);
  }
```

(Allocation is per hint purchase, not per frame — fine.)

- [ ] **Step 8: Run `npm test` — expect PASS: 28 tests, 0 failures.** If the breather-bracket test fails, tune like last time (investigate percentiles, don't weaken the assertion).

- [ ] **Step 9: Bump version and commit.** `VERSION = 'v0.1.14'`, package.json `0.1.14`.

```bash
git add src/balance.js src/generator.js src/gameData.js src/logic.js tests/
git commit -m "feat: snake pieces — multi-cell curved arrows with train-slide mechanics (core) (v0.1.14)"
```

NOTE: after this commit the BROWSER GAME IS BROKEN (render.js still draws the old board format). That's expected — Task 2 fixes it. Don't try to patch render here.

---

### Task 2: Renderer + main rework

**Files:**
- Modify: `src/render.js` (replace sprite/tile drawing with snake polylines; keep theme/fonts/buttons/screens)
- Modify: `src/main.js` (drop initSprites, fix findHint call in screenshot mode)

- [ ] **Step 1: In `src/render.js`** — delete `TILE`, `tileSprites`, `initSprites`. Add after `roundRect`:

```js
// --- snake piece drawing -------------------------------------------------
// Pieces are stroked as thick rounded polylines through their cell centers.
// A module-scope scratch point avoids per-frame allocation.
const _pt = { x: 0, y: 0 };

function cellCx(gd, g, ci) { return g.bx + ((ci % gd.cols) + 0.5) * g.cell; }
function cellCy(gd, g, ci) { return g.by + (((ci / gd.cols) | 0) + 0.5) * g.cell; }

// Trace the piece's resting path into the current ctx path (no stroke).
function tracePiecePath(c, gd, g, p, ox, oy) {
  const cells = gd.pieces[p].cells;
  for (let j = cells.length - 1; j >= 0; j--) {
    const x = cellCx(gd, g, cells[j]) + ox;
    const y = cellCy(gd, g, cells[j]) + oy;
    if (j === cells.length - 1) {
      c.moveTo(x, y);
      if (cells.length === 1) c.lineTo(x + 0.01, y); // dot → round-cap circle
    } else {
      c.lineTo(x, y);
    }
  }
}

function setPieceStroke(c, g, widthFactor, style) {
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.lineWidth = g.cell * widthFactor;
  c.strokeStyle = style;
}

// Arrowhead triangle on the head, pointing dir, drawn in the glyph color.
function drawHeadGlyph(c, x, y, cellPx, dir) {
  const u = cellPx / 150;
  c.save();
  c.translate(x, y);
  c.rotate(dir * Math.PI / 2);
  c.fillStyle = THEME.glyph;
  c.beginPath();
  c.moveTo(0, -32 * u);
  c.lineTo(24 * u, 14 * u);
  c.lineTo(0, 4 * u);
  c.lineTo(-24 * u, 14 * u);
  c.closePath();
  c.fill();
  c.restore();
}

function drawPiece(c, gd, g, p, ox, oy) {
  setPieceStroke(c, g, 0.72, THEME.tile);
  c.beginPath();
  tracePiecePath(c, gd, g, p, ox, oy);
  c.stroke();
  const head = gd.pieces[p].cells[0];
  drawHeadGlyph(c, cellCx(gd, g, head) + ox, cellCy(gd, g, head) + oy, g.cell, gd.pieces[p].dir);
}

// Position (canvas px) of sliding segment j at the piece's current travel.
// Track arclength: tail = 0 … head = L-1, then the straight exit ray.
function segPos(gd, g, p, j, out) {
  const piece = gd.pieces[p];
  const L = piece.cells.length;
  const s = (L - 1 - j) + gd.travel[p];
  if (L > 1 && s <= L - 1) {
    const k = Math.min(Math.floor(s), L - 2);
    const f = s - k;
    const a = piece.cells[L - 1 - k];     // arclength k   (tail side)
    const b = piece.cells[L - 2 - k];     // arclength k+1 (head side)
    out.x = cellCx(gd, g, a) + (cellCx(gd, g, b) - cellCx(gd, g, a)) * f;
    out.y = cellCy(gd, g, a) + (cellCy(gd, g, b) - cellCy(gd, g, a)) * f;
  } else {
    const head = piece.cells[0];
    const ext = s - (L - 1);
    out.x = cellCx(gd, g, head) + DIRS[piece.dir][0] * ext * g.cell;
    out.y = cellCy(gd, g, head) + DIRS[piece.dir][1] * ext * g.cell;
  }
}

function drawSlidingPiece(c, gd, g, p) {
  const piece = gd.pieces[p];
  const L = piece.cells.length;
  setPieceStroke(c, g, 0.72, THEME.tile);
  c.beginPath();
  for (let j = L - 1; j >= 0; j--) {
    segPos(gd, g, p, j, _pt);
    if (j === L - 1) {
      c.moveTo(_pt.x, _pt.y);
      if (L === 1) c.lineTo(_pt.x + 0.01, _pt.y);
    } else {
      c.lineTo(_pt.x, _pt.y);
    }
  }
  c.stroke();
  segPos(gd, g, p, 0, _pt);
  drawHeadGlyph(c, _pt.x, _pt.y, g.cell, piece.dir); // head rides the straight ray → angle = dir
}
```

- [ ] **Step 2: In `renderGame`**, replace the hint-highlight block, the tile loop, and the flights loop with:

```js
  // Hint highlight: accent outline under the whole hinted piece
  if (gd.hintPiece >= 0 && gd.alive[gd.hintPiece] && !gd.sliding[gd.hintPiece]) {
    const pulse = 0.5 + 0.5 * Math.sin(gd.hintPulse * 6);
    c.globalAlpha = 0.35 + 0.55 * pulse;
    setPieceStroke(c, g, 0.92, THEME.accent);
    c.beginPath();
    tracePiecePath(c, gd, g, gd.hintPiece, 0, 0);
    c.stroke();
    c.globalAlpha = 1;
  }

  // Resting pieces (with bump offset toward the blocker)
  const bumpScale = g.cell / 150;
  for (let p = 0; p < gd.pieces.length; p++) {
    if (!gd.alive[p] || gd.sliding[p]) continue;
    let ox = 0, oy = 0;
    if (gd.bumpT[p] > 0) {
      const k = Math.sin((1 - gd.bumpT[p] / balance.bumpDur) * Math.PI) * balance.bumpDist * bumpScale;
      ox = DIRS[gd.pieces[p].dir][0] * k;
      oy = DIRS[gd.pieces[p].dir][1] * k;
    }
    drawPiece(c, gd, g, p, ox, oy);
  }

  // Sliding pieces (drawn over resting ones)
  for (let p = 0; p < gd.pieces.length; p++) {
    if (gd.sliding[p]) drawSlidingPiece(c, gd, g, p);
  }
```

`hitTest` and everything else in render.js stays as-is.

- [ ] **Step 3: In `src/main.js`** — remove `initSprites` from the render import and delete the `initSprites();` call in `boot()`. In the screenshot-mode block, replace the findHint/tap lines with:

```js
    const auto = setInterval(() => {
      const mask = new Uint8Array(gd.pieces.length);
      for (let p = 0; p < gd.pieces.length; p++) mask[p] = gd.alive[p] && !gd.sliding[p] ? 1 : 0;
      const idx = findHint(gd.pieces, gd.grid, gd.cols, gd.rows, mask);
      if (idx >= 0) {
        const head = gd.pieces[idx].cells[0];
        tapCell(gd, balance, head % gd.cols, (head / gd.cols) | 0);
      }
      if (++taps >= 3) clearInterval(auto);
    }, 800);
```

- [ ] **Step 4: Verify.** `npm test` (28 passing, untouched). Serve on 8092, Playwright:
  - Load → PLAY → screenshot: board must show snake pieces (thick rounded paths with bends, arrowhead glyphs), not square tiles.
  - Compute level-1 layout in Node (`generateLevel(1, balance)`), find a free piece, tap its TAIL cell → screenshot mid-slide (~150ms after tap) must show the snake partially out / straightening; after 800ms it's gone.
  - Tap a blocked piece → bump + heart loss visible.
  - Read all screenshots; zero console errors. Fix anything visually broken (overlapping glyphs, wrong geometry) before committing.

- [ ] **Step 5: Bump version and commit.** `VERSION = 'v0.1.15'`, package.json `0.1.15`.

```bash
git add src/render.js src/main.js src/balance.js package.json
git commit -m "feat: snake rendering — rounded polylines, train-slide animation, piece hint outline (v0.1.15)"
```

---

### Task 3: Thumbnail rework + final verification

**Files:**
- Modify: `mockups/thumbnail.html` (draw snakes instead of tiles)
- Regenerate: `thumbnail.png`

- [ ] **Step 1:** Rewrite the drawing portion of `mockups/thumbnail.html` to show 3 snake pieces on the off-white background using the same visual language as render.js (thick `#2b2b2e` rounded polylines on a subtle cell grid, one piece in accent `#e2574c`, off-white triangle arrowheads). Suggested composition on a 4×3 virtual grid (cell 88px, origin 80,56): an L-shaped 3-cell snake pointing up, a straight 2-cell snake pointing right in accent red, an S-shaped 4-cell snake pointing left. Title block unchanged ("ARROW" / "ESCAPE" at 64px, y 440/500).

- [ ] **Step 2:** Regenerate thumbnail.png via Playwright element screenshot (as before), `sips` check 512×512, read the PNG to confirm: curved snakes visible, title legible.

- [ ] **Step 3: Full e2e sweep** (Playwright): fresh localStorage → menu (LEVEL 1, 60 gold, current version) → PLAY → solve level 1 by computing the deterministic solve order in Node (repeatedly findHint on the level-1 board, tap that piece's head cell, mirror removals locally) → clear overlay with gold breakdown → NEXT → LEVEL 2 → reload → persistence. Zero console errors. Read key screenshots.

- [ ] **Step 4: Bump version and commit.** `VERSION = 'v0.1.16'`, package.json `0.1.16`.

```bash
git add thumbnail.png mockups/thumbnail.html src/balance.js package.json
git commit -m "feat: snake thumbnail + e2e verification of snake rework (v0.1.16)"
```

---

## Verification summary

| What | How |
|------|-----|
| Generator correctness | 28 unit tests: snake well-formedness, solvability, determinism, scoring, hints |
| Slide mechanics | logic tests (tap-any-cell, grid freed immediately, maxTravel, clear-holds-while-sliding) |
| Visuals | Playwright screenshots read by the controller (snakes, mid-slide deformation, bump, hint) |
| No deploy | per standing rule — user verifies locally first |

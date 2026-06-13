import { test } from 'node:test';
import assert from 'node:assert/strict';
import { balance } from '../src/balance.js';
import {
  EMPTY, WALL, DIRS, mulberry32, levelSeed, waveFor, rayClear,
  buildBoard, simulateWaves, scoreBoard,
  pickIndexForLevel, generateLevel, findHint, getLevel,
} from '../src/generator.js';
import { maskFor, shapeFor } from '../src/shapes.js';
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

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

test('waveFor: tutorial, wave interpolation, tier ceilings', () => {
  assert.deepEqual(waveFor(1, balance),
    { cols: 5, rows: 7, minLen: 2, maxLen: 5, longBias: 0, t: 0, tutorial: true });
  const start = waveFor(4, balance); // wave start = tier floor
  assert.equal(start.t, 0);
  assert.deepEqual([start.cols, start.rows, start.maxLen], [7, 10, 6]);
  const peak = waveFor(9, balance); // last level of the wave = tier-1 peak
  assert.equal(peak.t, 1);
  assert.deepEqual([peak.cols, peak.rows, peak.maxLen], [12, 16, 12]);
  const next = waveFor(10, balance); // next wave drops back to the tier-2 floor
  assert.equal(next.t, 0);
  assert.deepEqual([next.cols, next.rows, next.maxLen], [9, 12, 8]);
  const t2 = waveFor(15, balance); // tier-2 peak: the first 20x27 max board
  assert.deepEqual([t2.cols, t2.rows, t2.maxLen, t2.longBias], [20, 27, 16, 0.6]);
  const t3 = waveFor(21, balance); // tier-3 peak: also 20x27
  assert.deepEqual([t3.cols, t3.rows, t3.maxLen, t3.longBias], [20, 27, 16, 0.6]);
  // tier boundaries land exactly on wave peaks (peak ships, next wave steps up a tier)
  assert.equal(waveFor(9, balance).t, 1);
  assert.deepEqual([waveFor(10, balance).cols, waveFor(10, balance).rows, waveFor(10, balance).maxLen], [9, 12, 8]);
  assert.equal(waveFor(15, balance).t, 1);
  assert.deepEqual([waveFor(16, balance).cols, waveFor(16, balance).rows, waveFor(16, balance).maxLen], [11, 15, 10]);
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

test('pickIndexForLevel climbs the wave from gentle to the hardest candidate', () => {
  const scores = [5, 9, 1, 7, 3, 8, 2, 6, 4, 10];
  // sorted candidate order by score: idx 2(1) 6(2) 4(3) 8(4) 0(5) 7(6) 3(7) 5(8) 1(9) 9(10)
  assert.equal(pickIndexForLevel(1, scores, balance), 2,  'tutorial -> easiest');
  assert.equal(pickIndexForLevel(4, scores, balance), 8,  'wave start -> p=0.3 -> order[3]');
  assert.equal(pickIndexForLevel(7, scores, balance), 3,  't=3/5 -> p=0.72 -> order[6]');
  assert.equal(pickIndexForLevel(9, scores, balance), 9, 'wave peak -> hardest');
});

test('generateLevel is deterministic, full, and always solvable', () => {
  for (const level of [1, 7, 25, 55, 150, 400]) {
    const g1 = generateLevel(level, balance);
    const g2 = generateLevel(level, balance);
    assert.deepEqual(g1.pieces, g2.pieces, `level ${level} not deterministic`);
    assert.deepEqual(Array.from(g1.grid), Array.from(g2.grid));
    const { maxLen } = waveFor(level, balance);
    assertWellFormed(g1, g1.cols, g1.rows, maxLen);
    const { cleared } = simulateWaves(g1.pieces, g1.grid, g1.cols, g1.rows);
    assert.ok(cleared, `level ${level} not solvable`);
    assert.ok(g1.count > 0);
  }
});

test('generation never wedges across the whole early game', () => {
  for (let lvl = 1; lvl <= 260; lvl++) {
    const g = generateLevel(lvl, balance);
    assert.ok(!Array.from(g.grid).includes(EMPTY), `level ${lvl} has holes`);
  }
});

test('difficulty waves: within-wave rise, wave-start dip, tier growth, gentle tutorial', () => {
  const score = (lvl) => generateLevel(lvl, balance).score;
  // within a wave the peak scores above the start (tier 1: levels 4 -> 9, both rectangles)
  assert.ok(score(9) > score(4), 'tier-1 wave peak above its start');
  let startSum = 0, peakSum = 0;
  for (const [s, pk] of [[4, 9], [10, 15], [16, 21]]) { startSum += score(s); peakSum += score(pk); }
  assert.ok(peakSum > startSum, 'wave peaks above wave starts across tiers');
  assert.ok(score(10) < score(9), 'a new wave dips below the previous peak');
  // the ceiling rises: a tier-3 peak (20x27) scores above the tier-1 peak (12x16)
  assert.ok(score(21) > score(9), 'later tier peaks harder than tier-1');
  // the first two max-size boards are full 20x27 rectangles (peaks at 15 and 21)
  const p15 = generateLevel(15, balance);
  assert.deepEqual([p15.cols, p15.rows], [20, 27], 'first max board at level 15');
  const p21 = generateLevel(21, balance);
  assert.deepEqual([p21.cols, p21.rows], [20, 27], 'tier-3 peak also full size');
  const tut = Math.max(score(1), score(2), score(3));
  assert.ok(tut < score(4), 'tutorial below the tier-1 wave start');
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

test('level 10 is the heart: mask applied, full, solvable, deterministic', () => {
  const g = generateLevel(10, balance);
  assert.equal(g.shape, 'heart');
  const w = waveFor(10, balance);
  const m = maskFor('heart', w.cols, w.rows); // dims come from the wave now
  assert.equal(g.cols, m.cols);
  assert.equal(g.rows, m.rows);
  for (let i = 0; i < m.mask.length; i++) {
    if (m.mask[i]) assert.notEqual(g.grid[i], WALL, `cell ${i} should be playable`);
    else assert.equal(g.grid[i], WALL, `cell ${i} should be a wall`);
  }
  assertWellFormed(g, g.cols, g.rows, waveFor(10, balance).maxLen);
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
    assertWellFormed(g, g.cols, g.rows, waveFor(lvl, balance).maxLen);
    assert.ok(simulateWaves(g.pieces, g.grid, g.cols, g.rows).cleared, `level ${lvl} not solvable`);
  }
});

test('shaped 10x14 level is deterministic through the trimmed-dims path', () => {
  const a = generateLevel(22, balance);
  const b = generateLevel(22, balance);
  assert.equal(a.shape, 'hourglass');
  assert.deepEqual(a.pieces, b.pieces);
  assert.deepEqual(Array.from(a.grid), Array.from(b.grid));
});

test('arrowhead directions are roughly balanced on rectangle boards', () => {
  const dirs = [0, 0, 0, 0];
  for (let lvl = 20; lvl <= 60; lvl++) {
    if (shapeFor(lvl, balance)) continue;
    for (const p of generateLevel(lvl, balance).pieces) dirs[p.dir]++;
  }
  const total = dirs.reduce((a, b) => a + b, 0);
  for (const d of dirs) {
    assert.ok(d / total > 0.15, `direction share skewed: ${JSON.stringify(dirs)}`);
  }
});

test('the diamond cap flows through generateLevel on a large-request diamond', () => {
  const g = generateLevel(67, balance); // a diamond level whose wave dims exceed 10x14
  assert.equal(g.shape, 'diamond');
  assert.ok(g.cols <= 10 && g.rows <= 14, `capped dims, got ${g.cols}x${g.rows}`);
  assert.ok(simulateWaves(g.pieces, g.grid, g.cols, g.rows).cleared);
});

test('no arrowhead ever points along its own body (zero self-crossing)', () => {
  for (let lvl = 1; lvl <= 120; lvl++) {
    const g = generateLevel(lvl, balance);
    for (const piece of g.pieces) {
      const head = piece.cells[0];
      let x = head % g.cols + DIRS[piece.dir][0];
      let y = ((head / g.cols) | 0) + DIRS[piece.dir][1];
      while (x >= 0 && x < g.cols && y >= 0 && y < g.rows) {
        assert.ok(!piece.cells.includes(y * g.cols + x),
          `level ${lvl}: arrow at cell ${head} crosses its own body`);
        x += DIRS[piece.dir][0];
        y += DIRS[piece.dir][1];
      }
    }
  }
});

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

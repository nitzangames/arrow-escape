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

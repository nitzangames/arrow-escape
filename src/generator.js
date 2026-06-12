// Pure board generation and analysis. No DOM — runs under Node for tests.
//
// A piece is a snake: an ordered list of cell indices (head first) forming a
// 4-connected path, plus the head's pointing direction (away from the body,
// colinear with the path's end segment). The grid maps each cell to its
// piece index, EMPTY (-1), or WALL (-2: outside the playable mask — blocks
// rays like a piece, never holds one). Generated boards are FULL: every open
// cell belongs to exactly one piece. Index i = r*cols+c; directions
// 0=up 1=right 2=down 3=left.
//
// Generation is tile-then-peel. TILING partitions the open cells into paths
// with no ray constraints (so full coverage is trivial); PEELING then assigns
// arrowheads by repeatedly removing any piece whose end-continuation ray is
// clear of the pieces still on the board. The peel order is a forward
// solution, so every shipped board is solvable by construction (the reverse
// peel order is a placement order in which each piece's exit ray is clear of
// all earlier-placed pieces). Greedy ray-aware walks — the previous approach —
// could not pack shapes with single-escape pockets (a heart's lower flanks
// wedged >99% of attempts).

import { shapeFor, maskFor } from './shapes.js';

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
// uniform and bias 1 always picks maxLen. Paths that get boxed in or shrink
// for liveness fall short of the target, so actual lengths spread below it.
function sampleLen(rng, minLen, maxLen, longBias) {
  const t = longBias + (1 - longBias) * rng();
  return Math.min(maxLen, minLen + ((t * (maxLen - minLen + 1)) | 0));
}

// Direction a head at `a` points when its neighbor in the path is `behind`:
// the continuation of the path's end segment.
function endDir(cols, a, behind) {
  const dc = (a % cols) - (behind % cols);
  const dr = ((a / cols) | 0) - ((behind / cols) | 0);
  return dc === 1 ? 1 : dc === -1 ? 3 : dr === 1 ? 2 : 0;
}

// Static reachability: the corridor from (c,r) in `dir` crosses no WALL on
// its way to the edge (pieces are ignored — they come and go; walls do not).
function corridorFree(grid, cols, rows, c, r, dir) {
  const dx = DIRS[dir][0], dy = DIRS[dir][1];
  let x = c + dx, y = r + dy;
  while (x >= 0 && x < cols && y >= 0 && y < rows) {
    if (grid[y * cols + x] === WALL) return false;
    x += dx; y += dy;
  }
  return true;
}

// A path can eventually be removed only if one of its ends continues into a
// wall-free corridor. Singles may point any of the 4 directions.
function staticallyAlive(grid, cols, rows, cells) {
  if (cells.length === 1) {
    const c = cells[0] % cols, r = (cells[0] / cols) | 0;
    for (let d = 0; d < 4; d++) if (corridorFree(grid, cols, rows, c, r, d)) return true;
    return false;
  }
  const h1 = cells[0], h2 = cells[cells.length - 1];
  return corridorFree(grid, cols, rows, h1 % cols, (h1 / cols) | 0, endDir(cols, h1, cells[1]))
      || corridorFree(grid, cols, rows, h2 % cols, (h2 / cols) | 0, endDir(cols, h2, cells[cells.length - 2]));
}

// Tiling seed order: cells with NO wall-free corridor (they can never be a
// head, e.g. a diamond's stair corners) come first, while their neighbors
// are still empty to grow into; the rest follow in scan order.
function deadFirstSeedOrder(cols, rows, mask) {
  const n = cols * rows;
  const grid = new Int16Array(n).fill(EMPTY);
  if (mask) for (let i = 0; i < n; i++) if (!mask[i]) grid[i] = WALL;
  const dead = [], rest = [];
  for (let i = 0; i < n; i++) {
    if (grid[i] === WALL) continue;
    let alive = false;
    for (let d = 0; d < 4 && !alive; d++) {
      alive = corridorFree(grid, cols, rows, i % cols, (i / cols) | 0, d);
    }
    (alive ? rest : dead).push(i);
  }
  return dead.concat(rest);
}

// Phase 1 — tile: partition the open cells into 4-connected paths via random
// walks (no ray constraints), shrinking each path until statically alive.
// Returns null only if a lone cell ends up with no corridor in any direction
// and no room to grow (rare; the caller just retries).
function tile(rng, cols, rows, minLen, maxLen, longBias, mask, seedOrder) {
  const n = cols * rows;
  const grid = new Int16Array(n).fill(EMPTY);
  if (mask) for (let i = 0; i < n; i++) if (!mask[i]) grid[i] = WALL;
  const paths = [];
  for (const s of seedOrder) {
    if (grid[s] !== EMPTY) continue;
    const target = sampleLen(rng, minLen, maxLen, longBias);
    const cells = [s];
    grid[s] = paths.length;
    let cur = s;
    while (cells.length < target) {
      const d0 = (rng() * 4) | 0;
      let next = -1;
      for (let k = 0; k < 4; k++) {
        const wd = (d0 + k) % 4;
        const nx = (cur % cols) + DIRS[wd][0];
        const ny = ((cur / cols) | 0) + DIRS[wd][1];
        if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
        const ni = ny * cols + nx;
        if (grid[ni] !== EMPTY) continue;
        next = ni;
        break;
      }
      if (next < 0) break; // boxed in — settle for the length we got
      cells.push(next);
      grid[next] = paths.length;
      cur = next;
    }
    while (!staticallyAlive(grid, cols, rows, cells)) {
      if (cells.length === 1) return null; // stranded dead cell — retry board
      grid[cells.pop()] = EMPTY;
    }
    paths.push(cells);
  }
  return { grid, paths };
}

// During peeling: ray from (c,r) is free if it meets no wall and no cell of
// a still-remaining piece (removed pieces and own cells don't block).
function peelRayFree(grid, cols, rows, removed, selfId, c, r, dir) {
  const dx = DIRS[dir][0], dy = DIRS[dir][1];
  let x = c + dx, y = r + dy;
  while (x >= 0 && x < cols && y >= 0 && y < rows) {
    const v = grid[y * cols + x];
    if (v === WALL) return false;
    if (v >= 0 && v !== selfId && !removed[v]) return false;
    x += dx; y += dy;
  }
  return true;
}

// Phase 2 — peel: repeatedly pick (seeded-randomly) a piece one of whose end
// continuations is a clear ray, orient its head to that end, remove it.
// Completing the peel proves the board solvable. Returns heads per path, or
// null if no piece is removable (caller re-tiles).
function peel(rng, grid, cols, rows, paths) {
  const removed = new Uint8Array(paths.length);
  const heads = new Array(paths.length).fill(null);
  let left = paths.length;
  while (left > 0) {
    const options = [];
    for (let p = 0; p < paths.length; p++) {
      if (removed[p]) continue;
      const cells = paths[p];
      if (cells.length === 1) {
        const c = cells[0] % cols, r = (cells[0] / cols) | 0;
        for (let d = 0; d < 4; d++) {
          if (peelRayFree(grid, cols, rows, removed, p, c, r, d)) {
            options.push([p, 0, d]);
            break;
          }
        }
      } else {
        const h1 = cells[0], h2 = cells[cells.length - 1];
        const d1 = endDir(cols, h1, cells[1]);
        if (peelRayFree(grid, cols, rows, removed, p, h1 % cols, (h1 / cols) | 0, d1)) {
          options.push([p, 0, d1]);
        } else {
          const d2 = endDir(cols, h2, cells[cells.length - 2]);
          if (peelRayFree(grid, cols, rows, removed, p, h2 % cols, (h2 / cols) | 0, d2)) {
            options.push([p, 1, d2]);
          }
        }
      }
    }
    if (options.length === 0) return null;
    const [p, end, dir] = options[(rng() * options.length) | 0];
    removed[p] = 1;
    heads[p] = { end, dir };
    left--;
  }
  return heads;
}

// Build a full board: tile, then peel; retry (bounded, same rng stream —
// still deterministic) until both phases succeed. Returns null if every
// attempt fails — callers must skip the candidate. `mask` (optional
// Uint8Array, 1 = open) carves the playable shape.
export function buildBoard(rng, cols, rows, minLen, maxLen, longBias, mask) {
  const seedOrder = deadFirstSeedOrder(cols, rows, mask);
  for (let attempt = 0; attempt < 400; attempt++) {
    const t = tile(rng, cols, rows, minLen, maxLen, longBias, mask, seedOrder);
    if (!t) continue;
    const heads = peel(rng, t.grid, cols, rows, t.paths);
    if (!heads) continue;
    const pieces = t.paths.map((cells, p) => ({
      cells: heads[p].end === 0 ? cells.slice() : cells.slice().reverse(),
      dir: heads[p].dir,
    }));
    const grid = new Int16Array(cols * rows).fill(EMPTY);
    if (mask) for (let i = 0; i < grid.length; i++) if (!mask[i]) grid[i] = WALL;
    pieces.forEach((pc, id) => { for (const ci of pc.cells) grid[ci] = id; });
    return { pieces, grid };
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
// each, pick by percentile. Shaped levels carve the bracket's grid with the
// scheduled shape mask (maskFor may trim the dims). Candidates whose packing
// failed (null — not observed since tile-then-peel; skipped
// deterministically) are simply left out of the pool.
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

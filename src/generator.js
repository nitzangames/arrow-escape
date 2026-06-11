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
  for (let attempt = 0; attempt < 200; attempt++) {
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

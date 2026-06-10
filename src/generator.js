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
// from percentileMin to percentileMax across their bracket. This
// auto-calibrates to whatever scores each board size can actually produce.
export function pickIndexForLevel(level, scores, balance) {
  const order = scores.map((s, i) => i).sort((a, b) => scores[a] - scores[b] || a - b);
  if (isBreather(level, balance)) return order[0];
  const { start, end } = bracketRange(level, balance);
  const pos = end > start ? Math.min((level - start) / (end - start), 1) : 1;
  const p = balance.percentileMin + (balance.percentileMax - balance.percentileMin) * pos;
  return order[Math.round(p * (order.length - 1))];
}

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

// Level N: generate `balance.candidates` boards from derived seeds, score
// each, return the one at the level's percentile within the candidate pool.
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
  const pick = pickIndexForLevel(level, scores, balance);
  return { cols, rows, board: boards[pick].board, count: boards[pick].count, score: scores[pick] };
}

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

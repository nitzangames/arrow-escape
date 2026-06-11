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

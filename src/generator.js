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
// True if the straight ray from cell `idx` in `dir` reaches `target` within
// `limit` steps (before leaving the board). Used to keep snake walks from
// curling in front of their own ends, so no generated arrow ever points along
// its own body. `limit` is safely maxLen: a body cell sits at most maxLen
// straight-line cells away (the body is a connected path of ≤ maxLen cells).
function rayReaches(cols, rows, idx, dir, target, limit) {
  let x = (idx % cols) + DIRS[dir][0], y = ((idx / cols) | 0) + DIRS[dir][1];
  for (let s = 0; s < limit && x >= 0 && x < cols && y >= 0 && y < rows; s++) {
    if (y * cols + x === target) return true;
    x += DIRS[dir][0]; y += DIRS[dir][1];
  }
  return false;
}

// True if the ray from `idx` in `dir` hits any cell currently owned by
// `pieceId` (its own body) within `limit` steps (see rayReaches).
function rayHitsOwnBody(grid, cols, rows, pieceId, idx, dir, limit) {
  let x = (idx % cols) + DIRS[dir][0], y = ((idx / cols) | 0) + DIRS[dir][1];
  for (let s = 0; s < limit && x >= 0 && x < cols && y >= 0 && y < rows; s++) {
    if (grid[y * cols + x] === pieceId) return true;
    x += DIRS[dir][0]; y += DIRS[dir][1];
  }
  return false;
}

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

// Tiling seed classes: cells with NO wall-free corridor (they can never be a
// head, e.g. a diamond's stair corners) must seed first, while their
// neighbors are still empty to grow into. The rest are shuffled per attempt
// in buildBoard — seeding in scan order would pin every path's seed end to
// the top-left frontier, skewing arrowheads toward up/left.
function seedClasses(cols, rows, mask) {
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
  return { dead, rest };
}

// Phase 1 — tile: partition the open cells into 4-connected paths via random
// walks, shrinking each path until statically alive. The walk maintains a
// both-ends-clean invariant so NO snake can ever point its arrowhead along
// its own body (a confusing "it will hit itself" read): every step rejects a
// candidate cell that (a) lands on the seed end's exit ray or (b) whose own
// forward exit ray already crosses the body. Every prefix of such a walk is
// also clean, so the staticallyAlive shrink preserves the property.
// Returns null only if a lone cell ends up with no corridor in any direction
// and no room to grow (rare; the caller just retries).
function tile(rng, cols, rows, minLen, maxLen, longBias, mask, seedOrder) {
  const n = cols * rows;
  const grid = new Int16Array(n).fill(EMPTY);
  if (mask) for (let i = 0; i < n; i++) if (!mask[i]) grid[i] = WALL;
  const paths = [];
  for (const s of seedOrder) {
    if (grid[s] !== EMPTY) continue;
    const id = paths.length;
    const target = sampleLen(rng, minLen, maxLen, longBias);
    const cells = [s];
    grid[s] = id;
    let cur = s;
    let seedExitDir = -1; // seed end (cells[0]) exit ray dir; fixed once length >= 2
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
        // (a) ni must not sit on the seed end's exit ray
        if (seedExitDir >= 0 && rayReaches(cols, rows, cells[0], seedExitDir, ni, maxLen)) continue;
        // (b) if ni became the head, its exit ray (continuing cur->ni) must
        //     not already cross the body
        if (rayHitsOwnBody(grid, cols, rows, id, ni, wd, maxLen)) continue;
        next = ni;
        break;
      }
      if (next < 0) break; // boxed in — settle for the length we got
      cells.push(next);
      grid[next] = id;
      cur = next;
      if (cells.length === 2) seedExitDir = endDir(cols, cells[0], cells[1]);
    }
    while (!staticallyAlive(grid, cols, rows, cells)) {
      if (cells.length === 1) return null; // stranded dead cell — retry board
      grid[cells.pop()] = EMPTY;
    }
    paths.push(cells);
  }
  return { grid, paths };
}

// Merge pass: tiling leaves boxed-in singles ("dots"), especially in shaped
// boards' crevices. Absorb each single into an adjacent path end when the
// merged path stays within maxLen and statically alive — shaped boards drop
// from ~38% to ~21% dots (median) with no packing-reliability cost.
function mergeSingles(grid, cols, rows, paths, maxLen) {
  for (let p = 0; p < paths.length; p++) {
    if (paths[p] === null || paths[p].length !== 1) continue;
    const cell = paths[p][0];
    const c = cell % cols, r = (cell / cols) | 0;
    for (let d = 0; d < 4; d++) {
      const nx = c + DIRS[d][0], ny = r + DIRS[d][1];
      if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
      const q = grid[ny * cols + nx];
      if (q < 0 || q === p || paths[q] === null) continue;
      const target = paths[q];
      if (target.length + 1 > maxLen) continue;
      const ni = ny * cols + nx;
      let merged = null;
      if (target[0] === ni) merged = [cell, ...target];
      else if (target[target.length - 1] === ni) merged = [...target, cell];
      else continue; // adjacent to the path's middle — can't extend there
      if (!staticallyAlive(grid, cols, rows, merged)) continue;
      // Merging extends an end — reject if it would make either end's
      // arrowhead point along the merged body (preserve the no-self-cross
      // guarantee the walk established).
      const e1 = merged[0], e2 = merged[merged.length - 1];
      if (raySelfCrossing(cols, rows, merged, e1, endDir(cols, e1, merged[1]))
        || raySelfCrossing(cols, rows, merged, e2, endDir(cols, e2, merged[merged.length - 2]))) continue;
      paths[q] = merged;
      grid[cell] = q;
      paths[p] = null;
      break;
    }
  }
  const out = [];
  const remap = new Int16Array(paths.length).fill(-1);
  paths.forEach((cells, i) => { if (cells) { remap[i] = out.length; out.push(cells); } });
  for (let i = 0; i < grid.length; i++) if (grid[i] >= 0) grid[i] = remap[grid[i]];
  return out;
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

// True if the open ray from `head` in `dir` crosses one of the piece's own
// cells. Sliding through it is legal (the body vacates along the track), but
// the arrow READS as if it will smash into its own body — confusing.
function raySelfCrossing(cols, rows, cells, head, dir) {
  const dx = DIRS[dir][0], dy = DIRS[dir][1];
  let x = head % cols + dx, y = ((head / cols) | 0) + dy;
  while (x >= 0 && x < cols && y >= 0 && y < rows) {
    if (cells.includes(y * cols + x)) return true;
    x += dx; y += dy;
  }
  return false;
}

// Phase 2 — peel: repeatedly pick (seeded-randomly) a piece one of whose end
// continuations is a clear ray, orient its head to that end, remove it. When
// both ends qualify the choice is a coin flip (always preferring the walk-seed
// end would skew arrowheads toward up/left). Tiling already guarantees neither
// end crosses its own body, so any head the peel picks is collision-clean.
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
        const d0 = (rng() * 4) | 0;
        for (let k = 0; k < 4; k++) {
          const d = (d0 + k) % 4;
          if (peelRayFree(grid, cols, rows, removed, p, c, r, d)) { options.push([p, 0, d]); break; }
        }
      } else {
        const h1 = cells[0], h2 = cells[cells.length - 1];
        const d1 = endDir(cols, h1, cells[1]);
        const d2 = endDir(cols, h2, cells[cells.length - 2]);
        const ok1 = peelRayFree(grid, cols, rows, removed, p, h1 % cols, (h1 / cols) | 0, d1);
        const ok2 = peelRayFree(grid, cols, rows, removed, p, h2 % cols, (h2 / cols) | 0, d2);
        if (ok1 && ok2) options.push(rng() < 0.5 ? [p, 0, d1] : [p, 1, d2]);
        else if (ok1) options.push([p, 0, d1]);
        else if (ok2) options.push([p, 1, d2]);
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

// Build a full board: tile, merge stray singles, then peel; retry (bounded,
// same rng stream — still deterministic) until all phases succeed. Returns
// null if every attempt fails — callers must skip the candidate. `mask`
// (optional Uint8Array, 1 = open) carves the playable shape.
export function buildBoard(rng, cols, rows, minLen, maxLen, longBias, mask) {
  const { dead, rest } = seedClasses(cols, rows, mask);
  for (let attempt = 0; attempt < 400; attempt++) {
    const shuffled = rest.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0;
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const t = tile(rng, cols, rows, minLen, maxLen, longBias, mask, dead.concat(shuffled));
    if (!t) continue;
    const paths = mergeSingles(t.grid, cols, rows, t.paths, maxLen);
    const heads = peel(rng, t.grid, cols, rows, paths);
    if (!heads) continue;
    const pieces = paths.map((cells, p) => ({
      cells: heads[p].end === 0 ? cells.slice() : cells.slice().reverse(),
      dir: heads[p].dir,
    }));
    const grid = new Int16Array(cols * rows).fill(EMPTY);
    if (mask) for (let i = 0; i < grid.length; i++) if (!mask[i]) grid[i] = WALL;
    pieces.forEach((pc, id) => { for (const ci of pc.cells) grid[ci] = id; });
    // No self-cross repair needed: tiling + the merge guard guarantee neither
    // end of any snake points along its own body, so every shipped arrowhead
    // is collision-clean by construction.
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

// Level N: generate `balance.candidates` boards from derived seeds, score
// each, pick by percentile. Shaped levels carve the bracket's grid with the
// scheduled shape mask (maskFor may trim the dims). Candidates whose packing
// failed (null — not observed since tile-then-peel; skipped
// deterministically) are simply left out of the pool.
export function generateLevel(level, balance) {
  const { cols: waveCols, rows: waveRows, minLen, maxLen, longBias } = waveFor(level, balance);
  const shape = shapeFor(level, balance);
  let cols = waveCols, rows = waveRows, mask = null;
  if (shape) ({ cols, rows, mask } = maskFor(shape, waveCols, waveRows));
  const boards = [];
  const scores = [];
  for (let k = 0; k < balance.candidates; k++) {
    const rng = mulberry32(levelSeed(level, k));
    const built = buildBoard(rng, cols, rows, minLen, maxLen, longBias, mask);
    if (!built) continue;
    boards.push(built);
    scores.push(scoreBoard(built.pieces, built.grid, cols, rows, balance.scoreWeights));
  }
  if (boards.length === 0) {
    throw new Error(`generateLevel(${level}): every candidate failed to pack`);
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

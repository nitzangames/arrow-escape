export const VERSION = 'v0.1.23';

export const balance = {
  canvasW: 1080,
  canvasH: 1920,

  // NOTE: these constants are part of the level-determinism contract — changing
  // any of them after launch reshuffles every player's boards.
  // Level ramp brackets: [maxLevel, cols, rows, minLen, maxLen, longBias]
  // Boards are always 100% filled; piece count emerges from the length mix.
  // minLen is a sampling floor, not a guarantee — boxed-in walks still yield shorter pieces.
  ramp: [
    [3, 5, 7, 1, 4, 0],
    [6, 6, 9, 1, 5, 0.2],
    [10, 7, 10, 1, 5, 0.3],
    [14, 8, 12, 1, 6, 0.4],
    [19, 9, 13, 1, 6, 0.5],
    [60, 10, 14, 1, 7, 0.6],
    [Infinity, 10, 14, 1, 7, 0.7],
  ],
  shapeStartLevel: 10,    // first shaped level
  shapeEvery: 3,          // a shaped board every 3rd level from shapeStartLevel
  candidates: 8,          // boards generated per level, picked by percentile
  breatherEvery: 5,       // every 5th level is an easier "breather"
  percentileMin: 0.3,     // normal-level difficulty percentile at bracket start
  percentileMax: 0.9,     // ... at bracket end
  openBracketSpan: 100,   // virtual length of the final (Infinity) bracket
  scoreWeights: { wave: 1.0, blocked: 6.0, count: 0.05 },

  hearts: 3,

  startGold: 60,
  goldPerClear: 10,
  flawlessBonus: 5,
  hintCost: 25,
  refillCost: 50,

  flySpeed: 14,           // cells/s at launch
  flyAccel: 50,           // cells/s²
  flyMargin: 3,           // extra cells past the edge before a flight despawns
  bumpDur: 0.25,          // s
  bumpDist: 26,           // px of bump travel at the 150px reference cell size
  shakeDur: 0.3,          // s
  clearDelay: 0.6,        // s between last escape and the clear overlay
  failDelay: 0.6,         // s between fatal bump and the fail overlay
  maxFlights: 16,
};

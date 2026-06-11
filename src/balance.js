export const VERSION = 'v0.1.11';

export const balance = {
  canvasW: 1080,
  canvasH: 1920,

  // NOTE: these constants are part of the level-determinism contract — changing
  // any of them after launch reshuffles every player's boards.
  // Level ramp brackets: [maxLevel, cols, rows, minArrows, maxArrows]
  ramp: [
    [10, 4, 5, 6, 10],
    [30, 5, 7, 12, 18],
    [60, 6, 8, 20, 28],
    [120, 7, 9, 30, 42],
    [300, 7, 10, 40, 55],
    [Infinity, 8, 11, 55, 70],
  ],
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

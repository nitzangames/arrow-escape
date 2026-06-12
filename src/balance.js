export const VERSION = 'v0.1.30';

export const balance = {
  canvasW: 1080,
  canvasH: 1920,

  // NOTE: these constants are part of the level-determinism contract — changing
  // any of them after launch reshuffles every player's boards.
  // Tutorial levels (1..waveStart-1): fixed gentle settings, easiest candidate.
  tutorial: { cols: 5, rows: 7, minLen: 2, maxLen: 5 },
  // From waveStart, difficulty oscillates in waves of wavePeriod levels: board
  // dims and maxLen interpolate floor -> peak across each wave, and candidate
  // selection climbs wavePercentileMin -> 1.0 (a wave's last level ships the
  // hardest board of its pool). Tiers raise the ceilings as players progress.
  waveStart: 4,
  wavePeriod: 8,
  wavePercentileMin: 0.3,
  minLen: 2,              // target floor past the tutorial — singles are packing fallback only
  // [maxLevel, floorCols, floorRows, floorMaxLen, peakCols, peakRows, peakMaxLen, longBias]
  tiers: [
    [27, 7, 10, 6, 10, 14, 12, 0.5],
    [59, 8, 11, 7, 11, 15, 14, 0.5],
    [Infinity, 8, 12, 8, 12, 16, 16, 0.6],
  ],
  shapeStartLevel: 10,    // first shaped level
  shapeEvery: 3,          // a shaped board every 3rd level from shapeStartLevel
  candidates: 10,         // boards generated per level, picked by wave percentile
  scoreWeights: { wave: 1.5, blocked: 8.0, count: 0.02 },

  heartCap: 5,            // persistent heart pool (carries across levels)
  heartRegenMs: 3600000,  // +1 heart per hour, up to the cap

  startGold: 60,
  goldPerClear: 10,
  flawlessBonus: 5,
  hintCost: 25,
  refillCost: 50,
  // NBucks → gold packs (100 NBucks = $1). itemId goes to purchase analytics.
  goldPacks: [
    { id: 'gold-small', gold: 150, nbucks: 15 },
    { id: 'gold-medium', gold: 500, nbucks: 40 },
    { id: 'gold-large', gold: 1500, nbucks: 100 },
  ],

  flySpeed: 14,           // cells/s at launch
  flyAccel: 50,           // cells/s²
  flyMargin: 3,           // extra cells past the edge before a flight despawns
  bumpDur: 0.25,          // s
  bumpDist: 26,           // px of bump travel at the 150px reference cell size
  shakeDur: 0.3,          // s
  clearDelay: 0.6,        // s between last escape and the clear overlay
  popupDur: 1.5,          // s the purchase celebration card stays up
  failDelay: 0.6,         // s between fatal bump and the fail overlay
  maxFlights: 16,
};

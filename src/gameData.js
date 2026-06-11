// The single mutable state object. Allocated once at boot; per-level arrays
// are reallocated in startLevel (level start, not per-frame — allowed).
export function allocGameData(balance) {
  const mf = balance.maxFlights;
  return {
    screen: 'menu', // 'menu' | 'game' | 'clear' | 'fail'
    level: 1,
    gold: balance.startGold,
    sound: true,

    cols: 0,
    rows: 0,
    board: null,      // Int8Array(cols*rows): EMPTY or dir 0..3
    remaining: 0,     // arrows still on the board or in flight
    bumpT: null,      // Float32Array per cell, counts down while bumping
    hearts: balance.hearts,
    flawless: true,

    // Flying arrows (visual only — already removed from board)
    flights: {
      active: new Uint8Array(mf),
      c: new Int16Array(mf),
      r: new Int16Array(mf),
      dir: new Int8Array(mf),
      dist: new Float32Array(mf),     // cells travelled
      maxDist: new Float32Array(mf),  // despawn distance
      t: new Float32Array(mf),        // seconds in flight
      count: 0,
    },

    hintIndex: -1,
    hintPulse: 0,
    shakeT: 0,
    clearTimer: 0,
    clearFade: 0,
    failTimer: 0,
    goldEarnedClear: 0,
    goldEarnedBonus: 0,

    dirty: true, // render-on-demand flag for static screens
  };
}

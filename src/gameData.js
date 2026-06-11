// The single mutable state object. Allocated once at boot; per-level arrays
// are reallocated in startLevel (level start, not per-frame — allowed).
export function allocGameData(balance) {
  return {
    screen: 'menu', // 'menu' | 'game' | 'clear' | 'fail'
    level: 1,
    gold: balance.startGold,
    sound: true,

    cols: 0,
    rows: 0,
    pieces: null,    // [{cells: [headIdx, ...], dir}] from the generator
    grid: null,      // Int16Array(cols*rows): piece index or EMPTY
    alive: null,     // Uint8Array per piece: on the board or sliding out
    sliding: null,   // Uint8Array per piece: currently sliding out
    travel: null,    // Float32Array per piece: cells travelled along the track
    maxTravel: null, // Float32Array per piece: despawn distance
    slideT: null,    // Float32Array per piece: seconds sliding
    bumpT: null,     // Float32Array per piece: bump animation countdown
    slidingCount: 0,
    remaining: 0,    // pieces not yet tapped free
    hearts: balance.hearts,
    flawless: true,

    hintPiece: -1,
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

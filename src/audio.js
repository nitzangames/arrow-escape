// Procedural Web Audio SFX. AudioContext created on first user gesture.
let audioCtx = null;

export function initAudio() {
  if (audioCtx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (AC) audioCtx = new AC();
}

export function suspendAudio() {
  if (audioCtx && audioCtx.state === 'running') audioCtx.suspend();
}

export function resumeAudio() {
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}

function tone(freq, dur, type, vol, slideTo) {
  const t0 = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0 + dur);
}

// Consecutive escapes raise the whoosh pitch (spec: combo feedback).
// Audio-local state — resets on any bump or level-clear fanfare.
let combo = 0;

export function sfx(gd, name) {
  if (!gd.sound || !audioCtx) return;
  switch (name) {
    case 'tap': tone(660, 0.07, 'square', 0.10); break;
    case 'whoosh': {
      const lift = 1 + Math.min(combo, 10) * 0.06;
      tone(300 * lift, 0.25, 'sine', 0.18, 1400 * lift);
      combo++;
      break;
    }
    case 'bump': combo = 0; tone(140, 0.18, 'triangle', 0.25, 70); break;
    case 'fanfare':
      combo = 0;
      tone(523, 0.12, 'square', 0.13);
      setTimeout(() => { if (audioCtx) tone(659, 0.12, 'square', 0.13); }, 110);
      setTimeout(() => { if (audioCtx) tone(784, 0.22, 'square', 0.13); }, 220);
      break;
  }
}

import { balance } from './balance.js';
import { allocGameData } from './gameData.js';
import { startLevel, nextLevel, tapCell, tick, useHint, refillHearts } from './logic.js';
import { initSprites, render, hitTest } from './render.js';
import { findHint } from './generator.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// --- persistence: PlaySDK on platform, bare localStorage fallback for local dev ---
const SAVE_PREFIX = 'arrow-escape:';

function sdkSave(key, value) {
  if (window.PlaySDK) {
    PlaySDK.save(key, value);
    return;
  }
  localStorage.setItem(SAVE_PREFIX + key, value);
}

function sdkLoad(key) {
  if (window.PlaySDK) return PlaySDK.load(key);
  return Promise.resolve(localStorage.getItem(SAVE_PREFIX + key));
}

const gd = allocGameData(balance);

function saveProgress() {
  sdkSave('progress', JSON.stringify({ level: gd.level, gold: gd.gold, sound: gd.sound }));
}

// --- input ---
let canvasRect = canvas.getBoundingClientRect();
function refreshRect() { canvasRect = canvas.getBoundingClientRect(); }
window.addEventListener('resize', refreshRect);

canvas.addEventListener('pointerdown', (e) => {
  const x = (e.clientX - canvasRect.left) * (canvas.width / canvasRect.width);
  const y = (e.clientY - canvasRect.top) * (canvas.height / canvasRect.height);
  const hit = hitTest(gd, x, y);
  if (!hit) return;
  gd.dirty = true;
  if (hit.type === 'button') {
    onButton(hit.id);
  } else {
    const result = tapCell(gd, balance, hit.c, hit.r);
    if (result === 'bump' && window.PlaySDK && PlaySDK.haptic) PlaySDK.haptic('medium');
  }
});

function onButton(id) {
  switch (id) {
    case 'play': startLevel(gd, balance); break;
    case 'sound': gd.sound = !gd.sound; saveProgress(); break;
    case 'hint': if (useHint(gd, balance)) saveProgress(); break;
    case 'restart': startLevel(gd, balance); break;
    case 'next': nextLevel(gd, balance); saveProgress(); break;
    case 'retry': startLevel(gd, balance); break;
    case 'refill': if (refillHearts(gd, balance)) saveProgress(); break;
  }
}

// --- loop ---
let lastT = performance.now();
let prevScreen = 'menu';
let rafId = 0;

function frame(t) {
  rafId = requestAnimationFrame(frame);
  const dt = Math.min((t - lastT) / 1000, 1 / 30);
  lastT = t;
  tick(gd, balance, dt);
  if (gd.screen === 'clear' && prevScreen !== 'clear') saveProgress(); // gold was just awarded
  prevScreen = gd.screen;
  if (!gd.dirty) return; // static screens render only when something changed
  render(ctx, gd, balance);
  gd.dirty = false;
}

// --- pause/resume (battery): stop the loop and resume cleanly ---
function pauseGame() {
  cancelAnimationFrame(rafId);
}
function resumeGame() {
  lastT = performance.now();
  rafId = requestAnimationFrame(frame);
}
if (window.PlaySDK) {
  if (PlaySDK.onPause) PlaySDK.onPause(pauseGame);
  if (PlaySDK.onResume) PlaySDK.onResume(resumeGame);
}

// --- boot ---
async function boot() {
  if (window.PlaySDK && PlaySDK.onReady) {
    await new Promise((resolve) => PlaySDK.onReady(resolve));
  }
  const raw = await sdkLoad('progress');
  if (raw) {
    try {
      const s = JSON.parse(raw);
      if (Number.isFinite(s.level) && s.level >= 1) gd.level = Math.floor(s.level);
      if (Number.isFinite(s.gold) && s.gold >= 0) gd.gold = Math.floor(s.gold);
      gd.sound = s.sound !== false;
    } catch (err) {
      // corrupted save → keep defaults
    }
  }

  initSprites();
  refreshRect();

  // Screenshot mode: skip menus, show a busy mid-game board, play a few moves.
  if (window.PlaySDK && PlaySDK.screenshotMode) {
    gd.level = 40;
    startLevel(gd, balance);
    let taps = 0;
    const auto = setInterval(() => {
      const idx = findHint(gd.board, gd.cols, gd.rows);
      if (idx >= 0) tapCell(gd, balance, idx % gd.cols, (idx / gd.cols) | 0);
      if (++taps >= 3) clearInterval(auto);
    }, 800);
  }

  rafId = requestAnimationFrame(frame);
}

boot();

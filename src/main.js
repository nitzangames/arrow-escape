import { balance } from './balance.js';
import { allocGameData } from './gameData.js';
import {
  startLevel, nextLevel, tapCell, tick, useHint, refillHearts,
  heartTick, grantAdHeart, buyGoldPack, openShop, closeShop, showPopup,
} from './logic.js';
import { render, hitTest, spawnConfetti, confettiActive } from './render.js';
import { findHint } from './generator.js';
import { initAudio, sfx, suspendAudio, resumeAudio } from './audio.js';

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

// Rewarded ad. Dev fallback (no PlaySDK): auto-grant so flows are testable.
// On platform web, showRewardedAd grants without showing an ad (per docs).
async function sdkRewardedAd() {
  if (window.PlaySDK && typeof PlaySDK.showRewardedAd === 'function') {
    try {
      const r = await PlaySDK.showRewardedAd();
      return !!(r && r.rewarded);
    } catch (err) {
      return false;
    }
  }
  return true;
}

// NBucks spend. The method is exactly PlaySDK.nbucks.spend and the promise
// REJECTS on cancel/insufficient funds — rejection means nothing was charged.
async function sdkSpendNbucks(amount, itemDescription, itemId) {
  if (window.PlaySDK && PlaySDK.nbucks && typeof PlaySDK.nbucks.spend === 'function') {
    try {
      await PlaySDK.nbucks.spend({ amount, itemDescription, itemId });
      return true;
    } catch (err) {
      return false;
    }
  }
  return true; // dev fallback: free
}

const gd = allocGameData(balance);

function saveProgress(levelOverride) {
  sdkSave('progress', JSON.stringify({
    level: levelOverride ?? gd.level,
    gold: gd.gold,
    sound: gd.sound,
    hearts: gd.hearts,
    heartT: gd.heartT,
  }));
}

// --- input ---
let canvasRect = canvas.getBoundingClientRect();
function refreshRect() { canvasRect = canvas.getBoundingClientRect(); }
window.addEventListener('resize', refreshRect);

// FIX 1: guard against boot race — pointerdown is live while boot() still awaits save load
let booted = false;

canvas.addEventListener('pointerdown', (e) => {
  if (!booted) return;
  initAudio();
  const x = (e.clientX - canvasRect.left) * (canvas.width / canvasRect.width);
  const y = (e.clientY - canvasRect.top) * (canvas.height / canvasRect.height);
  if (gd.popupT > 0) { // any tap dismisses the purchase celebration card
    gd.popupT = 0;
    gd.popupText = '';
    gd.dirty = true;
    return;
  }
  const hit = hitTest(gd, x, y);
  if (!hit) return;
  gd.dirty = true;
  if (hit.type === 'button') {
    sfx(gd, 'tap');
    onButton(hit.id);
  } else {
    const result = tapCell(gd, balance, hit.c, hit.r);
    if (result === 'fly') sfx(gd, 'whoosh');
    else if (result === 'bump') {
      sfx(gd, 'bump');
      if (window.PlaySDK && PlaySDK.haptic) PlaySDK.haptic('medium');
      saveProgress(); // heart losses must survive a refresh — the gate depends on it
    }
  }
});

let busy = false;

async function onButton(id) {
  if (busy) return;
  switch (id) {
    case 'play':
      if (gd.hearts > 0) startLevel(gd, balance);
      break;
    case 'sound': gd.sound = !gd.sound; saveProgress(); break;
    case 'hint': if (useHint(gd, balance)) saveProgress(); break;
    case 'restart': if (gd.remaining > 0 && gd.hearts > 0) startLevel(gd, balance); break;
    case 'next': if (gd.hearts > 0) { nextLevel(gd, balance); saveProgress(); } break;
    case 'refill': if (refillHearts(gd, balance)) saveProgress(); break;
    case 'menu': gd.screen = 'menu'; gd.dirty = true; break;
    case 'shop': openShop(gd); break;
    case 'back': closeShop(gd); break;
    case 'ad': {
      busy = true;
      const rewarded = await sdkRewardedAd();
      busy = false;
      if (rewarded && grantAdHeart(gd, balance)) saveProgress();
      break;
    }
    case 'pack0':
    case 'pack1':
    case 'pack2': {
      const i = Number(id.slice(4));
      const pack = balance.goldPacks[i];
      busy = true;
      const ok = await sdkSpendNbucks(pack.nbucks, pack.gold + ' gold', pack.id);
      busy = false;
      if (ok) {
        buyGoldPack(gd, balance, i);
        showPopup(gd, balance, '+' + pack.gold);
        sfx(gd, 'fanfare');
        saveProgress();
      } else {
        gd.shopMsg = 'purchase cancelled';
      }
      gd.dirty = true;
      break;
    }
  }
}

// --- loop ---
let lastT = performance.now();
let lastHeartSec = 0;
let prevScreen = 'menu';
let rafId = 0;

function frame(t) {
  rafId = requestAnimationFrame(frame);
  const dt = Math.min((t - lastT) / 1000, 1 / 30);
  lastT = t;
  tick(gd, balance, dt);
  gd.nowMs = Date.now();
  const sec = (gd.nowMs / 1000) | 0;
  if (sec !== lastHeartSec) {
    lastHeartSec = sec;
    if (heartTick(gd, balance, gd.nowMs)) saveProgress(); // timer starts + hourly grants survive a refresh
    // countdown text changes every second on these screens
    if (gd.heartT !== null && gd.screen !== 'game' && gd.screen !== 'clear') gd.dirty = true;
  }
  if (gd.screen === 'clear' && prevScreen !== 'clear') {
    sfx(gd, 'fanfare');
    spawnConfetti(gd.nowMs);
    saveProgress(gd.level + 1); // clearing banks the NEXT level — no re-farm on reload
  }
  if (gd.screen === 'clear' && confettiActive(gd.nowMs)) gd.dirty = true;
  prevScreen = gd.screen;
  if (!gd.dirty) return; // static screens render only when something changed
  render(ctx, gd, balance);
  gd.dirty = false;
}

// --- pause/resume (battery): stop the loop and resume cleanly ---
function pauseGame() {
  cancelAnimationFrame(rafId);
  suspendAudio();
}
function resumeGame() {
  cancelAnimationFrame(rafId); // idempotent: SDK may fire onResume twice
  resumeAudio();
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
      if (Number.isFinite(s.hearts) && s.hearts >= 0) {
        gd.hearts = Math.min(Math.floor(s.hearts), balance.heartCap);
      }
      gd.heartT = Number.isFinite(s.heartT) ? s.heartT : null;
    } catch (err) {
      // corrupted save → keep defaults
    }
  }
  // FIX 1: mark boot complete so pointerdown handler becomes active
  booted = true;
  gd.adsAvailable = window.PlaySDK ? !!PlaySDK.adsAvailable : true; // dev: show ad button
  heartTick(gd, balance, Date.now()); // apply offline regen before first render

  refreshRect();

  // Screenshot mode: skip menus, show a busy mid-game board, play a few moves.
  if (window.PlaySDK && PlaySDK.screenshotMode) {
    gd.level = 40;
    gd.hearts = balance.heartCap;
    startLevel(gd, balance);
    let taps = 0;
    const auto = setInterval(() => {
      const mask = new Uint8Array(gd.pieces.length);
      for (let p = 0; p < gd.pieces.length; p++) mask[p] = gd.alive[p] && !gd.sliding[p] ? 1 : 0;
      const idx = findHint(gd.pieces, gd.grid, gd.cols, gd.rows, mask);
      if (idx >= 0) {
        const head = gd.pieces[idx].cells[0];
        tapCell(gd, balance, head % gd.cols, (head / gd.cols) | 0);
      }
      if (++taps >= 3) clearInterval(auto);
    }, 800);
  }

  rafId = requestAnimationFrame(frame);
}

boot();

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
let savePrefix = SAVE_PREFIX; // re-keyed per Harmony accountId
const fulfilledReceiptIds = new Set();

// --- Harmony (playharmony.ai) ---
// Only the Harmony build (build-harmony.sh) loads Harmony's loader, which
// defines window.PlayHarmony. Everywhere else this section is inert.
// Harmony has no NBucks and no ads, so the shop and ad buttons are hidden.
const onHarmony = !!window.PlayHarmony;
let harmony = null; // SDK handle once attached

async function sdkSave(key, value) {
  if (window.PlaySDK) {
    await PlaySDK.save(key, value);
    return;
  }
  localStorage.setItem(savePrefix + key, value);
}

function sdkLoad(key) {
  if (window.PlaySDK) return PlaySDK.load(key);
  return Promise.resolve(localStorage.getItem(savePrefix + key));
}

// Load + inflate the pre-baked levels (levels.json.gz) using the built-in
// DecompressionStream. Returns the level array, or null on any failure —
// the game then falls back to runtime generation (no hard dependency).
async function loadBakedLevels() {
  try {
    if (typeof DecompressionStream !== 'function') return null;
    const res = await fetch('levels.json.gz');
    if (!res.ok) return null;
    const stream = res.body.pipeThrough(new DecompressionStream('gzip'));
    const data = await new Response(stream).json();
    return Array.isArray(data) ? data : null;
  } catch (err) {
    return null;
  }
}

// Rewarded ad. Dev fallback (no PlaySDK): auto-grant so flows are testable.
// On platform web, showRewardedAd grants without showing an ad (per docs).
async function sdkRewardedAd() {
  if (onHarmony) return false; // no ads on Harmony (button is hidden too)
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
async function sdkSpendNbucks(amount, itemDescription, itemId, fulfill) {
  if (onHarmony) return false; // no NBucks on Harmony (shop is hidden too)
  if (window.PlaySDK && PlaySDK.nbucks && typeof PlaySDK.nbucks.spend === 'function') {
    try {
      await PlaySDK.nbucks.spend({ amount, itemDescription, itemId, fulfill });
      return true;
    } catch (err) {
      return false;
    }
  }
  try {
    await fulfill({});
    return true; // dev fallback: free
  } catch {
    return false;
  }
}

const gd = allocGameData(balance);

function saveProgress(levelOverride) {
  return sdkSave('progress', JSON.stringify(progressSnapshot(levelOverride)));
}

function progressSnapshot(levelOverride) {
  return {
    level: levelOverride ?? gd.level,
    gold: gd.gold,
    sound: gd.sound,
    hearts: gd.hearts,
    heartT: gd.heartT,
    fulfilledReceiptIds: [...fulfilledReceiptIds],
  };
}

function applyProgressSnapshot(s) {
  if (!s || typeof s !== 'object') return;
  if (Number.isFinite(s.level) && s.level >= 1) gd.level = Math.floor(s.level);
  if (Number.isFinite(s.gold) && s.gold >= 0) gd.gold = Math.floor(s.gold);
  gd.sound = s.sound !== false;
  if (Number.isFinite(s.hearts) && s.hearts >= 0) {
    gd.hearts = Math.min(Math.floor(s.hearts), balance.heartCap);
  }
  gd.heartT = Number.isFinite(s.heartT) ? s.heartT : null;
  fulfilledReceiptIds.clear();
  if (Array.isArray(s.fulfilledReceiptIds)) {
    for (const receiptId of s.fulfilledReceiptIds) {
      if (typeof receiptId === 'string') fulfilledReceiptIds.add(receiptId);
    }
  }
}

// --- input ---
let canvasRect = canvas.getBoundingClientRect();
function refreshRect() { canvasRect = canvas.getBoundingClientRect(); }
window.addEventListener('resize', refreshRect);

// FIX 1: guard against boot race — pointerdown is live while boot() still awaits save load
let booted = false;

canvas.addEventListener('pointerdown', (e) => {
  if (!booted) return;
  if (harmony && harmony.isOpen()) return;
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
      if (gd.casual || gd.hearts > 0) startLevel(gd, balance);
      break;
    case 'retry': if (gd.casual) startLevel(gd, balance); break;
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
      const ok = await sdkSpendNbucks(
        pack.nbucks,
        pack.gold + ' gold',
        pack.id,
        async (result) => {
          const receiptId = typeof result?.receiptId === 'string' ? result.receiptId : null;
          if (receiptId && typeof window.PlaySDK?.updateSave === 'function') {
            const saved = await window.PlaySDK.updateSave('progress', (currentBlob) => {
              let current = progressSnapshot();
              try { if (currentBlob) current = JSON.parse(currentBlob); } catch {}
              const receipts = Array.isArray(current.fulfilledReceiptIds)
                ? current.fulfilledReceiptIds.filter(id => typeof id === 'string')
                : [];
              if (receipts.includes(receiptId)) return JSON.stringify(current);
              return JSON.stringify({
                ...current,
                gold: (Number.isFinite(current.gold) ? current.gold : gd.gold) + pack.gold,
                fulfilledReceiptIds: [...receipts, receiptId],
              });
            });
            applyProgressSnapshot(JSON.parse(saved));
            gd.dirty = true;
            return;
          }
          if (receiptId && fulfilledReceiptIds.has(receiptId)) return;
          const previousGold = gd.gold;
          if (!buyGoldPack(gd, balance, i)) throw new Error('invalid gold pack');
          if (receiptId) fulfilledReceiptIds.add(receiptId);
          try {
            await saveProgress();
          } catch (error) {
            gd.gold = previousGold;
            if (receiptId) fulfilledReceiptIds.delete(receiptId);
            throw error;
          }
        },
      );
      busy = false;
      if (ok) {
        showPopup(gd, balance, '+' + pack.gold);
        sfx(gd, 'fanfare');
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
  if (harmony && harmony.isOpen()) return; // stay paused under the overlay
  cancelAnimationFrame(rafId); // idempotent: SDK may fire onResume twice
  resumeAudio();
  lastT = performance.now();
  rafId = requestAnimationFrame(frame);
}
if (window.PlaySDK) {
  if (PlaySDK.onPause) PlaySDK.onPause(pauseGame);
  if (PlaySDK.onResume) PlaySDK.onResume(resumeGame);
}

// Harmony session → per-player saves keyed on accountId. A player's first
// sign-in on this browser adopts the current progress; a key that already
// has a save loads it (and drops back to the menu so the board matches).
async function applyHarmonySession(session) {
  const signedIn = session && (session.kind === 'account' || session.kind === 'guest');
  const prefix = signedIn ? SAVE_PREFIX + session.accountId + ':' : SAVE_PREFIX;
  if (prefix === savePrefix) return;
  savePrefix = prefix;
  const raw = await sdkLoad('progress');
  if (!raw) { saveProgress(); return; }
  try {
    applyProgressSnapshot(JSON.parse(raw));
  } catch (err) {
    return; // corrupted save → keep current state
  }
  heartTick(gd, balance, Date.now());
  if (gd.casual) gd.hearts = balance.heartCap;
  if (gd.screen !== 'menu') gd.screen = 'menu';
  gd.dirty = true;
}

function attachHarmony() {
  // No container → the overlay attaches to the whole document, so the badge
  // sits in a viewport corner. The 9:16 canvas letterboxes on desktop and on
  // tall phones, so it lands in the margin instead of on the RESTART button /
  // gold counter. (The SDK says never to pass document.body.)
  window.PlayHarmony.attach().then((h) => {
    harmony = h;
    h.on('open', pauseGame);
    h.on('close', resumeGame);
    h.auth.onSessionChanged(applyHarmonySession);
    return h.auth.getSession().then(applyHarmonySession);
  }).catch((e) => console.warn('Harmony is not available', e)); // game plays on without it
}

// --- boot ---
async function boot() {
  if (window.PlaySDK && PlaySDK.onReady) {
    await new Promise((resolve) => PlaySDK.onReady(resolve));
  }
  const raw = await sdkLoad('progress');
  if (raw) {
    try {
      applyProgressSnapshot(JSON.parse(raw));
    } catch (err) {
      // corrupted save → keep defaults
    }
  }
  // FIX 1: mark boot complete so pointerdown handler becomes active
  booted = true;
  gd.adsAvailable = window.PlaySDK ? !!PlaySDK.adsAvailable : !onHarmony; // dev: show ad button
  gd.shopAvailable = !onHarmony;
  gd.casual = onHarmony; // Harmony has no monetization: no gold, per-level hearts
  if (gd.casual) gd.hearts = balance.heartCap;
  heartTick(gd, balance, Date.now()); // apply offline regen before first render

  refreshRect();

  // Load baked levels off the critical path so the menu paints immediately;
  // until they arrive, getLevel falls back to generation (gd.baked stays null).
  loadBakedLevels().then((b) => { gd.baked = b; });

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
  if (onHarmony) attachHarmony(); // after the save load; never awaited
}

// On Harmony, a sign-in window returning to this page only finishes sign-in;
// it must not start the game.
if (!(onHarmony && window.__MANTICORE_AUTH_RETURN__)) boot();

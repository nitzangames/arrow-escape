import { balance } from './balance.js';
import { allocGameData } from './gameData.js';
import { startLevel, nextLevel, tapCell, tick, useHint, refillHearts } from './logic.js';
import { initSprites, render, hitTest } from './render.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

const gd = allocGameData(balance);

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
    tapCell(gd, balance, hit.c, hit.r);
  }
});

function onButton(id) {
  switch (id) {
    case 'play': startLevel(gd, balance); break;
    case 'sound': gd.sound = !gd.sound; break;
    case 'hint': useHint(gd, balance); break;
    case 'restart': startLevel(gd, balance); break;
    case 'next': nextLevel(gd, balance); break;
    case 'retry': startLevel(gd, balance); break;
    case 'refill': refillHearts(gd, balance); break;
  }
}

let lastT = performance.now();
function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min((t - lastT) / 1000, 1 / 30);
  lastT = t;
  tick(gd, balance, dt);
  if (!gd.dirty) return; // static screens render only when something changed
  render(ctx, gd, balance);
  gd.dirty = false;
}

initSprites();
refreshRect();
requestAnimationFrame(frame);

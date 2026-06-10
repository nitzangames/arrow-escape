// All drawing + screen layout + hit-testing. Reads gd, never mutates it.
// Paper Minimal theme, validated in mockups/theme-explorer.html (theme A).

import { EMPTY, DIRS } from './generator.js';
import { VERSION } from './balance.js';

const W = 1080;
const H = 1920;

const THEME = {
  bg: '#f4f1ea',
  boardBg: '#ece8df',
  gridLine: '#dcd7cb',
  tile: '#2b2b2e',
  glyph: '#f4f1ea',
  ink: '#2b2b2e',
  inkSoft: '#8a857a',
  accent: '#e2574c',
  heartEmpty: '#d5cfc2',
  buttonBg: '#2b2b2e',
  buttonText: '#f4f1ea',
  buttonSoftBg: '#e3ded2',
  buttonSoftText: '#2b2b2e',
  overlay: 'rgba(244, 241, 234, 0.92)',
};

// Type ladder — canvas px. Only these sizes, nothing in between.
const FONT = {
  display: '800 144px -apple-system, system-ui, sans-serif',
  title: '800 126px -apple-system, system-ui, sans-serif',
  heading: '700 90px -apple-system, system-ui, sans-serif',
  subheading: '700 66px -apple-system, system-ui, sans-serif',
  bodyLarge: '600 48px -apple-system, system-ui, sans-serif',
  body: '600 36px -apple-system, system-ui, sans-serif',
  caption: '500 21px -apple-system, system-ui, sans-serif',
};

// Same-purpose buttons share identical sizes (platform rule).
const BUTTONS = {
  menu: [
    { id: 'play', x: 290, y: 1180, w: 500, h: 140, label: 'PLAY' },
    { id: 'sound', x: 290, y: 1370, w: 500, h: 100, label: 'SOUND' },
  ],
  game: [
    { id: 'hint', x: 80, y: 1720, w: 440, h: 120, label: 'HINT' },
    { id: 'restart', x: 560, y: 1720, w: 440, h: 120, label: 'RESTART' },
  ],
  clear: [
    { id: 'next', x: 290, y: 1180, w: 500, h: 140, label: 'NEXT' },
  ],
  fail: [
    { id: 'retry', x: 80, y: 1180, w: 440, h: 140, label: 'RETRY' },
    { id: 'refill', x: 560, y: 1180, w: 440, h: 140, label: 'CONTINUE' },
  ],
};

// Board geometry — cached per (cols, rows) so render allocates nothing per frame.
const BOARD_AREA = { x: 60, w: 960, y: 460, h: 1160, maxCell: 150 };
const geom = { cols: 0, rows: 0, cell: 0, bx: 0, by: 0 };

function ensureGeom(gd) {
  if (geom.cols === gd.cols && geom.rows === gd.rows) return geom;
  geom.cols = gd.cols;
  geom.rows = gd.rows;
  geom.cell = Math.min(BOARD_AREA.w / gd.cols, BOARD_AREA.h / gd.rows, BOARD_AREA.maxCell);
  geom.bx = (W - gd.cols * geom.cell) / 2;
  geom.by = BOARD_AREA.y + (BOARD_AREA.h - gd.rows * geom.cell) / 2;
  return geom;
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

// Arrow tiles pre-rendered once (4 directions) at max cell size.
const TILE = 150;
const tileSprites = [];

export function initSprites() {
  if (tileSprites.length) return;
  for (let dir = 0; dir < 4; dir++) {
    const oc = document.createElement('canvas');
    oc.width = TILE;
    oc.height = TILE;
    const c = oc.getContext('2d');
    const pad = 8;
    c.fillStyle = THEME.tile;
    roundRect(c, pad, pad, TILE - pad * 2, TILE - pad * 2, 28);
    c.fill();
    c.translate(TILE / 2, TILE / 2);
    c.rotate(dir * Math.PI / 2);
    c.fillStyle = THEME.glyph;
    c.beginPath();
    c.moveTo(0, -40); c.lineTo(30, 0); c.lineTo(12, 0); c.lineTo(12, 38);
    c.lineTo(-12, 38); c.lineTo(-12, 0); c.lineTo(-30, 0);
    c.closePath();
    c.fill();
    tileSprites.push(oc);
  }
}

function drawHeart(c, x, y, s, color) {
  c.fillStyle = color;
  c.beginPath();
  c.moveTo(x, y + s * 0.32);
  c.bezierCurveTo(x, y - s * 0.1, x - s * 0.55, y - s * 0.1, x - s * 0.55, y + s * 0.25);
  c.bezierCurveTo(x - s * 0.55, y + s * 0.55, x - s * 0.2, y + s * 0.75, x, y + s * 0.95);
  c.bezierCurveTo(x + s * 0.2, y + s * 0.75, x + s * 0.55, y + s * 0.55, x + s * 0.55, y + s * 0.25);
  c.bezierCurveTo(x + s * 0.55, y - s * 0.1, x, y - s * 0.1, x, y + s * 0.32);
  c.closePath();
  c.fill();
}

function drawButton(c, b, soft, disabled, labelOverride, font) {
  c.globalAlpha = disabled ? 0.4 : 1;
  c.fillStyle = soft ? THEME.buttonSoftBg : THEME.buttonBg;
  roundRect(c, b.x, b.y, b.w, b.h, 32);
  c.fill();
  c.fillStyle = soft ? THEME.buttonSoftText : THEME.buttonText;
  c.font = font || FONT.subheading;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(labelOverride || b.label, b.x + b.w / 2, b.y + b.h / 2 + 4);
  c.globalAlpha = 1;
  c.textBaseline = 'alphabetic';
}

function drawVersion(c, centered) {
  c.fillStyle = THEME.inkSoft;
  c.font = FONT.caption;
  c.textAlign = centered ? 'center' : 'left';
  c.fillText(VERSION, centered ? W / 2 : 24, H - 22);
}

function renderMenu(c, gd, balance) {
  c.fillStyle = THEME.ink;
  c.textAlign = 'center';
  c.font = FONT.display;
  c.fillText('ARROW', W / 2, 420);
  c.fillText('ESCAPE', W / 2, 580);
  // accent arrow under the title
  c.save();
  c.translate(W / 2, 700);
  c.rotate(Math.PI / 2);
  c.fillStyle = THEME.accent;
  c.beginPath();
  c.moveTo(0, -40); c.lineTo(30, 0); c.lineTo(12, 0); c.lineTo(12, 38);
  c.lineTo(-12, 38); c.lineTo(-12, 0); c.lineTo(-30, 0);
  c.closePath();
  c.fill();
  c.restore();

  c.fillStyle = THEME.inkSoft;
  c.font = FONT.bodyLarge;
  c.fillText('Set every arrow free', W / 2, 830);

  c.fillStyle = THEME.ink;
  c.font = FONT.heading;
  c.fillText('LEVEL ' + gd.level, W / 2, 1040);

  drawButton(c, BUTTONS.menu[0], false, false);
  drawButton(c, BUTTONS.menu[1], true, false, 'SOUND: ' + (gd.sound ? 'ON' : 'OFF'), FONT.bodyLarge);

  c.fillStyle = THEME.inkSoft;
  c.font = FONT.body;
  c.fillText('● ' + gd.gold + ' gold', W / 2, 1560);
  drawVersion(c, true);
}

function renderGame(c, gd, balance) {
  c.save();
  if (gd.shakeT > 0) {
    c.translate((Math.random() - 0.5) * 16 * gd.shakeT, (Math.random() - 0.5) * 16 * gd.shakeT);
  }

  // HUD
  c.fillStyle = THEME.ink;
  c.font = FONT.subheading;
  c.textAlign = 'left';
  c.fillText('LEVEL ' + gd.level, 80, 180);
  c.textAlign = 'right';
  c.fillText('● ' + gd.gold, W - 80, 180);
  for (let i = 0; i < balance.hearts; i++) {
    drawHeart(c, W / 2 + (i - 1) * 100, 270, 64, i < gd.hearts ? THEME.accent : THEME.heartEmpty);
  }

  // Board panel + grid
  const g = ensureGeom(gd);
  c.fillStyle = THEME.boardBg;
  roundRect(c, g.bx - 20, g.by - 20, gd.cols * g.cell + 40, gd.rows * g.cell + 40, 30);
  c.fill();
  c.strokeStyle = THEME.gridLine;
  c.lineWidth = 2;
  for (let r = 0; r <= gd.rows; r++) {
    c.beginPath();
    c.moveTo(g.bx, g.by + r * g.cell);
    c.lineTo(g.bx + gd.cols * g.cell, g.by + r * g.cell);
    c.stroke();
  }
  for (let col = 0; col <= gd.cols; col++) {
    c.beginPath();
    c.moveTo(g.bx + col * g.cell, g.by);
    c.lineTo(g.bx + col * g.cell, g.by + gd.rows * g.cell);
    c.stroke();
  }

  // Hint highlight under the tile
  if (gd.hintIndex >= 0) {
    const hc = gd.hintIndex % gd.cols;
    const hr = (gd.hintIndex / gd.cols) | 0;
    const pulse = 0.5 + 0.5 * Math.sin(gd.hintPulse * 6);
    c.globalAlpha = 0.35 + 0.55 * pulse;
    c.strokeStyle = THEME.accent;
    c.lineWidth = 10;
    roundRect(c, g.bx + hc * g.cell + 2, g.by + hr * g.cell + 2, g.cell - 4, g.cell - 4, 24);
    c.stroke();
    c.globalAlpha = 1;
  }

  // Tiles (with bump offset)
  const scale = g.cell / TILE;
  for (let r = 0; r < gd.rows; r++) {
    for (let col = 0; col < gd.cols; col++) {
      const i = r * gd.cols + col;
      const dir = gd.board[i];
      if (dir === EMPTY) continue;
      let ox = 0, oy = 0;
      if (gd.bumpT[i] > 0) {
        const k = Math.sin((1 - gd.bumpT[i] / balance.bumpDur) * Math.PI) * balance.bumpDist * scale;
        ox = DIRS[dir][0] * k;
        oy = DIRS[dir][1] * k;
      }
      c.drawImage(tileSprites[dir], g.bx + col * g.cell + ox, g.by + r * g.cell + oy, g.cell, g.cell);
    }
  }

  // Flights
  const f = gd.flights;
  for (let k = 0; k < f.active.length; k++) {
    if (!f.active[k]) continue;
    const dir = f.dir[k];
    const x = g.bx + (f.c[k] + DIRS[dir][0] * f.dist[k]) * g.cell;
    const y = g.by + (f.r[k] + DIRS[dir][1] * f.dist[k]) * g.cell;
    c.drawImage(tileSprites[dir], x, y, g.cell, g.cell);
  }

  c.restore();

  // Bottom buttons (outside the shake transform)
  const hintDisabled = gd.gold < balance.hintCost || gd.hintIndex >= 0;
  drawButton(c, BUTTONS.game[0], false, hintDisabled, 'HINT · ' + balance.hintCost, FONT.bodyLarge);
  drawButton(c, BUTTONS.game[1], true, false, 'RESTART', FONT.bodyLarge);
  drawVersion(c, false);
}

function renderClear(c, gd) {
  c.fillStyle = THEME.overlay;
  c.fillRect(0, 0, W, H);
  c.fillStyle = THEME.ink;
  c.textAlign = 'center';
  c.font = FONT.display;
  c.fillText('LEVEL CLEAR', W / 2, 800);
  c.fillStyle = THEME.accent;
  c.font = FONT.bodyLarge;
  c.fillText('+' + gd.goldEarnedClear + ' gold', W / 2, 920);
  if (gd.goldEarnedBonus > 0) {
    c.fillText('+' + gd.goldEarnedBonus + ' flawless bonus', W / 2, 990);
  }
  drawButton(c, BUTTONS.clear[0], false, false);
  drawVersion(c, true);
}

function renderFail(c, gd, balance) {
  c.fillStyle = THEME.overlay;
  c.fillRect(0, 0, W, H);
  c.fillStyle = THEME.ink;
  c.textAlign = 'center';
  c.font = FONT.title;
  c.fillText('OUT OF HEARTS', W / 2, 800);
  c.fillStyle = THEME.inkSoft;
  c.font = FONT.bodyLarge;
  c.fillText('● ' + gd.gold + ' gold', W / 2, 940);
  drawButton(c, BUTTONS.fail[0], true, false, 'RETRY', FONT.bodyLarge);
  drawButton(c, BUTTONS.fail[1], false, gd.gold < balance.refillCost,
    'CONTINUE · ' + balance.refillCost, FONT.bodyLarge);
  drawVersion(c, true);
}

export function render(ctx, gd, balance) {
  ctx.fillStyle = THEME.bg;
  ctx.fillRect(0, 0, W, H);
  if (gd.screen === 'menu') {
    renderMenu(ctx, gd, balance);
    return;
  }
  renderGame(ctx, gd, balance);
  if (gd.screen === 'clear') renderClear(ctx, gd);
  else if (gd.screen === 'fail') renderFail(ctx, gd, balance);
}

// Hit-testing shares BUTTONS and geometry with the renderer.
// Returns {type:'button', id} | {type:'cell', c, r} | null.
export function hitTest(gd, x, y) {
  const btns = BUTTONS[gd.screen];
  if (btns) {
    for (const b of btns) {
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        return { type: 'button', id: b.id };
      }
    }
  }
  if (gd.screen === 'game') {
    const g = ensureGeom(gd);
    const c = Math.floor((x - g.bx) / g.cell);
    const r = Math.floor((y - g.by) / g.cell);
    if (c >= 0 && c < gd.cols && r >= 0 && r < gd.rows) return { type: 'cell', c, r };
  }
  return null;
}

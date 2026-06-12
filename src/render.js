// All drawing + screen layout + hit-testing. Reads gd, never mutates it.
// Paper Minimal theme, validated in mockups/theme-explorer.html (theme A).

import { DIRS, WALL } from './generator.js';
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
    { id: 'ad', x: 80, y: 1370, w: 440, h: 100, label: 'AD' },
    { id: 'refill', x: 560, y: 1370, w: 440, h: 100, label: 'REFILL' },
    { id: 'shop', x: 290, y: 1510, w: 500, h: 100, label: 'SHOP' },
    { id: 'sound', x: 290, y: 1650, w: 500, h: 100, label: 'SOUND' },
  ],
  game: [
    { id: 'hint', x: 80, y: 1720, w: 440, h: 120, label: 'HINT' },
    { id: 'restart', x: 560, y: 1720, w: 440, h: 120, label: 'RESTART' },
  ],
  clear: [
    { id: 'next', x: 290, y: 1180, w: 500, h: 140, label: 'NEXT' },
  ],
  fail: [
    { id: 'ad', x: 80, y: 1180, w: 440, h: 140, label: 'AD' },
    { id: 'refill', x: 560, y: 1180, w: 440, h: 140, label: 'REFILL' },
    { id: 'shop', x: 290, y: 1380, w: 500, h: 100, label: 'GET GOLD' },
    { id: 'menu', x: 290, y: 1520, w: 500, h: 100, label: 'MENU' },
  ],
  shop: [
    { id: 'pack0', x: 90, y: 760, w: 900, h: 170, label: '' },
    { id: 'pack1', x: 90, y: 970, w: 900, h: 170, label: '' },
    { id: 'pack2', x: 90, y: 1180, w: 900, h: 170, label: '' },
    { id: 'back', x: 290, y: 1450, w: 500, h: 120, label: 'BACK' },
  ],
};

// Buttons that exist right now, given game state. Shared by rendering and
// hit-testing so a hidden button can never be tapped.
function visibleButtons(gd) {
  const btns = BUTTONS[gd.screen];
  if (!btns) return null;
  return btns.filter((b) => {
    if (b.id === 'ad') {
      return gd.hearts === 0 && !gd.adUsedThisGate && gd.adsAvailable;
    }
    if (b.id === 'refill') {
      if (gd.screen === 'menu') return gd.hearts === 0;
      return true; // gate: always offered (disabled state shows if gold short)
    }
    return true;
  });
}

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

// --- snake piece drawing -------------------------------------------------
// Pieces are stroked as thick rounded polylines through their cell centers.
// A module-scope scratch point avoids per-frame allocation.
const _pt = { x: 0, y: 0 };

function cellCx(gd, g, ci) { return g.bx + ((ci % gd.cols) + 0.5) * g.cell; }
function cellCy(gd, g, ci) { return g.by + (((ci / gd.cols) | 0) + 0.5) * g.cell; }

// Trace the piece's resting path into the current ctx path (no stroke).
function tracePiecePath(c, gd, g, p, ox, oy) {
  const cells = gd.pieces[p].cells;
  for (let j = cells.length - 1; j >= 0; j--) {
    const x = cellCx(gd, g, cells[j]) + ox;
    const y = cellCy(gd, g, cells[j]) + oy;
    if (j === cells.length - 1) {
      c.moveTo(x, y);
      if (cells.length === 1) c.lineTo(x + 0.01, y); // dot → round-cap circle
    } else {
      c.lineTo(x, y);
    }
  }
}

function setPieceStroke(c, g, widthFactor, style) {
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.lineWidth = g.cell * widthFactor;
  c.strokeStyle = style;
}

// Arrowhead triangle on the head, pointing dir, drawn in the glyph color.
function drawHeadGlyph(c, x, y, cellPx, dir) {
  const u = cellPx / 150;
  c.save();
  c.translate(x, y);
  c.rotate(dir * Math.PI / 2);
  c.fillStyle = THEME.glyph;
  c.beginPath();
  c.moveTo(0, -32 * u);
  c.lineTo(24 * u, 14 * u);
  c.lineTo(0, 4 * u);
  c.lineTo(-24 * u, 14 * u);
  c.closePath();
  c.fill();
  c.restore();
}

function drawPiece(c, gd, g, p, ox, oy) {
  setPieceStroke(c, g, 0.72, THEME.tile);
  c.beginPath();
  tracePiecePath(c, gd, g, p, ox, oy);
  c.stroke();
  const head = gd.pieces[p].cells[0];
  drawHeadGlyph(c, cellCx(gd, g, head) + ox, cellCy(gd, g, head) + oy, g.cell, gd.pieces[p].dir);
}

// Position (canvas px) of sliding segment j at the piece's current travel.
// Track arclength: tail = 0 … head = L-1, then the straight exit ray.
function segPos(gd, g, p, j, out) {
  const piece = gd.pieces[p];
  const L = piece.cells.length;
  const s = (L - 1 - j) + gd.travel[p];
  if (L > 1 && s <= L - 1) {
    const k = Math.min(Math.floor(s), L - 2);
    const f = s - k;
    const a = piece.cells[L - 1 - k];     // arclength k   (tail side)
    const b = piece.cells[L - 2 - k];     // arclength k+1 (head side)
    out.x = cellCx(gd, g, a) + (cellCx(gd, g, b) - cellCx(gd, g, a)) * f;
    out.y = cellCy(gd, g, a) + (cellCy(gd, g, b) - cellCy(gd, g, a)) * f;
  } else {
    const head = piece.cells[0];
    const ext = s - (L - 1);
    out.x = cellCx(gd, g, head) + DIRS[piece.dir][0] * ext * g.cell;
    out.y = cellCy(gd, g, head) + DIRS[piece.dir][1] * ext * g.cell;
  }
}

function drawSlidingPiece(c, gd, g, p) {
  const piece = gd.pieces[p];
  const L = piece.cells.length;
  setPieceStroke(c, g, 0.72, THEME.tile);
  c.beginPath();
  for (let j = L - 1; j >= 0; j--) {
    segPos(gd, g, p, j, _pt);
    if (j === L - 1) {
      c.moveTo(_pt.x, _pt.y);
      if (L === 1) c.lineTo(_pt.x + 0.01, _pt.y);
    } else {
      c.lineTo(_pt.x, _pt.y);
    }
  }
  c.stroke();
  segPos(gd, g, p, 0, _pt);
  drawHeadGlyph(c, _pt.x, _pt.y, g.cell, piece.dir); // head rides the straight ray → angle = dir
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

// Row of heartCap hearts centered on (cx, y); filled up to gd.hearts.
// The just-lost heart flashes while the shake plays (game screen only).
function drawHeartRow(c, gd, balance, cx, y, size, gap, flashing) {
  const n = balance.heartCap;
  for (let i = 0; i < n; i++) {
    let color = i < gd.hearts ? THEME.accent : THEME.heartEmpty;
    if (flashing && i === gd.hearts && gd.shakeT > 0) {
      color = Math.sin(gd.shakeT * 40) > 0 ? THEME.accent : THEME.heartEmpty;
    }
    drawHeart(c, cx + (i - (n - 1) / 2) * gap, y, size, color);
  }
}

// "Next ♥ in 42:13" — gd.nowMs is stamped by main each frame.
function heartCountdownText(gd) {
  if (gd.heartT === null) return '';
  const ms = Math.max(0, gd.heartT - gd.nowMs);
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return 'next ♥ in ' + m + ':' + String(s).padStart(2, '0');
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
  c.fillText('LEVEL ' + gd.level, W / 2, 980);

  drawHeartRow(c, gd, balance, W / 2, 1040, 48, 76, false);
  if (gd.hearts < balance.heartCap) {
    c.fillStyle = THEME.inkSoft;
    c.font = FONT.body;
    c.fillText(heartCountdownText(gd), W / 2, 1140);
  }

  for (const b of visibleButtons(gd)) {
    if (b.id === 'play') drawButton(c, b, false, gd.hearts === 0);
    else if (b.id === 'ad') drawButton(c, b, true, false, 'AD · +1 ♥', FONT.bodyLarge);
    else if (b.id === 'refill') {
      drawButton(c, b, true, gd.gold < balance.refillCost,
        'REFILL · ' + balance.refillCost, FONT.bodyLarge);
    } else if (b.id === 'shop') drawButton(c, b, false, false, 'SHOP', FONT.bodyLarge);
    else if (b.id === 'sound') {
      drawButton(c, b, true, false, 'SOUND: ' + (gd.sound ? 'ON' : 'OFF'), FONT.bodyLarge);
    }
  }

  c.fillStyle = THEME.inkSoft;
  c.font = FONT.body;
  c.fillText('● ' + gd.gold + ' gold', W / 2, 1810);
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
  drawHeartRow(c, gd, balance, W / 2, 270, 48, 76, true);

  // Board panel hugs the shape: stroking every open cell's rect with a thick
  // round-joined line in the panel color, then filling the cells, produces
  // the union silhouette with a padded, round-cornered boundary (interior
  // strokes vanish into same-color fills). Walls draw nothing; EMPTY cells
  // keep their floor (vacated cells stay part of the board).
  const g = ensureGeom(gd);
  c.fillStyle = THEME.boardBg;
  c.strokeStyle = THEME.boardBg;
  c.lineJoin = 'round';
  c.lineWidth = 40; // extends the panel 20px beyond the cells, like the old rect panel
  for (let r = 0; r < gd.rows; r++) {
    for (let col = 0; col < gd.cols; col++) {
      if (gd.grid[r * gd.cols + col] === WALL) continue;
      const x = g.bx + col * g.cell, y = g.by + r * g.cell;
      c.strokeRect(x, y, g.cell, g.cell);
      c.fillRect(x, y, g.cell, g.cell);
    }
  }
  // Cell grid inside the shape only
  c.strokeStyle = THEME.gridLine;
  c.lineWidth = 2;
  c.lineJoin = 'miter';
  for (let r = 0; r < gd.rows; r++) {
    for (let col = 0; col < gd.cols; col++) {
      if (gd.grid[r * gd.cols + col] === WALL) continue;
      c.strokeRect(g.bx + col * g.cell, g.by + r * g.cell, g.cell, g.cell);
    }
  }

  // Hint highlight: accent outline under the whole hinted piece
  if (gd.hintPiece >= 0 && gd.alive[gd.hintPiece] && !gd.sliding[gd.hintPiece]) {
    const pulse = 0.5 + 0.5 * Math.sin(gd.hintPulse * 6);
    c.globalAlpha = 0.35 + 0.55 * pulse;
    setPieceStroke(c, g, 0.92, THEME.accent);
    c.beginPath();
    tracePiecePath(c, gd, g, gd.hintPiece, 0, 0);
    c.stroke();
    c.globalAlpha = 1;
  }

  // Resting pieces (with bump offset toward the blocker)
  const bumpScale = g.cell / 150;
  for (let p = 0; p < gd.pieces.length; p++) {
    if (!gd.alive[p] || gd.sliding[p]) continue;
    let ox = 0, oy = 0;
    if (gd.bumpT[p] > 0) {
      const k = Math.sin((1 - gd.bumpT[p] / balance.bumpDur) * Math.PI) * balance.bumpDist * bumpScale;
      ox = DIRS[gd.pieces[p].dir][0] * k;
      oy = DIRS[gd.pieces[p].dir][1] * k;
    }
    drawPiece(c, gd, g, p, ox, oy);
  }

  // Sliding pieces (drawn over resting ones)
  for (let p = 0; p < gd.pieces.length; p++) {
    if (gd.sliding[p]) drawSlidingPiece(c, gd, g, p);
  }

  c.restore();

  // Bottom buttons (outside the shake transform)
  const hintDisabled = gd.gold < balance.hintCost || gd.hintPiece >= 0;
  drawButton(c, BUTTONS.game[0], false, hintDisabled, 'HINT · ' + balance.hintCost, FONT.bodyLarge);
  drawButton(c, BUTTONS.game[1], true, false, 'RESTART', FONT.bodyLarge);
  drawVersion(c, false);
}

function renderClear(c, gd) {
  c.globalAlpha = gd.clearFade;
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
  c.globalAlpha = 1;
}

function renderFail(c, gd, balance) {
  c.fillStyle = THEME.overlay;
  c.fillRect(0, 0, W, H);
  c.fillStyle = THEME.ink;
  c.textAlign = 'center';
  c.font = FONT.title;
  c.fillText('OUT OF HEARTS', W / 2, 760);
  drawHeartRow(c, gd, balance, W / 2, 830, 48, 76, false);
  c.fillStyle = THEME.inkSoft;
  c.font = FONT.bodyLarge;
  c.fillText(heartCountdownText(gd), W / 2, 990);
  c.font = FONT.body;
  c.fillText('● ' + gd.gold + ' gold', W / 2, 1060);
  for (const b of visibleButtons(gd)) {
    if (b.id === 'ad') drawButton(c, b, false, false, 'AD · +1 ♥', FONT.bodyLarge);
    else if (b.id === 'refill') {
      drawButton(c, b, false, gd.gold < balance.refillCost,
        'REFILL · ' + balance.refillCost, FONT.bodyLarge);
    } else if (b.id === 'shop') drawButton(c, b, true, false, 'GET GOLD', FONT.bodyLarge);
    else if (b.id === 'menu') drawButton(c, b, true, false, 'MENU', FONT.bodyLarge);
  }
  drawVersion(c, true);
}

function renderShop(c, gd, balance) {
  c.fillStyle = THEME.bg;
  c.fillRect(0, 0, W, H);
  c.fillStyle = THEME.ink;
  c.textAlign = 'center';
  c.font = FONT.title;
  c.fillText('GOLD SHOP', W / 2, 380);
  c.fillStyle = THEME.inkSoft;
  c.font = FONT.bodyLarge;
  c.fillText('● ' + gd.gold + ' gold', W / 2, 500);
  c.font = FONT.body;
  c.fillText('100 NBucks = $1', W / 2, 580);

  const packs = balance.goldPacks;
  for (let i = 0; i < packs.length; i++) {
    const b = BUTTONS.shop[i];
    c.fillStyle = THEME.buttonSoftBg;
    roundRect(c, b.x, b.y, b.w, b.h, 32);
    c.fill();
    c.fillStyle = THEME.ink;
    c.textAlign = 'left';
    c.font = FONT.subheading;
    c.fillText('● ' + packs[i].gold + ' gold', b.x + 60, b.y + b.h / 2 + 22);
    c.fillStyle = THEME.accent;
    c.textAlign = 'right';
    c.fillText(packs[i].nbucks + ' NB', b.x + b.w - 60, b.y + b.h / 2 + 22);
  }
  c.textAlign = 'center';
  if (gd.shopMsg) {
    c.fillStyle = THEME.inkSoft;
    c.font = FONT.body;
    c.fillText(gd.shopMsg, W / 2, 1420);
  }
  drawButton(c, BUTTONS.shop[3], false, false, 'BACK', FONT.bodyLarge);
  drawVersion(c, true);

  // Purchase celebration card: scales in with a small overshoot bounce,
  // fades out over the last 0.2 s. Dismissed early by any tap (main).
  if (gd.popupT > 0 && gd.popupText) {
    const age = balance.popupDur - gd.popupT;
    let scale;
    if (age < 0.15) scale = (age / 0.15) * 1.08;
    else if (age < 0.3) scale = 1.08 - 0.08 * ((age - 0.15) / 0.15);
    else scale = 1;
    c.save();
    c.globalAlpha = Math.min(1, gd.popupT / 0.2);
    c.translate(W / 2, 940);
    c.scale(scale, scale);
    c.fillStyle = THEME.ink;
    roundRect(c, -320, -180, 640, 360, 44);
    c.fill();
    c.fillStyle = THEME.glyph;
    c.textAlign = 'center';
    c.font = FONT.heading;
    c.fillText('● ' + gd.popupText, 0, -20);
    c.fillStyle = THEME.accent;
    c.font = FONT.subheading;
    c.fillText('GOLD!', 0, 90);
    c.restore();
    c.globalAlpha = 1;
  }
}

export function render(ctx, gd, balance) {
  ctx.fillStyle = THEME.bg;
  ctx.fillRect(0, 0, W, H);
  if (gd.screen === 'menu') {
    renderMenu(ctx, gd, balance);
    return;
  }
  if (gd.screen === 'shop') {
    renderShop(ctx, gd, balance);
    return;
  }
  renderGame(ctx, gd, balance);
  if (gd.screen === 'clear') renderClear(ctx, gd);
  else if (gd.screen === 'fail') renderFail(ctx, gd, balance);
}

// Hit-testing shares BUTTONS and geometry with the renderer.
// Returns {type:'button', id} | {type:'cell', c, r} | null.
export function hitTest(gd, x, y) {
  const btns = visibleButtons(gd);
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
    if (c >= 0 && c < gd.cols && r >= 0 && r < gd.rows
      && gd.grid[r * gd.cols + c] !== WALL) {
      return { type: 'cell', c, r };
    }
  }
  return null;
}

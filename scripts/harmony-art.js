// Harmony listing art, drawn with the game's own modules (browser ES module).
// Loaded by scripts/harmony-art.html; driven by scripts/gen-harmony-art.js.
// Dev-only: scripts/* is in .zipignore and not in build-harmony.sh FILES.

import { balance } from '../src/balance.js';
import { allocGameData } from '../src/gameData.js';
import { startLevel, tapCell, tick, useHint } from '../src/logic.js';
import { render, spawnConfetti } from '../src/render.js';
import { findHint, WALL } from '../src/generator.js';

const BG = '#f4f1ea', BOARD = '#ece8df', INK = '#2b2b2e', SOFT = '#8a857a', RED = '#e2574c', CREAM = '#f4f1ea';
const SANS = '-apple-system, system-ui, sans-serif';

async function loadBaked() {
  const res = await fetch('../levels.json.gz');
  const stream = res.body.pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).json();
}
const baked = await loadBaked();

// ── game state helpers ──────────────────────────────────────────────────────
function freeMask(gd) {
  const m = new Uint8Array(gd.pieces.length);
  for (let p = 0; p < gd.pieces.length; p++) m[p] = gd.alive[p] && !gd.sliding[p] ? 1 : 0;
  return m;
}
function headOf(gd, p) { const h = gd.pieces[p].cells[0]; return [h % gd.cols, (h / gd.cols) | 0]; }
function tapPiece(gd, p) { const [c, r] = headOf(gd, p); return tapCell(gd, balance, c, r); }
function nextFree(gd) { return findHint(gd.pieces, gd.grid, gd.cols, gd.rows, freeMask(gd)); }
function isFree(gd, p) {
  const m = new Uint8Array(gd.pieces.length); m[p] = 1;
  return findHint(gd.pieces, gd.grid, gd.cols, gd.rows, m) === p;
}
function run(gd, secs) { for (let t = 0; t < secs; t += 1 / 60) tick(gd, balance, 1 / 60); }

function newGame(level, { gold = 260, hearts = balance.heartCap } = {}) {
  const gd = allocGameData(balance);
  gd.baked = baked;
  gd.casual = true; // the Harmony build: no gold, per-level hearts
  gd.level = level;
  gd.gold = gold;
  gd.hearts = hearts;
  gd.nowMs = Date.now();
  startLevel(gd, balance);
  return gd;
}
// Clear `done` pieces fully, then launch `flying` more and freeze them mid-air.
function play(gd, done, flying, flyT = 0.14) {
  for (let i = 0; i < done; i++) { const p = nextFree(gd); if (p < 0) break; tapPiece(gd, p); run(gd, 3); }
  for (let i = 0; i < flying; i++) { const p = nextFree(gd); if (p < 0) break; tapPiece(gd, p); run(gd, flyT / flying); }
  return gd;
}

// Frames render at FS x so the 3840x2160 banner stays sharp. render() draws
// in fixed 1080x1920 coordinates, so a scale transform is all it needs.
const FS = 2;
function frame(gd, s = FS) {
  gd.shakeT = 0;
  gd.dirty = true;
  const out = document.createElement('canvas');
  out.width = 1080 * s; out.height = 1920 * s;
  const c = out.getContext('2d');
  c.setTransform(s, 0, 0, s, 0, 0);
  render(c, gd, balance);
  return out;
}
// Board panel bounds (non-background pixels between HUD and buttons).
function boardBox(cv) {
  const d = cv.getContext('2d').getImageData(0, 330, 1080, 1350).data;
  let x0 = 1080, y0 = 1e9, x1 = 0, y1 = 0;
  for (let y = 0; y < 1350; y++) for (let x = 0; x < 1080; x++) {
    const i = (y * 1080 + x) * 4;
    if (Math.abs(d[i] - 0xf4) + Math.abs(d[i + 1] - 0xf1) + Math.abs(d[i + 2] - 0xea) > 12) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return { x: x0, y: y0 + 330, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// A late-game board with a few arrows already escaped and a few in flight.
function hero(level, cleared, flying) {
  const gd = newGame(level);
  const b1 = boardBox(frame(gd, 1));
  const box = { x: b1.x * FS, y: b1.y * FS, w: b1.w * FS, h: b1.h * FS };
  play(gd, cleared, 0);
  play(gd, 0, flying, 0.16);
  return { cv: frame(gd), box, gd };
}

// ── drawing helpers ─────────────────────────────────────────────────────────
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function rr(c, x, y, w, h, r) { c.beginPath(); c.roundRect(x, y, w, h, r); }
// Draw src region `box` scaled by k, with its centre at (cx, cy).
function place(c, src, box, cx, cy, k, rot = 0) {
  c.save(); c.translate(cx, cy); c.rotate(rot); c.scale(k, k);
  c.drawImage(src, box.x, box.y, box.w, box.h, -box.w / 2, -box.h / 2, box.w, box.h);
  c.restore();
}
// Arrow glyph: an ink pill with a cream chevron, like a game piece.
function pill(c, x, y, len, th, color = INK, glyph = CREAM) {
  c.save();
  c.lineCap = 'round'; c.strokeStyle = color; c.lineWidth = th;
  c.beginPath(); c.moveTo(x, y); c.lineTo(x + len, y); c.stroke();
  const s = th * 0.26, hx = x + len - th * 0.05;
  c.fillStyle = glyph;
  c.beginPath(); c.moveTo(hx + s, y); c.lineTo(hx - s * 0.9, y - s); c.lineTo(hx - s * 0.35, y); c.lineTo(hx - s * 0.9, y + s); c.closePath(); c.fill();
  c.restore();
}
function speed(c, x, y, len, th, color) {
  c.save(); c.strokeStyle = color; c.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    c.globalAlpha = 0.5 - i * 0.14; c.lineWidth = th * (0.16 - i * 0.03);
    const yy = y + (i - 1) * th * 0.32;
    c.beginPath(); c.moveTo(x - len * (0.5 + i * 0.25), yy); c.lineTo(x, yy); c.stroke();
  }
  c.restore();
}
// Two-line wordmark, left- or centre-aligned at (x, y) top. Returns height.
function title(c, x, y, size, { align = 'left', a = INK, b = RED, shadow = null } = {}) {
  c.save();
  c.textAlign = align; c.textBaseline = 'alphabetic';
  c.font = `900 ${size}px ${SANS}`;
  const lh = size * 0.92;
  if (shadow) {
    c.fillStyle = shadow;
    c.fillText('ARROW', x, y + size * 0.82 + size * 0.05);
    c.fillText('ESCAPE', x, y + size * 0.82 + lh + size * 0.05);
  }
  c.fillStyle = a; c.fillText('ARROW', x, y + size * 0.82);
  c.fillStyle = b; c.fillText('ESCAPE', x, y + size * 0.82 + lh);
  c.restore();
  return size * 0.82 + lh + size * 0.2;
}
function grain(c, w, h, color, alpha) {
  c.save(); c.globalAlpha = alpha; c.strokeStyle = color; c.lineWidth = 2;
  const s = Math.max(w, h) / 14;
  for (let x = 0; x <= w; x += s) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); }
  for (let y = 0; y <= h; y += s) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
  c.restore();
}

// ── the four thumbnail directions ───────────────────────────────────────────
// Each takes (W, H) and returns a canvas. Wide = 1280x720, square = 1024x1024.
// The best-looking board in a level range: most of the floor covered by
// pieces, and close to the 3:4 aspect the art frames are laid out for.
function pickLevel(lo, hi) {
  let best = lo, bestScore = -1;
  for (let L = lo; L <= hi; L++) {
    const gd = newGame(L);
    let floor = 0, filled = 0;
    for (let i = 0; i < gd.grid.length; i++) { if (gd.grid[i] !== WALL) { floor++; if (gd.grid[i] >= 0) filled++; } }
    const fullness = floor / gd.grid.length;
    const aspect = gd.cols / gd.rows;
    const score = (filled / floor) * fullness - Math.abs(aspect - 0.75);
    if (score > bestScore) { bestScore = score; best = L; }
  }
  return best;
}
const H0 = hero(pickLevel(30, 60), 1, 2);
const DENSE = hero(pickLevel(80, 120), 2, 2);

const VARIANTS = {
  // A — The Tangle: same language as the nitzan.games thumbnail. Board fills
  // the frame edge to edge, one arrow red, title on a translucent paper band.
  tangle(W, H) {
    const cv = canvas(W, H), c = cv.getContext('2d');
    c.fillStyle = BOARD; c.fillRect(0, 0, W, H);
    const { cv: src, box } = DENSE;
    const k = Math.max(W / box.w, H / box.h) * 1.18;
    place(c, src, box, W / 2, H / 2 - H * 0.04, k);
    const wide = W > H;
    c.fillStyle = 'rgba(244,241,234,0.9)';
    if (wide) { c.fillRect(0, 0, W * 0.5, H); title(c, W * 0.05, H * 0.3, H * 0.17); }
    else { c.fillRect(0, H * 0.66, W, H * 0.34); title(c, W / 2, H * 0.7, W * 0.13, { align: 'center' }); }
    return cv;
  },
  // B — Breakout: calm paper, board card on the right with arrows shooting
  // out of it past the frame; big ink wordmark on the left.
  breakout(W, H) {
    const cv = canvas(W, H), c = cv.getContext('2d');
    c.fillStyle = BG; c.fillRect(0, 0, W, H);
    const wide = W > H;
    const { cv: src, box } = H0;
    const k = wide ? (H * 0.98) / box.h : (H * 0.56) / box.h;
    const cx = wide ? W * 0.74 : W * 0.5, cy = wide ? H * 0.53 : H * 0.68;
    c.save(); c.shadowColor = 'rgba(43,43,46,0.18)'; c.shadowBlur = 40; c.shadowOffsetY = 16;
    place(c, src, box, cx, cy, k, -0.05); c.restore();
    const th = (wide ? H : W) * 0.075;
    const fy = wide ? H * 0.2 : H * 0.36;
    speed(c, W - th * 2.2, fy, th * 4, th, INK);
    pill(c, W - th * 2.4, fy, th * 2.6, th, RED);
    if (wide) title(c, W * 0.055, H * 0.3, H * 0.19);
    else title(c, W * 0.07, H * 0.06, W * 0.15);
    return cv;
  },
  // C — Red poster: accent-red field, the board as a tilted card, cream type.
  poster(W, H) {
    const cv = canvas(W, H), c = cv.getContext('2d');
    c.fillStyle = RED; c.fillRect(0, 0, W, H);
    grain(c, W, H, '#ffffff', 0.07);
    const wide = W > H;
    const { cv: src, box } = H0;
    const k = wide ? (H * 1.05) / box.h : (H * 0.56) / box.h;
    const cx = wide ? W * 0.72 : W * 0.56, cy = wide ? H * 0.56 : H * 0.69;
    c.save(); c.shadowColor = 'rgba(80,10,5,0.4)'; c.shadowBlur = 50; c.shadowOffsetY = 24;
    c.fillStyle = BG;
    const pw = box.w * k + 60, ph = box.h * k + 60;
    c.translate(cx, cy); c.rotate(0.07); rr(c, -pw / 2, -ph / 2, pw, ph, 40); c.fill(); c.restore();
    place(c, src, box, cx, cy, k, 0.07);
    const opts = { a: CREAM, b: INK, shadow: 'rgba(80,10,5,0.35)' };
    if (wide) title(c, W * 0.05, H * 0.28, H * 0.19, opts);
    else title(c, W * 0.07, H * 0.05, W * 0.15, opts);
    return cv;
  },
  // D — Night ink: dark field, the board glowing as a paper panel, one big
  // red arrow escaping across the title.
  ink(W, H) {
    const cv = canvas(W, H), c = cv.getContext('2d');
    const g = c.createRadialGradient(W * 0.6, H * 0.5, 0, W * 0.6, H * 0.5, Math.max(W, H) * 0.8);
    g.addColorStop(0, '#3a3a3e'); g.addColorStop(1, '#1c1c1f');
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    const wide = W > H;
    const { cv: src, box } = DENSE;
    const k = wide ? (H * 0.84) / box.h : (H * 0.56) / box.h;
    const cx = wide ? W * 0.73 : W * 0.5, cy = wide ? H * 0.5 : H * 0.63;
    c.save(); c.shadowColor = 'rgba(0,0,0,0.6)'; c.shadowBlur = 60; c.fillStyle = BOARD;
    const pw = box.w * k + 40, ph = box.h * k + 40;
    rr(c, cx - pw / 2, cy - ph / 2, pw, ph, 36); c.fill(); c.restore();
    place(c, src, box, cx, cy, k);
    const th = (wide ? H : W) * 0.08;
    const ay = wide ? H * 0.8 : H * 0.9;
    const ax = wide ? W * 0.06 : W * 0.04;
    speed(c, ax + th * 0.2, ay, th * 3, th, CREAM);
    pill(c, ax + th * 0.5, ay, th * 3.2, th, RED);
    if (wide) title(c, W * 0.055, H * 0.2, H * 0.19, { a: CREAM, b: RED });
    else title(c, W / 2, H * 0.05, W * 0.15, { align: 'center', a: CREAM, b: RED });
    return cv;
  },
};

// ── banner + logo (built from the chosen direction's palette) ───────────────
function banner(variant) {
  const W = 1440, H = 810, S = 3840 / 1440; // designed at 1440x810, output 3840x2160
  const cv = canvas(3840, 2160), c = cv.getContext('2d');
  c.scale(S, S);
  const dark = variant === 'ink', red = variant === 'poster';
  if (dark) {
    const g = c.createRadialGradient(W * 0.7, H * 0.5, 0, W * 0.7, H * 0.5, W * 0.8);
    g.addColorStop(0, '#3a3a3e'); g.addColorStop(1, '#1c1c1f'); c.fillStyle = g;
  } else c.fillStyle = red ? RED : (variant === 'tangle' ? BOARD : BG);
  c.fillRect(0, 0, W, H);
  if (red) grain(c, W, H, '#ffffff', 0.07);
  // Left ~45% stays calm: Harmony draws the logo and blurb there.
  const { cv: src, box } = variant === 'tangle' || dark ? DENSE : H0;
  const k = (H * 0.84) / box.h;
  const cx = W * 0.66, cy = H * 0.53;
  c.save(); c.shadowColor = dark ? 'rgba(0,0,0,0.6)' : 'rgba(43,43,46,0.2)'; c.shadowBlur = 50 * S; c.shadowOffsetY = 18 * S;
  c.fillStyle = BOARD; const pw = box.w * k + 40, ph = box.h * k + 40;
  c.translate(cx, cy); c.rotate(-0.04); rr(c, -pw / 2, -ph / 2, pw, ph, 36); c.fill(); c.restore();
  place(c, src, box, cx, cy, k, -0.04);
  // An arrow that has just escaped off the board's right edge.
  const th = 62, bx = cx + (box.w * k) / 2 + 40;
  speed(c, bx + 40, H * 0.2, 300, th, dark ? CREAM : INK);
  pill(c, bx + 40, H * 0.2, Math.min(170, W - bx - 90), th, red ? INK : RED);
  return cv;
}
function logo(variant) {
  const cv = canvas(1024, 1024), c = cv.getContext('2d');
  const dark = variant === 'ink' || variant === 'poster';
  const a = dark ? CREAM : INK, b = variant === 'poster' ? INK : RED;
  // Outline: poster uses its red so both the cream and ink words read.
  const edge = variant === 'poster' ? RED : dark ? 'rgba(28,28,31,0.85)' : 'rgba(244,241,234,0.9)';
  // Transparent: a soft outline keeps it legible on any Harmony background.
  c.save();
  c.font = `900 200px ${SANS}`; c.textAlign = 'center';
  c.lineJoin = 'round'; c.lineWidth = 28;
  c.strokeStyle = edge;
  c.strokeText('ARROW', 512, 470); c.strokeText('ESCAPE', 512, 660);
  c.fillStyle = a; c.fillText('ARROW', 512, 470);
  c.fillStyle = b; c.fillText('ESCAPE', 512, 660);
  c.restore();
  c.save(); c.lineCap = 'round'; c.strokeStyle = edge; c.lineWidth = 120;
  c.beginPath(); c.moveTo(372, 270); c.lineTo(652, 270); c.stroke(); c.restore();
  pill(c, 372, 270, 280, 92, variant === 'poster' ? INK : RED);
  return trim(cv, 10);
}
// Scale the opaque content up to sit `margin` px from the nearest edge (form rule).
function trim(cv, margin) {
  const { width: w, height: h } = cv;
  const d = cv.getContext('2d').getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = 0, y1 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (d[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1, k = Math.min((w - 2 * margin) / bw, (h - 2 * margin) / bh);
  const out = canvas(w, h), c = out.getContext('2d');
  c.imageSmoothingQuality = 'high';
  c.drawImage(cv, x0, y0, bw, bh, (w - bw * k) / 2, (h - bh * k) / 2, bw * k, bh * k);
  return out;
}
// Phone banner, 1440x2560: no text, subject in the upper half (the title and
// buttons cover the lower part).
function bannerPortrait(variant) {
  const W = 1440, H = 2560;
  const cv = canvas(W, H), c = cv.getContext('2d');
  const dark = variant === 'ink', red = variant === 'poster';
  if (dark) {
    const g = c.createRadialGradient(W / 2, H * 0.3, 0, W / 2, H * 0.3, H * 0.7);
    g.addColorStop(0, '#3a3a3e'); g.addColorStop(1, '#1c1c1f'); c.fillStyle = g;
  } else c.fillStyle = red ? RED : (variant === 'tangle' ? BOARD : BG);
  c.fillRect(0, 0, W, H);
  if (red) grain(c, W, H, '#ffffff', 0.07);
  const { cv: src, box } = variant === 'tangle' || dark ? DENSE : H0;
  const k = (H * 0.4) / box.h;
  const cx = W * 0.46, cy = H * 0.27;
  c.save(); c.shadowColor = dark ? 'rgba(0,0,0,0.6)' : 'rgba(43,43,46,0.2)'; c.shadowBlur = 90; c.shadowOffsetY = 34;
  c.fillStyle = BOARD; const pw = box.w * k + 70, ph = box.h * k + 70;
  c.translate(cx, cy); c.rotate(-0.04); rr(c, -pw / 2, -ph / 2, pw, ph, 60); c.fill(); c.restore();
  place(c, src, box, cx, cy, k, -0.04);
  const th = 110, bx = cx + (box.w * k) / 2 + 60;
  speed(c, bx + 40, H * 0.12, 420, th, dark ? CREAM : INK);
  pill(c, bx + 40, H * 0.12, Math.min(260, W - bx - 150), th, red ? INK : RED);
  return cv;
}

// ── store screenshots (1440x2560, caption above a framed game shot) ────────
const CAPTIONS = [
  ['TAP TO ', 'ESCAPE', ''],
  ['MIND THE ', 'ORDER', ''],
  ['BLOCKED?\nLOSE A ', 'HEART', ''],
  ['STUCK?\nGRAB A ', 'HINT', ''],
  ['CLEAR THE ', 'BOARD', ''],
];
function shotStates() {
  const s1 = play(newGame(6), 1, 1, 0.12);
  const s2 = play(newGame(pickLevel(45, 70)), 2, 2, 0.15);
  const s3 = newGame(30);
  play(s3, 3, 0);
  for (let p = 0; p < s3.pieces.length; p++) {
    if (s3.alive[p] && !isFree(s3, p)) { tapPiece(s3, p); run(s3, 0.12); break; }
  }
  const s4 = newGame(24);
  play(s4, 4, 0);
  useHint(s4, balance);
  s4.hintPulse = Math.PI / 12; // pulse at its brightest
  const s5 = newGame(18);
  for (let guard = 0; guard < 400 && s5.screen === 'game'; guard++) {
    const p = nextFree(s5); if (p >= 0) tapPiece(s5, p); run(s5, 1);
  }
  run(s5, 1);
  s5.nowMs = performance.now() + 1e6;
  spawnConfetti(s5.nowMs);
  s5.nowMs += 1100;
  return [s1, s2, s3, s4, s5];
}
function screenshot(gd, [a, hi, b]) {
  const W = 1440, H = 2560;
  const cv = canvas(W, H), c = cv.getContext('2d');
  c.fillStyle = BG; c.fillRect(0, 0, W, H);
  c.font = `900 128px ${SANS}`; c.textBaseline = 'alphabetic';
  // wrap into at most 2 lines on word boundaries, keeping the highlight
  const words = [];
  for (const [txt, col] of [[a, INK], [hi, RED], [b, INK]]) {
    txt.split('\n').forEach((seg, i) => {
      if (i > 0) words.push(null); // forced line break
      for (const w of seg.split(' ').filter(Boolean)) words.push([w, col]);
    });
  }
  const lines = [[]]; let lw = 0;
  for (const w of words) {
    if (!w) { lines.push([]); lw = 0; continue; }
    const ww = c.measureText(w[0] + ' ').width;
    if (lw + ww > W - 160 && lines[lines.length - 1].length) { lines.push([]); lw = 0; }
    lines[lines.length - 1].push(w); lw += ww;
  }
  const top = lines.length === 1 ? 330 : 260;
  lines.forEach((ln, i) => {
    const full = c.measureText(ln.map((w) => w[0]).join(' ')).width;
    let x = (W - full) / 2;
    for (const [w, col] of ln) { c.fillStyle = col; c.fillText(w, x, top + i * 140); x += c.measureText(w + ' ').width; }
  });
  const sw = 1080, sh = 1920, sx = (W - sw) / 2, sy = 540;
  c.save(); c.shadowColor = 'rgba(43,43,46,0.22)'; c.shadowBlur = 70; c.shadowOffsetY = 24;
  c.fillStyle = INK; rr(c, sx - 14, sy - 14, sw + 28, sh + 28, 70); c.fill(); c.restore();
  c.save(); rr(c, sx, sy, sw, sh, 58); c.clip();
  c.drawImage(frame(gd), sx, sy, sw, sh); c.restore();
  return cv;
}

const url = (cv) => cv.toDataURL('image/png');
window.__art = {
  variants: Object.keys(VARIANTS),
  mockups() {
    const out = {};
    for (const [k, f] of Object.entries(VARIANTS)) { out[`mock-${k}-wide`] = url(f(1280, 720)); out[`mock-${k}-square`] = url(f(1024, 1024)); }
    return out;
  },
  final(variant) {
    const f = VARIANTS[variant];
    return { thumb: url(f(1280, 720)), 'thumb-square': url(f(1024, 1024)), banner: url(banner(variant)), 'banner-portrait': url(bannerPortrait(variant)), logo: url(logo(variant)) };
  },
  screenshots() {
    const out = {};
    shotStates().forEach((gd, i) => { out[`screenshots/screenshot-${i + 1}`] = url(screenshot(gd, CAPTIONS[i])); });
    return out;
  },
};
window.__artReady = true;

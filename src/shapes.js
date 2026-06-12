// Pure shape masks and the per-level shape schedule. No DOM — runs under
// Node for tests.
//
// Each shape is an implicit inside(x, y) formula over a fixed bounding box.
// maskFor samples cell centers across the bbox, then trims empty border
// rows/columns (pointy tips can be narrower than half a cell, leaving the
// outermost sampled line empty) — so the returned dims may be smaller than
// requested. The same formulas produce clean silhouettes at every ramp size.

const heartIn = (x, y) => {
  const a = x * x + y * y - 1;
  return a * a * a - x * x * y * y * y <= 0;
};

export const SHAPES = {
  heart:     { inside: heartIn, bbox: [-1.139, 1.139, -1.0, 1.236] },
  // 1.3 (not the pointier 1.02): 4-wide tips are the narrowest the tiler can
  // reliably pack at 10x14 — 1.02 leaves 32 dead cells and never packs.
  diamond:   { inside: (x, y) => Math.abs(x) + Math.abs(y) <= 1.3, bbox: [-1, 1, -1, 1] },
  plus:      { inside: (x, y) => Math.abs(x) <= 0.34 || Math.abs(y) <= 0.34, bbox: [-1, 1, -1, 1] },
  donut:     { inside: (x, y) => !(Math.abs(x) <= 0.45 && Math.abs(y) <= 0.45), bbox: [-1, 1, -1, 1] },
  // Waist floor 0.12 keeps a 2-cell waist on 10-wide boards; the schedule
  // only uses the hourglass at 10x14.
  hourglass: { inside: (x, y) => Math.abs(x) <= Math.max(0.12, Math.abs(y)), bbox: [-1, 1, -1, 1] },
  triangle:  { inside: (x, y) => Math.abs(x) <= (1 - y) / 2, bbox: [-1, 1, -1, 1] },
};

export const SHAPE_ORDER = ['heart', 'diamond', 'plus', 'donut', 'hourglass', 'triangle'];

// Shape key for a level, or null for a plain rectangle. Deterministic:
// every 3rd level from shapeStartLevel, cycling SHAPE_ORDER.
export function shapeFor(level, balance) {
  const start = balance.shapeStartLevel;
  if (level < start || (level - start) % balance.shapeEvery !== 0) return null;
  return SHAPE_ORDER[((level - start) / balance.shapeEvery) % SHAPE_ORDER.length];
}

// Sample a shape over a cols×rows grid, trim empty border rows/cols.
// Returns { cols, rows, mask } — mask is a Uint8Array, 1 = playable cell.
export function maskFor(shapeKey, cols, rows) {
  const { inside, bbox: [x0, x1, y0, y1] } = SHAPES[shapeKey];
  let m = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      const x = x0 + (c + 0.5) / cols * (x1 - x0);
      const y = y1 - (r + 0.5) / rows * (y1 - y0); // row 0 = top = max y
      row.push(inside(x, y) ? 1 : 0);
    }
    m.push(row);
  }
  while (m.length && m[0].every((v) => !v)) m.shift();
  while (m.length && m[m.length - 1].every((v) => !v)) m.pop();
  while (m.length && m.every((row) => !row[0])) m = m.map((row) => row.slice(1));
  while (m.length && m.every((row) => !row[row.length - 1])) m = m.map((row) => row.slice(0, -1));
  const tc = m[0].length, tr = m.length;
  const mask = new Uint8Array(tc * tr);
  for (let r = 0; r < tr; r++) for (let c = 0; c < tc; c++) mask[r * tc + c] = m[r][c];
  return { cols: tc, rows: tr, mask };
}

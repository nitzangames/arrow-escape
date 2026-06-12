import { test } from 'node:test';
import assert from 'node:assert/strict';
import { balance } from '../src/balance.js';
import { SHAPES, SHAPE_ORDER, shapeFor, maskFor } from '../src/shapes.js';

function lines(m) {
  const out = [];
  for (let r = 0; r < m.rows; r++) {
    let line = '';
    for (let c = 0; c < m.cols; c++) line += m.mask[r * m.cols + c] ? 'X' : '.';
    out.push(line);
  }
  return out;
}

test('shapeFor: rectangles before level 10, then every 3rd level cycles the six shapes', () => {
  for (let lvl = 1; lvl <= 9; lvl++) assert.equal(shapeFor(lvl, balance), null);
  assert.equal(shapeFor(10, balance), 'heart');
  assert.equal(shapeFor(11, balance), null);
  assert.equal(shapeFor(12, balance), null);
  assert.equal(shapeFor(13, balance), 'diamond');
  assert.equal(shapeFor(16, balance), 'plus');
  assert.equal(shapeFor(19, balance), 'donut');
  assert.equal(shapeFor(22, balance), 'hourglass');
  assert.equal(shapeFor(25, balance), 'triangle');
  assert.equal(shapeFor(28, balance), 'heart'); // cycle wraps
});

test('heart mask at 5x7 matches the golden grid', () => {
  const m = maskFor('heart', 5, 7);
  assert.equal(m.cols, 5);
  assert.equal(m.rows, 7);
  assert.deepEqual(lines(m), [
    'XX.XX',
    'XXXXX',
    'XXXXX',
    'XXXXX',
    '.XXX.',
    '.XXX.',
    '..X..',
  ]);
});

test('heart mask at 10x14 trims the empty bottom row and matches the golden grid', () => {
  const m = maskFor('heart', 10, 14);
  assert.equal(m.cols, 10);
  assert.equal(m.rows, 13); // pointy tip narrower than half a cell -> trimmed
  assert.deepEqual(lines(m), [
    '.XXX..XXX.',
    '.XXXXXXXX.',
    'XXXXXXXXXX',
    'XXXXXXXXXX',
    'XXXXXXXXXX',
    'XXXXXXXXXX',
    'XXXXXXXXXX',
    '.XXXXXXXX.',
    '.XXXXXXXX.',
    '.XXXXXXXX.',
    '..XXXXXX..',
    '...XXXX...',
    '....XX....',
  ]);
});

test('every shape at 10x14: sensible size, no empty interior rows or columns', () => {
  for (const key of SHAPE_ORDER) {
    const m = maskFor(key, 10, 14);
    assert.ok(m.cols >= 8 && m.cols <= 10, `${key} cols ${m.cols}`);
    assert.ok(m.rows >= 12 && m.rows <= 14, `${key} rows ${m.rows}`);
    let open = 0;
    for (const v of m.mask) open += v;
    assert.ok(open >= 60, `${key} too few open cells: ${open}`);
    for (let r = 0; r < m.rows; r++) {
      let any = false;
      for (let c = 0; c < m.cols; c++) any = any || m.mask[r * m.cols + c] === 1;
      assert.ok(any, `${key} row ${r} empty`);
    }
    for (let c = 0; c < m.cols; c++) {
      let any = false;
      for (let r = 0; r < m.rows; r++) any = any || m.mask[r * m.cols + c] === 1;
      assert.ok(any, `${key} col ${c} empty`);
    }
  }
});

test('donut at 10x14 keeps a closed 4x6 hole', () => {
  const m = maskFor('donut', 10, 14);
  assert.equal(m.cols, 10);
  assert.equal(m.rows, 14);
  for (let r = 0; r < 14; r++) {
    for (let c = 0; c < 10; c++) {
      const inHole = c >= 3 && c <= 6 && r >= 4 && r <= 9;
      assert.equal(m.mask[r * 10 + c], inHole ? 0 : 1, `cell (${c},${r})`);
    }
  }
});

test('SHAPE_ORDER covers exactly the six shapes', () => {
  assert.deepEqual([...SHAPE_ORDER].sort(),
    ['diamond', 'donut', 'heart', 'hourglass', 'plus', 'triangle']);
  for (const key of SHAPE_ORDER) assert.ok(SHAPES[key]);
});

// Build step: generate + validate levels 1..bakeCount and write levels.json.gz
// at the game root. Run with: node scripts/bake-levels.js
// Re-run whenever generation logic (generator.js / shapes.js / balance.js) changes.
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { balance } from '../src/balance.js';
import { generateLevel, simulateWaves, EMPTY, DIRS } from '../src/generator.js';

const N = balance.bakeCount;
const out = [];
for (let lvl = 1; lvl <= N; lvl++) {
  const g = generateLevel(lvl, balance);
  // validate every shipped level — a bad board must never reach a player
  for (const p of g.pieces) {
    for (const ci of p.cells) {
      if (ci < 0 || ci >= g.cols * g.rows) throw new Error(`level ${lvl}: cell index ${ci} out of range`);
    }
  }
  if (g.grid.includes(EMPTY)) throw new Error(`level ${lvl}: holes (uncovered cells)`);
  if (!simulateWaves(g.pieces, g.grid, g.cols, g.rows).cleared) throw new Error(`level ${lvl}: unsolvable`);
  for (const p of g.pieces) {
    const h = p.cells[0];
    let x = (h % g.cols) + DIRS[p.dir][0], y = ((h / g.cols) | 0) + DIRS[p.dir][1];
    while (x >= 0 && x < g.cols && y >= 0 && y < g.rows) {
      if (p.cells.includes(y * g.cols + x)) throw new Error(`level ${lvl}: self-crossing arrow`);
      x += DIRS[p.dir][0]; y += DIRS[p.dir][1];
    }
  }
  out.push({ c: g.cols, r: g.rows, s: g.shape || null, p: g.pieces.map((pc) => [pc.dir, ...pc.cells]) });
  if (lvl % 500 === 0) console.log(`baked ${lvl}/${N}`);
}
const gz = gzipSync(JSON.stringify(out));
writeFileSync(new URL('../levels.json.gz', import.meta.url), gz);
console.log(`wrote levels.json.gz: ${out.length} levels, ${(gz.length / 1024).toFixed(0)} KB`);

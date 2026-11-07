#!/usr/bin/env node
// Render Arrow Escape's playharmony.ai listing art with the game's own code.
//   node scripts/gen-harmony-art.js mockups <dir>   4 thumbnail directions → <dir>/mock-*.png
//   node scripts/gen-harmony-art.js screenshots     harmony/screenshots/*.png only
//   node scripts/gen-harmony-art.js <variant>       harmony/thumb.png, thumb-square.png, banner.png,
//                                                   banner-portrait.png, logo.png, screenshots/*.png
// Variants: tangle | breakout | poster | ink. Dev-only (scripts/* is zipignored).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const puppeteer = require('/usr/local/lib/node_modules/puppeteer');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.gz': 'application/octet-stream' };

const [mode = 'breakout', dirArg] = process.argv.slice(2);

const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const errors = [];
try {
  const p = await browser.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text()); });
  await p.goto(`http://127.0.0.1:${server.address().port}/scripts/harmony-art.html`, { waitUntil: 'load' });
  await p.waitForFunction(() => window.__artReady, { timeout: 60000 });
  const shots = [path.join(ROOT, 'harmony'), () => window.__art.screenshots()];
  const jobs = mode === 'mockups' ? [[path.resolve(dirArg || 'mockups/harmony'), () => window.__art.mockups()]]
    : mode === 'screenshots' ? [shots]
    : [[path.join(ROOT, 'harmony'), (v) => window.__art.final(v)], shots];
  for (const [dir, fn] of jobs) {
    const out = await p.evaluate(fn, mode);
    for (const [name, dataUrl] of Object.entries(out)) {
      const file = path.join(dir, `${name}.png`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
      console.log('  ✓', path.relative(process.cwd(), file));
    }
  }
} finally {
  await browser.close();
  server.close();
}
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }

# Arrow Escape — Design Spec (GDD)

Date: 2026-06-10 · rev 6 (2026-06-12): difficulty waves — oscillating curve from level 4, snakes to 16 cells, boards to 12×16, hardest-of-pool selection (reference-game difficulty). rev 5: monetization. rev 4: shapes + bigger boards
Status: approved design
Platform: nitzan.games (1080×1920 portrait canvas, sandboxed iframe, PlaySDK)
Slug: `arrow-escape` · Title: **Arrow Escape**

## Design pillars

1. **Calm, no-pressure logic** — no timers; the player's only enemy is their own haste.
2. **Always fair** — every board is provably solvable, and no sequence of moves can make it unsolvable.
3. **One-tap clarity** — the player always understands why an arrow escaped or bounced.
4. **Endless, smooth ramp** — infinite generated levels, no random difficulty spikes.

## 1. Core gameplay

### Rules

- A grid board, **completely filled**: every playable cell belongs to exactly one snake. A **piece is a snake**: an ordered path of 1–7 connected cells with bends, ending in an arrowhead that points away from the body, colinear with the path's end segment (like the reference game). Length-1 pieces (dots) are allowed as packing filler.
- **Shaped boards:** most levels are rectangles, but from level 10 every 3rd level (10, 13, 16, …) uses a shaped mask, cycling deterministically through six shapes: heart → diamond → plus → donut → hourglass → triangle. Cells outside the shape are `WALL`: they block rays exactly like pieces, hold no pieces, take no taps, and draw nothing — the board silhouette *is* the shape. Shaped boards have fewer playable cells than their rectangle peers, which makes them a slightly lighter change of pace.
- **Shape masks are geometric:** each shape is an implicit inside/outside formula sampled at cell centers over the formula's bounding box (in `shapes.js`), so the same six formulas produce clean shapes at every board size in the ramp — no hand-authored grids.
- **Tap any cell of a piece:** if the straight ray of cells from the **head** to the board edge (in the arrowhead's direction) is free of *other* pieces, the whole snake slides out — the head travels straight along the ray and the body follows the head's track (train-style), straightening as it exits.
- If another piece sits on that ray, the tapped piece **bumps**: it nudges toward the blocker and bounces back, and the player loses **1 heart** (screen shake + bump sound + heart flash on the lost heart). Hearts are a persistent pool (see §2) — losing one on level 5 means starting level 6 with one fewer.
- Clear all pieces → **level clear**. Hearts at 0 → the **out-of-hearts gate** (§2).
- Pieces already sliding off the board no longer block rays (their grid cells are freed the moment the slide starts).
- Mistakes never deadlock a board: removing pieces only opens rays, so any reachable state of a solvable board is still solvable, and at least one free piece always exists.

### Difficulty waves (reference-game difficulty)

Difficulty follows the reference games: hardness comes from **long winding snakes** (10–16 cells, spirals, deep dependency chains) and **heavily blocked boards** (few initially-free pieces), not from piece count. From level 4, difficulty oscillates in **waves**: within each wave the board grows, snakes lengthen, and candidate selection climbs to the hardest of the pool; the next wave drops back down ("easy again, then hard again"). Wave peaks rise with progression. All knobs in `balance.js`:

- **Levels 1–3 (tutorial):** 5×7, target lengths 2–5, easiest candidate. Gentle.
- **From level 4:** wave position `t = ((level − 4) % wavePeriod) / (wavePeriod − 1)` with `wavePeriod: 8`. Board dims and max length interpolate (rounded) from the tier's floor to its peak as `t` goes 0 → 1; the selection percentile climbs `0.3 → 1.0` (the wave's last level ships the hardest of the candidate pool).
- **Progression tiers** raise the ceilings:

| Tier | Levels | Floor (dims / maxLen) | Peak (dims / maxLen) | Long bias |
|------|--------|-----------------------|----------------------|-----------|
| 1    | 4–27   | 7×10 / 6              | 10×14 / 12           | 0.5       |
| 2    | 28–59  | 8×11 / 7              | 11×15 / 14           | 0.5       |
| 3    | 60+    | 8×12 / 8              | 12×16 / 16           | 0.6       |

- **minLen target is 2** everywhere past the tutorial: singles exist only as packing fallback (the merge pass keeps them rare).
- **Blocking pressure:** `candidates: 10` and `scoreWeights: { wave: 1.5, blocked: 8.0, count: 0.02 }` — selection optimizes for sequential depth and initially-blocked pieces. Measured at the tier-3 peak: hardest-of-10 boards average ~12 dependency waves and ~19% initially-free pieces (pool mean 8 / 23%).
- The wave system **replaces** the old bracket ramp and the every-5th-level breather (`isBreather`/`breatherEvery`/`bracketRange`/`percentileMin`/`percentileMax`/`openBracketSpan` are retired); each wave's first levels are the breathers.
- At 12×16 the cell size is ~72 canvas px — denser than anything shipped before; verified visually during implementation.

**Long bias** skews target-length sampling toward the top of the range (0 = uniform, 1 = always maxLen). Actual lengths can fall below target when packing constraints cut a walk short; length 1 remains the always-legal fallback that makes perfect packing reliable. Feasibility measured: rectangles and all shapes pack with 0% candidate failure at the tier-3 peak — except the diamond, whose stair-corner geometry breaks down beyond 10×14 (~97% failure at 12×16), so **shapes carry an optional per-shape dimension cap** applied as `min(wave dims, shape cap)`; only the diamond uses it (10×14).

### Level generation (in `generator.js`)

- **Seeded RNG:** mulberry32. Seed derived deterministically from level number → same level N is the same board for every player, forever. Failing and retrying a level replays the identical board.
- **Reverse construction guarantees solvability:** place snakes one at a time into an initially empty board; a piece may only be placed where its head's exit ray is clear of all *already-placed* pieces (and walls) at placement time. Rays over still-empty cells are fine: those cells get later-placed pieces, which are removed *earlier* in forward play. The reverse of placement order is then a valid solution.
- **Full-fill packing (tile, then peel):** generation has two phases. *Tiling* partitions the open cells into snake paths with no ray constraints — seeded at statically-dead cells first (cells with no wall-free corridor to any edge, which can never be heads), then scan order; each path shrinks until at least one end continues into a wall-free corridor. *Peeling* assigns arrowheads: repeatedly pick (seeded-randomly) a piece one of whose end-continuation rays is clear of the remaining pieces, orient its head to that end, and remove it. The peel order is a forward solution, so every shipped board is solvable by construction. A stalled peel re-tiles (bounded retries, same rng stream — deterministic); a candidate that exhausts its attempts is skipped. The previous greedy ray-aware walk could not pack shapes with single-escape pockets (a heart's lower flanks wedged >99% of attempts).
- **Shape scheduling (in `shapes.js`):** `shapeFor(level)` returns a shape key or null — a level is shaped iff `level ≥ 10 && (level − 10) % 3 === 0`; shaped levels use `SHAPE_ORDER[((level − 10) / 3) % 6]` with `SHAPE_ORDER = [heart, diamond, plus, donut, hourglass, triangle]`. `maskFor(shapeKey, cols, rows)` samples the shape's implicit formula at cell centers over its bounding box → `Uint8Array` (1 = open). `generateLevel` passes the mask to every candidate build for that level, requesting the wave's dims clamped by the shape's optional per-shape cap (`min(wave dims, shape cap)`; only the diamond is capped, at 10×14).
- **Candidate scoring drives the wave:** for level N, generate `balance.candidates` (10) boards from seeds `hash(N, 0..9)`, score each, and pick by *percentile within the candidate pool* at the wave position (0.3 at a wave's start → 1.0 at its peak; tutorial levels take the easiest). Distribution-relative selection auto-calibrates to whatever scores each board size can produce.

**Difficulty score** of a board (weights in `balance.js`):

- `freeRatio` — fraction of pieces immediately removable (lower = harder).
- `waveDepth` — repeatedly remove all currently-free pieces in waves until empty; the number of waves (higher = harder; measures sequential dependency).
- `pieceCount` — raw volume.

Selection percentile rises smoothly within each bracket and drops to the floor on every 5th level (sawtooth).

## 2. Progression & economy

- **Endless sequential levels** 1, 2, 3, … No level select in v1; the menu shows "Level N" and Play resumes there.
- **Gold** (game-minted soft currency per platform convention; NBucks never minted in-game):
  - +10 gold per level clear, +5 bonus for a flawless clear (no hearts lost during the level).
  - New players start with 60 gold.
- **Hint — 25 gold:** highlights a currently-free arrow, preferring the one whose removal unblocks the most other arrows. (Always available because a free arrow always exists.)

### Hearts (persistent lives, the monetization driver)

- Hearts are a **persistent pool**, not per-level state: cap **5**, new players start full, every bump costs 1 wherever it happens, and `startLevel` does NOT refill. Old saves (no hearts field) migrate to a full 5.
- **Regen: +1 heart per hour**, up to the cap, tracked client-side: the save stores `heartT` (epoch ms when the next heart arrives; null at cap). Regen applies at boot and during play via a once-per-second check — a heart can arrive mid-level. Device-clock cheating is accepted for v1 (genre standard; no server state available).
- **Out-of-hearts gate** — reaching 0 hearts mid-level shows the OUT OF HEARTS overlay; 0 hearts on the menu disables PLAY and shows the regen countdown. Both offer:
  - **Watch ad → +1 heart** via `PlaySDK.showRewardedAd()` (mid-level: continue the same board in place). At most one ad grant per gating (the button disappears after use until the player is gated again). Button hidden when `PlaySDK.adsAvailable` is false and no dev fallback applies; per platform docs, web grants the reward without showing an ad.
  - **Full refill · 50 gold** → hearts to 5 (mid-level: continue in place).
  - **Get gold** → opens the shop. Or just wait: the countdown to the next heart is shown.
- Retry replays the identical board (deterministic seeds) but requires ≥1 heart.

### Gold shop (NBucks → gold; 100 NBucks = $1)

Reachable from the menu and from the out-of-hearts overlay. Three packs (constants in `balance.js`):

| Pack | Gold | NBucks | Real value |
|------|------|--------|------------|
| Small  | 150  | 15  | $0.15 |
| Medium | 500  | 40  | $0.40 |
| Large  | 1500 | 100 | $1.00 |

Each purchase calls `PlaySDK.nbucks.spend({ amount, itemDescription, itemId })` inside try/catch. **Platform pitfalls (documented, real):** the method is exactly `PlaySDK.nbucks.spend` (a misnamed call fails silently — Bubble Bloom shipped a dead shop this way), and the promise **rejects** on cancel/insufficient funds rather than resolving with a failure flag — any rejection means nothing was charged; show a neutral "purchase cancelled" state, never an error.

**Purchase feedback:** a successful pack purchase pops a centered celebration card over the shop — dark card, "● +N" / "GOLD!" in glyph color, scales in with a small overshoot bounce, auto-dismisses after `balance.popupDur` (1.5 s) or on any tap, with the clear fanfare. Cancelled purchases keep the quiet inline "purchase cancelled" text (neutral per platform convention).

**Dev fallback (no PlaySDK):** purchases succeed for free and rewarded ads auto-grant, so all flows are testable locally and in Playwright.

- **Deferred to later versions:** daily challenges, streaks, level select, additional themes.

### Save data (via `PlaySDK.save/load`, never raw localStorage)

```json
{ "level": 12, "gold": 145, "sound": true, "hearts": 3, "heartT": 1781300000000 }
```

Loaded with top-level `await` at boot before the menu is constructed. Missing fields default to: hearts 5, heartT null (saves from before rev 5 migrate cleanly).

## 3. Screens & UI

**Theme: Paper Minimal** — warm off-white background `#f4f1ea`, board cells `#ece8df`, near-black snake pieces `#2b2b2e` drawn as thick rounded polylines (≈0.72× cell width, round caps/joins give the curved look) with an off-white arrowhead glyph on the head, single red accent `#e2574c` (hearts, fail text, hint highlight outlining the whole hinted piece). Palette validated in `mockups/theme-explorer.html` (theme A).

**Board rendering is per-cell:** every playable (non-`WALL`) cell draws its own small rounded background tile; wall cells draw nothing, so the board silhouette is the shape itself (rectangles keep looking like the old panel, just with per-cell texture instead of grid lines). Hit-testing returns nothing for wall cells, and `tapCell` treats any negative grid value (`EMPTY` or `WALL`) as inert.

1. **Menu** — title, "Level N", Play (primary CTA; disabled with countdown when hearts = 0, with ad/refill offers), hearts row with regen countdown when below cap, Shop button, sound toggle, gold balance, version caption (bottom center, Caption size).
2. **Game** — HUD top: level number, hearts (5 heart icons, smaller than the old 3), gold balance; board centered; bottom bar: Hint button (shows 25g cost), Restart button. Version caption in a corner.
3. **Level clear overlay** — "LEVEL CLEAR" (Display), gold earned breakdown, Next button.
4. **Out-of-hearts overlay** — "OUT OF HEARTS" (Display), regen countdown, then: "Watch ad · +1 ♥" (hidden after one use per gating or when ads unavailable), "Refill · 50 gold", "Get gold" (opens shop), "Menu". Identical sizes for same-purpose buttons.
5. **Shop screen** — three gold packs with gold amount, NBucks price; purchase calls the SDK and shows a brief success/cancelled state; Back button.

UI rules: canvas-drawn UI using the type-ladder steps (canvas-px equivalents per JSGames convention: Display 144 / Title 126 / Heading 90 / Subheading 66 / Body Large 48 / Body 36 / Caption 21); same-purpose buttons identical in size; menu/overlay rendering throttled when nothing animates.

**Screenshot mode:** when `PlaySDK.screenshotMode` (`?screenshot=1`), skip the menu, load a visually busy mid-game board (~level 40), and auto-play 2–3 escapes on a timer for an appealing capture.

**Feedback & juice (small, calm):** accelerating slide-out where the snake visibly straightens along its track, with a soft whoosh; bump animation ≤250 ms with light screen shake; hint pulse outlining the highlighted piece; subtle confetti-free "LEVEL CLEAR" fade — no aggressive effects, the game stays quiet.

## 4. Tech architecture

Vanilla JS ES modules, single page, one 2D canvas at 1080×1920 (no DPR scaling of the backing store; flexbox centering; `touch-action: none` on the canvas; `pointerdown` on canvas for input with cached bounding rect).

```
ArrowEscape/
  index.html
  meta.json            # platform metadata
  thumbnail.png        # 512×512, title text rendered in
  .zipignore           # excludes mockups/ docs/ tests/ CLAUDE.md etc.
  src/
    balance.js         # ALL tuning constants + VERSION (bumped every commit)
    shapes.js          # shape formulas, mask sampler, per-level shape schedule (pure)
    generator.js       # rng, reverse-construction builder, scorer, candidate picker (pure)
    gameData.js        # allocGameData(balance) — single mutable state object
    logic.js           # pure: tap resolution, path checks, animation state, hearts, win/fail
    render.js          # read-only draw; snakes stroked as rounded polylines per dirty frame
    audio.js           # procedural Web Audio SFX; init on first gesture; suspend on pause
    main.js            # boot (await PlaySDK load), rAF loop, pause/resume, screenshot mode
  tests/
    generator.test.js  # node --test, zero dependencies
  mockups/
    theme-explorer.html
```

- **Loop:** `requestAnimationFrame` only; `PlaySDK.onPause/onResume` stop/start the loop and suspend/resume the AudioContext; idle screens render only when dirty.
- **No per-frame allocations** in tick/render paths (≤88 cells, plain pre-allocated arrays are sufficient; pools/TypedArrays not required at this scale).
- **Audio:** 4 procedural SFX — tap-tick, escape-whoosh (pitch rises with combo of consecutive escapes), bump-thud, clear-fanfare.

### Error handling

- Save load failure / empty → defaults (level 1, 60 gold, sound on, 5 hearts, no regen timer).
- Generator guard: full coverage is a hard invariant — a board that can't be packed restarts (bounded, deterministic); a candidate seed that exhausts its restarts is excluded from the candidate pool rather than shipped underfilled.
- Hint with insufficient gold → button disabled state (greyed, shows cost).
- `PlaySDK.nbucks.spend` rejection (cancel / insufficient funds) → neutral "purchase cancelled" state; nothing granted, nothing saved.
- `PlaySDK.showRewardedAd()` resolving `{rewarded: false}` (ad abandoned) → no heart granted; the ad button remains usable for this gating.
- `heartT` in the past at boot (game closed for hours) → grant all elapsed hearts up to the cap in one step.

### Testing

`tests/generator.test.js` (run with `node --test`):

1. **Solvability** — for many levels across the ramp, simulate wave-removal until empty; assert every generated board fully clears.
2. **Full coverage** — every open cell of every generated board belongs to exactly one snake; all lengths within the bracket's range; wall cells never hold pieces.
3. **Determinism** — same level number twice → identical board layout (including shaped levels).
3b. **Shape correctness** — shaped levels carry the scheduled shape's mask; the mask sampler produces the expected silhouettes at ramp sizes (golden-grid assertions for at least heart at 10×14 and 5×7); shaped boards are solvable; `tapCell` on a wall cell is inert.
4. **Wave sanity** — within a wave, score rises from start to peak (statistically over many waves); a wave's first level scores below the previous wave's peak; tier peaks rise across tiers (tier-3 peaks > tier-1 peaks on average); tutorial levels 1–3 are easier than everything in tier 1.
5. **Hint validity** — hint always returns a currently-free arrow on any reachable state.
6. **Heart economy** (`tests/logic.test.js`) — bumps drain the persistent pool across levels; regen grants exactly elapsed-hours hearts up to cap (timestamps injected, never `Date.now()` in pure logic); gate fires at 0; ad grant +1 once per gating; gold refill to 5 charges 50; shop packs add gold; save round-trips hearts/heartT; pre-rev-5 saves migrate to 5 hearts.

Gameplay/UI verified manually in the browser via local dev server (port 8092) + on-device.

## Out of scope for v1

Additional shapes beyond the six (letters, seasonal shapes), daily challenges, streaks (freezers/fixers), level select, alternate themes, leaderboards, undo, server-authoritative heart regen (client timestamps accepted).

# Arrow Escape — Design Spec (GDD)

Date: 2026-06-10
Status: approved design, pre-implementation
Platform: nitzan.games (1080×1920 portrait canvas, sandboxed iframe, PlaySDK)
Slug: `arrow-escape` · Title: **Arrow Escape**

## Design pillars

1. **Calm, no-pressure logic** — no timers; the player's only enemy is their own haste.
2. **Always fair** — every board is provably solvable, and no sequence of moves can make it unsolvable.
3. **One-tap clarity** — the player always understands why an arrow escaped or bounced.
4. **Endless, smooth ramp** — infinite generated levels, no random difficulty spikes.

## 1. Core gameplay

### Rules

- A rectangular grid board; every arrow occupies one cell and points up, down, left, or right.
- **Tap an arrow:** if the straight line of cells from it to the board edge (in its pointing direction) is empty, it slides off the board with an accelerating animation and is removed.
- If any arrow sits in that path, the tapped arrow **bumps**: it animates toward the blocker and bounces back to its cell, and the player loses **1 of 3 hearts** (screen shake + bump sound + heart flash).
- Clear all arrows → **level clear**. Lose all 3 hearts → **level failed**.
- Arrows already animating off the board no longer block paths.
- Mistakes never deadlock a board: removing arrows only opens paths, so any reachable state of a solvable board is still solvable, and at least one free arrow always exists.

### Difficulty ramp

Board size and arrow count scale with level number `N` (all values live in `balance.js`):

| Levels   | Grid  | Arrows |
|----------|-------|--------|
| 1–10     | 4×5   | 6–10   |
| 11–30    | 5×7   | 12–18  |
| 31–60    | 6×8   | 20–28  |
| 61–120   | 7×9   | 30–42  |
| 121–300  | 7×10  | 40–55  |
| 301+     | 8×11  | 55–70  |

A **sawtooth** keeps pacing relaxing: the difficulty target dips on every 5th level (a "breather" board), mirroring the reference game's hard/easy alternation.

### Level generation (in `generator.js`)

- **Seeded RNG:** mulberry32. Seed derived deterministically from level number → same level N is the same board for every player, forever. Failing and retrying a level replays the identical board.
- **Reverse construction guarantees solvability:** start from an empty board; place arrows one at a time, each only in a cell/direction whose exit path is clear *at placement time*. The reverse of placement order is then a valid solution.
- **Candidate scoring smooths the curve:** for level N, generate 8 candidate boards (seeds `hash(N, 0..7)`), score each, and pick by *percentile within the candidate pool*: breather levels take the easiest candidate; normal levels ramp from the 30th to the 90th percentile across their bracket. Distribution-relative selection auto-calibrates to whatever scores each board size can produce (an absolute target curve was tried first and degenerated to easiest-of-8 for mid-game brackets).

**Difficulty score** of a board (weights in `balance.js`):

- `freeRatio` — fraction of arrows immediately removable (lower = harder).
- `waveDepth` — repeatedly remove all currently-free arrows in waves until empty; the number of waves (higher = harder; measures sequential dependency).
- `arrowCount` — raw volume.

Selection percentile rises smoothly within each bracket and drops to the floor on every 5th level (sawtooth).

## 2. Progression & economy

- **Endless sequential levels** 1, 2, 3, … No level select in v1; the menu shows "Level N" and Play resumes there.
- **Gold** (game-minted soft currency per platform convention; NBucks never minted in-game):
  - +10 gold per level clear, +5 bonus for a flawless clear (no hearts lost).
  - New players start with 60 gold.
- **Hint — 25 gold:** highlights a currently-free arrow, preferring the one whose removal unblocks the most other arrows. (Always available because a free arrow always exists.)
- **Heart refill — 50 gold:** offered on the fail overlay; refills to 3 hearts and continues the same board in place.
- **Deferred to later versions:** NBucks→gold packs in the platform shop, daily challenges, streaks, level select, additional themes.

### Save data (via `PlaySDK.save/load`, never raw localStorage)

```json
{ "level": 12, "gold": 145, "sound": true }
```

Loaded with top-level `await` at boot before the menu is constructed.

## 3. Screens & UI

**Theme: Paper Minimal** — warm off-white background `#f4f1ea`, board panel `#ece8df`, grid lines `#dcd7cb`, near-black arrow tiles `#2b2b2e` with off-white glyphs, single red accent `#e2574c` (hearts, fail text, hint highlight). Validated in `mockups/theme-explorer.html` (theme A).

1. **Menu** — title, "Level N", Play (primary CTA), sound toggle, gold balance, version caption (bottom center, Caption size).
2. **Game** — HUD top: level number, hearts (3 heart icons), gold balance; board centered; bottom bar: Hint button (shows 25g cost), Restart button. Version caption in a corner.
3. **Level clear overlay** — "LEVEL CLEAR" (Display), gold earned breakdown, Next button.
4. **Fail overlay** — "OUT OF HEARTS" (Display), Retry (free) and "Continue · 50 gold" buttons, identical sizes.

UI rules: canvas-drawn UI using the type-ladder steps (canvas-px equivalents per JSGames convention: Display 144 / Title 126 / Heading 90 / Subheading 66 / Body Large 48 / Body 36 / Caption 21); same-purpose buttons identical in size; menu/overlay rendering throttled when nothing animates.

**Screenshot mode:** when `PlaySDK.screenshotMode` (`?screenshot=1`), skip the menu, load a visually busy mid-game board (~level 40), and auto-play 2–3 escapes on a timer for an appealing capture.

**Feedback & juice (small, calm):** slide-off easing with a soft whoosh; bump animation ≤250 ms with light screen shake; hint pulse on the highlighted tile; subtle confetti-free "LEVEL CLEAR" fade — no aggressive effects, the game stays quiet.

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
    generator.js       # rng, reverse-construction builder, scorer, candidate picker (pure)
    gameData.js        # allocGameData(balance) — single mutable state object
    logic.js           # pure: tap resolution, path checks, animation state, hearts, win/fail
    render.js          # read-only draw; arrow tiles pre-rendered to offscreen canvases
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

- Save load failure / empty → defaults (level 1, 60 gold, sound on).
- Generator guard: if reverse construction can't place the full target arrow count (rare on dense boards), it ships the board with however many arrows fit — still solvable by construction; the candidate scorer naturally deprioritizes underfilled boards.
- Hint with insufficient gold → button disabled state (greyed, shows cost).

### Testing

`tests/generator.test.js` (run with `node --test`):

1. **Solvability** — for many levels across the ramp, simulate wave-removal until empty; assert every generated board fully clears.
2. **Determinism** — same level number twice → identical board layout.
3. **Ramp sanity** — average difficulty score over levels 1–300 is monotonically increasing per bracket; every 5th level scores below its neighbors.
4. **Hint validity** — hint always returns a currently-free arrow on any reachable state.

Gameplay/UI verified manually in the browser via local dev server (port 8092) + on-device.

## Out of scope for v1

Daily challenges, streaks (freezers/fixers), shop/NBucks integration, level select, alternate themes, leaderboards, undo.

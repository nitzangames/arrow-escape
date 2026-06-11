# Arrow Escape — Design Spec (GDD)

Date: 2026-06-10 · rev 2 (2026-06-10): pieces are multi-cell snakes, matching the reference game
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

- A rectangular grid board; every **piece is a snake**: an ordered path of 1–5 connected cells with bends, ending in an arrowhead that points away from the body (like the reference game).
- **Tap any cell of a piece:** if the straight ray of cells from the **head** to the board edge (in the arrowhead's direction) is free of *other* pieces, the whole snake slides out — the head travels straight along the ray and the body follows the head's track (train-style), straightening as it exits.
- If another piece sits on that ray, the tapped piece **bumps**: it nudges toward the blocker and bounces back, and the player loses **1 of 3 hearts** (screen shake + bump sound + heart flash on the lost heart).
- Clear all pieces → **level clear**. Lose all 3 hearts → **level failed**.
- Pieces already sliding off the board no longer block rays (their grid cells are freed the moment the slide starts).
- Mistakes never deadlock a board: removing pieces only opens rays, so any reachable state of a solvable board is still solvable, and at least one free piece always exists.

### Difficulty ramp

Board size, piece count, and snake length scale with level number `N` (all values live in `balance.js`):

| Levels   | Grid  | Pieces | Lengths |
|----------|-------|--------|---------|
| 1–10     | 4×5   | 4–6    | 1–3     |
| 11–30    | 5×7   | 6–9    | 1–4     |
| 31–60    | 6×8   | 8–12   | 2–4     |
| 61–120   | 7×9   | 10–15  | 2–5     |
| 121–300  | 7×10  | 12–17  | 2–5     |
| 301+     | 8×11  | 15–21  | 2–5     |

A **sawtooth** keeps pacing relaxing: every 5th level is a "breather" board (the easiest of its candidate pool), mirroring the reference game's hard/easy alternation.

### Level generation (in `generator.js`)

- **Seeded RNG:** mulberry32. Seed derived deterministically from level number → same level N is the same board for every player, forever. Failing and retrying a level replays the identical board.
- **Reverse construction guarantees solvability:** start from an empty board; place snakes one at a time — pick a head cell + direction whose exit ray is clear of all already-placed pieces *at placement time*, then random-walk the body backward from the head (first body cell directly behind the head, later cells may bend; the body never sits on its own exit ray). The reverse of placement order is then a valid solution.
- **Candidate scoring smooths the curve:** for level N, generate 8 candidate boards (seeds `hash(N, 0..7)`), score each, and pick by *percentile within the candidate pool*: breather levels take the easiest candidate; normal levels ramp from the 30th to the 90th percentile across their bracket. Distribution-relative selection auto-calibrates to whatever scores each board size can produce (an absolute target curve was tried first and degenerated to easiest-of-8 for mid-game brackets).

**Difficulty score** of a board (weights in `balance.js`):

- `freeRatio` — fraction of pieces immediately removable (lower = harder).
- `waveDepth` — repeatedly remove all currently-free pieces in waves until empty; the number of waves (higher = harder; measures sequential dependency).
- `pieceCount` — raw volume.

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

**Theme: Paper Minimal** — warm off-white background `#f4f1ea`, board panel `#ece8df`, grid lines `#dcd7cb`, near-black snake pieces `#2b2b2e` drawn as thick rounded polylines (≈0.72× cell width, round caps/joins give the curved look) with an off-white arrowhead glyph on the head, single red accent `#e2574c` (hearts, fail text, hint highlight outlining the whole hinted piece). Palette validated in `mockups/theme-explorer.html` (theme A).

1. **Menu** — title, "Level N", Play (primary CTA), sound toggle, gold balance, version caption (bottom center, Caption size).
2. **Game** — HUD top: level number, hearts (3 heart icons), gold balance; board centered; bottom bar: Hint button (shows 25g cost), Restart button. Version caption in a corner.
3. **Level clear overlay** — "LEVEL CLEAR" (Display), gold earned breakdown, Next button.
4. **Fail overlay** — "OUT OF HEARTS" (Display), Retry (free) and "Continue · 50 gold" buttons, identical sizes.

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

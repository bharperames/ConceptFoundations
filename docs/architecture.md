# Architecture

Concept Foundations is a toddler learning web app: a curriculum of cognitive
primitives (same/different, big/small, more/less, in/out, part/whole, object
permanence, causality) plus three sandbox mini-games, with per-device progress,
touch telemetry, and a parent dashboard.

**No build step.** The app is plain static files served as-is (GitHub Pages,
`make serve`, or any static host). The browser resolves native ES module
`import`s at load time — there is no bundler, transpiler, or framework. To run a
change, reload the page.

## File layout

```
index.html            Shell: the <main> views + <link css> + <script type=module src=js/main.js>
css/app.css           All styles (token/theme sections; @media dark + [data-theme] overrides)
js/
  main.js             init(): DOM wiring, event listeners, assembles window.CF, boots
  core.js             $, uuid, clamp, hashStr, mulberry32, pick/pick2, shuffle, median
  store.js            Store (localStorage), nodeProgress, saveNodeProgress
  telemetry.js        Telemetry (event-sourced session recorder)
  audio.js            Audio2 (speech + curated-clip playback + tones) & Captions; CLIP_MAP
  art.js              Color palette + every flat-SVG factory (shapes, spider, spout, blocks,
                      bubble, clock, box, button, cards…) + NICON node icons
  dress.js            Getting dressed: the child, each garment and each empty
                      spot in one shared drawing space, so a garment lands on
                      the body it was authored against
  letters.js          The magnet alphabet: glossy moulded A–Z / 0–9 + empty board
                      spots, the four plastic colors, the confusable-pair table
                      (sight AND sound), and the early-phoneme / name pools
  fx.js               FX (confetti/spark/cheer) + Celebrate (canvas fireworks) + TROPHY/RIBBON
  trials.js           elShape, tapTrial, watchTrial, dragTrial, zoneEl, CLUSTER, rowXs
  generators.js       The 11 level generators (outlier, size, hideSeek, introTap, spout,
                      quantity, letterTap, letterFind, letterTapPlace, letterBoard, dress)
  nodes.js            NODES — the curriculum tree (8 nodes × ~30 levels), each level.make() → trial set
  voices.js           Debug only: the voice bench (?voices=1) and the in-context
                      audio HUD (?debug=1) — every spoken line, playable, with
                      the clip and gold asset behind each beat
  dda.js              applyRunOutcome (dynamic difficulty), frustration detector
  engine.js           Engine — the trial state machine (see below)
  games/bubble.js     BubbleGame (Bubble Pop mini-game, canvas)
  games/memory.js     MemoryGame (4×6 concentration; face-up preview, spoken
                      turns, and help that escalates with misses)
  games/puzzle.js     PuzzleGame (rotating-prism Picture Puzzle)
  games/stacker.js    StackerGame (Block Stacker; Matter.js physics, AABB fallback)
  dashboard.js        PROFILES, Simulator (headless play), computeStats/Insights, charts, renderDash
  ui.js               renderHome (concept cards), renderAllLevels/setLevelsMode (dense grid),
                      level picker, miniPreview, node reachability, NODE_ACCENT colors
  theme.js            prefersDark, effectiveDark, applyTheme
  router.js           showView (single-page view switching)
scripts/
  sync_clips.py       Acquire audio from the producer's gold catalog (assets.db) by asset_id
  register_demand.py  Push usage + wants into the shared assets.db (see docs/audio-clip-contract.md)
  stacker_sim.mjs     Headless Matter.js harness for tuning the Block Stacker physics
tests/
  app.spec.js         Playwright browser tests (drive window.CF; Chromium + WebKit)
  physics.test.mjs    node:test suite over stacker_sim.mjs (gravity/drag/grab cases)
clips/*.mp3           Shipped, loudness-normalized audio (embedded; the app never reads a DB)
assets/cards/*.webp   Photo cards for the hide-and-seek levels
```

## Dependency direction

Imports point **downward** — leaf utilities at the bottom, the app shell at the
top. The graph is acyclic except for one deliberate runtime cycle.

```
                          main.js  (init + window.CF)
              ┌──────────────┼─────────────────────────────┐
             ui  ◄────────► engine        dashboard      games/{bubble,puzzle,stacker}
              │              │                │                     │
      nodes ──┤   dda ──┐    ├── telemetry    │                     │
        │     │   fx ─┐ │    │      │         theme                 │
   generators │   │   │ │    │      │           │                   │
        │  ┌──┴───┤   │ │    │      │           │                   │
      trials  art │   │ │    │      │           │                   │
        │      │  │   └─┴────┴──────┴───────────┴───────────────────┘
        └──────┴──┴──► core        store  ◄─── (audio, telemetry, theme, dda, ui, …)
                      audio ──► core, store
```

- **`core.js`** depends on nothing. **`store.js`** is a leaf. These sit at the
  bottom; almost everything imports `$` (DOM), the RNG helpers, or `Store`.
- **`engine.js ↔ ui.js` is an intentional cycle.** The Engine calls `renderHome()`
  when a run finishes; the UI calls `Engine.startLevel()` when a card/tile is
  tapped. Both references are inside functions (runtime), never at module-eval
  time, so ES modules resolve it cleanly. Don't try to "break" it by hoisting
  either call to top level.
- **Games are self-contained**: each imports only `core`, `audio`, `router`, and
  (puzzle) `fx`. The Engine does **not** import the games; they are launched from
  `main.js`/`ui.js`. `games/stacker.js` is the one place the app uses Matter.js.
- **`nodes.js` → `generators.js`**: `NODES` is data; each level's `make(rng)` calls
  a generator lazily at play time, so there's no cycle back to `nodes`.

## The public surface: `window.CF`

`main.js` assembles one global for the test harness and console debugging:

```js
window.CF = { Engine, Store, Simulator, Telemetry, NODES, PROFILES, Celebrate,
              BubbleGame, PuzzleGame, StackerGame,
              computeStats, computeInsights, renderDash, renderHome, showView };
```

`tests/app.spec.js` drives the app exclusively through `window.CF` (e.g.
`CF.Engine.startLevel(...)`, `CF.Store.settings()`), so **the keys of this object
are a contract** — renaming or dropping one breaks the tests. Adding is safe.

## The Engine (the one big module, ~1,120 lines)

`engine.js` is a single object literal — a state machine whose ~40 methods share
mutable `this` state (`node, level, trials, trialIdx, cur, curRecord, locked,
drag, wrongCount, frustration, …`). It's the hub that ties audio, fx, store,
telemetry, curriculum, and the DOM stage together. Grouped by concern:

- **Lifecycle** — `startLevel, runTrial, renderTrial, completeTrial, finishRun,
  pickNextLevel, abort` (Expose → Contrast → Test → Generalize, then advance/DDA).
- **Input** — `onPointerDown/Move/Up, beginDrag, hitPiece, missDistance`.
- **Prompting/timers** — `speakPrompt, armTimers, onTimeout, onFrustration, hintPulse`.
- **Stack physics** — `startStackPhysics` (~215 lines), `stopPhysics, stackFloorY,
  layoutStack` (the teaching block-stacking sim, distinct from the Stacker game).
- **Scene scripts** — `spoutGeom, climbSpider, spoutCauseEffect, spoutDemo*, rain*,
  fireBurst, tapReward, buttonDemo` (the itsy-bitsy-spider + button cause→effect).
- **Peekaboo** — `hideThenPrompt, shuffleCovers, revealUnder`.

It is deliberately kept as one module: everything is glued by shared `this`, so
it reads as one cohesive machine. If it ever needs splitting, the two most
self-contained sub-systems to extract as `engine/physics.js` and `engine/scenes.js`
(passing the engine explicitly) are the stack-physics and spider-spout blocks —
both fully covered by the drag/stack/spout tests.

## Conventions

- **One concern per module; imports point downward.** New shared helpers go in
  `core.js`; new art in `art.js`; new levels as a generator in `generators.js`
  wired into `nodes.js`.
- **Curated audio** is embedded in `clips/` and mapped in `audio.js`'s `CLIP_MAP`;
  the app never touches a database at runtime. Acquisition/demand is build-time
  tooling (`scripts/`, `docs/audio-clip-contract.md`).
- **Matter.js** is an optional CDN dependency for the Block Stacker only; if it
  fails to load, `games/stacker.js` falls back to simple AABB physics. Keep that
  fallback working — it's also the deterministic test path.
- **Run `make test` before committing** (browser suite + physics unit tests). Keep
  the `window.CF` keys stable so `app.spec.js` needs no changes.
- **Theme-aware, responsive, single-page.** Views are `<main class="view">`
  toggled by `router.showView`; styles support light/dark via `prefers-color-scheme`
  plus `[data-theme]` overrides.

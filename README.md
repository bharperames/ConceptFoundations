# Concept Foundations

A web app that teaches foundational cognitive primitives to toddlers through the
**Expose → Contrast → Test → Generalize** state machine, with event-sourced touch
telemetry, a parent dashboard, dynamic difficulty adjustment (DDA), and a built-in
usage-simulation test harness.

Everything lives in a single self-contained file: **`index.html`**
(no build step, no dependencies, no network calls).

## Run it

- GitHub Pages: https://bharperames.github.io/ConceptFoundations/
- Locally: `make serve`, then open `http://127.0.0.1:8743/` — the target always
  uses port 8743 (override with `make serve PORT=...`), freeing it first if a
  stale server holds it.
- Append `?mute=1` to silence speech/tones during testing (prompt timing — and
  therefore TTFT telemetry — is preserved).
- Captions (CC): toggle in the grown-ups dashboard, or append `?cc=1`, to show
  every spoken prompt as on-screen text — handy for testing with the volume off.
- Audio debugging: `?debug=1` docks a HUD showing what the current screen is
  saying, each beat tagged with the clip behind it (linked to the asset in
  MR_AudioClips) and a running transcript; `?voices=1` opens the full bench —
  every line in the curriculum, playable, plus the per-glyph pronunciation
  table. ▶ plays through the app, ♪ plays the file itself, which separates a
  playback bug from a bad recording.
- Dark mode: follows the device setting by default; the dashboard switch
  overrides it (child surface becomes a night sky, dashboard uses dark chrome).

## Curriculum

Eight nodes, thirty-three micro-levels, each run as E→C→T(×3):

| Node | Levels | Interaction | Prerequisite |
|---|---|---|---|
| 0 · Intro (First Taps) | 0.1–0.6 | tap, then one drag | — |
| 1 · Identity (Same & Different) | 1.1–1.5 | tap | — |
| 2 · Magnitude (Big & Small) | 2.1–2.3 | tap | Identity |
| 3 · Quantity (More & Less) | 3.1–3.3 | tap (side clusters) | Identity |
| 4 · Spatial (In & Out) | 4.1–4.4 | drag & drop, physics | Magnitude |
| 5 · Composition (Build It) | 5.1–5.4 | drag / assembly / physics | Spatial |
| 6 · Peekaboo | 6.1–6.4 | tap (object permanence) | Identity |
| 7 · Letters (ABC Magnets) | 7.1–7.4 | tap + drag on a magnet board | Spatial |

Two levels use the block-physics engine. Spatial 4.2 ("On top") teaches the
spatial *relation* — one block onto one other block. Composition 5.3 ("Tower")
is the *construction* exercise: stack three blocks tall, with the landing
surface rising to the top of the tower as each block is placed. Both simulate
a real 2-inch (5.08 cm) wood cube:
gravity at true scale (px-per-meter derived from the rendered block size),
wood-on-wood restitution (0.32 — a clack, barely a bounce), and the rigid-body
support rule: a block whose center of mass lands past the support edge topples
about that edge (α = 3g·sinθ / 2√2·a) and tumbles off. Release velocity comes
from the drag gesture, so flinging the block sideways behaves like flinging a
real block. The sim advances by real elapsed time in collision-safe substeps,
so outcomes are identical at 60fps or under browser timer throttling.

Tests follow "repetitive with change": the same task three times, with the
layout, sides, and colors varied and the challenge tightening slightly each
round. Dragged objects are treated as real: a missed drop leaves the piece
where it was set down (never snapping back), so goals can be reached
incrementally. Touch is built for a child who leans on the
screen. A **drag** is strictly single-pointer: the finger that picked a piece up
owns it until it lets go, so spare fingers can't hijack it or drop it early, and
a gesture the OS takes away sets the piece down without scoring a miss. A **tap**
takes the opposite rule — any finger may tap, because "primary" only means the
first finger down, and a resting hand would otherwise make every real tap
non-primary and the app go dead. What's filtered instead is what multi-touch
actually causes: contacts landing together (a palm, a grab) count as one tap,
not several, and a hand on empty board is not scored as a miss at all. Spoken prompts repeat at most 3 times, with exponential backoff
between repeats. Press and hold a game card to open the
level picker — large cards with generated previews of each micro-level; tap
any level already reached (every level when "Unlock every game" is on). The
small ladder dots on each card are tappable shortcuts too.

Intro 0.6 ("Up the spout") teaches cause→effect on the itsy-bitsy-spider spout:
the child drags the bug onto the water spout (the cause), which triggers the
effect — the bug climbs up, rain falls from the cloud, and it washes out
("Out!"). It's the first lesson about *the child's action producing a result*,
and the first that needs the object MOVED rather than just touched.

Letters (Node 7) is a magnet board. The pieces are the classic plastic
uppercase set — chunky rounded glyphs with filleted corners, moulded side
walls and a gloss, drawn as layered SVG (`js/letters.js`), in the four colors a
real set comes in; digits 0–9 are modelled too. 7.1 is errorless exposure (tap
the letter, it hops and says its name) and 7.2 asks "which one is the A?" with
the named letter shown on a card *and* spoken. 7.3 and 7.4 both spell the
child's own name: 7.3 by **tapping** — every letter has a spot and none is
wrong, so tapping one flies it home and the word assembles on the gesture a
toddler is already reliable at — and 7.4 by **dragging**, handing back more of
the word each round (the last letter, then two, then all of it). Tapping a
letter already in place repeats its name, so the word stays available on
demand.
Distractors are drawn from a pool that never puts a confusable pair on the
board at once — by sight (E/F, M/W, B/D) *and* by sound, since the names are
spoken and "see"/"zee" barely separate. The pool itself is filtered to letters
whose sound a toddler can already make (/m/ /b/ /p/ /d/ /n/ /t/ /h/ /w/ /k/ /g/
long before /s/ /z/ /r/ /l/), and the letter a trial *asks* for comes from the
child's own name. Options are always different colors from the sample, so
matching color can never stand in for matching letterform.

Letter names are handed to the speech engine in **lowercase**. Given an
uppercase `"A"` every engine announces "capital A" — the case is information it
insists on reading out — and respelling is not an escape hatch either: `say`
renders "ay", "aye" and "eye" to byte-identical audio, so no spelling of A can
be told apart from I. Lowercase is right for most letters; the few it turns
into words ("a" → the article) get an entry in `SAY_OVERRIDE` in
`js/letters.js`, tuned by ear through the voice bench (below).

Relatedly, a `|` in any spoken line is a **beat** — a hard stop the voice
cannot smooth over, 120ms, or 300ms for `||` — so a letter name never runs into
the next word, and each segment is looked up in `CLIP_MAP` on its own. Beats can
also be tied to elements, which is how the letters of a name bounce in turn as
it is spelled.

Each level has its own failure fallback (pulse target, reduce field to 1v1,
expand snap radius, auto-demo the drag, magnetic snap, flash the completed
shape, lock all but one piece, …). Three fallbacks in a row trigger a DDA
downgrade; 1.4 routes to 1.2 or 1.3 based on which isolation variable the
child missed more.

**Procedural generation** is a hybrid: each micro-level is a strict ruleset
(which variables are locked, which vary, from which pools), and a seeded PRNG
picks concrete values within those constraints. The seed is stored on the
session record, so any trial is exactly replayable (event sourcing) while
positions/colors still vary between attempts to prevent rote memorization.

## Telemetry

Sessions are event streams in `localStorage` using the spec's
`InteractionEvent` schema (`TAP` / `DRAG_START` / `DRAG_END` / `TIMEOUT`,
coordinates, `hitElementId`, `isCorrectIntent`, `timeSincePromptMs`, plus
`missDistancePx` evaluated client-side). The dashboard derives:

- **Time-to-first-touch** (median, per node and trend)
- **Miss distance** — near-misses (<48px, motor) vs far misses (wrong choice)
- **Frustration** — >3 unproductive taps within 1s, re-derived from raw events
- **Generalization transfer** — success on generalize levels vs standard tests

Open the dashboard with the "Hold for grown-ups" button (2.2s press-and-hold).

## Mini games

Separate from the teaching sequence, a **Mini games** section on the home
screen holds standalone arcade interludes. **Bubble Pop** is a canvas game:
realistically-rendered soap bubbles (iridescent rims, specular glints, soft
refraction) drift down and speed up over time; tap to pop them (droplet burst
+ pop sound). If one reaches the ground the round ends. Score = bubbles popped.
**Picture Puzzle** is a 3x3 frame of rotating tiles — each tile is a
triangular prism (three square faces via CSS 3D) showing the same cell from
three complete scenes; tap to tumble a tile 120° to the next scene, and match
all nine to one scene to build the picture. Both mini-games run their own loop,
independent of the E→C→T engine, so they never touch curriculum progress or
telemetry.

## Audio & assets

Spoken lines play recorded audio clips when the phrase is mapped
(`CLIP_MAP` → `clips/*.mp3`, decoded via Web Audio); everything unmapped falls
back to the device's speech synthesis. Add a clip by dropping the mp3 in
`clips/` and adding one map entry. `make sync-clips` re-copies mapped clips
from the companion DB and **loudness-normalizes** them (gain to ~-14 LUFS + a
peak limiter) so recorded clips are consistent with each other and sit at the
same level as the TTS voice. `?noclips=1` forces TTS everywhere; captions
(`?cc=1`) and mute (`?mute=1`) are unaffected.

The Peekaboo game's picture cards in `assets/cards/*.webp` (36 named subjects)
were extracted from a photo of a physical toddler memory-card set: the cards
were segmented off the felt background, cornered, and saved with transparency.

## Automated tests

`make test-setup` once (installs Playwright + headless Chromium and WebKit),
then `make test` runs the suite against both engines — WebKit being the
iPad's actual browser engine. The tests drive the app with real pointer
input plus the `window.CF` harness hooks: full teaching-loop runs, drag and
drop-in acceptance, stacking physics outcomes (landing and roll-off),
persistent missed drops, the long-press level picker, and the simulator +
dashboard. No browser extension or visible browser involved.

## Test harness

The dashboard's **Usage simulator** runs synthetic sessions through the *same*
level generators, event schema, and DDA rules as live play. Profiles model
TTFT latency, error rates, motor noise, and frustration bursts:
`swift`, `typical`, `cautious`, `struggling`. Simulated sessions are badged
`sim`, advance the curriculum realistically, and can be removed (which also
restores the pre-simulation curriculum position).

An **Insights** section turns telemetry into findings (memorization risk,
frustration hotspots, TTFT trends, motor-vs-conceptual miss profile, DDA
repair loops) — the feedback loop for iterating on levels and pacing.

## Roadmap

- **Prompt modality alternation** — present each challenge through rotating
  modalities: (1) spoken words, (2) written words, (3) glyphs/icons. This adds a
  learning modality axis on top of the concept axis; the trial schema already
  separates `prompt` (display) from `say` (speech), so a third `glyph` channel
  and a per-trial modality selector slot in naturally. Telemetry should tag each
  trial's modality so the dashboard can compare acquisition across modalities.

For scripted testing, `window.CF` exposes `{ Engine, Store, Simulator,
Telemetry, NODES, PROFILES, computeStats, computeInsights, renderDash,
renderHome, showView }`, e.g.:

```js
CF.Simulator.run('struggling', 7);        // 7 days of synthetic usage
CF.computeInsights(CF.Store.sessions());  // derived findings
```

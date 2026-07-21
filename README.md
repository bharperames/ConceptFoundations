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
- Dark mode: follows the device setting by default; the dashboard switch
  overrides it (child surface becomes a night sky, dashboard uses dark chrome).

## Curriculum

Five nodes, seventeen micro-levels, each run as E→C→T(×3):

| Node | Levels | Interaction | Prerequisite |
|---|---|---|---|
| 1 · Identity (Same & Different) | 1.1–1.5 | tap | — |
| 2 · Magnitude (Big & Small) | 2.1–2.3 | tap | Identity |
| 3 · Quantity (More & Less) | 3.1–3.3 | tap (side clusters) | Identity |
| 4 · Spatial (In & Out) | 4.1–4.4 | drag & drop, physics | Magnitude |
| 5 · Composition (Build It) | 5.1–5.3 | drag / assembly | Spatial |

Level 4.2 (Stacking — "on top of") simulates a real 2-inch (5.08 cm) wood cube:
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
incrementally. Spoken prompts repeat at most 3 times, with exponential backoff
between repeats. Press and hold a game card to open the
level picker — large cards with generated previews of each micro-level; tap
any level already reached (every level when "Unlock every game" is on). The
small ladder dots on each card are tappable shortcuts too.

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

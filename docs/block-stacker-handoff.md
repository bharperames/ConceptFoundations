# Block Stacker — physics work hand-off

A self-contained brief for a specialized session to continue the **Block Stacker**
mini-game's physics and feel. Everything lives in one file: `index.html`.

## What it is

A "Mini games" sandbox (home card + level-map card, `data-mini="stacker"`,
`#view-stacker`). The child drops wooden blocks that fall, stack, topple, roll,
and can be grabbed and re-stacked on a grassy field. Realistic-cartoon look.

- **Code:** the `StackerGame` object in `index.html` (search `const StackerGame`).
- **Physics engine:** [Matter.js](https://brm.io/matter-js/) 0.19.0, loaded lazily
  from a CDN `<script defer src="…matter.min.js">`. If it fails to load, the game
  falls back to a simple bounce-free AABB physics path (same public API), so it
  always works. `StackerGame.useMatter` records which path is active.
- **Tuning harness:** `scripts/stacker_sim.mjs` — headless Node script that mirrors
  the shapes/bodies and runs thousands of scenarios, scoring error classes. This is
  the main tool for this work. Run: `npm i --no-save matter-js@0.19.0 && node
  scripts/stacker_sim.mjs 1500` (or `… 400 sweep` to compare parameter variants).
- **Test:** `tests/app.spec.js` › "block stacker mini-game" (forces the AABB
  fallback for determinism — no network dependence).

## Current state (what's done)

- Real rigid-body dynamics: blocks topple/rotate/roll/settle; a ball rolls;
  collisions play a throttled wood "clack".
- **Shape set** (`StackerGame.SHAPES`), each built to look like shaded wood
  (`blockSVG` + gradient defs in `ensureDefs`): `cube`, `brick` (2×1),
  `plank` (2.7×0.62 flat-wide), `tall` (0.72×1.95), `cyl` (flat-topped, cylindrical
  shading), `tri` (triangle/cone, body on its true **centroid** `cy:0.667`),
  `ball`. Rectangular shapes are ordered first (priority).
- **Drop controls:** a picker row (`#stk-ops`) with one wooden icon per shape —
  tap an icon to drop that block. Plus a reset `↺`. Capped at `MAX = 16` blocks.
  (Earlier there was a single random "＋"; it's now per-shape.)
- **Grab & re-stack:** a block is grabbed with a Matter `Constraint` (spring from
  finger to grab-point) so it stays a *dynamic* body — friction carries whatever is
  balanced on top, and lifting a support lets the thing above fall. On grab the
  block's velocity is zeroed and the spring is gentle (`stiffness:.4, damping:.15`)
  so grabbing a moving block doesn't fling it. `Body.setStatic` is NOT used for the
  drag (that was the old approach and caused the "floating support" bug).
- **Sleeping is disabled** (`enableSleeping:false`) so an unsupported block falls
  the instant its support moves; `positionIterations:12` (penetration sweet spot).

## Physics params (tuned by simulation, in `makeBody`/`start`)

Zero restitution on wood (least penetration, realistic); ball keeps `restitution:.12`
to roll with life. `friction:.6 / frictionStatic:.85`, `density:.0017`, box
`chamfer:{radius: min(w,h)*.06}`. Engine: `positionIterations:12,
velocityIterations:8, constraintIterations:3`. These came from a sweep — see the
harness. Last full run (1500 scenarios): **maxPen ≈ 4.4px (~3% of a block),
floating 0.001/scn, escaped 0, NaN 0, grab-hang 0, grab-spike 0.4.**

## Error classes the harness measures (extend these)

In `scripts/stacker_sim.mjs`:
- `penetration()` — worst block-block overlap depth (Matter `Collision.collides`).
- `floating()` — a block at rest touching **nothing** (true floater). Note: leaning/
  bridging/side-supported blocks are legitimate; don't flag those.
- `escaped()` — bodies that left the field or went NaN.
- `runGrabMove()` — grab a support, drag it away; the block on top must fall (not
  hang). Returns hung=1 on failure.
- `runDragJump()` — grab a fast-falling block; measures the post-grab speed spike
  (the "clicking a moving block flings it" bug).

## Open threads / good next steps

1. **Grab feel.** The constraint drag is decent but can still feel springy/jittery
   on fast flicks. Worth exploring: pointer-velocity-matched target, clamping
   angular velocity while held, or a position-based (not force) drag that still
   collides. Add a harness metric for "jitter while dragging along a surface."
2. **Resting stability at scale.** With 16 mixed bodies, tall/thin stacks can creep.
   Try higher `positionIterations` only when body count is high, or per-shape
   friction. The sweep infra is there — add variants and run `… sweep`.
3. **Ball/cylinder rolling** can be too lively or too dead depending on tone —
   tune `restitution`/`friction`; consider rolling resistance.
4. **Triangle (cone) contacts.** `Bodies.fromVertices` centroid handling is subtle;
   double-check the sprite-to-body alignment (`cy:0.667`) across sizes.
5. **Perf.** Matter runs every rAF via `Engine.update(dt)`; fine at 16 bodies. If
   MAX grows, cap substeps / clamp dt.
6. **Self-contained option.** Matter is a CDN dependency for this mini-game only.
   If fully-offline is wanted, inline `matter.min.js` into `index.html`.

## Guardrails / conventions (please keep)

- All app code is in the single `index.html`; no build step. The shipped app must
  not fetch anything except (optionally) the Matter CDN.
- Keep the AABB fallback working (it's the test path and the offline path).
- Sprites are crisp: integer pixel positioning in `sync()` (sub-pixel was the old
  "fuzzy blocks" bug); block SVGs use `preserveAspectRatio="none"` to fill, picker
  icons use `meet` + explicit width/height (so a wide plank icon doesn't overflow
  its button — that overflow once intercepted clicks).
- Run `make test` before committing; keep the stacker test green (force the AABB
  fallback in tests, don't depend on the CDN).

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
- **Tests:** `tests/app.spec.js` › "block stacker mini-game" (forces the AABB
  fallback for determinism — no network dependence), plus
  `tests/physics.test.mjs` — 13 node:test units over the sim harness pinning
  the specialty gravity/drag cases with thresholds (free-fall speed, pendulum
  swing-to-plumb + overshoot, hold-still no-ratchet, rotated-grab anchoring,
  fling containment, support removal, mid-fall catch, ground/block press
  bounds, tower creep, settle batch, ball roll). `make test` runs both; the
  physics units need devDependency `matter-js` (in package.json).

## Current state (what's done)

- Real rigid-body dynamics: blocks topple/rotate/roll/settle; a ball rolls;
  collisions play a throttled wood "clack".
- **Shape set** (`StackerGame.SHAPES`), each built to look like shaded wood
  (`blockSVG` + gradient defs in `ensureDefs`): `cube`, `brick` (2×1),
  `plank` (2.7×0.62 flat-wide), `tall` (0.72×1.95), `cyl` (flat-topped, cylindrical
  shading), `tri` (triangle/cone, body on its true **centroid** `cy:0.667`),
  `ball`. Rectangular shapes are ordered first (priority).
- **Sprites match the physics box exactly**: no inset, corner radius = the
  body chamfer (`min*0.06`), tri stroke inset by half its width, ball r = w/2.
  Any visual margin reads as stacked blocks "not touching".
- **Procedural lawn** (`grassSVG`, injected into `.stk-ground` on `start()`):
  turbulence-textured field (tone patches, blade streaks, light sheen over a
  green gradient) under a 3-row irregular blade fringe that overhangs 20px
  above the strip. Gotcha: fringe rows close in a shallow 5px footer —
  closing them to the svg bottom blankets the whole textured field.
- **Drag interruption**: contextmenu on the area is suppressed and releases
  the pinch; `blur`/hidden-tab also release; a fresh pointerdown drops any
  stale drag — a swallowed pointerup used to leave the constraint alive
  forever (block frozen mid-air).
- **Photoreal wood grain** (`woodFilter`): per-block SVG filter — three
  `feTurbulence` layers (broad tone bands stretched along the long axis, fine
  fibres, light sheen), colours derived from the block's tone (`shadeTone`),
  softened along the grain, composited onto the shape's own **SourceAlpha**
  (strokes/chamfers textured, no clipPath). Every dropped block gets a unique
  seed; picker icons use fixed seeds. Dropped blocks render their SVG at REAL
  pixel size (a 52-scale viewBox stretched by `preserveAspectRatio="none"`
  would blur the texture). Perf @16 blocks: ~15.4ms/frame avg (filters raster
  once per block; transforms don't re-render them).
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
velocityIterations:8, constraintIterations:3`, **gravity 2.2** (Matter's default
1.0 is ~5× weaker than real scale for blocks this size — read as floaty/massless;
2.2 falls ~1.5× faster with identical stability, 3.0 blew penetration up to
9.7px). The rAF loop substeps frames >20ms (2× half-steps). Clack thresholds are
scaled for the faster impacts (`v>2.4`, `v/13`).

**The grab is a two-finger pinch at a predictable spot.** A length-0 Matter
constraint solves in rigid mode, and by default injects its FULL impulse torque —
that was the "click far from the centroid → block snaps" bug. Now: `stiffness:.4,
damping:.15, angularStiffness:.7` (only 30% of pivot torque survives) plus
per-frame angular damping `×0.85` while held (grip friction, applied in
`loop()`). Off-centre grabs droop smoothly around the grab point under gravity —
grab a plank's right end and its left end swings down — instead of whipping.
Momentum still zeroed on grab. Three more grab rules (all in `onDown` /
`grabAnchor` / `moveDragTarget`):

- **Grab regions.** The click is quantized to predictable anchors per axis:
  the central 70% → exact centroid (carries level, smooth dragging — the
  common intent), only the outer 15% per end → an edge spot (0.85) that gives
  the deliberate pendulum swing. Ball always pinches its centre; tri anchors
  scaled ×.6 to stay inside the wedge.
- **`pointB` is a WORLD-frame offset.** `Constraint.create` records
  `angleB = body.angle` and rotates `pointB` by the delta — passing a body-local
  offset anchors any tilted block wrong (the "grab a settled block's side and it
  teleports sideways" bug). The finger→anchor offset is kept constant instead:
  the target follows pointer deltas, so pickup never jumps.
- **The drag target is managed, not raw.** Each frame `moveDragTarget()` moves
  `pointA` toward the pointer but (a) clamped so the block is never *demanded*
  to penetrate floor/walls (that demand thrashes: solver pushes out, spring
  pulls in — `runGroundPress` measured 153px/frame of thrash unclamped, 0.1
  clamped), (b) **contact-slipped, depth-adaptive**: the lead component
  pressing INTO anything the block touches is capped at `pressAllow (4px)
  minus the current penetration` — enough force to shove a loose block, but
  the press self-limits as penetration approaches the chamfer. A constant
  press otherwise beats the position solver (it corrects only a fraction of
  overlap per frame) and sinks blocks visibly into each other. **Error
  criterion: sustained block-block overlap > 4px (≈ chamfer, reads as
  clipping) is a bug**; brief transients on a max-speed ram are allowed.
  `runBlockPress` (free + braced-at-wall variants): sustained overlap 2.8px
  with the neighbour still pushed; in-browser press-to-wall: peak 2.9px,
  sustained 0. (c) rate-limited to
  40px/frame (a rigid constraint chasing a teleported target moves the block
  through a wall inside ONE engine step — no velocity clamp can catch it), and
  (d) lead-limited to 1U — the pinch "slips" like real fingers when stuck.
- **Hold-still runs torque-free.** While the lead is inside a 3px dead-zone the
  constraint gets `angularStiffness:1` (zero torque), restored to `.7` when
  actually dragging. A torqueful hold RATCHETS: each frame gravity dips the
  block, the anchor-side correction arrives 30% as torque, and the floor pushes
  the far side back up but can never pull the near side down — a block held by
  its side rotated up ~0.03 rad/s with the mouse perfectly still (both sides,
  opposite directions). `runHoldStill` guards it (browser A/B: 0.17 rad → 0.001
  over 6s).

**Containment.** The world has a ceiling (blocks spawn just inside, `y=h*0.62`),
and the loop clamps every body post-step to ≤45px/frame linear, ≤0.5rad/frame
angular — nothing can outrun the wall thickness, so flings can't tunnel out (the
old "flung block disappears forever" bug; `runFling` guards it).

**Settle damping.** Chamfered corners make stacked blocks rock — the contact
point flips corner to corner each solve — so a block standing on a tower creeps
sideways forever (sleeping is off by design). The loop bleeds near-rest motion
(`speed<.25 && |angVel|<.03 → ×.85/frame`, held block excluded): tower creep
went 16px/300 frames → 0. Keep the factor gentle and all-axis — harder damping
or lateral-only damping both trap rare ceiling-squeeze overlaps deeper
(`runTowerCreep` + `deep/scn` guard the tradeoff).

Last full run (1500 scenarios): **maxPen ≈ 5.5px, deep 0.003/scn, floating 0,
escaped 0, NaN 0, grab-hang 0, grab-spike 0.1** (was 0.4), off-centre grab spin
≤.027 rad/frame, slide jerk 2.3.

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
- `runOffCenterGrab()` — grab a resting plank by its far end and lift; measures
  speed spike, worst spin, and grab-point lag (the "off-centroid snap" bug).
- `runDragSlide()` — drag a cube along the floor at steady pointer speed;
  measures frame-to-frame speed jerk (drag jitter).
- `runRotatedGrab()` — grab a tilted falling brick by its side; guards the
  world-frame-`pointB` fix (spike/drift explode if pointB goes body-local).
- `runFling()` — violent flick far past the window edge; the block must stay in
  the field (ceiling + speed clamps + drag-target rate limit).
- `runGroundPress()` — hold the drag target below the floor; measures the
  constraint-vs-solver position thrash, clamped vs unclamped.

Sweeps are named: `node scripts/stacker_sim.mjs 300 gravity` or `… 300 drag
'{"gravity":2.2}'` (second arg = JSON overrides applied to every variant).

## Debug overlay (physics annotations)

A barely-there toggle next to the volume button (`#stk-dbg-btn`, bottom-left)
turns on a canvas overlay (`#stk-dbg-cv`, `StackerGame.drawDebug()`) showing what
the sprites hide: the true collision hulls (chamfered/decomposed, green), centre
of mass + mass value (magenta), velocity vector (yellow, ×4) and spin arc
(orange), live solver contact points (red), static floor/walls (dashed), and the
pinch constraint (blue, pointer → grab point). Works in the AABB fallback too
(boxes + centres + floor line).

## Open threads / good next steps

1. **Grab feel — largely addressed** (pinch model above; jitter/slide metrics now
   in the harness). Remaining: fast-flick release momentum could feel better
   (pointer-velocity-matched release?).
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

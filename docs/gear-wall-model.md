# Gear Wall — the mechanical model

How the Gear Wall mini-game simulates, places, and renders gears. The physics
lives in `js/games/gearworks.js` (pure math, no DOM — unit-tested in
`tests/gears.test.mjs`); the game, interaction, and rendering live in
`js/games/gears.js`.

## Kinematic foundations

Every gear on the wall shares one **module** `m = MODULE = 8` px of pitch
diameter per tooth. From a tooth count `N`:

| radius | formula | meaning |
|---|---|---|
| pitch  | `r = m·N/2` | the true meshing surface |
| outer  | `r + 0.9m`  | tooth tips (addendum 0.9m) |
| root   | `r − 1.1m`  | tooth valleys (dedendum 1.1m → 0.2m running clearance) |

Because the module is shared, **two gears mesh iff their centre distance
equals the sum of their pitch radii** (within `MESH_TOL = 0.28m`). That single
condition drives everything: mesh detection, snapping, legality, and the
steam engine's internal gearing.

Sized gears are `TEETH = [8, 12, 16, 20, 24]` (ratios 1:1 up to 3:1); motors
and housing input gears are 12t (`MOTOR_TEETH`).

## Speeds: the train solver (`solve`)

- Each external mesh reverses direction with ratio `ω₂ = −ω₁·N₁/N₂`.
- A motor with its tri-switch on demands `ω = sw · MOTOR_W · throttle`
  (sw ∈ {+1, −1}; `throttle` defaults to 1 and is the steam engine's speed
  control); switched off it freewheels.
- Propagation is a BFS over the mesh graph per connected component, seeded
  from the first switched-on motor.
- A **contradiction jams the whole component**: an odd loop (three gears in a
  triangle genuinely jam), or any second motor whose demand disagrees with
  what the train delivers to it. Jammed gears get `ω = 0` and a red hub ring.

A gear being dragged is excluded from the train (`skip`), so the rest of the
machine keeps running while a piece is in hand.

## Tooth phase: interleave, alignment, planet-roll

Meshing gears must *look* meshed — teeth interleaved, never tip-on-tip. At
contact direction θ, with tooth phases `φA = N_A(θ − angA)` and
`φB = N_B(θ+π − angB)`, interleave requires

```
φA + φB ≡ π (mod 2π)
```

- `phaseAlign(a, g)` rotates `g` to the nearest angle satisfying this.
- Exact ratio integration in the animation loop *preserves* it — phases never
  drift while running.
- `rollToFit` handles closing a chain into a loop: rotating the last gear
  alone generally can't satisfy two neighbours at once, so the gear is swept
  a little **around** its anchor (one planetary tooth period is
  `2π/(N_A + N_g)`; searching ± half of one covers every distinct offset)
  to the pose minimising the worst neighbour's phase error.
- `phaseError(a, b)` reports how far a pair is from perfect interleave
  (0 = perfect, π = tooth-on-tooth); the debug overlay prints it per mesh.

## Placement rules

- **Magnetic snap** (`snap`): within `SNAP_DIST = 2.4m` of a mesh distance,
  a released gear slides to the *exact* pitch-sum distance and phase-aligns.
  With two candidate neighbours it solves the circle–circle intersection so
  both mesh.
- **Legality** (`illegalOverlaps`): against every other gear, a placement is
  either MESHED (within tolerance of the pitch sum) or CLEAR (outside the sum
  of outer radii). Anything between is buried teeth — not placeable on the
  toy. `resolvePlacement` pushes an illegal drop out to exact mesh over a few
  passes, or the game bounces the piece back where it came from.

## Spawn placement: trains, not scatter

Tapping palette buttons should build a working machine, not confetti:

- The **first piece lands mid-board**, slightly left of centre (the chain
  grows rightward through the middle). Housings clear the palette overlay.
- Every later piece drops **already meshed** onto the newest gear of the
  train, at exact pitch distance, kept outside snap range of everyone else —
  so each newcomer meshes with *exactly one* gear. Chains stay trees, and
  trees can never jam.
- Direction preference is sideways first, then shallow diagonals, so the
  train snakes across the board instead of stacking.
- **Housings drive from below** their case: a housing anchor takes its
  newcomer underneath; a newcomer housing reaches down to mesh an anchor
  from above.
- `houseDims(g)` gives each housing's case rectangle (half-width × height
  above the gear centre) — shared by spawn bounds, tower-clash checks, and
  hit-testing. Clock/bell: `1.3R × 4R`. Steam engine: `3.1R × 5.85R`.
- If the board is too crowded to connect, fall back to any clear spot.

## The pieces

- **Sized gears** (8–24t): toy plastic in red/blue/green/yellow/purple —
  size ↔ colour, so the palette icon predicts the piece. Orange is reserved
  for the motor.
- **Motor** (12t): TOMY-style orange body, yellow/blue lightning hub, green
  tri-switch. Tap the hub: off → run → reverse → off.
- **Cuckoo clock**: chalet housing; the half-hidden 12t input gear drives the
  clock hands through a 12:1 "gearing" (minute:hour) and pops the bird with a
  real cuckoo once per driven revolution.
- **Bell tower**: campanile; one bell swing+ring per driven revolution.
- **Two-cylinder steam engine**: see below.

## The steam engine

An open-frame stationary engine, ~3× the motor, cutaway so the whole
mechanism shows. To the solver it is simply a motor (same `MOTOR_W`, same
tri-switch), but its innards are kinematically real:

- **Cog-on-cog drive**: the exposed 12t drive pinion meshes an 18t spoked
  flywheel-gear inside the case at the exact pitch-sum distance
  (`SE.CY = −(r₁₂ + r₁₈)`). The crank gear's angle is phase-locked to the
  pinion each frame with the same interleave equation the wall uses
  (contact direction θ = −π/2):

  ```
  crank = π/2 − (π(1 + N_p/2) + N_p·pinion) / N_c        (ratio −12/18)
  ```

- **Slider-crank linkage**: two brass crank pins sit 90° apart (like a real
  two-crank engine — it can start from any position). Each connecting rod
  runs up to a crosshead sliding in guides at cylinder axis `x_c`, solved
  exactly per frame:

  ```
  y_crosshead = y_pin − √(L² − (x_c − x_pin)²)
  ```

  Piston rods run from the crossheads into the cylinder glands.
- **State UI**: the Johnson bar — a long lever with a red ball grip on a
  notched brass quadrant — is the ONLY tri-switch control (taps elsewhere on
  the case do nothing; the small motor still switches by tapping its hub).
  Solid white glyphs flank the arc — ◀ forward, ■ stop, ▶ reverse — with
  the active one GREEN. Each glyph is a direct tap target choosing that
  state outright; tapping the lever/quadrant itself toggles stop ↔ the last
  direction (remembered across stops).
- **Throttle**: the brass handwheel on the steam line below the gauge cycles
  slow / normal / fast (`STEAM_THR = [0.6, 1, 1.8]` × hub speed). The
  multiplier feeds the solver as `g.throttle`, so the whole train scales —
  and an engine throttled differently from another motor on the same train
  genuinely jams it. The steam-puff pace follows the setting.
- **Pressure gauge**: a real dial — 0–200 psi over a 270° sweep, numbered
  majors, minor ticks, red zone at the top end. The needle reads the
  engine's ACTUAL solved speed (100 psi = 1× hub speed), so it climbs with
  the throttle, falls to zero on a jam, and drops while the engine is
  carried. It is one persistent element swept by a damped CSS transition
  (`.gre-needle`), so retargets read as instrument wobble, never a teleport.
- **Steam effect**: blurred puff-clouds vent from each cylinder head,
  staggered so the sides alternate like exhaust strokes. Pure CSS animation
  gated by the `gre-on` class, which `solveNow` sets only when the solver
  says the engine is actually turning — a jammed or switched-off engine goes
  cold.

Geometry constants live in the `SE` object in `gears.js`.

## Rendering modes

- **Toy plastic** (default): flat bright bodies, round finger-holes (nothing
  blade-like), white hubs.
- **✨ Metal** (toggle bottom-left; persisted as `Store.settings().metalGears`):
  each size gets a machined metal — silver, gold, copper, brass, blued steel;
  the motor is cast iron with brass fittings. Ingredients:
  - banded body gradients (multi-reflection striping),
  - a radial specular + diagonal window-streak **sheen, clipped to the gear
    silhouette and counter-rotated** so the light source stays fixed in the
    room while the metal turns beneath it (the planet-lighting trick from the
    block stacker),
  - cast-metal fleck (two gated turbulence layers),
  - a near-black workshop wall (`.gr-fancy` on the board) so the metal glows
    in any theme.
  - `reskin()` live-swaps every piece and the palette icons; the steam engine
    has one (already metal) skin in both modes.

## Interaction summary

- Tap a palette icon → piece pops in, meshed to the train.
- Drag anywhere; a light magnetic pull leans toward the snapped pose in
  range; release snaps tooth-perfect or bounces back if the spot is illegal.
- Quick-tap a motor hub / the engine case → cycle off → run → reverse.
- Jams stop the whole train and ring the offending gears in red.
- The compass button toggles the debug overlay: pitch circles (the true
  meshing surfaces), tooth-phase ticks, mesh links with ratio and phase
  error, per-gear ω, jam markers.

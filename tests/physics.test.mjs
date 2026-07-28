// Block Stacker gravity/drag physics — dedicated unit tests for the specialty
// cases that regressed silently in play-testing. Each test pins a behaviour
// with a threshold; the shared config is scripts/stacker_sim.mjs BASE (the
// exact numbers shipped in index.html). Deterministic: fixed seeds throughout.
// Run: node --test tests/physics.test.mjs   (needs devDependency matter-js)
import test from 'node:test';
import assert from 'node:assert/strict';
import Matter from 'matter-js';
import {
  BASE, U, W, floorY, SHAPES, VIS_PEN, mulberry32,
  makeBody, makeWorld, step,
  runScenario, runGrabMove, runDragJump, runOffCenterGrab, runDragSlide,
  runRotatedGrab, runFling, runGroundPress, runTowerCreep, runBlockPress,
} from '../scripts/stacker_sim.mjs';

const C = { ...BASE };
const { Engine, World, Body } = Matter;

test('free fall: a cube drops at wooden-block speed (not moon gravity, not warp)', () => {
  // gravity 2.2 → ~0.61 px/frame² → ~600px of fall in ~45 frames. A wide
  // band still catches an accidental return to floaty 1.0 (~66f) or worse.
  const eng = makeWorld(C), dt = 1000/60;
  const cube = makeBody(SHAPES[0], W/2, U*0.62, U, U, C);
  World.add(eng.world, cube);
  let frames = 0;
  while (cube.position.y < floorY - U/2 - 2 && frames < 200){ step(eng, dt, C); frames++; }
  assert.ok(frames >= 30 && frames <= 60, `fall took ${frames} frames, expected 30–60`);
});

test('pendulum: an end-grabbed plank lifted free swings to plumb, gravity-fast', () => {
  const r = runOffCenterGrab(C);
  // reaches near-vertical quickly (real end-pivot swing, not a damped crawl)…
  assert.ok(r.tVert >= 0 && r.tVert <= 90, `took ${r.tVert} frames to near-vertical, expected ≤90`);
  // …overshoots like a pendulum (zero overshoot = the old freeze/overdamping)…
  assert.ok(r.overshoot > 0.05 && r.overshoot < 0.7, `overshoot ${r.overshoot.toFixed(2)} rad, expected 0.05–0.7`);
  // …and settles hanging at vertical, not stalled 45° short
  assert.ok(Math.abs(r.endAngle - Math.PI/2) < 0.3, `settled at ${r.endAngle.toFixed(2)} rad, expected ≈π/2`);
  assert.ok(r.spike < 15, `speed spike ${r.spike.toFixed(1)} px/frame during lift`);
});

test('hold-still: a grounded block held by its side must NOT self-rotate (ratchet)', () => {
  const ang = runHoldStillWrapped();
  assert.ok(ang < 0.02, `rotated ${ang.toFixed(3)} rad over 4s with the pointer still`);
});
// runHoldStill lives in the sim; thin wrapper keeps the import list honest
import { runHoldStill } from '../scripts/stacker_sim.mjs';
function runHoldStillWrapped(){ return runHoldStill(C); }

test('rotated grab: grabbing a tilted block anchors true (no sideways teleport)', () => {
  const r = runRotatedGrab(C);
  assert.ok(r.spike < 2, `post-grab speed spike ${r.spike.toFixed(1)} px/frame`);
  assert.ok(r.drift < 5, `grab-point drift ${r.drift.toFixed(1)} px`);
});

test('fling: a violent off-screen flick cannot eject a block from the field', () => {
  assert.equal(runFling(C), 0, 'block escaped the field after a violent fling');
});

test('grab-a-support: pulling the bottom block out drops the one on top (no hover)', () => {
  const rng = mulberry32(999);
  for (let i = 0; i < 10; i++) assert.equal(runGrabMove(C, rng), 0, `run ${i}: top block hung in the air`);
});

test('grab mid-fall: catching a fast-falling block must not fling it', () => {
  const rng = mulberry32(7);
  for (let i = 0; i < 10; i++){
    const r = runDragJump(C, rng);
    assert.ok(r.spike < 3, `run ${i}: post-grab spike ${r.spike.toFixed(1)} px/frame (pre-grab ${r.preSpeed.toFixed(1)})`);
  }
});

test('drag along the ground: steady pull, no jitter/jerk', () => {
  const r = runDragSlide(C);
  assert.ok(r.jerk < 6, `frame-to-frame speed jerk ${r.jerk.toFixed(1)} px/frame`);
});

test('press into the ground: the drag target clamp kills the constraint-vs-solver fight', () => {
  const thrash = runGroundPress({ ...C, pressClamp: true });
  assert.ok(thrash < 2, `position thrash ${thrash.toFixed(1)} px/frame with the clamp`);
  // and the metric itself still detects the fight when unclamped (guards the guard)
  const free = runGroundPress({ ...C, pressClamp: false });
  assert.ok(free > 20, `unclamped thrash only ${free.toFixed(1)} — the metric went blind`);
});

test('press into another block: pushes it, but sustained visible overlap is bounded', () => {
  for (const braced of [false, true]){
    const r = runBlockPress(C, braced);
    assert.ok(r.endOverlap <= VIS_PEN + 0.5,
      `${braced ? 'braced' : 'free'}: sustained overlap ${r.endOverlap.toFixed(1)}px > visible budget ${VIS_PEN}px`);
    if (!braced) assert.ok(r.pushed > 2*U, `neighbour only pushed ${r.pushed.toFixed(0)}px — pushing broke`);
  }
});

test('tower: a plank standing on a 2-block tower rests dead still (no corner rocking creep)', () => {
  const r = runTowerCreep(C);
  assert.ok(r.upright, 'plank fell over during the settle');
  assert.ok(r.path < 5, `top block wandered ${r.path.toFixed(1)}px over 10s at rest`);
});

test('settle batch: dropped piles land clean (no floaters, escapes, NaN, deep overlap)', () => {
  const rng = mulberry32(12345);
  let maxPen = 0, deep = 0, floats = 0, esc = 0, nan = 0;
  const SCN = 20;
  for (let i = 0; i < SCN; i++){
    const r = runScenario(C, rng);
    maxPen = Math.max(maxPen, r.maxPen); deep += r.deep; floats += r.floating; esc += r.escaped; nan += r.nan;
  }
  assert.equal(floats, 0, `${floats} true-floating blocks`);
  assert.equal(esc, 0, `${esc} blocks escaped the field`);
  assert.equal(nan, 0, `${nan} scenarios went NaN`);
  assert.ok(maxPen < 15, `worst settled penetration ${maxPen.toFixed(1)}px`);
  assert.ok(deep / SCN < 0.3, `${(deep/SCN).toFixed(2)} deep overlaps per scenario`);
});

test('wedge ramp: a ball set on the high end rolls down the slope and off', () => {
  const eng = makeWorld(C), dt = 1000/60;
  const wedge = SHAPES.find(s => s.key === 'wedge'), ww = wedge.w*U, wh = wedge.h*U;
  // fromVertices centres the body on its centroid (2/3 across/down the rect)
  const ramp = makeBody(wedge, W/2, floorY - wh + wh/6 + wh/2 - wh/2, ww, wh, C);
  Body.setPosition(ramp, { x: W/2, y: floorY - (wh - wh/6) + wh/2 });   // base on the floor
  World.add(eng.world, ramp);
  for (let k = 0; k < 60; k++) step(eng, dt, C);
  const topX = ramp.bounds.max.x - U*0.55;                // over the slope, near the tall end
  const ball = makeBody(SHAPES[6], topX, ramp.bounds.min.y - U, U, U, C);
  World.add(eng.world, ball);
  for (let k = 0; k < 420; k++) step(eng, dt, C);
  assert.ok(ball.position.x < ramp.bounds.min.x, `ball never rolled off the low end (x=${ball.position.x.toFixed(0)}, ramp min ${ramp.bounds.min.x.toFixed(0)})`);
  assert.ok(Math.abs(ball.position.y - (floorY - U/2)) < 5, 'ball not resting on the floor after the ramp');
  assert.ok(Math.abs(ramp.angle) < 0.15, `the ramp itself tipped (angle ${ramp.angle.toFixed(2)})`);
});

test('squareness: a block dropped slightly tilted settles onto the exact axis', () => {
  const eng = makeWorld(C), dt = 1000/60;
  const cube = makeBody(SHAPES[0], W/2, floorY - U*2.5, U, U, C);
  Body.setAngle(cube, 0.04);                               // ~2.3° tilt at release
  World.add(eng.world, cube);
  for (let k = 0; k < 240; k++) step(eng, dt, C);
  const d = Math.abs(cube.angle - Math.round(cube.angle/(Math.PI/2))*(Math.PI/2));
  assert.ok(d < 0.004, `settled ${(d*180/Math.PI).toFixed(2)}° off square`);
  assert.ok(cube.speed < 0.3, 'still moving after settle');
});

test('ball: keeps a little life (rolls off a nudge) but comes to rest on the floor', () => {
  const eng = makeWorld(C), dt = 1000/60;
  const ball = makeBody(SHAPES[6], W/2, floorY - U/2, U, U, C);
  World.add(eng.world, ball);
  for (let k = 0; k < 60; k++) step(eng, dt, C);
  Body.setVelocity(ball, { x: 6, y: 0 });               // gentle nudge
  let travelled = 0, prev = ball.position.x;
  for (let k = 0; k < 300; k++){ step(eng, dt, C); travelled += Math.abs(ball.position.x - prev); prev = ball.position.x; }
  assert.ok(travelled > U*0.6, `ball only rolled ${travelled.toFixed(0)}px off a nudge — too dead`);
  assert.ok(ball.speed < 0.5, `ball still moving at ${ball.speed.toFixed(2)} px/frame after 5s`);
  assert.ok(Math.abs(ball.position.y - (floorY - U/2)) < 4, 'ball not resting on the floor');
});

test('carry: dragging a block grabbed by its top end trails gently, no weightless cape', () => {
  const r = runCapeDragWrapped();
  const deg = r.cruise * 180 / Math.PI;
  assert.ok(deg < 20, `trailing angle ${deg.toFixed(0)}° at steady drag speed — cape physics`);
  assert.ok(r.recover <= 30, `took ${r.recover} frames to hang back down after the pointer stopped`);
});
import { runCapeDrag } from '../scripts/stacker_sim.mjs';
function runCapeDragWrapped(){ return runCapeDrag(C); }

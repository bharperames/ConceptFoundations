// Block Stacker physics tuning harness. Mirrors StackerGame's shapes/bodies and
// runs thousands of headless Matter.js scenarios, measuring error classes:
//   maxPen    — worst block–block penetration (px); overlap glitch
//   deep/scn  — penetrations > 3px per scenario
//   float/scn — blocks at rest touching NOTHING (true floaters) per scenario
//   escaped   — bodies that left the field or went NaN
//   hung      — grab-a-support-and-move-it tests where the top block failed to fall
//   grabSpike — worst speed spike when grabbing a fast-moving block
// Run:  npm i --no-save matter-js@0.19.0 && node scripts/stacker_sim.mjs 1500
//       node scripts/stacker_sim.mjs 400 sweep     # compare parameter variants
import Matter from 'matter-js';
const { Engine, World, Bodies, Body, Composite, Collision } = Matter;

// ── app geometry (mirrors StackerGame) ──
export const W = 900, H = 800, floorY = H * 0.92;   // mirrors the app: 10% lawn strip
export const U = 15 * Math.min(W, H) / 100;               // one cube, px
export const SHAPES = [
  { key:'cube',  w:1,    h:1    },
  { key:'brick', w:2,    h:1    },
  { key:'plank', w:2.7,  h:0.62 },
  { key:'tall',  w:0.72, h:1.95 },
  { key:'tri',   w:1.45, h:1.2,  cy:0.667 },
  { key:'cyl',   w:0.92, h:1.5  },
  { key:'ball',  w:1,    h:1    },
];
export function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }

export function makeBody(shape, x, y, w, h, c){
  if (shape.key === 'ball') return Bodies.circle(x, y, w/2, { friction:c.friction, frictionStatic:c.fstat, restitution:c.ballRest, density:c.density, slop:c.slop });
  if (shape.key === 'tri'){
    const v = [{x:-w/2,y:h/2},{x:0,y:-h/2},{x:w/2,y:h/2}];
    return Bodies.fromVertices(x, y, [v], { friction:c.friction, frictionStatic:c.fstat, restitution:c.rest, density:c.density, slop:c.slop });
  }
  const opt = { friction:c.friction, frictionStatic:c.fstat, restitution:c.rest, density:c.density, slop:c.slop };
  if (c.chamfer > 0) opt.chamfer = { radius: Math.min(w,h)*c.chamfer };
  return Bodies.rectangle(x, y, w, h, opt);
}
export function makeWorld(c){
  const eng = Engine.create({ enableSleeping:false, positionIterations:c.posIter, velocityIterations:c.velIter, constraintIterations:c.conIter });
  eng.world.gravity.y = c.gravity;
  const wall = (x,y,ww,hh) => Bodies.rectangle(x,y,ww,hh,{ isStatic:true, friction:.9, slop:c.slop });
  const statics = [ wall(W/2, floorY+400, W+600, 800), wall(-45,H/2,90,H*3), wall(W+45,H/2,90,H*3),
                    wall(W/2, -40, W+600, 80) ];   // ceiling: flings can't leave the window
  World.add(eng.world, statics);
  eng._statics = statics;
  return eng;
}
// engine tick + the app's anti-tunnel clamps: no body may move faster than the
// side walls are thick (else a violent fling steps straight through and is lost)
export function step(eng, dt, c){
  Engine.update(eng, dt);
  for (const b of Composite.allBodies(eng.world)){
    if (b.isStatic) continue;
    if (b.speed > c.maxV) Body.setVelocity(b, { x: b.velocity.x*c.maxV/b.speed, y: b.velocity.y*c.maxV/b.speed });
    if (Math.abs(b.angularVelocity) > c.maxAV) Body.setAngularVelocity(b, Math.sign(b.angularVelocity)*c.maxAV);
    // settle damping: chamfered corners make stacked blocks rock (the contact
    // flips corner to corner) and creep sideways; with sleeping off, bleed
    // near-rest motion so towers actually come to rest
    // (gentle .85, all axes: harder damping or lateral-only both trap rare
    // ceiling-squeeze overlaps deeper — .85 lowers deep/scn 0.033→0.027)
    if (c.settleF < 1 && b.speed < c.settleV && Math.abs(b.angularVelocity) < .03){
      Body.setVelocity(b, { x: b.velocity.x*c.settleF, y: b.velocity.y*c.settleF });
      Body.setAngularVelocity(b, b.angularVelocity*c.settleF);
    }
  }
}

// a brick+cube tower with a plank standing on its end on top (the screenshot
// case): measure the top block's sideways creep after it should be at rest
export function runTowerCreep(c){
  const eng=makeWorld(c), dt=1000/60;
  const bw=2*U, bh=1*U, pw=2.7*U, ph=0.62*U;
  const brick = makeBody(SHAPES[1], W/2, floorY-bh/2, bw, bh, c);
  const cube  = makeBody(SHAPES[0], W/2, floorY-bh-U/2-1, U, U, c);
  const plank = makeBody(SHAPES[2], W/2, floorY-bh-U-pw/2-3, pw, ph, c);
  Body.setAngle(plank, Math.PI/2);
  World.add(eng.world, [brick, cube, plank]);
  for (let k=0;k<120;k++) step(eng,dt,c);
  const x0=plank.position.x; let drift=0, path=0, prev=x0;
  for (let k=0;k<600;k++){
    step(eng,dt,c);
    path += Math.abs(plank.position.x-prev); prev=plank.position.x;
    drift = Math.max(drift, Math.abs(plank.position.x-x0));
  }
  return { drift, path, upright: Math.abs((plank.angle % Math.PI) - Math.PI/2) < 0.2 };
}

// max block-block penetration depth + count of deep overlaps
export function penetration(blocks){
  let max=0, deep=0;
  for (let i=0;i<blocks.length;i++) for (let j=i+1;j<blocks.length;j++){
    const col = Collision.collides(blocks[i].body, blocks[j].body);
    if (col && col.collided){ const d=col.depth; if(d>max)max=d; if(d>3)deep++; }
  }
  return { max, deep };
}
// a real floating error: a block at rest that touches NOTHING (no other block,
// no wall, no floor) — leaning/bridging/side-supported blocks are legitimate
export function floating(blocks, statics){
  let n=0;
  for (const b of blocks){
    if (b.body.speed > 0.35) continue;                 // still moving — not settled
    let touches=false;
    for (const o of blocks){ if(o===b) continue; const col=Collision.collides(b.body,o.body); if(col&&col.collided){touches=true;break;} }
    if (!touches) for (const s of statics){ const col=Collision.collides(b.body,s); if(col&&col.collided){touches=true;break;} }
    if (!touches) n++;
  }
  return n;
}
export function escaped(blocks){
  let n=0; for (const b of blocks){ const p=b.body.position;
    if (isNaN(p.x)||isNaN(p.y)||p.x<-80||p.x>W+80||p.y>H+300||p.y<-H) n++; }
  return n;
}

export function runScenario(c, rng){
  const eng = makeWorld(c), world = eng.world, blocks=[], dt=1000/60;
  const N = 8 + Math.floor(rng()*7);
  for (let i=0;i<N;i++){
    const shape = SHAPES[Math.floor(rng()*SHAPES.length)];
    const w=shape.w*U, h=shape.h*U;
    const x = W*0.5 + (rng()*2-1)*U*1.5;
    const body = makeBody(shape, x, h*0.62, w, h, c);   // spawn just inside (ceiling above)
    Body.setAngle(body, (rng()-0.5)*0.25);
    World.add(world, body); blocks.push({ body, shape, w, h });
    for (let k=0;k<26;k++) step(eng, dt, c);
  }
  let maxPen=0, deep=0;
  for (let k=0;k<200;k++){
    step(eng, dt, c);
    if (k>140){ const p=penetration(blocks); if(p.max>maxPen)maxPen=p.max; if(p.deep>deep)deep=p.deep; }
  }
  return { maxPen, deep, floating: floating(blocks, eng._statics), escaped: escaped(blocks), nan: blocks.some(b=>isNaN(b.body.position.x)) ? 1:0, N };
}

// the app's pinch-grab: zero momentum, then a constraint at the grab point.
// angularStiffness scales DOWN the torque the constraint injects (Matter solves
// torque * (1 - angularStiffness)); holdSpin is per-frame angular damping while
// held (grip friction of the pinch) — applied by the app loop before each update.
// The click is snapped to a predictable grab spot (grabAnchor), and pointB is a
// WORLD-frame offset — Constraint.create records angleB=body.angle and rotates
// pointB by the delta, so passing a body-local offset anchors a rotated block
// at the wrong spot (the old "grab a tilted block and it teleports" bug).
export function grabAnchor(c, shape, w, h, loc){
  if (!c.snap) return loc;
  if (shape.key === 'ball') return { x:0, y:0 };
  const s = shape.key === 'tri' ? .6 : 1;
  // central 70% → exact centroid (level carry); outer 15% per end → swing anchor
  const q = f => Math.abs(f) < .7 ? 0 : Math.sign(f) * .85;
  return { x: q(loc.x/(w/2)) * w/2 * s, y: q(loc.y/(h/2)) * h/2 * s };
}
export function makeDrag(c, body, gx, gy, shape, w, h){
  Body.setVelocity(body, {x:0,y:0}); Body.setAngularVelocity(body, 0);
  const dx=gx-body.position.x, dy=gy-body.position.y;
  const ca=Math.cos(-body.angle), sa=Math.sin(-body.angle);
  const an = grabAnchor(c, shape||{key:'cube'}, w||U, h||U, { x: dx*ca - dy*sa, y: dx*sa + dy*ca });
  const cb=Math.cos(body.angle), sb=Math.sin(body.angle);
  const off = { x: an.x*cb - an.y*sb, y: an.x*sb + an.y*cb };
  return Matter.Constraint.create({ pointA:{x:body.position.x+off.x, y:body.position.y+off.y}, bodyB:body,
    pointB:{x:off.x, y:off.y},
    stiffness:c.dragStiff, damping:c.dragDamp, angularStiffness:c.angStiff, length:0 });
}
export function dragTick(c, eng, body, dt){
  // grip friction: heavy while the block is grinding against something,
  // light while it swings free (else the pendulum crawls near vertical)
  const f = body._touching === false ? c.holdSpinFree : c.holdSpin;
  if (f < 1) Body.setAngularVelocity(body, body.angularVelocity * f);
  step(eng, dt, c);
}
// the app's drag-target mover: window-clamped, rate-limited (a flick can't
// teleport the target — a rigid constraint would tunnel the block through a
// wall inside ONE engine step, past any velocity clamp), lead-limited (target
// never leads the anchor by more than ~a block: the pinch "slips"), and
// CONTACT-limited: the lead component pressing into anything the block touches
// is capped at pressAllow px (fingers can shove a loose block, but they slip
// rather than win a penetration fight against a braced one). While the lead is
// inside a small hold-still dead-zone the constraint runs angularStiffness 1
// (zero torque): a torqueful hold ratchets — gravity dips the block each
// frame, the anchor-side correction arrives 30% as torque, and the floor can
// push the far side back up but never pull the near side down, so a block
// held by its side "magically" rotates up with the mouse perfectly still.
export function moveDrag(c, eng, con, body, tx, ty){
  tx = Math.max(8, Math.min(W-8, tx)); ty = Math.max(8, Math.min(H-8, ty));
  const ax = body.position.x + con.pointB.x, ay = body.position.y + con.pointB.y;
  let lx = tx - ax, ly = ty - ay, touching = false;
  for (const p of eng.pairs.list){
    if (!p.isActive) continue;
    let nx0, ny0;   // unit vector pointing from the held block INTO the obstacle
    if (p.collision.parentA === body){ nx0 = -p.collision.normal.x; ny0 = -p.collision.normal.y; }
    else if (p.collision.parentB === body){ nx0 = p.collision.normal.x; ny0 = p.collision.normal.y; }
    else continue;
    touching = true;
    // depth-adaptive: permitted press shrinks by the CURRENT penetration, so
    // a braced press self-limits at ~pressAllow px instead of accumulating
    // (the position solver only corrects a fraction of overlap per frame — a
    // constant press beats it and sinks blocks visibly into each other)
    const cap = Math.max(0, c.pressAllow - (p.collision.depth || 0));
    const d = lx*nx0 + ly*ny0;
    if (d > cap){ lx -= (d - cap)*nx0; ly -= (d - cap)*ny0; }
  }
  tx = ax + lx; ty = ay + ly;
  let dx = tx - con.pointA.x, dy = ty - con.pointA.y;
  const d = Math.hypot(dx, dy);
  if (d > c.dragStep){ dx *= c.dragStep/d; dy *= c.dragStep/d; }
  let nx = con.pointA.x + dx, ny = con.pointA.y + dy;
  const glx = nx - ax, gly = ny - ay, lead = Math.hypot(glx, gly);
  if (lead > c.dragLead){ nx = ax + glx*c.dragLead/lead; ny = ay + gly*c.dragLead/lead; }
  con.pointA.x = nx; con.pointA.y = ny;
  // torque-free hold ONLY while touching (the grounded ratchet needs a
  // contact to pump against); hanging free keeps the pendulum torque so an
  // end-grabbed plank droops all the way to vertical instead of freezing
  // free-hanging: aSFree (more of the true gravity torque) so the pendulum
  // swings at a believable rate; touching: .7 while dragging, 1 (torque-free)
  // in the hold-still dead-zone — the grounded ratchet needs contact to pump
  con.angularStiffness = touching ? ((lead < c.holdDead) ? 1 : c.angStiff) : c.angStiffFree;
  body._touching = touching;
}

// grab the BOTTOM of a 2-stack and drag it away — the top must fall, not hang
export function runGrabMove(c, rng){
  const eng=makeWorld(c), world=eng.world, dt=1000/60;
  const w=1.6*U, h=1*U;
  const base = makeBody(SHAPES[1], W/2, floorY-h/2, w, h, c);
  const top  = makeBody(SHAPES[0], W/2, floorY-h*1.5, U, U, c);
  World.add(world,[base,top]);
  for (let k=0;k<90;k++) step(eng,dt,c);       // settle the stack
  // constraint-drag the base sideways and up (like carrying it out from under)
  const con = makeDrag(c, base, base.position.x, base.position.y, SHAPES[1], w, h);
  World.add(world, con);
  const tx = W/2 + 3*U;
  for (let k=0;k<70;k++){ moveDrag(c, eng, con, base, W/2 + (tx-W/2)*(k/70), con.pointA.y); dragTick(c, eng, base, dt); }
  World.remove(world, con);
  for (let k=0;k<90;k++) step(eng,dt,c);        // release, let top settle
  // the top block should have dropped to the floor (support removed), not floated
  const topRestsHigh = top.bounds.max.y < floorY - h*0.6;  // still up in the air ⇒ hung
  return topRestsHigh ? 1 : 0;
}

// grab a resting plank by its far END and lift — the classic "click far from the
// centroid" case. A good pinch lets it droop/pivot smoothly; a bad one snaps.
// Reports the worst speed right after grab (px/frame, pointer itself moves ~5),
// worst spin (rad/frame), and how far the grab point lags the pointer at the end.
export function runOffCenterGrab(c){
  const eng=makeWorld(c), world=eng.world, dt=1000/60;
  const shape=SHAPES[2], w=shape.w*U, h=shape.h*U;
  const body = makeBody(shape, W/2, floorY-h/2, w, h, c);
  World.add(world, body);
  for (let k=0;k<60;k++) step(eng,dt,c);
  const gx = body.position.x + w*0.44, gy = body.position.y;   // right end
  const con = makeDrag(c, body, gx, gy, shape, w, h);
  World.add(world, con);
  let spike=0, maxAV=0, endAngle=0, tVert=-1, overshoot=0;
  for (let k=0;k<360;k++){
    moveDrag(c, eng, con, body, con.pointA.x, k<30 ? gy - 2.4*U*((k+1)/30) : con.pointA.y);  // lift, then hold
    dragTick(c, eng, body, dt);
    spike=Math.max(spike, body.speed); maxAV=Math.max(maxAV, Math.abs(body.angularVelocity));
    const a = Math.abs(body.angle);
    if (tVert < 0 && a > 1.4) tVert = k;                      // frames to (nearly) vertical
    overshoot = Math.max(overshoot, a - Math.PI/2);           // swing past plumb
  }
  endAngle = Math.abs(body.angle);   // hanging: should settle at pi/2 (vertical)
  // where is the grab point now vs the pointer?
  const a=body.angle, cs=Math.cos(a), sn=Math.sin(a), pB=con.pointB;
  const wx=body.position.x + pB.x, wy=body.position.y + pB.y;  // Matter keeps pointB world-rotated
  const lag = Math.hypot(con.pointA.x-wx, con.pointA.y-wy);
  return { spike, maxAV, lag, endAngle, tVert, overshoot };
}

// drag a cube along the floor at pointer speed — measure jerk (frame-to-frame
// speed jumps: the "jitter while dragging along a surface" feel metric)
export function runDragSlide(c){
  const eng=makeWorld(c), world=eng.world, dt=1000/60;
  const body = makeBody(SHAPES[0], W*0.28, floorY-U/2, U, U, c);
  World.add(world, body);
  for (let k=0;k<60;k++) step(eng,dt,c);
  const gx=body.position.x - U*0.3, gy=body.position.y - U*0.3; // off-center corner grab
  const con = makeDrag(c, body, gx, gy, SHAPES[0], U, U);
  World.add(world, con);
  let jerk=0, prev=0, maxAV=0;
  for (let k=0;k<80;k++){
    moveDrag(c, eng, con, body, con.pointA.x + 5, con.pointA.y);   // steady 300 px/s drag
    dragTick(c, eng, body, dt);
    jerk=Math.max(jerk, Math.abs(body.speed-prev)); prev=body.speed;
    maxAV=Math.max(maxAV, Math.abs(body.angularVelocity));
  }
  return { jerk, maxAV };
}

// grab a block WHILE it is falling fast; a good drag zeroes its momentum and
// pulls gently — measure the worst speed spike in the frames right after grab
export function runDragJump(c, rng){
  const eng=makeWorld(c), world=eng.world, dt=1000/60;
  const body = makeBody(SHAPES[0], W/2, 40, U, U, c);
  World.add(world, body);
  for (let k=0;k<18;k++) step(eng,dt,c);          // let it build speed
  const preSpeed = body.speed;
  // grab at a corner (like the app), zero momentum, gentle spring
  const gx = body.position.x + U*0.35, gy = body.position.y + U*0.35;
  const con = makeDrag(c, body, gx, gy, SHAPES[0], U, U);
  World.add(world, con);
  let spike=0;
  for (let k=0;k<14;k++){ dragTick(c, eng, body, dt); spike=Math.max(spike, body.speed); }
  return { preSpeed, spike };
}
// grab a TILTED falling brick by its side — with pointB passed body-local (the
// old bug) the constraint anchors wrong and yanks the block sideways on grab
export function runRotatedGrab(c){
  const eng=makeWorld(c), dt=1000/60;
  const shape=SHAPES[1], w=shape.w*U, h=shape.h*U;
  const body = makeBody(shape, W/2, H*0.3, w, h, c);
  Body.setAngle(body, 0.5);
  World.add(eng.world, body);
  for (let k=0;k<6;k++) step(eng,dt,c);
  const a=body.angle, gx=body.position.x + Math.cos(a)*w*0.4, gy=body.position.y + Math.sin(a)*w*0.4;
  const con = makeDrag(c, body, gx, gy, shape, w, h);
  World.add(eng.world, con);
  let spike=0;
  for (let k=0;k<20;k++){ dragTick(c,eng,body,dt); spike=Math.max(spike,body.speed); }
  const drift = Math.hypot(body.position.x + con.pointB.x - con.pointA.x,
                           body.position.y + con.pointB.y - con.pointA.y);
  return { spike, drift };
}

// violent flick far past the window edge, release — the block must stay in the
// field (ceiling + the step() speed clamp; tunneling through a wall loses it)
export function runFling(c){
  const eng=makeWorld(c), dt=1000/60;
  const b = { body: makeBody(SHAPES[0], W/2, floorY-U/2, U, U, c) };
  World.add(eng.world, b.body);
  for (let k=0;k<30;k++) step(eng,dt,c);
  const con = makeDrag(c, b.body, b.body.position.x, b.body.position.y, SHAPES[0], U, U);
  World.add(eng.world, con);
  for (let k=0;k<6;k++){ moveDrag(c, eng, con, b.body, con.pointA.x - 260, con.pointA.y - 200); dragTick(c,eng,b.body,dt); }
  World.remove(eng.world, con);
  for (let k=0;k<420;k++) step(eng,dt,c);
  return escaped([b]);
}

// hold the drag target BELOW the floor (like the app after clamping it can't
// happen — this simulates no clamp) and measure position thrash: the fight
// between constraint and solver. The app clamps the target; this metric shows
// what the clamp is worth and guards the residual behaviour.
export function runGroundPress(c){
  const eng=makeWorld(c), dt=1000/60;
  const b = makeBody(SHAPES[0], W/2, floorY-U/2, U, U, c);
  World.add(eng.world, b);
  for (let k=0;k<30;k++) step(eng,dt,c);
  const con = makeDrag(c, b, b.position.x, b.position.y, SHAPES[0], U, U);
  World.add(eng.world, con);
  con.pointA.y = c.pressClamp ? floorY - U/2 : floorY + U;   // clamped vs demanding penetration
  let thrash=0, prevY=b.position.y;
  for (let k=0;k<60;k++){ dragTick(c,eng,b,dt); thrash=Math.max(thrash, Math.abs(b.position.y-prevY)); prevY=b.position.y; }
  return thrash;
}

// drive a held cube INTO a neighbouring cube (target kept inside the
// neighbour). Want: the neighbour gets pushed (that's a feature), without
// oscillation (osc = path minus net displacement — pure back-and-forth waste),
// a release-the-spring speed spike, or VISIBLE interpenetration. Overlap up to
// ~the chamfer radius reads as corners touching; beyond VIS_PEN px it reads as
// wood clipping through wood and counts as an error (visFrames).
// braced=true pins B against the right wall first — the worst case: B cannot
// yield, so all the press has to go somewhere.
export const VIS_PEN = 4;
export function runBlockPress(c, braced){
  const eng=makeWorld(c), dt=1000/60;
  const bx = braced ? W - 45 - U/2 - 1 : W/2;
  const A = makeBody(SHAPES[0], bx - U*1.2, floorY-U/2, U, U, c);
  const B = makeBody(SHAPES[0], bx, floorY-U/2, U, U, c);
  World.add(eng.world,[A,B]);
  for (let k=0;k<40;k++) step(eng,dt,c);
  const bx0 = B.position.x;
  const con = makeDrag(c, A, A.position.x, A.position.y, SHAPES[0], U, U);
  World.add(eng.world, con);
  let path=0, prevX=A.position.x, spike=0, overlap=0, visFrames=0, endOverlap=0;
  const x0=A.position.x, N=120;
  for (let k=0;k<N;k++){
    moveDrag(c, eng, con, A, B.position.x + U*0.2, floorY - U/2);   // chase a point inside B
    dragTick(c,eng,A,dt);
    path += Math.abs(A.position.x-prevX); prevX=A.position.x;
    spike = Math.max(spike, A.speed);
    const col = Collision.collides(A,B), d = (col && col.collided) ? col.depth : 0;
    overlap = Math.max(overlap, d);
    if (d > VIS_PEN) visFrames++;
    if (k >= N-30) endOverlap = Math.max(endOverlap, d);   // sustained (settled press)
  }
  return { osc: path - Math.abs(A.position.x-x0), spike, overlap, endOverlap, visFrames, pushed: B.position.x - bx0 };
}

// grab a wide brick's LEFT edge and hold the mouse perfectly still for 4s —
// guards the hold-still torque ratchet (block slowly rotates up on its own)
export function runHoldStill(c){
  const eng=makeWorld(c), dt=1000/60;
  const w=2*U, h=1*U;
  const b = makeBody(SHAPES[1], W/2, floorY-h/2, w, h, c);
  World.add(eng.world, b);
  for (let k=0;k<40;k++) step(eng,dt,c);
  const con = makeDrag(c, b, b.position.x - w*0.4, b.position.y, SHAPES[1], w, h);
  World.add(eng.world, con);
  let maxAng=0;
  const tx=con.pointA.x, ty=con.pointA.y;
  for (let k=0;k<240;k++){
    moveDrag(c, eng, con, b, tx, ty);
    dragTick(c,eng,b,dt);
    maxAng=Math.max(maxAng, Math.abs(b.angle));
  }
  return maxAng;
}

export function evaluate(c, n){
  const rng = mulberry32(12345);
  let maxPen=0, deep=0, floats=0, esc=0, nan=0;
  for (let i=0;i<n;i++){ const r=runScenario(c,rng); maxPen=Math.max(maxPen,r.maxPen); deep+=r.deep; floats+=r.floating; esc+=r.escaped; nan+=r.nan; }
  let hung=0; const rng2=mulberry32(999); for (let i=0;i<60;i++) hung+=runGrabMove(c,rng2);
  const rng3=mulberry32(7); let spikeMax=0; for (let i=0;i<40;i++){ const d=runDragJump(c,rng3); spikeMax=Math.max(spikeMax,d.spike); }
  const oc = runOffCenterGrab(c), sl = runDragSlide(c), rot = runRotatedGrab(c);
  return { maxPen:+maxPen.toFixed(1), deepPerScn:+(deep/n).toFixed(3), floatPerScn:+(floats/n).toFixed(3), escaped:esc, nan, hung, grabSpike:+spikeMax.toFixed(1),
    ocSpike:+oc.spike.toFixed(1), ocSpin:+oc.maxAV.toFixed(3), ocLag:+oc.lag.toFixed(1), ocEndAngle:+oc.endAngle.toFixed(2), ocTVert:oc.tVert, ocOver:+oc.overshoot.toFixed(2), slideJerk:+sl.jerk.toFixed(1), slideSpin:+sl.maxAV.toFixed(3),
    rotSpike:+rot.spike.toFixed(1), rotDrift:+rot.drift.toFixed(1), fling:runFling(c),
    towerDrift:+runTowerCreep(c).drift.toFixed(1), towerPath:+runTowerCreep(c).path.toFixed(1),
    press:(p=>({osc:+p.osc.toFixed(1),spike:+p.spike.toFixed(1),overlap:+p.overlap.toFixed(1),end:+p.endOverlap.toFixed(1),vis:p.visFrames,pushed:+p.pushed.toFixed(1)}))(runBlockPress(c, false)),
    pressBraced:(p=>({osc:+p.osc.toFixed(1),overlap:+p.overlap.toFixed(1),end:+p.endOverlap.toFixed(1),vis:p.visFrames}))(runBlockPress(c, true)),
    holdStillAng:+runHoldStill(c).toFixed(3),
    pressFree:+runGroundPress({...c, pressClamp:false}).toFixed(1), pressClamped:+runGroundPress({...c, pressClamp:true}).toFixed(1) };
}

// tuned physics: zero restitution (wood doesn't bounce → least penetration), 12
// position iterations, and a pinch-style drag: momentum zeroed on grab, a
// moderate spring at the grab point with most of its torque suppressed
// (angularStiffness) + per-frame angular damping (holdSpin), so an off-center
// grab pivots smoothly instead of snapping.
// gravity 2.2: falls ~1.5× faster (feels like wood, not balloons) with the same
// stability as 1.0 in the sweep; 3.0 blew up penetration (9.7px). angStiff .7
// keeps 30% of pivot torque — enough to droop, not enough to snap.
export const BASE = { gravity:2.2, posIter:12, velIter:8, conIter:3, slop:0.05, rest:0.0, ballRest:0.12, friction:0.6, fstat:0.85, density:0.0017, chamfer:0.06, dragStiff:0.4, dragDamp:0.15, angStiff:0.7, holdSpin:0.85,
  maxV:45, maxAV:0.5, snap:true, dragStep:40, dragLead:U,     // anti-tunnel clamps + grab snapping + drag-target limits
  settleV:0.25, settleF:0.85,                                 // near-rest damping (kills stacked-corner rocking)
  pressAllow:4, holdDead:3, holdSpinFree:0.99, angStiffFree:0 };  // free hang: FULL gravity torque, light damping                                 // contact-press cap (≈chamfer px) + hold-still dead-zone
import { fileURLToPath } from 'node:url';
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
const N = +(process.argv[2]||300);

const SWEEPS = {
  // how heavy the world feels: fall speed scales with sqrt(gravity)
  gravity: {
    'g1.0 (old)': {}, 'g1.6': { gravity:1.6 }, 'g2.2': { gravity:2.2 }, 'g3.0': { gravity:3.0 }, 'g2.2 iter16': { gravity:2.2, posIter:16 },
  },
  // the pinch-grab: angStiff kills constraint torque, holdSpin is grip friction
  drag: {
    'old (aS0 hS1)': {}, 'aS.7 hS.9': { angStiff:.7, holdSpin:.9 }, 'aS.85 hS.9': { angStiff:.85, holdSpin:.9 },
    'aS.7 hS.85 st.4': { angStiff:.7, holdSpin:.85, dragStiff:.4, dragDamp:.15 },
    'aS1 hS.9': { angStiff:1, holdSpin:.9 }, 'aS.85 hS.85 st.15': { angStiff:.85, holdSpin:.85, dragStiff:.15 },
  },
};

if (isMain) if (SWEEPS[process.argv[3]]){
  const extra = process.argv[4] ? JSON.parse(process.argv[4]) : {};   // e.g. '{"gravity":2.2}'
  console.log(`# ${N} scenarios/variant, sweep=${process.argv[3]}, extra=${JSON.stringify(extra)}\n`);
  console.log('variant            maxPen deep/scn  fl/scn esc nan hung spike | ocSpike ocSpin ocLag  jerk slSpin');
  for (const [name, ov] of Object.entries(SWEEPS[process.argv[3]])){
    const r = evaluate({ ...BASE, ...extra, ...ov }, N);
    console.log(name.padEnd(18), String(r.maxPen).padStart(6), String(r.deepPerScn).padStart(8), String(r.floatPerScn).padStart(7),
      String(r.escaped).padStart(3), String(r.nan).padStart(3), String(r.hung).padStart(4), String(r.grabSpike).padStart(5), '|',
      String(r.ocSpike).padStart(7), String(r.ocSpin).padStart(6), String(r.ocLag).padStart(5), String(r.slideJerk).padStart(5), String(r.slideSpin).padStart(6));
  }
} else {
  const extra = process.argv[3] && process.argv[3] !== 'sweep' ? JSON.parse(process.argv[3]) : {};
  console.log('config', { ...BASE, ...extra }, 'N='+N);
  console.log(evaluate({ ...BASE, ...extra }, N));
}

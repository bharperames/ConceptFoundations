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
const W = 900, H = 800, floorY = H * 0.82;
const U = 15 * Math.min(W, H) / 100;               // one cube, px
const SHAPES = [
  { key:'cube',  w:1,    h:1    },
  { key:'brick', w:2,    h:1    },
  { key:'plank', w:2.7,  h:0.62 },
  { key:'tall',  w:0.72, h:1.95 },
  { key:'tri',   w:1.45, h:1.2,  cy:0.667 },
  { key:'cyl',   w:0.92, h:1.5  },
  { key:'ball',  w:1,    h:1    },
];
function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }

function makeBody(shape, x, y, w, h, c){
  if (shape.key === 'ball') return Bodies.circle(x, y, w/2, { friction:c.friction, frictionStatic:c.fstat, restitution:c.ballRest, density:c.density, slop:c.slop });
  if (shape.key === 'tri'){
    const v = [{x:-w/2,y:h/2},{x:0,y:-h/2},{x:w/2,y:h/2}];
    return Bodies.fromVertices(x, y, [v], { friction:c.friction, frictionStatic:c.fstat, restitution:c.rest, density:c.density, slop:c.slop });
  }
  const opt = { friction:c.friction, frictionStatic:c.fstat, restitution:c.rest, density:c.density, slop:c.slop };
  if (c.chamfer > 0) opt.chamfer = { radius: Math.min(w,h)*c.chamfer };
  return Bodies.rectangle(x, y, w, h, opt);
}
function makeWorld(c){
  const eng = Engine.create({ enableSleeping:false, positionIterations:c.posIter, velocityIterations:c.velIter, constraintIterations:c.conIter });
  eng.world.gravity.y = c.gravity;
  const wall = (x,y,ww,hh) => Bodies.rectangle(x,y,ww,hh,{ isStatic:true, friction:.9, slop:c.slop });
  const statics = [ wall(W/2, floorY+400, W+600, 800), wall(-45,H/2,90,H*3), wall(W+45,H/2,90,H*3) ];
  World.add(eng.world, statics);
  eng._statics = statics;
  return eng;
}

// max block-block penetration depth + count of deep overlaps
function penetration(blocks){
  let max=0, deep=0;
  for (let i=0;i<blocks.length;i++) for (let j=i+1;j<blocks.length;j++){
    const col = Collision.collides(blocks[i].body, blocks[j].body);
    if (col && col.collided){ const d=col.depth; if(d>max)max=d; if(d>3)deep++; }
  }
  return { max, deep };
}
// a real floating error: a block at rest that touches NOTHING (no other block,
// no wall, no floor) — leaning/bridging/side-supported blocks are legitimate
function floating(blocks, statics){
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
function escaped(blocks){
  let n=0; for (const b of blocks){ const p=b.body.position;
    if (isNaN(p.x)||isNaN(p.y)||p.x<-80||p.x>W+80||p.y>H+300||p.y<-H) n++; }
  return n;
}

function runScenario(c, rng){
  const eng = makeWorld(c), world = eng.world, blocks=[], dt=1000/60;
  const N = 8 + Math.floor(rng()*7);
  for (let i=0;i<N;i++){
    const shape = SHAPES[Math.floor(rng()*SHAPES.length)];
    const w=shape.w*U, h=shape.h*U;
    const x = W*0.5 + (rng()*2-1)*U*1.5;
    const body = makeBody(shape, x, -h*0.6, w, h, c);
    Body.setAngle(body, (rng()-0.5)*0.25);
    World.add(world, body); blocks.push({ body, shape, w, h });
    for (let k=0;k<26;k++) Engine.update(eng, dt);
  }
  let maxPen=0, deep=0;
  for (let k=0;k<200;k++){
    Engine.update(eng, dt);
    if (k>140){ const p=penetration(blocks); if(p.max>maxPen)maxPen=p.max; if(p.deep>deep)deep=p.deep; }
  }
  return { maxPen, deep, floating: floating(blocks, eng._statics), escaped: escaped(blocks), nan: blocks.some(b=>isNaN(b.body.position.x)) ? 1:0, N };
}

// the app's pinch-grab: zero momentum, then a constraint at the grab point.
// angularStiffness scales DOWN the torque the constraint injects (Matter solves
// torque * (1 - angularStiffness)); holdSpin is per-frame angular damping while
// held (grip friction of the pinch) — applied by the app loop before each update
function makeDrag(c, body, gx, gy){
  Body.setVelocity(body, {x:0,y:0}); Body.setAngularVelocity(body, 0);
  const rel={x:gx-body.position.x,y:gy-body.position.y}, a=-body.angle, cs=Math.cos(a), sn=Math.sin(a);
  return Matter.Constraint.create({ pointA:{x:gx,y:gy}, bodyB:body,
    pointB:{x:rel.x*cs-rel.y*sn,y:rel.x*sn+rel.y*cs},
    stiffness:c.dragStiff, damping:c.dragDamp, angularStiffness:c.angStiff, length:0 });
}
function dragTick(c, eng, body, dt){
  if (c.holdSpin < 1) Body.setAngularVelocity(body, body.angularVelocity * c.holdSpin);
  Engine.update(eng, dt);
}

// grab the BOTTOM of a 2-stack and drag it away — the top must fall, not hang
function runGrabMove(c, rng){
  const eng=makeWorld(c), world=eng.world, dt=1000/60;
  const w=1.6*U, h=1*U;
  const base = makeBody(SHAPES[1], W/2, floorY-h/2, w, h, c);
  const top  = makeBody(SHAPES[0], W/2, floorY-h*1.5, U, U, c);
  World.add(world,[base,top]);
  for (let k=0;k<90;k++) Engine.update(eng,dt);       // settle the stack
  // constraint-drag the base sideways and up (like carrying it out from under)
  const con = makeDrag(c, base, base.position.x, base.position.y);
  World.add(world, con);
  const tx = W/2 + 3*U;
  for (let k=0;k<70;k++){ con.pointA.x = W/2 + (tx-W/2)*(k/70); dragTick(c, eng, base, dt); }
  World.remove(world, con);
  for (let k=0;k<90;k++) Engine.update(eng,dt);        // release, let top settle
  // the top block should have dropped to the floor (support removed), not floated
  const topRestsHigh = top.bounds.max.y < floorY - h*0.6;  // still up in the air ⇒ hung
  return topRestsHigh ? 1 : 0;
}

// grab a resting plank by its far END and lift — the classic "click far from the
// centroid" case. A good pinch lets it droop/pivot smoothly; a bad one snaps.
// Reports the worst speed right after grab (px/frame, pointer itself moves ~5),
// worst spin (rad/frame), and how far the grab point lags the pointer at the end.
function runOffCenterGrab(c){
  const eng=makeWorld(c), world=eng.world, dt=1000/60;
  const shape=SHAPES[2], w=shape.w*U, h=shape.h*U;
  const body = makeBody(shape, W/2, floorY-h/2, w, h, c);
  World.add(world, body);
  for (let k=0;k<60;k++) Engine.update(eng,dt);
  const gx = body.position.x + w*0.44, gy = body.position.y;   // right end
  const con = makeDrag(c, body, gx, gy);
  World.add(world, con);
  let spike=0, maxAV=0;
  for (let k=0;k<100;k++){
    if (k<30) con.pointA.y = gy - 2.4*U*((k+1)/30);             // lift ~2.4U up
    dragTick(c, eng, body, dt);
    spike=Math.max(spike, body.speed); maxAV=Math.max(maxAV, Math.abs(body.angularVelocity));
  }
  // where is the grab point now vs the pointer?
  const a=body.angle, cs=Math.cos(a), sn=Math.sin(a), pB=con.pointB;
  const wx=body.position.x + pB.x, wy=body.position.y + pB.y;  // Matter keeps pointB world-rotated
  const lag = Math.hypot(con.pointA.x-wx, con.pointA.y-wy);
  return { spike, maxAV, lag };
}

// drag a cube along the floor at pointer speed — measure jerk (frame-to-frame
// speed jumps: the "jitter while dragging along a surface" feel metric)
function runDragSlide(c){
  const eng=makeWorld(c), world=eng.world, dt=1000/60;
  const body = makeBody(SHAPES[0], W*0.28, floorY-U/2, U, U, c);
  World.add(world, body);
  for (let k=0;k<60;k++) Engine.update(eng,dt);
  const gx=body.position.x - U*0.3, gy=body.position.y - U*0.3; // off-center corner grab
  const con = makeDrag(c, body, gx, gy);
  World.add(world, con);
  let jerk=0, prev=0, maxAV=0;
  for (let k=0;k<80;k++){
    con.pointA.x += 5;                                          // steady 300 px/s drag
    dragTick(c, eng, body, dt);
    jerk=Math.max(jerk, Math.abs(body.speed-prev)); prev=body.speed;
    maxAV=Math.max(maxAV, Math.abs(body.angularVelocity));
  }
  return { jerk, maxAV };
}

// grab a block WHILE it is falling fast; a good drag zeroes its momentum and
// pulls gently — measure the worst speed spike in the frames right after grab
function runDragJump(c, rng){
  const eng=makeWorld(c), world=eng.world, dt=1000/60;
  const body = makeBody(SHAPES[0], W/2, 40, U, U, c);
  World.add(world, body);
  for (let k=0;k<18;k++) Engine.update(eng,dt);          // let it build speed
  const preSpeed = body.speed;
  // grab at a corner (like the app), zero momentum, gentle spring
  const gx = body.position.x + U*0.35, gy = body.position.y + U*0.35;
  const con = makeDrag(c, body, gx, gy);
  World.add(world, con);
  let spike=0;
  for (let k=0;k<14;k++){ dragTick(c, eng, body, dt); spike=Math.max(spike, body.speed); }
  return { preSpeed, spike };
}
function evaluate(c, n){
  const rng = mulberry32(12345);
  let maxPen=0, deep=0, floats=0, esc=0, nan=0;
  for (let i=0;i<n;i++){ const r=runScenario(c,rng); maxPen=Math.max(maxPen,r.maxPen); deep+=r.deep; floats+=r.floating; esc+=r.escaped; nan+=r.nan; }
  let hung=0; const rng2=mulberry32(999); for (let i=0;i<60;i++) hung+=runGrabMove(c,rng2);
  const rng3=mulberry32(7); let spikeMax=0; for (let i=0;i<40;i++){ const d=runDragJump(c,rng3); spikeMax=Math.max(spikeMax,d.spike); }
  const oc = runOffCenterGrab(c), sl = runDragSlide(c);
  return { maxPen:+maxPen.toFixed(1), deepPerScn:+(deep/n).toFixed(3), floatPerScn:+(floats/n).toFixed(3), escaped:esc, nan, hung, grabSpike:+spikeMax.toFixed(1),
    ocSpike:+oc.spike.toFixed(1), ocSpin:+oc.maxAV.toFixed(3), ocLag:+oc.lag.toFixed(1), slideJerk:+sl.jerk.toFixed(1), slideSpin:+sl.maxAV.toFixed(3) };
}

// tuned physics: zero restitution (wood doesn't bounce → least penetration), 12
// position iterations, and a pinch-style drag: momentum zeroed on grab, a
// moderate spring at the grab point with most of its torque suppressed
// (angularStiffness) + per-frame angular damping (holdSpin), so an off-center
// grab pivots smoothly instead of snapping.
// gravity 2.2: falls ~1.5× faster (feels like wood, not balloons) with the same
// stability as 1.0 in the sweep; 3.0 blew up penetration (9.7px). angStiff .7
// keeps 30% of pivot torque — enough to droop, not enough to snap.
const BASE = { gravity:2.2, posIter:12, velIter:8, conIter:3, slop:0.05, rest:0.0, ballRest:0.12, friction:0.6, fstat:0.85, density:0.0017, chamfer:0.06, dragStiff:0.4, dragDamp:0.15, angStiff:0.7, holdSpin:0.85 };
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

if (SWEEPS[process.argv[3]]){
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

// Gear-train kinematics — unit tests over js/games/gearworks.js (pure module,
// no DOM). These pin the real gear rules: same-module meshing, -N1/N2 speed
// ratios, direction alternation, odd-loop and motor-conflict jams, magnetic
// snapping to exact mesh distance, and tooth-phase interleave.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MODULE, TEETH, MOTOR_W, pitchR, meshes, solve, snap, phaseAlign, gearPath,
} from '../js/games/gearworks.js';

const G = (teeth, x, y, o = {}) => ({ teeth, x, y, angle: 0, motor: false, sw: 0, ...o });
const exact = (a, b) => pitchR(a.teeth) + pitchR(b.teeth);

test('same module: pitch radius is strictly proportional to tooth count', () => {
  for (const t of TEETH) assert.equal(pitchR(t), MODULE * t / 2);
});

test('two gears mesh exactly at the sum of pitch radii — and only near it', () => {
  const a = G(12, 0, 0), b = G(20, 0, 0);
  b.x = exact(a, b);
  assert.equal(meshes([a, b]).length, 1);
  b.x = exact(a, b) + MODULE;            // a whole tooth-module away — no mesh
  assert.equal(meshes([a, b]).length, 0);
});

test('mesh ratio: driven gear turns at -N1/N2 of the driver', () => {
  const m = G(12, 0, 0, { motor: true, sw: 1 });
  const g = G(24, exact(G(12,0,0), G(24,0,0)), 0);
  const { w, jam } = solve([m, g]);
  assert.equal(jam.size, 0);
  assert.ok(Math.abs(w[0] - MOTOR_W) < 1e-9);
  assert.ok(Math.abs(w[1] - (-MOTOR_W * 12/24)) < 1e-9, `w1=${w[1]}`);
});

test('chain of three: direction alternates, ratio compounds through the idler', () => {
  const a = G(12, 0, 0, { motor: true, sw: 1 });
  const b = G(16, exact(G(12,0,0), G(16,0,0)), 0);
  const c = G(8,  b.x + exact(G(16,0,0), G(8,0,0)), 0);
  const { w, jam } = solve([a, b, c]);
  assert.equal(jam.size, 0);
  assert.ok(w[0] > 0 && w[1] < 0 && w[2] > 0, 'directions must alternate');
  // idler size cancels: w2 = w0 * N0/N2
  assert.ok(Math.abs(w[2] - MOTOR_W * 12/8) < 1e-9);
});

test('reverse switch flips the whole train', () => {
  const m = G(12, 0, 0, { motor: true, sw: -1 });
  const g = G(20, exact(G(12,0,0), G(20,0,0)), 0);
  const { w } = solve([m, g]);
  assert.ok(w[0] < 0 && w[1] > 0);
});

test('off motor freewheels: unpowered component rests, no jam', () => {
  const m = G(12, 0, 0, { motor: true, sw: 0 });
  const g = G(20, exact(G(12,0,0), G(20,0,0)), 0);
  const { w, jam } = solve([m, g]);
  assert.equal(jam.size, 0);
  assert.ok(w[0] === 0 && w[1] === 0);
});

test('three gears in a triangle jam (odd loop of external meshes)', () => {
  // equilateral triangle of equal gears at exact mesh distance
  const d = exact(G(16,0,0), G(16,0,0));
  const a = G(16, 0, 0, { motor: true, sw: 1 });
  const b = G(16, d, 0);
  const c = G(16, d/2, d*Math.sqrt(3)/2);
  const { w, jam } = solve([a, b, c]);
  assert.equal(jam.size, 3, 'whole component must jam');
  assert.ok(w.every(v => v === 0), 'jammed gears do not move');
});

test('two motors: agreeing pair drives, fighting pair jams the train', () => {
  const d1216 = exact(G(12,0,0), G(16,0,0));
  const mk = swB => {
    const a = G(12, 0, 0, { motor: true, sw: 1 });
    const idler = G(16, d1216, 0);
    const b = G(12, d1216 + d1216, 0, { motor: true, sw: swB });
    return [a, idler, b];
  };
  const ok = solve(mk(1));               // same setting, even path → agrees
  assert.equal(ok.jam.size, 0);
  assert.ok(Math.abs(ok.w[2] - MOTOR_W) < 1e-9);
  const fight = solve(mk(-1));           // reversed second motor → contradiction
  assert.equal(fight.jam.size, 3);
});

test('dragged gear is out of the train (skip)', () => {
  const m = G(12, 0, 0, { motor: true, sw: 1 });
  const g = G(20, exact(G(12,0,0), G(20,0,0)), 0);
  const { w } = solve([m, g], g);
  assert.ok(Math.abs(w[0] - MOTOR_W) < 1e-9);
  assert.equal(w[1], 0);
});

test('magnetic snap: near-miss placement lands at the exact mesh distance', () => {
  const a = G(20, 300, 300);
  const g = G(12, 300 + exact(G(20,0,0), G(12,0,0)) + MODULE*1.5, 306);  // off by ~1.5 modules
  const gears = [a, g];
  assert.ok(snap(gears, 1), 'should capture within the magnet range');
  const d = Math.hypot(g.x - a.x, g.y - a.y);
  assert.ok(Math.abs(d - exact(a, g)) < 1e-6, `distance ${d} != exact mesh`);
});

test('snap between two gears meets BOTH mesh circles', async () => {
  // a 12-tooth gear can bridge two 16-tooth gears iff their spacing is under
  // twice the 16↔12 mesh distance (2·112) — use 200, drop g near the true
  // intersection point (400, 249.6) but a few px off
  const a = G(16, 300, 300);
  const b = G(16, 500, 300);
  const g = G(12, 400, 245);
  const gears = [a, b, g];
  assert.ok(snap(gears, 2));
  // contract: the anchor mesh stays EXACT; the second may float within mesh
  // tolerance (real-toy backlash) in exchange for teeth that actually
  // interleave — the planet-roll trades sub-tolerance distance for phase
  const dA = Math.hypot(g.x - a.x, g.y - a.y), dB = Math.hypot(g.x - b.x, g.y - b.y);
  const gwm = await import('../js/games/gearworks.js');
  assert.ok(Math.abs(dA - exact(a, g)) < 1e-6, `anchor dA=${dA.toFixed(2)} not exact`);
  assert.ok(Math.abs(dB - exact(b, g)) <= gwm.MESH_TOL + 1e-9, `dB=${dB.toFixed(2)} out of mesh`);
  assert.ok(gwm.phaseError(a, g) < 0.35 && gwm.phaseError(b, g) < 0.35, 'teeth do not interleave');
});

test('phase alignment interleaves teeth: φA + φB ≡ π (mod 2π)', () => {
  const a = G(20, 100, 100, { angle: 0.37 });
  const g = G(12, 0, 0, { angle: 1.1 });
  const th0 = 0.6;
  g.x = a.x + Math.cos(th0) * exact(a, g);
  g.y = a.y + Math.sin(th0) * exact(a, g);
  phaseAlign(a, g);
  const th = Math.atan2(g.y - a.y, g.x - a.x);
  const phiA = a.teeth * (th - a.angle), phiB = g.teeth * (th + Math.PI - g.angle);
  const sum = ((phiA + phiB) % (2*Math.PI) + 2*Math.PI) % (2*Math.PI);
  assert.ok(Math.abs(sum - Math.PI) < 1e-6, `φA+φB = ${sum}`);
});

test('phase stays meshed under rotation (exact ratio integration)', () => {
  const a = G(20, 100, 100), g = G(12, 0, 0);
  g.x = a.x + exact(a, g); g.y = a.y;
  phaseAlign(a, g);
  // integrate 500 steps at the mesh ratio
  const wA = 1.234, wB = -wA * a.teeth / g.teeth, dt = 1/60;
  for (let i = 0; i < 500; i++){ a.angle += wA*dt; g.angle += wB*dt; }
  const th = Math.atan2(g.y - a.y, g.x - a.x);
  const phiA = a.teeth * (th - a.angle), phiB = g.teeth * (th + Math.PI - g.angle);
  const sum = ((phiA + phiB) % (2*Math.PI) + 2*Math.PI) % (2*Math.PI);
  assert.ok(Math.abs(sum - Math.PI) < 1e-6, 'teeth drifted out of mesh');
});

test('gear outline is a valid closed path with one tooth per count', () => {
  for (const t of TEETH){
    const d = gearPath(t);
    assert.ok(d.startsWith('M') && d.endsWith('Z'));
    assert.equal((d.match(/Q/g) || []).length, t*2, 'two flanks per tooth');
  }
});

test('buried placement is illegal: between mesh and clear is not placeable', async () => {
  const gw = await import('../js/games/gearworks.js');
  const a = G(16, 300, 300);
  const g = G(16, 300 + gw.rootR(16)*2 + 4, 300);      // teeth fully buried
  assert.equal(gw.illegalOverlaps([a, g], 1).length, 1);
  assert.ok(gw.resolvePlacement([a, g], 1), 'should legalize by pushing to mesh');
  const d = Math.hypot(g.x - a.x, g.y - a.y);
  assert.ok(Math.abs(d - exact(a, g)) < 1e-6, 'resolved to exact mesh');
  // clear placement and exact mesh are both legal
  const far = G(16, 800, 300);
  assert.equal(gw.illegalOverlaps([a, far], 1).length, 0);
});

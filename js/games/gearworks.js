// Gearworks — pure kinematics for the magnetic gear wall. No DOM, no engine:
// gears stick to the board (magnets), so the physics is gear-TRAIN math, not
// rigid bodies. The rules encoded here are the real ones:
//
//  - all gears share one MODULE m (tooth pitch): pitch radius r = m·N/2.
//    Same module is THE meshing condition — any two gears mesh iff their
//    centre distance equals the sum of pitch radii.
//  - each external mesh reverses direction with speed ratio ω₂ = -ω₁·N₁/N₂.
//  - motors drive their gear at a fixed hub speed (toy motor: size-independent);
//    the tri-switch is +1 (on), 0 (off — freewheels), -1 (reverse).
//  - propagation is a BFS through the mesh graph. A contradiction — an odd
//    loop (three gears in a triangle genuinely jam) or two motors demanding
//    different speeds — jams the whole connected component.
//  - tooth PHASE must interleave to look meshed: at the contact direction θ,
//    with tooth-phases φA = N_A(θ - angA) and φB = N_B(θ+π - angB),
//    meshing requires φA + φB ≡ π (mod 2π). Exact integration preserves it.

export const MODULE = 8;                       // px of pitch diameter per tooth
export const TEETH = [8, 12, 16, 20, 24];      // ratios 1:1 up to 3:1
export const MOTOR_TEETH = 12;
export const MOTOR_W = 1.6;                    // rad/s at the motor hub
export const MESH_TOL = MODULE * 0.28;         // |d - (r1+r2)| within this = meshed
export const SNAP_DIST = MODULE * 2.4;         // magnet capture range for snapping

export const pitchR = teeth => MODULE * teeth / 2;
export const outerR = teeth => pitchR(teeth) + MODULE * 0.95;   // addendum ≈ 1m
export const rootR  = teeth => pitchR(teeth) - MODULE * 1.05;   // dedendum ≈ 1.05m

export function meshes(gears, skip){
  const out = [];
  for (let i = 0; i < gears.length; i++){
    if (gears[i] === skip) continue;
    for (let j = i+1; j < gears.length; j++){
      if (gears[j] === skip) continue;
      const a = gears[i], b = gears[j];
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      if (Math.abs(d - (pitchR(a.teeth) + pitchR(b.teeth))) <= MESH_TOL) out.push([i, j]);
    }
  }
  return out;
}

// per-gear angular velocity + the set of jammed gears. `skip` (a gear object)
// is excluded — the gear currently being dragged is out of the train.
export function solve(gears, skip){
  const n = gears.length;
  const w = new Array(n).fill(null), jam = new Set();
  const adj = Array.from({length: n}, () => []);
  for (const [i, j] of meshes(gears, skip)){ adj[i].push(j); adj[j].push(i); }
  const comp = new Array(n).fill(-1);
  let nc = 0;
  for (let s = 0; s < n; s++){
    if (comp[s] !== -1 || gears[s] === skip) continue;
    const members = [s]; comp[s] = nc;
    for (let q = 0; q < members.length; q++)
      for (const t of adj[members[q]]) if (comp[t] === -1){ comp[t] = nc; members.push(t); }
    // seed from the first switched-on motor in the component
    const motors = members.filter(i => gears[i].motor && gears[i].sw);
    if (!motors.length){ for (const i of members) w[i] = 0; nc++; continue; }
    const seed = motors[0];
    w[seed] = gears[seed].sw * MOTOR_W;
    const queue = [seed];
    let jammed = false;
    for (let q = 0; q < queue.length && !jammed; q++){
      const i = queue[q];
      for (const j of adj[i]){
        const want = -w[i] * gears[i].teeth / gears[j].teeth;
        if (w[j] === null){ w[j] = want; queue.push(j); }
        else if (Math.abs(w[j] - want) > 1e-9) jammed = true;   // loop contradiction
      }
    }
    // every other switched-on motor must agree with what the train demands
    for (const mIdx of motors)
      if (w[mIdx] !== null && Math.abs(w[mIdx] - gears[mIdx].sw * MOTOR_W) > 1e-9) jammed = true;
    if (jammed) for (const i of members){ w[i] = 0; jam.add(i); }
    else for (const i of members) if (w[i] === null) w[i] = 0;
    nc++;
  }
  for (let i = 0; i < n; i++) if (w[i] === null) w[i] = 0;
  return { w, jam };
}

// set gear g's angle so its teeth interleave with fixed neighbour a:
// φA + φB ≡ π (mod 2π), choosing the solution nearest g's current angle
export function phaseAlign(a, g){
  const th = Math.atan2(g.y - a.y, g.x - a.x);
  const phiA = a.teeth * (th - a.angle);
  // need: g.teeth * (th + π - g.angle) ≡ π - φA  (mod 2π)
  const target = (th + Math.PI) - (Math.PI - phiA) / g.teeth;
  const step = 2 * Math.PI / g.teeth;
  g.angle = target - Math.round((target - g.angle) / step) * step;
}

// light magnetic snap for gear i: pull the centre distance to EXACTLY r_i+r_j
// for the nearest in-range neighbour (two neighbours → circle-circle
// intersection so both mesh), then phase-align. Returns true if snapped.
export function snap(gears, i){
  const g = gears[i];
  const cands = [];
  for (let j = 0; j < gears.length; j++){
    if (j === i) continue;
    const o = gears[j];
    const d = Math.hypot(o.x - g.x, o.y - g.y);
    const ideal = pitchR(g.teeth) + pitchR(o.teeth);
    const err = Math.abs(d - ideal);
    if (err <= SNAP_DIST) cands.push({ j, d, ideal, err });
  }
  if (!cands.length) return false;
  cands.sort((p, q) => p.err - q.err);
  const A = gears[cands[0].j];
  if (cands.length >= 2){
    // meet BOTH: intersect circles (centre A, rA+rG) and (centre B, rB+rG)
    const B = gears[cands[1].j];
    const rA = cands[0].ideal, rB = cands[1].ideal;
    const dx = B.x - A.x, dy = B.y - A.y, D = Math.hypot(dx, dy);
    if (D > 1e-6 && D < rA + rB && D > Math.abs(rA - rB)){
      const a = (rA*rA - rB*rB + D*D) / (2*D);
      const h = Math.sqrt(Math.max(0, rA*rA - a*a));
      const mx = A.x + a*dx/D, my = A.y + a*dy/D;
      const p1 = { x: mx + h*dy/D, y: my - h*dx/D }, p2 = { x: mx - h*dy/D, y: my + h*dx/D };
      const pick = (Math.hypot(p1.x-g.x, p1.y-g.y) <= Math.hypot(p2.x-g.x, p2.y-g.y)) ? p1 : p2;
      if (Math.hypot(pick.x - g.x, pick.y - g.y) <= SNAP_DIST * 2){
        g.x = pick.x; g.y = pick.y;
        phaseAlign(A, g);
        return true;
      }
    }
  }
  // single neighbour: slide along the centre line to the exact mesh distance
  const th = Math.atan2(g.y - A.y, g.x - A.x);
  g.x = A.x + Math.cos(th) * cands[0].ideal;
  g.y = A.y + Math.sin(th) * cands[0].ideal;
  phaseAlign(A, g);
  return true;
}

// toy-plastic gear outline: rounded trapezoid teeth around the root circle
export function gearPath(teeth){
  const r = pitchR(teeth), ro = outerR(teeth), rr = rootR(teeth);
  const P = 2 * Math.PI / teeth;              // angular pitch
  const tipW = P * 0.24, rootShoulder = P * 0.34;   // half-widths
  const pt = (rad, ang) => `${(rad*Math.cos(ang)).toFixed(1)} ${(rad*Math.sin(ang)).toFixed(1)}`;
  let d = '';
  for (let k = 0; k < teeth; k++){
    const c = k * P;                          // tooth centre angle
    const a0 = c - rootShoulder, a1 = c - tipW, a2 = c + tipW, a3 = c + rootShoulder;
    d += (k ? 'L' : 'M') + pt(rr, a0);
    d += ` Q ${pt(r, (a0+a1)/2)} ${pt(ro, a1)}`;      // flank up
    d += ` A ${ro.toFixed(1)} ${ro.toFixed(1)} 0 0 1 ${pt(ro, a2)}`;   // tip arc
    d += ` Q ${pt(r, (a2+a3)/2)} ${pt(rr, a3)}`;      // flank down
    const nb = (k+1) * P - rootShoulder;
    d += ` A ${rr.toFixed(1)} ${rr.toFixed(1)} 0 0 1 ${pt(rr, nb)}`;   // root arc
  }
  return d + ' Z';
}

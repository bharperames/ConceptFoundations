import { Audio2 } from '../audio.js';
import { $ } from '../core.js';
import { FX } from '../fx.js';
import { showView } from '../router.js';

/* ═══════════════ Train Set (BRIO-style wooden railway) ═══════════════
   The gear wall's ideas, re-aimed at track: a picker of pieces, drag one out,
   and every open track end the piece could mate with pulses; drop to snap.
   Pieces are a graph of endpoints (position + outward angle); a snap DERIVES
   the piece's transform from the mate, so nothing ever drifts. A little
   steam engine (the gear game's engine, now with wheels) runs the network:
   switches route it, the coal hopper fills its tender, the water tower
   swings its spout out, stations pause it. Unwanted pieces go in the toybox.

   BRIO geometry: 45° curves, radius chosen so a curve's chord equals a
   straight — every classic layout (ovals, figure-eights) closes exactly. */

const TAU = Math.PI * 2;
const wrap = a => ((a % TAU) + TAU + Math.PI) % TAU - Math.PI;
// virtual track can be flipped over: when snapping, a piece's mirror twin is
// always considered too, and the drop commits whichever chirality fits
const MIRROR = { swl: 'swr', swr: 'swl' };

const TrainGame = {
  S: 0, R: 0, TW: 0,               // straight length, curve radius, track width
  SQ: 0.62,                        // isometric squash: the table seen from ~45°
  cam: { zoom: 1, x: 0, y: 0 },    // auto-fit camera: floor → screen is SQ·(zoom·p + pan)
  pieces: [], seq: 0, active: false, bound: false,
  drag: null, touch: null, raf: 0, last: 0,
  trains: [], activeT: null,
  markers: [], W: 0, H: 0,
  area(){ return $('#train-area'); },
  // single-train era accessors — proxy the first train
  get eng(){ const t = this.trains[0]; return t ? t.cars[0] : null; },
  get ten(){ const t = this.trains[0]; return t ? t.cars[1] : null; },
  get cars(){ const t = this.trains[0]; return t ? t.cars : []; },
  get running(){ const t = this.trains[0]; return !!t && t.running; },
  set running(v){ const t = this.trains[0]; if (t) t.running = v; },
  get stuck(){ const t = this.trains[0]; return !!t && t.stuck; },
  set stuck(v){ const t = this.trains[0]; if (t) t.stuck = v; },
  get coal(){ const t = this.trains[0]; return t ? t.coal : 0; },
  set coal(v){ const t = this.trains[0]; if (t) t.coal = v; },
  get boostUntil(){ const t = this.trains[0]; return t ? t.boostUntil : 0; },
  set boostUntil(v){ const t = this.trains[0]; if (t) t.boostUntil = v; },
  get pausedUntil(){ const t = this.trains[0]; return t ? t.pausedUntil : 0; },
  set pausedUntil(v){ const t = this.trains[0]; if (t) t.pausedUntil = v; },
  // everything in the game lives on the FLOOR (flat 2D coords); this wrapper
  // is scaleY-squashed so the whole table tilts into isometric view at once
  world(){ return $('#trn-world') || this.area(); },
  toFloor(e){
    const r = this.area().getBoundingClientRect(), c = this.cam;
    return {
      x: (e.clientX - r.left - c.x) / c.zoom,
      y: ((e.clientY - r.top) / this.SQ - c.y) / c.zoom,
    };
  },
  toScreen(x, y){
    const r = this.area().getBoundingClientRect(), c = this.cam;
    return { x: r.left + x * c.zoom + c.x, y: r.top + (y * c.zoom + c.y) * this.SQ };
  },
  applyCam(){
    const w = this.world();
    if (w && w.id === 'trn-world')
      w.style.transform = `scaleY(${this.SQ}) translate(${this.cam.x.toFixed(1)}px, ${this.cam.y.toFixed(1)}px) scale(${this.cam.zoom.toFixed(4)})`;
  },
  // zoom the whole tabletop out (never in past 1:1) so the layout fits — big
  // fixed loops shouldn't run off the screen
  fitView(){
    const r = this.area().getBoundingClientRect();
    if (!this.pieces.length){ this.cam = { zoom: 1, x: 0, y: 0 }; this.applyCam(); return; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of this.pieces){
      x0 = Math.min(x0, p.x - this.S); x1 = Math.max(x1, p.x + this.S);
      y0 = Math.min(y0, p.y - this.S); y1 = Math.max(y1, p.y + this.S);
    }
    const ops = $('#trn-ops').getBoundingClientRect();
    const topPad = Math.max(0, (ops.bottom - r.top)) / this.SQ + this.S * 0.2;
    const availW = r.width - 24, availH = r.height / this.SQ - topPad - this.S * 0.2;
    const zoom = Math.max(0.3, Math.min(1, availW / (x1 - x0), availH / (y1 - y0)));
    this.cam = {
      zoom,
      x: (r.width - (x0 + x1) * zoom) / 2,
      y: topPad + (availH - (y1 - y0) * zoom) / 2 - y0 * zoom,
    };
    this.applyCam();
  },
  needFit(){
    const r = this.area().getBoundingClientRect(), c = this.cam;
    const vx0 = (0 - c.x) / c.zoom, vx1 = (r.width - c.x) / c.zoom;
    const vy0 = (0 - c.y) / c.zoom, vy1 = (r.height / this.SQ - c.y) / c.zoom;
    let out = false, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of this.pieces){
      if (p.x < vx0 + this.S * 0.4 || p.x > vx1 - this.S * 0.4
        || p.y < vy0 + this.S * 0.4 || p.y > vy1 - this.S * 0.4) out = true;
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    }
    if (out) return true;
    // zoomed out but the layout shrank: ease back in
    if (c.zoom < 1 && (x1 - x0) < (vx1 - vx0) * 0.55 && (y1 - y0) < (vy1 - vy0) * 0.55) return true;
    return false;
  },
  refit(){
    if (this._sim || this.drag || this.trainDrag) return;
    if (this.needFit()) this.fitView();
  },

  /* ── piece definitions ─────────────────────────────────────────────────── */
  buildDefs(){
    const S = this.S, R = this.R, PHI = Math.PI / 8;   // 22.5°
    const arc = (cx, cy, r, a0, a1, n = 20) => Array.from({ length: n + 1 }, (_, i) => {
      const t = a0 + (a1 - a0) * i / n;
      return [cx + r * Math.sin(t), cy - r * Math.cos(t)];
    });
    // straights are sampled densely too — the hit test and follower both
    // walk polyline points, not segments
    const line = (x0, y0, x1, y1, n = 8) => Array.from({ length: n + 1 }, (_, i) =>
      [x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n]);
    const D = {};
    // plain straight — and its dressed-up cousins (same geometry, extra life)
    for (const key of ['straight', 'station', 'coal', 'water']){
      D[key] = {
        key,
        ends: [{ x: -S/2, y: 0, a: Math.PI }, { x: S/2, y: 0, a: 0 }],
        routes: [{ a: 0, b: 1, pts: line(-S/2, 0, S/2, 0) }],
      };
    }
    // 45° curve at the true A1 radius: the ends sit exactly where the arc
    // lands (chord = 2R·sin 22.5° ≈ 1.074S), tangents ±22.5°. Declaring the
    // chord as S while drawing the R arc made every curve RENDER ~5px past
    // its logical joint — the little steps at curve joints.
    const c1 = R * Math.sin(PHI);
    D.curve = {
      key: 'curve',
      ends: [{ x: -c1, y: 0, a: Math.PI - PHI }, { x: c1, y: 0, a: PHI }],
      routes: [{ a: 0, b: 1, pts: arc(0, R * Math.cos(PHI), R, -PHI, PHI) }],
    };
    // E1 tight curve: same 45°, centreline radius (90 inner + 20) = 110mm
    const R2 = S * (110 / 144), c2 = R2 * Math.sin(PHI);
    D.curveS = {
      key: 'curveS',
      ends: [{ x: -c2, y: 0, a: Math.PI - PHI }, { x: c2, y: 0, a: PHI }],
      routes: [{ a: 0, b: 1, pts: arc(0, R2 * Math.cos(PHI), R2, -PHI, PHI) }],
    };
    // switches: a straight with a 45° branch peeling off the west end.
    // sw=0 routes the common end straight through, sw=1 takes the branch.
    for (const [key, m] of [['swl', -1], ['swr', 1]]){
      // branch: 45° arc leaving the west end heading east, peeling to one side
      // (swr center sits at (−S/2, R): t=0 IS the west end, tangent +x)
      const br = m > 0
        ? arc(-S/2, R, R, 0, Math.PI / 4)
        : arc(-S/2, -R, R, Math.PI, Math.PI * 0.75);
      const bx = br[br.length - 1];
      D[key] = {
        key,
        ends: [
          { x: -S/2, y: 0, a: Math.PI }, { x: S/2, y: 0, a: 0 },
          { x: bx[0], y: bx[1], a: m * Math.PI / 4 },
        ],
        routes: [
          { a: 0, b: 1, pts: line(-S/2, 0, S/2, 0) },
          { a: 0, b: 2, pts: br },
        ],
      };
    }
    // level crossing H: two A1-length (108mm) arms crossing — ¾ of a straight
    const HX = S * (54 / 144);
    D.cross = {
      key: 'cross',
      ends: [
        { x: -HX, y: 0, a: Math.PI }, { x: HX, y: 0, a: 0 },
        { x: 0, y: -HX, a: -Math.PI/2 }, { x: 0, y: HX, a: Math.PI/2 },
      ],
      routes: [
        { a: 0, b: 1, pts: line(-HX, 0, HX, 0) },
        { a: 2, b: 3, pts: line(0, -HX, 0, HX) },
      ],
    };
    // buffer stop R/S: a 40mm stub ending in the stop block (b:-1 = bounce)
    const BL = S * (40 / 144);
    D.buffer = {
      key: 'buffer',
      ends: [{ x: -BL / 2, y: 0, a: Math.PI }],
      routes: [{ a: 0, b: -1, pts: line(-BL / 2, 0, BL / 2, 0) }],
    };
    // arc-length tables for the follower
    for (const key in D) for (const rt of D[key].routes){
      rt.cum = [0];
      for (let i = 1; i < rt.pts.length; i++)
        rt.cum.push(rt.cum[i-1] + Math.hypot(rt.pts[i][0]-rt.pts[i-1][0], rt.pts[i][1]-rt.pts[i-1][1]));
      rt.len = rt.cum[rt.cum.length - 1];
    }
    this.DEFS = D;
  },

  /* ── transforms & the endpoint graph ───────────────────────────────────── */
  toWorld(p, x, y){
    const c = Math.cos(p.rot), s = Math.sin(p.rot);
    return { x: p.x + x*c - y*s, y: p.y + x*s + y*c };
  },
  endWorld(p, i){
    const e = p.def.ends[i], w = this.toWorld(p, e.x, e.y);
    return { x: w.x, y: w.y, a: wrap(e.a + p.rot), p, i };
  },
  openEnds(skip){
    const out = [];
    for (const p of this.pieces){
      if (p === skip) continue;
      for (let i = 0; i < p.def.ends.length; i++)
        if (!p.conn[i]) out.push(this.endWorld(p, i));
    }
    return out;
  },
  // the transform that mates the dragged piece's end k onto open world end E
  mateTransform(def, k, E){
    const rot = wrap(E.a + Math.PI - def.ends[k].a);
    const c = Math.cos(rot), s = Math.sin(rot), e = def.ends[k];
    return { rot, x: E.x - (e.x*c - e.y*s), y: E.y - (e.x*s + e.y*c) };
  },
  // MAGIC FLEX: after rigidly mating end k at E, if the piece's far end lands
  // NEAR another open end, bend the piece (cubic spline) so it lands exactly —
  // virtual wooden track that stretches just enough to close the gap
  bridgeDef(def, k, t, E){
    if (!['straight', 'curve', 'curveS'].includes(def.key) || def.ends.length !== 2) return null;
    const j = 1 - k, fake = { x: t.x, y: t.y, rot: t.rot };
    const w = this.toWorld(fake, def.ends[j].x, def.ends[j].y);
    const wa = wrap(def.ends[j].a + t.rot);
    let best = null;
    for (const B of this.openEnds(this._bridgeSkip)){
      if (B.p === E.p && B.i === E.i) continue;
      const dist = Math.hypot(B.x - w.x, B.y - w.y);
      if (dist < 4) return null;   // already exact — closureScan will stitch it
      const aerr = Math.abs(wrap(B.a - wa - Math.PI));
      if (dist < this.S * 0.6 && aerr < 0.8 && (!best || dist < best.dist)) best = { B, dist };
    }
    if (!best) return null;
    const B = best.B;
    const c = Math.cos(-t.rot), s = Math.sin(-t.rot);
    const lx = (B.x - t.x) * c - (B.y - t.y) * s, ly = (B.x - t.x) * s + (B.y - t.y) * c;
    const la = wrap(B.a + Math.PI - t.rot);        // far end's bent outward angle
    const bent = this.bendRoute(def, k, { x: lx, y: ly, a: la });
    return bent ? { def: bent, B, farEnd: j } : null;
  },
  // build a bent (flex) variant of a two-ended piece: anchored at end kFrom,
  // its far end relocated to `to` (piece-local pos + outward angle). Returns
  // null rather than ever producing a folded curve — a cusp in the polyline
  // makes the train judder and the wood render with spikes.
  bendRoute(def, kFrom, to){
    const j = 1 - kFrom, p0 = def.ends[kFrom], a0 = p0.a + Math.PI;
    const chord = Math.hypot(to.x - p0.x, to.y - p0.y);
    if (chord < this.S * 0.25 || chord > this.S * 1.8) return null;
    const h = chord * 0.3;
    // control points sit INSIDE the curve: ahead of the anchored end along its
    // travel direction, and BEHIND the target along its outward tangent (the
    // old + sign here overshot the joint — the source of the cusp spikes)
    const P = [
      [p0.x, p0.y],
      [p0.x + Math.cos(a0) * h, p0.y + Math.sin(a0) * h],
      [to.x - Math.cos(to.a) * h, to.y - Math.sin(to.a) * h],
      [to.x, to.y],
    ];
    const pts = Array.from({ length: 25 }, (_, i) => {
      const u = i / 24, v = 1 - u;
      return [
        v*v*v*P[0][0] + 3*v*v*u*P[1][0] + 3*v*u*u*P[2][0] + u*u*u*P[3][0],
        v*v*v*P[0][1] + 3*v*v*u*P[1][1] + 3*v*u*u*P[2][1] + u*u*u*P[3][1],
      ];
    });
    // reject folds: every step must keep heading roughly forward, and the
    // curve must not wander far beyond its chord
    let len = 0;
    for (let i = 2; i < pts.length; i++){
      const ax = pts[i-1][0] - pts[i-2][0], ay = pts[i-1][1] - pts[i-2][1];
      const bx = pts[i][0] - pts[i-1][0], by = pts[i][1] - pts[i-1][1];
      const dot = (ax * bx + ay * by) / ((Math.hypot(ax, ay) * Math.hypot(bx, by)) || 1);
      if (dot < 0.35) return null;
    }
    for (let i = 1; i < pts.length; i++)
      len += Math.hypot(pts[i][0]-pts[i-1][0], pts[i][1]-pts[i-1][1]);
    if (len > chord * 1.45) return null;
    if (kFrom === 1) pts.reverse();                // routes always run end0 → end1
    const rt = { a: 0, b: 1, pts, cum: [0] };
    for (let i = 1; i < pts.length; i++)
      rt.cum.push(rt.cum[i-1] + Math.hypot(pts[i][0]-pts[i-1][0], pts[i][1]-pts[i-1][1]));
    rt.len = rt.cum[rt.cum.length - 1];
    const ends = def.ends.map((e, i) => i === j ? { x: to.x, y: to.y, a: to.a } : { ...e });
    return { key: def.key, ends, routes: [rt], bridged: true };
  },
  connect(p1, e1, p2, e2){
    p1.conn[e1] = { p: p2.id, e: e2 };
    p2.conn[e2] = { p: p1.id, e: e1 };
  },
  disconnect(p){
    for (const i in p.conn){
      const c = p.conn[i], o = this.byId(c.p);
      if (o) delete o.conn[c.e];
    }
    p.conn = {};
  },
  byId(id){ return this.pieces.find(p => p.id === id); },
  componentSet(p){
    const seen = new Set([p.id]), stack = [p];
    while (stack.length){
      const q = stack.pop();
      for (const i in q.conn){
        const o = this.byId(q.conn[i].p);
        if (o && !seen.has(o.id)){ seen.add(o.id); stack.push(o); }
      }
    }
    return seen;
  },
  /* ── MAGIC FIX: close the layout with REAL pieces ────────────────────────
     A lattice A* plans a chain of standard pieces (straight / curve / tight
     curve) from one open end to another. Islands are first snap-rotated
     (≤22.5°, about their own connector) onto the track lattice and finally
     translated a hair so the joint lands exact — so gaps get filled with
     honest wood and nothing bends. Repeats until nothing more can be fixed. */
  latticeMoves(){
    const out = [];
    for (const [key, ks] of [['straight', [0]], ['curve', [0, 1]], ['curveS', [0, 1]]])
      for (const k of ks){
        const def = this.DEFS[key];
        const t = this.mateTransform(def, k, { x: 0, y: 0, a: 0 });
        const o = def.ends[1 - k];
        const c = Math.cos(t.rot), s = Math.sin(t.rot);
        const ex = t.x + o.x * c - o.y * s, ey = t.y + o.x * s + o.y * c;
        out.push({ key, k, chord: Math.hypot(ex, ey), ca: Math.atan2(ey, ex), turn: wrap(o.a + t.rot) });
      }
    return out;
  },
  // spatial hash of existing track samples, so gap-filling can steer around
  // wood that is already on the floor (joint zones excluded)
  buildObstacleGrid(exclude){
    const cell = this.S * 0.5, grid = new Map();
    for (const o of this.pieces)
      for (const rt of o.def.routes)
        for (let i = 0; i < rt.pts.length; i += 2){
          const w = this.toWorld(o, rt.pts[i][0], rt.pts[i][1]);
          if (exclude.some(e => Math.hypot(w.x - e.x, w.y - e.y) < this.S * 0.42)) continue;
          const k = Math.floor(w.x / cell) + ':' + Math.floor(w.y / cell);
          let a = grid.get(k);
          if (!a) grid.set(k, a = []);
          a.push([w.x, w.y]);
        }
    grid.cell = cell;
    return grid;
  },
  hitsObstacle(grid, x, y, lim){
    const cell = grid.cell, cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++){
      const a = grid.get((cx + dx) + ':' + (cy + dy));
      if (a) for (const [px, py] of a) if (Math.hypot(x - px, y - py) < lim) return true;
    }
    return false;
  },
  // A*: chain pieces leaving A so the far connector arrives at B, opposing it.
  // Only works when the heading mismatch sits on the 45° lattice (the caller
  // rotates islands to guarantee that); positions may miss by up to posTol.
  solveGap(A, B, posTol, maxPieces = 8, collect = false, avoid = false){
    const S = this.S, PHI = Math.PI / 8;
    const goalA = wrap(B.a + Math.PI);
    // pieces needed scale with the gap: cap the search so hopeless pairs
    // fail fast instead of grinding the whole node budget
    const d00 = Math.hypot(B.x - A.x, B.y - A.y);
    maxPieces = Math.max(5, Math.min(maxPieces, Math.ceil(d00 / (S * 0.58)) + 4));
    if (Math.abs(wrap(Math.round(wrap(goalA - A.a) / (PHI * 2)) * PHI * 2 - wrap(goalA - A.a))) > 0.02) return null;
    const moves = this.latticeMoves();
    const q = Math.max(6, S * 0.07);
    const hkey = (x, y, n) => (Math.round(x / q)) + ':' + (Math.round(y / q)) + ':' + (((n % 16) + 16) % 16);
    const grid = avoid ? this.buildObstacleGrid([A, B]) : null;
    const lim = this.TW * 0.7;
    const queue = [{ x: A.x, y: A.y, a: A.a, n: 0, g: 0, steps: [] }];
    const seen = new Map();
    let best = null, nodes = 0;
    const hits = [];
    const cap = collect ? 8000 : 5000;
    while (queue.length && ++nodes < cap){
      let bi = 0, bf = Infinity;
      for (let i = 0; i < queue.length; i++){
        const s = queue[i];
        const f = s.g + Math.hypot(B.x - s.x, B.y - s.y) / S * 1.05;
        if (f < bf){ bf = f; bi = i; }
      }
      const s = queue.splice(bi, 1)[0];
      const dg = Math.hypot(B.x - s.x, B.y - s.y);
      if (s.steps.length && dg <= posTol && Math.abs(wrap(s.a - goalA)) < 0.02){
        if (collect && hits.length < 110) hits.push({ steps: s.steps, d: dg });
        if (!best || dg < best.d) best = { steps: s.steps, d: dg };
        if (dg < 2 && (!collect || hits.length > 60)) break;
      }
      if (s.steps.length >= maxPieces) continue;
      // reachability prune: not enough pieces left to span the distance
      if (dg > (maxPieces - s.steps.length) * S * 1.1 + posTol) continue;
      for (const m of moves){
        const nx = s.x + m.chord * Math.cos(s.a + m.ca);
        const ny = s.y + m.chord * Math.sin(s.a + m.ca);
        const na = wrap(s.a + m.turn), nn = s.n + Math.round(m.turn / (PHI * 2));
        const ng = s.g + 1;
        const kk = hkey(nx, ny, nn);
        if (seen.has(kk) && seen.get(kk) <= ng) continue;
        if (grid && (this.hitsObstacle(grid, (s.x + nx) / 2, (s.y + ny) / 2, lim)
          || this.hitsObstacle(grid, nx, ny, lim))) continue;
        seen.set(kk, ng);
        queue.push({ x: nx, y: ny, a: na, n: nn, g: ng, steps: s.steps.concat(m) });
      }
    }
    return best ? { ...best, hits } : null;
  },
  pathEnd(A, steps){
    let x = A.x, y = A.y, a = A.a;
    for (const m of steps){
      x += m.chord * Math.cos(a + m.ca);
      y += m.chord * Math.sin(a + m.ca);
      a = wrap(a + m.turn);
    }
    return { x, y, a };
  },
  realizePath(E, steps){
    let cur = E;
    for (const m of steps){
      const def = this.DEFS[m.key];
      const t = this.mateTransform(def, m.k, cur);
      const p = this.addPiece(m.key, t.x, t.y, t.rot);
      p.el.classList.add('trn-fly');
      setTimeout(() => p.el.classList.remove('trn-fly'), 460);
      this.connect(cur.p, cur.i, p, m.k);
      cur = this.endWorld(p, 1 - m.k);
    }
    return cur;
  },
  rotateComponent(ids, cx, cy, by){
    const cs = Math.cos(by), sn = Math.sin(by);
    for (const pid of ids){
      const p = this.byId(pid);
      const rx = p.x - cx, ry = p.y - cy;
      p.x = cx + rx * cs - ry * sn;
      p.y = cy + rx * sn + ry * cs;
      p.rot = wrap(p.rot + by);
    }
  },
  translateComponent(ids, dx, dy){
    for (const pid of ids){
      const p = this.byId(pid);
      p.x += dx; p.y += dy;
    }
  },
  animateComponent(ids){
    for (const pid of ids){
      const p = this.byId(pid);
      p.el.classList.add('trn-fly');
      setTimeout(() => p.el.classList.remove('trn-fly'), 460);
    }
  },
  // overlap audit: piece pairs whose interior samples sit on top of each
  // other (joint zones excluded by sampling away from the ends)
  quickOverlaps(){
    let v = 0;
    const lim = this.TW * 0.55;
    for (let i = 0; i < this.pieces.length; i++) for (let j = i + 1; j < this.pieces.length; j++){
      const a = this.pieces[i], b = this.pieces[j];
      if (Math.hypot(a.x - b.x, a.y - b.y) > this.S * 2.4) continue;
      let close = 0;
      for (const rt of a.def.routes) for (let u = 2; u < rt.pts.length - 2; u += 3){
        const w = this.toWorld(a, rt.pts[u][0], rt.pts[u][1]);
        for (const rt2 of b.def.routes) for (let q = 2; q < rt2.pts.length - 2; q += 3){
          const w2 = this.toWorld(b, rt2.pts[q][0], rt2.pts[q][1]);
          if (Math.hypot(w.x - w2.x, w.y - w2.y) < lim) close++;
        }
      }
      if (close > 2) v++;
    }
    return v;
  },
  snapshotFix(){
    return {
      list: [...this.pieces],
      state: this.pieces.map(p => ({ p, x: p.x, y: p.y, rot: p.rot, def: p.def, conn: { ...p.conn } })),
    };
  },
  restoreFix(s){
    for (const p of this.pieces) if (!s.list.includes(p)){
      p.el.remove();
      if (p.over) p.over.remove();
      if (p.slab) p.slab.remove();
    }
    this.pieces = s.list;
    for (const st of s.state){
      st.p.x = st.x; st.p.y = st.y; st.p.rot = st.rot; st.p.def = st.def;
      st.p.conn = { ...st.conn };
    }
  },
  fixLayout(){
    let fixed = 0, guard = 0;
    const tried = new Set();
    const deadline = performance.now() + (this._sim ? 2500 : 1800);
    while (guard++ < 40 && performance.now() < deadline){
      this.closureScan();
      const open = this.openEnds();
      if (open.length < 2) break;
      const pairs = [];
      for (let i = 0; i < open.length; i++) for (let j = i + 1; j < open.length; j++){
        const d = Math.hypot(open[i].x - open[j].x, open[i].y - open[j].y);
        if (d < this.S * 8) pairs.push({ A: open[i], B: open[j], d });
      }
      pairs.sort((a, b) => a.d - b.d);
      let done = false;
      for (const pr of pairs){
        const id = [pr.A.p.id, pr.A.i, pr.B.p.id, pr.B.i].join('.');
        if (tried.has(id)) continue;
        // any fix that would lay track across track is rolled back wholesale
        const snap = this.snapshotFix();
        const ov0 = this.quickOverlaps();
        if (this.fixPair(pr.A, pr.B)){
          if (this.quickOverlaps() > ov0){
            this.restoreFix(snap);
            tried.add(id);
            continue;
          }
          fixed++; done = true; break;
        }
        tried.add(id);
      }
      if (!done) break;
    }
    if (fixed){
      this.closureScan();
      this.healJoints();
      this.repaintAll();
      this.ensureTrain();
      if (this.eng) this.placeTrain();
      if (!this._sim){
        Audio2.fanfare();
        const r = this.area().getBoundingClientRect();
        FX.burst(r.left + this.W / 2, r.top + r.height / 2, ['#F0B429', '#EBDCBC', '#fff']);
      }
    }
    return fixed;
  },
  fixPair(A, B){
    const compA = this.componentSet(A.p);
    if (!compA.has(B.p.id)){
      // separate islands: align the smaller one to the lattice, plan a fill
      const compB = this.componentSet(B.p);
      const [M, F, ids] = compB.size <= compA.size ? [B, A, compB] : [A, B, compA];
      const dock = () => {
        const M1 = this.endWorld(M.p, M.i), F1 = this.endWorld(F.p, F.i);
        this.rotateComponent(ids, M1.x, M1.y, wrap(F1.a + Math.PI - M1.a));
        const M2 = this.endWorld(M.p, M.i);
        this.translateComponent(ids, F1.x - M2.x, F1.y - M2.y);
        this.animateComponent(ids);
        this.connect(M.p, M.i, F.p, F.i);
      };
      const d0 = Math.hypot(A.x - B.x, A.y - B.y);
      if (d0 < this.S * 0.55){ dock(); return true; }
      // snap the island's heading onto the fixed side's 45° lattice — try the
      // nearest orientation first, then its other neighbour
      const delta = wrap(M.a - (F.a + Math.PI));
      const near = Math.round(delta / (Math.PI / 4)) * Math.PI / 4;
      const alt = near + (delta > near ? Math.PI / 4 : -Math.PI / 4);
      for (const jointOnly of [true, false])
        for (const snap of [near, alt])
          if (this.tryIslandFill(ids, M, F, wrap(snap - delta), jointOnly)) return true;
      return this.dockFallback(ids, M, F, d0, dock);
    }
    // same rigid network: only an exact lattice fill can close it
    const sol0 = this.solveGap(A, B, 6, 8, false, true);
    if (sol0 && sol0.d <= 6){
      const far = this.realizePath(A, sol0.steps);
      this.connect(far.p, far.i, B.p, B.i);
      return true;
    }
    return false;
  },
  dockFallback(ids, M, F, d0, dock){
    if (d0 < this.S * 2.4){ dock(); return true; }
    return false;
  },
  tryIslandFill(ids, M, F0, rotBy, jointOnly){
      const F = this.endWorld(F0.p, F0.i);
      const M0 = this.endWorld(M.p, M.i);
      if (Math.abs(rotBy) > 1e-4) this.rotateComponent(ids, M0.x, M0.y, rotBy);
      const undo = () => { if (Math.abs(rotBy) > 1e-4){ const Mn = this.endWorld(M.p, M.i); this.rotateComponent(ids, Mn.x, Mn.y, -rotBy); } };
      const M2 = this.endWorld(M.p, M.i);
      // does this island have a SECOND open end that must also reach the
      // fixed network? Solve both gaps jointly: pick one candidate chain per
      // gap whose residual translations AGREE, so one rigid island move
      // makes both joints exact.
      const islandOpen = jointOnly
        ? this.openEnds().filter(E => ids.has(E.p.id) && !(E.p === M.p && E.i === M.i))
        : [];
      const fixedOpen = this.openEnds().filter(E => !ids.has(E.p.id) && !(E.p === F0.p && E.i === F0.i));
      if (islandOpen.length === 1 && fixedOpen.length){
        const M2b = islandOpen[0];
        let F2 = null, fd = Infinity;
        for (const E of fixedOpen){
          const dd = Math.hypot(E.x - M2b.x, E.y - M2b.y);
          if (dd < fd){ fd = dd; F2 = E; }
        }
        if (F2 && fd < this.S * 8){
          const s1 = this.solveGap(F, M2, this.S * 0.85, 9, true, true);
          const s2 = this.solveGap(F2, M2b, this.S * 0.85, 9, true, true);
          if (s1 && s2){
            let match = null;
            for (const h1 of s1.hits){
              const e1 = this.pathEnd(F, h1.steps);
              const d1x = e1.x - M2.x, d1y = e1.y - M2.y;
              for (const h2 of s2.hits){
                const e2 = this.pathEnd(F2, h2.steps);
                const err = Math.hypot((e2.x - M2b.x) - d1x, (e2.y - M2b.y) - d1y);
                if (err < 5 && (!match || h1.steps.length + h2.steps.length < match.n)){
                  match = { h1, h2, dx: d1x, dy: d1y, n: h1.steps.length + h2.steps.length };
                }
              }
            }
            if (match){
              this.translateComponent(ids, match.dx, match.dy);
              this.animateComponent(ids);
              const far1 = this.realizePath(F, match.h1.steps);
              this.connect(far1.p, far1.i, M.p, M.i);
              const far2 = this.realizePath(F2, match.h2.steps);
              this.connect(far2.p, far2.i, M2b.p, M2b.i);
              return true;
            }
          }
        }
      }
      const sol = jointOnly ? null : this.solveGap(F, M2, this.S * 0.6, 8, false, true);
      if (sol){
        const endPose = this.pathEnd(F, sol.steps);
        this.translateComponent(ids, endPose.x - M2.x, endPose.y - M2.y);
        this.animateComponent(ids);
        const far = this.realizePath(F, sol.steps);
        this.connect(far.p, far.i, M.p, M.i);
        return true;
      }
      undo();
      return false;
  },

  /* ── persistence: the floor remembers the last layout ────────────────────
     Coordinates are stored with the piece size, so a layout saved on one
     window size rescales cleanly onto another. */
  serializeLayout(){
    const idx = new Map(this.pieces.map((q, i) => [q.id, i]));
    const conns = [];
    for (const q of this.pieces) for (const e in q.conn){
      const c = q.conn[e], i = idx.get(q.id), j = idx.get(c.p);
      if (j != null && (i < j || (i === j && +e < c.e))) conns.push([i, +e, j, c.e]);
    }
    return {
      v: 3, s: this.S,
      // full consists — every car in order (absorbed engines included), plus
      // where the head sits, so a reload gives back EXACTLY what was built
      trains: this.trains.map(T => {
        const h = T.cars[0];
        return {
          livery: T.livery,
          cars: T.cars.map(c => c.lv != null ? { t: c.type, lv: c.lv | 0 } : { t: c.type }),
          head: { p: idx.get(h.p.id) ?? 0, r: h.r, s: Math.round(h.s * 10) / 10, fw: h.fw ? 1 : 0 },
          run: T.running ? 1 : 0,
        };
      }),
      pieces: this.pieces.map(q => ({
        k: q.key, x: Math.round(q.x * 10) / 10, y: Math.round(q.y * 10) / 10,
        r: Math.round(q.rot * 1000) / 1000, sw: q.sw || 0,
      })),
      conns,
    };
  },
  saveLayout(){
    if (this._loading) return;
    const s = JSON.stringify(this.serializeLayout());
    try { localStorage.setItem('cf.trainLayout', s); } catch {}
    this.pushHistory(s);
  },
  /* ── undo / redo: a snapshot stack over the layout serialisation ───────── */
  hist: [], histIdx: -1,
  pushHistory(s){
    if (this.hist[this.histIdx] === s) return;
    this.hist = this.hist.slice(0, this.histIdx + 1);
    this.hist.push(s);
    if (this.hist.length > 60) this.hist.shift();
    this.histIdx = this.hist.length - 1;
    this.syncHistUI();
  },
  undo(){ if (this.histIdx > 0){ this.histIdx--; this.applySnapshot(this.hist[this.histIdx]); } },
  redo(){ if (this.histIdx < this.hist.length - 1){ this.histIdx++; this.applySnapshot(this.hist[this.histIdx]); } },
  applySnapshot(s){
    const d = JSON.parse(s);
    this._loading = true;
    for (const p of [...this.pieces]){
      p.el.remove();
      if (p.over) p.over.remove();
      if (p.slab) p.slab.remove();
    }
    this.pieces = [];
    for (const T of [...this.trains]) this.removeTrain(T);
    this.drag = null; this.touch = null; this.trainTouch = null; this.trainDrag = false;
    this.carTouch = null; this.carDrag = false;
    const f = this.S / (d.s || this.S);
    for (const q of d.pieces || []){
      const p = this.addPiece(this.DEFS[q.k] ? q.k : 'straight', q.x * f, q.y * f, q.r);
      if (q.sw) p.sw = 1;
    }
    for (const [i, e, j, g] of d.conns || []){
      const a = this.pieces[i], b = this.pieces[j];
      if (a && b && !a.conn[e] && !b.conn[g]) this.connect(a, e, b, g);
    }
    for (const t of d.trains || []) if (t.head) t.head.s *= f;
    this._pendingTrains = d.trains || [{ livery: d.livery | 0, cars: d.cars || [] }];
    this.healJoints();
    for (const q of this.pieces) this.renderPiece(q);
    if (this.pieces.length) this.spawnSavedTrains();
    this._loading = false;
    try { localStorage.setItem('cf.trainLayout', s); } catch {}
    this.refit();
    this.syncHistUI();
    Audio2.pop();
  },
  syncHistUI(){
    const u = $('#trn-undo'), r = $('#trn-redo');
    if (u) u.classList.toggle('trn-dim', this.histIdx <= 0);
    if (r) r.classList.toggle('trn-dim', this.histIdx >= this.hist.length - 1);
  },
  loadLayout(){
    try {
      const d = JSON.parse(localStorage.getItem('cf.trainLayout') || 'null');
      if (!d || (d.v !== 2 && d.v !== 3) || !Array.isArray(d.pieces) || !d.s) return false;
      if (!d.pieces.length) return 'empty';
      this._loading = true;
      const f = this.S / d.s;
      for (const q of d.pieces){
        const p = this.addPiece(this.DEFS[q.k] ? q.k : 'straight', q.x * f, q.y * f, q.r);
        if (q.sw){ p.sw = 1; }
      }
      for (const [i, e, j, g] of d.conns || []){
        const a = this.pieces[i], b = this.pieces[j];
        if (a && b && !a.conn[e] && !b.conn[g]) this.connect(a, e, b, g);
      }
      for (const t of d.trains || []) if (t.head) t.head.s *= f;
      this._pendingTrains = d.trains || [{ livery: d.livery | 0, cars: d.cars || [] }];
      this.healJoints();
      this._loading = false;
      this.repaintAll();
      return true;
    } catch { this._loading = false; return false; }
  },
  // recorded joints whose geometry no longer meets exactly (e.g. a flex piece
  // reloaded, or a rescale wobble) get re-bent to land flush
  healJoints(){
    for (const p of this.pieces){
      if (!['straight', 'curve', 'curveS'].includes(p.key)) continue;
      for (const ei of [0, 1]){
        const cn = p.conn[ei];
        if (!cn) continue;
        const o = this.byId(cn.p);
        if (!o) continue;
        const A = this.endWorld(p, ei), B = this.endWorld(o, cn.e);
        const gap = Math.hypot(A.x - B.x, A.y - B.y);
        if (gap < 5 && Math.abs(wrap(A.a - B.a - Math.PI)) < 0.12) continue;
        const kAnch = 1 - ei;
        if (!p.conn[kAnch]) continue;
        const c = Math.cos(-p.rot), s = Math.sin(-p.rot);
        const bent = this.bendRoute(this.DEFS[p.key], kAnch, {
          x: (B.x - p.x) * c - (B.y - p.y) * s,
          y: (B.x - p.x) * s + (B.y - p.y) * c,
          a: wrap(B.a + Math.PI - p.rot),
        });
        if (bent) p.def = bent;
      }
    }
  },
  // clear the whole floor (the previous layout is kept as a backup key)
  clearField(){
    if (!this._sim) try {
      const cur = localStorage.getItem('cf.trainLayout');
      if (cur) localStorage.setItem('cf.trainLayout.prev', cur);
    } catch {}
    for (const p of [...this.pieces]){
      p.el.remove();
      if (p.over) p.over.remove();
      if (p.slab) p.slab.remove();
    }
    this.pieces = [];
    for (const T of [...this.trains]) this.removeTrain(T);
    this.drag = null; this.touch = null; this.trainTouch = null; this.trainDrag = false;
    this.carTouch = null; this.carDrag = false;
    Audio2.pop();
    this.saveLayout();
  },
  spawnSavedTrains(){
    const list = this._pendingTrains && this._pendingTrains.length ? this._pendingTrains : [{ livery: 0, cars: [] }];
    this._pendingTrains = null;
    for (const t of list){
      if (t.cars && t.cars.length && typeof t.cars[0] === 'object') this.rebuildTrain(t);
      else this.spawnTrain(Math.min(this.LIVERIES.length - 1, t.livery | 0),
        { carTypes: (t.cars || []).filter(x => ['tanker', 'boxcar', 'coach'].includes(x)) });
    }
    this.placeTrain();
  },
  // v3 restore: rebuild a consist car-for-car and seat it where it was saved
  rebuildTrain(t){
    if (!this.pieces.length) return null;
    const T = this.newTrain(t.livery | 0);
    for (const cd of t.cars || []){
      if (cd.t === 'engine') T.cars.push(this.makeEngineCar(Math.min(this.LIVERIES.length - 1, cd.lv | 0)));
      else if (['tender', 'tanker', 'boxcar', 'coach'].includes(cd.t)) T.cars.push(this.makeWagonCar(cd.t, cd.lv != null ? cd.lv | 0 : t.livery | 0));
    }
    if (!T.cars.length) return null;
    this.trains.push(T);
    this.activeT = T;
    const h = T.cars[0];
    const hp = this.pieces[(t.head && t.head.p) | 0] || this.pieces[0];
    const hr = t.head && hp.def.routes[t.head.r] ? t.head.r : 0;
    const rt = hp.def.routes[hr];
    h.p = hp; h.r = hr; h.fw = t.head ? !!t.head.fw : true;
    h.s = Math.max(0, Math.min(rt.len, t.head ? +t.head.s || 0 : rt.len * 0.7));
    for (let i = 1; i < T.cars.length; i++) this.seatBehind(T.cars[i - 1], T.cars[i]);
    T.running = !!t.run;
    this.syncCoal(T);
    return T;
  },
  // a train reappears as soon as there is track again
  ensureTrain(){
    if (this.trains.length || !this.pieces.length) return;
    if (this._pendingTrains) this.spawnSavedTrains();
    else this.spawnTrain(0);
  },
  // stitch any open end pairs that geometry has brought together (closes loops)
  closureScan(){
    const open = this.openEnds();
    for (let i = 0; i < open.length; i++) for (let j = i + 1; j < open.length; j++){
      const A = open[i], B = open[j];
      if (A.p === B.p || A.p.conn[A.i] || B.p.conn[B.i]) continue;
      if (Math.hypot(A.x - B.x, A.y - B.y) < 6 && Math.abs(wrap(A.a - B.a - Math.PI)) < 0.06)
        this.connect(A.p, A.i, B.p, B.i);
    }
  },

  /* ── lifecycle ─────────────────────────────────────────────────────────── */
  start(){
    Audio2.unlock(); showView('train');
    this.reset('load');
    if (!this.bound){
      const a = this.area();
      a.addEventListener('pointerdown', e => this.onDown(e));
      window.addEventListener('pointermove', e => this.onMove(e));
      window.addEventListener('pointerup', e => this.onUp(e));
      window.addEventListener('pointercancel', e => this.onUp(e));
      // destructive buttons need a deliberate 1-second hold
      const bindHold = (btn, fn) => {
        let t = 0;
        const stop = () => { clearTimeout(t); btn.classList.remove('trn-holding'); };
        btn.addEventListener('pointerdown', e => {
          e.preventDefault(); Audio2.unlock();
          btn.classList.add('trn-holding');
          t = setTimeout(() => { btn.classList.remove('trn-holding'); fn(); }, 1000);
        });
        for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, stop);
      };
      bindHold($('#trn-reset'), () => this.reset());
      // pre-built layouts along the bottom: each replaces the floor, so each
      // takes the same deliberate hold as the other destructive buttons
      for (const btn of document.querySelectorAll('#trn-tpls [data-template]'))
        bindHold(btn, () => this.reset(undefined, btn.dataset.template));
      bindHold($('#trn-clear'), () => this.clearField());
      $('#trn-undo').addEventListener('click', () => { Audio2.unlock(); this.undo(); });
      $('#trn-redo').addEventListener('click', () => { Audio2.unlock(); this.redo(); });
      $('#trn-fix').addEventListener('click', e => {
        Audio2.unlock();
        if (!this.fixLayout()){
          e.currentTarget.classList.remove('trn-deny'); void e.currentTarget.offsetWidth;
          e.currentTarget.classList.add('trn-deny');
        }
      });
      this.bound = true;
    }
    this.active = true;
    this.loop();
  },
  stop(){
    this.active = false;
    if (this.raf){ cancelAnimationFrame(this.raf); this.raf = 0; }
    this.drag = null; this.touch = null;
  },
  reset(mode, template){
    const a = this.area(), r = a.getBoundingClientRect();
    this.W = r.width; this.H = r.height / this.SQ;   // floor is "taller" than the screen
    this.S = Math.min(this.W, r.height) * 0.2;
    this.R = this.S * (202 / 144);               // E curve centreline (182 inner + half of 40 width)
    this.TW = this.S * (40 / 144);
    this.buildDefs();
    this.cam = { zoom: 1, x: 0, y: 0 };
    a.innerHTML = `<div id="trn-world" class="trn-world" style="height:${(100 / this.SQ).toFixed(2)}%;transform:scaleY(${this.SQ})"></div>`;
    this.pieces = []; this.seq = 0; this.drag = null; this.touch = null;
    this.trainTouch = null; this.trainDrag = false; this.dropMark = null;
    this.carTouch = null; this.carDrag = false;
    this.trains = []; this.activeT = null;
    this.renderOps();
    // 'load' restores the remembered layout (an intentionally cleared floor
    // stays cleared); anything else deals the starter oval
    let built = false;
    if (mode === 'load') built = this.loadLayout();
    if (built === false){
      if (template && this.TEMPLATES[template]){
        this[this.TEMPLATES[template]]();
        this.closureScan();
        this.fixLayout();   // stitch template gaps (ring links) with real wood
        this.healJoints();
        this.repaintAll();
        this.fitView();
      } else this.buildStarter();
    }
    if (!this.trains.length && this.pieces.length){
      if (this._pendingTrains) this.spawnSavedTrains();
      else this.spawnTrain(0);
    }
    this.markers = [];
    this.hist = [JSON.stringify(this.serializeLayout())];
    this.histIdx = 0;
    this.syncHistUI();
    if (mode !== 'load') this.saveLayout();
  },

  /* ── the starter oval: a closed loop with a station and one switch whose
        open branch invites building (a fully closed loop has nowhere to snap) */
  buildStarter(){
    // oval rides high so the switch branch (bottom straight, flaring outward
    // and down) leaves real floor space to build a siding on-screen
    const cx = this.W / 2, cy = this.H * 0.46;
    const KEYS = ['station', 'curve', 'curve', 'curve', 'curve', 'swl', 'curve', 'curve', 'curve', 'curve'];
    const first = this.addPiece('station', cx, cy - this.R, 0);
    let prev = { p: first, e: 1 };
    for (let i = 1; i < KEYS.length; i++){
      const def = this.DEFS[KEYS[i]];
      const E = this.endWorld(prev.p, prev.e);
      const turn = KEYS[i] === 'curve' ? Math.PI / 4 : 0;   // clockwise oval
      // mate end 0 or 1, whichever continues the loop in the right direction
      let best = null;
      for (const k of [0, 1]){
        if (k >= def.ends.length) break;
        const other = k === 0 ? 1 : 0;
        const t = this.mateTransform(def, k, E);
        const exitA = wrap(def.ends[other].a + t.rot);
        const err = Math.abs(wrap(exitA - wrap(E.a + turn)));
        if (!best || err < best.err) best = { k, other, t, err };
      }
      const p = this.addPiece(KEYS[i], best.t.x, best.t.y, best.t.rot);
      this.connect(E.p, E.i, p, best.k);
      prev = { p, e: (p.key === 'swl' || p.key === 'swr') ? 1 : best.other };
    }
    this.closureScan();
    this.repaintAll();
  },
  /* ── example layouts ─────────────────────────────────────────────────────
     Sequences are chained with the same mate math the starter uses; '+'/'-'
     suffixes pick the turn direction, switches record their branch ends for
     sidings and ring-to-ring links. */
  chainSeq(prev, seq, branches){
    for (const item of seq){
      const turn = item.endsWith('+') ? Math.PI / 4 : item.endsWith('-') ? -Math.PI / 4 : 0;
      const key = item.replace(/[+-]$/, '');
      const def = this.DEFS[key];
      const E = this.endWorld(prev.p, prev.e);
      let best = null;
      for (const k of [0, 1]){
        if (k >= def.ends.length) break;
        const other = k === 0 ? 1 : 0;
        const t = this.mateTransform(def, k, E);
        const err = def.ends[other]
          ? Math.abs(wrap(wrap(def.ends[other].a + t.rot) - wrap(E.a + turn)))
          : 0;   // single-ended piece (buffer): only one way to mate
        if (!best || err < best.err) best = { k, other, t, err };
      }
      const p = this.addPiece(key, best.t.x, best.t.y, best.t.rot);
      this.connect(E.p, E.i, p, best.k);
      if ((key === 'swl' || key === 'swr') && branches) branches.push({ p, e: 2 });
      if (!def.ends[best.other]) return { p, e: null };   // chain ends at a buffer
      prev = { p, e: (key === 'swl' || key === 'swr') ? 1 : best.other };
    }
    return prev;
  },
  // place a piece by mating its end k onto the open world end E
  matePiece(key, k, E){
    const t = this.mateTransform(this.DEFS[key], k, E);
    return this.addPiece(key, t.x, t.y, t.rot);
  },
  /* Ring Land: three concentric ovals joined by Y-tracks. Each outer ring is
     GROWN from the inner ring's switch: the two switch branches (45°, big-
     curve radius) mate nose-to-nose, so every transition is exact and a train
     can switch rings at either Y. */
  buildRings(){
    const reps = (arr, n) => Array.from({ length: n }, () => arr).flat();
    const n0 = this.pieces.length;
    // inner ring: a tight-curve stadium; its bottom straight IS the Y-switch
    const brA = [], brB = [];
    const first = this.addPiece('straight', 0, 0, 0);
    this.chainSeq({ p: first, e: 1 },
      [...reps(['curveS+'], 4), 'swl', ...reps(['curveS+'], 4)], brA);
    // middle ring, branch-to-branch off the inner Y; its own Y sits up top
    const SB = this.matePiece('swl', 2, this.endWorld(brA[0].p, 2));
    this.connect(brA[0].p, 2, SB, 2);
    this.chainSeq({ p: SB, e: 1 },
      ['straight', 'straight', ...reps(['curve-'], 4),
        'swr', 'straight', 'straight', ...reps(['curve-'], 4)], brB);
    // outer ring, branch-to-branch off the middle Y — a station on the far side
    const SC = this.matePiece('swr', 2, this.endWorld(brB[0].p, 2));
    this.connect(brB[0].p, 2, SC, 2);
    this.chainSeq({ p: SC, e: 1 },
      ['straight', 'straight', 'curve+', 'curve+', 'straight', 'straight', 'curve+', 'curve+',
        'straight', 'straight', 'station', 'straight', 'straight', 'curve+', 'curve+',
        'straight', 'straight', 'curve+', 'curve+', 'straight', 'straight']);
    this.closureScan();
    this.centerBuilt(n0);
    this._pendingTrains = [{ livery: 0, cars: [] }, { livery: 2, cars: ['coach'] },
      { livery: 1, cars: ['boxcar'] }];
  },
  buildCoalYard(){
    const cx = this.W / 2, cy = this.H * 0.42;
    const branches = [];
    const first = this.addPiece('straight', cx - this.S, cy - this.R, 0);
    this.chainSeq({ p: first, e: 1 }, [
      'station', 'straight', 'curve+', 'curve+', 'curve+', 'curve+',
      'swl', 'straight', 'swr', 'curve+', 'curve+', 'curve+', 'curve+',
    ], branches);
    this.closureScan();
    // outer siding: the coal yard; inner stub: the water stop
    if (branches[0]) this.chainSeq({ p: branches[0].p, e: 2 }, ['curveS-', 'coal', 'straight', 'buffer']);
    if (branches[1]) this.chainSeq({ p: branches[1].p, e: 2 }, ['curveS+', 'water', 'buffer']);
    this._pendingTrains = [{ livery: 0, cars: ['tender'] }, { livery: 1, cars: ['boxcar'] }];
  },
  /* Switch Yard: a tall dumbbell — station loop on top, coal loop below,
     joined by a nose-to-nose Y like Ring Land; a buffered lay-by flares off
     the top loop and the water-tower siding off the bottom one */
  buildSwitchYard(){
    const reps = (arr, n) => Array.from({ length: n }, () => arr).flat();
    const n0 = this.pieces.length;
    const br = [], br2 = [];
    // top loop: station up top next to the siding Y; transition Y at the bottom
    const first = this.addPiece('station', 0, 0, 0);
    this.chainSeq({ p: first, e: 1 },
      ['swl', ...reps(['curve+'], 4), 'swl', 'straight', ...reps(['curve+'], 4)], br);
    // bottom loop grows branch-to-branch off the transition Y
    const SB = this.matePiece('swl', 2, this.endWorld(br[1].p, 2));
    this.connect(br[1].p, 2, SB, 2);
    this.chainSeq({ p: SB, e: 1 },
      ['straight', ...reps(['curve+'], 4), 'swl', 'coal', ...reps(['curve+'], 4)], br2);
    // the yard stubs: a low lay-by up top, the water tower down in the open
    this.chainSeq({ p: br[0].p, e: 2 }, ['curveS+', 'straight', 'buffer']);
    this.chainSeq({ p: br2[0].p, e: 2 }, ['curveS+', 'water', 'buffer']);
    this.closureScan();
    this.centerBuilt(n0);
    this._pendingTrains = [{ livery: 3, cars: ['boxcar', 'tanker'] }, { livery: 1, cars: [] }];
  },
  centerBuilt(n0){
    const built = this.pieces.slice(n0);
    let mx = 0, my = 0;
    for (const p of built){ mx += p.x; my += p.y; }
    mx /= built.length; my /= built.length;
    for (const p of built){ p.x += this.W / 2 - mx; p.y += this.H / 2 - my; }
  },
  TEMPLATES: { oval: 'buildStarter', rings: 'buildRings', coalyard: 'buildCoalYard', yard: 'buildSwitchYard' },
  addPiece(key, x, y, rot){
    const p = { id: ++this.seq, key, def: this.DEFS[key], x, y, rot, sw: 0, conn: {} };
    p.el = document.createElement('div');
    p.el.className = 'trn-piece';
    this.world().appendChild(p.el);
    this.renderPiece(p);
    this.pieces.push(p);
    return p;
  },
  // connector art is connection-aware: repaint every piece when the graph
  // changes; a flex piece that lost a connection springs straight again
  repaintAll(){
    for (const q of this.pieces)
      if (q.def.bridged && (!q.conn[0] || !q.conn[1])) q.def = this.DEFS[q.key];
    for (const q of this.pieces) this.renderPiece(q);
    this.saveLayout();
    this.refit();
  },
  removePiece(p){
    this.disconnect(p);
    p.el.remove();
    if (p.over) p.over.remove();
    if (p.slab) p.slab.remove();
    this.pieces = this.pieces.filter(x => x !== p);
    this.repaintAll();   // after the splice, so the persisted layout is current
  },
  placeEl(p){
    p.el.style.transform = `translate(${p.x}px, ${p.y}px) rotate(${p.rot}rad)`;
    if (p.over) p.over.style.transform = p.el.style.transform;
    if (p.slab) p.slab.style.transform = p.el.style.transform;
  },

  /* ── rendering: BRIO-look wooden track ─────────────────────────────────── */
  offsetPts(pts, off){
    const out = [];
    for (let i = 0; i < pts.length; i++){
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
      out.push([pts[i][0] - dy / L * off, pts[i][1] + dx / L * off]);
    }
    return out;
  },
  pathD(pts){ return 'M' + pts.map(p => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('L'); },
  // ── the wooden body, drawn in unified passes so multi-route pieces and
  // peg tongues read as ONE machined block: edge silhouette → wood fill →
  // grain streaks → routed grooves → holes/joints. The thickness slab lives
  // in a separate under-everything layer (trackSlab), so neighbours never
  // paint bands across each other at joints.
  pegGeom(e){
    const TW = this.TW, ca = Math.cos(e.a), sa = Math.sin(e.a);
    return {
      neck: `M ${(e.x - ca * TW * 0.12).toFixed(1)} ${(e.y - sa * TW * 0.12).toFixed(1)} L ${(e.x + ca * TW * 0.30).toFixed(1)} ${(e.y + sa * TW * 0.30).toFixed(1)}`,
      bx: e.x + ca * TW * 0.30, by: e.y + sa * TW * 0.30, ca, sa,
    };
  },
  // the solid wedge of wood between a switch's diverging routes (a real
  // switch is one board — without this the fork looks hollow at the edge)
  switchWedge(def){
    const poly = [];
    for (const [x, y] of def.routes[1].pts){
      if (Math.abs(y) > this.TW * 1.05) break;
      poly.push([x, y]);
    }
    return poly.concat(poly.map(([x]) => [x, 0]).reverse());
  },
  trackFace(rlist, conns, fills){
    const TW = this.TW, rail = TW * 0.24, n = x => (+x).toFixed(1);
    let edge = '', wood = '', grain = '', groove = '', deco = '';
    for (const { rt } of rlist)
      edge += `<path d="${this.pathD(rt.pts)}" stroke="#CBB289" stroke-width="${TW + 3}" fill="none" stroke-linecap="butt"/>`;
    for (const f of (fills || []))
      edge += `<path d="${this.pathD(f)}Z" fill="#CBB289" stroke="#CBB289" stroke-width="3"/>`;
    for (const c of conns) if (c.state === 'peg'){
      const g = this.pegGeom(c.e);
      edge += `<path d="${g.neck}" stroke="#CBB289" stroke-width="${n(TW * 0.18)}" stroke-linecap="butt"/>
        <circle cx="${n(g.bx)}" cy="${n(g.by)}" r="${n(TW * 0.175)}" fill="#CBB289"/>`;
    }
    for (const { rt, dim } of rlist)
      wood += `<path d="${this.pathD(rt.pts)}" stroke="${dim ? '#E4D6B4' : '#EDE0C2'}" stroke-width="${TW}" fill="none" stroke-linecap="butt"/>`;
    for (const f of (fills || []))
      wood += `<path d="${this.pathD(f)}Z" fill="#EDE0C2"/>`;
    for (const c of conns) if (c.state === 'peg'){
      // same fill as the body, no stroke at the junction — one piece of wood
      const g = this.pegGeom(c.e);
      wood += `<path d="${g.neck}" stroke="#EDE0C2" stroke-width="${n(TW * 0.125)}" stroke-linecap="butt"/>
        <circle cx="${n(g.bx)}" cy="${n(g.by)}" r="${n(TW * 0.15)}" fill="#EDE0C2"/>
        <circle cx="${n(g.bx - TW * 0.045)}" cy="${n(g.by - TW * 0.045)}" r="${n(TW * 0.06)}" fill="#F8EFD9" opacity=".75"/>`;
    }
    for (const { rt, dim } of rlist){
      if (dim) continue;
      grain += `<path d="${this.pathD(this.offsetPts(rt.pts, -TW * 0.36))}" stroke="#D9C49C" stroke-width="1.3" fill="none" opacity=".5"/>
        <path d="${this.pathD(this.offsetPts(rt.pts, TW * 0.05))}" stroke="#F8EFD9" stroke-width="1.6" fill="none" opacity=".45"/>
        <path d="${this.pathD(this.offsetPts(rt.pts, TW * 0.4))}" stroke="#D9C49C" stroke-width="1.1" fill="none" opacity=".4"/>`;
    }
    for (const { rt, dim } of rlist)
      for (const g of [this.offsetPts(rt.pts, -rail), this.offsetPts(rt.pts, rail)])
        groove += `<path d="${this.pathD(g)}" stroke="${dim ? '#C3AC83' : '#A98C60'}" stroke-width="${n(TW * 0.14)}" fill="none" stroke-linecap="butt" opacity="${dim ? .55 : .9}"/>
          <path d="${this.pathD(g)}" stroke="${dim ? '#9d8760' : '#6E552F'}" stroke-width="${n(TW * 0.055)}" fill="none" stroke-linecap="butt" opacity="${dim ? .6 : .95}"/>`;
    for (const c of conns){
      const e = c.e, ca = Math.cos(e.a), sa = Math.sin(e.a);
      const hx = e.x - ca * this.TW * 0.26, hy = e.y - sa * this.TW * 0.26;
      if (c.state === 'hole'){
        // open keyhole: a thin C-shaped rim — the inner void continues out
        // through the slot, so the ring is visibly OPEN even at icon size
        deco += `<path d="M ${n(e.x + ca * 2.5)} ${n(e.y + sa * 2.5)} L ${n(hx)} ${n(hy)}" stroke="#55422a" stroke-width="${n(TW * 0.19)}" stroke-linecap="butt"/>
          <circle cx="${n(hx)}" cy="${n(hy)}" r="${n(TW * 0.19)}" fill="#55422a"/>
          <circle cx="${n(hx)}" cy="${n(hy)}" r="${n(TW * 0.125)}" fill="#3e3020"/>
          <path d="M ${n(e.x + ca * 2.5)} ${n(e.y + sa * 2.5)} L ${n(hx)} ${n(hy)}" stroke="#3e3020" stroke-width="${n(TW * 0.115)}" stroke-linecap="butt"/>`;
      } else if (c.state === 'joint'){
        // slim seam + the peg seated in a thin C-collar: two mating parts,
        // not a painted ring
        const lane = TW * 0.26;
        deco += `<path d="M ${n(e.x + sa * (TW / 2 + 1.5))} ${n(e.y - ca * (TW / 2 + 1.5))} L ${n(e.x + sa * lane)} ${n(e.y - ca * lane)}" stroke="#8a6f4b" stroke-width="1.6" opacity=".85"/>
          <path d="M ${n(e.x - sa * (TW / 2 + 1.5))} ${n(e.y + ca * (TW / 2 + 1.5))} L ${n(e.x - sa * lane)} ${n(e.y + ca * lane)}" stroke="#8a6f4b" stroke-width="1.6" opacity=".85"/>`;
        deco += `<path d="M ${n(e.x + ca * 2)} ${n(e.y + sa * 2)} L ${n(hx)} ${n(hy)}" stroke="#55422a" stroke-width="${n(TW * 0.19)}" stroke-linecap="butt"/>
          <circle cx="${n(hx)}" cy="${n(hy)}" r="${n(TW * 0.185)}" fill="#55422a"/>
          <path d="M ${n(e.x + ca * 2)} ${n(e.y + sa * 2)} L ${n(hx)} ${n(hy)}" stroke="#EDE0C2" stroke-width="${n(TW * 0.105)}" stroke-linecap="butt"/>
          <circle cx="${n(hx)}" cy="${n(hy)}" r="${n(TW * 0.135)}" fill="#EDE0C2"/>
          <circle cx="${n(hx - TW * 0.04)}" cy="${n(hy - TW * 0.04)}" r="${n(TW * 0.05)}" fill="#F8EFD9" opacity=".7"/>`;
      }
    }
    return edge + wood + grain + groove + deco;
  },
  trackSlab(rlist, conns, off, fills){
    const TW = this.TW, n = x => (+x).toFixed(1);
    let s = `<g transform="translate(${off.x.toFixed(1)} ${off.y.toFixed(1)})">`;
    for (const { rt } of rlist)
      s += `<path d="${this.pathD(rt.pts)}" stroke="#987950" stroke-width="${TW + 3}" fill="none" stroke-linecap="butt"/>`;
    for (const f of (fills || []))
      s += `<path d="${this.pathD(f)}Z" fill="#987950" stroke="#987950" stroke-width="3"/>`;
    for (const c of conns) if (c.state === 'peg'){
      const g = this.pegGeom(c.e);
      s += `<path d="${g.neck}" stroke="#987950" stroke-width="${n(TW * 0.18)}" stroke-linecap="butt"/>
        <circle cx="${n(g.bx)}" cy="${n(g.by)}" r="${n(TW * 0.175)}" fill="#987950"/>`;
    }
    return s + '</g>';
  },
  renderPiece(p, ghost){
    const S = this.S, TW = this.TW, n = x => (+x).toFixed(1);
    const box = S * 1.25, def = p.def;
    let inner = '', over = '';
    // switches draw the inactive leg dimmed, active leg crisp, plus a lever
    const T = TW * 0.3, pr = p.rot || 0;
    const off = { x: T * Math.sin(pr), y: T * Math.cos(pr) };   // screen-down, un-rotated
    // connector state per end: open peg / open hole / seated joint / hidden
    const conns = def.ends.map((e, ei) => {
      const cn = p.conn && p.conn[ei];
      return { e, state: cn ? (p.id > cn.p ? 'hidden' : 'joint') : (ei % 2 === 1 ? 'peg' : 'hole') };
    });
    const rlist = def.routes.map((rt, i) => ({ rt, dim: (def.key === 'swl' || def.key === 'swr') && i !== p.sw }));
    const fills = (def.key === 'swl' || def.key === 'swr') ? [this.switchWedge(def)] : [];
    // standing structures lift toward screen-up (piece-local, rotation-aware);
    // an optional shadow stays on the floor where the thing "really" is
    const lift = (h, inner, shadow) => {
      const k = h / this.SQ;
      return (shadow || '') + `<g transform="translate(${(-k * Math.sin(pr)).toFixed(1)} ${(-k * Math.cos(pr)).toFixed(1)})">${inner}</g>`;
    };
    inner += this.trackFace(rlist, conns, fills);
    if (def.key === 'swl' || def.key === 'swr'){
      const m = def.key === 'swl' ? -1 : 1, ly = -m * (TW / 2 + S * 0.14);
      const la = p.sw === 0 ? 0 : m * Math.PI / 4;   // the lever arrow points where the points do
      // the iconic BRIO red lever: a plastic paddle that points along the
      // route the points are set to
      inner += lift(S * 0.045, `<g transform="translate(${n(-S * 0.16)} ${n(ly)}) rotate(${n(la * 180 / Math.PI)})">
        <path d="M ${n(-S*0.045)} ${n(-S*0.035)} L ${n(S*0.115)} ${n(-S*0.055)} Q ${n(S*0.145)} 0 ${n(S*0.115)} ${n(S*0.055)} L ${n(-S*0.045)} ${n(S*0.035)} Z"
          fill="#D8402C" stroke="#8f1f12" stroke-width="2" stroke-linejoin="round"/>
        <path d="M ${n(-S*0.02)} ${n(-S*0.028)} L ${n(S*0.10)} ${n(-S*0.042)}" stroke="#F07E62" stroke-width="2" stroke-linecap="round" opacity=".8"/>
        <circle r="${n(S * 0.028)}" fill="#8f1f12"/></g>`,
        `<ellipse cx="${n(-S*0.16)}" cy="${n(ly)}" rx="${n(S*0.12)}" ry="${n(S*0.09)}" fill="#000" opacity=".2"/>`);
    }
    if (def.key === 'buffer'){
      const bx = S * (40 / 144) / 2 - 2;
      inner += lift(S * 0.06, `<rect x="${n(bx)}" y="${n(-TW * 0.72)}" width="${n(TW * 0.34)}" height="${n(TW * 1.44)}" rx="3" fill="#C2412F" stroke="#7e2418" stroke-width="2"/>
        <rect x="${n(bx + TW * 0.06)}" y="${n(-TW * 0.5)}" width="${n(TW * 0.2)}" height="${n(TW * 0.32)}" fill="#fff" opacity=".85"/>
        <rect x="${n(bx + TW * 0.06)}" y="${n(TW * 0.18)}" width="${n(TW * 0.2)}" height="${n(TW * 0.32)}" fill="#fff" opacity=".85"/>`,
        `<rect x="${n(bx)}" y="${n(-TW * 0.72)}" width="${n(TW * 0.34)}" height="${n(TW * 1.44)}" rx="3" fill="#5a1d12"/>`);
    }
    if (def.key === 'station'){
      const py = TW / 2 + 3;
      inner += lift(S * 0.025,
        `<rect x="${n(-S*0.38)}" y="${n(py)}" width="${n(S*0.76)}" height="${n(S*0.2)}" rx="4" fill="#5FBF6A" stroke="#3d8a47" stroke-width="2"/>`)
      + lift(S * 0.14,
        `<rect x="${n(-S*0.3)}" y="${n(py + S*0.05)}" width="${n(S*0.6)}" height="${n(S*0.17)}" rx="5" fill="#4A6FD0" stroke="#2f4c9c" stroke-width="2"/>
         <rect x="${n(-S*0.1)}" y="${n(py + S*0.085)}" width="${n(S*0.2)}" height="${n(S*0.08)}" rx="2" fill="#EAF2F9"/>`,
        `<rect x="${n(-S*0.3)}" y="${n(py + S*0.05)}" width="${n(S*0.6)}" height="${n(S*0.17)}" rx="5" fill="#000" opacity=".2"/>`);
    }
    if (def.key === 'coal'){
      // the classic coal GANTRY: four grey legs straddling the rails, a big
      // open bin heaped with coal on top. Far legs render under the train,
      // near legs and the bin in the overlay so the train truly passes under.
      const H = S * 0.24, k = H / this.SQ;
      const lx = -k * Math.sin(pr), ly = -k * Math.cos(pr);
      const legX = [-S * 0.17, S * 0.17], legY = TW * 0.72;
      const col = (x, y) => `<line x1="${n(x)}" y1="${n(y)}" x2="${n(x + lx)}" y2="${n(y + ly)}" stroke="#5A5F68" stroke-width="${n(S * 0.06)}" stroke-linecap="round"/>
        <line x1="${n(x)}" y1="${n(y)}" x2="${n(x + lx * 0.5)}" y2="${n(y + ly * 0.5)}" stroke="#41464e" stroke-width="${n(S * 0.06)}" stroke-linecap="round" opacity=".5"/>
        <rect x="${n(x - S * 0.04)}" y="${n(y - S * 0.028)}" width="${n(S * 0.08)}" height="${n(S * 0.056)}" rx="2" fill="#41464e"/>`;
      const heap = Array.from({ length: 12 }, (_, i) => {
        const hx = -S * 0.17 + (i % 4) * S * 0.113 + (i % 3) * S * 0.012;
        const hy = -TW * 0.42 + Math.floor(i / 4) * TW * 0.42 + (i % 2) * TW * 0.1;
        return `<circle cx="${n(hx)}" cy="${n(hy)}" r="${n(S * 0.042)}" fill="${i % 3 ? '#26292f' : '#33373e'}"/>`;
      }).join('');
      inner += `<rect x="${n(-S * 0.28)}" y="${n(-TW * 0.85)}" width="${n(S * 0.56)}" height="${n(TW * 1.7)}" rx="6" fill="#000" opacity=".16"/>`
        + col(legX[0], -legY) + col(legX[1], -legY);
      over = col(legX[0], legY) + col(legX[1], legY)
        + `<g transform="translate(${n(lx)} ${n(ly)})">
          <rect x="${n(-S * 0.27)}" y="${n(-TW * 0.8)}" width="${n(S * 0.54)}" height="${n(TW * 1.6)}" rx="4" fill="#6E747E" stroke="#3f444c" stroke-width="2.5"/>
          <rect x="${n(-S * 0.27)}" y="${n(TW * 0.62)}" width="${n(S * 0.54)}" height="${n(TW * 0.18)}" rx="3" fill="#565b64"/>
          <rect x="${n(-S * 0.22)}" y="${n(-TW * 0.68)}" width="${n(S * 0.44)}" height="${n(TW * 1.36)}" rx="3" fill="#17191d"/>
          ${heap}</g>`;
    }
    if (def.key === 'water'){
      const ty = -(TW / 2 + S * 0.26);
      inner += lift(S * 0.2, `<circle cx="0" cy="${n(ty)}" r="${n(S*0.2)}" fill="#7FA8C9" stroke="#4a7191" stroke-width="2.5"/>
        <circle cx="0" cy="${n(ty)}" r="${n(S*0.13)}" fill="#A9CBE4"/>
        <circle cx="0" cy="${n(ty)}" r="${n(S*0.035)}" fill="#4a7191"/>`,
        `<ellipse cx="0" cy="${n(ty)}" rx="${n(S*0.21)}" ry="${n(S*0.17)}" fill="#000" opacity=".22"/>`);
      // the spout rests along the tower, swings over the track when it pours
      over = lift(S * 0.2, `<g class="trw-spout" style="transform-origin:0px ${n(ty)}px">
        <rect x="${n(-S*0.03)}" y="${n(ty)}" width="${n(S*0.06)}" height="${n(S*0.42)}" rx="3" fill="#5A7A94" stroke="#3a5468" stroke-width="1.5"/>
        <rect x="${n(-S*0.05)}" y="${n(ty + S*0.38)}" width="${n(S*0.1)}" height="${n(S*0.07)}" rx="2" fill="#3a5468"/></g>`);
    }
    const svg = box => `<svg viewBox="${-box} ${-box} ${box * 2} ${box * 2}"
      style="position:absolute;left:${-box}px;top:${-box}px;width:${box * 2}px;height:${box * 2}px;overflow:visible">`;
    p.el.innerHTML = svg(box) + inner + '</svg>';
    if (!ghost){
      if (!p.slab){
        p.slab = document.createElement('div');
        p.slab.className = 'trn-slab';
        this.world().appendChild(p.slab);
      }
      p.slab.innerHTML = svg(box) + this.trackSlab(rlist, conns, off, fills) + '</svg>';
      if (over){
        if (!p.over){
          p.over = document.createElement('div');
          p.over.className = 'trn-over';
          this.world().appendChild(p.over);
        }
        p.over.innerHTML = svg(box) + over + '</svg>';
      } else if (p.over){ p.over.remove(); p.over = null; }
    }
    this.placeEl(p);
  },

  /* ── the picker ────────────────────────────────────────────────────────── */
  renderOps(){
    const ops = $('#trn-ops');
    // one switch button is enough: snapping tries both mirror twins and
    // commits whichever hand fits where the child is aiming
    const BTNS = [
      ['straight', 'a straight track'], ['curve', 'a curved track'], ['curveS', 'a tight curve'],
      ['swl', 'a switch'], ['cross', 'a crossing'], ['station', 'a station'],
      ['coal', 'a coal hopper'], ['water', 'a water tower'], ['buffer', 'an end stop'],
    ];
    ops.innerHTML = BTNS.map(([key, label]) =>
      `<button class="fb-btn trn-pick" data-piece="${key}" aria-label="Add ${label}">${this.iconSVG(key)}</button>`).join('');
    // rolling-stock row below the track row: every engine livery + the cars
    const stock = $('#trn-stock');
    stock.innerHTML = this.LIVERIES.map((L, i) =>
      `<button class="fb-btn trn-carbtn trn-engbtn" data-engine="${i}" aria-label="Add the ${['blue', 'green', 'red', 'yellow'][i]} engine">
        <svg viewBox="0 0 100 60" width="42" height="26"><rect x="10" y="18" width="66" height="26" rx="8" fill="${L.body}" stroke="${L.dark}" stroke-width="3"/><rect x="58" y="8" width="20" height="20" rx="4" fill="${L.dark}"/><rect x="18" y="6" width="10" height="16" rx="3" fill="#363E47"/><circle cx="26" cy="48" r="8" fill="#20262D" stroke="#8A929C" stroke-width="2"/><circle cx="58" cy="48" r="8" fill="#20262D" stroke="#8A929C" stroke-width="2"/><rect x="76" y="20" width="6" height="24" rx="2" fill="#C2412F"/></svg>
      </button>`).join('')
      + `<button class="fb-btn trn-carbtn trn-gap" data-car="tanker" aria-label="Add an oil tanker">
        <svg viewBox="0 0 100 60" width="42" height="26"><rect x="10" y="14" width="80" height="30" rx="15" fill="#B9BEC5" stroke="#6E747E" stroke-width="3"/><rect x="42" y="6" width="16" height="10" rx="4" fill="#8A929C"/><circle cx="30" cy="50" r="7" fill="#20262D" stroke="#8A929C" stroke-width="2"/><circle cx="70" cy="50" r="7" fill="#20262D" stroke="#8A929C" stroke-width="2"/></svg>
      </button>
      <button class="fb-btn trn-carbtn" data-car="boxcar" aria-label="Add a box car">
        <svg viewBox="0 0 100 60" width="42" height="26"><rect x="12" y="10" width="76" height="34" rx="4" fill="#8B5A2B" stroke="#5c3b1c" stroke-width="3"/><rect x="42" y="14" width="16" height="26" fill="#A9713A" stroke="#5c3b1c" stroke-width="2"/><circle cx="30" cy="50" r="7" fill="#20262D" stroke="#8A929C" stroke-width="2"/><circle cx="70" cy="50" r="7" fill="#20262D" stroke="#8A929C" stroke-width="2"/></svg>
      </button>
      <button class="fb-btn trn-carbtn" data-car="coach" aria-label="Add a passenger coach">
        <svg viewBox="0 0 100 60" width="42" height="26"><rect x="10" y="12" width="80" height="32" rx="8" fill="#E8933C" stroke="#9c5a1a" stroke-width="3"/><rect x="20" y="18" width="13" height="16" rx="2" fill="#F6E7C8"/><rect x="43" y="18" width="13" height="16" rx="2" fill="#F6E7C8"/><rect x="66" y="18" width="13" height="16" rx="2" fill="#F6E7C8"/><circle cx="30" cy="50" r="7" fill="#20262D" stroke="#8A929C" stroke-width="2"/><circle cx="70" cy="50" r="7" fill="#20262D" stroke="#8A929C" stroke-width="2"/></svg>
      </button>`;
    // the shelf must clear the (possibly wrapped) track row
    const opsR = ops.getBoundingClientRect(), aR = this.area().getBoundingClientRect();
    stock.style.top = (opsR.bottom - aR.top + 8) + 'px';
    stock.querySelectorAll('.trn-engbtn').forEach(btn => {
      btn.addEventListener('click', () => {
        Audio2.unlock();
        if (this.spawnTrain(+btn.dataset.engine)){
          this.saveLayout();
          Audio2.snapSnd();
        } else {
          btn.classList.remove('trn-deny'); void btn.offsetWidth;
          btn.classList.add('trn-deny');
        }
      });
    });
    ops.querySelectorAll('.trn-pick').forEach(btn => {
      btn.addEventListener('pointerdown', e => {
        e.preventDefault(); Audio2.unlock();
        this.beginDrag(this.spawnFloating(btn.dataset.piece, e.clientX, e.clientY), true, e);
      });
    });
    stock.querySelectorAll('.trn-carbtn[data-car]').forEach(btn => {
      btn.addEventListener('click', () => {
        Audio2.unlock();
        if (!this.addCar(btn.dataset.car)){
          btn.classList.remove('trn-deny'); void btn.offsetWidth;
          btn.classList.add('trn-deny');
        }
      });
    });
  },
  iconSVG(key){
    // tiny previews drawn with the real renderer, scaled into the button
    const save = { S: this.S, R: this.R, TW: this.TW };
    this.S = 44; this.R = this.S * 1.30656; this.TW = this.S * 0.33;
    this.buildDefs();
    const fake = { def: this.DEFS[key], key, sw: 0, el: document.createElement('div') };
    this.renderPiece(fake, true);
    const inner = fake.el.querySelector('svg').innerHTML;
    Object.assign(this, save);
    if (this.S) this.buildDefs();
    return `<svg viewBox="-34 -34 68 68" width="46" height="46" style="overflow:visible">${inner}</svg>`;
  },
  spawnFloating(key, cx, cy){
    const f = this.toFloor({ clientX: cx, clientY: cy });
    const p = { id: ++this.seq, key, def: this.DEFS[key], x: f.x, y: f.y, rot: 0, sw: 0, conn: {} };
    p.el = document.createElement('div');
    p.el.className = 'trn-piece trn-drag';
    this.world().appendChild(p.el);
    this.renderPiece(p);
    return p;
  },

  /* ── drag / snap / toybox ──────────────────────────────────────────────── */
  beginDrag(p, fromPicker, e){
    const f = this.toFloor(e);
    this.drag = {
      p, fromPicker, moved: false, sx: e.clientX, sy: e.clientY,
      prev: fromPicker ? null : { x: p.x, y: p.y, rot: p.rot, conn: JSON.parse(JSON.stringify(p.conn)) },
      cand: null, ghost: null, ghostSig: '', vx: 0, vy: 0, lt: 0, lx: 0, ly: 0,
      ox: p.x - f.x, oy: p.y - f.y,
    };
    if (!fromPicker){
      this.disconnect(p);
      this.repaintAll();
      if (p.def.bridged) p.def = this.DEFS[p.key];   // picked up flex track springs straight
      p.el.classList.add('trn-drag');
    }
    this.updateMarkers();
  },
  // size of the connected network a piece belongs to (tie-breaks toward the
  // main loop when two snaps are equally close)
  compSize(start, cache){
    if (cache && cache.has(start.id)) return cache.get(start.id);
    const seen = new Set([start.id]), stack = [start];
    while (stack.length){
      const q = stack.pop();
      for (const i in q.conn){
        const o = this.byId(q.conn[i].p);
        if (o && !seen.has(o.id)){ seen.add(o.id); stack.push(o); }
      }
    }
    if (cache) for (const id of seen) cache.set(id, seen.size);
    return seen.size;
  },
  candidates(p, px, py, ungated){
    const open = this.openEnds(p), out = [], comps = new Map();
    // clearance is measured rail-to-rail (sampled route points), so tracks may
    // pass close by — like real wooden track — but never lie on each other
    const world = [];
    for (const o of this.pieces){
      if (o === p) continue;
      // this piece's open connector zones are fair game — a mate or a flex
      // bridge will resolve anything laid close to them
      const openZones = [];
      for (let i = 0; i < o.def.ends.length; i++)
        if (!o.conn[i]) openZones.push(this.toWorld(o, o.def.ends[i].x, o.def.ends[i].y));
      for (const rt of o.def.routes)
        for (let i = 0; i < rt.pts.length; i += 2){
          const w = this.toWorld(o, rt.pts[i][0], rt.pts[i][1]);
          if (openZones.some(z => Math.hypot(w.x - z.x, w.y - z.y) < this.S * 0.45)) continue;
          world.push([w.x, w.y, o]);
        }
    }
    const lim = this.TW * 0.8;
    const defs = [p.def];
    if (MIRROR[p.key]) defs.push(this.DEFS[MIRROR[p.key]]);
    for (const def of defs){
      for (const E of open){
        for (let k = 0; k < def.ends.length; k++){
          const t = this.mateTransform(def, k, E);
          const fake = { x: t.x, y: t.y, rot: t.rot };
          let ok = true;
          outer: for (const rt of def.routes)
            for (let i = 0; i < rt.pts.length; i += 2){
              const w = this.toWorld(fake, rt.pts[i][0], rt.pts[i][1]);
              const nearJoint = Math.hypot(w.x - E.x, w.y - E.y) < this.S * 0.45;
              for (const [wx, wy, o] of world){
                if (o === E.p && nearJoint) continue;   // meeting at the joint is the point
                if (Math.hypot(w.x - wx, w.y - wy) < lim){ ok = false; break outer; }
              }
            }
          if (!ok) continue;
          // MAGNET gating: eligible when the dragged piece's own end sits near
          // the target connector (end-to-end attraction), OR the finger is on
          // it — no "must aim at the main loop" restriction
          const de = this.toWorld(p, def.ends[k].x, def.ends[k].y);
          const mag = Math.hypot(de.x - E.x, de.y - E.y);
          const fin = Math.hypot(px - E.x, py - E.y);
          if (!ungated && mag > Math.max(this.S * 0.42, 52) && fin > Math.max(this.S * 0.32, 44)) continue;
          // aim score: the free end nearest the finger (chirality/bend chooser)
          let d = Math.hypot(px - t.x, py - t.y);
          for (let j = 0; j < def.ends.length; j++){
            if (j === k) continue;
            const w = this.toWorld(fake, def.ends[j].x, def.ends[j].y);
            d = Math.min(d, Math.hypot(px - w.x, py - w.y));
          }
          out.push({ E, k, t, d, def, mag: Math.min(mag, fin), comp: this.compSize(E.p, comps) });
        }
      }
    }
    return out;
  },
  updateMarkers(cands, hots){
    for (const m of this.markers) m.remove();
    this.markers = [];
    if (!this.drag) return;
    const seen = new Set();
    for (const c of (cands || this.candidates(this.drag.p, this.drag.p.x, this.drag.p.y))){
      const id = c.E.p.id + ':' + c.E.i;
      if (seen.has(id)) continue;
      seen.add(id);
      const hot = (hots || []).some(h => h.p === c.E.p && h.i === c.E.i);
      const m = document.createElement('div');
      m.className = 'trn-end' + (hot ? ' hot' : '');
      m.style.transform = `translate(${c.E.x}px, ${c.E.y}px)`;
      this.world().appendChild(m);
      this.markers.push(m);
    }
  },
  overToybox(e){
    const r = $('#trn-toybox').getBoundingClientRect();
    return e.clientX > r.left - 8 && e.clientX < r.right + 8 && e.clientY > r.top - 8 && e.clientY < r.bottom + 8;
  },
  dragMove(e){
    const d = this.drag, f = this.toFloor(e);
    if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 15) d.moved = true;
    // pointer velocity (for the fling-away-to-recycle gesture)
    const now = performance.now();
    if (d.lt && now > d.lt){
      const dt = (now - d.lt) / 1000;
      d.vx = d.vx * 0.65 + ((e.clientX - d.lx) / dt) * 0.35;
      d.vy = d.vy * 0.65 + ((e.clientY - d.ly) / dt) * 0.35;
    }
    d.lt = now; d.lx = e.clientX; d.ly = e.clientY;
    d.p.x = f.x + d.ox;
    d.p.y = f.y + d.oy;
    d.p.rot = d.prev ? d.prev.rot : 0;
    this.placeEl(d.p);
    const box = this.overToybox(e);
    $('#trn-toybox').classList.toggle('open', box);
    const cands = this.candidates(d.p, d.p.x, d.p.y);
    // choose by magnet distance; the bigger network (the main loop) wins only
    // as a tie-breaker, then aim decides chirality/bend
    let best = null;
    for (const c of cands){
      if (!best){ best = c; continue; }
      const better =
        c.mag < best.mag - 10 ? true :
        c.mag > best.mag + 10 ? false :
        c.comp !== best.comp ? c.comp > best.comp :
        c.d < best.d;
      if (better) best = c;
    }
    d.cand = (!box && best) ? best : null;
    if (d.cand){
      this._bridgeSkip = d.p;
      d.cand.bd = this.bridgeDef(d.cand.def, d.cand.k, d.cand.t, d.cand.E);
      this._bridgeSkip = null;
    }
    this.updateMarkers(cands, d.cand ? [d.cand.E, d.cand.bd && d.cand.bd.B].filter(Boolean) : []);
    if (d.cand){
      const bd = d.cand.bd;
      const sig = d.cand.def.key + ':' + d.cand.E.p.id + '.' + d.cand.E.i + ':' + d.cand.k
        + (bd ? ':' + bd.B.p.id + '.' + bd.B.i : '');
      if (!d.ghost || d.ghostSig !== sig){
        if (d.ghost) d.ghost.remove();
        d.ghost = document.createElement('div');
        d.ghost.className = 'trn-piece trn-ghost';
        this.world().appendChild(d.ghost);
        const fake = { def: bd ? bd.def : d.cand.def, key: d.cand.def.key, sw: 0, el: d.ghost };
        this.renderPiece(fake, true);
        d.ghostSig = sig;
      }
      d.ghost.style.transform = `translate(${d.cand.t.x}px, ${d.cand.t.y}px) rotate(${d.cand.t.rot}rad)`;
      d.ghost.style.display = '';
    } else if (d.ghost) d.ghost.style.display = 'none';
  },
  endDrag(e){
    const d = this.drag; this.drag = null;
    if (d.ghost) d.ghost.remove();
    this.updateMarkers();
    $('#trn-toybox').classList.remove('open');
    const p = d.p;
    p.el.classList.remove('trn-drag');
    if (!d.moved && d.fromPicker){ this.autoPlace(p); return; }
    const r = this.area().getBoundingClientRect();
    // a fling means fast at RELEASE (velocity decays through any pre-lift
    // pause), heading off-screen, let go near that edge — a quick drag that
    // stops mid-screen is just an eager builder
    const decay = Math.exp(-(performance.now() - (d.lt || 0)) / 90);
    const vx = d.vx * decay, vy = d.vy * decay;
    const px = e.clientX + vx * 0.15, py = e.clientY + vy * 0.15;
    const edgeDist = Math.min(e.clientX - r.left, r.right - e.clientX, e.clientY - r.top, r.bottom - e.clientY);
    const flung = edgeDist < 90 && Math.hypot(vx, vy) > 1800 &&
      (px < r.left - 30 || px > r.right + 30 || py < r.top - 30 || py > r.bottom + 30);
    const offEdge = e.clientX < r.left + 4 || e.clientX > r.right - 4 || e.clientY > r.bottom - 4;
    if (this.overToybox(e) || flung || offEdge){
      // into the toybox — or hurled off the screen, which means the same thing
      FX.burst(Math.max(r.left + 20, Math.min(r.right - 20, e.clientX)),
        Math.max(r.top + 20, Math.min(r.bottom - 20, e.clientY)), ['#F0B429', '#D9BA8C', '#fff']);
      Audio2.pop();
      if (d.fromPicker){ p.el.remove(); if (p.over) p.over.remove(); if (p.slab) p.slab.remove(); if (p.slab) p.slab.remove(); }
      else this.removePiece(p);
      return;
    }
    if (d.cand){
      const bd = d.cand.bd;
      if (bd){ p.def = bd.def; p.key = bd.def.key; }               // flex track, bent to fit
      else if (d.cand.def !== p.def){ p.def = d.cand.def; p.key = d.cand.def.key; }   // flipped over
      p.x = d.cand.t.x; p.y = d.cand.t.y; p.rot = d.cand.t.rot;
      if (d.fromPicker) this.pieces.push(p);
      this.connect(d.cand.E.p, d.cand.E.i, p, d.cand.k);
      if (bd) this.connect(bd.B.p, bd.B.i, p, bd.farEnd);          // both joints close
      this.closureScan();
      this.repaintAll();
      this.ensureTrain();
      Audio2.clack(0.45);
      return;
    }
    if (this.freeClear(p)){
      // open floor: start a new island right here — its ends become fresh
      // places to build, just like loose track on the carpet
      if (d.fromPicker) this.pieces.push(p);
      this.closureScan();
      this.repaintAll();
      this.ensureTrain();
      Audio2.clack(0.3);
      return;
    }
    if (d.prev){
      // dropped onto existing track: the piece hops back where it was
      p.x = d.prev.x; p.y = d.prev.y; p.rot = d.prev.rot;
      p.conn = d.prev.conn;
      for (const i in p.conn){
        const o = this.byId(p.conn[i].p);
        if (o) o.conn[p.conn[i].e] = { p: p.id, e: +i };
        else delete p.conn[i];
      }
      this.repaintAll();
    } else {
      p.el.remove(); if (p.over) p.over.remove(); if (p.slab) p.slab.remove();
    }
  },
  // a plain TAP on a picker button (no drag): the piece flies to the open end
  // nearest the middle of the layout, or onto clear floor if nothing is open
  autoPlace(p){
    const r0 = this.area().getBoundingClientRect();
    const mid = this.toFloor({ clientX: r0.left + r0.width / 2, clientY: r0.top + r0.height / 2 });
    const cx = mid.x, cy = mid.y;
    const settle = () => {
      this.pieces.push(p);
      p.el.classList.add('trn-fly');
      this.renderPiece(p);
      setTimeout(() => p.el.classList.remove('trn-fly'), 420);
    };
    let best = null;
    for (const c of this.candidates(p, p.x, p.y, true)){
      const dc = Math.hypot(c.t.x - cx, c.t.y - cy);
      if (!best || dc < best.dc){ best = c; best.dc = dc; }
    }
    if (best){
      const bd = this.bridgeDef(best.def, best.k, best.t, best.E);
      if (bd){ p.def = bd.def; p.key = bd.def.key; }
      else if (best.def !== p.def){ p.def = best.def; p.key = best.def.key; }
      p.x = best.t.x; p.y = best.t.y; p.rot = best.t.rot;
      settle();
      this.connect(best.E.p, best.E.i, p, best.k);
      if (bd) this.connect(bd.B.p, bd.B.i, p, bd.farEnd);
      this.closureScan();
      this.repaintAll();
      this.ensureTrain();
      Audio2.clack(0.45);
      return;
    }
    for (let ring = 0; ring < 8; ring++) for (let k = 0; k < 8; k++){
      const a = k * Math.PI / 4 + ring * 0.4;
      p.x = cx + Math.cos(a) * ring * this.S * 0.7;
      p.y = cy + Math.sin(a) * ring * this.S * 0.7;
      p.rot = 0;
      if (this.freeClear(p)){ settle(); this.saveLayout(); this.ensureTrain(); Audio2.clack(0.3); return; }
    }
    p.el.remove(); if (p.over) p.over.remove(); if (p.slab) p.slab.remove();
  },
  freeClear(p){
    // never under the part list, never hanging off the visible floor
    const ops = $('#trn-ops').getBoundingClientRect(), ar = this.area().getBoundingClientRect(), c = this.cam;
    const opsFloorY = (((ops.bottom - ar.top) / this.SQ) - c.y) / c.zoom;
    const vx0 = (0 - c.x) / c.zoom, vx1 = (ar.width - c.x) / c.zoom;
    const vy1 = (ar.height / this.SQ - c.y) / c.zoom;
    if (p.y < opsFloorY + this.S * 0.45) return false;
    if (p.x < vx0 + this.S * 0.4 || p.x > vx1 - this.S * 0.4 || p.y > vy1 - this.S * 0.35) return false;
    const lim = this.TW * 0.9;
    for (const o of this.pieces){
      if (o === p) continue;
      for (const rt of p.def.routes) for (let i = 0; i < rt.pts.length; i += 2){
        const w = this.toWorld(p, rt.pts[i][0], rt.pts[i][1]);
        for (const rt2 of o.def.routes) for (let j = 0; j < rt2.pts.length; j += 2){
          const w2 = this.toWorld(o, rt2.pts[j][0], rt2.pts[j][1]);
          if (Math.hypot(w.x - w2.x, w.y - w2.y) < lim) return false;
        }
      }
    }
    return true;
  },

  /* ── pointer routing: tap = toggle/trigger, drag = move piece ──────────── */
  hitPiece(px, py){
    // the NEAREST rail wins — first-match order made taps near parallel
    // tracks grab whichever piece happened to sit later in the list
    let best = null;
    for (let i = 0; i < this.pieces.length; i++){
      const p = this.pieces[i];
      if (Math.hypot(px - p.x, py - p.y) > this.S * 1.4) continue;
      const c = Math.cos(-p.rot), s = Math.sin(-p.rot);
      const lx = (px - p.x) * c - (py - p.y) * s, ly = (px - p.x) * s + (py - p.y) * c;
      let d = Infinity;
      for (const rt of p.def.routes)
        for (let u = 1; u < rt.pts.length; u++){
          // true distance to the segment, not just its sample points
          const ax = rt.pts[u - 1][0], ay = rt.pts[u - 1][1];
          const vx = rt.pts[u][0] - ax, vy = rt.pts[u][1] - ay;
          const t = Math.max(0, Math.min(1, ((lx - ax) * vx + (ly - ay) * vy) / ((vx * vx + vy * vy) || 1)));
          d = Math.min(d, Math.hypot(lx - (ax + vx * t), ly - (ay + vy * t)));
        }
      if (d > this.TW * 0.72) continue;
      // near-ties go to the piece drawn on top (later in the array)
      if (!best || d < best.d - 3 || (Math.abs(d - best.d) <= 3 && i > best.i)) best = { p, d, i };
    }
    if (best) return best.p;
    // decorations (tower, platform, lever…) as a fallback — nearest wins
    let deco = null;
    for (const p of this.pieces){
      if (p.key === 'straight' || p.key === 'curve' || p.key === 'curveS') continue;
      const d = Math.hypot(px - p.x, py - p.y);
      if (d < this.S * 0.7 && (!deco || d < deco.d)) deco = { p, d };
    }
    return deco ? deco.p : null;
  },
  onDown(e){
    if (!this.active || this.drag) return;
    const f = this.toFloor(e);
    const p = this.hitPiece(f.x, f.y);
    if (!p) return;
    e.preventDefault();
    this.touch = { p, x: e.clientX, y: e.clientY, e };
  },
  onMove(e){
    // pulling a single car off the train?
    if (this.carTouch && !this.carDrag
        && Math.hypot(e.clientX - this.carTouch.x, e.clientY - this.carTouch.y) > 12){
      this.carDrag = true;
      const c = this.carTouch.car, T = this.carTouch.train, tc = T.cars;
      const idx = tc.indexOf(c);
      if (idx >= 0){
        tc.splice(idx, 1);
        for (let i = Math.max(1, idx); i < tc.length; i++) this.seatBehind(tc[i - 1], tc[i]);
        if (!tc.length){
          // that was the whole consist — the (car-less) train dissolves
          this.trains = this.trains.filter(t => t !== T);
          if (this.activeT === T) this.activeT = this.trains[0] || null;
        } else if (!tc.some(c => c.type === 'engine')){
          // pulling the engine away leaves the wagons standing, not rolling
          T.running = false; T.stuck = false;
        }
      }
      c.el.classList.add('trn-carry');
    }
    if (this.carDrag){
      const f = this.toFloor(e);
      this.carSprite(this.carTouch.car, { x: f.x, y: f.y, a: 0 });
      $('#trn-toybox').classList.toggle('open', this.overToybox(e));
      return;
    }
    // carrying the train?
    if (this.trainTouch && !this.trainDrag
        && Math.hypot(e.clientX - this.trainTouch.x, e.clientY - this.trainTouch.y) > 12){
      this.trainDrag = true;
      for (const c of this.trainTouch.train.cars) c.el.classList.add('trn-carry');
    }
    if (this.trainDrag){
      const f = this.toFloor(e), tt = this.trainTouch;
      // a short trail of recent motion — read at the drop to get the swoop
      const now2 = performance.now();
      tt.trail = tt.trail || [];
      tt.trail.push({ t: now2, x: f.x, y: f.y, cx: e.clientX, cy: e.clientY });
      while (tt.trail.length > 1 && now2 - tt.trail[0].t > 320) tt.trail.shift();
      // engine under the finger, every car trailing exactly as it hung at pickup
      tt.train.cars.forEach((c, i) =>
        this.carSprite(c, { x: f.x + tt.deltas[i].dx, y: f.y + tt.deltas[i].dy, a: tt.deltas[i].a }));
      $('#trn-toybox').classList.toggle('open', this.overToybox(e) && (tt.train.cars.length > 2 || this.trains.length > 1));
      const near = this.nearestTrack(f.x, f.y);
      if (!this.dropMark){
        this.dropMark = document.createElement('div');
        this.dropMark.className = 'trn-end hot';
        this.world().appendChild(this.dropMark);
      }
      this.dropMark.style.display = near ? '' : 'none';
      if (near){
        const rt = near.p.def.routes[near.r];
        let i = 0; while (i < rt.cum.length - 1 && rt.cum[i] < near.d) i++;
        const wp = this.toWorld(near.p, rt.pts[i][0], rt.pts[i][1]);
        this.dropMark.style.transform = `translate(${wp.x}px, ${wp.y}px)`;
      }
      return;
    }
    if (this.drag){ this.dragMove(e); return; }
    const t = this.touch;
    if (!t) return;
    if (Math.hypot(e.clientX - t.x, e.clientY - t.y) > 12){
      const p = t.p; this.touch = null;
      if (this.trains.some(T => T.cars.some(c => c.p === p))){
        p.el.classList.remove('trn-no'); void p.el.offsetWidth;
        p.el.classList.add('trn-no');            // the train is standing on it
        return;
      }
      this.beginDrag(p, false, e);
      this.dragMove(e);
    }
  },
  onUp(e){
    if (this.carTouch){
      const ct = this.carTouch; this.carTouch = null;
      if (!this.carDrag) return;
      this.carDrag = false;
      ct.car.el.classList.remove('trn-carry');
      $('#trn-toybox').classList.remove('open');
      void 0;
      const r = this.area().getBoundingClientRect();
      const edgeDist = Math.min(e.clientX - r.left, r.right - e.clientX, e.clientY - r.top, r.bottom - e.clientY);
      if (this.overToybox(e) || edgeDist < 8){
        // into the toybox (or off the edge): the car is put away
        ct.car.el.remove();
        FX.burst(e.clientX, e.clientY, ['#F0B429', '#8A929C', '#fff']);
        Audio2.pop();
      } else {
        const f = this.toFloor(e);
        const near = this.nearestTrack(f.x, f.y);
        const alive = this.trains.includes(ct.train);
        if (near){
          // dropped on a rail: the car stands right there as its own little
          // consist, waiting for a passing train to collect it
          const T2 = this.newTrain(ct.car.lv ?? ct.train.livery);
          T2.running = false;
          T2.cars.push(ct.car);
          const rt = near.p.def.routes[near.r];
          ct.car.p = near.p; ct.car.r = near.r; ct.car.fw = true;
          ct.car.s = Math.max(0, Math.min(rt.len, near.d));
          this.trains.push(T2);
          Audio2.clack(0.4);
        } else if (alive){
          // dropped on the floor: it hops back onto the end of its train
          const last = ct.train.cars[ct.train.cars.length - 1];
          ct.train.cars.push(ct.car);
          this.seatBehind(last, ct.car);
          Audio2.clack(0.35);
        } else {
          // its old train dissolved and there is no rail here: put it away
          ct.car.el.remove();
          Audio2.pop();
        }
      }
      this.saveLayout();
      this.placeTrain();
      return;
    }
    if (this.trainTouch){
      const tt = this.trainTouch; this.trainTouch = null;
      const T = tt.train;
      if (!this.trainDrag){
        // a plain tap: stop or go — a train stuck at a dead end goes back the
        // other way (engine running around to the front)
        T.running = !T.running;
        if (T.running && T.stuck){ this.reverse(T); T.stuck = false; }
        if (T.running) Audio2.clack(0.3);
        return;
      }
      this.trainDrag = false;
      for (const c of T.cars) c.el.classList.remove('trn-carry');
      if (this.dropMark){ this.dropMark.remove(); this.dropMark = null; }
      $('#trn-toybox').classList.remove('open');
      const restore = () => T.cars.forEach((c, i) => Object.assign(c, tt.prev[i]));
      if (this.overToybox(e)){
        if (T.cars.length > 2){
          // the toybox takes the LAST car off this train
          const gone = T.cars.pop();
          gone.el.remove();
          this.saveLayout();
          FX.burst(e.clientX, e.clientY, ['#F0B429', '#8A929C', '#fff']);
          Audio2.pop();
          restore();
          this.placeTrain();
          return;
        }
        if (this.trains.length > 1){
          // a bare engine+tender goes away entirely (there are others)
          this.removeTrain(T);
          this.saveLayout();
          FX.burst(e.clientX, e.clientY, ['#F0B429', '#8A929C', '#fff']);
          Audio2.pop();
          this.placeTrain();
          return;
        }
      }
      const f = this.toFloor(e);
      const near = this.nearestTrack(f.x, f.y);
      if (near){
        this.placeTrainAt(near, T);
        const eng = T.cars[0];
        // face the SWOOP direction when the drop was in motion (this is how a
        // train gets turned around); a still drop keeps the carried facing.
        // Any deliberate motion in the last ~1/3 second counts — holding
        // still before release ages the trail out and keeps the old facing.
        const nowU = performance.now();
        const recent = (tt.trail || []).filter(q => nowU - q.t < 320);
        let face = tt.ea;
        if (recent.length > 1){
          const a = recent[0], b = recent[recent.length - 1];
          if (Math.hypot(b.cx - a.cx, b.cy - a.cy) > 34)
            face = Math.atan2(b.y - a.y, b.x - a.x);
        }
        if (Math.abs(wrap(this.statePos(eng).a - face)) > Math.PI / 2){
          eng.fw = !eng.fw;
          const len = eng.p.def.routes[eng.r].len;
          eng.s = len - eng.s;
          this.placeTrainAt({ p: eng.p, r: eng.r, d: eng.fw ? eng.s : len - eng.s }, T);
        }
        Audio2.clack(0.4);
      } else {
        restore();
      }
      this.placeTrain();
      return;
    }
    if (this.drag){ this.endDrag(e); return; }
    const t = this.touch; this.touch = null;
    if (!t) return;
    const p = t.p;
    if (p.key === 'swl' || p.key === 'swr'){
      p.sw ^= 1;
      this.renderPiece(p);
      this.saveLayout();
      Audio2.snapSnd();
    }
    else if (p.key === 'water') this.pourWater(p);
    else if (p.key === 'coal') this.dropCoal(p);
    else if (p.key === 'station') Audio2.bell();
  },

  /* ── the train ─────────────────────────────────────────────────────────── */
  // die-cast liveries for the engine (tap the engine button to cycle)
  LIVERIES: [
    { body: '#2C6FD6', dark: '#1D3557', hi: '#5D93E6', cab: '#F0B429' },   // blue
    { body: '#3FA34D', dark: '#1F5D2A', hi: '#74C983', cab: '#F0B429' },   // green
    { body: '#C2412F', dark: '#7e2418', hi: '#DE7361', cab: '#F0B429' },   // red
    { body: '#E8B004', dark: '#8F6A14', hi: '#F4CE55', cab: '#2C6FD6' },   // yellow
  ],
  layKit(){
    return {
      n: x => (+x).toFixed(1),
      lay: svg => `<div class="trn-layer" style="position:absolute;left:0;top:0">${svg}</div>`,
      box: (w, h) => `<svg viewBox="${-w/2} ${-h/2} ${w} ${h}"
        style="position:absolute;left:${-w/2}px;top:${-h/2}px;width:${w}px;height:${h}px;overflow:visible">`,
    };
  },
  chassisSVG(L, W, wheels, n, couplers){
    const coup = dx => `<path d="M ${n(dx * L / 2)} 0 L ${n(dx * (L / 2 + W * 0.24))} 0" stroke="#3a3f45" stroke-width="${n(W * 0.09)}"/>
      <circle cx="${n(dx * (L / 2 + W * 0.27))}" cy="0" r="${n(W * 0.11)}" fill="#B9BEC5" stroke="#555E68" stroke-width="1.2"/>
      <circle cx="${n(dx * (L / 2 + W * 0.27))}" cy="0" r="${n(W * 0.05)}" fill="#555E68"/>`;
    return `<ellipse cx="0" cy="${n(W*0.12)}" rx="${n(L*0.57)}" ry="${n(W*0.73)}" fill="#000" opacity=".22"/>
      ${(couplers || []).map(coup).join('')}
      ${wheels.map(x =>
        `<circle cx="${n(x)}" cy="${n(-W*0.46)}" r="${n(W*0.17)}" fill="#16181c" stroke="#8A929C" stroke-width="1.3"/>
         <circle cx="${n(x)}" cy="${n(W*0.46)}" r="${n(W*0.17)}" fill="#16181c" stroke="#8A929C" stroke-width="1.3"/>`).join('')}
      <rect x="${n(-L/2)}" y="${n(-W*0.38)}" width="${n(L)}" height="${n(W*0.76)}" rx="3" fill="#20262D"/>`;
  },
  engineEl(livery){
    const S = this.S, EL = S * 0.56, EW = S * 0.27;
    const { n, lay, box } = this.layKit(), LV = this.LIVERIES[livery || 0];
    const el = document.createElement('div');
    el.className = 'trn-train trn-eng';
    el.innerHTML =
      lay(box(EL, EW) + this.chassisSVG(EL, EW, [-EL*0.30, -EL*0.02, EL*0.26], n, [-1])
        + `<rect x="${n(EL/2-3)}" y="${n(-EW*0.42)}" width="4.5" height="${n(EW*0.84)}" rx="2" fill="#C2412F"/></svg>`)
      + lay(box(EL, EW) + `
        <rect x="${n(-EL/2+1)}" y="${n(-EW/2+1)}" width="${n(EL-2)}" height="${n(EW-2)}" rx="${n(EW*0.26)}" fill="${LV.body}" stroke="${LV.dark}" stroke-width="2"/>
        <rect x="${n(-EL/2+1)}" y="${n(-EW*0.14)}" width="${n(EL-2)}" height="${n(EW*0.28)}" rx="${n(EW*0.12)}" fill="${LV.hi}" opacity=".55"/>
        <rect x="${n(EL*0.2)}" y="${n(-EW/2+2)}" width="${n(EL*0.24)}" height="${n(EW-4)}" rx="${n(EW*0.12)}" fill="#363E47"/>
        <rect x="${n(-EL/2+2)}" y="${n(-EW/2+1.5)}" width="${n(EL*0.28)}" height="${n(EW-3)}" rx="3" fill="${LV.cab}" stroke="#8F6A14" stroke-width="1.5"/></svg>`)
      + lay(box(EL, EW) + `
        <rect x="${n(-EL/2)}" y="${n(-EW/2-1)}" width="${n(EL*0.30)}" height="${n(EW+2)}" rx="4" fill="${LV.dark}"/>
        <rect x="${n(-EL/2+3)}" y="${n(-EW/2+2)}" width="${n(EL*0.30-6)}" height="${n(EW-4)}" rx="3" fill="${LV.body}"/>
        <circle cx="${n(EL*0.28)}" cy="0" r="${n(EW*0.17)}" fill="#20262D" stroke="#0E1216" stroke-width="1.5"/>
        <circle cx="${n(EL*0.28)}" cy="0" r="${n(EW*0.08)}" fill="#000"/>
        <circle cx="${n(-EL*0.02)}" cy="0" r="${n(EW*0.12)}" fill="#CFAE4E" stroke="#8F6A14" stroke-width="1.4"/></svg>`)
      + lay(box(EW, EW) + `
        <circle r="${n(EW*0.26)}" fill="#C8CBD0" stroke="#7A8089" stroke-width="1.6"/>
        <ellipse cx="${n(-EW*0.09)}" cy="${n(-EW*0.07)}" rx="${n(EW*0.055)}" ry="${n(EW*0.075)}" fill="#fff" stroke="#5c6169" stroke-width="0.8"/>
        <ellipse cx="${n(EW*0.09)}" cy="${n(-EW*0.07)}" rx="${n(EW*0.055)}" ry="${n(EW*0.075)}" fill="#fff" stroke="#5c6169" stroke-width="0.8"/>
        <circle cx="${n(-EW*0.085)}" cy="${n(-EW*0.055)}" r="${n(EW*0.028)}" fill="#1b1e22"/>
        <circle cx="${n(EW*0.095)}" cy="${n(-EW*0.055)}" r="${n(EW*0.028)}" fill="#1b1e22"/>
        <ellipse cx="0" cy="${n(EW*0.035)}" rx="${n(EW*0.04)}" ry="${n(EW*0.028)}" fill="#aeb3ba"/>
        <path d="M ${n(-EW*0.12)} ${n(EW*0.11)} Q 0 ${n(EW*0.20)} ${n(EW*0.12)} ${n(EW*0.11)}" stroke="#2b2f34" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>`);
    return el;
  },
  carEl(type, lv){
    const S = this.S, CL = S * 0.42, CW = S * 0.24;
    const { n, lay, box } = this.layKit();
    const el = document.createElement('div');
    el.className = 'trn-train trn-car';
    let body = '', top = '';
    if (type === 'tender'){
      // the engine's coal car, painted to match its engine so the pair reads
      // as a unit — an open tray with a visible pile of coal
      const L = this.LIVERIES[lv | 0] || this.LIVERIES[0];
      body = `<rect x="${n(-CL/2)}" y="${n(-CW/2)}" width="${n(CL)}" height="${n(CW)}" rx="4" fill="${L.body}" stroke="${L.dark}" stroke-width="2"/>
        <rect x="${n(-CL/2+5)}" y="${n(-CW/2+5)}" width="${n(CL-10)}" height="${n(CW-10)}" rx="3" fill="#23262B" stroke="#111318" stroke-width="1"/>
        <g class="trn-lumps">${[[-CL*0.18,-CW*0.1],[CL*0.02,CW*0.09],[CL*0.2,-CW*0.05]].map(([x,y]) =>
          `<circle cx="${n(x)}" cy="${n(y)}" r="${n(CW*0.19)}" fill="#1a1d21" stroke="#4a5058" stroke-width="1.2"/>
           <circle cx="${n(x-CW*0.05)}" cy="${n(y-CW*0.06)}" r="${n(CW*0.05)}" fill="#5c636c"/>`).join('')}</g>`;
    } else if (type === 'tanker'){
      body = `<rect x="${n(-CL/2)}" y="${n(-CW/2)}" width="${n(CL)}" height="${n(CW)}" rx="${n(CW*0.5)}" fill="#B9BEC5" stroke="#6E747E" stroke-width="2"/>
        <rect x="${n(-CL/2)}" y="${n(-CW*0.14)}" width="${n(CL)}" height="${n(CW*0.28)}" rx="${n(CW*0.14)}" fill="#D5D9DE" opacity=".7"/>
        <rect x="${n(-CL*0.42)}" y="${n(-CW/2)}" width="${n(CW*0.14)}" height="${n(CW)}" rx="2" fill="#8A929C"/>
        <rect x="${n(CL*0.3)}" y="${n(-CW/2)}" width="${n(CW*0.14)}" height="${n(CW)}" rx="2" fill="#8A929C"/>`;
      top = `<circle cx="0" cy="0" r="${n(CW*0.16)}" fill="#8A929C" stroke="#555E68" stroke-width="1.6"/>
        <circle cx="0" cy="0" r="${n(CW*0.07)}" fill="#555E68"/>`;
    } else if (type === 'boxcar'){
      body = `<rect x="${n(-CL/2)}" y="${n(-CW/2)}" width="${n(CL)}" height="${n(CW)}" rx="3" fill="#8B5A2B" stroke="#5c3b1c" stroke-width="2"/>
        <rect x="${n(-CW*0.14)}" y="${n(-CW/2+2)}" width="${n(CW*0.28)}" height="${n(CW-4)}" fill="#A9713A" stroke="#5c3b1c" stroke-width="1.2"/>`;
      top = `<rect x="${n(-CL/2+2)}" y="${n(-CW/2+2)}" width="${n(CL-4)}" height="${n(CW-4)}" rx="3" fill="#6b431a" stroke="#4a2e10" stroke-width="1.5"/>
        <path d="M ${n(-CL/2+4)} 0 H ${n(CL/2-4)}" stroke="#8B5A2B" stroke-width="1.4"/>`;
    } else {   // coach — the cheerful orange passenger car
      body = `<rect x="${n(-CL/2)}" y="${n(-CW/2)}" width="${n(CL)}" height="${n(CW)}" rx="${n(CW*0.2)}" fill="#E8933C" stroke="#9c5a1a" stroke-width="2"/>
        ${[-CL*0.3, -CL*0.06, CL*0.18].map(x =>
          `<rect x="${n(x)}" y="${n(-CW*0.32)}" width="${n(CL*0.16)}" height="${n(CW*0.64)}" rx="2" fill="#F6E7C8" stroke="#9c5a1a" stroke-width="1"/>`).join('')}`;
      top = `<rect x="${n(-CL/2+2)}" y="${n(-CW/2+1.5)}" width="${n(CL-4)}" height="${n(CW-3)}" rx="${n(CW*0.18)}" fill="#8A929C" stroke="#555E68" stroke-width="1.5" opacity=".95"/>`;
    }
    el.innerHTML = lay(box(CL, CW) + this.chassisSVG(CL, CW, [-CL*0.24, CL*0.24], n, [1, -1]) + '</svg>')
      + lay(box(CL, CW) + body + '</svg>')
      + (top ? lay(box(CL, CW) + top + '</svg>') : '');
    return el;
  },
  // spawn an INDEPENDENT train — every engine button adds one more
  newTrain(livery){
    return { id: ++this.seq, livery: livery || 0, cars: [], running: true, stuck: false,
      pausedUntil: 0, boostUntil: 0, coal: 0, coalTimer: 0, puffTimer: 0,
      prevMidD: null, prevMidPiece: 0 };
  },
  makeEngineCar(lv){
    const S = this.S, EL = S * 0.56, H1 = S * 0.055, H2 = S * 0.115;
    const el = this.engineEl(lv);
    const eng = { p: null, r: 0, s: 0, fw: true, el, type: 'engine', lv,
      layers: [[el.children[1], H1 / this.SQ], [el.children[2], H2 / this.SQ]],
      face: { el: el.children[3], fx: EL * 0.5, k: (S * 0.09) / this.SQ } };
    el.addEventListener('pointerdown', e => {
      e.stopPropagation(); e.preventDefault();
      Audio2.unlock();
      // ownership can change after a coupling: find who holds this engine NOW
      const owner = this.trains.find(t => t.cars.includes(eng));
      if (!owner) return;
      this.activeT = owner;
      if (owner.cars[0] !== eng){
        // absorbed mid-train engine: behaves like a car (pull it off)
        this.carTouch = { train: owner, car: eng, x: e.clientX, y: e.clientY };
        return;
      }
      const ep = this.statePos(owner.cars[0]);
      this.trainTouch = { train: owner, x: e.clientX, y: e.clientY, ea: ep.a,
        deltas: owner.cars.map(c => { const cp = this.statePos(c); return { dx: cp.x - ep.x, dy: cp.y - ep.y, a: cp.a }; }),
        prev: owner.cars.map(c => this.snapState(c)) };
    });
    this.world().appendChild(el);
    return eng;
  },
  // can a train that starts here just keep going? Walks the conn graph the
  // same way the follower does — false means the seat leads to a dead end
  seatsALoop(home){
    let st = { p: home, r: 0, fw: true };
    for (let i = 0; i < 120; i++){
      const rt = st.p.def.routes[st.r];
      const exit = st.fw ? rt.b : rt.a;
      if (exit === -1) return false;
      const cn = st.p.conn[exit];
      if (!cn) return false;
      const np = this.byId(cn.p);
      if (!np) return false;
      const ne = cn.e;
      let nr = (np.key === 'swl' || np.key === 'swr') && ne === 0
        ? np.sw
        : np.def.routes.findIndex(r => r.a === ne || r.b === ne);
      if (nr < 0) nr = 0;
      st = { p: np, r: nr, fw: np.def.routes[nr].a === ne };
      if (st.p === home) return true;
    }
    return false;
  },
  spawnTrain(livery, opts = {}){
    if (!this.pieces.length) return null;
    const T = this.newTrain(livery);
    const eng = this.makeEngineCar(T.livery);
    // seat away from other engines — but ONLY where the train can actually
    // run: never on a buffer, and never down a dead-end spur when the
    // layout has a loop to ride
    let cand = this.pieces.filter(p => p.key !== 'buffer' && this.seatsALoop(p));
    if (!cand.length) cand = this.pieces.filter(p => p.key !== 'buffer');
    if (!cand.length) cand = this.pieces;
    let home = opts.homePiece || cand[0], best = -1;
    if (!opts.homePiece && this.trains.length){
      for (const p of cand){
        let d = Infinity;
        for (const o of this.trains) d = Math.min(d, Math.hypot(p.x - o.cars[0].p.x, p.y - o.cars[0].p.y));
        if (d > best){ best = d; home = p; }
      }
    }
    eng.p = home; eng.s = home.def.routes[0].len * 0.7;
    T.cars.push(eng);
    this.trains.push(T);
    this.activeT = T;
    this.addCarTo(T, 'tender', true);
    for (const t of (opts.carTypes || [])) this.addCarTo(T, t, true);
    this.syncCoal(T);
    this.placeTrain();
    return T;
  },
  removeTrain(T){
    for (const c of T.cars) c.el.remove();
    this.trains = this.trains.filter(x => x !== T);
    if (this.activeT === T) this.activeT = this.trains[0] || null;
  },
  addCar(type, silent){
    const T = this.activeT || this.trains[0];
    return T ? this.addCarTo(T, type, silent) : false;
  },
  makeWagonCar(type, lv){
    const el = this.carEl(type, lv);
    this.world().appendChild(el);
    const S = this.S, H1 = S * 0.055, H2 = S * 0.115;
    const layers = [[el.children[1], H1 / this.SQ]];
    if (el.children[2]) layers.push([el.children[2], H2 / this.SQ]);
    const st = { p: null, r: 0, s: 0, fw: true, el, type, layers };
    if (type === 'tender') st.lv = lv | 0;
    el.addEventListener('pointerdown', e => {
      e.stopPropagation(); e.preventDefault();
      Audio2.unlock();
      // ownership can change after couplings and drop-offs: resolve NOW
      const owner = this.trains.find(t => t.cars.includes(st));
      if (!owner) return;
      this.activeT = owner;
      this.carTouch = { train: owner, car: st, x: e.clientX, y: e.clientY };
    });
    return st;
  },
  addCarTo(T, type, silent){
    if (T.cars.length >= 8) return false;
    const last = T.cars[T.cars.length - 1];
    const st = this.makeWagonCar(type, T.livery);
    st.p = last.p; st.r = last.r; st.s = last.s; st.fw = last.fw;
    T.cars.push(st);
    this.seatBehind(last, st);
    if (!silent){ Audio2.clack(0.4); this.placeTrain(); this.saveLayout(); }
    return true;
  },
  seatBehind(prev, st){
    const rt = prev.p.def.routes[prev.r];
    const back = { p: prev.p, r: prev.r, s: rt.len - prev.s, fw: !prev.fw };
    this.advanceState(back, this.S * 0.52, false);
    const bl = back.p.def.routes[back.r].len;
    st.p = back.p; st.r = back.r; st.fw = !back.fw; st.s = bl - back.s;
  },

  syncCoal(T){
    if (!T) return;
    const ten = T.cars.find(c => c.type === 'tender');
    const g = ten && ten.el.querySelector('.trn-lumps');
    // each lump is a coal circle + its glint — dim the pair together
    if (g) [...g.children].forEach((c, i) => c.style.opacity = (i >> 1) < T.coal ? 1 : 0.25);
  },
  routePoint(p, rt, d){
    const pts = rt.pts, cum = rt.cum;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const t = (d - cum[i-1]) / (cum[i] - cum[i-1] || 1);
    const x = pts[i-1][0] + (pts[i][0] - pts[i-1][0]) * t;
    const y = pts[i-1][1] + (pts[i][1] - pts[i-1][1]) * t;
    const a = Math.atan2(pts[i][1] - pts[i-1][1], pts[i][0] - pts[i-1][0]);
    const w = this.toWorld(p, x, y);
    return { x: w.x, y: w.y, a: wrap(a + p.rot) };
  },
  statePos(st){
    const rt = st.p.def.routes[st.r];
    const d = st.fw ? st.s : rt.len - st.s;
    const pt = this.routePoint(st.p, rt, Math.max(0, Math.min(rt.len, d)));
    if (!st.fw) pt.a = wrap(pt.a + Math.PI);
    return pt;
  },
  // walk a follower ds forward; false = hit a dead end (caller reverses)
  advanceState(st, ds, isEngine){
    let guard = 0;
    while (ds > 0 && ++guard < 8){
      const rt = st.p.def.routes[st.r], rem = rt.len - st.s;
      if (ds < rem){ st.s += ds; return true; }
      ds -= rem;
      const exit = st.fw ? rt.b : rt.a;
      if (exit === -1){ st.s = rt.len; return false; }
      const conn = st.p.conn[exit];
      if (!conn){ st.s = rt.len; return false; }
      const np = this.byId(conn.p);
      if (!np){ st.s = rt.len; return false; }
      const ne = conn.e;
      let nr = np.def.routes.findIndex((r, i) =>
        (r.a === ne || r.b === ne) && !((np.key === 'swl' || np.key === 'swr') && ne === 0 && i !== (isEngine ? np.sw : (np._lastRoute ?? np.sw))));
      if (nr < 0) nr = 0;
      if (isEngine && (np.key === 'swl' || np.key === 'swr') && ne === 0) np._lastRoute = nr;
      st.p = np; st.r = nr; st.s = 0;
      st.fw = np.def.routes[nr].a === ne;
      if (isEngine) this.prevMidD = null;   // fresh piece: rearm the mid trigger
    }
    return true;
  },
  // direction change (kid taps a stuck train): every car flips, and the
  // engine RUNS AROUND to lead the new direction — toy engines pull, not push
  reverse(T){
    for (const st of T.cars){
      const rt = st.p.def.routes[st.r];
      st.fw = !st.fw; st.s = rt.len - st.s;
    }
    const last = T.cars[T.cars.length - 1], eng = T.cars[0];
    if (last !== eng){
      eng.p = last.p; eng.r = last.r; eng.fw = last.fw; eng.s = last.s;
      for (let i = 1; i < T.cars.length; i++) this.seatBehind(T.cars[i - 1], T.cars[i]);
    }
    T.prevMidD = null;
    Audio2.clack(0.25);
  },
  carSprite(c, pos){
    c.el.style.transform = `translate(${pos.x}px, ${pos.y}px) rotate(${pos.a}rad)`;
    // Z-height: each body layer slides toward SCREEN-up inside the rotated,
    // squashed frame — the local vector R(−a)·(0, −h/SQ), refreshed per frame
    if (c.layers) for (const [el, k] of c.layers)
      el.style.transform = `translate(${(-k * Math.sin(pos.a)).toFixed(1)}px, ${(-k * Math.cos(pos.a)).toFixed(1)}px)`;
    // the face billboard: at the smokebox front, upright and round on screen
    const F = c.face;
    if (F) F.el.style.transform =
      `translate(${(F.fx - F.k * Math.sin(pos.a)).toFixed(1)}px, ${(-F.k * Math.cos(pos.a)).toFixed(1)}px)`
      + ` rotate(${(-pos.a).toFixed(3)}rad) scale(1, ${(1 / this.SQ).toFixed(3)})`;
  },
  placeTrain(){
    for (const T of this.trains)
      for (const c of T.cars) this.carSprite(c, this.statePos(c));
  },
  snapState(st){ return { p: st.p, r: st.r, s: st.s, fw: st.fw }; },
  // nearest point on any rail — for re-railing a carried train
  nearestTrack(x, y){
    let best = null;
    for (const p of this.pieces) for (let ri = 0; ri < p.def.routes.length; ri++){
      const rt = p.def.routes[ri];
      for (let i = 0; i < rt.pts.length; i++){
        const w = this.toWorld(p, rt.pts[i][0], rt.pts[i][1]);
        const dist = Math.hypot(x - w.x, y - w.y);
        if (!best || dist < best.dist) best = { p, r: ri, d: rt.cum[i], dist };
      }
    }
    return best && best.dist < this.S * 0.7 ? best : null;
  },
  placeTrainAt(near, T){
    T = T || this.trains[0];
    if (!T) return;
    const len = near.p.def.routes[near.r].len, eng = T.cars[0];
    eng.p = near.p; eng.r = near.r;
    eng.s = eng.fw ? near.d : len - near.d;
    for (let i = 1; i < T.cars.length; i++) this.seatBehind(T.cars[i - 1], T.cars[i]);
    T.prevMidD = null; T.stuck = false;
  },

  /* ── interactive pieces ────────────────────────────────────────────────── */
  dropCoal(p){
    if (p._cool > performance.now()) return;
    p._cool = performance.now() + 2500;
    const w = this.toWorld(p, 0, -this.TW * 0.5);
    for (let i = 0; i < 3; i++){
      const lump = document.createElement('div');
      lump.className = 'trn-lump';
      lump.style.left = (w.x + (Math.random() - 0.5) * 10) + 'px';
      lump.style.top = w.y + 'px';
      lump.style.animationDelay = i * 110 + 'ms';
      this.world().appendChild(lump);
      setTimeout(() => lump.remove(), 900 + i * 110);
    }
    Audio2.clack(0.5);
    const T = arguments[1] || this.nearestTrainTo(p) || this.trains[0];
    if (T){ T.coal = 3; T.coalTimer = performance.now(); this.syncCoal(T); }
  },
  nearestTrainTo(p){
    let best = null, bd = Infinity;
    for (const T of this.trains){
      const d = Math.hypot(T.cars[0].p.x - p.x, T.cars[0].p.y - p.y);
      if (d < bd){ bd = d; best = T; }
    }
    return best;
  },
  pourWater(p){
    if (p._cool > performance.now()) return;
    p._cool = performance.now() + 3200;
    if (p.over){
      const spout = p.over.querySelector('.trw-spout');
      if (spout){
        spout.classList.add('pour');
        setTimeout(() => spout.classList.remove('pour'), 2600);
      }
    }
    const w = this.toWorld(p, 0, -this.TW * 0.2);
    for (let i = 0; i < 5; i++){
      const drop = document.createElement('div');
      drop.className = 'trn-drop';
      drop.style.left = (w.x + (Math.random() - 0.5) * 8) + 'px';
      drop.style.top = w.y + 'px';
      drop.style.animationDelay = (500 + i * 160) + 'ms';
      this.world().appendChild(drop);
      setTimeout(() => drop.remove(), 1600 + i * 160);
    }
    Audio2.pop();
    const T = arguments[1] || this.nearestTrainTo(p) || this.trains[0];
    if (T) T.boostUntil = performance.now() + 8000;
  },
  checkTriggers(T){
    const st = T.cars[0], key = st.p.key;
    if (key !== 'station' && key !== 'coal' && key !== 'water') return;
    const rt = st.p.def.routes[st.r], mid = rt.len / 2;
    const d = st.fw ? st.s : rt.len - st.s;
    if (T.prevMidD !== null && T.prevMidPiece === st.p.id
        && Math.sign(T.prevMidD - mid) !== Math.sign(d - mid)
        && !(st.p._cool > performance.now())){
      if (key === 'station'){
        st.p._cool = performance.now() + 2500;
        T.pausedUntil = performance.now() + 1600;
        Audio2.bell();
      }
      else if (key === 'coal') this.dropCoal(st.p, T);
      else if (key === 'water') this.pourWater(st.p, T);
    }
    T.prevMidD = d; T.prevMidPiece = st.p.id;
  },
  /* ── train-to-train: magnets couple nose-to-tail; anything else is a
        cartoon bump that stops both ─────────────────────────────────────── */
  frontPoint(T){
    const e = this.statePos(T.cars[0]);
    return { x: e.x + Math.cos(e.a) * this.S * 0.30, y: e.y + Math.sin(e.a) * this.S * 0.30, a: e.a };
  },
  rearPoint(T){
    const last = T.cars[T.cars.length - 1], p = this.statePos(last);
    return { x: p.x - Math.cos(p.a) * this.S * 0.24, y: p.y - Math.sin(p.a) * this.S * 0.24, a: p.a };
  },
  checkTrainCollisions(now){
    this._collCool = this._collCool || {};
    for (let i = 0; i < this.trains.length; i++) for (let j = 0; j < this.trains.length; j++){
      if (i === j) continue;
      const A = this.trains[i], B = this.trains[j];
      if (this.trainTouch && (this.trainTouch.train === A || this.trainTouch.train === B) && this.trainDrag) continue;
      if (!A.running) continue;   // only a moving train initiates contact
      const fa = this.frontPoint(A);
      // 1) magnet coupling: A's nose reaches B's tail, both pointing the same way
      const rb = this.rearPoint(B);
      if (Math.hypot(fa.x - rb.x, fa.y - rb.y) < this.S * 0.15
          && Math.cos(fa.a - rb.a) > 0.4){
        this.mergeTrains(B, A);
        return;   // train list changed — pick the rest up next frame
      }
      // 1b) a standing engine-less consist has magnets at BOTH ends: arriving
      // at its face just flips it around and couples the same way
      if (!B.running && !B.cars.some(c => c.type === 'engine')){
        const fb = this.frontPoint(B);
        if (Math.hypot(fa.x - fb.x, fa.y - fb.y) < this.S * 0.15
            && Math.cos(fa.a - fb.a) < -0.4){
          this.flipConsist(B);
          this.mergeTrains(B, A);
          return;
        }
      }
      // 2) any other meeting: a bump — both stop under a little cloud
      const key = Math.min(A.id, B.id) + ':' + Math.max(A.id, B.id);
      if (now < (this._collCool[key] || 0)) continue;
      for (const c of B.cars){
        const p = this.statePos(c);
        if (Math.hypot(fa.x - p.x, fa.y - p.y) < this.S * 0.17){
          this._collCool[key] = now + 2000;
          A.running = false; A.stuck = true;
          B.running = false; B.stuck = true;
          this.boom((fa.x + p.x) / 2, (fa.y + p.y) / 2);
          Audio2.clack(1);
          setTimeout(() => Audio2.clack(0.5), 90);
          break;
        }
      }
    }
  },
  flipConsist(T){
    T.cars.reverse();
    for (const c of T.cars){
      const rt = c.p.def.routes[c.r];
      c.fw = !c.fw; c.s = rt.len - c.s;
    }
    T.prevMidD = null;
  },
  mergeTrains(B, A){
    const start = B.cars.length;
    for (const c of A.cars) B.cars.push(c);
    for (let i = Math.max(1, start); i < B.cars.length; i++) this.seatBehind(B.cars[i - 1], B.cars[i]);
    this.trains = this.trains.filter(t => t !== A);
    if (this.activeT === A) this.activeT = B;
    // the mover keeps its momentum — the "head" simply passes to the train in
    // front, which rolls on as one long consist
    B.running = B.running || A.running;
    B.stuck = false;
    B.pausedUntil = 0;
    B.boostUntil = Math.max(B.boostUntil, A.boostUntil);
    if (A.coal > B.coal){ B.coal = A.coal; B.coalTimer = A.coalTimer; }
    this.syncCoal(B);
    const rp = this.rearPoint(B);
    FX.burst(this.toScreen(rp.x, rp.y).x, this.toScreen(rp.x, rp.y).y, ['#B9BEC5', '#F0B429', '#fff']);
    Audio2.snapSnd();
    Audio2.clack(0.5);
    this.saveLayout();
    this.placeTrain();
  },
  boom(x, y){
    const el = document.createElement('div');
    el.className = 'trn-boom';
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    // sized against the camera so the cloud reads BIG on screen at any zoom
    const sz = Math.round(170 / Math.max(0.45, this.cam ? this.cam.zoom : 1));
    el.innerHTML = `<svg viewBox="-40 -40 80 80" width="${sz}" height="${sz}" style="position:absolute;left:${-sz / 2}px;top:${-sz / 2}px;overflow:visible">
      ${[[-14,-6,17],[12,-10,15],[0,8,18],[-20,8,12],[20,6,11]].map(([cx,cy,r]) =>
        `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#EDEFF2" stroke="#B9BEC5" stroke-width="2"/>`).join('')}
      ${[[-26,-20],[26,-16],[6,-30]].map(([cx,cy]) =>
        `<path d="M ${cx} ${cy} l 3 6 6 1 -4.5 4 1.5 6 -6 -3.5 -6 3.5 1.5 -6 -4.5 -4 6 -1 Z" fill="#F0B429"/>`).join('')}
    </svg>`;
    this.world().appendChild(el);
    setTimeout(() => el.remove(), 900);
  },
  puff(big, T){
    // smoke rises from the ENGINE'S funnel, even when it is pushing wagons
    const loco = T.cars.find(c => c.type === 'engine') || T.cars[0];
    const e = this.statePos(loco);
    // from the funnel: forward along the boiler, then straight up in screen space
    const fx = e.x + Math.cos(e.a) * this.S * 0.16;
    const fy = e.y + Math.sin(e.a) * this.S * 0.16 - (this.S * 0.14) / this.SQ;
    const puff = document.createElement('div');
    puff.className = 'trn-puff' + (big ? ' big' : '');
    puff.style.left = (fx + (Math.random() - 0.5) * 6) + 'px';
    puff.style.top = (fy + (Math.random() - 0.5) * 6) + 'px';
    this.world().appendChild(puff);
    setTimeout(() => puff.remove(), 1100);
  },

  loop(){
    if (this.raf) return;
    this.last = performance.now();
    const frame = t => {
      if (!this.active){ this.raf = 0; return; }
      const dt = Math.min(t - this.last, 50) / 1000; this.last = t;
      const now = performance.now();
      for (const T of this.trains){
        // wagons never roll on their own — whatever state got them "running"
        if (T.running && !T.cars.some(c => c.type === 'engine')) T.running = false;
        if (T.coal && now - T.coalTimer > 7000){ T.coal--; T.coalTimer = now; this.syncCoal(T); }
        const carried = this.trainDrag && this.trainTouch && this.trainTouch.train === T;
        if (T.running && now > T.pausedUntil && !carried){
          const boost = now < T.boostUntil;
          const ds = this.S * 0.62 * dt * (boost ? 1.5 : 1) * (T.coal ? 1.18 : 1);
          const okE = this.advanceState(T.cars[0], ds, true);
          for (let i = 1; i < T.cars.length; i++) this.advanceState(T.cars[i], ds, false);
          if (!okE){
            // end of an unfinished line: stop and wait; the next tap sends the
            // train back the other way
            T.running = false; T.stuck = true;
            Audio2.clack(0.3);
          }
          this.checkTriggers(T);
          T.puffTimer -= dt;
          if (T.puffTimer <= 0){
            this.puff(boost, T);
            T.puffTimer = boost ? 0.16 : 0.34;
          }
        }
        if (!carried) for (const c of T.cars) this.carSprite(c, this.statePos(c));
      }
      if (this.trains.length > 1) this.checkTrainCollisions(now);
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  },
};

export { TrainGame };

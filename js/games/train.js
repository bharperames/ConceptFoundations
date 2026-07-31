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
  pieces: [], seq: 0, active: false, bound: false,
  drag: null, touch: null, raf: 0, last: 0,
  eng: null, ten: null, running: true, pausedUntil: 0, boostUntil: 0,
  coal: 0, coalTimer: 0, puffTimer: 0, prevMidD: null, prevMidPiece: 0,
  markers: [], W: 0, H: 0,
  area(){ return $('#train-area'); },
  // everything in the game lives on the FLOOR (flat 2D coords); this wrapper
  // is scaleY-squashed so the whole table tilts into isometric view at once
  world(){ return $('#trn-world') || this.area(); },
  toFloor(e){
    const r = this.area().getBoundingClientRect();
    return { x: e.clientX - r.left, y: (e.clientY - r.top) / this.SQ };
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
    // 45° curve: ends exactly S apart (chord = straight), tangents ±22.5°
    D.curve = {
      key: 'curve',
      ends: [{ x: -S/2, y: 0, a: Math.PI - PHI }, { x: S/2, y: 0, a: PHI }],
      routes: [{ a: 0, b: 1, pts: arc(0, R * Math.cos(PHI), R, -PHI, PHI) }],
    };
    // the tight curve: same 45°, small radius — for snug inner loops
    const R2 = R * 0.62, c2 = R2 * Math.sin(PHI);
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
    // level crossing: two straights, no joining
    D.cross = {
      key: 'cross',
      ends: [
        { x: -S/2, y: 0, a: Math.PI }, { x: S/2, y: 0, a: 0 },
        { x: 0, y: -S/2, a: -Math.PI/2 }, { x: 0, y: S/2, a: Math.PI/2 },
      ],
      routes: [
        { a: 0, b: 1, pts: line(-S/2, 0, S/2, 0) },
        { a: 2, b: 3, pts: line(0, -S/2, 0, S/2) },
      ],
    };
    // buffer: a half-straight ending in a stop block (b:-1 = bounce here)
    D.buffer = {
      key: 'buffer',
      ends: [{ x: -S/4, y: 0, a: Math.PI }],
      routes: [{ a: 0, b: -1, pts: line(-S/4, 0, S * 0.14, 0) }],
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
    const p0 = def.ends[k], a0 = p0.a + Math.PI;   // heading into the piece
    const h = Math.hypot(lx - p0.x, ly - p0.y) * 0.38;
    const P = [
      [p0.x, p0.y],
      [p0.x + Math.cos(a0) * h, p0.y + Math.sin(a0) * h],
      [lx + Math.cos(la) * h, ly + Math.sin(la) * h],
      [lx, ly],
    ];
    const pts = Array.from({ length: 25 }, (_, i) => {
      const u = i / 24, v = 1 - u;
      return [
        v*v*v*P[0][0] + 3*v*v*u*P[1][0] + 3*v*u*u*P[2][0] + u*u*u*P[3][0],
        v*v*v*P[0][1] + 3*v*v*u*P[1][1] + 3*v*u*u*P[2][1] + u*u*u*P[3][1],
      ];
    });
    if (k === 1) pts.reverse();                    // routes always run end0 → end1
    const rt = { a: 0, b: 1, pts, cum: [0] };
    for (let i = 1; i < pts.length; i++)
      rt.cum.push(rt.cum[i-1] + Math.hypot(pts[i][0]-pts[i-1][0], pts[i][1]-pts[i-1][1]));
    rt.len = rt.cum[rt.cum.length - 1];
    const ends = def.ends.map((e, i) => i === j ? { x: lx, y: ly, a: la } : { ...e });
    return { def: { key: def.key, ends, routes: [rt], bridged: true }, B, farEnd: j };
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
  // stitch any open end pairs that geometry has brought together (closes loops)
  closureScan(){
    const open = this.openEnds();
    for (let i = 0; i < open.length; i++) for (let j = i + 1; j < open.length; j++){
      const A = open[i], B = open[j];
      if (A.p === B.p || A.p.conn[A.i] || B.p.conn[B.i]) continue;
      if (Math.hypot(A.x - B.x, A.y - B.y) < 10 && Math.abs(wrap(A.a - B.a - Math.PI)) < 0.35)
        this.connect(A.p, A.i, B.p, B.i);
    }
  },

  /* ── lifecycle ─────────────────────────────────────────────────────────── */
  start(){
    Audio2.unlock(); showView('train');
    this.reset();
    if (!this.bound){
      const a = this.area();
      a.addEventListener('pointerdown', e => this.onDown(e));
      window.addEventListener('pointermove', e => this.onMove(e));
      window.addEventListener('pointerup', e => this.onUp(e));
      window.addEventListener('pointercancel', e => this.onUp(e));
      $('#trn-reset').addEventListener('click', () => this.reset());
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
  reset(){
    const a = this.area(), r = a.getBoundingClientRect();
    this.W = r.width; this.H = r.height / this.SQ;   // floor is "taller" than the screen
    this.S = Math.min(this.W, r.height) * 0.2;
    this.R = this.S * 1.30656;                   // chord of a 45° arc = S
    this.TW = this.S * 0.33;
    this.buildDefs();
    a.innerHTML = `<div id="trn-world" class="trn-world" style="height:${(100 / this.SQ).toFixed(2)}%;transform:scaleY(${this.SQ})"></div>`;
    this.pieces = []; this.seq = 0; this.drag = null; this.touch = null;
    this.trainTouch = null; this.trainDrag = false; this.dropMark = null;
    this.coal = 0; this.boostUntil = 0; this.pausedUntil = 0; this.running = true;
    this.renderOps();
    this.buildStarter();
    this.makeTrain();
    this.markers = [];
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
  addPiece(key, x, y, rot){
    const p = { id: ++this.seq, key, def: this.DEFS[key], x, y, rot, sw: 0, conn: {} };
    p.el = document.createElement('div');
    p.el.className = 'trn-piece';
    this.world().appendChild(p.el);
    this.renderPiece(p);
    this.pieces.push(p);
    return p;
  },
  // connector art is connection-aware: repaint every piece when the graph changes
  repaintAll(){ for (const q of this.pieces) this.renderPiece(q); },
  removePiece(p){
    this.disconnect(p);
    this.repaintAll();
    p.el.remove();
    if (p.over) p.over.remove();
    if (p.slab) p.slab.remove();
    this.pieces = this.pieces.filter(x => x !== p);
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
      const hx = e.x - ca * this.TW * 0.30, hy = e.y - sa * this.TW * 0.30;
      if (c.state === 'hole'){
        deco += `<path d="M ${n(e.x + ca * 1.5)} ${n(e.y + sa * 1.5)} L ${n(hx)} ${n(hy)}" stroke="#6b543a" stroke-width="${n(TW * 0.15)}" stroke-linecap="round"/>
          <circle cx="${n(hx)}" cy="${n(hy)}" r="${n(TW * 0.17)}" fill="#55422a"/>
          <circle cx="${n(hx)}" cy="${n(hy)}" r="${n(TW * 0.115)}" fill="#3e3020"/>`;
      } else if (c.state === 'joint'){
        // the seam: a light board-to-board line right across the joint
        deco += `<path d="M ${n(e.x + sa * (TW / 2 + 1.5))} ${n(e.y - ca * (TW / 2 + 1.5))} L ${n(e.x - sa * (TW / 2 + 1.5))} ${n(e.y + ca * (TW / 2 + 1.5))}" stroke="#B0966B" stroke-width="1.4" opacity=".85"/>`;
        deco += `<path d="M ${n(e.x + ca * TW * 0.06)} ${n(e.y + sa * TW * 0.06)} L ${n(hx)} ${n(hy)}" stroke="#6b543a" stroke-width="${n(TW * 0.16)}" stroke-linecap="round"/>
          <circle cx="${n(hx)}" cy="${n(hy)}" r="${n(TW * 0.17)}" fill="#55422a"/>
          <path d="M ${n(e.x + ca * TW * 0.06)} ${n(e.y + sa * TW * 0.06)} L ${n(hx)} ${n(hy)}" stroke="#EDE0C2" stroke-width="${n(TW * 0.09)}" stroke-linecap="round"/>
          <circle cx="${n(hx)}" cy="${n(hy)}" r="${n(TW * 0.12)}" fill="#EDE0C2"/>
          <circle cx="${n(hx - TW * 0.04)}" cy="${n(hy - TW * 0.04)}" r="${n(TW * 0.05)}" fill="#F8EFD9" opacity=".75"/>`;
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
      const bx = S * 0.14;
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
    // rolling stock: cycle the engine's livery, or couple on cargo & coaches
    ops.innerHTML += `
      <button class="fb-btn trn-carbtn trn-gap" data-car="engine" aria-label="Change the engine colour">
        <svg viewBox="0 0 100 60" width="42" height="26"><rect x="10" y="18" width="66" height="26" rx="8" fill="#2C6FD6" stroke="#1D3557" stroke-width="3"/><rect x="58" y="8" width="20" height="20" rx="4" fill="#1D3557"/><rect x="18" y="6" width="10" height="16" rx="3" fill="#363E47"/><circle cx="26" cy="48" r="8" fill="#20262D" stroke="#8A929C" stroke-width="2"/><circle cx="58" cy="48" r="8" fill="#20262D" stroke="#8A929C" stroke-width="2"/><rect x="76" y="20" width="6" height="24" rx="2" fill="#C2412F"/></svg>
      </button>
      <button class="fb-btn trn-carbtn" data-car="tanker" aria-label="Add an oil tanker">
        <svg viewBox="0 0 100 60" width="42" height="26"><rect x="10" y="14" width="80" height="30" rx="15" fill="#B9BEC5" stroke="#6E747E" stroke-width="3"/><rect x="42" y="6" width="16" height="10" rx="4" fill="#8A929C"/><circle cx="30" cy="50" r="7" fill="#20262D" stroke="#8A929C" stroke-width="2"/><circle cx="70" cy="50" r="7" fill="#20262D" stroke="#8A929C" stroke-width="2"/></svg>
      </button>
      <button class="fb-btn trn-carbtn" data-car="boxcar" aria-label="Add a box car">
        <svg viewBox="0 0 100 60" width="42" height="26"><rect x="12" y="10" width="76" height="34" rx="4" fill="#8B5A2B" stroke="#5c3b1c" stroke-width="3"/><rect x="42" y="14" width="16" height="26" fill="#A9713A" stroke="#5c3b1c" stroke-width="2"/><circle cx="30" cy="50" r="7" fill="#20262D" stroke="#8A929C" stroke-width="2"/><circle cx="70" cy="50" r="7" fill="#20262D" stroke="#8A929C" stroke-width="2"/></svg>
      </button>
      <button class="fb-btn trn-carbtn" data-car="coach" aria-label="Add a passenger coach">
        <svg viewBox="0 0 100 60" width="42" height="26"><rect x="10" y="12" width="80" height="32" rx="8" fill="#E8933C" stroke="#9c5a1a" stroke-width="3"/><rect x="20" y="18" width="13" height="16" rx="2" fill="#F6E7C8"/><rect x="43" y="18" width="13" height="16" rx="2" fill="#F6E7C8"/><rect x="66" y="18" width="13" height="16" rx="2" fill="#F6E7C8"/><circle cx="30" cy="50" r="7" fill="#20262D" stroke="#8A929C" stroke-width="2"/><circle cx="70" cy="50" r="7" fill="#20262D" stroke="#8A929C" stroke-width="2"/></svg>
      </button>`;
    ops.querySelectorAll('.trn-pick').forEach(btn => {
      btn.addEventListener('pointerdown', e => {
        e.preventDefault(); Audio2.unlock();
        this.beginDrag(this.spawnFloating(btn.dataset.piece, e.clientX, e.clientY), true, e);
      });
    });
    ops.querySelectorAll('.trn-carbtn').forEach(btn => {
      btn.addEventListener('click', () => {
        Audio2.unlock();
        if (btn.dataset.car === 'engine'){
          this.livery = (this.livery + 1) % this.LIVERIES.length;
          this.refreshEngineSkin();
          Audio2.snapSnd();
        } else if (!this.addCar(btn.dataset.car)){
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
      Audio2.clack(0.45);
      return;
    }
    if (this.freeClear(p)){
      // open floor: start a new island right here — its ends become fresh
      // places to build, just like loose track on the carpet
      if (d.fromPicker) this.pieces.push(p);
      this.closureScan();
      this.repaintAll();
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
    const cx = this.W / 2, cy = this.H / 2;
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
      Audio2.clack(0.45);
      return;
    }
    for (let ring = 0; ring < 8; ring++) for (let k = 0; k < 8; k++){
      const a = k * Math.PI / 4 + ring * 0.4;
      p.x = cx + Math.cos(a) * ring * this.S * 0.7;
      p.y = cy + Math.sin(a) * ring * this.S * 0.7;
      p.rot = 0;
      if (this.freeClear(p)){ settle(); Audio2.clack(0.3); return; }
    }
    p.el.remove(); if (p.over) p.over.remove(); if (p.slab) p.slab.remove();
  },
  freeClear(p){
    // never under the part list, never hanging off the floor
    const ops = $('#trn-ops').getBoundingClientRect(), ar = this.area().getBoundingClientRect();
    if (p.y < (ops.bottom - ar.top) / this.SQ + this.S * 0.45) return false;
    if (p.x < this.S * 0.4 || p.x > this.W - this.S * 0.4 || p.y > this.H - this.S * 0.35) return false;
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
    for (let i = this.pieces.length - 1; i >= 0; i--){
      const p = this.pieces[i];
      if (Math.hypot(px - p.x, py - p.y) > this.S * 1.3) continue;
      // precise: near any route polyline (in local coords)
      const c = Math.cos(-p.rot), s = Math.sin(-p.rot);
      const lx = (px - p.x) * c - (py - p.y) * s, ly = (px - p.x) * s + (py - p.y) * c;
      for (const rt of p.def.routes)
        for (const [qx, qy] of rt.pts)
          if (Math.hypot(lx - qx, ly - qy) < this.TW * 0.95) return p;
      // decorations count too (switch lever, tower, platform)
      if (p.key !== 'straight' && p.key !== 'curve' && Math.hypot(lx, ly) < this.S * 0.75) return p;
    }
    return null;
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
    // carrying the train?
    if (this.trainTouch && !this.trainDrag
        && Math.hypot(e.clientX - this.trainTouch.x, e.clientY - this.trainTouch.y) > 12){
      this.trainDrag = true;
      for (const c of this.cars) c.el.classList.add('trn-carry');
    }
    if (this.trainDrag){
      const f = this.toFloor(e), tt = this.trainTouch;
      // engine under the finger, every car trailing exactly as it hung at pickup
      this.cars.forEach((c, i) =>
        this.carSprite(c, { x: f.x + tt.deltas[i].dx, y: f.y + tt.deltas[i].dy, a: tt.deltas[i].a }));
      $('#trn-toybox').classList.toggle('open', this.overToybox(e) && this.cars.length > 2);
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
      if (this.cars.some(c => c.p === p)){
        p.el.classList.remove('trn-no'); void p.el.offsetWidth;
        p.el.classList.add('trn-no');            // the train is standing on it
        return;
      }
      this.beginDrag(p, false, e);
      this.dragMove(e);
    }
  },
  onUp(e){
    if (this.trainTouch){
      const tt = this.trainTouch; this.trainTouch = null;
      if (!this.trainDrag){
        // a plain tap: stop or go — and a train stopped at a dead end goes
        // back the other way (engine running around to the front)
        this.running = !this.running;
        if (this.running && this.stuck){ this.reverse(); this.stuck = false; }
        this.eng.el.classList.toggle('idle', !this.running);
        if (this.running) Audio2.clack(0.3);
        return;
      }
      this.trainDrag = false;
      for (const c of this.cars) c.el.classList.remove('trn-carry');
      if (this.dropMark){ this.dropMark.remove(); this.dropMark = null; }
      $('#trn-toybox').classList.remove('open');
      const restore = () => this.cars.forEach((c, i) => Object.assign(c, tt.prev[i]));
      if (this.overToybox(e) && this.cars.length > 2){
        // the toybox takes the LAST car off the train
        const gone = this.cars.pop();
        gone.el.remove();
        FX.burst(e.clientX, e.clientY, ['#F0B429', '#8A929C', '#fff']);
        Audio2.pop();
        restore();
        this.placeTrain();
        return;
      }
      const f = this.toFloor(e);
      const near = this.nearestTrack(f.x, f.y);
      if (near){
        this.placeTrainAt(near);
        // face the way it was carried: flip travel direction if the new rail
        // would point the engine backwards
        if (Math.abs(wrap(this.statePos(this.eng).a - tt.ea)) > Math.PI / 2){
          this.eng.fw = !this.eng.fw;
          const len = this.eng.p.def.routes[this.eng.r].len;
          this.eng.s = len - this.eng.s;
          this.placeTrainAt({ p: this.eng.p, r: this.eng.r, d: this.eng.fw ? this.eng.s : len - this.eng.s });
        }
        Audio2.clack(0.4);
      } else {
        // nowhere to sit: the train hops back where it was
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
  livery: 0, cars: [], stuck: false,
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
  engineEl(){
    const S = this.S, EL = S * 0.56, EW = S * 0.27;
    const { n, lay, box } = this.layKit(), LV = this.LIVERIES[this.livery];
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
  carEl(type){
    const S = this.S, CL = S * 0.42, CW = S * 0.24;
    const { n, lay, box } = this.layKit();
    const el = document.createElement('div');
    el.className = 'trn-train trn-car';
    let body = '', top = '';
    if (type === 'tender'){
      body = `<rect x="${n(-CL/2)}" y="${n(-CW/2)}" width="${n(CL)}" height="${n(CW)}" rx="4" fill="#33383F" stroke="#16181c" stroke-width="1.6"/>
        <rect x="${n(-CL/2+2.5)}" y="${n(-CW/2+2.5)}" width="${n(CL-5)}" height="${n(CW-5)}" rx="3" fill="#20242A"/>
        <g class="trn-lumps">${[[-CL*0.18,-CW*0.12],[CL*0.02,CW*0.1],[CL*0.2,-CW*0.06]].map(([x,y]) =>
          `<circle cx="${n(x)}" cy="${n(y)}" r="${n(CW*0.17)}" fill="#0d0f12" stroke="#3a3f45" stroke-width="1"/>`).join('')}</g>`;
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
  makeTrain(){
    this.cars = []; this.stuck = false;
    const S = this.S, EL = S * 0.56, H1 = S * 0.055, H2 = S * 0.115;
    const el = this.engineEl();
    el.addEventListener('pointerdown', e => {
      e.stopPropagation(); e.preventDefault();
      Audio2.unlock();
      // tap = stop/go · drag = pick the whole train up. Capture the pose at
      // pickup: the consist is carried exactly as it stood.
      const ep = this.statePos(this.eng);
      this.trainTouch = { x: e.clientX, y: e.clientY, ea: ep.a,
        deltas: this.cars.map(c => { const cp = this.statePos(c); return { dx: cp.x - ep.x, dy: cp.y - ep.y, a: cp.a }; }),
        prev: this.cars.map(c => this.snapState(c)) };
    });
    this.world().appendChild(el);
    const home = this.pieces[0];
    const eng = { p: home, r: 0, s: home.def.routes[0].len * 0.7, fw: true, el, type: 'engine',
      layers: [[el.children[1], H1 / this.SQ], [el.children[2], H2 / this.SQ]],
      face: { el: el.children[3], fx: EL * 0.5, k: (S * 0.09) / this.SQ } };
    this.cars.push(eng);
    this.eng = eng;
    this.addCar('tender', true);
    this.ten = this.cars[1];
    this.syncCoal();
    this.placeTrain();
  },
  addCar(type, silent){
    if (this.cars.length >= 6) return false;   // a proud but manageable train
    const last = this.cars[this.cars.length - 1];
    const el = this.carEl(type);
    this.world().appendChild(el);
    const S = this.S, H1 = S * 0.055, H2 = S * 0.115;
    const layers = [[el.children[1], H1 / this.SQ]];
    if (el.children[2]) layers.push([el.children[2], H2 / this.SQ]);
    const st = { p: last.p, r: last.r, s: last.s, fw: last.fw, el, type, layers };
    this.cars.push(st);
    this.seatBehind(last, st);
    if (!silent){ Audio2.clack(0.4); this.placeTrain(); }
    return true;
  },
  seatBehind(prev, st){
    const rt = prev.p.def.routes[prev.r];
    const back = { p: prev.p, r: prev.r, s: rt.len - prev.s, fw: !prev.fw };
    this.advanceState(back, this.S * 0.52, false);
    const bl = back.p.def.routes[back.r].len;
    st.p = back.p; st.r = back.r; st.fw = !back.fw; st.s = bl - back.s;
  },
  refreshEngineSkin(){
    const el = this.eng.el, fresh = this.engineEl();
    el.innerHTML = fresh.innerHTML;
    const S = this.S, H1 = S * 0.055, H2 = S * 0.115, EL = S * 0.56;
    this.eng.layers = [[el.children[1], H1 / this.SQ], [el.children[2], H2 / this.SQ]];
    this.eng.face = { el: el.children[3], fx: EL * 0.5, k: (S * 0.09) / this.SQ };
    this.placeTrain();
  },
  syncCoal(){
    const g = this.ten.el.querySelector('.trn-lumps');
    if (g) [...g.children].forEach((c, i) => c.style.opacity = i < this.coal ? 1 : 0.12);
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
  reverse(){
    for (const st of this.cars){
      const rt = st.p.def.routes[st.r];
      st.fw = !st.fw; st.s = rt.len - st.s;
    }
    const last = this.cars[this.cars.length - 1];
    if (last !== this.eng){
      this.eng.p = last.p; this.eng.r = last.r; this.eng.fw = last.fw; this.eng.s = last.s;
      for (let i = 1; i < this.cars.length; i++) this.seatBehind(this.cars[i - 1], this.cars[i]);
    }
    this.prevMidD = null;
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
    let epos = null;
    for (const c of this.cars){
      const pos = this.statePos(c);
      if (c === this.eng) epos = pos;
      this.carSprite(c, pos);
    }
    return epos;
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
  placeTrainAt(near){
    const len = near.p.def.routes[near.r].len;
    this.eng.p = near.p; this.eng.r = near.r;
    this.eng.s = this.eng.fw ? near.d : len - near.d;
    // seat every car behind by walking the track backwards, one coupling at a time
    for (let i = 1; i < this.cars.length; i++) this.seatBehind(this.cars[i - 1], this.cars[i]);
    this.prevMidD = null; this.stuck = false;
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
    this.coal = 3; this.coalTimer = performance.now();
    this.syncCoal();
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
    this.boostUntil = performance.now() + 8000;
  },
  checkTriggers(){
    const st = this.eng, key = st.p.key;
    if (key !== 'station' && key !== 'coal' && key !== 'water') return;
    const rt = st.p.def.routes[st.r], mid = rt.len / 2;
    const d = st.fw ? st.s : rt.len - st.s;
    if (this.prevMidD !== null && this.prevMidPiece === st.p.id
        && Math.sign(this.prevMidD - mid) !== Math.sign(d - mid)
        && !(st.p._cool > performance.now())){
      if (key === 'station'){
        st.p._cool = performance.now() + 2500;
        this.pausedUntil = performance.now() + 1600;
        Audio2.bell();
      }
      else if (key === 'coal') this.dropCoal(st.p);
      else if (key === 'water') this.pourWater(st.p);
    }
    this.prevMidD = d; this.prevMidPiece = st.p.id;
  },
  puff(big){
    const e = this.statePos(this.eng);
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
      if (this.coal && now - this.coalTimer > 7000){ this.coal--; this.coalTimer = now; this.syncCoal(); }
      if (this.running && now > this.pausedUntil && this.eng && !this.trainDrag){
        const boost = now < this.boostUntil;
        const ds = this.S * 0.62 * dt * (boost ? 1.5 : 1) * (this.coal ? 1.18 : 1);
        const okE = this.advanceState(this.cars[0], ds, true);
        for (let i = 1; i < this.cars.length; i++) this.advanceState(this.cars[i], ds, false);
        if (!okE){
          // end of an unfinished line: stop and wait (no surprise auto-bounce);
          // the next tap sends the train back the other way
          this.running = false; this.stuck = true;
          this.eng.el.classList.add('idle');
          Audio2.clack(0.3);
        }
        this.checkTriggers();
        this.puffTimer -= dt;
        if (this.puffTimer <= 0){
          this.puff(boost);
          this.puffTimer = boost ? 0.16 : 0.34;
        }
      }
      if (this.eng && !this.trainDrag) this.placeTrain();
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  },
};

export { TrainGame };

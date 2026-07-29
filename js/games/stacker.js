import { SHAPES } from '../art.js';
import { Audio2 } from '../audio.js';
import { $, clamp, mulberry32, pick } from '../core.js';
import { Engine } from '../engine.js';
import { showView } from '../router.js';

const StackerGame = {
  TONES: ['#D8A05B','#C88A45','#E0B274','#BE8038','#CF9550','#D6A868','#B87636'],
  // rectangular blocks first (the priority — rock-solid stacking), then the
  // cone (triangle) and sphere (ball), which the simulation confirmed are stable
  SHAPES: [
    { key:'cube',  w:1,    h:1    },
    { key:'brick', w:2,    h:1    },
    { key:'plank', w:2.7,  h:0.62 },
    { key:'tall',  w:0.72, h:1.95 },
    { key:'cyl',   w:0.92, h:1.5  },
    { key:'tri',   w:1.45, h:1.2,  cy:0.667 },   // body sits on its centroid, 2/3 down
    { key:'ball',  w:1,    h:1    },
    { key:'wedge', w:3,    h:1,    cx:0.667, cy:0.667 },   // ramp: right triangle, centroid ⅔ across/down
  ],
  MAX: Infinity,   // no block cap — drop as many as the device can carry
  blocks: [], raf: 0, drag: null, U: 0, W: 0, H: 0, floorY: 0, active: false, bound: false,
  eng: null, useMatter: false, lastClack: 0, debug: false, dpr: 1,
  area(){ return $('#stacker-area'); },

  ensureDefs(){
    if ($('#stk-defs')) return;
    const el = document.createElement('div');
    el.id = 'stk-defs'; el.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    el.innerHTML = `<svg width="0" height="0"><defs>
      <linearGradient id="stkTop" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#fff" stop-opacity=".45"/><stop offset=".52" stop-color="#fff" stop-opacity="0"/></linearGradient>
      <linearGradient id="stkBot" x1="0" y1="0" x2="0" y2="1">
        <stop offset=".5" stop-color="#3a2510" stop-opacity="0"/><stop offset="1" stop-color="#3a2510" stop-opacity=".34"/></linearGradient>
      <linearGradient id="stkCyl" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#000" stop-opacity=".26"/><stop offset=".3" stop-color="#fff" stop-opacity=".32"/>
        <stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".28"/></linearGradient>
      <radialGradient id="stkBall" cx=".36" cy=".3" r=".8">
        <stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/>
        <stop offset="1" stop-color="#3a2510" stop-opacity=".3"/></radialGradient>
    </defs></svg>`;
    this.area().appendChild(el);
  },
  // darker/lighter shades of a block tone, for grain colours that keep the
  // per-block palette alive (f scales toward black; mixWhite first lightens)
  shadeTone(hex, f, mixWhite){
    const c = parseInt(hex.slice(1), 16);
    let r = (c>>16)&255, g = (c>>8)&255, b = c&255;
    if (mixWhite){ r += (255-r)*mixWhite; g += (255-g)*mixWhite; b += (255-b)*mixWhite; }
    r = Math.round(r*f); g = Math.round(g*f); b = Math.round(b*f);
    return '#' + ((1<<24) + (r<<16) + (g<<8) + b).toString(16).slice(1);
  },
  // photoreal wood grain: three turbulence layers (broad tone bands along the
  // long axis, fine fibres, light sheen), softened along the grain and
  // composited onto the shape's own alpha — so strokes and chamfers get
  // textured too, with no clipPath needed. One filter per block, unique seed.
  woodFilter(uid, vertical, seed, tone){
    const bf = (a, x) => vertical ? `${x} ${a}` : `${a} ${x}`;
    const blur = vertical ? '0.14 0.85' : '0.85 0.14';
    const dark = this.shadeTone(tone, 0.62), fine = this.shadeTone(tone, 0.45), light = this.shadeTone(tone, 1, 0.72);
    const layer = (i, freq, oct, gain, bias, color, op, sd) => `
      <feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="${oct}" seed="${sd}" result="t${i}"/>
      <feColorMatrix in="t${i}" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  ${gain} ${gain} ${gain} 0 ${bias}" result="b${i}"/>
      <feFlood flood-color="${color}" flood-opacity="${op}" result="c${i}"/>
      <feComposite in="c${i}" in2="b${i}" operator="in" result="g${i}"/>`;
    return `<filter id="${uid}" x="-5%" y="-5%" width="110%" height="110%">
      ${layer(1, bf(0.0085, 0.11), 3, 2.2, -2.9, dark, .38, seed)}
      ${layer(2, bf(0.05, 0.65),   2, 3.0, -4.5, fine, .20, seed+31)}
      ${layer(3, bf(0.016, 0.22),  3, 2.4, -3.2, light, .25, seed+67)}
      <feMerge result="grain"><feMergeNode in="g1"/><feMergeNode in="g3"/><feMergeNode in="g2"/></feMerge>
      <feGaussianBlur in="grain" stdDeviation="${blur}" result="soft"/>
      <feComposite in="soft" in2="SourceAlpha" operator="in" result="clip"/>
      <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="clip"/></feMerge>
    </filter>`;
  },
  // cartoon-photoreal lawn: textured field (turbulence tone patches + blade
  // streaks + light sheen over a green gradient) under a procedural fringe of
  // irregular blades that pokes `over` px above the strip (behind the blocks).
  // NOTE the fringe rows close in a shallow 5px footer — closing them to the
  // bottom of the svg blankets the whole textured field in flat green.
  grassSVG(W, H){
    const rng = mulberry32(42), over = 20, n = x => (+x).toFixed(1);
    const uid = 'stkg' + (++this.svgSeq), VH = H + over;
    const fringe = (yBase, hMin, hMax, stepMin, stepMax, fill, op) => {
      const foot = yBase + 5;
      let d = `M0 ${n(foot)} L0 ${n(yBase)}`;
      let x = 0;
      while (x < W){
        const step = stepMin + rng()*(stepMax-stepMin);
        const h = hMin + rng()*(hMax-hMin);
        const tip = x + step/2 + (rng()-0.5)*step*1.1;
        d += ` L${n(x + step*0.18)} ${n(yBase)} L${n(tip)} ${n(yBase - h)} L${n(x + step*0.82)} ${n(yBase)}`;
        x += step;
      }
      d += ` L${n(W)} ${n(yBase)} L${n(W)} ${n(foot)} Z`;
      return `<path d="${d}" fill="${fill}" opacity="${op}"/>`;
    };
    const filt = (name, freq, oct, gain, bias, color, op, sd) => `
      <filter id="${uid}${name}" x="0" y="0" width="100%" height="100%">
        <feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="${oct}" seed="${sd}" result="t"/>
        <feColorMatrix in="t" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  ${gain} ${gain} ${gain} 0 ${bias}" result="b"/>
        <feFlood flood-color="${color}" flood-opacity="${op}"/>
        <feComposite in2="b" operator="in"/>
      </filter>`;
    return `<svg viewBox="0 ${-over} ${W} ${VH}" width="${W}" height="${VH}"
        style="position:absolute;left:0;bottom:0;display:block" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="${uid}f" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#7FBC49"/><stop offset=".28" stop-color="#67A83A"/>
          <stop offset=".7" stop-color="#4F8A2B"/><stop offset="1" stop-color="#3F6F22"/>
        </linearGradient>
        ${filt('p', '0.0045 0.022', 2, 2.0, -2.4, '#365F1D', .32, 51)}
        ${filt('b', '0.16 0.028',   2, 2.6, -3.1, '#2E5A18', .5,  7)}
        ${filt('l', '0.13 0.033',   2, 2.7, -3.4, '#C9E97A', .28, 20)}
        <linearGradient id="${uid}s" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#D8F296" stop-opacity=".38"/><stop offset=".18" stop-color="#D8F296" stop-opacity="0"/>
        </linearGradient>
        <linearGradient id="${uid}d" x1="0" y1="0" x2="0" y2="1">
          <stop offset=".3" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#132a08" stop-opacity=".5"/>
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="${W}" height="${H}" fill="url(#${uid}f)"/>
      <rect x="0" y="0" width="${W}" height="${H}" filter="url(#${uid}p)"/>
      <rect x="0" y="0" width="${W}" height="${H}" filter="url(#${uid}b)"/>
      <rect x="0" y="0" width="${W}" height="${H}" filter="url(#${uid}l)"/>
      <rect x="0" y="0" width="${W}" height="${H}" fill="url(#${uid}s)"/>
      ${fringe(2, 12, 24, 7, 13, '#3E7020', 1)}
      ${fringe(1, 8, 18, 6, 11, '#5C9A31', 1)}
      ${fringe(0, 5, 11, 5, 9, '#79B94A', .95)}
      <rect x="0" y="0" width="${W}" height="${H}" fill="url(#${uid}d)"/>
    </svg>`;
  },
  svgSeq: 0,
  // Dropped blocks pass their real pixel size (pxW×pxH) so the grain renders
  // 1:1 crisp — a 52-scale viewBox stretched by preserveAspectRatio="none"
  // would blur it. Icons keep the small fixed-seed 52-scale version.
  blockSVG(shape, tone, icon, pxW, pxH, seed){
    const n = x => (+x).toFixed(1);
    const vw = icon ? +n(shape.w*52) : Math.round(pxW), vh = icon ? +n(shape.h*52) : Math.round(pxH);
    const k = vw / (shape.w*52);                 // scales the fixed insets/strokes
    const uid = 'stkw' + (++this.svgSeq);
    // sprites fill the physics box EDGE TO EDGE: no inset, and corner radius =
    // the body's chamfer (min*0.06) — a bigger visual radius or any margin
    // reads as stacked blocks "not touching" even when their bodies do
    let body, shade;
    if (shape.key === 'tri' || shape.key === 'wedge'){
      // stroke is centred: inset the path by half the stroke so the rounded
      // stroke's OUTER edge lands exactly on the physics shape
      const i = 3.5*k;
      const p = shape.key === 'tri'
        ? `M${n(i)} ${n(vh-i)} L${n(vw/2)} ${n(i)} L${n(vw-i)} ${n(vh-i)} Z`
        : `M${n(i)} ${n(vh-i)} L${n(vw-i)} ${n(vh-i)} L${n(vw-i)} ${n(i)} Z`;   // ramp slope down-left
      body = `<path d="${p}" fill="${tone}" stroke="${tone}" stroke-width="${n(7*k)}" stroke-linejoin="round"/>`;
      shade = `<path d="${p}" fill="url(#stkTop)"/><path d="${p}" fill="url(#stkBot)"/>`;
    } else if (shape.key === 'ball'){
      const r = n(vw/2);
      body = `<circle cx="${n(vw/2)}" cy="${n(vh/2)}" r="${r}" fill="${tone}"/>`;
      shade = `<circle cx="${n(vw/2)}" cy="${n(vh/2)}" r="${r}" fill="url(#stkBall)"/>`;
    } else {
      // cyl is a flat-topped rounded post; its cylindrical LOOK comes from the
      // horizontal shading gradient over the vertical grain
      const rx = n(Math.min(vw,vh)*0.06);
      const R = a => `<rect x="0" y="0" width="${vw}" height="${vh}" rx="${rx}" fill="${a}"/>`;
      body = R(tone);
      shade = (shape.key === 'cyl' ? R('url(#stkCyl)') : '') + R('url(#stkTop)') + (shape.key === 'cyl' ? '' : R('url(#stkBot)'));
    }
    const inner = `<defs>${this.woodFilter(uid, vh > vw, seed || 7, tone)}</defs>`
      + `<g filter="url(#${uid})">${body}</g>${shade}`;
    // blocks fill their w×h element (none, overflow shown for the strokes); picker
    // icons keep true aspect (meet) and are sized + clipped to the button
    return icon
      ? `<svg viewBox="0 0 ${vw} ${vh}" preserveAspectRatio="xMidYMid meet" width="100%" height="100%" style="display:block">${inner}</svg>`
      : `<svg viewBox="0 0 ${vw} ${vh}" preserveAspectRatio="none" style="overflow:visible">${inner}</svg>`;
  },

  walls(){
    const M = window.Matter, w = (x,y,ww,hh) => M.Bodies.rectangle(x,y,ww,hh,{ isStatic:true, friction:.9 });
    return [ w(this.W/2, this.floorY + 400, this.W + 600, 800),
             w(-45, this.H/2, 90, this.H*3), w(this.W+45, this.H/2, 90, this.H*3),
             w(this.W/2, -40, this.W + 600, 80) ];   // ceiling — a flung block can't leave the window
  },
  start(){
    Audio2.unlock(); showView('stacker'); this.ensureDefs();
    const r = this.area().getBoundingClientRect();
    const vmin = Math.min(window.innerWidth, window.innerHeight) / 100;
    // floor at 92%: the lawn is a 10% strip (a deeper field just wasted
    // vertical stacking room); blocks still sink 2% into the grass fringe
    this.U = 15 * vmin; this.W = r.width; this.H = r.height; this.floorY = r.height * 0.92;
    this.useMatter = !!window.Matter;
    // physics-debug overlay canvas (above blocks z6, below the ops row z30)
    let cv = $('#stk-dbg-cv');
    if (!cv){
      cv = document.createElement('canvas'); cv.id = 'stk-dbg-cv';
      cv.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:20';
      this.area().appendChild(cv);
    }
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(this.W * this.dpr); cv.height = Math.round(this.H * this.dpr);
    cv.style.width = this.W + 'px'; cv.style.height = this.H + 'px';
    // rebuild the lawn at the current width (fringe is width-dependent)
    const ground = this.area().querySelector('.stk-ground');
    if (ground) ground.innerHTML = this.grassSVG(Math.ceil(this.W), Math.ceil(this.H * 0.10));
    if (this.raf){ cancelAnimationFrame(this.raf); this.raf = 0; }
    this.blocks = []; this.drag = null;
    this.area().querySelectorAll('.fb-block').forEach(e => e.remove());
    if (this.useMatter){
      const M = window.Matter;
      // sleeping OFF: an unsupported block must fall the instant its support is
      // moved out (a slept block would hang in the air until nudged); more solver
      // iterations keep stacks stable without sleeping. Only ≤16 bodies, so cheap.
      // sleeping ON: with no block cap, resting piles must go dormant or the
      // solver melts (~20fps at 60 awake bodies). The classic sleeping bug —
      // pull a support out and the slept block above hangs in the air — is
      // covered by force-waking everything while a drag is active (loop()).
      this.eng = M.Engine.create({ enableSleeping:true, positionIterations:12, velocityIterations:8, constraintIterations:3 });
      // 2.2, not 1.0: Matter's default gravity is ~5× weaker than real scale for
      // blocks this size, which read as floaty/massless. 2.2 falls ~1.5× faster
      // with the same sim stability (sweep: 3.0 blew penetration up to 9.7px).
      this.eng.world.gravity.y = 2.2;
      M.World.add(this.eng.world, this.walls());
      M.Events.off(this.eng, 'collisionStart');
      M.Events.on(this.eng, 'collisionStart', ev => {
        const now = performance.now();
        if (now - this.lastClack < 55) return;
        for (const p of ev.pairs){
          const v = p.bodyA.speed + p.bodyB.speed;   // thresholds scaled for gravity 2.2
          if (v > 2.4){ this.lastClack = now; Audio2.clack(Math.min(1, v/13)); break; }
        }
      });
    }
    this.active = true; this.renderOps(); this.loop();
    if (!this.bound){
      this.area().addEventListener('pointerdown', e => this.onDown(e));
      window.addEventListener('pointermove', e => this.onMove(e));
      window.addEventListener('pointerup', e => this.onUp(e));
      window.addEventListener('pointercancel', e => this.onUp(e));
      // a context menu / focus loss can swallow the pointerup mid-drag,
      // leaving the grab constraint alive forever (block frozen in the air) —
      // suppress the menu on the play area and release the pinch on any
      // interruption
      this.area().addEventListener('contextmenu', e => { e.preventDefault(); this.onUp(); });
      window.addEventListener('blur', () => this.onUp());
      document.addEventListener('visibilitychange', () => { if (document.hidden) this.onUp(); });
      this.bound = true;
    }
  },
  stop(){
    this.active = false;
    if (this.raf){ cancelAnimationFrame(this.raf); this.raf = 0; }
    this.blocks = []; this.drag = null;
    if (this.eng && window.Matter){ window.Matter.World.clear(this.eng.world, false); this.eng = null; }
    this.area().querySelectorAll('.fb-block').forEach(e => e.remove());
    this.drawDebug();   // active=false → clears the annotation overlay
  },
  reset(){
    if (this.useMatter && this.eng && window.Matter){
      if (this.drag){ window.Matter.World.remove(this.eng.world, this.drag.con); this.drag = null; }
      for (const b of this.blocks) window.Matter.World.remove(this.eng.world, b.body);
    }
    this.blocks = []; this.drag = null;
    this.area().querySelectorAll('.fb-block').forEach(e => e.remove());
    if (this.active) this.renderOps();
    this.drawDebug();
  },
  renderOps(){
    const ops = $('#stk-ops'), full = this.blocks.length >= this.MAX;
    // one wooden icon per shape — tap it to drop that block
    const picker = this.SHAPES.map((sh, i) =>
      `<button class="fb-btn fb-shape" data-shape="${i}" aria-label="Drop a ${sh.key} block"${full ? ' disabled' : ''}>${this.blockSVG(sh, '#D8A05B', true, 0, 0, 11 + i*7)}</button>`).join('');
    ops.innerHTML = `<button class="fb-btn fb-reset" aria-label="Clear the blocks">↺</button>` + picker;
    ops.querySelector('.fb-reset').onclick = () => this.reset();
    if (!full) ops.querySelectorAll('.fb-shape').forEach(btn => { btn.onclick = () => this.drop(+btn.dataset.shape); });
  },
  makeBody(shape, x, y, w, h){
    const M = window.Matter;
    // tuned by simulation (1500 scenarios): zero restitution on the wood → least
    // penetration; a ball keeps a little bounce so it rolls with life
    if (shape.key === 'ball') return M.Bodies.circle(x, y, w/2, { friction:.5, frictionStatic:.6, restitution:.12, density:.0016 });
    if (shape.key === 'tri'){
      const v = [{ x:-w/2, y:h/2 }, { x:0, y:-h/2 }, { x:w/2, y:h/2 }];
      return M.Bodies.fromVertices(x, y, [v], { friction:.65, frictionStatic:.9, restitution:0, density:.0017 });
    }
    if (shape.key === 'wedge'){
      // ramp: tall side right, slope descending to the left
      const v = [{ x:-w/2, y:h/2 }, { x:w/2, y:h/2 }, { x:w/2, y:-h/2 }];
      return M.Bodies.fromVertices(x, y, [v], { friction:.65, frictionStatic:.9, restitution:0, density:.0017 });
    }
    return M.Bodies.rectangle(x, y, w, h, { friction:.6, frictionStatic:.85, restitution:0, density:.0017, chamfer:{ radius: Math.min(w,h)*0.06 } });
  },
  drop(idx){
    if (this.blocks.length >= this.MAX) return;
    const shape = this.SHAPES[(idx == null ? Math.floor(Math.random()*this.SHAPES.length) : idx)];
    const tone = this.TONES[Math.floor(Math.random()*this.TONES.length)];
    const U = this.U, w = shape.w*U, h = shape.h*U;
    const el = document.createElement('div');
    el.className = 'fb-block'; el.style.width = w + 'px'; el.style.height = h + 'px';
    el.style.transformOrigin = `${((shape.cx ?? .5)*100)}% ${((shape.cy ?? .5)*100)}%`;
    el.innerHTML = this.blockSVG(shape, tone, false, w, h, 1 + Math.floor(Math.random()*997));
    this.area().appendChild(el);
    const x = this.W*0.5 + (Math.random()*2-1)*U*1.1, y = h*0.62;   // just inside — the ceiling is above
    const b = { el, shape, w, h };
    if (this.useMatter){
      b.body = this.makeBody(shape, x, y, w, h);
      window.Matter.Body.setAngle(b.body, (Math.random()-0.5)*0.25);
      window.Matter.World.add(this.eng.world, b.body);
    } else {
      Object.assign(b, { x, y, vy: 0, done: false, held: false });
    }
    this.blocks.push(b); this.renderOps(); this.sync(); this.loop();
  },
  sync(){
    if (this.useMatter){
      for (const b of this.blocks){
        const p = b.body.position, cx = b.shape.cx ?? .5, cy = b.shape.cy ?? .5;
        // integer px keeps sprites crisp (sub-pixel was the old fuzzy-block bug)
        b.el.style.transform = `translate(${Math.round(p.x - cx*b.w)}px, ${Math.round(p.y - cy*b.h)}px) rotate(${b.body.angle}rad)`;
      }
    } else {
      for (const b of this.blocks){
        b.el.style.transform = `translate(${Math.round(b.x - b.w/2)}px, ${Math.round(b.y - b.h/2)}px)`;
      }
    }
    if (this.debug) this.drawDebug();
  },
  tracePoly(ctx, vs){
    ctx.beginPath(); ctx.moveTo(vs[0].x, vs[0].y);
    for (let i = 1; i < vs.length; i++) ctx.lineTo(vs[i].x, vs[i].y);
    ctx.closePath();
  },
  // annotation overlay: the ACTUAL solver state the sprites hide — collision
  // hulls (chamfered/decomposed), centre of mass + mass, velocity & spin,
  // live contact points, the static floor/walls, and the pinch constraint
  drawDebug(){
    const cv = $('#stk-dbg-cv'); if (!cv) return;
    const ctx = cv.getContext('2d');
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    if (!this.debug || !this.active) return;
    ctx.lineWidth = 1; ctx.font = '10px ui-monospace,Menlo,monospace'; ctx.textAlign = 'center';
    if (this.useMatter && this.eng){
      const M = window.Matter;
      ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.setLineDash([5,4]);
      for (const s of M.Composite.allBodies(this.eng.world))
        if (s.isStatic){ this.tracePoly(ctx, s.vertices); ctx.stroke(); }
      ctx.setLineDash([]);
      for (const b of this.blocks){
        const body = b.body, px = body.position.x, py = body.position.y;
        // hull(s) the solver really collides — parts[0] is the compound wrapper
        ctx.strokeStyle = '#19E68C';
        for (const p of (body.parts.length > 1 ? body.parts.slice(1) : body.parts)){
          this.tracePoly(ctx, p.vertices); ctx.stroke();
        }
        // centre of mass crosshair + mass value
        ctx.strokeStyle = '#FF4FD8';
        ctx.beginPath(); ctx.moveTo(px-6,py); ctx.lineTo(px+6,py); ctx.moveTo(px,py-6); ctx.lineTo(px,py+6); ctx.stroke();
        ctx.fillStyle = '#FF4FD8'; ctx.beginPath(); ctx.arc(px, py, 2.2, 0, 7); ctx.fill();
        const label = 'm ' + body.mass.toFixed(0);
        ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.fillStyle = '#fff';
        ctx.strokeText(label, px, py - 10); ctx.fillText(label, px, py - 10); ctx.lineWidth = 1;
        // velocity vector (×4 — readable at settle speeds) and spin arc
        const v = body.velocity;
        if (Math.hypot(v.x, v.y) > .08){
          ctx.strokeStyle = '#FFD23F';
          ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px + v.x*4, py + v.y*4); ctx.stroke();
        }
        if (Math.abs(body.angularVelocity) > .003){
          const s = Math.max(-2.2, Math.min(2.2, body.angularVelocity * 18));
          ctx.strokeStyle = '#FF9F0A';
          ctx.beginPath(); ctx.arc(px, py, 11, -Math.PI/2, -Math.PI/2 + s, s < 0); ctx.stroke();
        }
      }
      // live contact points — where the solver is pushing right now
      ctx.fillStyle = '#FF3B30';
      for (const pair of this.eng.pairs.list){
        if (!pair.isActive) continue;
        for (const c of pair.activeContacts)
          if (c && c.vertex){ ctx.beginPath(); ctx.arc(c.vertex.x, c.vertex.y, 2.2, 0, 7); ctx.fill(); }
      }
      // the pinch: pointer → grab point on the body
      if (this.drag){
        const con = this.drag.con, bB = con.bodyB;
        const gx = bB.position.x + con.pointB.x, gy = bB.position.y + con.pointB.y;
        ctx.strokeStyle = '#41B6FF';
        ctx.beginPath(); ctx.moveTo(con.pointA.x, con.pointA.y); ctx.lineTo(gx, gy); ctx.stroke();
        ctx.fillStyle = '#41B6FF'; ctx.beginPath(); ctx.arc(gx, gy, 3, 0, 7); ctx.fill();
      }
    } else {
      // AABB fallback: the boxes + centres + floor line are all there is
      for (const b of this.blocks){
        ctx.strokeStyle = '#19E68C'; ctx.strokeRect(b.x - b.w/2, b.y - b.h/2, b.w, b.h);
        ctx.fillStyle = '#FF4FD8'; ctx.beginPath(); ctx.arc(b.x, b.y, 2.2, 0, 7); ctx.fill();
      }
      ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.setLineDash([5,4]);
      ctx.beginPath(); ctx.moveTo(0, this.floorY); ctx.lineTo(this.W, this.floorY); ctx.stroke(); ctx.setLineDash([]);
    }
  },
  supportTop(b){
    let top = this.floorY;
    const over = (l, r) => l < b.x + b.w/2 - 1 && r > b.x - b.w/2 + 1;
    for (const o of this.blocks)
      if (o !== b && o.done && !o.held && over(o.x - o.w/2, o.x + o.w/2)) top = Math.min(top, o.y - o.h/2);
    return top;
  },
  loop(){
    if (this.raf) return;
    let last = performance.now();
    const frame = (t) => {
      if (!this.active){ this.raf = 0; return; }
      const dt = Math.min(t - last, 32); last = t;
      if (this.useMatter){
        const M = window.Matter;
        if (this.drag){
          // nothing may sleep while a block is being dragged: a slept block
          // would hover when its support slides out from under it
          for (const b of this.blocks) if (b.body.isSleeping) M.Sleeping.set(b.body, false);
          this.moveDragTarget();
          // pinch-grip friction: bleed the held block's spin each frame so an
          // off-centre grab droops smoothly instead of pendulum-whipping.
          // Light damping while it hangs FREE (heavy damping made the swing
          // crawl and stall short of vertical), heavy while grinding contact.
          const bd = this.drag.b.body;
          M.Body.setAngularVelocity(bd, bd.angularVelocity * (this.drag.touching ? .85 : .9));
          // held-gravity boost (×7 while hanging free): world gravity is ~10×
          // below real scale for blocks this size (stack-stability tradeoff),
          // but pointer accelerations are real-world — the trailing angle
          // atan(a/g) made carried blocks stream sideways like weightless
          // capes. Near-real gravity on just the held block restores the
          // carried-object feel; release returns it to world gravity.
          if (!this.drag.touching)
            M.Body.applyForce(bd, bd.position, { x: 0, y: bd.mass * 0.001 * this.eng.world.gravity.y * 6 });
        }
        // substep long frames — at gravity 2.2 a single 32ms step overlaps more
        const n = dt > 20 ? 2 : 1;
        for (let i = 0; i < n; i++) M.Engine.update(this.eng, dt / n);
        // sleep hygiene sweep (every 10 frames): wake any sleeping body that
        // is in a WRONG state — touching nothing (its support left: it would
        // hang in the air forever) or stuck in a deep overlap (resolution
        // froze mid-sleep). Clean touching sleepers stay asleep through the
        // corner-flip micro-separations resting chamfered boxes produce.
        // NB geometric check (Query.collides), NOT the pairs list: Matter
        // skips narrowphase for sleeping pairs, so a sleeping tower's pairs
        // all read inactive and a pairs-based sweep would wake everything
        if (((this._wakeT = (this._wakeT || 0) + 1) % 10) === 0){
          const all = M.Composite.allBodies(this.eng.world);
          for (const b of this.blocks){
            if (!b.body.isSleeping) continue;
            let touching = false, deep = false;
            for (const col of M.Query.collides(b.body, all.filter(o => o !== b.body)))
              if (col.collided){ touching = true; if (col.depth > 3) deep = true; }
            if (!touching || deep) M.Sleeping.set(b.body, false);
          }
        }
        // anti-tunnel clamps: nothing may outrun the wall thickness in a step
        for (const b of this.blocks){
          const bd = b.body;
          if (bd.speed > 45) M.Body.setVelocity(bd, { x: bd.velocity.x*45/bd.speed, y: bd.velocity.y*45/bd.speed });
          if (Math.abs(bd.angularVelocity) > .5) M.Body.setAngularVelocity(bd, Math.sign(bd.angularVelocity)*.5);
          // settle damping: chamfered corners make stacks rock (the contact
          // point flips corner to corner) and creep sideways; with sleeping
          // off, bleed near-rest motion so towers actually come to rest
          if (bd.speed < .25 && Math.abs(bd.angularVelocity) < .03 && (!this.drag || this.drag.b !== b)){
            M.Body.setVelocity(bd, { x: bd.velocity.x*.85, y: bd.velocity.y*.85 });
            M.Body.setAngularVelocity(bd, bd.angularVelocity*.85);
          }
          // alignment snap, ONE-SHOT: when a block first comes to rest within
          // ~4° of pure vertical/horizontal, ease it onto the exact axis over
          // a few frames, then leave it alone until it moves again. Squared-up
          // kid-friendly resting poses without fighting geometry — CONTINUOUS
          // snapping walks a standing block sideways (its resting pose is
          // often intrinsically a fraction of a degree off-axis).
          if (b.shape.key !== 'ball'){
            if (bd.speed > 3 || Math.abs(bd.angularVelocity) > .12) bd._aligned = false;   // only a real knock re-arms (else snap→detach→resettle can loop)
            else if (!bd._aligned && bd.speed < .25){
              const q = Math.round(bd.angle / (Math.PI/2)) * (Math.PI/2), da = q - bd.angle;
              if (Math.abs(da) >= 0.025 || Math.abs(da) < 0.002) bd._aligned = true;
              else M.Body.setAngle(bd, bd.angle + da*0.12);
            }
          }
        }
        this.sync();
        this.raf = requestAnimationFrame(frame);
      } else {
        const PX_M = this.U / 0.0508, G = 9.81 * PX_M, sdt = Math.min(dt/1000, 0.032);
        let falling = false;
        for (const b of this.blocks){
          if (b.done || b.held) continue;
          b.vy += G * sdt; b.y += b.vy * sdt;
          const top = this.supportTop(b);
          if (b.y + b.h/2 >= top){
            const im = b.vy; b.y = top - b.h/2; b.done = true; b.vy = 0;
            if (im > 0.15*PX_M) Audio2.clack(Math.min(1, im/PX_M));
          } else falling = true;
        }
        this.sync();
        this.raf = falling ? requestAnimationFrame(frame) : 0;
      }
    };
    this.raf = requestAnimationFrame(frame);
  },
  // quantize a body-local click into a predictable grab spot: the central 70%
  // grabs the exact centroid (carries level — smooth dragging is the common
  // intent), only the outer 15% per end gives the pendulum-swing edge anchor.
  // A pinched ball always carries from its middle.
  grabAnchor(b, loc){
    if (b.shape.key === 'ball') return { x: 0, y: 0 };
    const s = (b.shape.key === 'tri' || b.shape.key === 'wedge') ? .6 : 1;  // keep anchors inside sloped hulls
    const q = f => Math.abs(f) < .7 ? 0 : Math.sign(f) * .85;
    return { x: q(loc.x/(b.w/2)) * b.w/2 * s, y: q(loc.y/(b.h/2)) * b.h/2 * s };
  },
  // advance the drag target toward the pointer, constrained so the constraint
  // never picks a fight it must lose: stay inside the static bounds (a target
  // demanding floor penetration thrashes — solver pushes out, spring pulls
  // in), rate-limit the advance (a rigid constraint chasing a teleporting
  // target moves the block through a wall inside ONE engine step, past any
  // velocity clamp), and let the pinch SLIP when the target would lead the
  // anchor by more than a block (fingers lose grip on a stuck block)
  moveDragTarget(){
    const d = this.drag, con = d.con, body = d.b.body, bb = body.bounds;
    const ax = body.position.x + con.pointB.x, ay = body.position.y + con.pointB.y;
    let tx = d.tx - d.ox, ty = d.ty - d.oy;
    tx = Math.max(ax - bb.min.x, Math.min(this.W - (bb.max.x - ax), tx));
    ty = Math.max(ay - bb.min.y, Math.min(this.floorY - (bb.max.y - ay), ty));
    // contact slip: cap the lead component pressing INTO anything we touch —
    // fingers can shove a loose block, but they slip rather than win a
    // penetration fight against a braced one (that fight = the press jitter).
    // Depth-adaptive: the permitted press shrinks by the CURRENT penetration,
    // so a sustained press self-limits at ~4px (≈ the chamfer — reads as
    // corners touching, not wood clipping through wood). A constant press
    // would otherwise beat the position solver, which only corrects a
    // fraction of overlap per frame, and sink blocks visibly into each other.
    let lx = tx - ax, ly = ty - ay, touching = false;
    for (const p of this.eng.pairs.list){
      if (!p.isActive) continue;
      let nx0, ny0;   // unit vector from the held block INTO the obstacle
      if (p.collision.parentA === body){ nx0 = -p.collision.normal.x; ny0 = -p.collision.normal.y; }
      else if (p.collision.parentB === body){ nx0 = p.collision.normal.x; ny0 = p.collision.normal.y; }
      else continue;
      touching = true;
      const cap = Math.max(0, 4 - (p.collision.depth || 0));
      const dd = lx*nx0 + ly*ny0;
      if (dd > cap){ lx -= (dd - cap)*nx0; ly -= (dd - cap)*ny0; }
    }
    tx = ax + lx; ty = ay + ly;
    let mx = tx - con.pointA.x, my = ty - con.pointA.y;
    const step = Math.hypot(mx, my);
    if (step > 40){ mx *= 40/step; my *= 40/step; }
    let nx = con.pointA.x + mx, ny = con.pointA.y + my;
    const glx = nx - ax, gly = ny - ay, lead = Math.hypot(glx, gly);
    if (lead > this.U){ nx = ax + glx*this.U/lead; ny = ay + gly*this.U/lead; }
    con.pointA.x = nx; con.pointA.y = ny;
    // hold-still dead-zone: run the pinch torque-free (angularStiffness 1)
    // when the target isn't leading AND the block is touching something. A
    // torqueful grounded hold RATCHETS: each frame gravity dips the block,
    // the anchor-side correction arrives 30% as torque, and the floor pushes
    // the far side back up but can never pull the near side down — a block
    // held by its side slowly rotated up (~0.03 rad/s) with the mouse still.
    // A block hanging FREE keeps its torque even when the pointer is still:
    // that torque is the legitimate pendulum swing (an end-grabbed plank must
    // keep drooping to vertical, not freeze 45° short the moment you pause).
    // free-hanging: FULL gravity torque (angularStiffness 0) — the pendulum
    // swings and overshoots like a real end-pivoted plank; while touching:
    // .7 dragging / 1 (torque-free) in the hold-still dead-zone, since the
    // grounded ratchet needs a contact to pump against
    con.angularStiffness = touching ? ((lead < 3) ? 1 : .7) : 0;
    d.touching = touching;
  },
  hit(px, py){
    for (let i = this.blocks.length - 1; i >= 0; i--){
      const b = this.blocks[i];
      if (Math.abs(px - b.x) <= b.w/2 && Math.abs(py - b.y) <= b.h/2) return b;
    }
    return null;
  },
  onDown(e){
    if (!this.active || (e.target.closest && e.target.closest('.fb-ops'))) return;
    if (this.drag) this.onUp();   // stale grab (missed pointerup) — release first
    const r = this.area().getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    if (this.useMatter){
      const M = window.Matter;
      const hits = M.Query.point(this.blocks.map(b => b.body), { x: px, y: py });
      if (!hits.length) return;
      const body = hits[hits.length - 1], b = this.blocks.find(x => x.body === body);
      // kill the block's momentum first, so grabbing one that's mid-fall/tumble
      // doesn't fling it; then a spring from finger to grab-point keeps the body
      // dynamic (it collides, and friction carries whatever balances on it).
      // The grab is a two-finger PINCH at a PREDICTABLE spot: the click is
      // quantized to a grab region (centroid dead-zone / mid / edge — see
      // grabAnchor), so a near-centroid pick carries level and an edge pick
      // pivots, with nothing touchy in between. angularStiffness .7 suppresses
      // 70% of the constraint's torque (a length-0 constraint solves rigid —
      // full torque made off-centroid grabs snap); the loop bleeds held spin
      // like grip friction. pointB must be a WORLD-frame offset — Matter
      // records angleB at creation and rotates pointB by the delta, so a
      // body-local offset anchors any tilted block wrong (that was the "grab a
      // settled block's side and it teleports sideways" bug).
      M.Body.setVelocity(body, { x: 0, y: 0 }); M.Body.setAngularVelocity(body, 0);
      const ca = Math.cos(-body.angle), sa = Math.sin(-body.angle);
      const dx = px - body.position.x, dy = py - body.position.y;
      const an = this.grabAnchor(b, { x: dx*ca - dy*sa, y: dx*sa + dy*ca });
      const cb = Math.cos(body.angle), sb = Math.sin(body.angle);
      const off = { x: an.x*cb - an.y*sb, y: an.x*sb + an.y*cb };
      const ax = body.position.x + off.x, ay = body.position.y + off.y;
      const con = M.Constraint.create({ pointA:{ x:ax, y:ay }, bodyB:body,
        pointB:{ x: off.x, y: off.y },
        stiffness:.4, damping:.15, angularStiffness:.7, length:0 });
      M.World.add(this.eng.world, con);
      // finger→anchor offset stays constant: the target follows pointer DELTAS
      // (rate/lead-limited in moveDragTarget), so pickup itself never jumps
      this.drag = { b, con, ox: px - ax, oy: py - ay, tx: px, ty: py };
      b.el.style.zIndex = 9;
    } else {
      const b = this.hit(px, py); if (!b) return;
      this.drag = { b, ox: px - b.x, oy: py - b.y }; b.held = true; b.done = false; b.el.style.zIndex = 9;
    }
    Audio2.unlock();
  },
  onMove(e){
    if (!this.drag) return;
    const r = this.area().getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    if (this.useMatter){ this.drag.tx = px; this.drag.ty = py; }   // loop() advances the target
    else {
      const b = this.drag.b;
      b.x = Math.max(b.w/2, Math.min(this.W - b.w/2, px - this.drag.ox));
      b.y = Math.max(b.h/2, Math.min(this.floorY - b.h/2, py - this.drag.oy));
      this.sync();
    }
  },
  onUp(){
    if (!this.drag) return;
    if (this.useMatter){ window.Matter.World.remove(this.eng.world, this.drag.con); this.drag.b.el.style.zIndex = ''; }
    else { const b = this.drag.b; b.held = false; b.done = false; b.vy = 0; b.el.style.zIndex = ''; this.loop(); }
    this.drag = null;
  },
};


/* ═══════════════════════ 8 · Trial Engine ═════════════════════════════════ */

export { StackerGame };

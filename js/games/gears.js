// Gear Wall — the magnetic gear-board toy: place toy-plastic gears anywhere,
// they stick (magnets — no gravity, no falling), and motor gears drive every
// connected gear at physically exact ratios via the gearworks solver.
// Interaction mirrors the toy: tap a palette icon to pop a gear onto the
// board, drag it anywhere, feel a light magnetic pull as it nears a mesh,
// release to snap tooth-perfect. Tap a motor's hub to cycle its tri-switch:
// off → run → reverse. Contradictory trains (odd loops, fighting motors)
// JAM — everything in that train stops and shows a red hub ring.
import { Audio2 } from '../audio.js';
import { $, attentionNudge, mulberry32 } from '../core.js';
import { showView } from '../router.js';
import { Store } from '../store.js';
import {
  MODULE, TEETH, MOTOR_TEETH, MOTOR_W, pitchR, outerR, rootR,
  meshes, solve, snap, phaseAlign, gearPath, SNAP_DIST, MESH_TOL,
  illegalOverlaps, resolvePlacement, phaseError,
} from './gearworks.js';

// orange lives at the END so no sized gear (indexes 0–4) wears it — it is
// reserved for the motor's TOMY-style body
const COLORS = [
  ['#E24A3B', '#B93327'], ['#3D8BFF', '#2A63C4'], ['#4FBF5E', '#379445'],
  ['#FFC02E', '#D3980F'], ['#7A5FD0', '#5B41AC'], ['#F07E26', '#C55E12'],
];
// ✨ metal mode: one machined metal per gear size — [lite, base, dark, deep]
// (specular → base tone → turned shadow → edge/engraving)
const METALS = [
  ['#F4F7FA', '#C9D0D8', '#98A2AE', '#5F6873'],   // polished silver
  ['#FFF4C2', '#F2C94C', '#C79A26', '#8A6614'],   // gold
  ['#FFD9BE', '#D4855A', '#A85C34', '#70391D'],   // copper
  ['#F7E9B4', '#D3B254', '#A5873A', '#6F5A20'],   // brass
  ['#E2EAF2', '#A9BACA', '#77899B', '#4A5866'],   // blued steel
];
const IRON  = ['#8A929C', '#555E68', '#363E47', '#20262D'];          // the engine's cast iron
const BRASS = { hi: '#F9EBBB', mid: '#CFAE4E', lo: '#8F6A14' };      // its fittings
// two-cylinder steam engine geometry (px; origin = the drive-pinion centre).
// The crank gear meshes the drive pinion at the exact pitch-sum distance, so
// the visible cog-on-cog drive inside the case is the same physics the whole
// wall runs on — not decoration.
const SE = {
  CG: 18,                                     // crank/flywheel gear teeth
  CY: -(pitchR(MOTOR_TEETH) + pitchR(18)),    // crankshaft centre: exact mesh (-120)
  RC: 22, L: 80, CHX: 41.5,                   // crank throw, conn-rod length, cylinder axes
  CT: -286, CB: -226, CW: 40,                 // cylinder top / bottom (gland line) / width
};

const GearGame = {
  FACE_Y: -1.05,   // clock-face centre, in units of the gear's outer radius
  gears: [], raf: 0, active: false, bound: false, drag: null,
  W: 0, H: 0, seq: 0, colorIdx: 0, sol: { w: [], jam: new Set() },
  area(){ return $('#gears-area'); },

  start(){
    Audio2.unlock(); showView('gears');
    const r = this.area().getBoundingClientRect();
    this.W = r.width; this.H = r.height;
    let cv = $('#gr-dbg-cv');
    if (!cv){
      cv = document.createElement('canvas'); cv.id = 'gr-dbg-cv';
      cv.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:20';
      this.area().appendChild(cv);
    }
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(this.W * this.dpr); cv.height = Math.round(this.H * this.dpr);
    cv.style.width = this.W + 'px'; cv.style.height = this.H + 'px';
    if (this.raf){ cancelAnimationFrame(this.raf); this.raf = 0; }
    this.fancy = !!Store.settings().metalGears;
    const mBtn = $('#gr-metal-btn'); if (mBtn) mBtn.classList.toggle('on', this.fancy);
    this.area().classList.toggle('gr-fancy', this.fancy);
    this.active = true;
    this.renderOps();
    this.loop();
    if (!this.bound){
      this.area().addEventListener('pointerdown', e => this.onDown(e));
      window.addEventListener('pointermove', e => this.onMove(e));
      window.addEventListener('pointerup', e => this.onUp(e));
      window.addEventListener('pointercancel', e => this.onUp(e));
      this.area().addEventListener('contextmenu', e => { e.preventDefault(); this.onUp(); });
      $('#gr-reset').addEventListener('click', () => this.reset());
      $('#gr-dbg-btn').addEventListener('click', e => {
        this.debug = !this.debug;
        e.currentTarget.classList.toggle('on', this.debug);
        this.drawDebug();
      });
      $('#gr-metal-btn').addEventListener('click', e => {
        this.fancy = !this.fancy;
        e.currentTarget.classList.toggle('on', this.fancy);
        const st = Store.settings(); st.metalGears = this.fancy; Store.saveSettings(st);
        this.reskin();
      });
      this.bound = true;
    }
  },
  stop(){
    this.active = false;
    if (this.raf){ cancelAnimationFrame(this.raf); this.raf = 0; }
    this.reset();
  },
  reset(){
    this.gears = []; this.drag = null; this.colorIdx = 0;
    this.area().querySelectorAll('.gr-gear').forEach(e => e.remove());
    this.sol = { w: [], jam: new Set() };
    this.opsCue();
  },

  renderOps(){
    const ops = $('#gr-ops');
    // one icon per gear size in its toy colour (size ↔ colour, so the icon
    // predicts the piece); the MOTOR is the only orange piece, with the
    // yellow-and-blue lightning hub of the toy. In ✨ metal mode the icons
    // wear their gear's metal, and the motor shows its brass-on-iron hub.
    const icon = (teeth, motor, i) => {
      const R = outerR(teeth), rr = rootR(teeth), s = 46;
      const [body, dark] = motor
        ? (this.fancy ? [IRON[1], IRON[3]] : ['#F07E26', '#C55E12'])
        : (this.fancy ? [METALS[i % METALS.length][1], METALS[i % METALS.length][3]] : COLORS[i % COLORS.length]);
      return `<svg viewBox="${-R} ${-R} ${R*2} ${R*2}" width="${s}" height="${s}" style="display:block">
        <path d="${gearPath(teeth)}" fill="${body}" stroke="${dark}" stroke-width="2"/>
        ${motor
          ? (this.fancy
            ? `<circle r="${rr*.66}" fill="${BRASS.mid}"/><circle r="${rr*.5}" fill="#262C33"/>
               <circle r="${rr*.2}" fill="none" stroke="${BRASS.mid}" stroke-width="3"/>`
            : `<circle r="${rr*.66}" fill="#FFC02E"/><circle r="${rr*.52}" fill="#2F6FD1"/>
               <path d="M ${rr*.14} ${-rr*.34} L ${-rr*.18} ${rr*.06} L ${rr*.02} ${rr*.06} L ${-rr*.1} ${rr*.36} L ${rr*.22} ${-rr*.04} L ${rr*.02} ${-rr*.04} Z" fill="#FFC02E"/>`)
          : `<circle r="${rr*.42}" fill="#fff" opacity=".7"/><circle r="${rr*.16}" fill="${dark}"/>`}
      </svg>`;
    };
    // engines FIRST, set off by a gap — they are what makes everything move
    ops.innerHTML = `<button class="fb-btn gr-pick gr-pick-motor" data-motor="1" aria-label="Add a motor gear">${icon(MOTOR_TEETH, true, 0)}</button>`
      + `<button class="fb-btn gr-pick gr-pick-steam gr-gap" data-steam="1" aria-label="Add a two-cylinder steam engine">
          <svg viewBox="0 0 48 48" width="46" height="46" style="display:block">
            <rect x="7" y="14" width="34" height="26" rx="3" fill="#2A313A" stroke="#161B21" stroke-width="1.6"/>
            <rect x="12" y="6" width="9" height="11" rx="1.5" fill="#CFAE4E" stroke="#8F6A14" stroke-width="1.4"/>
            <rect x="27" y="6" width="9" height="11" rx="1.5" fill="#CFAE4E" stroke="#8F6A14" stroke-width="1.4"/>
            <circle cx="24" cy="27" r="8.5" fill="none" stroke="#8A929C" stroke-width="2.6"/>
            <path d="M24 19 V35 M16 27 H32 M18.5 21.5 L29.5 32.5 M29.5 21.5 L18.5 32.5" stroke="#8A929C" stroke-width="1.8"/>
            <circle cx="24" cy="27" r="2.8" fill="#CFAE4E"/>
            <circle cx="24" cy="42" r="4.6" fill="#C9D0D8" stroke="#5F6873" stroke-width="1.4"/>
          </svg></button>`
      + TEETH.map((t, i) =>
        `<button class="fb-btn gr-pick" data-teeth="${i}" aria-label="Add a ${t}-tooth gear">${icon(t, false, i)}</button>`).join('')
      + `<button class="fb-btn gr-pick gr-pick-bell" data-bell="1" aria-label="Add a bell tower">
          <svg viewBox="0 0 48 48" width="46" height="46" style="display:block">
            <path d="M11 15 L24 4 L37 15 Z" fill="#8E6B4A"/>
            <rect x="14" y="15" width="20" height="21" rx="2.5" fill="#B9AFA2"/>
            <path d="M17 30 L17 22 A 7 7 0 0 1 31 22 L31 30 Z" fill="#4a4239"/>
            <path d="M20 27 C 20 22.5 21.5 21 24 21 C 26.5 21 28 22.5 28 27 L 29 28.5 L 19 28.5 Z" fill="#E8B84B" stroke="#B9821A" stroke-width="1.4"/>
            <circle cx="24" cy="29.6" r="1.4" fill="#8a6a1c"/>
            <path d="M24 36 l2.5 4.5 5-1.5 .5 5-5 2-3-3-3 3-5-2 .5-5 5 1.5z" fill="#C9CDD4"/>
          </svg></button>`
      + `<button class="fb-btn gr-pick gr-pick-clock" data-clock="1" aria-label="Add a cuckoo clock">
          <svg viewBox="0 0 48 48" width="46" height="46" style="display:block">
            <path d="M10 16 L24 5 L38 16 Z" fill="#8B5A2B"/>
            <rect x="13" y="16" width="22" height="20" rx="2.5" fill="#A9713A"/>
            <circle cx="24" cy="25" r="6.5" fill="#F4E4C1" stroke="#5c3b1c" stroke-width="1.6"/>
            <line x1="24" y1="25" x2="24" y2="20.5" stroke="#5c3b1c" stroke-width="1.6"/>
            <line x1="24" y1="25" x2="27.5" y2="25" stroke="#5c3b1c" stroke-width="1.6"/>
            <path d="M24 33 l2.5 4.5 5-1.5 .5 5-5 2-2.5-3-2.5 3-5-2 .5-5 5 1.5z" fill="#F0B429"/>
          </svg></button>`;
    ops.querySelectorAll('.gr-pick').forEach(btn => {
      btn.addEventListener('pointerdown', e => {
        e.preventDefault();
        const d = btn.dataset;
        this.spawn((d.motor || d.clock || d.bell || d.steam) ? -1 : +d.teeth,
          !!d.motor, !!d.clock, !!d.bell, !!d.steam);
      });
    });
    this.opsCue();
  },
  // pulse the engine icons while the board has no driver — nothing can move
  // until one of these goes down. (Condition-held flavor of the attention-cue
  // pattern; see attentionNudge in core.js for the futile-taps flavor.)
  opsCue(){
    const ops = $('#gr-ops');
    if (ops) ops.classList.toggle('gr-need-engine', !this.gears.some(g => g.motor));
  },

  spawn(teethIdx, motor, clock, bell, steam){
    const teeth = (motor || clock || bell || steam) ? MOTOR_TEETH : TEETH[teethIdx];
    const g = {
      // the steam engine IS a motor to the solver — same tri-switch, same hub speed
      id: ++this.seq, teeth, motor: motor || steam, clock, bell, steam, sw: 0,
      x: this.W/2, y: Math.min(this.H*0.3, outerR(teeth) + this.H*0.14),
      angle: 0, color: COLORS[(motor || clock || bell || steam) ? 0 : teethIdx % COLORS.length],
    };
    if (steam){ g.thr = 1; g.throttle = 1; }   // throttle starts at normal speed
    // placement with a purpose: the first piece lands centre; every later
    // piece drops ALREADY MESHED onto the newest gear of the train — a child
    // who just taps the palette watches a working machine grow
    const R2 = outerR(teeth), pr = pitchR(teeth);
    const dims = this.houseDims(g);                // null for plain gears
    // spawned pieces land FULLY on the board (dragging may hang off later);
    // housing cases are wider AND taller than their gear
    const xm = dims ? dims.hw + 4 : R2*1.02;
    const inBounds = (x, y) => x > xm && x < this.W - xm &&
      y > (dims ? dims.hh : R2*1.02) && y < this.H - R2*1.02;
    // housings own the rectangle above their gear: no piece may land inside
    // an existing case, and a new case may not swallow an existing gear
    const towerClash = (x, y) => this.gears.some(o => {
      const od = this.houseDims(o), oR = outerR(o.teeth);
      return (od && Math.abs(x - o.x) < od.hw + R2 && y < o.y && y > o.y - od.hh - R2)
          || (dims && Math.abs(o.x - x) < dims.hw + oR && o.y < y && o.y > y - dims.hh - oR);
    });
    // clear of everyone but the anchor — outside snap capture range, so the
    // newcomer meshes with exactly ONE gear: chains stay trees, trees never jam
    const clearOf = (x, y, skip) => this.gears.every(o => o === skip ||
      Math.hypot(o.x - x, o.y - y) > pitchR(o.teeth) + pr + SNAP_DIST + 2);
    if (!this.gears.length){
      // start LEFT of centre: the chain grows rightward, so it marches
      // through the middle of the board instead of crowding one side.
      // A housing's case must also clear the palette overlay (~150px tall).
      g.x = this.W*0.38; g.y = Math.max(this.H*0.5, dims ? dims.hh + 150 : 0);
    } else {
      // sideways first, then shallow diagonals — the train snakes across the
      // board instead of stacking. Housings drive from BELOW their case, so a
      // housing anchor takes its newcomer underneath, and a newcomer housing
      // reaches down to mesh an anchor from above.
      const DIRS = [0, 180, 40, 140, 320, 220, 70, 110, 290, 250, 90, 270].map(d => d*Math.PI/180);
      let placed = false;
      outer: for (const a of [...this.gears].reverse()){    // newest first → a chain
        const d = pitchR(a.teeth) + pr;
        for (const t of DIRS){
          if ((a.clock || a.bell || a.steam) && Math.sin(t) < 0.35) continue;
          if (dims && Math.sin(t) > -0.35) continue;
          const x = a.x + Math.cos(t)*d, y = a.y + Math.sin(t)*d;
          if (!inBounds(x, y) || towerClash(x, y) || !clearOf(x, y, a)) continue;
          g.x = x; g.y = y; placed = true; break outer;
        }
      }
      if (!placed){   // board crowded — sideways shuffle to any clear spot
        for (let k = 0; k < 18; k++){
          if (clearOf(g.x, g.y, null) && !towerClash(g.x, g.y)) break;
          g.x = this.W/2 + ((k%2 ? 1 : -1) * Math.ceil((k+1)/2)) * R2 * 1.15;
        }
      }
    }
    if (dims) g.y = Math.max(g.y, dims.hh);   // headroom safety
    const el = document.createElement('div');
    el.className = 'gr-gear';
    const R = outerR(teeth);
    el.style.width = el.style.height = (R*2) + 'px';
    el.innerHTML = this.gearSVG(g);
    this.area().appendChild(el);
    g.el = el;
    this.bindRefs(g);
    this.gears.push(g);
    snap(this.gears, this.gears.length - 1);
    this.solveNow();
    this.syncOne(g);
    Audio2.pop();
    // a fresh engine introduces its handle: glow-pulse the Johnson bar 3×
    if (steam) (this.barNudge ??= attentionNudge()).cue(g.el, 'gre-nudge');
    return g;
  },
  // repaint every piece in the current skin (toy plastic ↔ ✨ metal)
  reskin(){
    this.area().classList.toggle('gr-fancy', this.fancy);
    for (const g of this.gears){
      g.el.innerHTML = this.gearSVG(g);
      this.bindRefs(g);
      this.syncOne(g);
    }
    this.solveNow();          // re-arm the jam rings on the fresh SVGs
    this.renderOps();
  },
  // live-element handles into a freshly rendered gear SVG
  bindRefs(g){
    const q = s => g.el.querySelector(s);
    g.shadeEl = q('.grm-shade');
    g.rotEl = q('.grc-rot'); g.mHand = q('.grc-mh'); g.hHand = q('.grc-hh');
    if (g.steam){
      g.crankEl = q('.gre-crank');
      g.chL = q('.gre-chL');     g.chR = q('.gre-chR');
      g.rodL = q('.gre-rodL');   g.rodR = q('.gre-rodR');
      g.prodL = q('.gre-prodL'); g.prodR = q('.gre-prodR');
      g.needleEl = q('.gre-needle');
      g.needleTo = null;              // fresh element: force a real re-sync
      this.gaugeSync(g);
    }
  },
  // sweep the persistent gauge needle to the engine's current speed; the CSS
  // transition on .gre-needle damps it like a real instrument. Changing
  // between two RUNNING speeds vents deliberately: a quick full drop to 0,
  // a beat, then the damped climb to the new reading.
  gaugeSync(g){
    if (!g.needleEl) return;
    const psi = Math.min(200, Math.abs(g.psiW || 0) / MOTOR_W * 100);
    const ZERO = 'rotate(135.0deg)';
    const target = `rotate(${(135 + psi/200*270).toFixed(1)}deg)`;
    if (target === g.needleTo) return;
    const prev = g.needleTo;
    g.needleTo = target;
    clearTimeout(g.needleT);
    if (psi > 0 && prev && prev !== ZERO){
      g.needleEl.style.transitionDuration = '.35s';
      g.needleEl.style.transform = ZERO;
      g.needleT = setTimeout(() => {
        g.needleEl.style.transitionDuration = '';
        g.needleEl.style.transform = target;
      }, 420);
    } else {
      g.needleEl.style.transform = target;
    }
  },
  // the rectangle a housing's case occupies ABOVE its gear centre (half-width,
  // height); null for plain gears. Placement, tower-clash and hit tests share it.
  houseDims(g){
    const R = outerR(g.teeth);
    if (g.steam) return { hw: R*3.1, hh: R*5.85 };
    if (g.clock || g.bell) return { hw: R*1.3, hh: R*4 };
    return null;
  },
  remove(g){
    const i = this.gears.indexOf(g);
    if (i < 0) return;
    g.el.remove();
    this.gears.splice(i, 1);
    this.solveNow();
    Audio2.pop();
  },

  gearSVG(g){
    if (g.steam) return this.steamSVG(g);   // one skin — it is already all metal
    if (g.clock) return this.clockSVG(g);
    if (g.bell) return this.bellSVG(g);
    if (this.fancy) return this.metalSVG(g);
    const R = outerR(g.teeth), rr = rootR(g.teeth);
    const [body, dark] = g.motor ? ['#F07E26', '#C55E12'] : g.color;   // motor = orange, TOMY-style
    // soft round finger-holes like the toy — friendly circles, nothing
    // blade-like; the ring going round is what shows rotation. The motor
    // skips them (its lightning hub covers the middle)
    const holes = [];
    if (!g.motor){
      const nH = g.teeth >= 20 ? 6 : 5, ringR = rr * 0.55, hR = rr * 0.22;
      for (let k = 0; k < nH; k++){
        const a = k * 2*Math.PI/nH;
        holes.push(`<circle cx="${(ringR*Math.cos(a)).toFixed(1)}" cy="${(ringR*Math.sin(a)).toFixed(1)}" r="${hR.toFixed(1)}"/>`);
      }
    }
    const hub = g.motor ? this.motorHub(g, rr) :
      `<circle r="${(rr*0.3).toFixed(1)}" fill="#fff" opacity=".85"/>
       <circle r="${(rr*0.12).toFixed(1)}" fill="${dark}"/>`;
    return `<svg viewBox="${-R} ${-R} ${R*2} ${R*2}" style="display:block;width:100%;height:100%;overflow:visible">
      <path d="${gearPath(g.teeth)}" fill="${body}" stroke="${dark}" stroke-width="2.5" stroke-linejoin="round"/>
      <circle r="${(rr*0.92).toFixed(1)}" fill="#fff" opacity=".13"/>
      <g fill="${dark}" opacity=".55">${holes.join('')}</g>
      <circle class="gr-jamring" r="${(rr*0.98).toFixed(1)}" fill="none" stroke="#E24A3B" stroke-width="4" opacity="0"/>
      ${hub}
    </svg>`;
  },
  // ── ✨ metal mode ──
  // cast-metal speckle: two turbulence layers (light glints + dark pores)
  // gated to sparse dots and composited over the shape — same recipe as the
  // stacker's wood grain, tuned down to a machined-surface fleck
  metalFilter(uid, seed){
    const layer = (i, freq, gain, bias, color, op, sd) => `
      <feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="2" seed="${sd}" result="t${i}"/>
      <feColorMatrix in="t${i}" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  ${gain} ${gain} ${gain} 0 ${bias}" result="b${i}"/>
      <feFlood flood-color="${color}" flood-opacity="${op}" result="c${i}"/>
      <feComposite in="c${i}" in2="b${i}" operator="in" result="g${i}"/>`;
    return `<filter id="${uid}" x="-5%" y="-5%" width="110%" height="110%">
      ${layer(1, 0.5, 2.4, -3.9, '#fff', .06, seed)}
      ${layer(2, 0.33, 2.4, -4.0, '#000', .07, seed + 17)}
      <feMerge result="fleck"><feMergeNode in="g1"/><feMergeNode in="g2"/></feMerge>
      <feComposite in="fleck" in2="SourceAlpha" operator="in" result="clip"/>
      <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="clip"/></feMerge>
    </filter>`;
  },
  // bright machined metal: banded gradient body + turned face plate with
  // embossed rim, punched lightening holes, a hex axle nut — and a sheen
  // (radial specular + diagonal window-streak) CLIPPED to the gear silhouette
  // and counter-rotated, so the light source stays put while the gear spins
  // under it (the planet-lighting trick from the stacker). The motor is the
  // steampunk engine: cast iron, brass rivets, gauge-face hub.
  metalSVG(g){
    const R = outerR(g.teeth), rr = rootR(g.teeth), n = x => (+x).toFixed(1);
    const uid = 'grm' + g.id;
    const idx = TEETH.indexOf(g.teeth);
    const [lite, base, dark, deep] = g.motor ? IRON : METALS[Math.max(0, idx) % METALS.length];
    const holes = [];
    if (!g.motor){
      const nH = g.teeth >= 20 ? 6 : 5, ringR = rr * 0.55, hR = rr * 0.22;
      for (let k = 0; k < nH; k++){
        const a = k * 2*Math.PI/nH;
        holes.push(`<circle cx="${(ringR*Math.cos(a)).toFixed(1)}" cy="${(ringR*Math.sin(a)).toFixed(1)}" r="${hR.toFixed(1)}" fill="url(#${uid}h)" stroke="${deep}" stroke-width="1"/>`);
      }
    }
    const rivets = g.motor ? Array.from({ length: 8 }, (_, k) => {
      const a = k * Math.PI/4 + Math.PI/8, rx = rr * 0.82;
      return `<circle cx="${n(Math.cos(a)*rx)}" cy="${n(Math.sin(a)*rx)}" r="2.6" fill="url(#${uid}v)" stroke="${BRASS.lo}" stroke-width="0.8"/>`;
    }).join('') : '';
    // hex axle nut for plain gears; the motor's hub comes from motorHub so the
    // tri-switch keeps working (refreshHub swaps it in place)
    const hex = Array.from({ length: 6 }, (_, k) => {
      const a = Math.PI/6 + k * Math.PI/3, hr = rr * 0.32;
      return `${(hr*Math.cos(a)).toFixed(1)},${(hr*Math.sin(a)).toFixed(1)}`;
    }).join(' ');
    const hub = g.motor ? this.motorHub(g, rr) :
      `<polygon points="${hex}" fill="url(#${uid}b)" stroke="${deep}" stroke-width="1.5" stroke-linejoin="round"/>
       <circle r="${n(rr*0.13)}" fill="url(#${uid}x)" stroke="#0E1216" stroke-width="0.8"/>`;
    return `<svg viewBox="${-R} ${-R} ${R*2} ${R*2}" style="display:block;width:100%;height:100%;overflow:visible">
      <defs>
        <linearGradient id="${uid}b" x1="0" y1="0" x2="0.65" y2="1">
          <stop offset="0" stop-color="${lite}"/><stop offset=".28" stop-color="${base}"/>
          <stop offset=".5" stop-color="${lite}"/><stop offset=".74" stop-color="${dark}"/>
          <stop offset="1" stop-color="${deep}"/>
        </linearGradient>
        <linearGradient id="${uid}r" x1="0.65" y1="1" x2="0" y2="0">
          <stop offset="0" stop-color="${lite}"/><stop offset=".28" stop-color="${base}"/>
          <stop offset=".5" stop-color="${lite}"/><stop offset=".74" stop-color="${dark}"/>
          <stop offset="1" stop-color="${deep}"/>
        </linearGradient>
        <radialGradient id="${uid}h" cx="0.4" cy="0.34" r="0.95">
          <stop offset="0" stop-color="#14181D"/><stop offset=".6" stop-color="${deep}"/><stop offset="1" stop-color="${base}"/>
        </radialGradient>
        <radialGradient id="${uid}x" cx="0.38" cy="0.34" r="0.9">
          <stop offset="0" stop-color="${dark}"/><stop offset="1" stop-color="#0E1216"/>
        </radialGradient>
        ${g.motor ? `<radialGradient id="${uid}v" cx="0.35" cy="0.3" r="1">
          <stop offset="0" stop-color="${BRASS.hi}"/><stop offset=".55" stop-color="${BRASS.mid}"/><stop offset="1" stop-color="${BRASS.lo}"/>
        </radialGradient>` : ''}
        <radialGradient id="${uid}s" cx="0.32" cy="0.27" r="0.95">
          <stop offset="0" stop-color="#fff" stop-opacity=".6"/>
          <stop offset=".32" stop-color="#fff" stop-opacity=".14"/>
          <stop offset=".6" stop-color="#fff" stop-opacity="0"/>
          <stop offset=".86" stop-color="#0A1018" stop-opacity=".2"/>
          <stop offset="1" stop-color="#0A1018" stop-opacity=".5"/>
        </radialGradient>
        <linearGradient id="${uid}k" x1="0" y1="0" x2="0.9" y2="1">
          <stop offset=".34" stop-color="#fff" stop-opacity="0"/>
          <stop offset=".47" stop-color="#fff" stop-opacity=".4"/>
          <stop offset=".56" stop-color="#fff" stop-opacity="0"/>
          <stop offset=".66" stop-color="#fff" stop-opacity=".16"/>
          <stop offset=".74" stop-color="#fff" stop-opacity="0"/>
        </linearGradient>
        <clipPath id="${uid}c"><path d="${gearPath(g.teeth)}"/></clipPath>
        ${this.metalFilter(uid + 'n', g.id * 13 + 7)}
      </defs>
      <g filter="url(#${uid}n)">
        <path d="${gearPath(g.teeth)}" fill="url(#${uid}b)" stroke="${deep}" stroke-width="2" stroke-linejoin="round"/>
        <circle r="${n(rr*0.9)}" fill="url(#${uid}r)" opacity=".35"/>
      </g>
      <circle r="${n(rr*0.9)}" fill="none" stroke="${deep}" stroke-width="1.4" opacity=".55" transform="translate(0.8 0.8)"/>
      <circle r="${n(rr*0.9)}" fill="none" stroke="${lite}" stroke-width="1.4" opacity=".6" transform="translate(-0.8 -0.8)"/>
      ${holes.join('')}${rivets}
      ${hub}
      <g clip-path="url(#${uid}c)"><g class="grm-shade">
        <circle r="${n(R*1.02)}" fill="url(#${uid}s)"/>
        <circle r="${n(R*1.02)}" fill="url(#${uid}k)"/>
      </g></g>
      <circle class="gr-jamring" r="${n(rr*0.98)}" fill="none" stroke="#E24A3B" stroke-width="4" opacity="0"/>
    </svg>`;
  },
  // the cuckoo clock: a chalet whose bottom gear is the input — drive it a
  // full revolution and the bird pops out with a real "cuckoo". The housing
  // never rotates; only the .grc-rot gear (and the geared clock hands) spin.
  clockSVG(g){
    const R = outerR(g.teeth), rr = rootR(g.teeth), n = x => (+x).toFixed(1);
    // the input gear sits half INSIDE the case: the housing's bottom edge
    // runs through the gear centre, so only the driving teeth peek out below
    const W = R*2.3, bodyTop = -R*2.95, bodyBot = R*0.06, peak = -R*3.7;
    const fx = 0, fy = R*this.FACE_Y, fr = R*0.62;       // clock face
    const dx = 0, dy = -R*2.3, dw = R*0.62, dh = R*0.56; // door
    const tooth = `<path d="${gearPath(g.teeth)}" fill="#F0B429" stroke="#B9821A" stroke-width="2.5" stroke-linejoin="round"/>`;
    return `<svg viewBox="${-R} ${-R} ${R*2} ${R*2}" style="display:block;width:100%;height:100%;overflow:visible">
      <g class="grc-rot">${tooth}
        <circle r="${n(rr*0.42)}" fill="#fff" opacity=".5"/>
        <circle r="${n(rr*0.14)}" fill="#7a4e12"/>
      </g>
      <g class="grc-house">
        <rect x="${n(-W/2)}" y="${n(bodyTop)}" width="${n(W)}" height="${n(bodyBot-bodyTop)}" rx="${n(R*0.12)}" fill="#A9713A" stroke="#7a4e12" stroke-width="2.5"/>
        <path d="M ${n(-W/2 - R*0.16)} ${n(bodyTop + R*0.06)} L 0 ${n(peak)} L ${n(W/2 + R*0.16)} ${n(bodyTop + R*0.06)} Z" fill="#8B5A2B" stroke="#6b431a" stroke-width="2.5" stroke-linejoin="round"/>
        <rect x="${n(dx-dw/2)}" y="${n(dy-dh/2)}" width="${n(dw)}" height="${n(dh)}" rx="3" fill="#3a2410"/>
        <g transform="translate(${n(dx)} ${n(dy + dh*0.12)})"><g class="grc-bird">
          <ellipse cx="0" cy="1" rx="${n(dw*0.4)}" ry="${n(dh*0.32)}" fill="#E07B39"/>
          <path d="M ${n(-dw*0.34)} 0 q ${n(-dw*0.24)} ${n(-dh*0.1)} ${n(-dw*0.2)} ${n(dh*0.22)} q ${n(dw*0.16)} ${n(dh*0.06)} ${n(dw*0.3)} ${n(-dh*0.06)} Z" fill="#C96A2F"/>
          <circle cx="0" cy="${n(-dh*0.32)}" r="${n(dw*0.27)}" fill="#E8934F"/>
          <path d="M ${n(dw*0.2)} ${n(-dh*0.38)} L ${n(dw*0.58)} ${n(-dh*0.46)} L ${n(dw*0.22)} ${n(-dh*0.2)} Z" fill="#F0B429"/>
          <circle cx="${n(-dw*0.08)}" cy="${n(-dh*0.36)}" r="2" fill="#2a2a2a"/>
        </g></g>
        <rect class="grc-doorL" x="${n(dx-dw/2-1)}" y="${n(dy-dh/2-1)}" width="${n(dw/2+1.5)}" height="${n(dh+2)}" rx="2" fill="#5c3b1c" stroke="#3a2410" stroke-width="1"/>
        <rect class="grc-doorR" x="${n(dx-0.5)}" y="${n(dy-dh/2-1)}" width="${n(dw/2+1.5)}" height="${n(dh+2)}" rx="2" fill="#503216" stroke="#3a2410" stroke-width="1"/>
        <rect x="${n(dx-dw/2)}" y="${n(dy+dh/2-2)}" width="${n(dw)}" height="3.5" rx="1.5" fill="#5c3b1c"/>
        <circle cx="${n(fx)}" cy="${n(fy)}" r="${n(fr)}" fill="#F4E4C1" stroke="#5c3b1c" stroke-width="3"/>
        ${[['12',0,-1],['3',1,0],['6',0,1],['9',-1,0]].map(([t, ux, uy]) =>
          `<text x="${n(fx + ux*fr*0.66)}" y="${n(fy + uy*fr*0.66 + fr*0.13)}" font-family="Georgia,serif" font-weight="700" font-size="${n(fr*0.36)}" fill="#5c3b1c" text-anchor="middle">${t}</text>`).join('')}
        ${[1,2,4,5,7,8,10,11].map(k => `<circle cx="${n(fx + Math.sin(k*Math.PI/6)*fr*0.78)}" cy="${n(fy - Math.cos(k*Math.PI/6)*fr*0.78)}" r="1.4" fill="#5c3b1c" opacity=".75"/>`).join('')}
        <line class="grc-mh" x1="${n(fx)}" y1="${n(fy)}" x2="${n(fx)}" y2="${n(fy - fr*0.6)}" stroke="#5c3b1c" stroke-width="3" stroke-linecap="round"/>
        <line class="grc-hh" x1="${n(fx)}" y1="${n(fy)}" x2="${n(fx)}" y2="${n(fy - fr*0.4)}" stroke="#5c3b1c" stroke-width="3.6" stroke-linecap="round"/>
      </g>
      <circle class="gr-jamring" r="${n(rr*0.98)}" fill="none" stroke="#E24A3B" stroke-width="4" opacity="0"/>
    </svg>`;
  },
  // campanile: stone tower, open belfry with a swinging bell, the input gear
  // half inside the base — one ring per driven revolution
  bellSVG(g){
    const R = outerR(g.teeth), rr = rootR(g.teeth), n = x => (+x).toFixed(1);
    const W = R*1.9, bodyTop = -R*3.0, bodyBot = R*0.06, peak = -R*3.9;
    const ax = 0, ay = -R*1.9, aw = R*1.15, ah = R*1.5;    // belfry arch
    const bellW = aw*0.62, bellH = ah*0.52;
    const hangY = ay - ah*0.45;                             // bell pivot
    const tooth = `<path d="${gearPath(g.teeth)}" fill="#C9CDD4" stroke="#8A919C" stroke-width="2.5" stroke-linejoin="round"/>`;
    return `<svg viewBox="${-R} ${-R} ${R*2} ${R*2}" style="display:block;width:100%;height:100%;overflow:visible">
      <g class="grc-rot">${tooth}
        <circle r="${n(rr*0.42)}" fill="#fff" opacity=".5"/>
        <circle r="${n(rr*0.14)}" fill="#5b626c"/>
      </g>
      <g class="grc-house">
        <rect x="${n(-W/2)}" y="${n(bodyTop)}" width="${n(W)}" height="${n(bodyBot-bodyTop)}" rx="${n(R*0.1)}" fill="#B9AFA2" stroke="#847A6D" stroke-width="2.5"/>
        <rect x="${n(-W/2)}" y="${n(bodyTop)}" width="${n(W)}" height="${n(R*0.35)}" fill="#a89d8f"/>
        <path d="M ${n(-W/2 - R*0.14)} ${n(bodyTop + R*0.04)} L 0 ${n(peak)} L ${n(W/2 + R*0.14)} ${n(bodyTop + R*0.04)} Z" fill="#8E6B4A" stroke="#6b4e33" stroke-width="2.5" stroke-linejoin="round"/>
        <circle cx="0" cy="${n(peak - 4)}" r="3.4" fill="#E8B84B" stroke="#B9821A" stroke-width="1.5"/>
        <path d="M ${n(ax-aw/2)} ${n(ay+ah/2)} L ${n(ax-aw/2)} ${n(ay-ah*0.16)} A ${n(aw/2)} ${n(aw/2)} 0 0 1 ${n(ax+aw/2)} ${n(ay-ah*0.16)} L ${n(ax+aw/2)} ${n(ay+ah/2)} Z" fill="#4a4239"/>
        <g transform="translate(${n(ax)} ${n(hangY)})"><g class="grb-bell">
          <rect x="-2" y="-3" width="4" height="6" fill="#6b4e33"/>
          <path d="M ${n(-bellW/2)} ${n(bellH*0.78)}
            C ${n(-bellW/2)} ${n(bellH*0.2)} ${n(-bellW*0.28)} ${n(bellH*0.06)} ${n(-bellW*0.2)} ${n(bellH*0.02)}
            C ${n(-bellW*0.12)} ${n(-bellH*0.05)} ${n(bellW*0.12)} ${n(-bellH*0.05)} ${n(bellW*0.2)} ${n(bellH*0.02)}
            C ${n(bellW*0.28)} ${n(bellH*0.06)} ${n(bellW/2)} ${n(bellH*0.2)} ${n(bellW/2)} ${n(bellH*0.78)}
            L ${n(bellW*0.56)} ${n(bellH*0.92)} L ${n(-bellW*0.56)} ${n(bellH*0.92)} Z"
            fill="#E8B84B" stroke="#B9821A" stroke-width="2" stroke-linejoin="round"/>
          <circle cx="0" cy="${n(bellH*1.02)}" r="${n(bellW*0.14)}" fill="#8a6a1c"/>
        </g></g>
      </g>
      <circle class="gr-jamring" r="${n(rr*0.98)}" fill="none" stroke="#E24A3B" stroke-width="4" opacity="0"/>
    </svg>`;
  },
  // ── the two-cylinder steam engine ──
  // an open-frame stationary engine, cutaway so the whole mechanism shows:
  // the exposed drive pinion meshes an 18-tooth spoked flywheel-gear INSIDE
  // the case (real gearPath teeth, phase-locked in syncSteam), whose crank
  // pins — 90° apart, like a real two-crank engine so it self-starts — swing
  // connecting rods up to crossheads sliding in guides, with piston rods
  // running into the glands of two brass cylinders fed from a steam dome.
  // Johnson bar (reversing lever) + pressure gauge show the tri-switch state.
  steamSVG(g){
    const R = outerR(g.teeth), rr = rootR(g.teeth), n = x => (+x).toFixed(1);
    const { CG, CY, RC, CHX, CT, CB, CW } = SE;
    const uid = 'gre' + g.id, I = IRON, B = BRASS;
    const HW = R*3.0, IT = -262, BOT = R*0.06;      // case half-width, interior top, bottom
    const cgRoot = rootR(CG);                        // flywheel-gear interior radius
    // flywheel spokes: 5 tapered arms from hub to rim
    const spokes = Array.from({ length: 5 }, (_, k) =>
      `<rect x="-4.5" y="${n(-cgRoot*0.85)}" width="9" height="${n(cgRoot*0.85 - 12)}" rx="3.5" fill="${I[1]}" stroke="${I[3]}" stroke-width="1" transform="rotate(${k*72})"/>`).join('');
    const rivet = (x, y) => `<circle cx="${n(x)}" cy="${n(y)}" r="2" fill="${B.hi}" opacity=".75"/>`;
    const wallRivets = [-236, -196, -156, -116, -76, -36].map(y => rivet(-HW + 7, y) + rivet(HW - 7, y)).join('');
    // one brass cylinder + flanges + gland + steam riser, at axis x
    const cyl = x => `
      <rect x="${n(x - CW/2 + 6)}" y="${n(CT - 8)}" width="${n(CW - 12)}" height="10" fill="#C87850" stroke="#70391D" stroke-width="1.5"/>
      <rect x="${n(x - CW/2)}" y="${n(CT)}" width="${CW}" height="${n(CB - CT)}" rx="4" fill="url(#${uid}b)" stroke="${B.lo}" stroke-width="2"/>
      <rect x="${n(x - CW/2 - 4)}" y="${n(CT)}" width="${n(CW + 8)}" height="7" rx="2" fill="${B.mid}" stroke="${B.lo}" stroke-width="1.5"/>
      <rect x="${n(x - CW/2 - 4)}" y="${n(CB - 7)}" width="${n(CW + 8)}" height="7" rx="2" fill="${B.mid}" stroke="${B.lo}" stroke-width="1.5"/>
      <rect x="${n(x - 7)}" y="${n(CB)}" width="14" height="8" rx="2" fill="${B.mid}" stroke="${B.lo}" stroke-width="1.2"/>`;
    // crosshead guides: two rails per side
    const guides = x => `
      <line x1="${n(x - 12)}" y1="-222" x2="${n(x - 12)}" y2="-140" stroke="${I[2]}" stroke-width="4"/>
      <line x1="${n(x + 12)}" y1="-222" x2="${n(x + 12)}" y2="-140" stroke="${I[2]}" stroke-width="4"/>`;
    const crosshead = (cls, x) => `<g class="${cls}">
      <rect x="${n(x - 10)}" y="-8" width="20" height="16" rx="3" fill="url(#${uid}s)" stroke="${I[3]}" stroke-width="1.5"/>
      <circle cx="${n(x)}" r="3.4" fill="${B.mid}" stroke="${B.lo}" stroke-width="1"/></g>`;
    // pressure gauge, dial rendered for real: 0–200 psi over a 270° sweep,
    // numbered majors every 50, minors every 25, red zone at the top end.
    // The needle (in steamState) reads the engine's ACTUAL speed — 100 psi
    // = 1× hub speed — so it climbs with the throttle and dies on a jam.
    const GX = -113, GY = -235;
    const ga = psi => (135 + psi/200*270) * Math.PI/180;
    const gp = (psi, r) => [GX + Math.cos(ga(psi))*r, GY + Math.sin(ga(psi))*r];
    const gticks = [];
    for (let p = 0; p <= 200; p += 25){
      const major = p % 50 === 0;
      const [x1, y1] = gp(p, major ? 17 : 18.8), [x2, y2] = gp(p, 21);
      gticks.push(`<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="#3A2D1C" stroke-width="${major ? 1.5 : 0.8}"/>`);
      if (major){
        const [lx, ly] = gp(p, 12.5);
        gticks.push(`<text x="${n(lx)}" y="${n(ly + 1.9)}" font-family="Georgia,serif" font-size="5.2" fill="#3A2D1C" text-anchor="middle">${p}</text>`);
      }
    }
    const [rz1x, rz1y] = gp(170, 20.6), [rz2x, rz2y] = gp(200, 20.6);
    const gauge = `
      <line x1="${GX}" y1="${n(GY + 29)}" x2="${GX}" y2="-190" stroke="#C87850" stroke-width="4"/>
      <circle cx="${GX}" cy="${GY}" r="30" fill="${B.mid}" stroke="${B.lo}" stroke-width="2.5"/>
      <circle cx="${GX}" cy="${GY}" r="26.5" fill="none" stroke="${B.hi}" stroke-width="1.5" opacity=".6"/>
      <circle cx="${GX}" cy="${GY}" r="23" fill="#F6EEDC" stroke="#8a7a5c" stroke-width="1"/>
      <path d="M ${n(rz1x)} ${n(rz1y)} A 20.6 20.6 0 0 1 ${n(rz2x)} ${n(rz2y)}" fill="none" stroke="#C0392B" stroke-width="2.6"/>
      ${gticks.join('')}
      <text x="${GX}" y="${n(GY + 9.5)}" font-family="Georgia,serif" font-size="4.8" fill="#8a7a5c" text-anchor="middle" letter-spacing="1">PSI</text>
      <g transform="translate(${GX} ${GY})"><g class="gre-needle" style="transform:rotate(135deg)">
        <rect x="-20" y="-20" width="40" height="40" fill="none"/>
        <line x1="-4.5" y1="0" x2="19" y2="0" stroke="#B03A2E" stroke-width="2" stroke-linecap="round"/>
      </g></g>
      <circle cx="${GX}" cy="${GY}" r="2.8" fill="${B.mid}" stroke="${B.lo}" stroke-width="0.8"/>`;
    // exhaust steam: three staggered puff-clouds per cylinder head, the two
    // sides offset half a beat like alternating strokes. Pure CSS animation,
    // gated by .gre-on (set from the solver) so a stopped engine goes cold.
    const puffs = [-1, 1].map((s, si) => [0, 0.7, 1.4].map(d => {
      const vx = s*(CHX + 16);
      return `<g class="gre-puff" style="animation-delay:${(d + si*0.35).toFixed(2)}s"><g filter="url(#${uid}z)">
        <circle cx="${n(vx)}" cy="-296" r="7" fill="#E8EDF2"/>
        <circle cx="${n(vx - 5)}" cy="-290" r="5" fill="#E8EDF2"/>
        <circle cx="${n(vx + 5)}" cy="-289" r="5.5" fill="#E8EDF2"/>
      </g></g>`;
    }).join('')).join('');
    return `<svg viewBox="${-R} ${-R} ${R*2} ${R*2}" style="display:block;width:100%;height:100%;overflow:visible">
      <defs>
        <linearGradient id="${uid}i" x1="0" y1="0" x2="0.25" y2="1">
          <stop offset="0" stop-color="${I[0]}"/><stop offset=".45" stop-color="${I[1]}"/><stop offset="1" stop-color="${I[2]}"/>
        </linearGradient>
        <linearGradient id="${uid}b" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="${B.lo}"/><stop offset=".3" stop-color="${B.hi}"/>
          <stop offset=".55" stop-color="${B.mid}"/><stop offset="1" stop-color="${B.lo}"/>
        </linearGradient>
        <linearGradient id="${uid}s" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#8C97A3"/><stop offset=".35" stop-color="#E8EDF2"/><stop offset="1" stop-color="#7E8994"/>
        </linearGradient>
        <filter id="${uid}z" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="2.2"/></filter>
      </defs>
      <g class="gre-back">
        <rect x="${n(-HW)}" y="${IT}" width="${n(HW*2)}" height="${n(BOT - IT)}" rx="12" fill="#12161C" stroke="#0B0F14" stroke-width="2"/>
        <polygon points="-24,-16 24,-16 15,-112 -15,-112" fill="#1B2129" stroke="#0E1216" stroke-width="1.5"/>
      </g>
      <g class="grc-rot">
        <path d="${gearPath(g.teeth)}" fill="url(#${uid}s)" stroke="#5F6873" stroke-width="2.5" stroke-linejoin="round"/>
        <circle r="${n(rr*0.32)}" fill="${I[2]}" stroke="${I[3]}" stroke-width="1.5"/>
        <circle r="${n(rr*0.12)}" fill="#0E1216"/>
      </g>
      <g class="gre-works">
        <g transform="translate(0 ${n(CY)})"><g class="gre-crank">
          <path d="${gearPath(CG)}" fill="url(#${uid}i)" stroke="${I[3]}" stroke-width="2" stroke-linejoin="round"/>
          <circle r="${n(cgRoot*0.9)}" fill="#12161C"/>
          <circle r="${n(cgRoot*0.9)}" fill="none" stroke="${I[1]}" stroke-width="5"/>
          ${spokes}
          <circle r="12" fill="url(#${uid}i)" stroke="${I[3]}" stroke-width="1.5"/>
          <circle r="27" fill="url(#${uid}i)" stroke="${I[3]}" stroke-width="1.5" opacity=".92"/>
          <circle cx="${RC}" cy="0" r="4.5" fill="${B.mid}" stroke="${B.lo}" stroke-width="1.2"/>
          <circle cx="0" cy="${RC}" r="4.5" fill="${B.mid}" stroke="${B.lo}" stroke-width="1.2"/>
        </g></g>
        <circle cy="${n(CY)}" r="8" fill="${I[3]}" stroke="#0E1216" stroke-width="1.5"/>
        ${guides(-CHX)}${guides(CHX)}
        <line class="gre-rodL" x1="${n(-CHX)}" y1="-180" x2="0" y2="${n(CY)}" stroke="url(#${uid}s)" stroke-width="7" stroke-linecap="round"/>
        <line class="gre-rodR" x1="${n(CHX)}" y1="-180" x2="0" y2="${n(CY)}" stroke="url(#${uid}s)" stroke-width="7" stroke-linecap="round"/>
        <line class="gre-prodL" x1="${n(-CHX)}" y1="-190" x2="${n(-CHX)}" y2="-220" stroke="#B7BFC9" stroke-width="5"/>
        <line class="gre-prodR" x1="${n(CHX)}" y1="-190" x2="${n(CHX)}" y2="-220" stroke="#B7BFC9" stroke-width="5"/>
        ${crosshead('gre-chL', -CHX)}${crosshead('gre-chR', CHX)}
      </g>
      <g class="grc-house">
        <rect x="${n(-HW)}" y="-24" width="${n(HW - 70)}" height="${n(24 + BOT)}" fill="url(#${uid}i)" stroke="${I[3]}" stroke-width="2"/>
        <rect x="70" y="-24" width="${n(HW - 70)}" height="${n(24 + BOT)}" fill="url(#${uid}i)" stroke="${I[3]}" stroke-width="2"/>
        <rect x="${n(-HW)}" y="${IT}" width="14" height="${n(BOT - IT)}" fill="url(#${uid}i)" stroke="${I[3]}" stroke-width="1.5"/>
        <rect x="${n(HW - 14)}" y="${IT}" width="14" height="${n(BOT - IT)}" fill="url(#${uid}i)" stroke="${I[3]}" stroke-width="1.5"/>
        <rect x="${n(-HW)}" y="${IT}" width="${n(HW - 70)}" height="14" fill="url(#${uid}i)" stroke="${I[3]}" stroke-width="1.5"/>
        <rect x="70" y="${IT}" width="${n(HW - 70)}" height="14" fill="url(#${uid}i)" stroke="${I[3]}" stroke-width="1.5"/>
        <rect x="-76" y="-248" width="14" height="228" fill="url(#${uid}i)" stroke="${I[3]}" stroke-width="1.5"/>
        <rect x="62" y="-248" width="14" height="228" fill="url(#${uid}i)" stroke="${I[3]}" stroke-width="1.5"/>
        <line x1="${n(-HW + 22)}" y1="-30" x2="-76" y2="-200" stroke="${I[1]}" stroke-width="10"/>
        <line x1="${n(HW - 22)}" y1="-30" x2="76" y2="-200" stroke="${I[1]}" stroke-width="10"/>
        ${[0.3, 0.55, 0.8].map(t => rivet((-HW + 22)*(1 - t) + -76*t, -30*(1 - t) + -200*t)
          + rivet((HW - 22)*(1 - t) + 76*t, -30*(1 - t) + -200*t)).join('')}
        <rect x="-72" y="${n(CB + 8)}" width="144" height="12" fill="url(#${uid}i)" stroke="${I[3]}" stroke-width="1.5"/>
        ${cyl(-CHX)}${cyl(CHX)}
        <rect x="${n(-CHX - 10)}" y="-300" width="${n(CHX*2 + 20)}" height="8" rx="4" fill="#C87850" stroke="#70391D" stroke-width="1.5"/>
        <path d="M -18 -298 A 18 18 0 0 1 18 -298 Z" fill="url(#${uid}b)" stroke="${B.lo}" stroke-width="2"/>
        <rect x="-3" y="-322" width="6" height="8" fill="${B.mid}" stroke="${B.lo}" stroke-width="1"/>
        <line x1="-8" y1="-322" x2="10" y2="-326" stroke="${B.lo}" stroke-width="2" stroke-linecap="round"/>
        <line x1="-113" y1="-166" x2="-113" y2="-34" stroke="#C87850" stroke-width="4"/>
        <rect x="-121" y="-192" width="16" height="26" rx="3" fill="${I[2]}" stroke="${I[3]}" stroke-width="1.5"/>
        ${gauge}
        <g class="gre-barglow">
        <path d="M 92.9 -246.5 A 36 36 0 0 1 131.1 -246.5" fill="none" stroke="${I[1]}" stroke-width="9" stroke-linecap="round"/>
        <path d="M 92.9 -246.5 A 36 36 0 0 1 131.1 -246.5" fill="none" stroke="${B.mid}" stroke-width="4"/>
        ${[-122, -90, -58].map(a => { const c = Math.cos(a*Math.PI/180), s = Math.sin(a*Math.PI/180);
          return `<line x1="${n(112 + 31*c)}" y1="${n(-216 + 31*s)}" x2="${n(112 + 41*c)}" y2="${n(-216 + 41*s)}" stroke="${I[3]}" stroke-width="2"/>`; }).join('')}
        </g>
        ${wallRivets}
      </g>
      <g class="gre-steam">${puffs}</g>
      ${this.steamState(g)}
      <circle class="gr-jamring" r="${n(rr*0.98)}" fill="none" stroke="#E24A3B" stroke-width="4" opacity="0"/>
    </svg>`;
  },
  // the engine's controls, swapped in place by refreshHub on every tap:
  // Johnson bar on its notched quadrant (big red grip — THE start/stop),
  // run/stop/reverse glyphs with the active one lit, throttle handwheel
  // (rotates with the setting), and the gauge needle showing throttle when
  // steam is on
  STEAM_THR: [0.6, 1, 1.8],                                    // slow / normal / fast
  steamState(g){
    const B = BRASS, I = IRON, n = x => (+x).toFixed(1);
    const thr = g.thr ?? 1;
    const lv = g.sw === 0 ? 0 : (g.sw === 1 ? -28 : 28);       // Johnson bar throw
    // direction buttons FLANKING the quadrant, clear of the lever's swing:
    // solid white arrows facing outward — left = forward, right = reverse —
    // and a stop square up top. The ACTIVE one turns green. Each is a direct
    // tap target (see onUp); the lever itself toggles stop ↔ resume.
    const glyph = (x, y, on, shape) => {
      const f = on ? '#52D452' : '#fff';
      return shape === 'sq'
        ? `<rect x="${n(x - 4)}" y="${n(y - 4)}" width="8" height="8" rx="1" fill="${f}"/>`
        : `<path d="M ${n(x - 4*shape)} ${n(y - 5.2)} L ${n(x + 5.2*shape)} ${n(y)} L ${n(x - 4*shape)} ${n(y + 5.2)} Z" fill="${f}"/>`;
    };
    return `<g class="gr-state">
      ${glyph(85, -242, g.sw === 1, -1)}${glyph(112, -276, g.sw === 0, 'sq')}${glyph(139, -242, g.sw === -1, 1)}
      <g transform="translate(112 -216) rotate(${lv})"><g class="gre-barpulse">
        <line x1="0" y1="0" x2="0" y2="-44" stroke="#2E3238" stroke-width="6" stroke-linecap="round"/>
        <circle cy="-20" r="3" fill="${B.mid}"/>
        <circle cy="-46" r="8" fill="#B03A2E" stroke="#7E271E" stroke-width="1.5"/>
        <circle cx="-2.5" cy="-48.5" r="2.6" fill="#E8837A" opacity=".8"/>
      </g></g>
      <circle cx="112" cy="-216" r="7" fill="${I[2]}" stroke="${I[3]}" stroke-width="1.5"/>
      <circle cx="112" cy="-216" r="2.8" fill="${B.mid}"/>
      <g transform="translate(-113 -179) rotate(${thr*30})">
        <circle r="13" fill="none" stroke="${B.mid}" stroke-width="3.5"/>
        <line x1="-13" y1="0" x2="13" y2="0" stroke="${B.mid}" stroke-width="3"/>
        <line x1="0" y1="-13" x2="0" y2="13" stroke="${B.mid}" stroke-width="3"/>
        <circle r="3.6" fill="${B.hi}" stroke="${B.lo}" stroke-width="1"/>
      </g>
    </g>`;
  },
  // drive the engine's linkage from the pinion angle: the crank gear is
  // phase-locked to the pinion (teeth interleave along the vertical mesh,
  // ratio -12/18), and each crosshead solves its slider-crank exactly:
  // y = pin_y - sqrt(L² - (x_cyl - pin_x)²)
  syncSteam(g){
    const { CG, CY, RC, L, CHX } = SE;
    const ca = Math.PI/2 - (Math.PI*(1 + MOTOR_TEETH/2) + MOTOR_TEETH*g.angle)/CG;
    g.crankEl.setAttribute('transform', `rotate(${(ca*180/Math.PI).toFixed(2)})`);
    const side = (ch, rod, prod, pinX, pinY, chx) => {
      const px = pinX*RC, py = CY + pinY*RC;
      const chY = py - Math.sqrt(L*L - (chx - px)*(chx - px));
      ch.setAttribute('transform', `translate(0 ${chY.toFixed(1)})`);
      rod.setAttribute('x1', chx); rod.setAttribute('y1', chY.toFixed(1));
      rod.setAttribute('x2', px.toFixed(1)); rod.setAttribute('y2', py.toFixed(1));
      prod.setAttribute('y1', (chY - 8).toFixed(1));
    };
    const c = Math.cos(ca), s = Math.sin(ca);
    side(g.chL, g.rodL, g.prodL, -s, c, -CHX);    // pin at (0,RC) in crank frame
    side(g.chR, g.rodR, g.prodR, c, s, CHX);      // pin at (RC,0) — 90° apart
  },
  ring(g){
    if (g.ringT) return;
    g.rings = (g.rings || 0) + 1;
    g.el.classList.add('grb-ring');
    Audio2.bell();
    g.ringT = setTimeout(() => { g.el.classList.remove('grb-ring'); g.ringT = 0; }, 1200);
  },
  // pop the bird + real recorded "cuckoo"
  cuckoo(g){
    if (g.popT) return;
    g.pops = (g.pops || 0) + 1;
    g.el.classList.add('grc-pop');
    Audio2.sfx('cuckoo.mp3');
    g.popT = setTimeout(() => { g.el.classList.remove('grc-pop'); g.popT = 0; }, 1350);
  },
  // motor hub, TOMY-style: yellow rim, blue face with lightning zigzags, a
  // chunky GREEN tri-switch in the middle (lever off / curl-arrow run+reverse).
  // In ✨ metal mode it is a steampunk engine hub instead: brass bezel with
  // rivets, dark gauge face with tick marks, amber lever/arrows. No defs in
  // here — refreshHub re-inserts this fragment on every switch tap.
  motorHub(g, rr){
    const n = x => (+x).toFixed(1);
    if (this.fancy){
      const ticks = Array.from({ length: 12 }, (_, k) => {
        const a = k * Math.PI/6, r0 = rr*0.38, r1 = rr*0.45;
        return `<line x1="${n(Math.cos(a)*r0)}" y1="${n(Math.sin(a)*r0)}" x2="${n(Math.cos(a)*r1)}" y2="${n(Math.sin(a)*r1)}" stroke="${BRASS.mid}" stroke-width="1.4" opacity=".8"/>`;
      }).join('');
      const studs = Array.from({ length: 6 }, (_, k) => {
        const a = k * Math.PI/3 + Math.PI/6, rx = rr*0.59;
        return `<circle cx="${n(Math.cos(a)*rx)}" cy="${n(Math.sin(a)*rx)}" r="1.8" fill="${BRASS.hi}" opacity=".9"/>`;
      }).join('');
      const arrow = dir => `<g class="gr-state" ${dir<0 ? 'transform="scale(-1,1)"' : ''}>
        <path d="M -7 -9 A 11.5 11.5 0 1 1 -10.5 3.5" fill="none" stroke="#2A1F10" stroke-width="7" stroke-linecap="round" opacity=".6"/>
        <path d="M -7 -9 A 11.5 11.5 0 1 1 -10.5 3.5" fill="none" stroke="#FFB53C" stroke-width="4" stroke-linecap="round"/>
        <path d="M -13 -13 L -2.5 -11 L -10 -2.5 Z" fill="#FFB53C" stroke="#2A1F10" stroke-width="1"/></g>`;
      const off = `<g class="gr-state">
        <rect x="-3.5" y="-12" width="7" height="21" rx="3.5" fill="${BRASS.mid}" stroke="${BRASS.lo}" stroke-width="1.4"/>
        <circle cy="-7" r="3.2" fill="${BRASS.hi}"/></g>`;
      return `<g class="gr-hub">
          <circle r="${n(rr*0.68)}" fill="${BRASS.mid}" stroke="${BRASS.lo}" stroke-width="2"/>
          <circle r="${n(rr*0.63)}" fill="none" stroke="${BRASS.hi}" stroke-width="1.4" opacity=".6"/>
          <circle r="${n(rr*0.5)}" fill="#262C33" stroke="#14181D" stroke-width="1.5"/>
          ${ticks}${studs}
        </g>
        ${g.sw === 0 ? off : arrow(g.sw)}`;
    }
    const bolt = rot => `<path transform="rotate(${rot})" d="M ${n(rr*0.16)} ${n(-rr*0.44)} L ${n(rr*0.34)} ${n(-rr*0.3)} L ${n(rr*0.24)} ${n(-rr*0.26)} L ${n(rr*0.42)} ${n(-rr*0.1)}" fill="none" stroke="#FFC02E" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`;
    const arrow = dir => `<g class="gr-state" ${dir<0 ? 'transform="scale(-1,1)"' : ''}>
      <path d="M -7 -9 A 11.5 11.5 0 1 1 -10.5 3.5" fill="none" stroke="#59C13D" stroke-width="4.5" stroke-linecap="round"/>
      <path d="M -13 -13 L -2.5 -11 L -10 -2.5 Z" fill="#59C13D"/></g>`;
    const off = `<g class="gr-state">
      <rect x="-4" y="-12" width="8" height="21" rx="4" fill="#59C13D" stroke="#3D8F28" stroke-width="1.6"/>
      <circle cy="-7" r="3.4" fill="#7FDB63"/></g>`;
    return `<g class="gr-hub">
        <circle r="${n(rr*0.68)}" fill="#FFC02E" stroke="#D3980F" stroke-width="2"/>
        <circle r="${n(rr*0.55)}" fill="#2F6FD1" stroke="#1F4E9C" stroke-width="1.5"/>
        ${bolt(15)}${bolt(135)}${bolt(255)}
      </g>
      ${g.sw === 0 ? off : arrow(g.sw)}`;
  },
  refreshHub(g){
    const svg = g.el.firstElementChild;
    svg.querySelector('.gr-state')?.remove();
    if (g.steam){   // the engine's state lives in its gauge needle + Johnson bar
      svg.insertAdjacentHTML('beforeend', this.steamState(g));
      return;
    }
    svg.querySelector('.gr-hub')?.remove();
    svg.insertAdjacentHTML('beforeend', this.motorHub(g, rootR(g.teeth)));
  },

  // ── debug overlay: the TRUE geometry driving the simulation ──
  // pitch circles (the real meshing surfaces), tooth-phase ticks, mesh links
  // with their ratio, outer/root circles, per-gear ω, jam markers
  drawDebug(){
    const cv = $('#gr-dbg-cv'); if (!cv) return;
    const ctx = cv.getContext('2d');
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.W, this.H);
    if (!this.debug || !this.active) return;
    ctx.lineWidth = 1; ctx.font = '10px ui-monospace,Menlo,monospace'; ctx.textAlign = 'center';
    // mesh links first
    for (const [i, j] of meshes(this.gears, this.drag ? this.drag.g : undefined)){
      const a = this.gears[i], b = this.gears[j];
      ctx.strokeStyle = '#41B6FF';
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      const mx = (a.x+b.x)/2, my = (a.y+b.y)/2;
      const label = `${a.teeth}:${b.teeth}  φ${(phaseError(a,b)).toFixed(2)}`;
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.fillStyle = '#BDE3FF'; ctx.lineJoin = 'round';
      ctx.strokeText(label, mx, my - 4); ctx.fillText(label, mx, my - 4); ctx.lineWidth = 1;
    }
    for (let i = 0; i < this.gears.length; i++){
      const g = this.gears[i], pr = pitchR(g.teeth);
      // pitch circle — THE physical meshing surface
      ctx.strokeStyle = this.sol.jam.has(i) ? '#FF3B30' : '#19E68C';
      ctx.beginPath(); ctx.arc(g.x, g.y, pr, 0, 7); ctx.stroke();
      // outer + root circles, faint
      ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.setLineDash([4,4]);
      ctx.beginPath(); ctx.arc(g.x, g.y, outerR(g.teeth), 0, 7); ctx.stroke();
      ctx.beginPath(); ctx.arc(g.x, g.y, rootR(g.teeth), 0, 7); ctx.stroke();
      ctx.setLineDash([]);
      // tooth-phase ticks on the pitch circle — interleave is visible truth
      ctx.strokeStyle = '#FFD23F';
      for (let k = 0; k < g.teeth; k++){
        const a = g.angle + k * 2*Math.PI/g.teeth;
        ctx.beginPath();
        ctx.moveTo(g.x + Math.cos(a)*(pr-4), g.y + Math.sin(a)*(pr-4));
        ctx.lineTo(g.x + Math.cos(a)*(pr+4), g.y + Math.sin(a)*(pr+4));
        ctx.stroke();
      }
      // centre + ω
      ctx.fillStyle = '#FF4FD8';
      ctx.beginPath(); ctx.arc(g.x, g.y, 2.2, 0, 7); ctx.fill();
      const w = this.sol.w[i] || 0;
      const lbl = `${g.teeth}t ${w ? (w>0?'+':'') + w.toFixed(2) + 'r/s' : (this.sol.jam.has(i) ? 'JAM' : '·')}`;
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.fillStyle = '#fff'; ctx.lineJoin = 'round';
      ctx.strokeText(lbl, g.x, g.y - pitchR(g.teeth) - 8); ctx.fillText(lbl, g.x, g.y - pitchR(g.teeth) - 8);
      ctx.lineWidth = 1;
    }
  },
  solveNow(){
    this.sol = solve(this.gears, this.drag ? this.drag.g : undefined);
    for (let i = 0; i < this.gears.length; i++){
      const g = this.gears[i];
      const ring = g.el?.querySelector('.gr-jamring');
      if (ring) ring.setAttribute('opacity', this.sol.jam.has(i) ? '0.9' : '0');
      // steam engines breathe only while actually turning (jam/off = cold),
      // and puff at a pace matching the throttle
      if (g.steam && g.el){
        g.el.classList.toggle('gre-on', !!this.sol.w[i]);
        g.el.classList.toggle('gre-slow', (g.throttle || 1) < 0.9);
        g.el.classList.toggle('gre-fast', (g.throttle || 1) > 1.2);
        // the gauge needle tracks the ACTUAL solved speed (0 when jammed) —
        // but freezes while the engine itself is pressed/carried, so a tap
        // can't jiggle the reading (the press excludes it from the train)
        if (!(this.drag && this.drag.g === g)){
          g.psiW = Math.abs(this.sol.w[i] || 0);
          this.gaugeSync(g);
        }
      }
    }
    this.opsCue();
  },

  syncOne(g){
    const R = outerR(g.teeth);
    if (g.clock || g.bell || g.steam){
      // the housing stays upright; the input gear (and the geared innards) spin
      g.el.style.transform = `translate(${(g.x - R).toFixed(1)}px, ${(g.y - R).toFixed(1)}px)`;
      const deg = g.angle * 180 / Math.PI;
      g.rotEl.setAttribute('transform', `rotate(${deg.toFixed(2)})`);
      if (g.steam) this.syncSteam(g);
      if (g.mHand){
        const fx = 0, fy = R*this.FACE_Y;
        g.mHand.setAttribute('transform', `rotate(${(-deg).toFixed(2)} ${fx} ${fy.toFixed(1)})`);
        g.hHand.setAttribute('transform', `rotate(${(-deg/12).toFixed(2)} ${fx} ${fy.toFixed(1)})`);
      }
    } else {
      g.el.style.transform = `translate(${(g.x - R).toFixed(1)}px, ${(g.y - R).toFixed(1)}px) rotate(${g.angle}rad)`;
      // metal mode: counter-rotate the sheen group (clipped to the gear
      // silhouette) so the light stays fixed in the room while the metal
      // turns beneath it — THE cue that reads as shine
      if (g.shadeEl) g.shadeEl.setAttribute('transform', `rotate(${(-g.angle*180/Math.PI).toFixed(2)})`);
    }
  },
  loop(){
    if (this.raf) return;
    let last = performance.now();
    const frame = t => {
      if (!this.active){ this.raf = 0; return; }
      const dt = Math.min(t - last, 40) / 1000; last = t;
      const { w } = this.sol;
      for (let i = 0; i < this.gears.length; i++){
        const g = this.gears[i];
        if (w[i]){
          g.angle += w[i] * dt; this.syncOne(g);
          if (g.clock || g.bell){
            g.acc = (g.acc || 0) + Math.abs(w[i]) * dt;
            if (g.acc >= 2*Math.PI){ g.acc %= 2*Math.PI; g.clock ? this.cuckoo(g) : this.ring(g); }
          }
        }
      }
      if (this.debug) this.drawDebug();
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  },

  hit(px, py){
    for (let i = this.gears.length - 1; i >= 0; i--){
      const g = this.gears[i], R = outerR(g.teeth);
      if (Math.hypot(px - g.x, py - g.y) <= R) return g;
      const hd = this.houseDims(g);
      if (hd && Math.abs(px - g.x) <= hd.hw && py >= g.y - hd.hh && py <= g.y) return g;
    }
    return null;
  },
  onDown(e){
    if (!this.active || (e.target.closest && e.target.closest('.fb-ops'))) return;
    const r = this.area().getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    const g = this.hit(px, py);
    if (!g) return;
    this.drag = { g, ox: px - g.x, oy: py - g.y, sx: px, sy: py, t0: performance.now(), moved: false, homeX: g.x, homeY: g.y, homeA: g.angle };
    g.el.style.zIndex = 9;
    this.solveNow();                       // dragged gear leaves the train
    Audio2.unlock();
  },
  onMove(e){
    if (!this.drag) return;
    const r = this.area().getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    const d = this.drag, g = d.g;
    if (Math.hypot(px - d.sx, py - d.sy) > 9) d.moved = true;
    if (!d.moved) return;
    const R = outerR(g.teeth);
    g.x = Math.max(R*0.4, Math.min(this.W - R*0.4, px - d.ox));
    g.y = Math.max(R*0.4, Math.min(this.H - R*0.4, py - d.oy));
    // light magnetic pull: lean 25% toward the snapped pose while in range
    const ghost = { ...g };
    const arr = this.gears.map(o => o === g ? ghost : o);
    if (snap(arr, arr.indexOf(ghost))){
      g.x += (ghost.x - g.x) * 0.25;
      g.y += (ghost.y - g.y) * 0.25;
    }
    this.syncOne(g);
  },
  onUp(e){
    if (!this.drag) return;
    const d = this.drag, g = d.g;
    this.drag = null;
    g.el.style.zIndex = '';
    const quickTap = !d.moved && (performance.now() - d.t0) < 400;
    if (quickTap && g.motor){
      // the steam engine's controls are its actual controls: the throttle
      // handwheel cycles speed; on the Johnson bar the arrow/stop buttons
      // choose forward / reverse / stop DIRECTLY, and a tap on the lever or
      // quadrant toggles stop ↔ the last direction. Taps elsewhere on the
      // case do nothing (drag still works).
      const lx = d.sx - g.x, ly = d.sy - g.y;
      const near = (x, y, r) => Math.hypot(lx - x, ly - y) < r;
      const onWheel = g.steam && near(-113, -179, 30);
      const onBar = g.steam && near(112, -230, 48);
      if (onWheel){
        g.thr = ((g.thr ?? 1) + 1) % this.STEAM_THR.length;
        g.throttle = this.STEAM_THR[g.thr];
      } else if (!g.steam){
        g.sw = g.sw === 0 ? 1 : (g.sw === 1 ? -1 : 0);   // motor hub: off → run → reverse → off
      } else if (onBar){
        if (near(85, -242, 13)) g.sw = 1;                // ◀ forward
        else if (near(139, -242, 13)) g.sw = -1;         // ▶ reverse
        else if (near(112, -276, 13)) g.sw = 0;          // ■ stop
        else if (g.sw === 0) g.sw = g.lastDir || 1;      // lever: resume last direction
        else g.sw = 0;                                   // lever: stop
        if (g.sw) g.lastDir = g.sw;
      }
      if (onWheel || !g.steam || onBar){
        this.refreshHub(g); Audio2.snapSnd();
        this.barNudge?.reset();                          // they found the controls
      } else if (g.steam){
        // taps landing nowhere on the engine = unrecognized intent: after a
        // few, rock the Johnson bar to say "this is the handle you want"
        (this.barNudge ??= attentionNudge()).note(g.el, 'gre-nudge');
      }
    } else if (d.moved){
      const didSnap = snap(this.gears, this.gears.indexOf(g));
      // buried teeth are not a thing on the real toy: legalize (push out to
      // exact mesh) or, if the spot truly can't take the piece, bounce it
      // back where it came from
      if (!resolvePlacement(this.gears, this.gears.indexOf(g))){
        g.x = d.homeX; g.y = d.homeY; g.angle = d.homeA;
        Audio2.wrong();
      } else if (didSnap) Audio2.snapSnd();
      this.syncOne(g);
    }
    const jammedBefore = this.sol.jam.size;
    this.solveNow();
    if (this.sol.jam.size > jammedBefore) Audio2.wrong();
  },
};

export { GearGame };

// Gear Wall — the magnetic gear-board toy: place toy-plastic gears anywhere,
// they stick (magnets — no gravity, no falling), and motor gears drive every
// connected gear at physically exact ratios via the gearworks solver.
// Interaction mirrors the toy: tap a palette icon to pop a gear onto the
// board, drag it anywhere, feel a light magnetic pull as it nears a mesh,
// release to snap tooth-perfect. Tap a motor's hub to cycle its tri-switch:
// off → run → reverse. Contradictory trains (odd loops, fighting motors)
// JAM — everything in that train stops and shows a red hub ring.
import { Audio2 } from '../audio.js';
import { $, mulberry32 } from '../core.js';
import { showView } from '../router.js';
import {
  MODULE, TEETH, MOTOR_TEETH, MOTOR_W, pitchR, outerR, rootR,
  meshes, solve, snap, phaseAlign, gearPath, SNAP_DIST, MESH_TOL,
  illegalOverlaps, resolvePlacement, phaseError,
} from './gearworks.js';

const COLORS = [
  ['#E24A3B', '#B93327'], ['#3D8BFF', '#2A63C4'], ['#4FBF5E', '#379445'],
  ['#FFC02E', '#D3980F'], ['#F07E26', '#C55E12'], ['#7A5FD0', '#5B41AC'],
];

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
  },

  renderOps(){
    const ops = $('#gr-ops');
    // one icon per gear size in its toy colour (size ↔ colour, so the icon
    // predicts the piece); the MOTOR is distinguished by material instead —
    // gunmetal body, dark hub, yellow bolt
    const icon = (teeth, motor, i) => {
      const R = outerR(teeth), s = 46;
      const [body, dark] = motor ? ['#6B7684', '#4A545F'] : COLORS[i % COLORS.length];
      return `<svg viewBox="${-R} ${-R} ${R*2} ${R*2}" width="${s}" height="${s}" style="display:block">
        <path d="${gearPath(teeth)}" fill="${body}" stroke="${dark}" stroke-width="2"/>
        ${motor
          ? `<circle r="${rootR(teeth)*.55}" fill="#374B5C"/><path d="M 2 ${-rootR(teeth)*.34} L -5 2 L 0 2 L -2 ${rootR(teeth)*.34} L 5 -2 L 0 -2 Z" fill="#FFC02E"/>`
          : `<circle r="${rootR(teeth)*.42}" fill="#fff" opacity=".7"/><circle r="${rootR(teeth)*.16}" fill="${dark}"/>`}
      </svg>`;
    };
    ops.innerHTML = TEETH.map((t, i) =>
      `<button class="fb-btn gr-pick" data-teeth="${i}" aria-label="Add a ${t}-tooth gear">${icon(t, false, i)}</button>`).join('')
      + `<button class="fb-btn gr-pick gr-pick-motor" data-motor="1" aria-label="Add a motor gear">${icon(MOTOR_TEETH, true, 0)}</button>`
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
        this.spawn((btn.dataset.motor || btn.dataset.clock || btn.dataset.bell) ? -1 : +btn.dataset.teeth,
          !!btn.dataset.motor, !!btn.dataset.clock, !!btn.dataset.bell);
      });
    });
  },

  spawn(teethIdx, motor, clock, bell){
    const teeth = (motor || clock || bell) ? MOTOR_TEETH : TEETH[teethIdx];
    const g = {
      id: ++this.seq, teeth, motor, clock, bell, sw: 0,
      x: this.W/2, y: Math.min(this.H*0.3, outerR(teeth) + this.H*0.14),
      angle: 0, color: COLORS[(motor || clock || bell) ? 0 : teethIdx % COLORS.length],
    };
    if (clock || bell) g.y = Math.max(g.y, outerR(teeth)*3.9);   // room for the housing above
    // nudge sideways until the spawn spot doesn't bury an existing gear
    for (let k = 0; k < 18; k++){
      const clash = this.gears.some(o => Math.hypot(o.x-g.x, o.y-g.y) < (outerR(o.teeth)+outerR(g.teeth)) + 4);
      if (!clash) break;
      g.x = this.W/2 + ((k%2 ? 1 : -1) * Math.ceil((k+1)/2)) * outerR(g.teeth) * 1.15;
    }
    const el = document.createElement('div');
    el.className = 'gr-gear';
    const R = outerR(teeth);
    el.style.width = el.style.height = (R*2) + 'px';
    el.innerHTML = this.gearSVG(g);
    this.area().appendChild(el);
    g.el = el;
    if (clock || bell){
      g.rotEl = el.querySelector('.grc-rot');
      g.mHand = el.querySelector('.grc-mh');
      g.hHand = el.querySelector('.grc-hh');
    }
    this.gears.push(g);
    snap(this.gears, this.gears.length - 1);
    this.solveNow();
    this.syncOne(g);
    Audio2.pop();
    return g;
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
    if (g.clock) return this.clockSVG(g);
    if (g.bell) return this.bellSVG(g);
    const R = outerR(g.teeth), rr = rootR(g.teeth);
    const [body, dark] = g.motor ? ['#6B7684', '#4A545F'] : g.color;   // motor = gunmetal, like its icon
    // pinwheel swirl cut-outs like the toy: curved wedges around the hub
    const swirls = [];
    const nS = 5, ri = rr * 0.32, ro2 = rr * 0.8;
    for (let k = 0; k < nS; k++){
      const a0 = k * 2*Math.PI/nS, a1 = a0 + 0.55, a2 = a0 + 1.35;
      swirls.push(`M ${(ri*Math.cos(a0)).toFixed(1)} ${(ri*Math.sin(a0)).toFixed(1)}
        Q ${(ro2*.72*Math.cos(a1)).toFixed(1)} ${(ro2*.72*Math.sin(a1)).toFixed(1)} ${(ro2*Math.cos(a2)).toFixed(1)} ${(ro2*Math.sin(a2)).toFixed(1)}
        Q ${(ro2*.8*Math.cos(a1+.45)).toFixed(1)} ${(ro2*.8*Math.sin(a1+.45)).toFixed(1)} ${(ri*Math.cos(a0+.7)).toFixed(1)} ${(ri*Math.sin(a0+.7)).toFixed(1)} Z`);
    }
    const hub = g.motor ? this.motorHub(g, rr) :
      `<circle r="${(rr*0.3).toFixed(1)}" fill="#fff" opacity=".85"/>
       <circle r="${(rr*0.12).toFixed(1)}" fill="${dark}"/>`;
    return `<svg viewBox="${-R} ${-R} ${R*2} ${R*2}" style="display:block;width:100%;height:100%;overflow:visible">
      <path d="${gearPath(g.teeth)}" fill="${body}" stroke="${dark}" stroke-width="2.5" stroke-linejoin="round"/>
      <circle r="${(rr*0.92).toFixed(1)}" fill="#fff" opacity=".13"/>
      <g fill="${dark}" opacity=".85">${swirls.map(d => `<path d="${d}"/>`).join('')}</g>
      <circle class="gr-jamring" r="${(rr*0.98).toFixed(1)}" fill="none" stroke="#E24A3B" stroke-width="4" opacity="0"/>
      ${hub}
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
  // motor hub: dark disc + tri-switch state (⏻ off / ↻ run / ↺ reverse)
  motorHub(g, rr){
    const hr = (rr*0.52).toFixed(1);
    const arrow = dir => `<g class="gr-state" ${dir<0 ? 'transform="scale(-1,1)"' : ''}>
      <path d="M -8 -10 A 13 13 0 1 1 -12 4" fill="none" stroke="#FFE9AC" stroke-width="4" stroke-linecap="round"/>
      <path d="M -14 -14 L -3 -12 L -11 -3 Z" fill="#FFE9AC"/></g>`;
    const off = `<g class="gr-state"><circle r="7" fill="none" stroke="#8FA4B4" stroke-width="3.5"/>
      <rect x="-1.7" y="-11" width="3.4" height="9" rx="1.7" fill="#8FA4B4"/></g>`;
    return `<circle class="gr-hub" r="${hr}" fill="#374B5C" stroke="#22303C" stroke-width="2"/>
      ${g.sw === 0 ? off : arrow(g.sw)}`;
  },
  refreshHub(g){
    const svg = g.el.firstElementChild;
    svg.querySelector('.gr-state')?.remove();
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
      const ring = this.gears[i].el?.querySelector('.gr-jamring');
      if (ring) ring.setAttribute('opacity', this.sol.jam.has(i) ? '0.9' : '0');
    }
  },

  syncOne(g){
    const R = outerR(g.teeth);
    if (g.clock || g.bell){
      // the housing stays upright; the input gear (and geared hands) spin
      g.el.style.transform = `translate(${(g.x - R).toFixed(1)}px, ${(g.y - R).toFixed(1)}px)`;
      const deg = g.angle * 180 / Math.PI;
      g.rotEl.setAttribute('transform', `rotate(${deg.toFixed(2)})`);
      if (g.mHand){
        const fx = 0, fy = R*this.FACE_Y;
        g.mHand.setAttribute('transform', `rotate(${(-deg).toFixed(2)} ${fx} ${fy.toFixed(1)})`);
        g.hHand.setAttribute('transform', `rotate(${(-deg/12).toFixed(2)} ${fx} ${fy.toFixed(1)})`);
      }
    } else {
      g.el.style.transform = `translate(${(g.x - R).toFixed(1)}px, ${(g.y - R).toFixed(1)}px) rotate(${g.angle}rad)`;
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
      if ((g.clock || g.bell) && Math.abs(px - g.x) <= R*1.2 && py >= g.y - R*4 && py <= g.y) return g;
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
      g.sw = g.sw === 0 ? 1 : (g.sw === 1 ? -1 : 0);   // off → run → reverse → off
      this.refreshHub(g);
      Audio2.snapSnd();
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

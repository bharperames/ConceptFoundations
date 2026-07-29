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
  meshes, solve, snap, phaseAlign, gearPath, SNAP_DIST,
} from './gearworks.js';

const COLORS = [
  ['#E24A3B', '#B93327'], ['#3D8BFF', '#2A63C4'], ['#4FBF5E', '#379445'],
  ['#FFC02E', '#D3980F'], ['#F07E26', '#C55E12'], ['#7A5FD0', '#5B41AC'],
];

const GearGame = {
  gears: [], raf: 0, active: false, bound: false, drag: null,
  W: 0, H: 0, seq: 0, colorIdx: 0, sol: { w: [], jam: new Set() },
  area(){ return $('#gears-area'); },

  start(){
    Audio2.unlock(); showView('gears');
    const r = this.area().getBoundingClientRect();
    this.W = r.width; this.H = r.height;
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
    // one icon per gear size (smallest → biggest), then the motor
    const icon = (teeth, motor) => {
      const R = outerR(teeth), s = 46;
      return `<svg viewBox="${-R} ${-R} ${R*2} ${R*2}" width="${s}" height="${s}" style="display:block">
        <path d="${gearPath(teeth)}" fill="${motor ? '#FFC02E' : '#9DB4C4'}" stroke="${motor ? '#D3980F' : '#7C93A3'}" stroke-width="2"/>
        ${motor
          ? `<circle r="${rootR(teeth)*.55}" fill="#374B5C"/><path d="M 2 ${-rootR(teeth)*.34} L -5 2 L 0 2 L -2 ${rootR(teeth)*.34} L 5 -2 L 0 -2 Z" fill="#FFC02E"/>`
          : `<circle r="${rootR(teeth)*.42}" fill="#fff" opacity=".55"/>`}
      </svg>`;
    };
    ops.innerHTML = TEETH.map((t, i) =>
      `<button class="fb-btn gr-pick" data-teeth="${i}" aria-label="Add a ${t}-tooth gear">${icon(t, false)}</button>`).join('')
      + `<button class="fb-btn gr-pick gr-pick-motor" data-motor="1" aria-label="Add a motor gear">${icon(MOTOR_TEETH, true)}</button>`;
    ops.querySelectorAll('.gr-pick').forEach(btn => {
      btn.addEventListener('pointerdown', e => {
        e.preventDefault();
        this.spawn(btn.dataset.motor ? -1 : +btn.dataset.teeth, !!btn.dataset.motor);
      });
    });
  },

  spawn(teethIdx, motor){
    const teeth = motor ? MOTOR_TEETH : TEETH[teethIdx];
    const g = {
      id: ++this.seq, teeth, motor, sw: 0,
      x: this.W/2, y: Math.min(this.H*0.3, outerR(teeth) + this.H*0.14),
      angle: 0, color: COLORS[this.colorIdx++ % COLORS.length],
    };
    // nudge sideways until the spawn spot doesn't bury an existing gear
    for (let k = 0; k < 14; k++){
      const clash = this.gears.some(o => Math.hypot(o.x-g.x, o.y-g.y) < (outerR(o.teeth)+outerR(g.teeth))*0.8);
      if (!clash) break;
      g.x = this.W/2 + ((k%2 ? 1 : -1) * Math.ceil((k+1)/2)) * outerR(g.teeth) * 1.1;
    }
    const el = document.createElement('div');
    el.className = 'gr-gear';
    const R = outerR(teeth);
    el.style.width = el.style.height = (R*2) + 'px';
    el.innerHTML = this.gearSVG(g);
    this.area().appendChild(el);
    g.el = el;
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
    const R = outerR(g.teeth), rr = rootR(g.teeth);
    const [body, dark] = g.motor ? ['#FFC02E', '#D3980F'] : g.color;
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

  solveNow(){
    this.sol = solve(this.gears, this.drag ? this.drag.g : undefined);
    for (let i = 0; i < this.gears.length; i++){
      const ring = this.gears[i].el?.querySelector('.gr-jamring');
      if (ring) ring.setAttribute('opacity', this.sol.jam.has(i) ? '0.9' : '0');
    }
  },

  syncOne(g){
    g.el.style.transform = `translate(${(g.x - outerR(g.teeth)).toFixed(1)}px, ${(g.y - outerR(g.teeth)).toFixed(1)}px) rotate(${g.angle}rad)`;
  },
  loop(){
    if (this.raf) return;
    let last = performance.now();
    const frame = t => {
      if (!this.active){ this.raf = 0; return; }
      const dt = Math.min(t - last, 40) / 1000; last = t;
      const { w } = this.sol;
      for (let i = 0; i < this.gears.length; i++){
        if (w[i]){ this.gears[i].angle += w[i] * dt; this.syncOne(this.gears[i]); }
      }
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  },

  hit(px, py){
    for (let i = this.gears.length - 1; i >= 0; i--){
      const g = this.gears[i];
      if (Math.hypot(px - g.x, py - g.y) <= outerR(g.teeth)) return g;
    }
    return null;
  },
  onDown(e){
    if (!this.active || (e.target.closest && e.target.closest('.fb-ops'))) return;
    const r = this.area().getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    const g = this.hit(px, py);
    if (!g) return;
    this.drag = { g, ox: px - g.x, oy: py - g.y, sx: px, sy: py, t0: performance.now(), moved: false };
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
      // never leave two gears buried in each other: push out of the deepest
      for (const o of this.gears){
        if (o === g) continue;
        const min = (rootR(o.teeth) + rootR(g.teeth)) * 0.9;
        const dist = Math.hypot(g.x - o.x, g.y - o.y);
        if (dist < min){
          const th = Math.atan2(g.y - o.y, g.x - o.x) || 0.7;
          g.x = o.x + Math.cos(th) * (pitchR(o.teeth) + pitchR(g.teeth));
          g.y = o.y + Math.sin(th) * (pitchR(o.teeth) + pitchR(g.teeth));
          phaseAlign(o, g);
          break;
        }
      }
      if (didSnap) Audio2.snapSnd();
      this.syncOne(g);
    }
    const jammedBefore = this.sol.jam.size;
    this.solveNow();
    if (this.sol.jam.size > jammedBefore) Audio2.wrong();
  },
};

export { GearGame };

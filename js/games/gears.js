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
      + `<button class="fb-btn gr-pick gr-pick-motor" data-motor="1" aria-label="Add a motor gear">${icon(MOTOR_TEETH, true)}</button>`
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
        this.spawn(btn.dataset.motor || btn.dataset.clock ? -1 : +btn.dataset.teeth,
          !!btn.dataset.motor, !!btn.dataset.clock);
      });
    });
  },

  spawn(teethIdx, motor, clock){
    const teeth = (motor || clock) ? MOTOR_TEETH : TEETH[teethIdx];
    const g = {
      id: ++this.seq, teeth, motor, clock, sw: 0,
      x: this.W/2, y: Math.min(this.H*0.3, outerR(teeth) + this.H*0.14),
      angle: 0, color: COLORS[this.colorIdx++ % COLORS.length],
    };
    if (clock) g.y = Math.max(g.y, outerR(teeth)*3.4);   // room for the chalet above
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
    if (clock){
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
  // the cuckoo clock: a chalet whose bottom gear is the input — drive it a
  // full revolution and the bird pops out with a real "cuckoo". The housing
  // never rotates; only the .grc-rot gear (and the geared clock hands) spin.
  clockSVG(g){
    const R = outerR(g.teeth), rr = rootR(g.teeth), n = x => (+x).toFixed(1);
    const W = R*2.3, bodyTop = -R*2.6, bodyBot = -R*0.55, peak = -R*3.35;
    const fx = 0, fy = -R*1.35, fr = R*0.62;             // clock face
    const dx = 0, dy = -R*2.15, dw = R*0.62, dh = R*0.56; // door
    const tooth = `<path d="${gearPath(g.teeth)}" fill="#F0B429" stroke="#B9821A" stroke-width="2.5" stroke-linejoin="round"/>`;
    return `<svg viewBox="${-R} ${-R} ${R*2} ${R*2}" style="display:block;width:100%;height:100%;overflow:visible">
      <g class="grc-house">
        <rect x="${n(-W/2)}" y="${n(bodyTop)}" width="${n(W)}" height="${n(bodyBot-bodyTop)}" rx="${n(R*0.12)}" fill="#A9713A" stroke="#7a4e12" stroke-width="2.5"/>
        <path d="M ${n(-W/2 - R*0.16)} ${n(bodyTop + R*0.06)} L 0 ${n(peak)} L ${n(W/2 + R*0.16)} ${n(bodyTop + R*0.06)} Z" fill="#8B5A2B" stroke="#6b431a" stroke-width="2.5" stroke-linejoin="round"/>
        <g class="grc-bird" transform="translate(${n(dx)} ${n(dy + dh*0.28)})">
          <ellipse cx="0" cy="1" rx="${n(dw*0.42)}" ry="${n(dh*0.34)}" fill="#E07B39"/>
          <circle cx="0" cy="${n(-dh*0.3)}" r="${n(dw*0.28)}" fill="#E8934F"/>
          <path d="M ${n(dw*0.22)} ${n(-dh*0.36)} L ${n(dw*0.62)} ${n(-dh*0.44)} L ${n(dw*0.24)} ${n(-dh*0.18)} Z" fill="#F0B429"/>
          <circle cx="${n(-dw*0.1)}" cy="${n(-dh*0.34)}" r="2" fill="#2a2a2a"/>
        </g>
        <rect class="grc-doorL" x="${n(dx-dw/2)}" y="${n(dy-dh/2)}" width="${n(dw/2)}" height="${n(dh)}" rx="2" fill="#5c3b1c"/>
        <rect class="grc-doorR" x="${n(dx)}" y="${n(dy-dh/2)}" width="${n(dw/2)}" height="${n(dh)}" rx="2" fill="#503216"/>
        <circle cx="${n(fx)}" cy="${n(fy)}" r="${n(fr)}" fill="#F4E4C1" stroke="#5c3b1c" stroke-width="3"/>
        ${[0,1,2,3].map(k => `<circle cx="${n(fx + Math.sin(k*Math.PI/2)*fr*0.8)}" cy="${n(fy - Math.cos(k*Math.PI/2)*fr*0.8)}" r="1.8" fill="#5c3b1c"/>`).join('')}
        <line class="grc-mh" x1="${n(fx)}" y1="${n(fy)}" x2="${n(fx)}" y2="${n(fy - fr*0.72)}" stroke="#5c3b1c" stroke-width="3" stroke-linecap="round"/>
        <line class="grc-hh" x1="${n(fx)}" y1="${n(fy)}" x2="${n(fx)}" y2="${n(fy - fr*0.45)}" stroke="#5c3b1c" stroke-width="3.6" stroke-linecap="round"/>
        <rect x="${n(-R*0.14)}" y="${n(bodyBot - 2)}" width="${n(R*0.28)}" height="${n(R*0.5)}" fill="#7a4e12"/>
      </g>
      <g class="grc-rot">${tooth}
        <circle r="${n(rr*0.42)}" fill="#fff" opacity=".5"/>
        <circle r="${n(rr*0.14)}" fill="#7a4e12"/>
      </g>
      <circle class="gr-jamring" r="${n(rr*0.98)}" fill="none" stroke="#E24A3B" stroke-width="4" opacity="0"/>
    </svg>`;
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

  solveNow(){
    this.sol = solve(this.gears, this.drag ? this.drag.g : undefined);
    for (let i = 0; i < this.gears.length; i++){
      const ring = this.gears[i].el?.querySelector('.gr-jamring');
      if (ring) ring.setAttribute('opacity', this.sol.jam.has(i) ? '0.9' : '0');
    }
  },

  syncOne(g){
    const R = outerR(g.teeth);
    if (g.clock){
      // the chalet stays upright; the input gear and the geared hands spin
      g.el.style.transform = `translate(${(g.x - R).toFixed(1)}px, ${(g.y - R).toFixed(1)}px)`;
      const deg = g.angle * 180 / Math.PI;
      g.rotEl.setAttribute('transform', `rotate(${deg.toFixed(2)})`);
      const fx = 0, fy = -R*1.35;
      g.mHand.setAttribute('transform', `rotate(${(-deg).toFixed(2)} ${fx} ${fy.toFixed(1)})`);
      g.hHand.setAttribute('transform', `rotate(${(-deg/12).toFixed(2)} ${fx} ${fy.toFixed(1)})`);
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
          if (g.clock){
            g.acc = (g.acc || 0) + Math.abs(w[i]) * dt;
            if (g.acc >= 2*Math.PI){ g.acc %= 2*Math.PI; this.cuckoo(g); }
          }
        }
      }
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  },

  hit(px, py){
    for (let i = this.gears.length - 1; i >= 0; i--){
      const g = this.gears[i], R = outerR(g.teeth);
      if (Math.hypot(px - g.x, py - g.y) <= R) return g;
      if (g.clock && Math.abs(px - g.x) <= R*1.2 && py >= g.y - R*3.4 && py <= g.y) return g;
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

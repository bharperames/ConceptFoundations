import { Audio2 } from '../audio.js';
import { $ } from '../core.js';
import { Celebrate } from '../fx.js';
import { showView } from '../router.js';

const PUZZLE_SCENES = [
  // sunny hills
  `<svg viewBox="0 0 300 300"><rect width="300" height="300" fill="#9BD6F7"/>
    <circle cx="66" cy="66" r="40" fill="#FFC02E"/>
    <path d="M0 205 Q80 158 155 198 T300 188 V300 H0Z" fill="#63C471"/>
    <path d="M0 250 Q100 210 205 246 T300 240 V300 H0Z" fill="#3FA457"/></svg>`,
  // smiley face
  `<svg viewBox="0 0 300 300"><rect width="300" height="300" fill="#C4A2F0"/>
    <circle cx="150" cy="150" r="112" fill="#FFD84D"/>
    <circle cx="114" cy="128" r="17" fill="#3A2E2E"/><circle cx="186" cy="128" r="17" fill="#3A2E2E"/>
    <path d="M98 182 Q150 232 202 182" fill="none" stroke="#3A2E2E" stroke-width="13" stroke-linecap="round"/></svg>`,
  // little house
  `<svg viewBox="0 0 300 300"><rect width="300" height="300" fill="#BEE7FF"/>
    <circle cx="244" cy="58" r="26" fill="#FFC02E"/>
    <rect x="62" y="150" width="176" height="120" fill="#FFC02E"/>
    <path d="M44 156 L150 68 L256 156Z" fill="#FF5D55"/>
    <rect x="130" y="202" width="40" height="68" fill="#3D8BFF"/>
    <rect x="86" y="176" width="34" height="34" rx="3" fill="#9BD6F7"/><rect x="180" y="176" width="34" height="34" rx="3" fill="#9BD6F7"/></svg>`,
];
const PuzzleGame = {
  tiles: [], won: false, done: null, target: -1,
  start(){
    Audio2.unlock();
    showView('puzzle');
    $('#puz-win').classList.add('hidden');
    $('#puzzle-grid').classList.remove('solved');
    this.won = false;
    this.done = new Set();          // scene indices the child has built
    $('#puz-gallery').classList.remove('above-win');
    this.buildGallery();
    const grid = $('#puzzle-grid'); grid.innerHTML = ''; this.tiles = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++){
      const tile = document.createElement('div'); tile.className = 'puz-tile';
      const prism = document.createElement('div'); prism.className = 'puz-prism';
      for (let i = 0; i < 3; i++){
        const face = document.createElement('div'); face.className = 'puz-face';
        // three square faces of an equilateral prism: normals 120° apart, each
        // an inradius (side / 2√3) out from the rotation axis
        face.style.transform = `rotateX(${i*120}deg) translateZ(calc(var(--cell) / 3.4641))`;
        face.innerHTML = PUZZLE_SCENES[i];
        const svg = face.querySelector('svg');
        svg.style.left = (-c*100) + '%'; svg.style.top = (-r*100) + '%';
        prism.appendChild(face);
      }
      const t = { prism, tile, deg: 0, f: 0, faces: [...prism.children] };
      tile.appendChild(prism);
      tile.addEventListener('click', ev => this.rotate(t, ev));
      grid.appendChild(tile); this.tiles.push(t);
    }
    this.newRound(true);
  },
  // the trophy shelf: one empty slot per scene, filled as each is built
  buildGallery(){
    const g = $('#puz-gallery'); if (!g) return;
    g.innerHTML = PUZZLE_SCENES.map((s, i) =>
      `<div class="puz-slot" data-scene="${i}"><span class="puz-slot-q">?</span></div>`).join('');
  },
  fillSlot(i){
    const slot = $(`#puz-gallery .puz-slot[data-scene="${i}"]`);
    if (!slot || slot.classList.contains('filled')) return;
    slot.innerHTML = PUZZLE_SCENES[i] + '<span class="puz-slot-star">⭐</span>';
    slot.classList.add('filled', 'pop');
    slot.addEventListener('animationend', () => slot.classList.remove('pop'), { once: true });
  },
  // rebuilding a picture already on the shelf → pulse its existing trophy
  pulseSlot(i){
    const slot = $(`#puz-gallery .puz-slot[data-scene="${i}"]`);
    if (!slot) return;
    slot.classList.remove('pulse'); void slot.offsetWidth;   // restart the animation
    slot.classList.add('pulse');
    slot.addEventListener('animationend', () => slot.classList.remove('pulse'), { once: true });
  },
  // set up the next picture: steer most tiles toward an *uncollected* scene so
  // the child builds a new one each round; never start already-solved
  newRound(first){
    const left = [0,1,2].filter(i => !this.done.has(i));
    this.target = (left.length ? left : [0,1,2])[Math.floor(Math.random() * (left.length || 3))];
    let tries = 0;
    do {
      this.tiles.forEach(t => {
        const f = (!first && Math.random() < 0.6) ? this.target : Math.floor(Math.random()*3);
        t.f = f; t.deg = -120*f; this.apply(t, true);
      });
    } while (this.solved() && ++tries < 25);
    this.tiles.forEach(t => this.hideBack(t));
    this.won = false;
  },
  // continuous angle → always turns the short way; front face derived from it
  faceOf(deg){ return (((-Math.round(deg/120)) % 3) + 3) % 3; },
  apply(t, instant){
    if (instant) t.prism.style.transition = 'none';
    t.prism.style.transform = `rotateX(${t.deg}deg)`;
    if (instant){ void t.prism.offsetWidth; t.prism.style.transition = ''; }
  },
  // at rest only the front face shows (a clean tile); all three show mid-tumble
  showAll(t){ t.faces.forEach(f => f.style.visibility = 'visible'); },
  hideBack(t){ t.faces.forEach((f, i) => f.style.visibility = i === t.f ? 'visible' : 'hidden'); },
  rotate(t, ev){
    if (this.won) return;
    // the prism spins on its horizontal centre axle: pushing the TOP half rolls
    // the top back (one way), the BOTTOM half rolls the bottom back (the other)
    let delta = -120;   // default (no event): roll forward one face
    if (ev){
      const r = t.tile.getBoundingClientRect();
      delta = ev.clientY < r.top + r.height/2 ? 120 : -120;
    }
    this.showAll(t);
    t.deg += delta;
    t.f = this.faceOf(t.deg);
    this.apply(t);
    Audio2.snapSnd();
    setTimeout(() => { if (!this.won) this.hideBack(t); }, 560);
    if (this.solved()) setTimeout(() => this.complete(), 400);   // let the tumble finish
  },
  solved(){ return this.tiles.every(t => t.f === this.tiles[0].f); },
  complete(){
    if (this.won) return;
    this.won = true;                       // lock taps during the celebration
    const scene = this.tiles[0].f;
    const fresh = !this.done.has(scene);
    if (fresh) this.done.add(scene);
    $('#puzzle-grid').classList.add('solved');
    if (fresh) setTimeout(() => this.fillSlot(scene), 500);        // trophy pops onto the shelf
    else       setTimeout(() => this.pulseSlot(scene), 350);       // its trophy pulses

    if (this.done.size >= 3){
      // all three built → the big finale. Carry the finished pictures into the
      // celebration foreground so they stay on screen over the fireworks.
      Audio2.fanfare();
      const pics = '<div class="cel-pics">' + [...this.done].sort((a,b)=>a-b)
        .map(i => `<div class="cel-pic">${PUZZLE_SCENES[i]}<span class="puz-slot-star">⭐</span></div>`)
        .join('') + '</div>';
      setTimeout(() => Celebrate.run('trophy', 'You did it!', pics), 700);
      // the shelf itself also stays put; keep it above the play-again scrim,
      // which appears once the fireworks have finished
      $('#puz-gallery').classList.add('above-win');
      setTimeout(() => {
        $('#puzzle-grid').classList.remove('solved');
        $('#puz-win').classList.remove('hidden');
      }, 5500);
    } else {
      // a picture done, more to go → celebrate, then set up the next one
      Audio2.correct();
      Audio2.speak(fresh ? 'You did it!' : 'Again!');
      setTimeout(() => {
        $('#puzzle-grid').classList.remove('solved');
        this.newRound(false);
      }, 1500);
    }
  },
};


/* ═══════════════ Block Stacker — realistic wooden-block sandbox ═══════════════
   A grassy field where random shaded wooden shapes (cube, brick, plank, tall,
   triangle, cylinder, ball) drop, stack, topple, roll, and can be grabbed and
   restacked. Physics: Matter.js when it's loaded (real rigid-body dynamics —
   rotation, friction, toppling, rolling); a simple bounce-free AABB fallback
   otherwise. Blocks are crisp shaded SVG, synced to the simulation each frame. */

export { PUZZLE_SCENES, PuzzleGame };

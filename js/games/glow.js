import { Audio2 } from '../audio.js';
import { $ } from '../core.js';
import { FX } from '../fx.js';
import { showView } from '../router.js';
import { Store } from '../store.js';

/* ═══════════════ Glow Slide (kid 2048: light, not numbers) ═══════════════
   Slide the board; two tiles of the same brightness pour together into ONE
   brighter tile — energy states of a single hue, from a pale ember (1) up to
   a white-hot star (9). No numerals anywhere: the tile IS its value. */

const GlowGame = {
  N: 4, MAX: 7,
  // the advancement sequence is the rainbow itself — ROYGBIV, a ladder kids
  // already know. Maximally distinct neighbours, no colour-ramp squinting.
  RAINBOW: [
    { h: 2,   s: 82,  l: 58, name: 'red'    },
    { h: 28,  s: 94,  l: 54, name: 'orange' },
    { h: 47,  s: 100, l: 52, name: 'yellow' },
    { h: 128, s: 62,  l: 45, name: 'green'  },
    { h: 214, s: 88,  l: 55, name: 'blue'   },
    { h: 258, s: 62,  l: 50, name: 'indigo' },
    { h: 288, s: 68,  l: 56, name: 'violet' },
  ],
  grid: [], tiles: [], best: 1, seq: 0,
  active: false, bound: false, animating: false, won: false,
  cs: 0, gap: 0, swipe: null,
  mode: 'push',   // 'push': shove one block at a time · 'classic': 2048 board-sweeps
  demoing: false, demoSeq: 0, demoQueue: [],
  board(){ return $('#gs-board'); },

  /* one level = one rainbow colour. The energy feel stays: the hot core and
     the glow halo still grow with level, so violet (the top) blazes while red
     barely glows — but the primary tell is the hue itself. */
  look(level){
    const { h, s, l } = this.RAINBOW[level - 1];
    const t = (level - 1) / (this.MAX - 1);   // 0..1
    const core = Math.round(14 + 50 * t);      // % radius of the hot centre
    const coreA = (0.2 + 0.5 * t).toFixed(2);
    const glowR = (3 + 26 * t).toFixed(1), glowA = (0.1 + 0.5 * t).toFixed(2);
    return {
      bg: `radial-gradient(circle at 50% 42%, hsla(${h},100%,92%,${coreA}) 0%, transparent ${core}%), hsl(${h},${s}%,${l}%)`,
      shadow: `0 2px 8px rgba(20,40,60,.18), 0 0 ${glowR}px ${(glowR/3).toFixed(1)}px hsla(${h},95%,62%,${glowA})`,
    };
  },
  paint(t){
    const lk = this.look(t.level);
    t.el.style.background = lk.bg;
    t.el.style.boxShadow = lk.shadow;
    t.el.classList.toggle('gs-max', t.level === this.MAX);
  },
  pos(r, c){ return { x: this.gap + c * (this.cs + this.gap), y: this.gap + r * (this.cs + this.gap) }; },
  place(t){
    const p = this.pos(t.r, t.c);
    t.el.style.transform = `translate(${p.x}px, ${p.y}px)`;
  },

  layout(){
    const b = this.board(), w = b.clientWidth;
    this.gap = Math.max(6, Math.round(w * 0.025));
    this.cs = (w - this.gap * (this.N + 1)) / this.N;
    // the empty sockets are rebuilt at the current size, tiles re-seated
    b.querySelectorAll('.gs-cell').forEach(e => e.remove());
    for (let r = 0; r < this.N; r++) for (let c = 0; c < this.N; c++){
      const cell = document.createElement('div');
      cell.className = 'gs-cell';
      const p = this.pos(r, c);
      cell.style.cssText = `width:${this.cs}px;height:${this.cs}px;transform:translate(${p.x}px,${p.y}px)`;
      b.appendChild(cell);
    }
    for (const t of this.tiles){
      t.el.style.width = t.el.style.height = this.cs + 'px';
      this.place(t);
    }
  },

  start(){
    Audio2.unlock(); showView('glow');
    const st = Store.settings();
    if (st.glowMode === 'classic' || st.glowMode === 'push') this.mode = st.glowMode;
    this.reset();
    if (!this.bound){
      const b = this.board();
      b.addEventListener('pointerdown', e => this.onDown(e));
      window.addEventListener('pointermove', e => this.onDrag(e));
      window.addEventListener('pointerup', () => this.onUp());
      window.addEventListener('pointercancel', () => this.onUp());
      window.addEventListener('keydown', e => {
        if (!this.active || this.demoing || this.mode !== 'classic') return;
        const d = { ArrowLeft:[0,-1], ArrowRight:[0,1], ArrowUp:[-1,0], ArrowDown:[1,0] }[e.key];
        if (d){ e.preventDefault(); this.move(d[0], d[1]); }
      });
      window.addEventListener('resize', () => { if (this.active) this.layout(); });
      $('#gs-reset').addEventListener('click', () => this.reset());
      $('#btn-gs-again').addEventListener('click', () => this.reset());
      $('#btn-gs-keep').addEventListener('click', () => { $('#gs-over').classList.add('hidden'); this.endRainbow(); });
      $('#gs-mode-push').addEventListener('click', () => this.setMode('push'));
      $('#gs-mode-classic').addEventListener('click', () => this.setMode('classic'));
      this.bound = true;
    }
  },
  setMode(m){
    Audio2.unlock();
    if (this.mode === m) return;
    this.mode = m;
    const st = Store.settings(); st.glowMode = m; Store.saveSettings(st);
    this.reset();   // different deal and pacing — start the mode fresh (also cancels a demo)
  },
  syncModeUI(){
    $('#gs-mode-push').classList.toggle('on', this.mode === 'push');
    $('#gs-mode-classic').classList.toggle('on', this.mode === 'classic');
    $('#gs-hint').textContent = this.mode === 'push'
      ? 'Push a colour into its twin — two of a kind make the next rainbow colour!'
      : 'Swipe to slide all the blocks — twins join into the next rainbow colour!';
  },
  stop(){
    this.active = false; this.swipe = null;
    this.demoSeq++; this.endDemo(); this.endRainbow();
    this.clearTiles();
  },
  endRainbow(){ this.rainbowFx?.end(); this.rainbowFx = null; },
  clearTiles(){
    for (const t of this.tiles) t.el.remove();
    this.tiles = []; this.grid = Array.from({ length: this.N }, () => Array(this.N).fill(null));
  },
  reset(){
    this.demoSeq++; this.endDemo();   // a mid-demo reset cancels the robot cleanly
    this.endRainbow();
    this.clearTiles();
    this.active = true; this.animating = false; this.won = false; this.best = 1;
    $('#gs-over').classList.add('hidden');
    this.layout(); this.renderOps(); this.renderLadder(); this.syncModeUI();
    if (this.mode === 'classic'){
      // classic 2048 opening: two tiles, the board fills through play
      this.spawn(); this.spawn();
    } else {
      // push opening deal: enough lights that twins are always findable,
      // spread out so there's real pushing to do
      for (const lvl of [1, 1, 1, 1, 1, 2]){
        const empty = [];
        for (let r = 0; r < this.N; r++) for (let c = 0; c < this.N; c++)
          if (!this.grid[r][c]) empty.push([r, c]);
        const [r, c] = empty[Math.floor(Math.random() * empty.length)];
        this.makeTile(r, c, lvl);
      }
    }
  },

  renderOps(){
    const ops = $('#gs-ops');
    ops.innerHTML = `<button id="gs-rainbow" class="fb-btn gs-demo-btn gs-rainbow-btn" aria-label="Preview the rainbow celebration">🌈</button>
      <button id="gs-demo" class="fb-btn gs-demo-btn" aria-label="Watch the robot show how to play">
      <svg viewBox="0 0 100 100" width="34" height="34" aria-hidden="true">
        <line x1="50" y1="22" x2="50" y2="10" stroke="#8AA0B4" stroke-width="6" stroke-linecap="round"/>
        <circle cx="50" cy="9" r="7" fill="#FFC02E"/>
        <rect x="18" y="22" width="64" height="50" rx="15" fill="#8AA0B4"/>
        <rect x="26" y="30" width="48" height="34" rx="10" fill="#EAF2F9"/>
        <circle cx="39" cy="44" r="5.5" fill="#22384A"/><circle cx="61" cy="44" r="5.5" fill="#22384A"/>
        <path d="M41 54 Q50 60 59 54" stroke="#22384A" stroke-width="4" fill="none" stroke-linecap="round"/>
        <rect x="30" y="76" width="40" height="14" rx="7" fill="#A9BFD3"/>
      </svg></button>`;
    $('#gs-demo').addEventListener('click', () => { Audio2.unlock(); this.demo(); });
    // the full win choreography on demand — WITHOUT setting `won`, so game
    // state is untouched and real wins still fire
    $('#gs-rainbow').addEventListener('click', () => {
      Audio2.unlock(); Audio2.fanfare();
      this.endRainbow();
      this.rainbowFx = FX.rainbow($('#view-glow'));
    });
  },
  // the "how bright have you gotten" ladder IS a miniature rainbow: seven
  // nested arc bands, level 1 the lowest/innermost up to level 7 the full
  // outer arc. Every band shows GHOSTED in its own colour until that level
  // is passed; a newly earned band draws itself in left to right.
  renderLadder(){
    const lad = $('#gs-ladder');
    const r1 = 15, step = 5.5;                        // innermost radius, band pitch
    const rmax = r1 + (this.MAX - 1) * step;
    const W = (rmax + 5) * 2, H = rmax + 9, cx = W / 2, cy = H - 3;
    let arcs = '';
    for (let l = 1; l <= this.MAX; l++){
      const { h, s, l: li } = this.RAINBOW[l - 1];
      const lit = l <= this.best;
      const r = r1 + (l - 1) * step;
      const d = `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
      if (!lit){
        arcs += `<path d="${d}" fill="none" stroke-linecap="round" stroke-width="4.5"
          stroke="hsla(${h},${Math.round(s * 0.55)}%,${Math.round(li * 0.8)}%,.2)"/>`;
        continue;
      }
      const draw = l === this.best ? `style="stroke-dasharray:${(Math.PI * r).toFixed(1)};stroke-dashoffset:${(Math.PI * r).toFixed(1)}" class="gsl-new"` : '';
      arcs += `<path d="${d}" fill="none" stroke-linecap="round" stroke-width="8"
          stroke="hsla(${h},95%,65%,.35)"/>
        <path d="${d}" fill="none" stroke-linecap="round" stroke-width="4.5"
          stroke="hsl(${h},${s}%,${li}%)" ${draw}/>`;
    }
    lad.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">${arcs}</svg>`;
  },

  makeTile(r, c, level){
    const t = { id: ++this.seq, level, r, c };
    t.el = document.createElement('div');
    t.el.className = 'gs-tile gs-new';
    t.el.style.width = t.el.style.height = this.cs + 'px';
    this.paint(t); this.place(t);
    this.board().appendChild(t.el);
    setTimeout(() => t.el.classList.remove('gs-new'), 220);
    this.grid[r][c] = t; this.tiles.push(t);
    return t;
  },
  spawn(){
    // the robot's demo is scripted: it feeds the exact spawns its lesson needs
    const q = this.demoQueue.shift();
    if (q && !this.grid[q[0]][q[1]]){ this.makeTile(q[0], q[1], q[2]); return; }
    const empty = [];
    for (let r = 0; r < this.N; r++) for (let c = 0; c < this.N; c++)
      if (!this.grid[r][c]) empty.push([r, c]);
    if (!empty.length) return;
    const [r, c] = empty[Math.floor(Math.random() * empty.length)];
    let lvl;
    if (this.mode === 'push'){
      // push mode gifts warm up with progress: once the player is a few rungs
      // up the rainbow, red gifts stop — 7 rungs on merge-only spawns would
      // otherwise be a slog of re-climbing from the bottom every time
      const lo = Math.max(1, this.best - 3);
      lvl = lo + (Math.random() < 0.25 ? 1 : 0);
    } else {
      lvl = Math.random() < 0.12 ? 2 : 1;
    }
    this.makeTile(r, c, lvl);
  },

  // classic 2048: one gesture slides EVERY light; equal neighbours in the
  // sweep direction pour together (each tile merges at most once per move),
  // and every successful move spawns a fresh light
  move(dr, dc){
    if (!this.active || this.animating) return;
    const N = this.N, range = [...Array(N).keys()];
    const rows = dr === 1 ? [...range].reverse() : range;
    const cols = dc === 1 ? [...range].reverse() : range;
    const mergedInto = new Set(), dead = [];
    let moved = false, merges = 0;
    for (const r of rows) for (const c of cols){
      const t = this.grid[r][c]; if (!t) continue;
      let nr = r, nc = c;
      for (;;){
        const rr = nr + dr, cc = nc + dc;
        if (rr < 0 || rr >= N || cc < 0 || cc >= N) break;
        const o = this.grid[rr][cc];
        if (!o){ nr = rr; nc = cc; continue; }
        if (o.level === t.level && o.level < this.MAX && !mergedInto.has(o)){ nr = rr; nc = cc; }
        break;
      }
      if (nr === r && nc === c) continue;
      const target = this.grid[nr][nc];
      this.grid[r][c] = null;
      if (target){
        mergedInto.add(target); merges++;
        target.level++;
        t.r = nr; t.c = nc; t.el.style.zIndex = 3;
        dead.push(t);
        this.tiles = this.tiles.filter(x => x !== t);
      } else {
        this.grid[nr][nc] = t; t.r = nr; t.c = nc;
      }
      this.place(t);
      moved = true;
    }
    if (!moved) return;
    this.animating = true;
    setTimeout(() => {
      for (const t of dead) t.el.remove();
      let record = 0;
      for (const t of mergedInto){
        this.paint(t);
        t.el.classList.remove('gs-bump'); void t.el.offsetWidth;
        t.el.classList.add('gs-bump');
        if (t.level > this.best){ this.best = t.level; record = Math.max(record, t.level); }
      }
      if (merges) Audio2.pop();
      if (record){
        this.renderLadder();
        const rt = [...mergedInto].find(t => t.level === record);
        const rc = rt.el.getBoundingClientRect(), rh = this.RAINBOW[record - 1].h;
        FX.burst(rc.left + rc.width / 2, rc.top + rc.height / 2,
          [`hsl(${rh},90%,70%)`, `hsl(${rh},95%,55%)`, '#fff']);
        if (record === this.MAX && !this.won){ if (!this.demoing) this.win(); }
        else if (record >= 3) Audio2.bell();
      }
      this.spawn();
      this.animating = false;
      if (!this.demoing && !this.canMove()) this.over(false);
    }, 150);
  },

  // push ONE block: it slides until the wall, stops against a different
  // light, or lands on its twin and joins it (one energy state brighter).
  // A join gifts a new light — that's the only spawn, so the board stays
  // calm and a small player can never be buried.
  push(t, dr, dc){
    if (!this.active || this.animating || this.grid[t.r][t.c] !== t) return false;
    let nr = t.r, nc = t.c, target = null;
    for (;;){
      const rr = nr + dr, cc = nc + dc;
      if (rr < 0 || rr >= this.N || cc < 0 || cc >= this.N) break;
      const o = this.grid[rr][cc];
      if (!o){ nr = rr; nc = cc; continue; }
      if (o.level === t.level && o.level < this.MAX){ nr = rr; nc = cc; target = o; }
      break;
    }
    if (nr === t.r && nc === t.c){ this.nudge(t, dr, dc); return false; }
    this.grid[t.r][t.c] = null;
    t.r = nr; t.c = nc;
    if (target){
      target.level++;
      t.el.style.zIndex = 3;
      this.tiles = this.tiles.filter(x => x !== t);
    } else {
      this.grid[nr][nc] = t;
    }
    this.place(t);
    this.animating = true;
    setTimeout(() => {
      if (target){
        t.el.remove();
        this.paint(target);
        target.el.classList.remove('gs-bump'); void target.el.offsetWidth;
        target.el.classList.add('gs-bump');
        Audio2.pop();
        if (target.level > this.best){
          this.best = target.level;
          this.renderLadder();
          const rc = target.el.getBoundingClientRect(), rh = this.RAINBOW[target.level - 1].h;
          FX.burst(rc.left + rc.width / 2, rc.top + rc.height / 2,
            [`hsl(${rh},90%,70%)`, `hsl(${rh},95%,55%)`, '#fff']);
          if (target.level === this.MAX && !this.won){ if (!this.demoing) this.win(); }
          else if (target.level >= 3) Audio2.bell();
        }
        this.spawn();
      } else {
        Audio2.clack(0.25);   // a gentle tap as the block comes to rest
      }
      this.animating = false;
      if (!this.demoing && !this.canMove()) this.over(false);
    }, 150);
    return true;
  },

  canMove(){
    if (this.mode === 'classic'){
      // classic: an empty cell or any equal-neighbour pair means a move exists
      for (let r = 0; r < this.N; r++) for (let c = 0; c < this.N; c++){
        const t = this.grid[r][c];
        if (!t) return true;
        if (t.level < this.MAX){
          if (c + 1 < this.N && this.grid[r][c + 1] && this.grid[r][c + 1].level === t.level) return true;
          if (r + 1 < this.N && this.grid[r + 1][c] && this.grid[r + 1][c].level === t.level) return true;
        }
      }
      return false;
    }
    if (!this.tiles.length) return false;
    for (const t of this.tiles)
      for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]){
        const rr = t.r + dr, cc = t.c + dc;
        if (rr < 0 || rr >= this.N || cc < 0 || cc >= this.N) continue;
        const o = this.grid[rr][cc];
        if (!o || (o.level === t.level && o.level < this.MAX)) return true;
      }
    return false;
  },
  win(){
    this.won = true;
    Audio2.fanfare();
    // the finale IS a rainbow: the arch builds across the whole screen,
    // sparkles for ~10s and melts away — no modal, nothing blocked, the
    // game (and the home button) stay live throughout
    this.rainbowFx = FX.rainbow($('#view-glow'));
  },
  over(won){
    $('#gs-over-title').textContent = won ? 'You made the whole rainbow! 🌈' : 'What a glow! ✨';
    $('#btn-gs-keep').classList.toggle('hidden', !won || !this.canMove());
    // with the rainbow arch glowing behind the win dialog, thin the backdrop
    // veil so the celebration stays vivid instead of going muddy
    $('#gs-over').classList.toggle('gs-clear', won && !!this.rainbowFx);
    $('#gs-over').classList.remove('hidden');
  },

  /* ── the robot tutor ─────────────────────────────────────────────────────
     A scripted lesson on the real board: a little robot pops up, a glowing
     fingertip performs each swipe, and the exact spawns the story needs are
     fed through demoQueue — join, move, any-direction, join again, and a
     two-step brightness climb. Reset / home / a new demo all cancel it. */
  async demo(){
    if (this.demoing || !this.active) return;
    const id = ++this.demoSeq;
    this.demoing = true; this.demoQueue = [];
    const ok = () => this.demoing && this.demoSeq === id && this.active;
    const wait = ms => new Promise(res => setTimeout(res, ms));
    // opening position: two pale twins, nothing else to look at
    this.clearTiles();
    $('#gs-over').classList.add('hidden');
    this.best = 1; this.renderLadder();
    this.makeTile(1, 0, 1); this.makeTile(1, 3, 1);
    const robot = document.createElement('div');
    robot.className = 'gs-robot';
    robot.innerHTML = `<div class="gs-bubble"></div>
      <svg viewBox="0 0 100 110" width="90" aria-hidden="true">
        <line x1="50" y1="18" x2="50" y2="8" stroke="#8AA0B4" stroke-width="5" stroke-linecap="round"/>
        <circle class="gsr-tip" cx="50" cy="7" r="5" fill="#FFC02E"/>
        <rect x="24" y="17" width="52" height="41" rx="13" fill="#8AA0B4"/>
        <rect x="31" y="24" width="38" height="27" rx="9" fill="#EAF2F9"/>
        <circle class="gsr-eye" cx="41" cy="35" r="4.4" fill="#22384A"/>
        <circle class="gsr-eye" cx="59" cy="35" r="4.4" fill="#22384A"/>
        <path d="M43 43 Q50 48 57 43" stroke="#22384A" stroke-width="3" fill="none" stroke-linecap="round"/>
        <rect x="16" y="63" width="10" height="22" rx="5" fill="#8AA0B4"/>
        <rect x="74" y="63" width="10" height="22" rx="5" fill="#8AA0B4"/>
        <rect x="30" y="60" width="40" height="32" rx="11" fill="#A9BFD3"/>
        <circle class="gsr-tip" cx="50" cy="74" r="5.5" fill="#FFC02E"/>
        <circle cx="38" cy="98" r="7" fill="#5D7285"/><circle cx="62" cy="98" r="7" fill="#5D7285"/>
      </svg>`;
    $('#view-glow').appendChild(robot);
    const finger = document.createElement('div');
    finger.className = 'gs-finger';
    this.board().appendChild(finger);
    const say = txt => {
      robot.querySelector('.gs-bubble').textContent = txt;
      Audio2.speak(txt);
    };
    try {
      say('Watch me play!');
      await wait(1500); if (!ok()) return;
      // each mode gets its own lesson: push teaches per-block shoves, classic
      // teaches whole-board sweeps — always demonstrating the ACTIVE rules
      const STEPS = this.mode === 'push' ? [
        { say: 'Push a red to its twin!',           tile: () => this.grid[1][0], d: [0, 1],  spawn: [3, 0, 1] },
        { say: 'Push any side — it slides!',        tile: () => this.grid[3][0], d: [0, 1] },
        { say: 'Different colours bump — no join.', tile: () => this.grid[3][3], d: [-1, 0] },
        { say: 'Two oranges make yellow!',          tile: () => this.grid[1][0], d: [0, 1], place: [1, 0, 2] },
      ] : [
        { say: 'Two reds make orange!',    d: [0, -1], spawn: [3, 2, 1] },
        { say: 'Sliding moves everyone.',  d: [0, -1], spawn: [1, 3, 1] },
        { say: 'Up, down, left or right!', d: [-1, 0], spawn: [0, 2, 1] },
        { say: 'Join the twins again…',    d: [0, -1], spawn: [3, 3, 1] },
        { say: 'Orange makes yellow!',     d: [0, -1] },
      ];
      for (const s of STEPS){
        if (s.place) this.makeTile(...s.place);
        say(s.say);
        if (s.spawn) this.demoQueue.push(s.spawn);
        if (s.tile){
          const t = s.tile(); if (!t) break;
          await this.fingerPush(finger, t, s.d); if (!ok()) return;
          this.push(t, s.d[0], s.d[1]);
        } else {
          await this.fingerSwipe(finger, s.d); if (!ok()) return;
          this.move(s.d[0], s.d[1]);
        }
        await wait(1400); if (!ok()) return;
      }
      say('Now you try!');
      await wait(1900);
    } finally {
      // natural finish → clean up and deal a fresh board; if something else
      // (reset/home) already cancelled this run, it also cleaned up
      if (this.demoSeq === id){
        this.endDemo();
        if (this.active) this.reset();
      }
    }
  },
  endDemo(){
    this.demoing = false; this.demoQueue = [];
    document.querySelectorAll('.gs-robot, .gs-finger').forEach(e => e.remove());
  },
  // classic demo cue: the fingertip glides across the middle of the board —
  // "swipe anywhere, everything slides"
  fingerSwipe(f, [dr, dc]){
    const W = this.board().clientWidth, mid = W / 2, span = W * 0.28;
    f.style.transition = 'none';
    f.style.transform = `translate(${mid - dc * span}px, ${mid - dr * span}px)`;
    f.style.opacity = '0';
    void f.offsetWidth;
    f.style.transition = 'opacity .18s ease, transform .55s cubic-bezier(.35,.1,.3,1)';
    f.style.opacity = '1';
    requestAnimationFrame(() => {
      f.style.transform = `translate(${mid + dc * span}px, ${mid + dr * span}px)`;
    });
    return new Promise(res => setTimeout(() => { f.style.opacity = '0'; res(); }, 640));
  },
  // push demo cue: the fingertip lands ON the block being pushed, then glides
  // in the push direction — "touch this one, shove it that way"
  fingerPush(f, t, [dr, dc]){
    const p = this.pos(t.r, t.c), cx = p.x + this.cs / 2, cy = p.y + this.cs / 2;
    const span = (this.cs + this.gap) * 1.5;
    f.style.transition = 'none';
    f.style.transform = `translate(${cx}px, ${cy}px)`;
    f.style.opacity = '0';
    void f.offsetWidth;
    f.style.transition = 'opacity .18s ease, transform .5s cubic-bezier(.35,.1,.3,1) .25s';
    f.style.opacity = '1';
    requestAnimationFrame(() => {
      f.style.transform = `translate(${cx + dc * span}px, ${cy + dr * span}px)`;
    });
    return new Promise(res => setTimeout(() => { f.style.opacity = '0'; res(); }, 850));
  },

  /* ── input: pushing one block ────────────────────────────────────────────
     Touch a light and it's yours: drag it the way you want it to go, or just
     tap one of its sides and it scoots AWAY from your finger (a push). Only
     that one light moves — direct manipulation, no abstract board-swipes. */
  hit(px, py){
    for (const t of this.tiles){
      const p = this.pos(t.r, t.c);
      if (px >= p.x && px <= p.x + this.cs && py >= p.y && py <= p.y + this.cs) return t;
    }
    return null;
  },
  onDown(e){
    e.preventDefault();
    if (!this.active || this.demoing || this.animating) return;
    if (this.mode === 'classic'){
      // classic: the gesture belongs to the whole board, wherever it starts
      this.swipe = { classic: true, x: e.clientX, y: e.clientY, done: false };
      return;
    }
    const r = this.board().getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    const t = this.hit(px, py);
    if (!t) return;
    const p = this.pos(t.r, t.c);
    t.el.classList.add('gs-grab');
    // odx/ody: where on the tile the finger landed, relative to its centre —
    // a plain tap pushes the block away from that side
    this.swipe = { t, x: e.clientX, y: e.clientY, odx: px - (p.x + this.cs / 2), ody: py - (p.y + this.cs / 2), done: false };
  },
  onDrag(e){
    const s = this.swipe;
    if (!s || s.done) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (Math.hypot(dx, dy) < 18) return;
    s.done = true;
    const [dr, dc] = Math.abs(dx) > Math.abs(dy) ? [0, Math.sign(dx)] : [Math.sign(dy), 0];
    if (s.classic){ this.move(dr, dc); return; }
    s.t.el.classList.remove('gs-grab');
    this.push(s.t, dr, dc);
  },
  onUp(){
    const s = this.swipe;
    this.swipe = null;
    if (!s || s.done || s.classic) return;
    s.t.el.classList.remove('gs-grab');
    // tap: push away from the touched side; a dead-centre tap just wobbles
    const ax = Math.abs(s.odx), ay = Math.abs(s.ody), edge = this.cs * 0.14;
    if (Math.max(ax, ay) < edge){ this.nudge(s.t, 0, 0); return; }
    if (ax > ay) this.push(s.t, 0, -Math.sign(s.odx));
    else this.push(s.t, -Math.sign(s.ody), 0);
  },
  nudge(t, dr, dc){
    t.el.style.setProperty('--ndx', dc * 7 + 'px');
    t.el.style.setProperty('--ndy', dr * 7 + 'px');
    t.el.classList.remove('gs-nudge'); void t.el.offsetWidth;
    t.el.classList.add('gs-nudge');
  },
};

export { GlowGame };

import { Audio2 } from './audio.js';
import { $, clamp, hashStr, mulberry32, uuid } from './core.js';
import { applyRunOutcome, makeFrustrationDetector } from './dda.js';
import { Celebrate, FX } from './fx.js';
import { sayGlyph } from './letters.js';
import { NODES } from './nodes.js';
import { showView } from './router.js';
import { Store, nodeProgress, saveNodeProgress } from './store.js';
import { Telemetry } from './telemetry.js';
import { nodeUnlocked, renderHome } from './ui.js';

/* Contacts closer together than this came from one hand, not two decisions. */
const TAP_GAP = 160;

const Engine = {
  node:null, level:null, trials:[], trialIdx:0, cur:null, curRecord:null,
  promptEndAt:0, timeoutTimer:0, autoTimer:0, locked:false,
  wrongCount:0, usedFallback:false, results:[], frustration:null, lastTapAt:0,
  drag:null, // active drag state

  stage(){ return $('#stage'); },

  /* Pick a cheer, never repeating the last one. Uniform random repeats about a
     quarter of the time, and back-to-back "Hooray! … Hooray!" reads as the app
     stuttering rather than as praise. */
  lastPraise: '',
  praise(pool){
    const opts = pool.filter(p => p !== this.lastPraise);
    this.lastPraise = opts[Math.floor(Math.random() * opts.length)];
    return this.lastPraise;
  },

  startLevel(node, level, forcedSeed){
    this.active = true;
    this.node = node; this.level = level;
    const settings = Store.settings();
    settings.seedCounter = (settings.seedCounter||0) + 1;
    Store.saveSettings(settings);
    const seed = forcedSeed || hashStr(`${node.key}|${level.id}|${settings.seedCounter}`);
    // the address bar is always a permalink to this exact challenge
    const q = new URLSearchParams(location.search);
    q.set('level', level.id); q.set('seed', seed.toString(36));
    history.replaceState(null, '', '?' + q.toString());
    const rng = mulberry32(seed);
    const gen = level.make(rng);
    this.trials = [gen.expose, gen.contrast, ...gen.tests].filter(Boolean);   // a level may omit expose/contrast (e.g. Intro taps)
    this.results = [];
    Telemetry.begin(node, level, seed);
    this.frustration = makeFrustrationDetector(() => this.onFrustration());
    showView('play');
    this.renderStones();
    this.runTrial(0);
  },

  renderStones(){
    const wrapEl = $('#stones');
    wrapEl.innerHTML = this.trials.map((t,i) =>
      `<span class="stone" data-i="${i}" title="${t.state}"></span>`).join('');
  },
  markStone(i, cls){
    const s = $('#stones').children[i];
    if (s){ s.classList.remove('cur'); if (cls) s.classList.add(cls); }
  },

  runTrial(idx){
    clearTimeout(this.timeoutTimer); clearTimeout(this.autoTimer);
    if (idx >= this.trials.length) return this.finishRun();
    this.trialIdx = idx;
    this.cur = this.trials[idx];
    this.locked = false; this.wrongCount = 0; this.usedFallback = false;
    this.hintCount = 0;
    this.lastTapAt = 0;
    this.promptSpeaks = 0;
    this.promptEndAt = 0;
    this.drag = null;
    // stacking trials: the landing surface starts as the base and rises with
    // each placed block (towers)
    if (this.cur.kind === 'stack') this.stackOn = {};   // child id → support id
    const st = $('#stones').children[idx]; if (st) st.classList.add('cur');

    // trial record per spec
    const target = (this.cur.elements.find(e=>e.target) || {}).id || null;
    this.curRecord = {
      id: uuid(), state: this.cur.state,
      targetElementId: this.cur.kind==='drag' ? this.cur.pieces.map(p=>p.slot).join('+') : target,
      distractorElementIds: this.cur.elements.filter(e=>!e.target && !e.scenery && (e.tappable||e.zone)).map(e=>e.id),
      prompt: this.cur.prompt, timeoutMs: this.cur.timeoutMs,
      firstAttemptCorrect: null, usedFallback: false, kind: this.cur.kind,
    };
    Telemetry.addTrial(this.curRecord);

    this.renderTrial();
    $('#prompt-text').textContent = this.cur.prompt;
    $('#prompt-bubble').classList.remove('hidden');
    if (this.cur.kind === 'hideseek' && this.cur.hideInto) this.hideThenPrompt();
    else if (this.cur.demo === 'spoutClimb'){ this.locked = true; this.spoutDemoClimb(() => { this.locked = false; this.completeTrial(true, {silent:true}); }); }
    else if (this.cur.demo === 'spoutWash'){ this.locked = true; this.spoutDemoWash(() => { this.locked = false; this.completeTrial(true, {silent:true}); }); }
    else this.speakPrompt();
  },

  // hide-and-seek: show the card, slide it under the target cover, then ask
  hideThenPrompt(){
    const stage = this.stage();
    const obj = stage.querySelector('[data-el="obj"]');
    const cover = stage.querySelector(`[data-el="${this.cur.hideInto}"]`);
    if (!obj || !cover){ this.speakPrompt(); return; }
    this.locked = true;
    obj.style.zIndex = '6';
    Audio2.speak(this.cur.introSay);
    setTimeout(() => {
      if (!this.active || this.cur.hideInto == null) return;
      const sr = stage.getBoundingClientRect(), cr = cover.getBoundingClientRect();
      obj.classList.add('hs-move');
      obj.style.left = ((cr.left+cr.width/2 - sr.left)/sr.width*100)+'%';
      obj.style.top  = ((cr.top+cr.height/2 - sr.top)/sr.height*100)+'%';
      Audio2.snapSnd();
      setTimeout(() => {
        obj.classList.add('hs-hidden'); obj.style.zIndex = '0';
        setTimeout(() => {
          if (!this.active) return;
          if (this.cur.shuffle) this.shuffleCovers();
          else { this.locked = false; this.speakPrompt(); }
        }, 500);
      }, 620);
    }, 1000);
  },

  // shell game: swap cover positions while the child watches; the target
  // cover keeps its data-target through the moves, so tapping it stays correct
  shuffleCovers(){
    const stage = this.stage();
    const covers = [...stage.querySelectorAll('[data-el^="cover"]')];
    let left = this.cur.shuffles || 3;
    const xOf = el => parseFloat(el.style.left);
    const step = () => {
      if (!this.active) return;
      if (left-- <= 0){ this.locked = false; this.speakPrompt(); return; }
      const i = Math.floor(Math.random()*covers.length);
      let j = Math.floor(Math.random()*covers.length);
      while (j === i) j = Math.floor(Math.random()*covers.length);
      const a = covers[i], b = covers[j], ax = xOf(a), bx = xOf(b);
      a.classList.add('hs-slide'); b.classList.add('hs-slide');
      // lift one over the other so the swap reads as a shell sliding past
      a.style.zIndex = '4'; b.style.zIndex = '3';
      a.style.left = bx + '%'; b.style.left = ax + '%';
      setTimeout(step, 1150);
    };
    setTimeout(step, 550);
  },

  // reveal the card under the tapped cover, peekaboo-style
  revealUnder(coverEl){
    const stage = this.stage();
    const obj = stage.querySelector('[data-el="obj"]');
    if (coverEl) coverEl.classList.add('hs-lift');
    if (obj){
      // jump to the cover's CURRENT spot with no transition (it may have been
      // shuffled), so the card never appears to slide out of the wrong stack
      obj.classList.remove('hs-move');
      obj.style.transition = 'none';
      if (coverEl){ obj.style.left = coverEl.style.left; obj.style.top = coverEl.style.top; }
      obj.style.zIndex = '6';
      void obj.offsetWidth;
      obj.classList.remove('hs-hidden'); obj.classList.add('hs-reveal');
      if (coverEl) obj.style.top = (parseFloat(coverEl.style.top) - 14) + '%';
      else obj.style.top = (parseFloat(obj.style.top) - 12) + '%';
    }
    Audio2.speak('Peekaboo!');
  },

  // spout geometry in stage-%, from the live spout rect (correct at any size):
  //   top  = climb target, just inside the top opening
  //   base = climb start, just inside the bottom of the spout
  //   out  = below the spout, where the spider washes out
  spoutGeom(){
    const stage = this.stage(), sr = stage.getBoundingClientRect();
    const spout = stage.querySelector('[data-el="spout"]');
    if (!spout) return null;
    const pr = spout.getBoundingClientRect();
    // Height comes from the DECLARED --s size, never from the rect: the demo
    // starts 350ms in, while `appear` still has the element scaled toward 0.
    // A shrunken rect put base ABOVE top once the +8/-6 insets crossed over,
    // and the spider "climbed" down the spout. The CENTRE is safe — a centred
    // scale() leaves it where it is — so measure out from there.
    const spec = (this.cur.elements || []).find(e => e.id === 'spout');
    const vmin = Math.min(window.innerWidth, window.innerHeight) / 100;
    const hPx = spec ? spec.s * vmin : pr.height;
    const cy = (pr.top + pr.height / 2 - sr.top) / sr.height * 100;
    const h = hPx / sr.height * 100;
    const t = cy - h / 2, b = cy + h / 2;
    return { stage, sr,
      cx: (pr.left + pr.width/2 - sr.left) / sr.width * 100,
      top: t + 8, base: b - 6, out: b + 12 };
  },
  // move the spider up (or down) the spout over `ms`, rocking left/right between
  // steps so it reads as climbing, not sliding. Explicit reset+reflow at `fromTop`
  // so the transition always runs the FULL distance (never a stale start point).
  climbSpider(bug, cx, fromTop, toTop, ms){
    const rec = this.curRecord;
    bug.style.transition = 'none';
    bug.style.left = cx + '%'; bug.style.top = fromTop + '%'; bug.style.opacity = '1';
    void bug.offsetWidth;                       // commit the start before animating
    bug.classList.add('climbing');
    bug.style.transition = 'top ' + ms + 'ms linear';
    bug.style.top = toTop + '%';
    setTimeout(() => { if (this.curRecord === rec){ bug.classList.remove('climbing'); bug.style.transform = ''; } }, ms);
  },

  // cause → effect: the itsy-bitsy-spider song, AUDIO-DRIVEN. Each line waits for
  // the previous line's audio to finish (Audio2.speak's onend), so the three
  // curated full-line clips never talk over each other and TTS stays in sync.
  // The climb spans line 1's clip (~4.5s), stepping wiggle. Always "spider".
  spoutCauseEffect(bug, spout, cb){
    const g = this.spoutGeom(); if (!g){ cb(); return; }
    const { stage, cx, top, base, out } = g;
    const washDir = cx > 50 ? -1 : 1;
    const ring = stage.querySelector('[data-el="drop"]');
    if (ring) ring.classList.add('fade');
    const rec = this.curRecord;
    const live = () => this.active && this.curRecord === rec;
    const cloud = stage.querySelector('[data-el="cloud"]');
    const sun = stage.querySelector('[data-el="sun"]');
    bug.style.zIndex = '4'; bug.classList.remove('snapping');

    const beatClimb = () => {
      this.climbSpider(bug, cx, base, top, 4100);   // full base→top over the clip
      Audio2.speak('The itsy bitsy spider went up the water spout!', () => { if (live()) beatRain(); });
    };
    const beatRain = () => {
      if (cloud) cloud.classList.add('raining');
      this.startRain(cx);
      bug.classList.remove('climbing'); bug.style.transform = '';
      setTimeout(() => {   // wash DOWN the spout (top → base) as the rain hits it
        if (!live()) return;
        bug.style.transition = 'top 1.6s ease-in';
        bug.style.top = base + '%';
      }, 1200);
      setTimeout(() => {   // then out the bottom, sideways + fade (on "… out")
        if (!live()) return;
        bug.style.transition = 'top .8s ease-in, left .8s ease-in, opacity .8s ease-in';
        bug.style.top = out + '%'; bug.style.left = (cx + washDir * 24) + '%'; bug.style.opacity = '0';
      }, 3000);
      Audio2.speak('Down came the rain and washed the spider out!', () => { if (live()) beatSun(); });
    };
    const beatSun = () => {
      this.stopRain();
      if (sun) sun.classList.add('shine');
      if (cloud){ cloud.classList.remove('raining'); cloud.classList.add('efx-cloud-out'); }
      setTimeout(() => {   // climb again ~4.4s in (on "… went up … again")
        if (live()) this.climbSpider(bug, cx, base, top, 3600);
      }, 4400);
      Audio2.speak('Out came the sun and dried up all the rain and the itsy bitsy spider went up the spout again!',
        () => { if (this.active) cb(); });
    };
    beatClimb();
  },
  // EXPOSE demo: the spider climbs the spout (narrated by line 1), then advances
  spoutDemoClimb(cb){
    const g = this.spoutGeom(); if (!g){ cb(); return; }
    const bug = g.stage.querySelector('[data-el="bug"]');
    const rec = this.curRecord, live = () => this.active && this.curRecord === rec;
    if (bug){ bug.style.zIndex = '4'; setTimeout(() => { if (live()) this.climbSpider(bug, g.cx, g.base, g.top, 4100); }, 350); }
    Audio2.speak('The itsy bitsy spider went up the water spout!', () => { if (live()) cb(); });
  },
  // CONTRAST demo: rain falls, the spider washes DOWN the spout then out (line 2)
  spoutDemoWash(cb){
    const g = this.spoutGeom(); if (!g){ cb(); return; }
    const bug = g.stage.querySelector('[data-el="bug"]');
    const cloud = g.stage.querySelector('[data-el="cloud"]');
    const rec = this.curRecord, live = () => this.active && this.curRecord === rec;
    if (cloud) cloud.classList.add('raining');
    this.startRain(g.cx);
    if (bug){
      setTimeout(() => {   // wash down the spout
        if (!live()) return;
        bug.style.transition = 'top 1.6s ease-in'; bug.style.top = g.base + '%';
      }, 1200);
      setTimeout(() => {   // then out the bottom
        if (!live()) return;
        bug.style.transition = 'top .8s ease-in, left .8s ease-in, opacity .8s ease-in';
        bug.style.top = g.out + '%'; bug.style.left = (g.cx + (g.cx > 50 ? -1 : 1) * 24) + '%'; bug.style.opacity = '0';
      }, 3000);
    }
    Audio2.speak('Down came the rain and washed the spider out!', () => { this.stopRain(); if (live()) cb(); });
  },
  // cause → effect: press the button → fireworks. `cb` runs after the burst.
  fireBurst(){
    const stage = this.stage(); if (!stage) return;
    const sr = stage.getBoundingClientRect();
    Audio2.fanfare();
    FX.confetti();
    [0.28, 0.5, 0.72, 0.4, 0.6].forEach((fx, i) =>
      setTimeout(() => FX.burst(sr.left + sr.width * fx, sr.top + sr.height * (0.18 + Math.random() * 0.22)), i * 170));
  },
  // a tap on the target plays a little effect (touch → something happens), then
  // completes. Used by the Intro taps and the causality buttons.
  tapReward(el, kind, x, y){
    this.locked = true;
    let delay = 1400;
    if (kind === 'button'){
      if (el){ el.classList.add('btn-down'); setTimeout(() => el && el.classList.remove('btn-down'), 260); }
      this.fireBurst();   // the fireworks and fanfare ARE the effect — the
      // trial's praise line follows on its own; a spoken cheer here made two
      delay = 1500;
    } else if (kind === 'bubble'){
      if (el){ el.classList.add('bub-pop'); }
      FX.burst(x, y, ['#8fd3ff', '#bfe9ff', '#ffffff', '#5bb8ec']);
      Audio2.speak('Pop!');   // curated "Pop" clip (pop.mp3) via CLIP_MAP
      delay = 900;
    } else if (kind === 'spider'){
      if (el){ el.classList.add('scurry'); setTimeout(() => el && el.classList.remove('scurry'), 900); }
      Audio2.snapSnd(); Audio2.speak('Wheee!');
      delay = 1100;
    } else if (kind === 'cuckoo'){
      if (el){ el.classList.remove('cuckoo-out'); void el.offsetWidth; el.classList.add('cuckoo-out'); }
      Audio2.speak('Cuckoo!');   // curated cuckoo clip
      delay = 1300;
    } else if (kind === 'letter'){
      // the magnet hops off the board and names itself
      if (el){ el.classList.remove('mag-pop'); void el.offsetWidth; el.classList.add('mag-pop'); }
      Audio2.snapSnd();
      Audio2.speak(el && el.dataset.letter ? sayGlyph(el.dataset.letter) : 'Yes!');
      delay = 1250;
    } else if (kind === 'box'){
      if (el){ el.classList.remove('box-open'); void el.offsetWidth; el.classList.add('box-open'); }
      Audio2.speak('Open them, shut them!');   // curated "Open, shut them" clip
      delay = 2100;
    } else {
      FX.burst(x, y);
    }
    setTimeout(() => { this.locked = false; this.completeTrial(true, { at:[x, y] }); }, delay);
  },
  // one shower burst: drops fall from the cloud's base to the spout's base,
  // measured in stage pixels so the fall lands correctly at any size
  rainBurst(cxPct){
    const stage = this.stage();
    const sr = stage.getBoundingClientRect();
    const dist = ((72 - 30) / 100 * sr.height).toFixed(0) + 'px';   // cloud base → spout base
    for (let i = 0; i < 16; i++){
      const d = document.createElement('span');
      d.className = 'raindrop';
      d.style.left = (cxPct + (Math.random()*14 - 7)) + '%';
      d.style.top = '30%';
      d.style.setProperty('--rain-dist', dist);
      d.style.animationDelay = (Math.random()*0.6).toFixed(2) + 's';
      d.style.animationDuration = (0.55 + Math.random()*0.2).toFixed(2) + 's';
      stage.appendChild(d);
      setTimeout(() => d.remove(), 1700);
    }
  },
  startRain(cxPct){
    this.stopRain();
    this.rainBurst(cxPct);
    this.rainTimer = setInterval(() => {
      if (!this.active){ this.stopRain(); return; }
      this.rainBurst(cxPct);
    }, 820);
  },
  stopRain(){
    if (this.rainTimer){ clearInterval(this.rainTimer); this.rainTimer = 0; }
  },

  speakPrompt(force){
    if (!this.active || !this.cur) return;
    // a reference sample ("same as this") pulses while the prompt names it
    const sc = this.stage().querySelector('.sample-card');
    if (sc){ sc.classList.add('pulse'); setTimeout(() => sc.classList.remove('pulse'), 2600); }
    // annoyance cap: never auto-repeat the same prompt more than 3 times;
    // the speaker button (force) always speaks — that's an explicit request
    if (!force && this.promptSpeaks >= 3){
      if (!this.promptEndAt) this.promptEndAt = Date.now();
      return;
    }
    this.promptSpeaks++;
    // a trial can tie beats to elements (`beatEls`); each one hops as it is named
    const onBeat = i => {
      const id = (this.cur.beatEls || [])[i];
      if (id) this.bounceEl(id);
    };
    if (this.promptEndAt){
      Audio2.speak(this.cur.say, null, onBeat);
    } else {
      Audio2.speak(this.cur.say, () => {
        if (!this.promptEndAt) this.promptEndAt = Date.now();
        this.armTimers();
      }, onBeat);
    }
  },

  armTimers(){
    if (!this.active) return;   // speech onend after exit must not re-arm
    clearTimeout(this.timeoutTimer); clearTimeout(this.autoTimer);
    if (this.cur.kind === 'watch'){
      this.autoTimer = setTimeout(() => this.completeTrial(true, {silent:true}), this.cur.autoMs);
    } else if (!this.locked){
      this.timeoutTimer = setTimeout(() => this.onTimeout(), this.cur.timeoutMs);
    }
  },

  renderTrial(){
    const stage = this.stage();
    this.stopRain();
    stage.innerHTML = '';
    let rainAt = null;
    for (const spec of this.cur.elements){
      let el;
      if (spec.zone){
        el = document.createElement('button');
        el.className = 'zone-card appear';
        el.innerHTML = spec.html;
      } else {
        el = document.createElement(spec.tappable ? 'button' : 'div');
        el.className = 'el appear' + (spec.tappable ? ' tappable' : '');
        el.innerHTML = spec.html;
      }
      el.dataset.el = spec.id;
      if (spec.target) el.dataset.target = '1';
      if (spec.piece) el.dataset.piece = '1';
      if (spec.letter) el.dataset.letter = spec.letter;
      el.style.left = spec.x+'%'; el.style.top = spec.y+'%';
      el.style.setProperty('--s', spec.s);
      // a surface (the magnet board) is sized in % of the STAGE, not vmin, so
      // it fills the play area on any screen instead of staying square
      if (spec.board) el.classList.add('magnet-board');
      if (spec.wPct) el.style.width = spec.wPct + '%';
      if (spec.hPct) el.style.height = spec.hPct + '%';
      if (spec.ring) el.style.filter = 'drop-shadow(0 0 8px rgba(61,139,255,.55))';
      if (spec.sampleCard) el.classList.add('sample-card');
      if (spec.groundBar) el.classList.add('ground-bar');
      if (spec.decor) el.style.opacity = '.85';
      if (spec.cls) el.classList.add(spec.cls);
      if (spec.raining){ el.classList.add('raining'); rainAt = spec.x; }
      if ((this.cur.kind === 'drag' || this.cur.kind === 'stack') && spec.piece) el.classList.add('painted-hit');
      // tappable art inside an oversized box (a garment waiting in the tray):
      // only the drawn cloth should answer a tap, or the invisible box would
      // swallow taps meant for its neighbour
      if (spec.paintedHit) el.classList.add('painted-hit');
      if (spec.looseArt){
        el.classList.add('dress-loose');
        el.style.setProperty('--ox', spec.looseArt.ox);
        el.style.setProperty('--oy', spec.looseArt.oy);
      }
      stage.appendChild(el);
    }
    if (this.cur.stackScene) this.layoutStack();
    // a cloud flagged raining actually rains (e.g. the contrast demo)
    if (rainAt != null) this.startRain(rainAt);
  },

  /* px-precise vertical alignment for stacking scenes (positions are % of the
     stage; block sizes are vmin — only px math can seat blocks exactly) */
  stackFloorY(){
    const sr = this.stage().getBoundingClientRect();
    return sr.top + sr.height * 0.80;
  },
  layoutStack(){
    // sizes derived from --s (vmin), never from rects — the appear animation
    // scales elements to 0 at render time, so rect math would misplace them
    const stage = this.stage();
    const sr = stage.getBoundingClientRect();
    const vmin = Math.min(window.innerWidth, window.innerHeight) / 100;
    const px = id => {
      const spec = this.cur.elements.find(e => e.id === id);
      return spec ? spec.s * vmin : 0;
    };
    const floorRel = sr.height * 0.80;
    const g = stage.querySelector('[data-el="ground"]');
    if (g){
      const barH = px('ground') * 0.12;
      g.style.top = (floorRel + barH/2) + 'px';
    }
    // rest map: id → 'floor' or the id of the element it sits on (towers chain)
    const rest = this.cur.stackScene.rest;
    const centers = {};
    for (const id of Object.keys(rest)){
      const el = stage.querySelector(`[data-el="${id}"]`);
      if (!el) continue;
      const h = px(id);
      const on = rest[id];
      const bottom = (on !== 'floor' && centers[on] !== undefined)
        ? centers[on] - px(on)/2
        : floorRel;
      centers[id] = bottom - h/2;
      el.style.top = centers[id] + 'px';
    }
  },

  /* ---------- pointer input ----------
     On a tablet a toddler's spare fingers and the heel of their hand rest on
     the glass constantly, and the two gestures need OPPOSITE rules about it.

     A DRAG is owned by one pointer from pickup to release. Any pointerup used
     to end it, so a second finger lifting dropped the piece the first was
     still holding, and a second pointerdown could hijack it onto another piece.

     A TAP must NOT be restricted that way. "Primary" means the first finger
     down, so a hand already resting on the screen makes every real tap
     non-primary — rejecting those made the app go dead exactly when a child is
     leaning on it. Any finger may tap. What gets filtered instead is the thing
     multi-touch actually causes: several contacts landing at once (a palm, a
     grab) counting as several taps. The first one inside TAP_GAP wins and the
     rest are dropped, because contacts from one clumsy hand arrive together
     while deliberate taps do not. */
  onPointerDown(e){
    if ($('#view-play').classList.contains('hidden')) return;
    if (this.drag) return;   // a drag owns the gesture until it ends
    Audio2.unlock();
    const stage = this.stage();
    const now = Date.now();
    const sr = stage.getBoundingClientRect();
    const x = e.clientX - sr.left, y = e.clientY - sr.top;

    // drag pickup? (a non-primary finger may start one — see above)
    if (this.cur && (this.cur.kind === 'drag' || this.cur.kind === 'stack') && !this.locked){
      const pieceEl = this.hitPiece(e.clientX, e.clientY);
      if (pieceEl){ this.beginDrag(pieceEl, e, x, y, now); return; }
    }
    if (!this.cur || this.locked) { return; }
    // contacts from one hand land within a few ms of each other; a child
    // tapping twice on purpose never does
    if (now - (this.lastTapAt || 0) < TAP_GAP) return;
    this.lastTapAt = now;

    const hit = e.target.closest ? e.target.closest('[data-el]') : null;
    const hitId = hit ? hit.dataset.el : null;
    const isTarget = !!(hit && hit.dataset.target);
    const interactiveTrial = this.cur.kind === 'tap' || this.cur.kind === 'hideseek'
      || this.cur.kind === 'tapplace';
    const md = this.missDistance(e.clientX, e.clientY);

    Telemetry.event({
      trialId: this.curRecord.id, timestamp: now, type:'TAP',
      coordinateX: Math.round(x), coordinateY: Math.round(y),
      hitElementId: hitId, isCorrectIntent: interactiveTrial && isTarget,
      timeSincePromptMs: this.promptEndAt ? now - this.promptEndAt : null,
      missDistancePx: md,
    });

    if (!interactiveTrial){
      // watch/drag states: taps are unproductive except drag pickups (handled above)
      this.frustration(now, true);
      return;
    }

    // the heel of a hand on empty board is not a choice, so it is not an answer
    // and not a miss: counting it drove the fallback and the frustration
    // detector while the child had not answered at all. Recorded above,
    // otherwise ignored.
    if (!hit) return;

    if (this.curRecord.firstAttemptCorrect === null)
      this.curRecord.firstAttemptCorrect = isTarget;

    if (isTarget){
      this.frustration(now, false);
      if (this.cur.kind === 'tapplace'){ this.flyToSpot(hit); return; }
      if (this.cur.kind === 'hideseek') this.revealUnder(hit);
      else if (this.cur.tapFx){ this.tapReward(hit, this.cur.tapFx, e.clientX, e.clientY); return; }
      this.completeTrial(true, {at:[e.clientX, e.clientY]});
    } else {
      this.frustration(now, true);
      this.wrongCount++;
      if (this.cur.kind === 'hideseek'){
        // wrong stack: an "uh-oh" clip (debounced so rapid taps don't spam it)
        // and lift the tapped cover to show the empty space underneath
        if (!this.lastUhOh || now - this.lastUhOh > 1200){ Audio2.sfx('uh_oh.mp3'); this.lastUhOh = now; }
        if (hit && hit.dataset.el && hit.dataset.el.startsWith('cover')){
          hit.classList.add('hs-lift');
          setTimeout(() => hit.classList.remove('hs-lift'), 750);
        }
      } else {
        Audio2.wrong();
        if (hit){ hit.classList.remove('wobble'); void hit.offsetWidth; hit.classList.add('wobble'); }
      }
      this.trackIsoMiss(hitId);
      if (this.wrongCount >= 2 && !this.usedFallback) this.applyFallback();
    }
  },

  /* For DDA 1.4 → 1.2/1.3 routing: record which isolation levels get missed */
  trackIsoMiss(){
    if (!this.level) return;
    if (this.level.id === '1.2' || this.level.id === '1.3'){
      const np = nodeProgress(this.node.key);
      np.isoStats[this.level.id] = (np.isoStats[this.level.id]||0) + 1;
      saveNodeProgress(this.node.key, np);
    }
  },

  missDistance(cx, cy){
    const t = this.stage().querySelector('[data-target]') ||
              (this.cur.kind==='drag' ? this.stage().querySelector(`[data-el="${this.cur.pieces[0].slot}"]`) : null);
    if (!t) return null;
    const r = t.getBoundingClientRect();
    const dx = Math.max(r.left - cx, 0, cx - r.right);
    const dy = Math.max(r.top - cy, 0, cy - r.bottom);
    return Math.round(Math.hypot(dx, dy));
  },

  /* ---------- drag & drop ---------- */
  hitPiece(cx, cy){
    const els = document.elementsFromPoint(cx, cy);
    for (const n of els){
      const owner = n.closest ? n.closest('[data-piece]') : null;
      if (owner && !owner.classList.contains('placed')) return owner;
    }
    // generous fallback: bounding-box hit on unplaced pieces (toddler fingers).
    // Uses the declared --s size so a mid-animation (scaled) rect still hits.
    const vmin = Math.min(window.innerWidth, window.innerHeight) / 100;
    for (const p of this.stage().querySelectorAll('[data-piece]:not(.placed)')){
      const r = p.getBoundingClientRect();
      const spec = this.cur.elements.find(el => el.id === p.dataset.el);
      const half = Math.max(r.width, spec ? spec.s * vmin : 0)/2 + 8;
      const px = r.left + r.width/2, py = r.top + r.height/2;
      if (Math.abs(cx - px) < half && Math.abs(cy - py) < half) return p;
    }
    return null;
  },

  beginDrag(pieceEl, e, x, y, now){
    this.stopPhysics();                            // grabbing a falling block is allowed
    pieceEl.style.transform = '';
    const pr = pieceEl.getBoundingClientRect();
    this.drag = {
      el: pieceEl, id: pieceEl.dataset.el, pointerId: e.pointerId,
      dx: (pr.left + pr.width/2) - e.clientX,
      dy: (pr.top + pr.height/2) - e.clientY,
      vx: 0, vy: 0, hist: { x: e.clientX, y: e.clientY, t: performance.now() },
    };
    // capture keeps the move/up stream bound to this finger even if it strays
    // over another element or leaves the stage
    try { this.stage().setPointerCapture(e.pointerId); } catch(err){}
    pieceEl.classList.add('dragging');
    pieceEl.classList.remove('returning','snapping');
    // stacking: lifting a block carries everything stacked on top of it
    if (this.cur.kind === 'stack'){
      const id = pieceEl.dataset.el;
      const kids = [];
      const collect = pid => {
        for (const [c, sup] of Object.entries(this.stackOn))
          if (sup === pid){ kids.push(c); collect(c); }
      };
      collect(id);
      delete this.stackOn[id];
      const stage = this.stage();
      const pc = pieceEl.getBoundingClientRect();
      this.drag.group = kids.map(k => {
        const el2 = stage.querySelector(`[data-el="${k}"]`);
        const r2 = el2.getBoundingClientRect();
        return { id: k, el: el2,
          dx: (r2.left + r2.width/2) - (pc.left + pc.width/2),
          dy: (r2.top + r2.height/2) - (pc.top + pc.height/2) };
      });
    }
    Telemetry.event({
      trialId: this.curRecord.id, timestamp: now, type:'DRAG_START',
      coordinateX: Math.round(x), coordinateY: Math.round(y),
      hitElementId: this.drag.id, isCorrectIntent: true,
      timeSincePromptMs: this.promptEndAt ? now - this.promptEndAt : null,
      missDistancePx: null,
    });
    this.frustration(now, false);
  },

  onPointerMove(e){
    if (!this.drag || e.pointerId !== this.drag.pointerId) return;
    const d = this.drag;
    const now = performance.now();
    const dt = (now - d.hist.t) / 1000;
    if (dt > 0){
      // exponentially-smoothed gesture velocity: event bursts (coalesced
      // pointer moves) barely register; sustained motion dominates
      const a = clamp(dt / 0.05, 0, 1);
      d.vx = d.vx * (1 - a) + ((e.clientX - d.hist.x) / dt) * a;
      d.vy = d.vy * (1 - a) + ((e.clientY - d.hist.y) / dt) * a;
      d.hist = { x: e.clientX, y: e.clientY, t: now };
    }
    const sr = this.stage().getBoundingClientRect();
    const cx = e.clientX + d.dx, cy = e.clientY + d.dy;
    d.el.style.left = ((cx - sr.left)/sr.width*100)+'%';
    d.el.style.top  = ((cy - sr.top)/sr.height*100)+'%';
    for (const g of d.group || []){
      g.el.style.left = ((cx + g.dx - sr.left)/sr.width*100)+'%';
      g.el.style.top  = ((cy + g.dy - sr.top)/sr.height*100)+'%';
    }
    this.updateWarmth(d);
  },

  /* "warmer… warmer… hot" — the spot a piece belongs in grows as the piece
     nears it. A toddler cannot judge an invisible snap radius; this makes the
     radius something they can SEE while their finger is still down, so a near
     miss becomes a small correction instead of a failed drop.

     It wakes up about ONE PIECE-HEIGHT out from the snap edge — near enough to
     read as a response to this drop rather than ambient movement — and grows
     smoothly to full inside the snap radius. Smoothstep, so it eases in rather
     than jumping the moment it comes into range, and no pulsing: a target that
     bounces is harder to aim at, not easier. */
  updateWarmth(d){
    if (!this.cur || this.cur.kind !== 'drag' || !this.cur.pieces) return;
    const spec = this.cur.pieces.find(p => p.el === d.id);
    if (!spec) return;
    const stage = this.stage(), sr = stage.getBoundingClientRect();
    const slot = stage.querySelector(`[data-el="${spec.slot}"]`);
    if (!slot) return;
    const pr = d.el.getBoundingClientRect(), slr = slot.getBoundingClientRect();
    const scx = slr.left + slr.width/2 + (spec.slotDx||0)*sr.width/100;
    const scy = slr.top + slr.height/2 + (spec.slotDy||0)*sr.height/100;
    const dist = Math.hypot(pr.left + pr.width/2 - scx, pr.top + pr.height/2 - scy);
    const vmin = Math.min(window.innerWidth, window.innerHeight) / 100;
    const snapPx = (spec.snapBoost || spec.snap) * vmin;
    // the piece's DECLARED size, not its rect — mid-animation rects lie
    const el = this.cur.elements.find(e2 => e2.id === d.id);
    const sizePx = ((el && el.s) || 16) * vmin;
    const onset = snapPx + sizePx;
    let t = clamp((onset - dist) / (onset - snapPx), 0, 1);
    t = t * t * (3 - 2 * t);
    slot.style.setProperty('--warm', t.toFixed(3));
    slot.classList.toggle('warm', t > 0.004);
  },
  clearWarmth(){
    for (const n of this.stage().querySelectorAll('.warm')){
      n.classList.remove('warm');
      n.style.removeProperty('--warm');
    }
  },

  /* The browser took the gesture away (a second finger starting a system
     gesture, an edge swipe, the app backgrounding). Set the piece down where
     the hand left it and score nothing — the child made no mistake. */
  onPointerCancel(e){
    if (!this.drag || e.pointerId !== this.drag.pointerId) return;
    const d = this.drag; this.drag = null;
    d.el.classList.remove('dragging');
    this.clearWarmth();
    try { this.stage().releasePointerCapture(e.pointerId); } catch(err){}
    if (this.cur && this.cur.kind === 'stack'){ this.startStackPhysics(d); return; }
    d.el.style.left = clamp(parseFloat(d.el.style.left), 4, 96)+'%';
    d.el.style.top = clamp(parseFloat(d.el.style.top), 6, 94)+'%';
  },

  onPointerUp(e){
    if (!this.drag || e.pointerId !== this.drag.pointerId) return;
    const d = this.drag; this.drag = null;
    d.el.classList.remove('dragging');
    this.clearWarmth();
    try { this.stage().releasePointerCapture(e.pointerId); } catch(err){}
    if (this.cur.kind === 'stack'){ this.startStackPhysics(d); return; }
    const sr = this.stage().getBoundingClientRect();
    const now = Date.now();
    const spec = this.cur.pieces.find(p => p.el === d.id);
    const slotEl = this.stage().querySelector(`[data-el="${spec.slot}"]`);
    const pr = d.el.getBoundingClientRect();
    const pcx = pr.left + pr.width/2, pcy = pr.top + pr.height/2;
    const slr = slotEl.getBoundingClientRect();
    const scx = slr.left + slr.width/2 + (spec.slotDx||0)*sr.width/100;
    const scy = slr.top + slr.height/2 + (spec.slotDy||0)*sr.height/100;
    const dist = Math.hypot(pcx-scx, pcy-scy);
    const snapPx = (spec.snapBoost || spec.snap) * Math.min(window.innerWidth, window.innerHeight) / 100;
    let ok = dist <= snapPx;
    // open-topped containers: releasing above the mouth counts — the piece
    // then visibly drops in, like letting a ball go over a jar
    let fellIn = false;
    if (!ok && spec.dropIn){
      const slotSpec = this.cur.elements.find(el => el.id === spec.slot);
      const slotPx = ((slotSpec||{}).s || 0) * Math.min(window.innerWidth, window.innerHeight) / 100;
      const mouthHalf = Math.max(slr.width, slotPx) * 0.38;
      const above = scy - pcy;
      if (Math.abs(pcx - scx) <= mouthHalf && above > 0 && above < Math.max(slr.height, slotPx) * 2.2){
        ok = true; fellIn = true;
      }
    }

    Telemetry.event({
      trialId: this.curRecord.id, timestamp: now, type:'DRAG_END',
      coordinateX: Math.round(pcx - sr.left), coordinateY: Math.round(pcy - sr.top),
      hitElementId: ok ? spec.slot : null, isCorrectIntent: ok,
      timeSincePromptMs: this.promptEndAt ? now - this.promptEndAt : null,
      missDistancePx: ok ? 0 : Math.max(0, Math.round(dist - snapPx)),
    });

    if (this.curRecord.firstAttemptCorrect === null)
      this.curRecord.firstAttemptCorrect = ok;

    if (ok){
      // snap into place (or fall in, for a release above an open container)
      d.el.classList.add(fellIn ? 'fall-in' : 'snapping', 'placed');
      d.el.style.left = ((scx - sr.left)/sr.width*100)+'%';
      d.el.style.top = ((scy - sr.top)/sr.height*100)+'%';
      // cause → effect: placing the bug triggers the climb-rain-washout sequence
      if (spec.causeEffect){
        this.locked = true;   // block further input during the ~3s animation
        this.spoutCauseEffect(d.el, slotEl, () => {
          // the animation locked input; release it so completeTrial (which
          // early-returns while locked) can actually finish and advance
          this.locked = false;
          this.completeTrial(true, {at:[scx, scy]});
        });
        return;
      }
      const finish = () => {
        Audio2.snapSnd();
        const allPlaced = this.cur.pieces.every(p =>
          this.stage().querySelector(`[data-el="${p.el}"]`).classList.contains('placed'));
        // a magnet doesn't just arrive — it jumps the last millimetre and
        // thunks flat against the steel
        if (spec.magnet){
          d.el.classList.add('mag-snap');
          Audio2.clack(0.3);
          // name it as it lands (not on the last one — the praise clip follows
          // immediately there and would cut the letter off)
          if (!allPlaced && d.el.dataset.letter) Audio2.speak(sayGlyph(d.el.dataset.letter));
        }
        if (allPlaced) this.completeTrial(true, {at:[scx, scy]});
      };
      if (fellIn) setTimeout(finish, 330); else finish();
    } else {
      Audio2.wrong();
      this.wrongCount++;
      // objects are real: the piece stays where it was set down (clamped to
      // the stage), so the child can work toward the goal incrementally
      // instead of watching it zap back and starting over
      d.el.style.left = clamp(parseFloat(d.el.style.left), 4, 96)+'%';
      d.el.style.top = clamp(parseFloat(d.el.style.top), 6, 94)+'%';
      if (this.wrongCount >= 2 && !this.usedFallback) this.applyFallback();
    }
  },

  /* ---------- stacking physics (a 2-inch wood cube, for real) ---------- */
  stopPhysics(){
    cancelAnimationFrame(this.physRAF);
    clearTimeout(this.physTimer);
  },
  startStackPhysics(d){
    this.stopPhysics();
    const stage = this.stage();
    const sr = stage.getBoundingClientRect();
    const el = d.el;
    const pr = el.getBoundingClientRect();
    // geometry from declared --s sizes and rect CENTERS — rect extents lie
    // mid-animation (scale(0) would zero out gravity and the contact band)
    const vmin = Math.min(window.innerWidth, window.innerHeight) / 100;
    const specOf = id => this.cur.elements.find(s2 => s2.id === id);
    const size = ((specOf(d.id)||{}).s * vmin) || pr.width;
    const PX_M = size / 0.0508;        // the block IS 5.08 cm — px-per-meter from that
    const G = 9.81 * PX_M;             // gravity in px/s²
    const REST = 0.32;                 // wood-on-wood restitution: a clack, barely a bounce
    const V_SETTLE = 0.35 * PX_M;      // below ~0.35 m/s an impact just settles
    const floorY = this.stackFloorY();
    const vcap = 1.5 * PX_M;           // a toddler toss tops out around 1.5 m/s

    // every stack element outside the carried group is a candidate surface;
    // the landing surface at a given x is the HIGHEST overlapping candidate
    const groupIds = [d.id, ...((d.group || []).map(g => g.id))];
    const cands = this.cur.elements.filter(e2 =>
      (e2.piece || e2.id === 'base') && !groupIds.includes(e2.id));
    const surface = c => {
      const el2 = stage.querySelector(`[data-el="${c.id}"]`);
      if (!el2) return null;
      const r2 = el2.getBoundingClientRect();
      const cs = (c.s * vmin) || r2.width;
      const cx0 = r2.left + r2.width/2;
      return { id: c.id, cx: cx0, width: cs,
        left: cx0 - cs/2, right: cx0 + cs/2,
        top: (r2.top + r2.height/2) - cs/2 };
    };
    const surfaceAt = x => {
      let best = null;
      for (const c of cands){
        const sfc = surface(c);
        if (!sfc) continue;
        if (x + size/2 > sfc.left + 2 && x - size/2 < sfc.right - 2 &&
            (!best || sfc.top < best.top)) best = sfc;
      }
      return best;
    };
    const nearestGapX = x => {
      let gap = Infinity;
      for (const c of cands){
        const sfc = surface(c);
        if (sfc) gap = Math.min(gap, Math.abs(x - sfc.cx) - sfc.width/2);
      }
      return gap === Infinity ? null : Math.max(0, Math.round(gap));
    };

    // a hand that held still before letting go imparts no toss — only count
    // gesture velocity if the pointer was moving right up to the release
    const idleMs = d.hist ? performance.now() - d.hist.t : Infinity;
    const toss = idleMs <= 100 ? 1 : 0;
    const st = {
      x: pr.left + pr.width/2, y: pr.top + pr.height/2,
      vx: clamp((d.vx || 0) * toss, -vcap, vcap), vy: clamp((d.vy || 0) * toss, -vcap, vcap),
      ang: 0, va: 0, pa: 0, pa0: 0, dir: 1, pivotX: 0, r: size * Math.SQRT1_2,
      sup: null, mode: 'fall', bounces: 0,
    };
    // released while sunk into a surface from the side: shove out to the near edge
    const s0 = surfaceAt(st.x);
    if (s0 && st.y + size/2 > s0.top + 4 && st.y > s0.top){
      st.x = (st.x < s0.cx) ? s0.left - size/2 - 1 : s0.right + size/2 + 1;
    }

    const paint = () => {
      el.style.left = (st.x - sr.left) + 'px';
      el.style.top  = (st.y - sr.top) + 'px';
      el.style.transform = `translate(-50%,-50%) rotate(${st.ang}deg)`;
      for (const g of d.group || []){
        g.el.style.left = (st.x + g.dx - sr.left) + 'px';
        g.el.style.top  = (st.y + g.dy - sr.top) + 'px';
        g.el.style.transform = `translate(-50%,-50%) rotate(${st.ang}deg)`;
      }
    };

    const settle = onBase => {
      this.stopPhysics();
      st.mode = 'done';
      st.ang = 0; paint();
      el.style.transform = '';
      for (const g of d.group || []) g.el.style.transform = '';
      const now = Date.now();
      Telemetry.event({
        trialId: this.curRecord.id, timestamp: now, type:'DRAG_END',
        coordinateX: Math.round(st.x - sr.left), coordinateY: Math.round(st.y - sr.top),
        hitElementId: onBase ? st.sup.id : null, isCorrectIntent: onBase,
        timeSincePromptMs: this.promptEndAt ? now - this.promptEndAt : null,
        missDistancePx: onBase ? 0 : nearestGapX(st.x),
      });
      if (this.curRecord.firstAttemptCorrect === null) this.curRecord.firstAttemptCorrect = onBase;
      if (onBase){
        // record who rests on whom; success = every stack element in ONE
        // stack, regardless of the order it was built in
        this.stackOn[d.id] = st.sup.id;
        const stackIds = this.cur.elements
          .filter(e2 => e2.piece || e2.id === 'base').map(e2 => e2.id);
        const rootOf = id0 => {
          let cur0 = id0, g0 = 0;
          while (this.stackOn[cur0] && g0++ < 12) cur0 = this.stackOn[cur0];
          return cur0;
        };
        if (new Set(stackIds.map(rootOf)).size === 1){
          this.completeTrial(true, {at:[st.x, st.y]});
        } else {
          Audio2.correct();
          FX.burst(st.x, st.y);
        }
      } else {
        this.wrongCount++;
        if (this.wrongCount >= 2 && !this.usedFallback) this.applyFallback();
      }
    };

    // one physics substep; returns true once the block has settled
    const step = dt => {
      if (st.mode === 'fall'){
        st.vy += G * dt;
        st.x += st.vx * dt; st.y += st.vy * dt;
        st.vx *= (1 - 0.4*dt);
        st.ang += st.va * dt;
        const bottom = st.y + size/2;
        const sup = surfaceAt(st.x);

        if (st.vy > 0 && sup && bottom >= sup.top && st.y < sup.top){
          st.sup = sup;
          const relX = st.x - sup.cx;
          const overhang = Math.abs(relX) + size/2 - sup.width/2;
          st.y = sup.top - size/2;
          if (st.vy > 0.15*PX_M) Audio2.clack(Math.min(1, st.vy / PX_M));
          if (overhang < size*0.12){
            // (near-)fully supported face landing: bounce once, then rest
            if (st.vy > V_SETTLE && st.bounces < 2){ st.vy = -REST * st.vy; st.bounces++; }
            else { settle(true); return true; }
          } else {
            // partial contact → pivot on the surface's edge corner.
            // CoM inside the edge rocks and settles; outside, it rolls off.
            st.mode = 'pivot';
            st.dir = relX < 0 ? -1 : 1;
            st.pivotX = st.dir === -1 ? sup.left : sup.right;
            const dxOut = (st.x - st.pivotX) * st.dir;   // + outside, − inside
            st.r = Math.hypot(dxOut, size/2);
            st.pa0 = Math.atan2(dxOut, size/2);          // face-flat angle from vertical
            st.pa = st.pa0;
            st.va = clamp(st.vy * Math.max(overhang, 8) / (size*size), 0.15, 2.4);
          }
        } else if (bottom >= floorY){
          st.y = floorY - size/2;
          if (st.vy > 0.15*PX_M) Audio2.clack(Math.min(1, st.vy / PX_M));
          if (st.vy > V_SETTLE && st.bounces < 2){
            st.vy = -REST * st.vy; st.vx *= 0.5; st.bounces++;
          } else if (Math.abs(st.ang % 90) > 2){
            st.ang *= 0.6; st.va = 0;
          } else {
            settle(false); return true;
          }
        }
      } else if (st.mode === 'pivot'){
        // rigid-body rotation about the support edge:
        // α = m·g·r·sinφ / I_edge,  I_edge = m(a²/6 + r²),  φ from vertical
        const I = size*size/6 + st.r*st.r;
        st.va += (G * st.r * Math.sin(st.pa) / I) * dt;
        st.pa += st.va * dt;
        if (st.pa <= st.pa0 && st.va < 0){
          // face slaps back down flat — rocking decays like real wood
          st.pa = st.pa0;
          if (Math.abs(st.va) > 0.5){ st.va = -0.35 * st.va; Audio2.clack(0.18); }
          else { settle(true); return true; }
        }
        st.x = st.pivotX + st.dir * st.r * Math.sin(st.pa);
        st.y = st.sup.top - st.r * Math.cos(st.pa);
        st.ang = st.dir * (st.pa - st.pa0) * 180/Math.PI;
        if (st.pa > 1.35){
          // rolled past the corner — off it goes
          st.mode = 'fall';
          st.vx = st.dir * st.va * st.r * Math.cos(st.pa);
          st.vy = Math.max(st.va * st.r * Math.sin(st.pa), 0.15*PX_M);
          st.va = st.dir * st.va * 180/Math.PI * 0.6;
          st.bounces = 0;
        }
      }
      return false;
    };

    // Each tick simulates the REAL elapsed time in collision-safe substeps, so
    // the outcome is identical at 60fps and under heavy timer throttling.
    let last = performance.now();
    const schedule = () => {
      this.physRAF = requestAnimationFrame(tick);
      this.physTimer = setTimeout(tick, 40);
    };
    const tick = () => {
      cancelAnimationFrame(this.physRAF);
      clearTimeout(this.physTimer);
      loop();
    };
    const loop = () => {
      if (st.mode === 'done') return;
      const now = performance.now();
      let elapsed = Math.min((now - last)/1000, 1.5); last = now;
      let done = false, guard = 0;
      while (elapsed > 0 && !done && guard++ < 400){
        const dt = Math.min(elapsed, 1/90, 20/Math.max(Math.abs(st.vy), Math.abs(st.vx), 1));
        done = step(dt);
        elapsed -= dt;
      }
      if (!done){ paint(); schedule(); }
    };
    this.physTick = loop;   // test-harness hook: pump the sim without timers
    schedule();
  },

  /* ---------- timeout, fallback, frustration ---------- */
  onTimeout(){
    if (!this.active || this.locked || !this.cur) return;
    const now = Date.now();
    Telemetry.event({
      trialId: this.curRecord.id, timestamp: now, type:'TIMEOUT',
      coordinateX: null, coordinateY: null, hitElementId: null,
      isCorrectIntent: false,
      timeSincePromptMs: this.promptEndAt ? now - this.promptEndAt : null,
      missDistancePx: null,
    });
    if (this.curRecord.firstAttemptCorrect === null) this.curRecord.firstAttemptCorrect = false;
    if (!this.usedFallback) this.applyFallback();
    else this.hintPulse();
    // repeat the prompt at most 3 times, with exponential backoff between
    // repeats — after that, only the speaker button repeats it
    this.hintCount++;
    if (this.hintCount < 3){
      this.timeoutTimer = setTimeout(() => this.onTimeout(),
        this.cur.timeoutMs * Math.pow(1.5, this.hintCount));
    }
  },

  onFrustration(){
    if (!this.usedFallback) this.applyFallback();
  },

  /* Tapped: the letter flies to its own spot and clicks on. Every letter has a
     spot, so nothing here is a wrong answer — the trial finishes when the last
     one lands. Tapping a letter already home just says its name again, which
     is the whole word available on demand rather than a dead tap. */
  flyToSpot(el){
    const spec = (this.cur.places || []).find(p => p.el === el.dataset.el);
    if (!spec) return;
    const stage = this.stage();
    if (el.classList.contains('placed')){
      if (el.dataset.letter) Audio2.speak(sayGlyph(el.dataset.letter));
      return;
    }
    const slot = stage.querySelector(`[data-el="${spec.slot}"]`);
    if (!slot) return;
    el.classList.add('placed', 'flying');
    // a tray copy is the worn artwork pushed off-centre; letting that go IS the
    // animation — the garment slides onto the body in one move
    el.classList.remove('dress-loose');
    el.style.left = slot.style.left;
    el.style.top = slot.style.top;
    if (el.dataset.letter) Audio2.speak(sayGlyph(el.dataset.letter));
    setTimeout(() => {
      if (!this.active) return;
      el.classList.remove('flying');
      el.classList.remove('mag-snap'); void el.offsetWidth; el.classList.add('mag-snap');
      Audio2.clack(0.3);
      const r = slot.getBoundingClientRect();
      FX.burst(r.left + r.width/2, r.top + r.height/2);
      const all = this.cur.places.every(p =>
        (stage.querySelector(`[data-el="${p.el}"]`) || {}).classList.contains('placed'));
      if (all) setTimeout(() => this.completeTrial(true,
        { at:[r.left + r.width/2, r.top + r.height/2] }), 500);
    }, 420);
  },

  /* A quick hop, retriggerable: the class is removed and reflowed first, so a
     letter named twice in a line bounces twice instead of once. */
  bounceEl(id){
    const el = this.stage().querySelector(`[data-el="${id}"]`);
    if (!el) return;
    el.classList.remove('say-bounce');
    void el.offsetWidth;
    el.classList.add('say-bounce');
  },

  hintPulse(){
    // pulse the sample together with the target so the hint reads as
    // "THIS one ... is the same as THIS one", not just "tap here"
    const els = [
      this.stage().querySelector('.sample-card'),
      this.stage().querySelector('[data-target]') ||
        this.stage().querySelector('[data-piece]:not(.placed)'),
    ].filter(Boolean);
    els.forEach(t => { t.classList.add('pulse'); setTimeout(()=>t.classList.remove('pulse'), 2600); });
    this.speakPrompt();
  },

  applyFallback(){
    this.usedFallback = true;
    this.curRecord.usedFallback = true;
    const fb = this.level.fallback;
    const stage = this.stage();
    const target = stage.querySelector('[data-target]');
    const speakAgain = () => this.speakPrompt();

    const actions = {
      pulseTarget(){ if (target){ target.classList.add('pulse'); setTimeout(()=>target.classList.remove('pulse'), 3200);} speakAgain(); },
      glowTarget(){ if (target){ target.classList.add('glowring','pulse'); setTimeout(()=>target.classList.remove('pulse'), 3200);} speakAgain(); },
      reduceField(){
        // reduce to 2-vs-1, never 1-vs-1: with only one of each left,
        // "the different one" has nothing to be different FROM
        const ds = [...stage.querySelectorAll('[data-el]')].filter(n => !n.dataset.target && !n.classList.contains('zone-card'));
        ds.slice(2).forEach(n => { n.style.transition='opacity .4s'; n.style.opacity='0'; setTimeout(()=>n.remove(), 450); });
        speakAgain();
      },
      growTarget(){ if (target){ target.classList.add('pulse'); setTimeout(()=>target.classList.remove('pulse'), 3200);} speakAgain(); },
      shrinkSmall(){
        if (target){ const s = parseFloat(target.style.getPropertyValue('--s')); target.style.setProperty('--s', Math.max(8, s*.7)); }
        speakAgain();
      },
      muteOther(){
        [...stage.querySelectorAll('[data-el]')].forEach(n => {
          if (!n.dataset.target && !n.dataset.piece && n.dataset.el !== 'nest') n.classList.add('muted');
        });
        speakAgain();
      },
      grayWrong(){
        [...stage.querySelectorAll('[data-el]')].forEach(n => { if (!n.dataset.target) n.classList.add('grayout'); });
        speakAgain();
      },
      demoDrag(){
        // auto-animate the drag path, then return
        const piece = stage.querySelector('[data-piece]:not(.placed)');
        if (!piece) return speakAgain();
        const spec = Engine.cur.pieces.find(p => p.el === piece.dataset.el);
        const slot = stage.querySelector(`[data-el="${spec.slot}"]`);
        const sr = stage.getBoundingClientRect(), slr = slot.getBoundingClientRect();
        const backL = piece.style.left, backT = piece.style.top;  // wherever it rests now
        piece.classList.add('demo-move');
        piece.style.left = ((slr.left+slr.width/2 - sr.left)/sr.width*100)+'%';
        piece.style.top = ((slr.top+slr.height/2 - sr.top + (spec.slotDy||0)*sr.height/100)/sr.height*100)+'%';
        setTimeout(() => {
          piece.style.left = backL; piece.style.top = backT;
          setTimeout(()=>piece.classList.remove('demo-move'), 1100);
        }, 1400);
        speakAgain();
      },
      expandSnap(){ Engine.cur.pieces.forEach(p => p.snapBoost = p.snap * 2.2); speakAgain(); },
      magnetSnap(){ Engine.cur.pieces.forEach(p => p.snapBoost = p.snap * 2.6); speakAgain(); },
      flashWhole(){
        const anchor = stage.querySelector('[data-el="left"]');
        if (anchor && Engine.cur.whole){
          const ghost = document.createElement('div');
          ghost.className = 'el'; ghost.innerHTML = Engine.cur.whole;
          ghost.style.left = anchor.style.left; ghost.style.top = anchor.style.top;
          ghost.style.setProperty('--s', anchor.style.getPropertyValue('--s'));
          ghost.style.opacity = '.85'; ghost.style.pointerEvents = 'none';
          stage.appendChild(ghost);
          setTimeout(()=>{ ghost.style.transition='opacity .5s'; ghost.style.opacity='0'; setTimeout(()=>ghost.remove(), 550); }, 900);
        }
        speakAgain();
      },
      lockMost(){
        // lock all but one piece in place
        const pieces = Engine.cur.pieces.slice(0, -1);
        const sr = stage.getBoundingClientRect();
        for (const p of pieces){
          const el = stage.querySelector(`[data-el="${p.el}"]`);
          if (el.classList.contains('placed')) continue;
          const slot = stage.querySelector(`[data-el="${p.slot}"]`);
          const slr = slot.getBoundingClientRect();
          el.classList.add('snapping','placed');
          el.style.left = ((slr.left+slr.width/2 - sr.left)/sr.width*100)+'%';
          el.style.top = ((slr.top+slr.height/2 - sr.top)/sr.height*100)+'%';
        }
        speakAgain();
      },
    };
    (actions[fb] || actions.pulseTarget)();
  },

  /* ---------- trial + run completion ---------- */
  completeTrial(success, opts={}){
    if (this.locked) return;
    this.locked = true;
    clearTimeout(this.timeoutTimer); clearTimeout(this.autoTimer);
    this.results.push({ state: this.cur.state, kind: this.cur.kind,
      firstAttemptCorrect: this.curRecord.firstAttemptCorrect,
      usedFallback: this.usedFallback });

    this.markStone(this.trialIdx, 'done');
    const isTest = this.cur.kind !== 'watch';
    if (isTest){
      Audio2.correct();
      if (opts.at) FX.burst(opts.at[0], opts.at[1]);
      const praise = this.praise(['Yay!','We did it!','Hooray!','Great job!']);
      // advance only after the praise finishes (clips run 0.5–2.4s), with a
      // floor so short praise still lands and a cap so we never hang on audio
      const started = Date.now();
      let advanced = false;
      const go = () => { if (!advanced){ advanced = true; this.runTrial(this.trialIdx+1); } };
      Audio2.speak(praise, () => setTimeout(go, Math.max(0, 1300 - (Date.now()-started))));
      setTimeout(go, 4000);
    } else {
      setTimeout(() => this.runTrial(this.trialIdx+1), 250);
    }
  },

  finishRun(){
    this.active = false;
    const outcome = applyRunOutcome(this.node, this.level, this.results);
    Telemetry.end(true, outcome);

    Audio2.fanfare();
    // the last trial just cheered — say something else
    Audio2.speak(this.praise(['Hooray!','Yay!','We did it!','Great job!']));
    Celebrate.run(outcome === 'complete' ? 'trophy' : 'ribbon',
                  outcome === 'complete' ? 'You won!' : 'You did it!');
    // keep the child in flow: roll straight into the next level. On node
    // completion, hop to the next unlocked, unfinished node; when the whole
    // curriculum is done, fall back to home.
    const next = this.pickNextLevel(this.node, outcome);
    setTimeout(() => {
      if (next) this.startLevel(next.node, next.level);
      else { showView('home'); renderHome(); }
    }, 4700);
  },

  pickNextLevel(node, outcome){
    const currentAt = (nd) => {
      const np = nodeProgress(nd.key);
      return nd.levels[clamp(np.levelIdx, 0, nd.levels.length - 1)];
    };
    if (outcome !== 'complete'){
      // same node: advanced (up), repeated (stay), or repair (down)
      return { node, level: currentAt(node) };
    }
    // node finished — continue with the next unlocked, unfinished node,
    // searching from the current node forward then wrapping around
    const i0 = NODES.indexOf(node);
    for (let k = 1; k <= NODES.length; k++){
      const nx = NODES[(i0 + k) % NODES.length];
      if (nx === node) continue;
      if (nodeUnlocked(nx) && nodeProgress(nx.key).mastered.length < nx.levels.length)
        return { node: nx, level: currentAt(nx) };
    }
    return null;   // whole curriculum complete → home
  },

  abort(){
    this.active = false;
    this.cur = null;
    clearTimeout(this.timeoutTimer); clearTimeout(this.autoTimer);
    this.stopPhysics();
    this.stopRain();
    Audio2.stop();
    Telemetry.end(false, 'abandoned');
  },

  /* "Show me again" — replay this level from the top, intro and all, on the
     SAME seed so it is the same challenge rather than a fresh one. A child who
     missed the explanation gets it back without a grown-up navigating. */
  restartLevel(){
    if (!this.node || !this.level) return;
    const seed = parseInt(new URLSearchParams(location.search).get('seed'), 36) || undefined;
    const { node, level } = this;
    this.abort();
    this.startLevel(node, level, seed);
  },
};

/* ═══════════════════════ 9 · Simulation harness ═══════════════════════════
   Generates synthetic sessions through the SAME level generators, event schema
   and DDA rules as live play, so the dashboard and insights can be exercised
   and iterated on without a toddler in the loop. Behavioral profiles model
   TTFT latency, error rates, motor noise (near-misses) and frustration bursts. */

export { Engine };

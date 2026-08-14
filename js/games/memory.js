/* ═══════════════════════ Memory (mini-game) ════════════════════════════════
   Twelve pairs of picture cards on a 4×6 board.

   Concentration is normally a memory test, which a two-year-old loses. Three
   things turn it into something he can win:

   PREVIEW. Every card is dealt face UP and stays that way for a few seconds
   before they turn over together. He gets to see the board as a picture first,
   so the game starts from something he watched happen rather than from
   twenty-four identical backs.

   NO DEAD TURNS. Turning a card over says its name out loud, whether it
   matches or not. A miss is still a look at a picture and a word, so the board
   teaches even when he is guessing.

   HELP THAT ARRIVES ON ITS OWN. Misses since the last match are counted, and
   after a couple of them the partner of the face-up card begins to glow —
   faintly at first, then sooner and more strongly. He never has to ask, and it
   fades the moment he is doing well again, so it stays out of the way of a
   child who is actually remembering. */
import { Audio2 } from '../audio.js';
import { $, shuffle } from '../core.js';
import { Celebrate, FX } from '../fx.js';
import { showView } from '../router.js';

const CARDS = ['airplane','apple','ball','banana','bear','butterfly','cake','cap','cat',
  'crayons','dog','doll','dragon','duck','elephant','fish','flower','frog','horse','hotdog',
  'jackbox','keys','ladybug','parrot','pizza','present','rabbit','rocket','shoe','skateboard',
  'snail','squirrel','sun','train','tricycle','watch'];

const PAIRS = 12;              // 24 cards — the 4×6 board
const PREVIEW_MS = 4200;       // long enough to look, short enough to stay a game
const FLIP_BACK_MS = 1250;     // a miss stays visible long enough to be studied
/* Misses since the last match before help starts, and how long the partner
   waits before glowing. Both tighten as he keeps missing. */
const HELP_AFTER = 2;
const rnd = () => Math.random();

const BACK = `<svg viewBox="0 0 100 100" aria-hidden="true">
  <rect x="3" y="3" width="94" height="94" rx="14" fill="#4C86D8"/>
  <rect x="9" y="9" width="82" height="82" rx="10" fill="none" stroke="#78ABEA" stroke-width="3"/>
  <g fill="#78ABEA">
    <circle cx="50" cy="50" r="13"/>
    <circle cx="50" cy="24" r="5"/><circle cx="50" cy="76" r="5"/>
    <circle cx="24" cy="50" r="5"/><circle cx="76" cy="50" r="5"/>
  </g>
  <circle cx="50" cy="50" r="6" fill="#EAF2FC"/>
</svg>`;

const MemoryGame = {
  running: false, cards: [], first: null, lock: false,
  misses: 0, found: 0, hintTimer: 0,

  start(){
    Audio2.unlock();
    showView('memory');
    this.stop();
    this.running = true;
    this.first = null; this.lock = true; this.misses = 0; this.found = 0;

    const picks = shuffle(rnd, CARDS.slice()).slice(0, PAIRS);
    const deck = shuffle(rnd, picks.concat(picks));
    const board = $('#mem-board');
    board.innerHTML = '';
    board.classList.remove('mem-hidden');
    this.cards = deck.map((name, i) => {
      const el = document.createElement('button');
      el.className = 'mem-card mem-up';
      el.dataset.name = name; el.dataset.i = i;
      el.setAttribute('aria-label', name);
      el.innerHTML = `<span class="mem-inner">
          <span class="mem-face mem-front"><img src="./assets/cards/${name}.webp" alt="" draggable="false"></span>
          <span class="mem-face mem-back">${BACK}</span>
        </span>`;
      // deal them in, one after another, so the board assembles rather than appears
      el.style.animationDelay = (i * 26) + 'ms';
      board.appendChild(el);
      return el;
    });
    $('#mem-pile').innerHTML = '';
    $('#mem-hint').textContent = 'Look at the cards!';

    Audio2.speak('Look at all the cards!');
    this.previewTimer = setTimeout(() => this.turnDown(), PREVIEW_MS);
  },

  /* The whole board turns over together, in a wave — the one moment the game
     asks him to remember something, made as legible as possible. */
  turnDown(){
    if (!this.running) return;
    this.cards.forEach((el, i) => {
      el.style.transitionDelay = (i % 6) * 22 + Math.floor(i / 6) * 34 + 'ms';
      el.classList.remove('mem-up');
    });
    // Open for taps well before the wave finishes. The board looks ready the
    // moment the first cards land, and a child who reaches straight for one
    // should not have the tap swallowed — the worst that happens is a card
    // turns back over while its neighbours are still turning down.
    setTimeout(() => {
      if (!this.running) return;
      this.cards.forEach(el => { el.style.transitionDelay = ''; });
      this.lock = false;
      $('#mem-hint').textContent = 'Find two that match';
      Audio2.speak('Now find two that are the same!');
    }, 420);
  },

  tap(el){
    if (!this.running || this.lock || !el || el.classList.contains('mem-gone')) return;
    if (el === this.first){                       // tapping it again puts it back
      el.classList.remove('mem-up');
      this.first = null; this.clearHint();
      return;
    }
    if (el.classList.contains('mem-up')) return;

    el.classList.add('mem-up');
    Audio2.speak(el.dataset.name);                // every turn is a word, match or not

    if (!this.first){
      this.first = el;
      this.armHint();
      return;
    }
    const a = this.first, b = el;
    this.first = null; this.clearHint(); this.lock = true;

    if (a.dataset.name === b.dataset.name){
      this.misses = 0;
      setTimeout(() => this.collect(a, b), 520);
    } else {
      this.misses++;
      setTimeout(() => {
        if (!this.running) return;
        a.classList.remove('mem-up'); b.classList.remove('mem-up');
        this.lock = false;
      }, FLIP_BACK_MS);
    }
  },

  /* A pair leaves the board and lands on the pile, so progress is a thing he
     can see growing rather than a number. */
  collect(a, b){
    if (!this.running) return;
    Audio2.correct();
    const r = b.getBoundingClientRect();
    FX.burst(r.left + r.width / 2, r.top + r.height / 2);
    [a, b].forEach(el => el.classList.add('mem-won'));
    setTimeout(() => {
      if (!this.running) return;
      const pile = $('#mem-pile');
      [a, b].forEach(el => el.classList.add('mem-gone'));
      const chip = document.createElement('span');
      chip.className = 'mem-chip';
      chip.innerHTML = `<img src="./assets/cards/${a.dataset.name}.webp" alt="" draggable="false">`;
      chip.style.setProperty('--tilt', (rnd() * 12 - 6).toFixed(1) + 'deg');
      pile.appendChild(chip);
      this.found++;
      this.lock = false;
      if (this.found >= PAIRS) this.win();
      else if (this.found === 1 || this.found % 4 === 0) Audio2.speak('You found a pair!');
    }, 640);
  },

  /* Help, unasked. It starts late and faint, and each further miss brings it
     sooner and stronger; a match resets it to nothing. */
  armHint(){
    this.clearHint();
    if (this.misses < HELP_AFTER) return;
    const over = this.misses - HELP_AFTER;
    const wait = Math.max(900, 2600 - over * 700);
    this.hintTimer = setTimeout(() => {
      if (!this.running || !this.first) return;
      const mate = this.cards.find(c => c !== this.first &&
        c.dataset.name === this.first.dataset.name && !c.classList.contains('mem-gone'));
      if (!mate) return;
      mate.style.setProperty('--hint', Math.min(1, 0.45 + over * 0.28).toFixed(2));
      mate.classList.add('mem-hintcard');
    }, wait);
  },
  clearHint(){
    clearTimeout(this.hintTimer);
    for (const c of this.cards) c.classList.remove('mem-hintcard');
  },

  win(){
    $('#mem-hint').textContent = 'You found them all!';
    Audio2.fanfare();
    Celebrate.run('trophy', 'You found them all!');
  },

  stop(){
    this.running = false;
    clearTimeout(this.previewTimer);
    clearTimeout(this.hintTimer);
  },
};

export { MemoryGame };

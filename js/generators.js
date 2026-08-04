import { BUBBLE_ART, C, CARD_IMG, CLOUD2, COLOR_KEYS, COLOR_PAIRS, COVER, COVER_COLORS, CUCKOO_CLOCK, DROP_RING, OPEN_SHUT_BOX, PUSH_BTN, SHAPES, SHAPE_KEYS, SIL, SPIDER, SPOUT, SUN2 } from './art.js';
import { $, clamp, pick, pick2, shuffle } from './core.js';
import { CHILD_NAME, LETTER_GHOST, MAGNET_LETTER, NAME_LETTERS, pickColors, pickNamed, sayGlyph } from './letters.js';
import { dragTrial, elShape, rowXs, tapTrial, watchTrial, zoneEl } from './trials.js';

function outlierLevel(rng, mode){
  // mode: 'shape' (color static), 'color' (shape static), 'both'
  const baseColor = pick(rng, COLOR_KEYS);
  const pair = pick(rng, COLOR_PAIRS.filter(p => p.includes(baseColor))) || pick(rng, COLOR_PAIRS);
  const oddColor = pair[0] === baseColor ? pair[1] : pair[0];
  const [baseShape, oddShape] = pick2(rng, SHAPE_KEYS);
  const oc = mode === 'shape' ? baseColor : oddColor;
  const os = mode === 'color' ? baseShape : oddShape;
  const nOut = mode === 'both' ? 5 : 4;
  const posOrder = shuffle(rng, Array.from({length: nOut}, (_, k) => k));
  const mkTest = t => {
    const n = nOut;
    const xs = rowXs(n), ti = posOrder[t];
    return tapTrial({ state:'TEST', prompt:'Tap the different one', say:'One is different! Tap the different one.',
      elements: xs.map((x,i) => elShape(i===ti?'target':'d'+i,
        SHAPES[i===ti?os:baseShape](C[i===ti?oc:baseColor]), x, 52, n===5?15:17,
        { tappable:true, target:i===ti })) });
  };
  return {
    expose: watchTrial({ state:'EXPOSE', prompt:'Same', say:'Look. All the same.',
      elements:[ elShape('a', SHAPES[baseShape](C[baseColor]), 38, 50, 19), elShape('b', SHAPES[baseShape](C[baseColor]), 62, 50, 19) ]}),
    contrast: watchTrial({ state:'CONTRAST', prompt:'Different', say:'These two are different.',
      elements:[ elShape('a', SHAPES[baseShape](C[baseColor]), 38, 50, 19), elShape('b', SHAPES[os](C[oc]), 62, 50, 19) ]}),
    tests:[mkTest(0), mkTest(1), mkTest(2)],
  };
}
function sizeLevel(rng, {big, small, ask}){
  const ck = pick(rng, COLOR_KEYS), sk = pick(rng, SHAPE_KEYS);
  const mk = () => SHAPES[sk](C[ck]);
  const startFlip = rng() < .5;
  const mkTest = i => {
    const flip = (i % 2 === 0) === startFlip;
    const big2 = [big, big*0.92, big*1.06][i] || big;
    const small2 = [small, small*1.08, small*0.94][i] || small;
    const xs = [32, 68];
    const els = [
      elShape('big', mk(), xs[flip?1:0], [50,46,53][i]||50, big2, {tappable:true, target: ask==='big'}),
      elShape('small', mk(), xs[flip?0:1], (ask==='big'?62:56)+[0,4,-3][i], small2, {tappable:true, target: ask==='small'}),
    ];
    return tapTrial({ state:'TEST', prompt:`Tap the ${ask} one`, say:`Tap the ${ask} one!`, elements: els });
  };
  return {
    expose: watchTrial({ state:'EXPOSE', prompt:'Big', say:'Look. Big!',
      elements:[ elShape('a', mk(), 50, 50, big) ]}),
    contrast: watchTrial({ state:'CONTRAST', prompt:'Small', say:'And this one is small.',
      elements:[ elShape('a', mk(), 50, 58, small) ]}),
    tests:[mkTest(0), mkTest(1), mkTest(2)],
  };
}
/* Hide-and-seek (object permanence): the child watches a picture card hide
   under one of several identical covers, then finds it. Reuses the tap path;
   the engine plays the hide sequence before input and reveals on a correct tap. */
function hideSeekLevel(rng, {n, objs, isGen, shuffle: mix}){
  const coverY = 64, coverS = 26, objS = 20;
  const order = shuffle(rng, Array.from({length:n}, (_,k)=>k));
  const mkTest = t => {
    const name = objs[t % objs.length];
    const xs = rowXs(n);
    const ti = order[t % order.length] % n;
    const covers = xs.map((x,k) => elShape('cover'+k, COVER(COVER_COLORS[k], k+1), x, coverY, coverS,
      { tappable:true, target: k===ti }));
    return {
      kind:'hideseek', state: isGen ? 'GENERALIZE' : 'TEST',
      prompt:'Find the ' + name, say:'Where is the ' + name + '? Find it!',
      introSay:'Watch! The ' + name + ' is hiding.',
      hideInto:'cover'+ti, timeoutMs: 11000,
      shuffle: !!mix, shuffles: mix ? 1 + t : 0,
      elements:[ ...covers,
        elShape('obj', CARD_IMG(name), 50, 28, objS, {scenery:true}) ],
    };
  };
  return {
    expose: watchTrial({ state:'EXPOSE', prompt:'Hide and seek!', say:"Let's play hide and seek!",
      elements:[ elShape('obj', CARD_IMG(objs[0]), 50, 40, objS+4, {scenery:true}),
                 elShape('cover0', COVER(COVER_COLORS[0], 1), 34, coverY, coverS, {scenery:true}),
                 elShape('cover1', COVER(COVER_COLORS[1], 2), 66, coverY, coverS, {scenery:true}) ]}),
    contrast: watchTrial({ state:'CONTRAST', prompt:'Peekaboo!', say:'Peekaboo!',
      elements:[ elShape('cover0', COVER(COVER_COLORS[0], 1), 34, coverY, coverS, {scenery:true}),
                 elShape('obj', CARD_IMG(objs[0]), 66, coverY-3, objS, {scenery:true}),
                 elShape('cover1', COVER(COVER_COLORS[1], 2), 66, coverY, coverS, {scenery:true, peek:true}) ]}),
    tests:[mkTest(0), mkTest(1), mkTest(2)],
  };
}

/* Intro: the very first lessons — touch the screen and something happens. Each is
   an errorless single-tap on one friendly thing that reacts (pop / fireworks /
   scurry), connecting "my finger did that". */
function introTapLevel(rng, {kind}){
  const cfg = {
    bubble: { say:'Pop the bubble!',   art: () => BUBBLE_ART(),        s: 32 },
    button: { say:'Press the button!', art: () => PUSH_BTN('#E5484D'), s: 36 },
    spider: { say:'Tap the spider!',   art: () => SPIDER(),            s: 26 },
    cuckoo: { say:'Tap the clock!',    art: () => CUCKOO_CLOCK(),      s: 34 },
    box:    { say:'Open, shut it!',    art: () => OPEN_SHUT_BOX(),     s: 34 },
  }[kind];
  const spots = [[50, 50], [38, 44], [62, 56]];
  const mkTest = i => {
    const [x, y] = spots[i % spots.length];
    return Object.assign(tapTrial({ state:'TEST', prompt: cfg.say, say: cfg.say,
      elements:[ elShape('thing', cfg.art(), x, y, cfg.s, {tappable:true, target:true}) ] }),
      { tapFx: kind });
  };
  return { tests:[mkTest(0), mkTest(1), mkTest(2)] };
}
/* Cause & effect: place the bug on the spout → it climbs, rain comes, washes
   it out. The child's action reliably produces the effect. */
function spoutLevel(rng, {isGen}={}){
  const BUG = SPIDER, name = 'spider';   // always the spider (it's the spider song)
  const mkTest = i => {
    const right = i % 2 === 0;
    const sx = right ? 60 : 40;
    // start the bug a short reach from the spout and back it off each round —
    // the first drag should succeed on a toddler's first try, not be a
    // cross-screen haul
    const reach = [16, 26, 36][i];
    const bx = clamp(right ? sx - reach : sx + reach, 8, 92);
    const by = [76, 80, 84][i];
    return dragTrial({ state: isGen ? 'GENERALIZE' : 'TEST',
      prompt:'Put the ' + name + ' on the spout',
      say:'Put the ' + name + ' at the bottom of the water spout!',
      elements:[
        // the sun starts hidden; it shines in the "out came the sun" resolution
        elShape('sun', SUN2(), sx > 50 ? 20 : 80, 20, 20, {scenery:true, cls:'efx-sun'}),
        elShape('cloud', CLOUD2(), sx, 20, 30, {scenery:true}),
        elShape('spout', SPOUT(), sx, 56, 34, {scenery:true}),
        // the ring marks the drop spot — the base of the spout (matches the snap
        // target: spout centre + slotDy). The bug climbs up from here.
        elShape('drop', DROP_RING(), sx, 68, 24, {scenery:true, cls:'drop-target'}),
        elShape('bug', BUG(), bx, by, 15, {piece:true}),
      ],
      pieces:[{ el:'bug', slot:'spout', snap: 16, slotDy: 12, causeEffect: true }] });
  };
  return {
    expose: Object.assign(watchTrial({ state:'EXPOSE', prompt:'Up it climbs', say:'The itsy bitsy ' + name + ' went up the water spout!',
      elements:[
        elShape('sun', SUN2(), 22, 22, 22, {scenery:true, decor:true}),
        elShape('spout', SPOUT(), 55, 56, 34, {scenery:true}),
        elShape('bug', BUG(), 55, 72, 15, {scenery:true}) ]}), { demo:'spoutClimb' }),   // spider climbs from the base
    contrast: Object.assign(watchTrial({ state:'CONTRAST', prompt:'Out it washes!', say:'Down came the rain and washed the ' + name + ' out!',
      elements:[
        elShape('cloud', CLOUD2(), 55, 20, 30, {scenery:true}),
        elShape('spout', SPOUT(), 55, 56, 34, {scenery:true}),
        elShape('bug', BUG(), 55, 47, 15, {scenery:true}) ]}), { demo:'spoutWash' }),   // spider at top, rain washes it out
    tests:[mkTest(0), mkTest(1), mkTest(2)],
  };
}
/* ── Magnet board (Node 7 · Letters) ──────────────────────────────────────
   One surface for the whole node: a steel board the letters live on. The
   board is the first element of every trial so it renders behind everything,
   and it's sized in % of the stage (not vmin) so it fills any screen. */
const magnetBoard = () => elShape('board', '', 50, 50, 40,
  { scenery:true, decor:false, board:true, wPct:97, hPct:97 });

/* A spoken line built beat by beat, keeping the element each beat refers to so
   the engine can make it hop as it is named (Engine.bounceEl). `long` asks for
   the wider gap — letters read as a list want room between them. */
function beatLine(beats){
  return {
    say: beats.map((b, i) => (i ? (b.long ? ' || ' : ' | ') : '') + b.say).join(''),
    beatEls: beats.map(b => b.el || null),
  };
}

/* 7.1 — errorless exposure: one letter on the board. Tap it, it wiggles off
   the board and says its own name. No wrong answer exists. */
function letterTapLevel(rng){
  const chs = pickNamed(rng, 3, 2);
  const cols = pickColors(rng, 3);
  const spots = [[50, 48], [39, 44], [61, 53]];
  const mkTest = i => Object.assign(tapTrial({
    state:'TEST', prompt:'Tap the ' + chs[i], say:'Tap the letter | ' + sayGlyph(chs[i]) + '!',
    elements:[ magnetBoard(),
      elShape('L', MAGNET_LETTER(chs[i], cols[i]), spots[i][0], spots[i][1], 34,
        {tappable:true, target:true, letter:chs[i]}) ]}),
    { tapFx:'letter' });
  return {
    expose: watchTrial({ state:'EXPOSE', prompt:'Letters!', say:'Look — letters on the board!',
      elements:[ magnetBoard(),
        elShape('a', MAGNET_LETTER(chs[0], cols[0]), 30, 48, 26, {scenery:true}),
        elShape('b', MAGNET_LETTER(chs[1], cols[1]), 50, 48, 26, {scenery:true}),
        elShape('c', MAGNET_LETTER(chs[2], cols[2]), 70, 48, 26, {scenery:true}) ]}),
    tests:[mkTest(0), mkTest(1), mkTest(2)],
  };
}

/* 7.2 — "which one is the A?": the named letter is shown on a card AND said
   out loud, so the child can solve it by shape, by name, or by both. Colors
   are all different from the card's, so matching color can never stand in for
   matching letterform. */
function letterFindLevel(rng, {n = 3, isGen} = {}){
  const chs = pickNamed(rng, 4);
  const target = chs[0], others = chs.slice(1);
  const sampleColor = pickColors(rng, 1)[0];
  const order = shuffle(rng, [0, 1, 2]);
  const sample = () => elShape('sample', MAGNET_LETTER(target, sampleColor), 50, 22, 18,
    { scenery:true, sampleCard:true, letter:target });
  const mkTest = t => {
    const nOpt = t === 0 ? 2 : n;                 // gentle first round
    const xs = rowXs(nOpt), ti = order[t] % nOpt;
    const cols = pickColors(rng, nOpt, [sampleColor]);
    const els = [ magnetBoard(), sample() ];
    for (let k = 0; k < nOpt; k++){
      const ch = k === ti ? target : others[(k + t) % others.length];
      els.push(elShape(k === ti ? 'target' : 'd' + k, MAGNET_LETTER(ch, cols[k]),
        xs[k], 66, nOpt === 2 ? 27 : 23,
        { tappable:true, target: k === ti, letter: ch }));
    }
    return Object.assign(tapTrial({ state: isGen ? 'GENERALIZE' : 'TEST',
      prompt:'Which one is the ' + target + '?',
      say:'Find and tap the letter | ' + sayGlyph(target) + '!',
      elements: els }), { tapFx:'letter' });
  };
  return {
    expose: watchTrial({ state:'EXPOSE', prompt:'This is ' + target,
      say:'This is the letter | ' + sayGlyph(target), beatEls:[null, 'a'],
      elements:[ magnetBoard(), elShape('a', MAGNET_LETTER(target, sampleColor), 50, 48, 34, {scenery:true}) ]}),
    contrast: watchTrial({ state:'CONTRAST', prompt:'A different letter',
      say:'And this one is | ' + sayGlyph(others[0]) + ' | A different letter!', beatEls:[null, 'b'],
      elements:[ magnetBoard(),
        elShape('a', MAGNET_LETTER(target, sampleColor), 34, 48, 27, {scenery:true}),
        elShape('b', MAGNET_LETTER(others[0], pickColors(rng, 1, [sampleColor])[0]), 66, 48, 27, {scenery:true}) ]}),
    tests:[mkTest(0), mkTest(1), mkTest(2)],
  };
}

/* 7.3 — the magnet board proper, and the payoff of the whole node: the child
   spells his own name. The four spots stand in a row reading S-E-A-N, and each
   round hands back more of the word — the last letter, then two, then all of
   it. Picking WHICH spot a letter belongs in is the same discrimination as
   7.2, now made by doing instead of pointing, and the answer is a word he has
   a reason to care about instead of an arbitrary letter on an arbitrary spot.

   Laid out at 18% spacing with 16vmin letters: wide enough that pieces never
   overlap on a portrait iPad, tight enough to read as one word rather than
   four unrelated spots. */
function letterBoardLevel(rng, {isGen} = {}){
  const word = NAME_LETTERS;
  const cols = pickColors(rng, word.length);
  const wx = word.map((_, i) => 50 + (i - (word.length - 1) / 2) * 18);
  const wy = 34, ws = 16, trayY = 74;
  const ghosts = () => word.map((ch, i) =>
    elShape('g' + i, LETTER_GHOST(ch), wx[i], wy, ws, {scenery:true, letter:ch}));
  const placed = i =>
    elShape('w' + i, MAGNET_LETTER(word[i], cols[i]), wx[i], wy, ws, {scenery:true});

  // how much of the name each round asks for: the tail first (the opening
  // letters keep the word readable), then the whole thing. Every round shows
  // ALL the spots — there is never a spare spot with nothing to fill it.
  const end = word.length - 1;
  const MISSING = [[end], [end - 1, end], word.map((_, i) => i)];
  const mkTest = t => {
    const miss = MISSING[t];
    // loose letters wait below in scrambled order — never under their own spot
    const tx = shuffle(rng, miss.map(i => wx[i]));
    const els = [ magnetBoard(), ...ghosts() ];
    for (let i = 0; i < word.length; i++) if (!miss.includes(i)) els.push(placed(i));
    miss.forEach((i, k) =>
      els.push(elShape('p' + i, MAGNET_LETTER(word[i], cols[i]), tx[k], trayY, ws,
        {piece:true, letter:word[i]})));
    // each letter hops in the tray as its name is spoken
    const line = miss.length === word.length
      ? beatLine([{ say:'Now spell the whole name!' },
          ...miss.map(i => ({ say: sayGlyph(word[i]), el:'p' + i, long:true }))])
      : miss.length === 1
        ? beatLine([{ say:`${CHILD_NAME} needs one more letter.` }, { say:'Put the' },
            { say: sayGlyph(word[miss[0]]), el:'p' + miss[0] }, { say:'where it goes!' }])
        : beatLine([{ say:`${CHILD_NAME} needs more letters.` },
            { say:'Put each one where it goes!' }]);
    return dragTrial({ state: isGen ? 'GENERALIZE' : 'TEST',
      prompt: miss.length === word.length ? 'Spell ' + CHILD_NAME : 'Finish ' + CHILD_NAME,
      say: line.say, beatEls: line.beatEls,
      elements: els,
      pieces: miss.map(i => ({ el:'p' + i, slot:'g' + i, snap: 11, magnet:true })) });
  };
  return {
    expose: watchTrial(Object.assign({ state:'EXPOSE', prompt: CHILD_NAME + '!',
      elements:[ magnetBoard(), ...ghosts(), ...word.map((_, i) => placed(i)) ]},
      beatLine([{ say:`This says ${CHILD_NAME}!` },
        ...word.map((ch, i) => ({ say: sayGlyph(ch), el:'w' + i, long:true }))]))),
    contrast: watchTrial({ state:'CONTRAST', prompt:'A letter came off',
      say:'Uh oh! || A letter came off. | It goes right there.',
      elements:[ magnetBoard(), ...ghosts(),
        ...word.slice(0, -1).map((_, i) => placed(i)),
        elShape('loose', MAGNET_LETTER(word[word.length-1], cols[word.length-1]), wx[word.length-1], trayY, ws, {scenery:true}) ]}),
    tests:[mkTest(0), mkTest(1), mkTest(2)],
  };
}

function quantityLevel(rng, {pairs, ask, item}){
  const ic = item === 'apple' ? C.coral : C[pick(rng, ['sea','grape','tang'])];
  const svg = SIL[item](ic);
  const mkTest = i => {
    const [a, b] = pairs[i % pairs.length];
    const bigLeft = rng() < .5;
    const za = zoneEl('side-a', bigLeft?72:28, a, svg);
    const zb = zoneEl('side-b', bigLeft?28:72, b, svg);
    const target = ask === 'more' ? zb : za;
    target.target = true;
    return tapTrial({ state: ask==='less' ? 'GENERALIZE' : 'TEST',
      prompt:`Tap the side with ${ask}`, say:`Which side has ${ask}?`,
      elements:[za, zb] });
  };
  const [a0, b0] = pairs[0];
  return {
    expose: watchTrial({ state:'EXPOSE', prompt: a0===1?'One':'Some', say: a0===1 ? `One ${item}.` : `Some ${item}s.`,
      elements:[ zoneEl('za', 50, a0, svg) ]}),
    contrast: watchTrial({ state:'CONTRAST', prompt:'More!', say:'Look — more!',
      elements:[ zoneEl('zb', 50, b0, svg) ]}),
    tests:[mkTest(0), mkTest(1), mkTest(2)],
  };
}

/* ═══════════════════════ 5 · Storage ══════════════════════════════════════ */

export { outlierLevel, sizeLevel, hideSeekLevel, introTapLevel, spoutLevel, quantityLevel,
         letterTapLevel, letterFindLevel, letterBoardLevel };

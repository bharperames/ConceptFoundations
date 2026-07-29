import { BUBBLE_ART, C, CARD_IMG, CLOUD2, COLOR_KEYS, COLOR_PAIRS, COVER, COVER_COLORS, CUCKOO_CLOCK, DROP_RING, OPEN_SHUT_BOX, PUSH_BTN, SHAPES, SHAPE_KEYS, SIL, SPIDER, SPOUT, SUN2 } from './art.js';
import { $, pick, pick2, shuffle } from './core.js';
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
        elShape('bug', BUG(), right ? 18 : 82, 84, 15, {piece:true}),
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
/* Causality — discriminate the effective cause: N buttons, only one makes the
   fireworks go. n=2 then n=3 gives a difficulty ramp. (The plain single-button
   "press → effect" lives in the Intro section now.) */
function buttonLevel(rng, {n = 2, isGen}={}){
  const CAPS = ['#E5484D', '#4C86D8', '#39B26B', '#E0A020'];
  const xs = n === 2 ? [34, 66] : [24, 50, 76];
  const sz = n === 2 ? 30 : 26;
  const btns = (extra) => xs.map((x, k) => extra(x, k));
  const mkTest = i => {
    const ti = i % n;   // which button works this trial
    return Object.assign(tapTrial({ state: isGen ? 'GENERALIZE' : 'TEST',
      prompt:'Which one makes it go?', say:'Which button makes it go? Press it!',
      elements: btns((x, k) => elShape('b'+k, PUSH_BTN(CAPS[(i+k) % CAPS.length]), x, 58, sz, {tappable:true, target: k===ti})) }),
      { tapFx:'button' });
  };
  return {
    expose: Object.assign(watchTrial({ state:'EXPOSE', prompt:'Press it!', say:'Press the button and it goes pop!',
      elements:[ elShape('btn', PUSH_BTN('#E5484D'), 50, 56, 34, {scenery:true}) ]}), { demo:'buttonPress' }),
    contrast: watchTrial({ state:'CONTRAST', prompt: n + ' buttons', say:'Only one makes it go. Which one?',
      elements: btns((x, k) => elShape('b'+k, PUSH_BTN(CAPS[k % CAPS.length]), x, 58, sz, {scenery:true})) }),
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

export { outlierLevel, sizeLevel, hideSeekLevel, introTapLevel, spoutLevel, buttonLevel, quantityLevel };

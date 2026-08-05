import { BALL, BOX, C, CHEVRON, CIRC_HOLE, COLOR_KEYS, COLOR_PAIRS, HALF_L, HALF_R, HOUSE, PUZ_L, PUZ_R2, SHAPES, SHAPE_KEYS, SIL, STAR_HOLE, WOOD_BLOCK } from './art.js';
import { pick, pick2, shuffle } from './core.js';
import { dressLevel, hideSeekLevel, introTapLevel, letterBoardLevel, letterFindLevel, letterTapLevel, letterTapPlaceLevel, outlierLevel, quantityLevel, sizeLevel, spoutLevel } from './generators.js';
import { dragTrial, elShape, rowXs, tapTrial, watchTrial } from './trials.js';

const NODES = [
{
  key:'intro', num:1, title:'First Taps', parentName:'Intro',
  tag:'Touch the screen — things happen!', prereqs:[],
  levels:[
    { id:'0.1', name:'Pop the bubble', focus:'Touch → effect: tap a bubble, it pops',
      make(rng){ return introTapLevel(rng, { kind:'bubble' }); }},
    { id:'0.2', name:'Press the button', focus:'Touch → effect: tap a button, fireworks',
      make(rng){ return introTapLevel(rng, { kind:'button' }); }},
    { id:'0.3', name:'Tap the spider', focus:'Touch → effect: tap the spider, it scurries',
      make(rng){ return introTapLevel(rng, { kind:'spider' }); }},
    { id:'0.4', name:'Tap the clock', focus:'Touch → effect: tap the clock, the cuckoo pops out',
      make(rng){ return introTapLevel(rng, { kind:'cuckoo' }); }},
    { id:'0.5', name:'Open, shut it', focus:'Touch → effect: tap the box, the lid opens and shuts',
      make(rng){ return introTapLevel(rng, { kind:'box' }); }},
    // the one Intro lesson where the effect needs the object MOVED, not just
    // touched: the child's own placement starts the whole spider song
    { id:'0.6', name:'Up the spout', focus:'Contingency: my action makes it happen (spider → spout)', fallback:'demoDrag',
      make(rng){ return spoutLevel(rng, { bug:'spider' }); }},
  ],
},
{
  key:'identity', num:2, title:'Same & Different', parentName:'Identity',
  tag:'Matching, then spotting the outlier', prereqs:[],
  levels:[
    { id:'1.1', name:'Exact visual match', focus:'Shape & color', fallback:'pulseTarget',
      make(rng){
        const ck = pick(rng, COLOR_KEYS), sk = pick(rng, SHAPE_KEYS);
        const [ck2] = COLOR_PAIRS.find(p=>p[0]===ck) ? [COLOR_PAIRS.find(p=>p[0]===ck)[1]] : [pick2(rng, COLOR_KEYS.filter(k=>k!==ck))[0]];
        const sk2 = pick(rng, SHAPE_KEYS.filter(k=>k!==sk));
        const mk = (kc,ks) => SHAPES[ks](C[kc]);
        const tests = [];
        const leftFirst = rng() < .5;
        for (let t=0;t<3;t++){
          // sample stays constant (matching-to-sample); the distractor and the
          // correct side change every round so no two rounds look identical
          const dc = shuffle(rng, COLOR_KEYS.filter(k => k !== ck))[0];
          const ds2 = SHAPE_KEYS.filter(k => k !== sk)[t % (SHAPE_KEYS.length - 1)];
          const sides = [ (t % 2 === 0) === leftFirst ];
          const xs = rowXs(2);
          tests.push(tapTrial({ state:'TEST', prompt:'Tap the one that’s the same', say:'See this one? Tap the one that is the same!',
            elements:[
              // card padding is 1.6vmin/side — s of 22.2 renders the glyph at 19,
              // exactly matching the options below (1.1 is EXACT visual match)
              elShape('sample', mk(ck,sk), 50, 19, 22.2, {scenery:true, sampleCard:true}),
              elShape('arrow', CHEVRON(), 50, 40, 8, {scenery:true, decor:true}),
              elShape('target', mk(ck,sk), xs[sides[0]?0:1], 64, 19, {target:true, tappable:true}),
              elShape('d1', mk(dc,ds2), xs[sides[0]?1:0], 64, 19, {tappable:true}),
            ]}));
        }
        return {
          expose: watchTrial({ state:'EXPOSE', prompt:'Same', say:'Look. These are the same.',
            elements:[ elShape('a', mk(ck,sk), 38, 50, 20), elShape('b', mk(ck,sk), 62, 50, 20) ]}),
          contrast: watchTrial({ state:'CONTRAST', prompt:'Different', say:'These are different.',
            elements:[ elShape('a', mk(ck,sk), 38, 50, 20), elShape('b', mk(ck2,sk2), 62, 50, 20) ]}),
          tests,
        };
      }},
    { id:'1.2', name:'Shape isolation', focus:'Shape (color held still)', fallback:'reduceField',
      make(rng){ return outlierLevel(rng, 'shape'); }},
    { id:'1.3', name:'Color isolation', focus:'Color (shape held still)', fallback:'reduceField',
      make(rng){ return outlierLevel(rng, 'color'); }},
    { id:'1.4', name:'Dual variable', focus:'Shape & color together', fallback:'reduceField',
      make(rng){ return outlierLevel(rng, 'both'); }},
    { id:'1.5', name:'Generalization', focus:'Animals, not geometry', isGen:true, fallback:'glowTarget',
      make(rng){
        const [base, odd] = pick2(rng, ['dog','cat','elephant','bird']);
        const c1 = pick(rng, ['sea','grape','tang']); const c2 = c1;
        const genOrder = shuffle(rng, [0,1,2,3]);
        const mkTest = t => {
          const n = 4, xs = rowXs(n), ti = genOrder[t];
          return tapTrial({ state:'GENERALIZE', prompt:'Tap the different one', say:'One is different! Tap the different one.',
            elements: xs.map((x,i) => elShape(i===ti?'target':'d'+i,
              SIL[i===ti?odd:base](C[i===ti?c2:c1]), x, 52, 17,
              { tappable:true, target:i===ti, meta:{kind:i===ti?odd:base} })) });
        };
        return {
          expose: watchTrial({ state:'EXPOSE', prompt:'Same', say:'Look! Two ' + base + 's. The same.',
            elements:[ elShape('a', SIL[base](C[c1]), 38, 50, 19), elShape('b', SIL[base](C[c1]), 62, 50, 19) ]}),
          contrast: watchTrial({ state:'CONTRAST', prompt:'Different', say:'A '+base+' and a '+odd+'. Different!',
            elements:[ elShape('a', SIL[base](C[c1]), 38, 50, 19), elShape('b', SIL[odd](C[c1]), 62, 50, 19) ]}),
          tests:[mkTest(0), mkTest(1), mkTest(2)],
        };
      }},
  ],
},
{
  key:'magnitude', num:3, title:'Big & Small', parentName:'Magnitude',
  tag:'Relative size, apart from shape', prereqs:['identity'],
  levels:[
    { id:'2.1', name:'Extreme contrast', focus:'Huge vs tiny', fallback:'growTarget',
      make(rng){ return sizeLevel(rng, {big:46, small:10, ask:'big'}); }},
    { id:'2.2', name:'Moderate contrast', focus:'Closer sizes, asks for small', fallback:'shrinkSmall',
      make(rng){ return sizeLevel(rng, {big:26, small:16, ask:'small'}); }},
    { id:'2.3', name:'Generalization', focus:'Big vs small animal', isGen:true, fallback:'muteOther',
      make(rng){
        const an = pick(rng, ['elephant','dog','cat']);
        const c1 = pick(rng, ['grape','sea','tang']);
        const startFlip = rng() < .5;
        const mkTest = i => {
          const flip = (i % 2 === 0) === startFlip;
          const xs = [34, 70];
          return tapTrial({ state:'GENERALIZE', prompt:'Tap the big animal', say:'Tap the big animal!',
            elements:[
              elShape('target', SIL[an](C[c1]), xs[flip?1:0], [50,46,53][i]||50, [34,31,36][i]||34, {tappable:true, target:true}),
              elShape('d1', SIL[an](C[c1]), xs[flip?0:1], [62,66,58][i]||62, [12,13,11][i]||12, {tappable:true}),
            ]});
        };
        return {
          expose: watchTrial({ state:'EXPOSE', prompt:'Big', say:'Look — a big '+an+'!',
            elements:[ elShape('a', SIL[an](C[c1]), 50, 50, 38) ]}),
          contrast: watchTrial({ state:'CONTRAST', prompt:'Small', say:'Now a small '+an+'.',
            elements:[ elShape('a', SIL[an](C[c1]), 50, 56, 12) ]}),
          tests:[mkTest(0), mkTest(1), mkTest(2)],
        };
      }},
  ],
},
{
  key:'quantity', num:4, title:'More & Less', parentName:'Quantity',
  tag:'Seeing amounts without counting', prereqs:['identity'],
  levels:[
    { id:'3.1', name:'Extreme delta', focus:'1 vs 5', fallback:'grayWrong',
      make(rng){ return quantityLevel(rng, {pairs:[[1,5],[1,6],[2,6]], ask:'more', item:'apple'}); }},
    { id:'3.2', name:'Subitizing threshold', focus:'2 vs 4', fallback:'grayWrong',
      make(rng){ return quantityLevel(rng, {pairs:[[2,4],[3,5],[2,5]], ask:'more', item:'apple'}); }},
    { id:'3.3', name:'Generalization', focus:'Fewer cars — flipped question', isGen:true, fallback:'pulseTarget',
      make(rng){ return quantityLevel(rng, {pairs:[[3,6],[2,5],[4,6]], ask:'less', item:'car'}); }},
  ],
},
{
  key:'spatial', num:5, title:'In & Out', parentName:'Spatial',
  tag:'Containment — drag things where they belong', prereqs:['magnitude'],
  levels:[
    { id:'4.1', name:'Gross proximity', focus:'Ball into a big box', fallback:'demoDrag',
      make(rng){
        const bc = pick(rng, ['coral','grass','grape']);
        // "repetitive with change": same task three times, but the box moves
        // sides, shrinks a little, and the ball starts farther away — a small
        // fresh struggle each round instead of an identical replay
        const mkTest = i => {
          const boxRight = rng() < .5;
          const boxS = [46, 42, 38][i];
          const color = pick(rng, ['coral','grass','grape','sun']);
          return dragTrial({ state:'TEST', prompt:'Put the ball in the box', say:'Put the ball in the box!',
            elements:[
              elShape('box', BOX(), boxRight ? 64 : 36, 50, boxS, {scenery:true}),
              elShape('ball', BALL(C[color]), boxRight ? 18 - i*3 : 82 + i*3, [60, 64, 66][i], 15, {piece:true}),
            ],
            pieces:[{ el:'ball', slot:'box', snap: [16, 14, 12][i], dropIn:true }]});
        };
        return {
          expose: watchTrial({ state:'EXPOSE', prompt:'In', say:'The ball is in the box.',
            elements:[ elShape('box', BOX(), 50, 50, 44, {scenery:true}), elShape('ball', BALL(C[bc]), 50, 56, 15) ]}),
          contrast: watchTrial({ state:'CONTRAST', prompt:'Out', say:'Now the ball is out of the box.',
            elements:[ elShape('box', BOX(), 60, 50, 44, {scenery:true}), elShape('ball', BALL(C[bc]), 18, 62, 15) ]}),
          tests:[mkTest(0), mkTest(1), mkTest(2)],
        };
      }},
    { id:'4.2', name:'On top', focus:'The "on top of" relation — 2-inch wood cube physics', fallback:'demoDrag',
      make(rng){
        const scene = rest => ({ rest });
        const mkTest = i => {
          const flip = rng() < .5;
          // both blocks are grabbable — whichever one the child picks up, the
          // OTHER becomes the support; neither block is special
          return Object.assign({
            kind:'stack', state:'TEST', prompt:'Put a block on top',
            say:'Put a block on top of the other block!', timeoutMs: 16000,
            stackGoal: 1,
            elements:[
              elShape('ground', '', 50, 72, 76, {scenery:true, decor:true, groundBar:true}),
              elShape('blockA', WOOD_BLOCK('#C08847'), (flip?63:37)+[0,-5,4][i], 68, 15, {piece:true}),
              elShape('blockB', WOOD_BLOCK('#DFA75F'), (flip?19:81)+[0,6,-4][i], 66, 15, {piece:true}),
            ],
            pieces:[
              { el:'blockA', slot:'blockB', snap:0, slotDy:-13 },
              { el:'blockB', slot:'blockA', snap:0, slotDy:-13 },
            ],
            stackScene: scene({ blockA:'floor', blockB:'floor' }),
          });
        };
        return {
          expose: Object.assign(watchTrial({ state:'EXPOSE', prompt:'On top', say:'Look! The block is on top of the other block.',
            elements:[
              elShape('ground', '', 50, 72, 76, {scenery:true, decor:true, groundBar:true}),
              elShape('base', WOOD_BLOCK('#C08847'), 50, 68, 15, {scenery:true}),
              elShape('block', WOOD_BLOCK('#DFA75F'), 50, 50, 15, {scenery:true}),
            ]}), { stackScene: scene({ base:'floor', block:'base' }) }),
          contrast: Object.assign(watchTrial({ state:'CONTRAST', prompt:'Next to', say:'Now it is next to the block. Not on top.',
            elements:[
              elShape('ground', '', 50, 72, 76, {scenery:true, decor:true, groundBar:true}),
              elShape('base', WOOD_BLOCK('#C08847'), 42, 68, 15, {scenery:true}),
              elShape('block', WOOD_BLOCK('#DFA75F'), 62, 68, 15, {scenery:true}),
            ]}), { stackScene: scene({ base:'floor', block:'floor' }) }),
          tests:[mkTest(0), mkTest(1), mkTest(2)],
        };
      }},
    { id:'4.3', name:'Precision containment', focus:'Star into star hole', fallback:'expandSnap',
      make(rng){
        const pc = pick(rng, ['sun','coral','grass']);
        const startTop = rng() < .5;
        const mkTest = i => {
          const starTop = (i % 2 === 0) === startTop;
          const hx = [66, 60, 72][i] || 66;
          return dragTrial({ state:'TEST', prompt:'Fit the star in its hole', say:'Fit the star into its hole!',
            elements:[
              elShape('hole', STAR_HOLE(), hx, starTop?32:66, 20, {scenery:true}),
              elShape('decoy', CIRC_HOLE(), hx, starTop?66:32, 20, {scenery:true}),
              elShape('star', SHAPES.star(C[pc]), [17,14,22][i]||17, [52,42,62][i]||52, 18, {piece:true}),
            ],
            pieces:[{ el:'star', slot:'hole', snap: 7 }], decoys:['decoy']});
        };
        return {
          expose: watchTrial({ state:'EXPOSE', prompt:'It fits', say:'The star fits in the star hole!',
            elements:[ elShape('hole', STAR_HOLE(), 50, 50, 20, {scenery:true}), elShape('star', SHAPES.star(C[pc]), 50, 50, 18) ]}),
          contrast: watchTrial({ state:'CONTRAST', prompt:'It is out', say:'Now the star is out.',
            elements:[ elShape('hole', STAR_HOLE(), 64, 44, 20, {scenery:true}), elShape('star', SHAPES.star(C[pc]), 22, 60, 18) ]}),
          tests:[mkTest(0), mkTest(1), mkTest(2)],
        };
      }},
    { id:'4.4', name:'Generalization', focus:'Bird into nest', isGen:true, fallback:'muteOther',
      make(rng){
        const startRight = rng() < .5;
        // bird sits IN the nest by resting fully opaque ON TOP of the bowl —
        // the resting position (nest y − 5) tucks it into the opening. Expose
        // shows exactly the finished state.
        const restY = ny => ny - 5;
        const mkTest = i => {
          const nestRight = (i % 2 === 0) === startRight;
          const nx = (nestRight?68:32) + [0,-6,5][i];
          const ny = [58,52,62][i] || 58;
          return dragTrial({ state:'GENERALIZE', prompt:'Put the bird in the nest', say:'Put the bird in the nest!',
            elements:[
              elShape('nest', SIL.nest('#B98B5E'), nx, ny, 26, {scenery:true}),
              elShape('tree', SHAPES.circle('#8FCF9F'), nestRight?30:70, 34, 22, {scenery:true, decor:true}),
              elShape('bird', SIL.bird(C.sea), nestRight?16:84, [24,40,18][i]||24, 15, {piece:true}),
            ],
            pieces:[{ el:'bird', slot:'nest', snap: 11, slotDy:-5 }]});
        };
        return {
          expose: watchTrial({ state:'EXPOSE', prompt:'In the nest', say:'The bird is in its nest.',
            elements:[ elShape('nest', SIL.nest('#B98B5E'), 50, 58, 26, {scenery:true}),
                       elShape('bird', SIL.bird(C.sea), 50, restY(58), 14) ]}),
          contrast: watchTrial({ state:'CONTRAST', prompt:'Out of the nest', say:'Now the bird flew out!',
            elements:[ elShape('nest', SIL.nest('#B98B5E'), 62, 62, 26, {scenery:true}),
                       elShape('bird', SIL.bird(C.sea), 24, 28, 14) ]}),
          tests:[mkTest(0), mkTest(1), mkTest(2)],
        };
      }},
  ],
},
{
  key:'composition', num:6, title:'Build It', parentName:'Composition',
  tag:'Pieces make a whole', prereqs:['spatial'],
  levels:[
    { id:'5.1', name:'Symmetrical halves', focus:'Two halves meet', fallback:'magnetSnap',
      make(rng){
        const cc = pick(rng, ['tang','grape','grass']);
        const mkTest = i => dragTrial({ state:'TEST', prompt:'Put them together', say:'Put the two halves together!',
          elements:[
            elShape('left', HALF_L(C[cc]), [40, 44, 37][i], [50, 46, 54][i], 26, {scenery:true, anchor:true}),
            elShape('right', HALF_R(C[cc]), [78, 72, 82][i], [58, 46, 64][i], 26, {piece:true}),
          ],
          pieces:[{ el:'right', slot:'left', snap: [8, 7, 6][i], overlay:true }]});
        return {
          expose: watchTrial({ state:'EXPOSE', prompt:'Whole', say:'A whole circle.',
            elements:[ elShape('a', SHAPES.circle(C[cc]), 50, 50, 26) ]}),
          contrast: watchTrial({ state:'CONTRAST', prompt:'Pieces', say:'Now it is in pieces.',
            elements:[ elShape('a', HALF_L(C[cc]), 36, 50, 26), elShape('b', HALF_R(C[cc]), 68, 54, 26) ]}),
          tests:[mkTest(0), mkTest(1), mkTest(2)],
        };
      }},
    { id:'5.2', name:'Asymmetrical pieces', focus:'Puzzle-cut square', fallback:'flashWhole',
      make(rng){
        const cc = pick(rng, ['sea','coral','sun']);
        const mkTest = i => dragTrial({ state:'TEST', prompt:'Finish the square', say:'Finish the square! Put the piece in.',
          elements:[
            elShape('left', PUZ_L(C[cc]), [40, 43, 37][i], [50, 46, 54][i], 28, {scenery:true, anchor:true}),
            elShape('right', PUZ_R2(C[cc]), [79, 73, 83][i], [56, 46, 62][i], 28, {piece:true}),
          ],
          pieces:[{ el:'right', slot:'left', snap: [6, 5.5, 5][i], overlay:true }],
          whole: SHAPES.square(C[cc])});
        return {
          expose: watchTrial({ state:'EXPOSE', prompt:'Whole', say:'A whole square.',
            elements:[ elShape('a', SHAPES.square(C[cc]), 50, 50, 26) ]}),
          contrast: watchTrial({ state:'CONTRAST', prompt:'Pieces', say:'It broke into puzzle pieces!',
            elements:[ elShape('a', PUZ_L(C[cc]), 36, 50, 28), elShape('b', PUZ_R2(C[cc]), 70, 54, 28) ]}),
          tests:[mkTest(0), mkTest(1), mkTest(2)],
        };
      }},
    { id:'5.3', name:'Tower', focus:'Stack three blocks tall — the support rises with the tower', fallback:'demoDrag',
      make(rng){
        const scene = rest => ({ rest });
        const mkTest = i => {
          const baseLeft = rng() < .5;
          return Object.assign({
            kind:'stack', state:'TEST', prompt:'Build a tower',
            say:'Stack the blocks! Build a tall tower!', timeoutMs: 20000,
            elements:[
              elShape('ground', '', 50, 72, 76, {scenery:true, decor:true, groundBar:true}),
              // all three blocks are grabbable — no special immovable base; the
              // child stacks them in any order, success = all three in one stack
              elShape('base', WOOD_BLOCK('#C08847'), baseLeft?42:58, 68, 14, {piece:true}),
              elShape('blockA', WOOD_BLOCK('#DFA75F'), baseLeft?76:24, 66, 14, {piece:true}),
              elShape('blockB', WOOD_BLOCK('#E8B36B'), baseLeft?[88,16][i%2]:[12,84][i%2], 66, 14, {piece:true}),
            ],
            pieces:[
              { el:'blockA', slot:'base', snap:0, slotDy:-12 },
              { el:'blockB', slot:'base', snap:0, slotDy:-24 },
            ],
            stackScene: scene({ base:'floor', blockA:'floor', blockB:'floor' }),
          });
        };
        return {
          expose: Object.assign(watchTrial({ state:'EXPOSE', prompt:'A tower!', say:'Look! A tower of blocks!',
            elements:[
              elShape('ground', '', 50, 72, 76, {scenery:true, decor:true, groundBar:true}),
              elShape('base', WOOD_BLOCK('#C08847'), 50, 68, 14, {scenery:true}),
              elShape('blockA', WOOD_BLOCK('#DFA75F'), 50, 52, 14, {scenery:true}),
              elShape('blockB', WOOD_BLOCK('#E8B36B'), 50, 36, 14, {scenery:true}),
            ]}), { stackScene: scene({ base:'floor', blockA:'base', blockB:'blockA' }) }),
          contrast: Object.assign(watchTrial({ state:'CONTRAST', prompt:'All fallen down', say:'Oh no, the tower fell down! The blocks are all apart.',
            elements:[
              elShape('ground', '', 50, 72, 76, {scenery:true, decor:true, groundBar:true}),
              elShape('base', WOOD_BLOCK('#C08847'), 30, 68, 14, {scenery:true}),
              elShape('blockA', WOOD_BLOCK('#DFA75F'), 54, 66, 14, {scenery:true}),
              elShape('blockB', WOOD_BLOCK('#E8B36B'), 74, 66, 14, {scenery:true}),
            ]}), { stackScene: scene({ base:'floor', blockA:'floor', blockB:'floor' }) }),
          tests:[mkTest(0), mkTest(1)],
        };
      }},
    { id:'5.4', name:'Generalization', focus:'Build a house from 3 parts', isGen:true, fallback:'lockMost',
      make(rng){
        const jitter = Math.round(rng()*10 - 5);
        const mkTest = i => dragTrial({ state:'GENERALIZE', prompt:'Build the house', say:'Build the house! Put every piece in its place.',
          elements:[
            elShape('outline', HOUSE.outline(), (i ? 38 : 62) + jitter, 48, 36, {scenery:true, anchor:true}),
            elShape('roof', HOUSE.roof(), i ? 85 : 15, i ? 78 : 26, 36, {piece:true}),
            elShape('body', HOUSE.body(), i ? 87 : 13, i ? 30 : 58, 36, {piece:true}),
            // the door spot, drawn AFTER the body so it stays visible on top of
            // the placed square; the door piece (next) covers it once placed
            elShape('doorspot', HOUSE.doorspot(), (i ? 38 : 62) + jitter, 48, 36, {scenery:true}),
            elShape('door', HOUSE.door(), i ? 78 : 22, i ? 55 : 84, 36, {piece:true}),
          ],
          pieces:[
            { el:'body', slot:'outline', snap: 8, overlay:true },
            { el:'roof', slot:'outline', snap: 8, overlay:true },
            { el:'door', slot:'outline', snap: 8, overlay:true },
          ]});
        return {
          expose: watchTrial({ state:'EXPOSE', prompt:'A house', say:'Look, a whole house!',
            elements:[
              elShape('r', HOUSE.roof(), 50, 48, 36), elShape('b', HOUSE.body(), 50, 48, 36), elShape('d', HOUSE.door(), 50, 48, 36) ]}),
          contrast: watchTrial({ state:'CONTRAST', prompt:'Pieces', say:'The house is in pieces.',
            elements:[
              elShape('r', HOUSE.roof(), 26, 34, 32), elShape('b', HOUSE.body(), 56, 60, 32), elShape('d', HOUSE.door(), 80, 34, 32) ]}),
          tests:[mkTest(0), mkTest(1)],
        };
      }},
  ],
},
{
  key:'peekaboo', num:7, title:'Peekaboo', parentName:'Peekaboo',
  tag:'Where did it go? Find the hidden one', prereqs:['identity'],
  levels:[
    { id:'6.1', name:'Two hiding spots', focus:'Watch it hide, then find it', fallback:'pulseTarget',
      make(rng){ return hideSeekLevel(rng, {n:2, objs:shuffle(rng,['duck','dog','ball','cat'])}); }},
    { id:'6.2', name:'Three hiding spots', focus:'One more spot to track', fallback:'pulseTarget',
      make(rng){ return hideSeekLevel(rng, {n:3, objs:shuffle(rng,['banana','apple','bear','frog'])}); }},
    { id:'6.3', name:'Shell game', focus:'Watch the covers shuffle, then find it', fallback:'pulseTarget',
      make(rng){ return hideSeekLevel(rng, {n:3, shuffle:true, objs:shuffle(rng,['duck','cat','ball','dog'])}); }},
    { id:'6.4', name:'Generalization', focus:'New things to find', isGen:true, fallback:'glowTarget',
      make(rng){ return hideSeekLevel(rng, {n:3, isGen:true, objs:shuffle(rng,['elephant','fish','flower','sun'])}); }},
  ],
},
{
  key:'letters', num:8, title:'ABC Magnets', parentName:'Letters',
  tag:'Plastic letters on a magnet board', prereqs:['spatial'],
  levels:[
    { id:'7.1', name:'Letter play', focus:'A letter is a thing with a name — tap it, hear it', fallback:'pulseTarget',
      make(rng){ return letterTapLevel(rng); }},
    { id:'7.2', name:'Which one is the A?', focus:'Discriminate one letterform from others', fallback:'pulseTarget',
      make(rng){ return letterFindLevel(rng, { n:3 }); }},
    { id:'7.3', name:'Tap them all', focus:'Every letter has its own spot — built by tapping, the gesture that always works', fallback:'pulseTarget',
      make(rng){ return letterTapPlaceLevel(rng); }},
    { id:'7.4', name:'Spell your name', focus:'The same placing, now by dragging — and the word is his own name', isGen:true, fallback:'magnetSnap',
      make(rng){ return letterBoardLevel(rng, { isGen:true }); }},
  ],
},
{
  key:'dressing', num:9, title:'Get Dressed', parentName:'Dressing',
  tag:'Every piece of clothing has its own place', prereqs:['identity'],
  levels:[
    { id:'8.1', name:'Pants on!', focus:'One garment, one place — the song made playable', fallback:'pulseTarget',
      make(rng){ return dressLevel(rng, { items:['pants'] }); }},
    { id:'8.2', name:'Get dressed', focus:'Three garments, each to its own part of the body', fallback:'pulseTarget',
      make(rng){ return dressLevel(rng, { items:['pants','shirt','hat'] }); }},
    { id:'8.3', name:'Generalization', focus:'The whole outfit, including two that share the feet', isGen:true, fallback:'glowTarget',
      make(rng){ return dressLevel(rng, { items:['pants','shirt','hat','socks','shoes'], isGen:true }); }},
  ],
},
];

/* Shared generators (the strict rulesets) */

export { NODES };

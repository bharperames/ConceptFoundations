/* ═══════════════════════ Magnetic alphabet letters ═══════════════════════
   The classic fridge/magnet-board set: chunky uppercase letters and digits
   moulded in four plastic colors. Each glyph is drawn as layered SVG text so
   it reads as a real injection-moulded piece rather than flat type:

     1. contact shadow — blurred dark copy, offset down (it sits ON a surface)
     2. chamfer wall   — the glyph grown outward by a round-joined stroke (kept
                         narrow: grow it far and the counters of an S or a G
                         close up and the piece reads as one bulb, not strokes),
                         in a mid→deep gradient: the moulded side wall you see
                         when looking slightly down at a piece. Round joins are
                         what make every corner a fillet.
     3. face           — the glyph grown a little less and filled top-lit, so
                         the wall stays visible as a thin darker band
     4. gloss          — a white sheen clipped to the raw glyph: a top-down
                         falloff plus one soft specular blob, upper left
     5. seat           — the same clip, darkened at the very bottom, so the
                         form rolls under instead of ending flat

   No outlines drawn INSIDE the glyph: an offset inner stroke reads as a second
   contour down the middle of a letter stroke and the piece stops looking solid.
   Everything is geometry + gradients (no raster, one blur), so a letter is
   crisp at any size — the same rule the rest of the art follows.

   Ids are per-instance, from a counter. They used to derive from char+color on
   the theory that duplicates would resolve to an identical definition — but the
   node icon on the HOME screen embeds an A, a B, a C… and a hidden view still
   owns its ids. A url(#…) then resolved into a display:none subtree, both the
   gradients and the clip came back empty, and the letter on the stage rendered
   as a bare shadow with an unclipped highlight floating over it. */

/* The four colors from a real magnet set. `light`/`mid` shape the face,
   `deep` is the moulded wall, `shade` the seat shadow under the fillet. */
const MAG = {
  red:    { base:'#E23B2E', light:'#FF9083', mid:'#C62B20', deep:'#93190F', shade:'#5E0D06' },
  blue:   { base:'#2073D6', light:'#86BCF8', mid:'#1659B0', deep:'#0C3F86', shade:'#07275A' },
  yellow: { base:'#F8C61C', light:'#FFEB8E', mid:'#E0A800', deep:'#AF7E00', shade:'#7A5500' },
  green:  { base:'#33AA50', light:'#8FE09E', mid:'#238F3F', deep:'#146B2C', shade:'#0B461C' },
};
const MAG_KEYS = Object.keys(MAG);

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const DIGITS  = '0123456789'.split('');
const GLYPHS  = [...LETTERS, ...DIGITS];

/* A rounded grotesque — the magnet-letter face. Every platform this ships to
   resolves at least one of these; the last resort is the system sans. */
const MFONT = "ui-rounded, 'SF Pro Rounded', 'Arial Rounded MT Bold', 'Nunito', 'Varela Round', 'Trebuchet MS', system-ui, sans-serif";
/* Cap height lands near 62 units of the 100-box at this size. Wide glyphs (M,
   W) run a few units past the box; .el svg is overflow:visible, and real magnet
   letters vary in width exactly this way. */
const MSIZE = 88;
/* 800 closed the spine of an S and the aperture of a G once the chamfer grew
   the glyph outward; 700 keeps the counters open at the same cap height. */
const MWEIGHT = 700;
const MY = 53;   // optical centre for caps under dominant-baseline:central

let seq = 0;
const uid = () => 'ml' + (++seq).toString(36);
/* one <text> layer — every layer draws the SAME glyph, so all the outlines,
   clips and highlights register perfectly */
const gtext = (ch, attrs, wrapAttrs = '') =>
  `<text ${wrapAttrs} x="50" y="${MY}" text-anchor="middle" dominant-baseline="central" ` +
  `font-family="${MFONT}" font-size="${MSIZE}" font-weight="${MWEIGHT}" ${attrs}>${ch}</text>`;

/* A single plastic magnet letter (or digit). `ch` is one uppercase character. */
function MAGNET_LETTER(ch, ck = 'red'){
  const c = MAG[ck] || MAG.red;
  const u = uid();
  return `<svg viewBox="0 0 100 100" aria-hidden="true">
  <defs>
    <linearGradient id="mf${u}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${c.light}"/><stop offset=".22" stop-color="${c.base}"/>
      <stop offset=".74" stop-color="${c.base}"/><stop offset="1" stop-color="${c.mid}"/>
    </linearGradient>
    <linearGradient id="mw${u}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${c.mid}"/><stop offset="1" stop-color="${c.deep}"/>
    </linearGradient>
    <linearGradient id="mg${u}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".34"/>
      <stop offset=".34" stop-color="#fff" stop-opacity=".07"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="mb${u}" x1="0" y1="0" x2="0" y2="1">
      <stop offset=".6" stop-color="${c.shade}" stop-opacity="0"/>
      <stop offset="1" stop-color="${c.shade}" stop-opacity=".3"/>
    </linearGradient>
    <clipPath id="mc${u}">${gtext(ch, '')}</clipPath>
    <filter id="ms${u}" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="2.6"/>
    </filter>
  </defs>
  <g class="hit">
    <g filter="url(#ms${u})" opacity=".28">
      ${gtext(ch, `fill="#1B1208" stroke="#1B1208" stroke-width="3.8" stroke-linejoin="round"`, 'transform="translate(0,2.8)"')}
    </g>
    ${gtext(ch, `class="hit" fill="url(#mw${u})" stroke="url(#mw${u})" stroke-width="3.8" stroke-linejoin="round"`)}
    ${gtext(ch, `class="hit" fill="url(#mf${u})" stroke="url(#mf${u})" stroke-width="1.5" stroke-linejoin="round"`)}
    <g clip-path="url(#mc${u})">
      <rect x="-10" y="-6" width="120" height="112" fill="url(#mg${u})"/>
      <rect x="-10" y="-6" width="120" height="112" fill="url(#mb${u})"/>
      <ellipse cx="33" cy="24" rx="21" ry="9" fill="#fff" opacity=".13" transform="rotate(-20 33 24)"/>
    </g>
  </g></svg>`;
}

/* The spot a letter belongs in: the same glyph, recessed into the board — a
   shallow hole with a dashed rim and a shadow along its top edge, so it reads
   as cut INTO the steel rather than printed on it. Drawn at the same silhouette
   as a letter's face, so a placed letter covers its spot exactly. The tones are
   theme vars: the spot has to stay legible on the night board too. */
function LETTER_GHOST(ch){
  const u = uid();
  return `<svg viewBox="0 0 100 100" aria-hidden="true">
  <defs><clipPath id="${u}">${gtext(ch, '')}</clipPath></defs>
  ${gtext(ch, `fill="var(--ghost-fill)" stroke="var(--ghost-fill)" stroke-width="1.5" stroke-linejoin="round"`)}
  ${gtext(ch, `fill="none" stroke="var(--ghost-line)" stroke-width="2.4" stroke-linejoin="round" stroke-dasharray="6 5"`)}
  <g clip-path="url(#${u})">
    ${gtext(ch, `fill="none" stroke="var(--ghost-shade)" stroke-width="3.2" stroke-linejoin="round"`, 'transform="translate(0,1.8)"')}
  </g></svg>`;
}

/* Home-card icon for the node: three magnets on a board. */
const LETTERS_ICON = `<svg class="cicon" viewBox="0 0 100 100">
  <rect x="6" y="16" width="88" height="68" rx="9" fill="#EDF3F8" stroke="#BCCFDF" stroke-width="3"/>
  <g transform="translate(6,20) scale(.30)">${MAGNET_LETTER('A','red')}</g>
  <g transform="translate(35,20) scale(.30)">${MAGNET_LETTER('B','blue')}</g>
  <g transform="translate(64,20) scale(.30)">${MAGNET_LETTER('C','green')}</g>
  <g transform="translate(20,48) scale(.24)">${MAGNET_LETTER('1','yellow')}</g>
  <g transform="translate(48,48) scale(.24)">${MAGNET_LETTER('2','green')}</g>
</svg>`;

/* How a glyph is handed to the speech engine.

   Handed an uppercase "E" every engine announces "capital E" — the case is
   information it insists on reading out. Handed the lowercase "e" it just says
   the letter, which is what we want, so LOWERCASE IS THE DEFAULT.

   A few letters need more than that, because lowercase turns them into common
   words: "a" becomes the article ("uh"), "i" the pronoun. Those get an explicit
   override below. Respelling is NOT a general escape hatch — `say` renders
   "ay", "aye" and "eye" to byte-identical audio, so no spelling of A can be
   told apart from I. The overrides are tuned BY EAR, one at a time; anything
   not listed here is simply its lowercase self.

   Captions are unaffected: they always show the glyph (see sayGlyph's callers,
   which pass the letter itself to the trial prompt). */
const SAY_OVERRIDE = {
  // filled in from listening — scratchpad/audition.html plays every candidate
};
const sayGlyph = ch => SAY_OVERRIDE[ch] || String(ch).toLowerCase();

/* Pairs a 2-year-old genuinely trips on — by SIGHT (E/F, M/W, B/D…) and by
   SOUND, since the letter names are spoken: "see" and "zee" differ only by
   voicing and a synthesized voice barely separates them. A trial never puts
   two glyphs from the same pair on the board together, so a miss means "I
   don't know this letter yet", not "those two were indistinguishable". */
const CONFUSABLE = [
  ['E','F'], ['M','W'], ['M','N'], ['O','Q'], ['O','D'], ['O','G'], ['O','C'],
  ['P','R'], ['P','B'], ['B','D'], ['B','8'], ['I','L'], ['I','T'], ['I','J'],
  ['I','1'], ['U','V'], ['V','Y'], ['V','W'], ['C','G'], ['K','X'], ['S','Z'],
  ['S','5'], ['G','6'], ['Z','2'], ['O','0'], ['Q','0'],
  // sound-alikes: "see"/"zee", "gee"/"zee", "bee"/"pee"/"dee"/"tee"/"vee"
  ['C','Z'], ['G','Z'], ['B','P'], ['B','V'], ['D','T'], ['J','K'],
];
const confusable = (a, b) => CONFUSABLE.some(p => (p[0] === a && p[1] === b) || (p[0] === b && p[1] === a));

/* The letters a toddler meets first. Two filters, both deliberate:

   SOUND — speech acquisition runs /m/ /b/ /p/ /d/ /n/ /t/ /h/ /w/ /k/ /g/ long
   before /s/ /z/ /r/ /l/ /v/ /f/. A letter whose name he can already say is one
   he can echo back and own; M and D lead (mama, dada). The late consonants —
   Z, X, R, L, C, V, F — are left out of the early pool entirely, which also
   retires the "zee"/"see" clash before it can happen.

   SHAPE — high-contrast silhouettes; near-twins are kept apart by CONFUSABLE. */
const EARLY_LETTERS = ['M','D','B','P','N','T','H','K','W','G','A','O','E','S'];

/* The child's own name — the first symbols that mean something personal, and
   three of the four are early sounds too. The letter a trial ASKS for is drawn
   from here; the letters it asks him to reject come from the wider early pool,
   so the answer stays familiar while the field keeps changing. */
const CHILD_NAME = 'Sean';
const NAME_LETTERS = CHILD_NAME.toUpperCase().split('');

/* Pick n glyphs from `pool` with no confusable pair among them. `seed` glyphs
   are taken as already-chosen (they count toward n and constrain the rest), so
   a caller can fix the target and let this fill safe distractors around it. */
function pickGlyphs(rng, n, pool = EARLY_LETTERS, seed = []){
  const bag = pool.slice();
  for (let i = bag.length - 1; i > 0; i--){
    const j = Math.floor(rng() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  const out = seed.slice(0, n);
  for (const ch of bag){
    if (out.length >= n) break;
    if (!out.includes(ch) && out.every(o => !confusable(o, ch))) out.push(ch);
  }
  // pool too small / too tangled to fill n cleanly — top up with whatever is left
  for (const ch of bag){ if (out.length >= n) break; if (!out.includes(ch)) out.push(ch); }
  return out;
}
/* n glyphs whose FIRST entry is a letter of the child's name. */
const pickNamed = (rng, n, lead = 1) =>
  pickGlyphs(rng, n, EARLY_LETTERS, pickGlyphs(rng, lead, NAME_LETTERS));

/* n distinct magnet colors, in a shuffled order. */
function pickColors(rng, n, exclude = []){
  const bag = MAG_KEYS.filter(k => !exclude.includes(k));
  for (let i = bag.length - 1; i > 0; i--){
    const j = Math.floor(rng() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  const out = [];
  while (out.length < n) out.push(bag[out.length % bag.length]);
  return out;
}

export { MAG, MAG_KEYS, LETTERS, DIGITS, GLYPHS, EARLY_LETTERS, NAME_LETTERS, CHILD_NAME,
         MAGNET_LETTER, LETTER_GHOST, LETTERS_ICON, pickGlyphs, pickNamed, pickColors, confusable, sayGlyph };

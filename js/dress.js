/* ═══════════════════════ Getting dressed ═══════════════════════════════════
   A toddler and their clothes, for the tap-to-place levels in Node 8.

   Everything here — the child, each garment, and each empty spot — is drawn in
   ONE shared 100×100 space, at the position it finally occupies on the body.
   That is what makes a garment land correctly: the figure and the spot are
   rendered as the same size element at the same place, so "on the legs" is
   baked into the artwork rather than into a stage-% position that would drift
   apart from the body as the screen changes shape. (`HOUSE` in art.js works the
   same way, for the same reason.)

   A garment therefore needs to appear in two places: on the body, and waiting
   in the tray below. Rather than draw it twice, the tray copy is the SAME
   artwork with its <svg> translated so the garment sits centred in its box —
   see CENTRE and `.el.dress-loose` in the stylesheet. Letting go of that
   translation is the animation: the garment slides from the tray onto the body
   in one move, because both states are the same drawing.

   Translating the <svg> rather than the element is deliberate: .el.appear
   animates the element's transform with fill-mode:both, and its final keyframe
   would win against anything declared here.

   No import from art.js: art.js pulls DRESS_ICON from here for the home card,
   and a cycle would leave the palette undefined while this module's top level
   is still running. Clothes get their own colours anyway — laundry, not the
   geometry palette. (letters.js is a leaf for the same reason.) */

const wrap = inner => `<svg viewBox="0 0 100 100" aria-hidden="true">${inner}</svg>`;
const H = 'class="hit"';   // painted-only hit testing: taps land on cloth, not on the box

const SKIN = '#F2C9A0', SKIN_D = '#DDAE81', HAIR = '#6B4A2F';

/* The child: bare, arms out, ready to be dressed. Drawn once and never moves,
   so every garment's position can be authored against it directly. */
const FIGURE = () => wrap(`<g>
  <ellipse cx="50" cy="94" rx="19" ry="3.4" fill="#1E3350" opacity=".16"/>
  <!-- legs -->
  <rect x="40" y="56" width="8.4" height="30" rx="4.2" fill="${SKIN}"/>
  <rect x="51.6" y="56" width="8.4" height="30" rx="4.2" fill="${SKIN}"/>
  <ellipse cx="43" cy="88" rx="6.6" ry="4.4" fill="${SKIN}"/>
  <ellipse cx="57" cy="88" rx="6.6" ry="4.4" fill="${SKIN}"/>
  <!-- arms -->
  <path d="M39 40 L27 54" stroke="${SKIN}" stroke-width="8.6" stroke-linecap="round" fill="none"/>
  <path d="M61 40 L73 54" stroke="${SKIN}" stroke-width="8.6" stroke-linecap="round" fill="none"/>
  <!-- body -->
  <rect x="36" y="33" width="28" height="28" rx="11" fill="${SKIN}"/>
  <ellipse cx="50" cy="59" rx="14" ry="6" fill="${SKIN_D}" opacity=".5"/>
  <circle cx="50" cy="52" r="1.9" fill="${SKIN_D}"/>
  <!-- head -->
  <circle cx="36.5" cy="20" r="3.6" fill="${SKIN_D}"/>
  <circle cx="63.5" cy="20" r="3.6" fill="${SKIN_D}"/>
  <circle cx="50" cy="19" r="14.5" fill="${SKIN}"/>
  <path d="M36 14 A14.5 14.5 0 0 1 64 14 Q50 9 36 14 Z" fill="${HAIR}"/>
  <path d="M50 5.5 Q54 3 55.5 7" stroke="${HAIR}" stroke-width="2.6" fill="none" stroke-linecap="round"/>
  <circle cx="44.6" cy="20" r="2.1" fill="#33302C"/>
  <circle cx="55.4" cy="20" r="2.1" fill="#33302C"/>
  <circle cx="45.3" cy="19.3" r=".7" fill="#fff"/>
  <circle cx="56.1" cy="19.3" r=".7" fill="#fff"/>
  <path d="M45.5 25.5 Q50 29 54.5 25.5" stroke="#B9714F" stroke-width="2.2" fill="none" stroke-linecap="round"/>
  <circle cx="39.5" cy="24.5" r="2.6" fill="#F09B8C" opacity=".55"/>
  <circle cx="60.5" cy="24.5" r="2.6" fill="#F09B8C" opacity=".55"/>
</g>`);

/* Each garment, at the place it belongs. `paths(color, marker)` is shared by
   the worn version and the empty spot so the two can never drift apart. */
const GARMENT = {
  pants: {
    name: 'pants', where: 'legs', centre: [50, 68],
    paths: (c, m) => `<g ${m}>
      <path ${m} d="M36 54 L64 54 L63 66 L60.5 84 L52.4 84 L50 68 L47.6 84 L39.5 84 L37 66 Z"
        fill="${c}" stroke="${c}" stroke-width="3" stroke-linejoin="round"/>
      <rect ${m} x="35" y="52.5" width="30" height="6" rx="3" fill="${c}"/>
      <path d="M35.6 56 H64.4" stroke="#000" stroke-opacity=".13" stroke-width="1.6"/>
    </g>`,
  },
  shirt: {
    name: 'shirt', where: 'tummy', centre: [50, 43],
    paths: (c, m) => `<g ${m}>
      <path ${m} d="M40 31 L60 31 L74 46 L68 52 L64 47 L64 60 L36 60 L36 47 L32 52 L26 46 Z"
        fill="${c}" stroke="${c}" stroke-width="3" stroke-linejoin="round"/>
      <path d="M43 31.5 Q50 37 57 31.5" fill="none" stroke="#000" stroke-opacity=".15" stroke-width="2"/>
    </g>`,
  },
  hat: {
    name: 'hat', where: 'head', centre: [50, 11],
    paths: (c, m) => `<g ${m}>
      <path ${m} d="M35 15 A15 15 0 0 1 65 15 Z" fill="${c}"/>
      <rect ${m} x="33" y="13.5" width="34" height="6" rx="3" fill="${c}"/>
      <circle ${m} cx="50" cy="1.5" r="3.4" fill="${c}"/>
      <rect x="34" y="15" width="32" height="2.4" fill="#000" opacity=".12"/>
    </g>`,
  },
  socks: {
    name: 'socks', where: 'feet', centre: [50, 84],
    paths: (c, m) => `<g ${m}>
      <path ${m} d="M39.4 78 h7.6 v6 a6.6 4.6 0 0 1-13.2 0 a6.6 4.6 0 0 1 5.6-4.5 Z" fill="${c}"/>
      <path ${m} d="M53 78 h7.6 v6 a6.6 4.6 0 0 1-13.2 0 a6.6 4.6 0 0 1 5.6-4.5 Z" fill="${c}"/>
      <path d="M39.5 79.5 h7 M53.2 79.5 h7" stroke="#fff" stroke-opacity=".45" stroke-width="1.8"/>
    </g>`,
  },
  shoes: {
    name: 'shoes', where: 'feet', centre: [50, 87],
    paths: (c, m) => `<g ${m}>
      <path ${m} d="M38.6 81 h8 v4.4 a7.4 5.4 0 0 1-14.8 0 a7.4 5.4 0 0 1 6.8-5.2 Z" fill="${c}"/>
      <path ${m} d="M53.4 81 h8 v4.4 a7.4 5.4 0 0 1-14.8 0 a7.4 5.4 0 0 1 6.8-5.2 Z" fill="${c}"/>
      <path d="M32 88 a7.4 5.4 0 0 0 14.6 0 Z M46.6 88 a7.4 5.4 0 0 0 14.6 0 Z" fill="#fff" opacity=".8"/>
    </g>`,
  },
};
const GARMENT_KEYS = Object.keys(GARMENT);

/* Worn, or waiting in the tray — the same drawing either way. The inherited
   stroke grows the cloth by ~1.3 units, just enough to cover the dashed rim of
   the spot underneath it; without it the spot's outline fringes out around a
   garment that has, in fact, landed perfectly. Details carrying their own
   stroke are unaffected. */
const DRESS_ITEM = (key, color) => wrap(
  `<g stroke="${color}" stroke-width="2.6" stroke-linejoin="round">${GARMENT[key].paths(color, H)}</g>`);

/* The empty spot: the same silhouette, dashed and recessed into the body, so
   what to do is legible before a word is spoken. Theme vars — the spots have
   to stay visible on the night surface too. */
const DRESS_SPOT = key => wrap(`<g>
  ${GARMENT[key].paths('var(--ghost-fill)', '')}
  <g fill="none" stroke="var(--ghost-line)" stroke-width="2" stroke-linejoin="round" stroke-dasharray="5 4">
    ${GARMENT[key].paths('none', '')}
  </g>
</g>`);

/* How far a garment sits from the centre of the shared box, as a percentage of
   the box — exactly the offset the tray copy has to undo. */
const CENTRE = key => ({
  ox: (GARMENT[key].centre[0] - 50) + '%',
  oy: (GARMENT[key].centre[1] - 50) + '%',
});

/* A drawer of clothes: deeper and more varied than the geometry palette, and
   every pair distinguishable to a red/green-blind eye. */
const CLOTH = { denim:'#3E6FD8', berry:'#E2496B', sunflower:'#F5B723',
                moss:'#3FA85C', plum:'#8E63D6', clay:'#E27A3F' };
const DRESS_COLORS = Object.keys(CLOTH);
const dressColor = k => CLOTH[k] || CLOTH.denim;

/* Home-card icon: a hat, a shirt and a pair of pants on the line. */
const DRESS_ICON = `<svg class="cicon" viewBox="0 0 100 100">
  <path d="M6 24 Q50 32 94 24" fill="none" stroke="#BCCFDF" stroke-width="3" stroke-linecap="round"/>
  <g transform="translate(-32,14) scale(.62)">${DRESS_ITEM('shirt', CLOTH.denim)}</g>
  <g transform="translate(30,2) scale(.62)">${DRESS_ITEM('pants', CLOTH.berry)}</g>
  <g transform="translate(4,46) scale(.62)">${DRESS_ITEM('hat', CLOTH.sunflower)}</g>
</svg>`;

export { FIGURE, GARMENT, GARMENT_KEYS, DRESS_ITEM, DRESS_SPOT, CENTRE,
         DRESS_COLORS, dressColor, DRESS_ICON };

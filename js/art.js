import { $ } from './core.js';
import { LETTERS_ICON } from './letters.js';

const C = { sea:'#3D8BFF', coral:'#FF5D55', sun:'#FFC02E', grass:'#33C06A', grape:'#9B6DF2', tang:'#FF8A3C' };
const COLOR_KEYS = Object.keys(C);
/* CVD-distinct outlier pairs for color-isolation levels (strict ruleset pool) */
const COLOR_PAIRS = [['sea','tang'], ['grape','sun'], ['sea','coral'], ['grass','grape']];

const wrap = inner => `<svg viewBox="0 0 100 100" aria-hidden="true">${inner}</svg>`;
const H = 'class="hit"'; // painted-hit marker for drag trials

const SHAPES = {
  circle : c => wrap(`<circle ${H} cx="50" cy="50" r="44" fill="${c}"/>`),
  square : c => wrap(`<rect ${H} x="10" y="10" width="80" height="80" rx="16" fill="${c}"/>`),
  triangle:c => wrap(`<path ${H} d="M50 14 L89 82 L11 82 Z" fill="${c}" stroke="${c}" stroke-width="12" stroke-linejoin="round"/>`),
  star   : c => wrap(`<path ${H} d="M50 8 L60.5 39.5 L94 39.5 L67 59 L77.5 90 L50 70.5 L22.5 90 L33 59 L6 39.5 L39.5 39.5 Z" fill="${c}" stroke="${c}" stroke-width="8" stroke-linejoin="round"/>`),
  heart  : c => wrap(`<path ${H} d="M50 88 C20 64 8 46 8 32 C8 18 19 10 30 10 C39 10 46 15 50 22 C54 15 61 10 70 10 C81 10 92 18 92 32 C92 46 80 64 50 88 Z" fill="${c}"/>`),
};
const SHAPE_KEYS = Object.keys(SHAPES);

/* Flat silhouettes built from primitives (avoids raster noise per curriculum). */
const SIL = {
  dog: c => wrap(`<g fill="${c}">
    <ellipse cx="55" cy="60" rx="28" ry="18"/>
    <circle cx="26" cy="44" r="14"/>
    <ellipse cx="15" cy="37" rx="6" ry="11" transform="rotate(24 15 37)"/>
    <ellipse cx="15" cy="50" rx="8" ry="6"/>
    <rect x="34" y="70" width="9" height="16" rx="4"/><rect x="48" y="72" width="9" height="14" rx="4"/>
    <rect x="62" y="72" width="9" height="14" rx="4"/><rect x="74" y="70" width="9" height="16" rx="4"/>
    <path d="M82 52 Q95 44 91 30" fill="none" stroke="${c}" stroke-width="8" stroke-linecap="round"/></g>`),
  cat: c => wrap(`<g fill="${c}">
    <ellipse cx="56" cy="64" rx="24" ry="17"/>
    <circle cx="30" cy="42" r="13"/>
    <path d="M20 36 L17 20 L29 30 Z"/><path d="M40 36 L43 20 L31 30 Z"/>
    <rect x="40" y="74" width="8" height="13" rx="4"/><rect x="64" y="74" width="8" height="13" rx="4"/>
    <path d="M78 60 Q94 56 92 38" fill="none" stroke="${c}" stroke-width="7" stroke-linecap="round"/></g>`),
  elephant: c => wrap(`<g fill="${c}">
    <ellipse cx="58" cy="54" rx="31" ry="23"/>
    <circle cx="24" cy="44" r="16"/>
    <ellipse cx="30" cy="42" rx="9" ry="13"/>
    <path d="M14 50 Q4 64 12 80 Q14 85 20 82" fill="none" stroke="${c}" stroke-width="9" stroke-linecap="round"/>
    <rect x="38" y="68" width="11" height="18" rx="5"/><rect x="56" y="70" width="11" height="16" rx="5"/><rect x="72" y="68" width="11" height="18" rx="5"/></g>`),
  apple: c => wrap(`<g fill="${c}">
    <circle cx="41" cy="58" r="26"/><circle cx="59" cy="58" r="26"/>
    <rect x="47" y="22" width="6" height="16" rx="3" fill="#7A5236"/>
    <ellipse cx="62" cy="27" rx="11" ry="6" transform="rotate(-24 62 27)" fill="#33C06A"/></g>`),
  car: c => wrap(`<g fill="${c}">
    <rect x="6" y="44" width="88" height="24" rx="12"/>
    <path d="M26 46 L36 26 L66 26 L78 46 Z"/>
    <path d="M40 32 L62 32 L68 44 L40 44 Z" fill="#F6FAFE" opacity=".85"/>
    <circle cx="27" cy="70" r="12" fill="#2A3642"/><circle cx="73" cy="70" r="12" fill="#2A3642"/>
    <circle cx="27" cy="70" r="5" fill="#F6FAFE"/><circle cx="73" cy="70" r="5" fill="#F6FAFE"/></g>`),
  bird: c => wrap(`<g fill="${c}" class="hit">
    <ellipse ${H} cx="48" cy="56" rx="24" ry="16"/>
    <circle ${H} cx="70" cy="40" r="12"/>
    <path ${H} d="M80 36 L94 41 L80 46 Z"/>
    <path ${H} d="M28 52 L8 42 L14 60 Z"/>
    <ellipse ${H} cx="46" cy="52" rx="13" ry="8" transform="rotate(-18 46 52)" fill="#2E6FCE"/></g>`),
  nest: c => wrap(`<g>
    <path d="M10 44 A40 34 0 0 0 90 44 Z" fill="${c}"/>
    <ellipse cx="50" cy="44" rx="40" ry="10" fill="none" stroke="#8A6A45" stroke-width="7"/>
    <path d="M18 58 Q34 66 50 62 M42 72 Q58 76 74 66" fill="none" stroke="#8A6A45" stroke-width="4" stroke-linecap="round"/></g>`),
};

/* Composition art: pieces drawn in a shared 100×100 space so overlay = whole. */
const HALF_L = c => wrap(`<path ${H} d="M50 6 A44 44 0 0 0 50 94 Z" fill="${c}"/>`);
const HALF_R = c => wrap(`<path ${H} d="M50 6 A44 44 0 0 1 50 94 Z" fill="${c}"/>`);
const ZIG = 'L58 26 L46 34 L58 46 L46 56 L58 66 L46 76 L52 84';
const PUZ_L = c => wrap(`<path ${H} d="M12 12 L52 12 ${ZIG} L52 88 L12 88 Z" fill="${c}"/>`);
const PUZ_R2 = c => wrap(`<path ${H} d="M52 12 L88 12 L88 88 L52 88 L46 76 L58 66 L46 56 L58 46 L46 34 L58 26 Z" fill="${c}"/>`);

const HOUSE = {
  // roof + body silhouette only — the door spot is a SEPARATE layer (doorspot)
  // so it can render ABOVE the placed body instead of being covered by it
  outline: () => wrap(`<g fill="none" stroke="#A9C6E0" stroke-width="2.5" stroke-dasharray="6 5">
    <path d="M18 42 L50 14 L82 42 Z"/><rect x="26" y="42" width="48" height="44" rx="3"/></g>`),
  doorspot: () => wrap(`<rect x="43" y="60" width="14" height="26" rx="3" fill="none" stroke="#A9C6E0" stroke-width="2.5" stroke-dasharray="6 5"/>`),
  roof: () => wrap(`<path ${H} d="M18 42 L50 14 L82 42 Z" fill="#FF5D55"/>`),
  body: () => wrap(`<rect ${H} x="26" y="42" width="48" height="44" rx="3" fill="#FFC02E"/>`),
  door: () => wrap(`<rect ${H} x="43" y="60" width="14" height="26" rx="3" fill="#3D8BFF"/>`),
};

const CHEVRON = () => wrap(`<path d="M28 30 L50 62 L72 30" fill="none" stroke="#A9C6E0" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>`);
/* Cause & effect — itsy-bitsy spider / water spout */
// a storybook downspout: a gutter head at the top where the rain pours in, a
// cylinder-shaded pipe held by two wall straps, and an open mouth at the base
// where the water — and the spider — comes out. It reads as a thing bolted to
// a house, not a laboratory funnel. (It once carried little colored dots as
// \"folk-art banding\"; they meant nothing and only invited the question.)
const SPOUT = () => wrap(`<g>
  <ellipse cx="50" cy="94" rx="17" ry="3.5" fill="#16283F" opacity=".18"/>
  <!-- gutter head: the open trough the rain pours into -->
  <path d="M34 14 C33 11 31 10 27 9 L73 9 C69 10 67 11 66 14 Z" fill="#6FB2E6"/>
  <ellipse cx="50" cy="9" rx="23" ry="5.6" fill="#8FC6EE"/>
  <ellipse cx="50" cy="9" rx="17" ry="3.9" fill="#2F6C9F"/>
  <ellipse cx="50" cy="10.2" rx="17" ry="3.9" fill="#1F4E77"/>
  <!-- the taper down into the pipe -->
  <path d="M34 14 L66 14 L62 26 L38 26 Z" fill="#6FB2E6"/>
  <!-- the pipe itself: a cylinder, lit from the left -->
  <rect x="37" y="24" width="26" height="64" rx="6" fill="#6FB2E6"/>
  <rect x="40" y="27" width="6" height="58" rx="3" fill="#BCE0F9" opacity=".85"/>
  <rect x="57.5" y="27" width="3.6" height="58" rx="1.8" fill="#3B82BC" opacity=".5"/>
  <!-- straps holding it to the wall -->
  <rect x="32" y="40" width="36" height="6.5" rx="3.2" fill="#3E8CCB"/>
  <rect x="32" y="66" width="36" height="6.5" rx="3.2" fill="#3E8CCB"/>
  <!-- the mouth at the bottom, where the water (and the spider) comes out -->
  <rect x="33" y="84" width="34" height="7.5" rx="3.7" fill="#3E8CCB"/>
  <ellipse cx="50" cy="91" rx="17" ry="3.2" fill="#1F4E77"/>
</g>`);
// pulsing ring that shows where to drop the bug — the base of the spout
const DROP_RING = () => wrap(`<g fill="none" stroke="#3D8BFF" stroke-width="6" stroke-linecap="round" stroke-dasharray="10 9"><circle cx="50" cy="50" r="38"/></g>`);
const SPIDER = () => wrap(`<g class="hit">
  <path d="M30 44 L12 34 M30 52 L9 52 M30 60 L13 70 M33 66 L25 84" stroke="#3E3020" stroke-width="4.5" fill="none" stroke-linecap="round"/>
  <path d="M70 44 L88 34 M70 52 L91 52 M70 60 L87 70 M67 66 L75 84" stroke="#3E3020" stroke-width="4.5" fill="none" stroke-linecap="round"/>
  <ellipse ${H} cx="50" cy="56" rx="21" ry="18" fill="#5B4636"/>
  <circle ${H} cx="50" cy="38" r="13" fill="#6B5544"/>
  <circle cx="45" cy="35" r="3.4" fill="#fff"/><circle cx="55" cy="35" r="3.4" fill="#fff"/>
  <circle cx="45.5" cy="36" r="1.7" fill="#1a1a1a"/><circle cx="54.5" cy="36" r="1.7" fill="#1a1a1a"/></g>`);
const CLOUD2 = () => wrap(`<g>
  <g fill="#E9F0F8">
    <circle cx="30" cy="55" r="19"/><circle cx="52" cy="43" r="24"/>
    <circle cx="73" cy="54" r="17"/>
    <rect x="11" y="53" width="78" height="23" rx="11.5"/>
  </g>
  <ellipse cx="50" cy="67" rx="36" ry="8.5" fill="#D6E2EE"/>
  <g fill="none" stroke="#FFFFFF" stroke-width="4.5" stroke-linecap="round" opacity=".8">
    <path d="M16 52 A18 18 0 0 1 32 37"/>
    <path d="M37 34 A24 24 0 0 1 58 20"/>
  </g>
</g>`);
const SUN2 = () => wrap(`<g fill="#FFC02E"><circle cx="50" cy="50" r="26"/>${Array.from({length:8},(_,i)=>{const a=i/8*Math.PI*2;return `<rect x="48" y="6" width="4" height="12" rx="2" transform="rotate(${i*45} 50 50)"/>`;}).join('')}</g>`);
// a soap bubble (Intro: tap → pop)
const BUBBLE_ART = () => wrap(`<g class="hit">
  <circle cx="50" cy="50" r="40" fill="#bfe9ff" opacity=".5"/>
  <circle cx="50" cy="50" r="40" fill="none" stroke="#8fd3ff" stroke-width="3" opacity=".8"/>
  <circle cx="50" cy="50" r="40" fill="none" stroke="#ffffff" stroke-width="6" opacity=".25"/>
  <ellipse cx="37" cy="34" rx="13" ry="9" fill="#ffffff" opacity=".7" transform="rotate(-30 37 34)"/>
  <circle cx="64" cy="62" r="4" fill="#ffffff" opacity=".55"/></g>`);
// a cuckoo clock — tap → the bird pops out of the top door (Intro)
const CUCKOO_CLOCK = () => wrap(`<g class="hit">
  <g class="cuckoo-bird"><ellipse cx="50" cy="20" rx="8" ry="6.5" fill="#E07B39"/>
    <circle cx="50" cy="13" r="5.5" fill="#E8934F"/><path d="M55 12 L63 10.5 L55 15 Z" fill="#F0B429"/>
    <circle cx="48" cy="12" r="1.5" fill="#2a2a2a"/></g>
  <path d="M24 42 L50 22 L76 42 Z" fill="#8B5A2B"/>
  <rect x="30" y="42" width="40" height="44" rx="4" fill="#A9713A"/>
  <rect x="43" y="30" width="14" height="13" rx="2" fill="#5c3b1c"/>
  <circle cx="50" cy="64" r="13" fill="#F4E4C1"/><circle cx="50" cy="64" r="13" fill="none" stroke="#5c3b1c" stroke-width="2"/>
  <line x1="50" y1="64" x2="50" y2="56" stroke="#5c3b1c" stroke-width="2" stroke-linecap="round"/>
  <line x1="50" y1="64" x2="56" y2="64" stroke="#5c3b1c" stroke-width="2" stroke-linecap="round"/>
  <rect x="46" y="84" width="8" height="9" rx="2" fill="#8B5A2B"/></g>`);
// a lidded box — tap → the lid opens and shuts ("open them, shut them") (Intro)
const OPEN_SHUT_BOX = () => wrap(`<g class="hit">
  <rect x="26" y="40" width="48" height="10" rx="3" fill="#7a4e12"/>
  <rect x="24" y="50" width="52" height="36" rx="5" fill="#E0A020"/>
  <rect x="24" y="50" width="52" height="9" rx="5" fill="#C98A18"/>
  <g class="box-lid"><rect x="22" y="40" width="56" height="13" rx="5" fill="#F4B733"/>
    <rect x="44" y="35" width="12" height="8" rx="3" fill="#C98A18"/></g></g>`);
// a big pushable arcade button on a base (cause→effect: press → fireworks)
const PUSH_BTN = (cap) => wrap(`<g class="hit">
  <ellipse cx="50" cy="86" rx="33" ry="8" fill="#1e2c3b" opacity=".18"/>
  <rect x="20" y="54" width="60" height="30" rx="13" fill="#5C6B77"/>
  <ellipse cx="50" cy="54" rx="30" ry="12" fill="#7C8B97"/>
  <g class="btn-cap">
    <ellipse cx="50" cy="47" rx="27" ry="12" fill="#3a2e2e" opacity=".18"/>
    <ellipse cx="50" cy="44" rx="27" ry="12" fill="${cap}"/>
    <ellipse cx="50" cy="41" rx="19" ry="7" fill="#fff" opacity=".3"/>
  </g></g>`);
/* 2-inch wood cubes for the stacking level */
/* Drawn flush to the 100×100 box — physics stacks the element boxes edge to
   edge, so any inset here would read as a gap between "touching" blocks. */
const WOOD_BLOCK = tone => wrap(`<g class="hit">
  <rect ${H} x="0" y="0" width="100" height="100" rx="6" fill="${tone}"/>
  <rect x="0" y="0" width="100" height="15" rx="6" fill="#ffffff" opacity=".2"/>
  <path d="M14 44 Q36 38 58 44 T94 46 M18 72 Q42 66 68 72" fill="none" stroke="#8A5A2B" stroke-width="4" stroke-linecap="round" opacity=".3"/></g>`);
const BOX = () => wrap(`<g>
  <rect x="6" y="16" width="88" height="74" rx="10" fill="#E5EFF8" stroke="#A9C6E0" stroke-width="5"/>
  <rect x="2" y="10" width="96" height="12" rx="6" fill="#C6DAEB"/></g>`);
const COVER_COLORS = ['#4C86D8','#F0685B','#39B26B','#E0A020'];
const COVER = (color, num) => wrap(`<g>
  <rect x="6" y="8" width="88" height="84" rx="13" fill="${color||COVER_COLORS[0]}"/>
  <rect x="11" y="13" width="78" height="74" rx="9" fill="rgba(255,255,255,.16)"/>
  <text x="50" y="52" text-anchor="middle" dominant-baseline="central" font-size="46" font-weight="800" fill="#fff" font-family="ui-rounded, system-ui, sans-serif">${num||''}</text></g>`);
const CARD_IMG = name => `<img class="cardimg" alt="${name}" src="./assets/cards/${name}.webp" draggable="false">`;
const BALL = c => wrap(`<g class="hit"><circle ${H} cx="50" cy="50" r="42" fill="${c}"/><circle ${H} cx="36" cy="36" r="12" fill="#ffffff" opacity=".45"/></g>`);
const STAR_HOLE = () => wrap(`<path d="M50 8 L60.5 39.5 L94 39.5 L67 59 L77.5 90 L50 70.5 L22.5 90 L33 59 L6 39.5 L39.5 39.5 Z" fill="#C9DAE9" stroke="#A9C6E0" stroke-width="3" stroke-linejoin="round"/>`);
const CIRC_HOLE = () => wrap(`<circle cx="50" cy="50" r="42" fill="#C9DAE9" stroke="#A9C6E0" stroke-width="3"/>`);

/* Node icons for the home cards */
const NICON = {
  intro: `<svg class="cicon" viewBox="0 0 100 100"><circle cx="50" cy="46" r="30" fill="#bfe9ff" opacity=".55"/><circle cx="50" cy="46" r="30" fill="none" stroke="#8fd3ff" stroke-width="3"/><ellipse cx="40" cy="34" rx="9" ry="6" fill="#fff" opacity=".7" transform="rotate(-30 40 34)"/><path d="M50 60 q0 18 0 26 M50 86 l-8 -8 M50 86 l8 -8" fill="none" stroke="${C.coral}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  identity: `<svg class="cicon" viewBox="0 0 100 100"><circle cx="26" cy="38" r="14" fill="${C.sea}"/><circle cx="62" cy="38" r="14" fill="${C.sea}"/><rect x="34" y="58" width="28" height="28" rx="8" fill="${C.coral}" transform="rotate(8 48 72)"/></svg>`,
  magnitude:`<svg class="cicon" viewBox="0 0 100 100"><circle cx="38" cy="48" r="28" fill="${C.grape}"/><circle cx="80" cy="66" r="11" fill="${C.grape}" opacity=".75"/></svg>`,
  quantity: `<svg class="cicon" viewBox="0 0 100 100"><circle cx="24" cy="56" r="10" fill="${C.grass}"/><circle cx="62" cy="34" r="10" fill="${C.grass}"/><circle cx="82" cy="52" r="10" fill="${C.grass}"/><circle cx="64" cy="70" r="10" fill="${C.grass}"/><circle cx="82" cy="30" r="10" fill="${C.grass}" opacity=".8"/></svg>`,
  spatial:  `<svg class="cicon" viewBox="0 0 100 100"><rect x="18" y="34" width="64" height="52" rx="9" fill="#E5EFF8" stroke="#A9C6E0" stroke-width="5"/><circle cx="50" cy="60" r="16" fill="${C.coral}"/></svg>`,
  peekaboo:`<svg class="cicon" viewBox="0 0 100 100"><rect x="12" y="24" width="34" height="46" rx="7" fill="#6FA8E8"/><rect x="54" y="24" width="34" height="46" rx="7" fill="#6FA8E8"/><circle cx="71" cy="47" r="9" fill="#B7D6F7"/><path d="M20 78 Q34 62 46 78" fill="none" stroke="${C.coral}" stroke-width="6" stroke-linecap="round"/></svg>`,
  letters: LETTERS_ICON,
  composition:`<svg class="cicon" viewBox="0 0 100 100"><path d="M24 46 L50 22 L76 46 Z" fill="${C.coral}"/><rect x="30" y="46" width="40" height="34" rx="4" fill="${C.sun}"/><rect x="44" y="60" width="12" height="20" rx="3" fill="${C.sea}"/></svg>`,
};

/* ═══════════════════════ 4 · Curriculum (strict rulesets) ═════════════════ */
/* Layout helpers: positions are % of stage, sizes are vmin units. */

export { C, COLOR_KEYS, COLOR_PAIRS, wrap, SHAPES, SHAPE_KEYS, SIL, HALF_L, HALF_R, ZIG, PUZ_L, PUZ_R2, HOUSE, CHEVRON, SPOUT, DROP_RING, SPIDER, CLOUD2, SUN2, BUBBLE_ART, CUCKOO_CLOCK, OPEN_SHUT_BOX, PUSH_BTN, WOOD_BLOCK, BOX, COVER_COLORS, COVER, CARD_IMG, BALL, STAR_HOLE, CIRC_HOLE, NICON };

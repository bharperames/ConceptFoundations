/* ════════════════════════════════ 1 · Utilities ═══════════════════════════ */
const $ = s => document.querySelector(s);
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() :
  'xxxx-xxxx-xxxx'.replace(/x/g, () => Math.floor(Math.random()*16).toString(16)));
const clamp = (v,a,b) => Math.max(a, Math.min(b,v));

/* Deterministic PRNG: strict rulesets pick from constrained pools via this
   seeded stream, and the seed is stored on the session for exact replay. */
function hashStr(str){
  let h = 2166136261;
  for (let i=0;i<str.length;i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(seed){
  let a = seed >>> 0;
  return function(){
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rng, arr) => arr[Math.floor(rng()*arr.length)];
function pick2 (rng, arr){ const a = pick(rng,arr); let b = pick(rng,arr); while (b===a) b = pick(rng,arr); return [a,b]; }
function shuffle(rng, arr){
  const a = arr.slice();
  for (let i=a.length-1;i>0;i--){ const j = Math.floor(rng()*(i+1)); [a[i],a[j]] = [a[j],a[i]]; }
  return a;
}
const median = xs => {
  if (!xs.length) return null;
  const s = xs.slice().sort((a,b)=>a-b), m = Math.floor(s.length/2);
  return s.length%2 ? s[m] : (s[m-1]+s[m])/2;
};

/* Attention cues — the shared pattern for "understand intent, direct action".
   Two temporal flavors, one idea: a CSS class on a stable ancestor drives an
   animation on the element we want the user to notice.
   1. CONDITION-HELD: while a state holds ("no engine on the board"), toggle
      the class from wherever that state is recomputed; CSS animates
      `infinite`. See GearGame.opsCue().
   2. FUTILE-TAPS (this factory): the user keeps interacting somewhere that
      does nothing — count those signals in a sliding window and, past the
      threshold, flash the cue class for one animation run, then cool down so
      the hint never nags. Put the class on a PERSISTENT ancestor (not a
      node that re-renders) and scope the CSS to the animated child, so
      re-renders mid-cue don't kill it. */
function attentionNudge({ count = 3, within = 6000, cooldown = 9000 } = {}){
  let taps = [], coolUntil = 0, timer = 0;
  // flash the cue class for one animation run (also exposed directly, for
  // FIRST-ENCOUNTER hints — e.g. a just-spawned control introducing itself)
  const cue = (el, cls, dur = 3400) => {
    clearTimeout(timer);
    el.classList.add(cls);
    timer = setTimeout(() => el.classList.remove(cls), dur);
  };
  return {
    cue,
    // one futile interaction; fires the cue on el when the pattern is clear
    note(el, cls, dur){
      const now = performance.now();
      taps = taps.filter(t => now - t < within);
      taps.push(now);
      if (taps.length < count || now < coolUntil) return false;
      taps = []; coolUntil = now + cooldown;
      cue(el, cls, dur);
      return true;
    },
    // the user found the intended control — stop counting toward a cue
    reset(){ taps = []; },
  };
}

/* ════════════════════════════════ 2 · Audio ═══════════════════════════════ */
/* Closed captions: every spoken utterance is mirrored as on-screen text when
   enabled (dashboard toggle, or ?cc=1) — lets testers work with volume off. */

export { $, uuid, clamp, hashStr, mulberry32, pick, pick2, shuffle, median, attentionNudge };

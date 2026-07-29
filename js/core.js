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

/* ════════════════════════════════ 2 · Audio ═══════════════════════════════ */
/* Closed captions: every spoken utterance is mirrored as on-screen text when
   enabled (dashboard toggle, or ?cc=1) — lets testers work with volume off. */

export { $, uuid, clamp, hashStr, mulberry32, pick, pick2, shuffle, median };

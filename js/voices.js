/* ═══════════════════════ Voice bench (debug) ═══════════════════════════════
   Open with ?voices=1, or CF.openVoices() from the console.

   Every spoken line in the app, in one place, playable. Tuning audio by playing
   through levels is slow and unrepeatable — a wrong line is three taps and a
   lucky seed away — so this lists them all up front and says where each comes
   from. Each line shows how it RESOLVES: which beats play a recorded clip
   (with a direct link to the file, so a bad recording can be told apart from a
   bad phrase) and which are synthesized.

   The letter bench at the top is the one that needs an ear most: speech engines
   announce an uppercase glyph as "capital E", so letters are handed over in
   lowercase, and the handful that lowercase turns into words ("a" → the
   article) need an override. Type a candidate, hear it, and Copy overrides
   emits the SAY_OVERRIDE object to paste into js/letters.js. */
import { Audio2 } from './audio.js';
import { $, hashStr, mulberry32 } from './core.js';
import { GLYPHS, sayGlyph } from './letters.js';
import { NODES } from './nodes.js';

/* Lines the engine speaks directly — they live in code paths, not in a trial,
   so they can't be discovered by walking the curriculum. */
const ENGINE_LINES = [
  ['reward · bubble pop', 'Pop!'],
  ['reward · spider tap', 'Wheee!'],
  ['reward · cuckoo', 'Cuckoo!'],
  ['reward · open/shut box', 'Open them, shut them!'],
  ['peekaboo · reveal', 'Peekaboo!'],
  ['praise', 'Yay!'], ['praise', 'We did it!'],
  ['praise', 'Hooray!'], ['praise', 'Great job!'],
  ['spout · line 1', 'The itsy bitsy spider went up the water spout!'],
  ['spout · line 2', 'Down came the rain and washed the spider out!'],
  ['spout · line 3', 'Out came the sun and dried up all the rain and the itsy bitsy spider went up the spout again!'],
];

/* Walk the real generators at a fixed seed, so the catalog is the actual
   phrasing the child hears rather than a second copy that can drift. */
function curriculumLines(){
  const rows = [];
  for (const node of NODES){
    for (const lv of node.levels){
      let gen;
      try { gen = lv.make(mulberry32(hashStr(node.key + '|' + lv.id + '|voices'))); }
      catch (e){ rows.push({ where: lv.id, what: 'generator threw', text: String(e) }); continue; }
      const trials = [gen.expose, gen.contrast, ...(gen.tests || [])].filter(Boolean);
      const seen = new Set();
      for (const t of trials){
        if (!t.say || seen.has(t.say)) continue;
        seen.add(t.say);
        rows.push({ where: lv.id, what: (t.state || t.kind || '').toLowerCase(), text: t.say });
      }
      if (gen.tests && gen.tests[0] && gen.tests[0].introSay)
        rows.push({ where: lv.id, what: 'intro', text: gen.tests[0].introSay });
    }
  }
  return rows;
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));

/* A clip's real home is the producer's curation app, not the mp3 we embedded.
   clips/clips.manifest.json already carries the join — dest filename → durable
   asset_id — so a bad-sounding line links straight to the asset that needs
   re-cutting instead of to a copy of it. Override the app's origin with
   ?curator=http://host:port for a non-default setup. */
const CURATOR = new URLSearchParams(location.search).get('curator') || 'http://127.0.0.1:9743';
const assets = {};          // dest filename → { asset_id, phrase }
let manifestAt = 0;         // bumped when it lands, so views know to re-render
fetch('./clips/clips.manifest.json')
  .then(r => r.json())
  .then(m => {
    for (const e of m.clips || []) if (e.dest) assets[e.dest] = e;
    manifestAt = Date.now();
  })
  .catch(() => { manifestAt = -1; });

function curatorHref(file){
  const e = assets[file];
  if (!e || !e.asset_id) return './clips/' + file;   // pending_gold: the file is all there is
  const q = String(e.phrase || '').split(/\s+/)[0] || '';
  return `${CURATOR}/?tab=assets&q=${encodeURIComponent(q)}&asset=${encodeURIComponent(e.asset_id)}`;
}
const assetId = file => (assets[file] || {}).asset_id || null;

/* One line, showing each beat and whether it is a clip or synthesized. */
function lineRow(r){
  const parts = Audio2.resolve(r.text).map(p => p.clip
    ? `<span class="vb-clip">${esc(p.seg)} → <a href="${curatorHref(p.clip)}" target="_blank"
         title="open in MR_AudioClips">${esc(assetId(p.clip) || p.clip)}</a></span>`
    : `<span class="vb-tts">${esc(p.seg)}</span>`).join('<span class="vb-beat">▸</span>');
  const clips = Audio2.resolve(r.text).filter(p => p.clip);
  return `<tr>
    <td class="vb-where">${esc(r.where)}<i>${esc(r.what || '')}</i></td>
    <td class="vb-btns"><button class="vb-play" data-say="${esc(r.text)}" title="play through the app">▶</button>${
      clips.map(p => `<button class="vb-play vb-raw" data-file="${esc(p.clip)}" title="play ${esc(p.clip)} itself">♪</button>`).join('')}</td>
    <td class="vb-parts">${parts}</td>
  </tr>`;
}

function render(root){
  const glyphRows = GLYPHS.map(g => `<tr>
      <td class="vb-glyph">${g}</td>
      <td><input class="vb-try" data-g="${g}" value="${esc(sayGlyph(g))}" spellcheck="false"></td>
      <td><button class="vb-play" data-try="${g}">▶</button></td>
    </tr>`).join('');

  root.innerHTML = `
    <div class="vb-head">
      <h2>Voice bench</h2>
      <div class="vb-actions">
        <button id="vb-copy">Copy overrides</button>
        <button id="vb-refresh">Refresh history</button>
        <button id="vb-close">Close</button>
      </div>
    </div>
    <div class="vb-body">
      <h3>Letters &amp; digits <em>— what gets handed to the voice</em></h3>
      <p class="vb-note">An uppercase glyph is announced "capital E", so these go
        over in lowercase. Edit any that still sound wrong, then Copy overrides
        and paste into <code>SAY_OVERRIDE</code> in <code>js/letters.js</code>.</p>
      <table class="vb-tbl vb-glyphs">${glyphRows}</table>

      <h3>Every line in the curriculum</h3>
      <p class="vb-note">Generated from the real level generators. A
        <span class="vb-clip">green</span> beat plays that file — click it to
        hear the recording on its own, which separates a bad clip from a bad
        phrase. <span class="vb-tts">Grey</span> beats are synthesized.</p>
      <table class="vb-tbl">${curriculumLines().map(lineRow).join('')}</table>

      <h3>Spoken by the engine</h3>
      <table class="vb-tbl">${ENGINE_LINES.map(([w, t]) =>
        lineRow({ where: w, what: '', text: t })).join('')}</table>

      <h3>Just played <em>— most recent first</em></h3>
      <table class="vb-tbl" id="vb-history">${historyRows()}</table>
    </div>`;
}

function historyRows(){
  const h = Audio2.history.slice(-60).reverse();
  if (!h.length) return `<tr><td class="vb-note">nothing yet — play a level, then Refresh history</td></tr>`;
  return h.map(e => `<tr>
    <td class="vb-where">${new Date(e.at).toLocaleTimeString()}</td>
    <td class="vb-btns"><button class="vb-play" data-say="${esc(e.seg)}" title="play through the app">▶</button>${
      e.clip ? `<button class="vb-play vb-raw" data-file="${esc(e.clip)}" title="play the file itself">♪</button>` : ''}</td>
    <td class="vb-parts">${e.clip
      ? `<span class="vb-clip">${esc(e.seg)} → <a href="${curatorHref(e.clip)}" target="_blank">${esc(assetId(e.clip) || e.clip)}</a></span>`
      : `<span class="vb-tts">${esc(e.seg)}</span>`}</td>
  </tr>`).join('');
}

const CSS = `
.vb{position:fixed;inset:0;z-index:300;background:#0d1420;color:#E9F2FA;
  font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;display:flex;flex-direction:column}
.vb-head{display:flex;align-items:center;justify-content:space-between;gap:12px;
  padding:12px 16px;border-bottom:1px solid #24384f;flex:none}
.vb-head h2{margin:0;font-size:16px;font-family:system-ui,sans-serif}
.vb-actions{display:flex;gap:8px}
.vb button{font:inherit;border:none;border-radius:8px;padding:7px 12px;
  background:#23384f;color:#E9F2FA;cursor:pointer}
.vb button:active{transform:scale(.94)}
.vb-body{overflow:auto;padding:8px 16px 40px}
.vb-body h3{font-family:system-ui,sans-serif;font-size:14px;margin:22px 0 4px}
.vb-body h3 em{font-weight:400;color:#7f95ab;font-style:normal}
.vb-note{color:#7f95ab;margin:0 0 8px;max-width:82ch}
.vb-note code{color:#9ec6ea}
.vb-tbl{border-collapse:collapse;width:100%;max-width:1100px}
.vb-tbl td{border-top:1px solid #1c2b3d;padding:4px 8px;vertical-align:top}
.vb-where{color:#7f95ab;white-space:nowrap;width:1%}
.vb-where i{font-style:normal;opacity:.7;margin-left:8px}
.vb-parts{width:100%}
.vb-beat{color:#4a6a86;margin:0 7px}
.vb-clip{color:#7fdca0}
.vb-clip a{color:#7fdca0;text-decoration:none;border-bottom:1px dotted #3d7a55}
.vb-clip a:hover{color:#a8f3c6}
.vb-tts{color:#c8d6e4}
.vb-play{padding:2px 10px}
.vb-btns{white-space:nowrap;width:1%}
.vb-btns .vb-play{margin-right:5px}
.vb-raw{color:#7fdca0}
.vb-glyphs td:first-child{width:1%}
.vb-glyph{font:700 17px/1 system-ui,sans-serif;color:#ffc94d;text-align:center}
.vb-try{font:inherit;background:#122030;color:#E9F2FA;
  border:1px solid #24384f;border-radius:6px;padding:4px 8px;width:220px}
`;

let el = null;
function openVoices(){
  if (el){ el.remove(); el = null; }
  if (!document.getElementById('vb-css')){
    const st = document.createElement('style');
    st.id = 'vb-css'; st.textContent = CSS;
    document.head.appendChild(st);
  }
  el = document.createElement('div');
  el.className = 'vb';
  render(el);
  document.body.appendChild(el);

  el.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.id === 'vb-close'){ el.remove(); el = null; return; }
    if (b.id === 'vb-refresh'){ $('#vb-history').innerHTML = historyRows(); return; }
    if (b.id === 'vb-copy'){
      const out = {};
      for (const inp of el.querySelectorAll('.vb-try')){
        const g = inp.dataset.g;
        if (inp.value.trim() && inp.value.trim() !== g.toLowerCase()) out[g] = inp.value.trim();
      }
      const text = 'const SAY_OVERRIDE = ' + JSON.stringify(out, null, 2)
        .replace(/"(\w)":/g, '$1:') + ';';
      navigator.clipboard.writeText(text).catch(() => {});
      b.textContent = Object.keys(out).length ? 'Copied ' + Object.keys(out).length : 'Nothing changed';
      setTimeout(() => { b.textContent = 'Copy overrides'; }, 1600);
      return;
    }
    if (b.dataset.try != null){
      const inp = el.querySelector(`.vb-try[data-g="${b.dataset.try}"]`);
      Audio2.unlock(); Audio2.speak(inp.value);
      return;
    }
    if (b.dataset.file != null){ playRaw(b.dataset.file); return; }
    if (b.dataset.say != null){ Audio2.unlock(); Audio2.speak(b.dataset.say); }
  });
  // typing a candidate and pressing enter plays it
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.classList.contains('vb-try')){
      Audio2.unlock(); Audio2.speak(e.target.value);
    }
  });
}

/* ── In-context HUD (?debug=1) ─────────────────────────────────────────────
   The bench above is the whole catalog; this is "what is this screen saying,
   right now". It sits out of the way, follows the trial as it advances, and
   shows the CURRENT line broken into its beats — green beats name the clip
   playing (tap to hear it alone), grey ones are synthesized. Tapping a beat
   replays just that beat, which is how you tell a bad recording from a bad
   phrase without replaying the level. */
const HUD_CSS = `
.dbg{position:fixed;left:max(10px,env(safe-area-inset-left));bottom:64px;z-index:210;
  width:min(430px,86vw);background:rgba(9,17,27,.9);color:#dce8f4;
  font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;
  border:1px solid #24384f;border-radius:12px;box-shadow:0 8px 26px rgba(0,0,0,.45)}
.dbg-h{display:flex;align-items:center;gap:8px;padding:6px 8px;border-bottom:1px solid #1c2b3d}
.dbg-h b{color:#ffc94d;font-weight:700}
.dbg-h .sp{flex:1}
.dbg button{font:inherit;border:none;border-radius:7px;padding:3px 8px;
  background:#23384f;color:#dce8f4;cursor:pointer}
.dbg-b{padding:7px 8px}
.dbg-log{display:flex;flex-direction:column;gap:2px;
  max-height:20vh;overflow:auto;overscroll-behavior:contain}
.dbg-row{display:flex;align-items:baseline;gap:6px}
.dbg-t{color:#4d6379;flex:none}
.dbg-n{color:#ffc94d;flex:none}
.dbg-l{margin:0 0 6px}
.dbg-l:last-child{margin:0}
.dbg-k{color:#6f88a2}
.dbg-seg{display:inline-block;margin:2px 4px 2px 0;padding:2px 7px;border-radius:6px;
  background:#1a2b3d;color:#c8d6e4;cursor:pointer}
.dbg-seg.clip{background:#153826;color:#8fe4b0}
.dbg-seg.clip{color:#8fe4b0;text-decoration:none}
.dbg-seg.clip b{font-weight:700;opacity:.85}
.dbg-seg.clip:hover{background:#1c4a31;color:#b6f5cf}
.dbg-play{padding:1px 6px !important;margin-right:4px;background:#1a2b3d !important;color:#7f95ab !important}
.dbg-raw{color:#7fdca0 !important}
.dbg.min .dbg-b{display:none}
`;

let hud = null, hudTimer = 0, hudKey = '';

/* Three things you want on a clip, left to right: ▶ plays the line the way the
   app plays it, ♪ plays the FILE straight off disk (bypassing the app entirely,
   so a playback bug and a bad recording can be told apart), and the chip itself
   opens the asset in the curator, where a bad recording gets fixed. */
const clipChip = (seg, clip) =>
  `<button class="dbg-play" data-say="${esc(seg)}" title="play through the app">▶</button>` +
  `<button class="dbg-play dbg-raw" data-file="${esc(clip)}" title="play the file itself">♪</button>` +
  `<a class="dbg-seg clip" href="${curatorHref(clip)}" target="_blank"
      title="open ${esc(assetId(clip) || clip)} in MR_AudioClips">${esc(seg)} <b>${esc(clip)}</b></a>`;

/* Straight off disk: no CLIP_MAP, no beat chain, no normalization path — and
   cache-busted, because a stale copy is exactly what this is here to rule out. */
function playRaw(file){
  const a = new Audio('./clips/' + file + '?v=' + Date.now());
  a.play().catch(() => {});
}

function segChips(text){
  return Audio2.resolve(text).map(p => p.clip
    ? clipChip(p.seg, p.clip)
    : `<span class="dbg-seg" data-say="${esc(p.seg)}">${esc(p.seg)}</span>`).join('');
}

/* The whole run, newest first — nothing ages out of view. Consecutive repeats
   (a prompt repeating on a timeout) collapse to ×N so one stuck line can't
   push the rest of the session off the list. */
function hudLog(){
  const rows = [];
  for (const e of Audio2.history){
    const prev = rows[rows.length - 1];
    if (prev && prev.seg === e.seg && prev.clip === e.clip){ prev.n++; prev.at = e.at; continue; }
    rows.push({ seg: e.seg, clip: e.clip, at: e.at, n: 1 });
  }
  return rows;   // oldest first: a log reads downward, like a console
}

function hudBody(){
  const E = window.CF && window.CF.Engine;
  const cur = E && E.cur;
  const where = cur && E.level ? `${E.level.id} · ${(cur.state || cur.kind || '').toLowerCase()}` : 'not in a level';
  const line = cur && cur.say
    ? `<p class="dbg-l"><span class="dbg-k">now</span> ${segChips(cur.say)}</p>` : '';
  const log = hudLog();
  const rows = log.map(e => `<div class="dbg-row">
      <span class="dbg-t">${new Date(e.at).toLocaleTimeString([], {hour12:false})}</span>
      ${e.clip ? clipChip(e.seg, e.clip)
        : `<span class="dbg-seg" data-say="${esc(e.seg)}">${esc(e.seg)}</span>`}${
        e.n > 1 ? `<span class="dbg-n">×${e.n}</span>` : ''}
    </div>`).join('');
  return `<div class="dbg-h"><b>${esc(where)}</b><span class="sp"></span>
      <button data-act="copy">copy</button><button data-act="clear">clear</button>
      <button data-act="bench">bench</button><button data-act="min">–</button></div>
    <div class="dbg-b">${line}
      <p class="dbg-l"><span class="dbg-k">played · ${log.length}</span></p>
      <div class="dbg-log">${rows || '<span class="dbg-k">nothing yet</span>'}</div>
    </div>`;
}

function openDebugHud(){
  if (hud) return;
  if (!document.getElementById('dbg-css')){
    const st = document.createElement('style');
    st.id = 'dbg-css'; st.textContent = HUD_CSS;
    document.head.appendChild(st);
  }
  hud = document.createElement('div');
  hud.className = 'dbg';
  hud.innerHTML = hudBody();
  document.body.appendChild(hud);
  const feed0 = hud.querySelector('.dbg-log');
  if (feed0) feed0.scrollTop = feed0.scrollHeight;
  hud.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b){
      // the per-row buttons are buttons too — handle them before the toolbar
      if (b.dataset.file != null){ playRaw(b.dataset.file); return; }
      if (b.dataset.say != null){ Audio2.unlock(); Audio2.speak(b.dataset.say); return; }
      if (b.dataset.act === 'bench') openVoices();
      if (b.dataset.act === 'copy'){
        const text = hudLog().map(e =>
          `${new Date(e.at).toLocaleTimeString([], {hour12:false})}  ${e.clip || 'tts'}  ${e.seg}${e.n > 1 ? `  x${e.n}` : ''}`).join('\n');
        navigator.clipboard.writeText(text).catch(() => {});
        b.textContent = 'copied'; setTimeout(() => { b.textContent = 'copy'; }, 1200);
      }
      if (b.dataset.act === 'clear'){ Audio2.history.length = 0; hudKey = ''; }
      if (b.dataset.act === 'min'){
        hud.classList.toggle('min');
        b.textContent = hud.classList.contains('min') ? '+' : '–';
      }
      return;
    }
    if (e.target.closest('a')) return;          // the asset link owns its click
    const raw = e.target.closest('.dbg-raw');
    if (raw){ playRaw(raw.dataset.file); return; }
    const seg = e.target.closest('.dbg-seg');
    if (seg){ Audio2.unlock(); Audio2.speak(seg.dataset.say); }
  });
  // follow the trial without hooking the engine: re-render only when the line
  // or the history actually changes
  clearInterval(hudTimer);
  hudTimer = setInterval(() => {
    const E = window.CF && window.CF.Engine;
    const key = [E && E.level && E.level.id, E && E.cur && E.cur.say,
                 Audio2.history.length, manifestAt].join('|');
    if (key === hudKey) return;
    hudKey = key;
    const min = hud.classList.contains('min');
    const feed = hud.querySelector('.dbg-log');
    // stick to the tail while the reader is at the bottom; if they have
    // scrolled up to look at something, leave them where they are
    const atEnd = !feed || feed.scrollHeight - feed.scrollTop - feed.clientHeight < 24;
    const scroll = feed ? feed.scrollTop : 0;
    hud.innerHTML = hudBody();
    const nf = hud.querySelector('.dbg-log');
    if (nf) nf.scrollTop = atEnd ? nf.scrollHeight : scroll;
    if (min){ hud.classList.add('min'); hud.querySelector('[data-act="min"]').textContent = '+'; }
  }, 400);
}

export { openVoices, openDebugHud };


import { COVER, COVER_COLORS, NICON } from './art.js';
import { Audio2 } from './audio.js';
import { $, clamp, hashStr, mulberry32 } from './core.js';
import { Engine } from './engine.js';
import { BubbleGame } from './games/bubble.js';
import { PuzzleGame } from './games/puzzle.js';
import { StackerGame } from './games/stacker.js';
import { GearGame } from './games/gears.js';
import { NODES } from './nodes.js';
import { Store, nodeProgress } from './store.js';

function nodeUnlocked(node){
  if (Store.settings().unlockAll) return true;
  const p = Store.progress();
  return node.prereqs.every(k => {
    const np = p[k];
    return np && np.mastered && np.mastered.length >= NODES.find(n=>n.key===k).levels.length;
  });
}
/* ---- Level picker: long-press a game card for big, graphical level cards.
   Previews are rendered from each level's REAL trial generator (fixed seed),
   so the picture always matches what the level actually plays like. ---- */
function miniPreview(node, level){
  const rng = mulberry32(hashStr(node.key + '|' + level.id + '|preview'));
  const gen = level.make(rng);
  const trial = (gen.tests && gen.tests[0]) || gen.expose;
  if (trial.kind === 'hideseek'){
    const obj = trial.elements.find(e => e.id === 'obj');
    const nCov = trial.elements.filter(e => e.id && e.id.startsWith('cover')).length;
    const cxs = nCov <= 2 ? [35,65] : [22,50,78];
    const covers = cxs.map((x,i) => `<span class="lp-el" style="left:${x}%;top:72%;width:24%">${COVER(COVER_COLORS[i], i+1)}</span>`).join('');
    const card = `<span class="lp-el" style="left:50%;top:34%;width:30%">${obj ? obj.html : ''}</span>`;
    return `<div class="lp-preview">${card}${covers}</div>`;
  }
  const spans = trial.elements.map(e => {
    if (e.groundBar)
      return `<span class="lp-el" style="left:50%;top:82%;width:104%;aspect-ratio:auto;height:9%;background:#C9DAE9;border-radius:6px"></span>`;
    if (e.board)
      return `<span class="lp-el lp-board" style="left:${e.x}%;top:${e.y}%;width:${e.wPct}%;height:${e.hPct}%;aspect-ratio:auto"></span>`;
    const w = e.s * 1.5;   // element size as % of preview width
    return `<span class="lp-el${e.zone ? ' lp-zone' : ''}" style="left:${e.x}%;top:${e.y}%;width:${w}%">${e.html}</span>`;
  }).join('');
  return `<div class="lp-preview">${spans}</div>`;
}
function levelReachable(node, np, i){
  return Store.settings().unlockAll || i <= np.levelIdx || np.mastered.includes(node.levels[i].id);
}
function openPicker(node){
  const np = nodeProgress(node.key);
  $('#lp-title').textContent = node.title;
  const grid = $('#lp-grid');
  grid.innerHTML = node.levels.map((lv, i) => {
    const reachable = levelReachable(node, np, i);
    const done = np.mastered.includes(lv.id);
    return `<button class="lp-card${reachable?'':' locked'}${done?' done':''}" data-i="${i}" ${reachable?'':'aria-disabled="true"'}>
      ${miniPreview(node, lv)}
      <span class="lp-name">Level ${lv.id}</span>
      <span class="lp-desc">${lv.name}</span>
      <span class="lp-lock"><svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M12 2a5 5 0 0 1 5 5v3h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1V7a5 5 0 0 1 5-5zm0 2a3 3 0 0 0-3 3v3h6V7a3 3 0 0 0-3-3z"/></svg></span>
    </button>`;
  }).join('');
  grid.querySelectorAll('.lp-card').forEach(card => {
    card.addEventListener('click', () => {
      const i = parseInt(card.dataset.i, 10);
      if (!levelReachable(node, nodeProgress(node.key), i)){
        card.classList.add('wobble'); setTimeout(()=>card.classList.remove('wobble'), 500);
        return;
      }
      closePicker();
      Engine.startLevel(node, node.levels[i]);
    });
  });
  $('#level-picker').classList.remove('hidden');
}
function closePicker(){ $('#level-picker').classList.add('hidden'); }

/* Level map: every node (section) and all its micro-levels as the same preview
   cards the long-press picker shows (subsection). */
const LP_LOCK = `<span class="lp-lock"><svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M12 2a5 5 0 0 1 5 5v3h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1V7a5 5 0 0 1 5-5zm0 2a3 3 0 0 0-3 3v3h6V7a3 3 0 0 0-3-3z"/></svg></span>`;
// per-node colors for the dense "all levels" tiles — 8 clearly-distinct hues so a
// run of same-colored tiles reads as one section (the id numbers aren't enough)
const NODE_ACCENT = { intro:'#22B8C6', identity:'#3D7BE0', magnitude:'#9B6DF2',
  quantity:'#33A852', spatial:'#F2704B', composition:'#E8A81C', peekaboo:'#EC5D96', letters:'#7A5AC7', dressing:'#2E9E8F' };

// "All levels" as a home-screen MODE: one dense grid of every level + the mini
// games, packed continuously (no per-section rows, so no big partial-row gaps).
function renderAllLevels(){
  const tiles = [];
  for (const node of NODES){
    const np = nodeProgress(node.key), acc = NODE_ACCENT[node.key] || '#bcd';
    node.levels.forEach((lv, i) => {
      const reachable = levelReachable(node, np, i);
      const done = np.mastered.includes(lv.id);
      const cur = i === np.levelIdx && !done && reachable;
      tiles.push(`<button class="al-tile${done?' done':''}${cur?' cur':''}${reachable?'':' locked'}" style="--nc:${acc}" data-node="${node.key}" data-i="${i}" ${reachable?'':'aria-disabled="true"'}>
        ${miniPreview(node, lv)}
        <span class="alt-txt"><span class="alt-id">${lv.id}</span><span class="alt-name">${lv.name}</span></span>
        ${reachable ? '' : LP_LOCK}</button>`);
    });
  }
  const MINI_ICON = {
    bubbles: `<div class="lp-preview"><span class="lp-el" style="left:50%;top:50%;width:64%"><svg viewBox="0 0 100 100"><circle cx="38" cy="42" r="22" fill="#5BB8EC" opacity=".7"/><circle cx="30" cy="34" r="6" fill="#fff" opacity=".95"/><circle cx="68" cy="60" r="15" fill="#9B7DE8" opacity=".7"/><circle cx="63" cy="54" r="4" fill="#fff" opacity=".95"/><circle cx="62" cy="28" r="10" fill="#4FCF98" opacity=".7"/><circle cx="59" cy="24" r="3" fill="#fff" opacity=".95"/></svg></span></div>`,
    puzzle: `<div class="lp-preview"><span class="lp-el" style="left:50%;top:50%;width:60%"><svg viewBox="0 0 100 100"><rect x="14" y="14" width="34" height="34" rx="5" fill="#FFC02E"/><rect x="52" y="14" width="34" height="34" rx="5" fill="#FF5D55"/><rect x="14" y="52" width="34" height="34" rx="5" fill="#3D8BFF"/><rect x="52" y="52" width="34" height="34" rx="5" fill="#5FBF6A"/></svg></span></div>`,
    stacker: `<div class="lp-preview"><span class="lp-el" style="left:50%;top:50%;width:62%"><svg viewBox="0 0 100 100"><rect x="30" y="20" width="26" height="26" rx="4" fill="#DFA75F"/><rect x="24" y="48" width="26" height="26" rx="4" fill="#E8B36B"/><rect x="52" y="48" width="26" height="26" rx="4" fill="#C08847"/><rect x="18" y="76" width="64" height="10" rx="5" fill="#A9C6E0"/></svg></span></div>`,
    gears: `<div class="lp-preview"><span class="lp-el" style="left:50%;top:50%;width:62%"><svg viewBox="0 0 100 100"><path d="M42 14 l4 7 8-2 1 8 8 2-3 8 6 5-6 5 3 8-8 2-1 8-8-2-4 7-4-7-8 2-1-8-8-2 3-8-6-5 6-5-3-8 8-2 1-8 8 2z" fill="#3D8BFF"/><circle cx="42" cy="52" r="10" fill="#fff"/><path d="M74 30 l3 5 6-1 0 6 6 1-2 6 4 3-4 3 2 6-6 1 0 6-6-1-3 5-3-5-6 1 0-6-6-1 2-6-4-3 4-3-2-6 6-1 0-6 6 1z" fill="#FFC02E"/><circle cx="74" cy="56" r="7" fill="#fff"/></svg></span></div>`,
  };
  for (const [k, name] of [['bubbles','Bubble Pop'],['puzzle','Picture Puzzle'],['stacker','Block Stacker'],['gears','Gear Wall']])
    tiles.push(`<button class="al-tile" style="--nc:#9DB4C4" data-mini="${k}">${MINI_ICON[k]}
      <span class="alt-txt"><span class="alt-id">Game</span><span class="alt-name">${name}</span></span></button>`);
  const grid = $('#all-levels');
  grid.innerHTML = `<div class="al-grid">${tiles.join('')}</div>`;
  grid.querySelectorAll('.al-tile').forEach(el => {
    el.addEventListener('click', () => {
      if (el.dataset.mini === 'bubbles'){ Audio2.unlock(); BubbleGame.start(); return; }
      if (el.dataset.mini === 'puzzle'){ Audio2.unlock(); PuzzleGame.start(); return; }
      if (el.dataset.mini === 'stacker'){ Audio2.unlock(); StackerGame.start(); return; }
      if (el.dataset.mini === 'gears'){ Audio2.unlock(); GearGame.start(); return; }
      const node = NODES.find(n => n.key === el.dataset.node), i = parseInt(el.dataset.i, 10);
      if (!levelReachable(node, nodeProgress(node.key), i)){
        el.classList.add('wobble'); setTimeout(() => el.classList.remove('wobble'), 500); return;
      }
      Audio2.unlock(); Engine.startLevel(node, node.levels[i]);
    });
  });
}
function setLevelsMode(on){
  const home = $('#view-home');
  home.classList.toggle('levels-mode', on);
  $('#btn-map').setAttribute('aria-pressed', on ? 'true' : 'false');
  $('#btn-map .bm-label').textContent = on ? 'Games' : 'All levels';
  if (on) renderAllLevels();
  home.scrollTop = 0;
}

function renderHome(){
  setLevelsMode(false);   // always open home in the concept-card view
  const grid = $('#concept-grid');
  grid.innerHTML = '';
  for (const node of NODES){
    const np = nodeProgress(node.key);
    const unlocked = nodeUnlocked(node);
    const btn = document.createElement('button');
    btn.className = 'ccard' + (unlocked ? '' : ' locked');
    const ladder = node.levels.map((lv,i) => {
      const done = np.mastered.includes(lv.id);
      const cur = i === np.levelIdx && !done;
      return `<i data-lv="${i}" title="Level ${lv.id} — ${lv.name}" class="${done?'done':cur?'cur':''}"></i>`;
    }).join('');
    const allDone = np.mastered.length >= node.levels.length;
    btn.innerHTML = `
      ${NICON[node.key]}
      <span class="cname">${node.title}</span>
      <span class="clevel">${allDone ? 'All levels done ★' : 'Level ' + node.levels[np.levelIdx].id}</span>
      <span class="ladder">${ladder}</span>
      <span class="lock"><svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 2a5 5 0 0 1 5 5v3h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1V7a5 5 0 0 1 5-5zm0 2a3 3 0 0 0-3 3v3h6V7a3 3 0 0 0-3-3z"/></svg></span>`;
    // long-press (iPad-friendly) opens the big-card level picker
    let holdTimer = 0, longFired = false;
    btn.addEventListener('pointerdown', () => {
      Audio2.unlock();
      longFired = false;
      if (unlocked) holdTimer = setTimeout(() => { longFired = true; openPicker(node); }, 550);
    });
    ['pointerup','pointerleave','pointercancel'].forEach(ev =>
      btn.addEventListener(ev, () => clearTimeout(holdTimer)));
    btn.addEventListener('contextmenu', e => e.preventDefault());
    btn.addEventListener('click', e => {
      if (longFired){ longFired = false; return; }
      if (!unlocked){
        const first = node.prereqs[0];
        const pre = NODES.find(n=>n.key===first);
        Audio2.speak('First, let\'s finish ' + pre.title + '!');
        btn.classList.add('wobble'); setTimeout(()=>btn.classList.remove('wobble'), 500);
        return;
      }
      const np2 = nodeProgress(node.key);
      let idx = clamp(np2.levelIdx, 0, node.levels.length-1);
      // ladder dots choose a specific level: any level already reached or
      // mastered (every level when "Unlock every game" is on)
      const dot = e.target.closest('.ladder i');
      if (dot){
        const want = parseInt(dot.dataset.lv, 10);
        const reachable = Store.settings().unlockAll || want <= np2.levelIdx ||
          np2.mastered.includes(node.levels[want].id);
        if (reachable) idx = want;
      }
      Engine.startLevel(node, node.levels[idx]);
    });
    grid.appendChild(btn);
  }
}

/* ═══════════════════════ 10 · Dashboard ═══════════════════════════════════ */

export { nodeUnlocked, miniPreview, levelReachable, openPicker, closePicker, LP_LOCK, NODE_ACCENT, renderAllLevels, setLevelsMode, renderHome };

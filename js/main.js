import { Audio2, Captions } from './audio.js';
import { $ } from './core.js';
import { PROFILES, Simulator, computeInsights, computeStats, renderDash } from './dashboard.js';
import { Engine } from './engine.js';
import { Celebrate, FX } from './fx.js';
import { BubbleGame } from './games/bubble.js';
import { PuzzleGame } from './games/puzzle.js';
import { StackerGame } from './games/stacker.js';
import { GearGame } from './games/gears.js';
import { GlowGame } from './games/glow.js';
import { MemoryGame } from './games/memory.js';
import { TrainGame } from './games/train.js';
import { NODES } from './nodes.js';
import { showView } from './router.js';
import { openDebugHud, openVoices } from './voices.js';
import { Store } from './store.js';
import { Telemetry } from './telemetry.js';
import { applyTheme } from './theme.js';
import { closePicker, renderHome, setLevelsMode } from './ui.js';

function init(){
  applyTheme();
  FX.init();
  renderHome();

  // stage input
  const stage = $('#stage');
  stage.addEventListener('pointerdown', e => Engine.onPointerDown(e));
  window.addEventListener('pointermove', e => Engine.onPointerMove(e));
  window.addEventListener('pointerup', e => Engine.onPointerUp(e));
  window.addEventListener('pointercancel', e => Engine.onPointerCancel(e));
  // iPad hardening: kill the page-level multi-touch gestures that used to
  // interrupt a drag mid-flight. Safari's pinch/double-tap zoom arrives as
  // `gesture*` events (not pointer events, so touch-action can't stop them),
  // and a second finger landing during play would otherwise start one.
  ['gesturestart','gesturechange','gestureend'].forEach(ev =>
    document.addEventListener(ev, e => e.preventDefault(), { passive:false }));
  stage.addEventListener('touchstart', e => { if (e.touches.length > 1) e.preventDefault(); }, { passive:false });

  $('#btn-replay').addEventListener('click', () => { Audio2.unlock(); Engine.speakPrompt(true); });
  const ccBtn = $('#btn-cc');
  const syncCC = () => { const on = !!Store.settings().cc; ccBtn.classList.toggle('on', on); ccBtn.setAttribute('aria-pressed', on); };
  syncCC();
  ccBtn.addEventListener('click', () => {
    const s = Store.settings(); s.cc = !s.cc; Store.saveSettings(s);
    if (!s.cc) Captions.hide();
    syncCC();
  });
  $('#lp-close').addEventListener('click', closePicker);
  $('#lp-scrim').addEventListener('click', closePicker);
  $('#btn-home').addEventListener('click', () => { Engine.abort(); showView('home'); renderHome(); });
  $('#btn-again').addEventListener('click', () => { Audio2.unlock(); Engine.restartLevel(); });
  $('#btn-dash-back').addEventListener('click', () => { showView('home'); renderHome(); });
  // volume control (main screen) — slider adjusts, speaker icon toggles mute
  const volSlider = $('#vol-slider'), volIcon = $('#vol-icon');
  const volIconSvg = v => {
    const waves = v === 0 ? '<path d="M16 9l5 5m0-5l-5 5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>'
      : v < 0.34 ? ''
      : v < 0.7  ? '<path d="M16 9.5a3.5 3.5 0 0 1 0 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
      : '<path d="M16 9.5a3.5 3.5 0 0 1 0 5m2.5-8a7 7 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';
    return `<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M4 9v6h4l5 4V5L8 9H4z"/>${waves}</svg>`;
  };
  const playVol = $('#play-vol');
  const syncVolUI = () => {
    const v = Audio2.getVolume();
    volSlider.value = Math.round(v * 100);
    volIcon.innerHTML = volIconSvg(v);
    volIcon.setAttribute('aria-label', v === 0 ? 'Unmute' : 'Mute');
    // mirror onto the barely-there play-screen control
    playVol.innerHTML = volIconSvg(v);
    playVol.classList.toggle('muted', v === 0);
    playVol.setAttribute('aria-label', v === 0 ? 'Unmute' : 'Mute');
  };
  let volBeforeMute = 1;
  const toggleMute = () => {
    Audio2.unlock();
    const v = Audio2.getVolume();
    if (v > 0){ volBeforeMute = v; Audio2.setVolume(0); } else { Audio2.setVolume(volBeforeMute || 1); }
    syncVolUI();
  };
  playVol.addEventListener('click', toggleMute);
  Audio2.setVolume(typeof Store.settings().volume === 'number' ? Store.settings().volume : 1);
  syncVolUI();
  volSlider.addEventListener('input', () => { Audio2.unlock(); Audio2.setVolume(volSlider.value / 100); syncVolUI(); });
  volIcon.addEventListener('click', () => {
    Audio2.unlock();
    const v = Audio2.getVolume();
    if (v > 0){ volBeforeMute = v; Audio2.setVolume(0); } else { Audio2.setVolume(volBeforeMute || 1); }
    syncVolUI();
  });

  $('#btn-map').addEventListener('click', () => setLevelsMode(!$('#view-home').classList.contains('levels-mode')));

  // mini games
  document.querySelectorAll('.minicard').forEach(card => {
    card.addEventListener('pointerdown', () => Audio2.unlock());
    card.addEventListener('click', () => {
      if (card.dataset.mini === 'bubbles') BubbleGame.start();
      else if (card.dataset.mini === 'puzzle') PuzzleGame.start();
      else if (card.dataset.mini === 'stacker') StackerGame.start();
      else if (card.dataset.mini === 'gears') GearGame.start();
      else if (card.dataset.mini === 'glow') GlowGame.start();
      else if (card.dataset.mini === 'train') TrainGame.start();
      else if (card.dataset.mini === 'memory') MemoryGame.start();
    });
  });
  const bubStage = $('#bub-canvas');
  bubStage.addEventListener('pointerdown', e => {
    if (!BubbleGame.running) return;
    const r = bubStage.getBoundingClientRect();
    BubbleGame.hit(e.clientX - r.left, e.clientY - r.top);
  });
  $('#btn-bub-home').addEventListener('click', () => { BubbleGame.stop(); showView('home'); renderHome(); });
  $('#btn-bub-again').addEventListener('click', () => BubbleGame.start());
  window.addEventListener('resize', () => { if (BubbleGame.running) BubbleGame.size(); });
  $('#btn-puz-home').addEventListener('click', () => { showView('home'); renderHome(); });
  $('#btn-puz-again').addEventListener('click', () => PuzzleGame.start());
  $('#btn-stk-home').addEventListener('click', () => { StackerGame.stop(); showView('home'); renderHome(); });
  $('#btn-gr-home').addEventListener('click', () => { GearGame.stop(); showView('home'); renderHome(); });
  $('#btn-gs-home').addEventListener('click', () => { GlowGame.stop(); showView('home'); renderHome(); });
  $('#btn-trn-home').addEventListener('click', () => { TrainGame.stop(); showView('home'); renderHome(); });
  $('#btn-mem-home').addEventListener('click', () => { MemoryGame.stop(); showView('home'); renderHome(); });
  $('#mem-again').addEventListener('click', () => MemoryGame.start());
  document.querySelectorAll('.mem-sizebtn').forEach(b =>
    b.addEventListener('click', () => { Audio2.unlock(); MemoryGame.setBoard(b.dataset.size); }));
  $('#mem-board').addEventListener('click', e => {
    const c = e.target.closest('.mem-card');
    if (c) MemoryGame.tap(c);
  });
  $('#stk-dbg-btn').addEventListener('click', e => {
    StackerGame.debug = !StackerGame.debug;
    e.currentTarget.classList.toggle('on', StackerGame.debug);
    StackerGame.drawDebug();
  });

  // parent gate: press and hold 2.2s
  const gw = $('#btn-grownups');
  let holdT = 0;
  const startHold = e => {
    e.preventDefault();
    gw.classList.add('holding');
    holdT = setTimeout(() => { gw.classList.remove('holding'); renderDash(); showView('dash'); }, 675);
  };
  const stopHold = () => { gw.classList.remove('holding'); clearTimeout(holdT); };
  gw.addEventListener('pointerdown', startHold);
  gw.addEventListener('pointerup', stopHold);
  gw.addEventListener('pointerleave', stopHold);
  gw.addEventListener('pointercancel', stopHold);

  // audio unlock on any first interaction
  window.addEventListener('pointerdown', () => Audio2.unlock(), { once:true });

  // ?debug=1 docks the in-context audio HUD (what THIS screen is saying, with
  // the clip behind each beat); ?voices=1 opens the full bench. See js/voices.js.
  const dbgQ = new URLSearchParams(location.search);
  if (dbgQ.has('debug')) openDebugHud();
  if (dbgQ.has('voices')) openVoices();

  // deep link: ?level=4.2[&seed=N] opens that exact challenge (testing aid).
  // Both speech and WebAudio need a user gesture to start, and a page load is
  // not one — auto-starting here ran the whole expose/contrast intro in silence
  // on every refresh. One tap is asked for first, and that tap is what unlocks
  // the audio. (?autostart=1 skips it, for automated runs.)
  const q0 = new URLSearchParams(location.search);
  const lvId = q0.get('level');
  if (lvId){
    let found = null;
    for (const node of NODES){
      const lv = node.levels.find(l => l.id === lvId);
      if (lv){ found = { node, level: lv }; break; }
    }
    if (found){
      const seed = parseInt(q0.get('seed'), 36) || undefined;
      const go = () => Engine.startLevel(found.node, found.level, seed);
      if (q0.has('autostart')) go();
      else {
        const veil = document.createElement('button');
        veil.className = 'deeplink-veil';
        veil.innerHTML = `<span><b>Level ${lvId}</b>Tap to start<i>sound needs a tap first</i></span>`;
        veil.addEventListener('click', () => { Audio2.unlock(); veil.remove(); go(); });
        document.body.appendChild(veil);
      }
    }
  }

  // scripting hook for the test harness (drive trials, run simulations headlessly)
  window.CF = { Engine, Store, Simulator, Telemetry, NODES, PROFILES, Celebrate, BubbleGame, PuzzleGame, StackerGame, GearGame, GlowGame, TrainGame, MemoryGame,
    computeStats, computeInsights, renderDash, renderHome, showView, Audio2, openVoices };
}
init();

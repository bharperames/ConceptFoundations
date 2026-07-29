import { Audio2, Captions } from './audio.js';
import { $ } from './core.js';
import { PROFILES, Simulator, computeInsights, computeStats, renderDash } from './dashboard.js';
import { Engine } from './engine.js';
import { Celebrate, FX } from './fx.js';
import { BubbleGame } from './games/bubble.js';
import { PuzzleGame } from './games/puzzle.js';
import { StackerGame } from './games/stacker.js';
import { NODES } from './nodes.js';
import { showView } from './router.js';
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
  window.addEventListener('pointercancel', e => Engine.onPointerUp(e));

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

  // deep link: ?level=4.2[&seed=N] opens that exact challenge (testing aid)
  const q0 = new URLSearchParams(location.search);
  const lvId = q0.get('level');
  if (lvId){
    for (const node of NODES){
      const lv = node.levels.find(l => l.id === lvId);
      if (lv){ Engine.startLevel(node, lv, parseInt(q0.get('seed'), 36) || undefined); break; }
    }
  }

  // scripting hook for the test harness (drive trials, run simulations headlessly)
  window.CF = { Engine, Store, Simulator, Telemetry, NODES, PROFILES, Celebrate, BubbleGame, PuzzleGame, StackerGame,
    computeStats, computeInsights, renderDash, renderHome, showView };
}
init();

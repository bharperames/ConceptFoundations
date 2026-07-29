import { nodeProgress, saveNodeProgress } from './store.js';

function applyRunOutcome(node, level, results){
  const tests = results.filter(r => r.kind !== 'watch');
  const clean = tests.filter(r => r.firstAttemptCorrect && !r.usedFallback).length;
  const fellback = tests.filter(r => r.usedFallback).length;
  const np = nodeProgress(node.key);
  if (fellback > 0) np.consecFallbacks += fellback;
  else np.consecFallbacks = 0;
  let outcome = 'stay';
  if (np.consecFallbacks >= 3){
    np.consecFallbacks = 0;
    const curIdx = node.levels.indexOf(level);
    if (level.id === '1.4'){
      // route to whichever isolation variable the child struggled with more
      const s12 = np.isoStats['1.2']||0, s13 = np.isoStats['1.3']||0;
      np.levelIdx = (s13 > s12) ? 2 : 1;
    } else {
      np.levelIdx = Math.max(0, curIdx - 1);
    }
    outcome = 'down';
  } else if (clean >= Math.max(1, tests.length - 1)){
    const curIdx = node.levels.indexOf(level);
    if (!np.mastered.includes(level.id)) np.mastered.push(level.id);
    np.levelIdx = Math.min(node.levels.length - 1, curIdx + 1);
    outcome = (curIdx === node.levels.length - 1) ? 'complete' : 'up';
  }
  saveNodeProgress(node.key, np);
  return outcome;
}

/* Frustration: >3 unproductive taps inside 1 s (spec §3). Detected live for
   step-down, and re-derivable from the raw event stream for the dashboard. */
function makeFrustrationDetector(onFire){
  let taps = [];
  return function feed(ts, unproductive){
    if (!unproductive){ taps = []; return; }
    taps.push(ts);
    taps = taps.filter(t => ts - t <= 1000);
    if (taps.length > 3){ taps = []; onFire(); }
  };
}
function countFrustration(events){
  let taps = [], n = 0;
  for (const e of events){
    if (e.type !== 'TAP') continue;
    if (e.isCorrectIntent){ taps = []; continue; }
    taps.push(e.timestamp);
    taps = taps.filter(t => e.timestamp - t <= 1000);
    if (taps.length > 3){ n++; taps = []; }
  }
  return n;
}

/* ═══════════════════════ 7 · FX ═══════════════════════════════════════════ */

export { applyRunOutcome, makeFrustrationDetector, countFrustration };

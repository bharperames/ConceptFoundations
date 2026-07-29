import { Telemetry } from './telemetry.js';

const Store = {
  KEY_S:'cf_sessions_v2', KEY_P:'cf_progress_v2', KEY_C:'cf_settings_v2',
  sessions(){ try { return JSON.parse(localStorage.getItem(this.KEY_S)) || []; } catch(e){ return []; } },
  saveSessions(s){ try { localStorage.setItem(this.KEY_S, JSON.stringify(s.slice(-300))); } catch(e){} },
  progress(){
    try { return JSON.parse(localStorage.getItem(this.KEY_P)) || {}; } catch(e){ return {}; }
  },
  saveProgress(p){ try { localStorage.setItem(this.KEY_P, JSON.stringify(p)); } catch(e){} },
  settings(){ try { return JSON.parse(localStorage.getItem(this.KEY_C)) || {unlockAll:false, seedCounter:0}; } catch(e){ return {unlockAll:false, seedCounter:0}; } },
  saveSettings(s){ try { localStorage.setItem(this.KEY_C, JSON.stringify(s)); } catch(e){} },
  wipe(){ localStorage.removeItem(this.KEY_S); localStorage.removeItem(this.KEY_P); localStorage.removeItem(this.KEY_C); },
};
function nodeProgress(key){
  const p = Store.progress();
  if (!p[key]) p[key] = { levelIdx:0, mastered:[], consecFallbacks:0, isoStats:{} };
  return p[key];
}
function saveNodeProgress(key, np){
  const p = Store.progress(); p[key] = np; Store.saveProgress(p);
}

/* ═══════════════════════ 6 · Telemetry ════════════════════════════════════ */
/* InteractionEvent per spec: eventId, trialId, timestamp, type (TAP | DRAG_START |
   DRAG_END | TIMEOUT), coordinateX/Y, hitElementId, isCorrectIntent,
   timeSincePromptMs — plus missDistancePx, evaluated client-side. */

export { Store, nodeProgress, saveNodeProgress };

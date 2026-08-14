import { $ } from './core.js';

function showView(name){
  if (name !== 'play'){
    const q = new URLSearchParams(location.search);
    if (q.has('level') || q.has('seed')){
      q.delete('level'); q.delete('seed');
      history.replaceState(null, '', q.toString() ? '?' + q.toString() : location.pathname);
    }
  }
  $('#view-home').classList.toggle('hidden', name!=='home');
  $('#view-play').classList.toggle('hidden', name!=='play');
  $('#view-dash').classList.toggle('hidden', name!=='dash');
  $('#view-bubbles').classList.toggle('hidden', name!=='bubbles');
  $('#view-puzzle').classList.toggle('hidden', name!=='puzzle');
  $('#view-stacker').classList.toggle('hidden', name!=='stacker');
  $('#view-gears').classList.toggle('hidden', name!=='gears');
  $('#view-glow').classList.toggle('hidden', name!=='glow');
  $('#view-train').classList.toggle('hidden', name!=='train');
  $('#view-memory').classList.toggle('hidden', name!=='memory');
  // the quick mute control rides along on the play screens only
  $('#play-vol').classList.toggle('hidden', !(name==='play' || name==='bubbles' || name==='puzzle' || name==='stacker' || name==='gears' || name==='glow' || name==='train' || name==='memory'));
}

export { showView };

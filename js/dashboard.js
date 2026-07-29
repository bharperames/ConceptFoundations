import { Captions } from './audio.js';
import { $, clamp, hashStr, median, mulberry32, uuid } from './core.js';
import { applyRunOutcome, countFrustration } from './dda.js';
import { NODES } from './nodes.js';
import { Store, nodeProgress, saveNodeProgress } from './store.js';
import { applyTheme, effectiveDark } from './theme.js';
import { nodeUnlocked, renderHome } from './ui.js';

const PROFILES = {
  swift:      { label:'Quick learner', ttftMean:800,  ttftSd:400,  pTest:.93, pGen:.86, motorNoise:.15, frusP:.02, maxWrong:1 },
  typical:    { label:'Typical toddler', ttftMean:1600, ttftSd:900,  pTest:.78, pGen:.64, motorNoise:.35, frusP:.08, maxWrong:2 },
  cautious:   { label:'Careful & slow', ttftMean:3200, ttftSd:1400, pTest:.86, pGen:.76, motorNoise:.2,  frusP:.03, maxWrong:1 },
  struggling: { label:'Struggling', ttftMean:2200, ttftSd:1600, pTest:.52, pGen:.30, motorNoise:.3,  frusP:.25, maxWrong:3 },
};

const Simulator = {
  gauss(rng, mean, sd){
    const u = Math.max(rng(), 1e-9), v = rng();
    return mean + sd * Math.sqrt(-2*Math.log(u)) * Math.cos(2*Math.PI*v);
  },

  /* One synthetic wrong attempt: near-miss (motor slip, lands close to the
     target) or far miss (wrong choice — taps a distractor). */
  missSample(rng, profile){
    const nearMiss = rng() < profile.motorNoise;
    return nearMiss
      ? { hit: null, missPx: Math.round(6 + rng()*38) }
      : { hit: 'distractor', missPx: Math.round(90 + rng()*260) };
  },

  simulateSession(profileKey, rng, startTime){
    const profile = PROFILES[profileKey];
    // walk the curriculum in node order; play the first unlocked, unfinished node
    const node = NODES.find(n => nodeUnlocked(n) && nodeProgress(n.key).mastered.length < n.levels.length)
      || NODES[0];
    const np = nodeProgress(node.key);
    const level = node.levels[clamp(np.levelIdx, 0, node.levels.length-1)];
    const seed = Math.floor(rng()*2**31);
    const gen = level.make(mulberry32(seed));
    const trials = [gen.expose, gen.contrast, ...gen.tests].filter(Boolean);

    const session = {
      id: uuid(), userId:'child-sim', simulated:true, profile: profileKey,
      node: node.key, nodeTitle: node.parentName, levelId: level.id,
      levelName: level.name, isGen: !!level.isGen, seed,
      startTime, endTime: null, trials: [], events: [],
    };
    let t = startTime;
    const results = [];

    for (const trial of trials){
      const rec = {
        id: uuid(), state: trial.state,
        targetElementId: (trial.kind==='drag'||trial.kind==='stack') ? trial.pieces.map(p=>p.slot).join('+')
          : (trial.elements.find(e=>e.target)||{}).id || null,
        distractorElementIds: trial.elements.filter(e=>!e.target && !e.scenery && (e.tappable||e.zone)).map(e=>e.id),
        prompt: trial.prompt, timeoutMs: trial.timeoutMs,
        firstAttemptCorrect: null, usedFallback: false, kind: trial.kind,
      };
      session.trials.push(rec);
      t += 1500 + rng()*1200; // prompt speech
      const promptEnd = t;

      if (trial.kind === 'watch'){
        t += trial.autoMs || 3400;
        results.push({ state: trial.state, kind:'watch', firstAttemptCorrect: null, usedFallback: false });
        continue;
      }

      // depth makes later micro-levels slightly harder; generalization uses pGen
      const depth = node.levels.indexOf(level) * 0.03;
      const pOk = clamp((trial.state==='GENERALIZE' ? profile.pGen : profile.pTest) - depth, .05, .98);
      const ev = (type, extra) => session.events.push({
        eventId: uuid(), trialId: rec.id, timestamp: Math.round(t),
        coordinateX: Math.round(80 + rng()*600), coordinateY: Math.round(60 + rng()*320),
        timeSincePromptMs: Math.round(t - promptEnd), ...extra, type,
      });

      let wrongs = 0, done = false;
      while (!done){
        const firstTry = rec.firstAttemptCorrect === null;
        const succeed = rng() < (firstTry ? pOk : clamp(pOk + .25, 0, .97));
        t += clamp(this.gauss(rng, profile.ttftMean, profile.ttftSd), 350, trial.timeoutMs - 500);

        if (trial.timeoutMs && (t - promptEnd) > trial.timeoutMs && firstTry){
          ev('TIMEOUT', { hitElementId:null, isCorrectIntent:false, missDistancePx:null,
            coordinateX:null, coordinateY:null });
          rec.firstAttemptCorrect = false; rec.usedFallback = true;
        }

        if (trial.kind === 'drag' || trial.kind === 'stack'){
          ev('DRAG_START', { hitElementId: trial.pieces[0].el, isCorrectIntent:true, missDistancePx:null });
          t += 700 + rng()*900;
          if (succeed){
            ev('DRAG_END', { hitElementId: trial.pieces[0].slot, isCorrectIntent:true, missDistancePx:0 });
            if (firstTry && rec.firstAttemptCorrect === null) rec.firstAttemptCorrect = true;
            done = true;
          } else {
            ev('DRAG_END', { hitElementId:null, isCorrectIntent:false,
              missDistancePx: Math.round(20 + rng()*120) });
            if (rec.firstAttemptCorrect === null) rec.firstAttemptCorrect = false;
            wrongs++;
          }
        } else {
          if (succeed){
            ev('TAP', { hitElementId: rec.targetElementId, isCorrectIntent:true, missDistancePx:0 });
            if (firstTry && rec.firstAttemptCorrect === null) rec.firstAttemptCorrect = true;
            done = true;
          } else {
            const m = this.missSample(rng, profile);
            ev('TAP', { hitElementId: m.hit === 'distractor' ? (rec.distractorElementIds[0]||null) : null,
              isCorrectIntent:false, missDistancePx: m.missPx });
            if (rec.firstAttemptCorrect === null) rec.firstAttemptCorrect = false;
            wrongs++;
            if (level.id==='1.2' || level.id==='1.3'){
              np.isoStats[level.id] = (np.isoStats[level.id]||0) + 1;
            }
            // frustration burst: >3 unproductive taps inside 1s
            if (rng() < profile.frusP){
              for (let k=0;k<4;k++){ t += 120 + rng()*90;
                ev('TAP', { hitElementId:null, isCorrectIntent:false, missDistancePx: Math.round(60+rng()*200) }); }
              rec.usedFallback = true;
            }
          }
          if (wrongs >= 2) rec.usedFallback = true;
        }
        if (wrongs > profile.maxWrong && !done){
          // fallback scaffold carries them through
          t += 1200; rec.usedFallback = true;
          const okEv = (trial.kind === 'drag' || trial.kind === 'stack')
            ? ['DRAG_END', { hitElementId: trial.pieces[0].slot, isCorrectIntent:true, missDistancePx:0 }]
            : ['TAP', { hitElementId: rec.targetElementId, isCorrectIntent:true, missDistancePx:0 }];
          ev(okEv[0], okEv[1]);
          done = true;
        }
      }
      t += 1400; // celebration
      results.push({ state: trial.state, kind: trial.kind,
        firstAttemptCorrect: rec.firstAttemptCorrect, usedFallback: rec.usedFallback });
    }

    saveNodeProgress(node.key, np);
    session.outcome = applyRunOutcome(node, level, results);
    session.endTime = Math.round(t);
    session.completed = true;
    const all = Store.sessions(); all.push(session); Store.saveSessions(all);
    return session;
  },

  /* Simulate `days` of usage. Backs up curriculum progress the first time so
     "Remove simulated data" can restore the real state. */
  run(profileKey, days){
    const settings = Store.settings();
    if (!settings.progressBackup){
      settings.progressBackup = JSON.stringify(Store.progress());
      Store.saveSettings(settings);
    }
    const rng = mulberry32(hashStr(profileKey + '|' + (settings.simRuns = (settings.simRuns||0)+1)));
    Store.saveSettings(settings);
    const now = Date.now();
    let made = 0;
    for (let d = days; d >= 1; d--){
      const perDay = 1 + Math.floor(rng()*3);
      for (let s = 0; s < perDay; s++){
        const start = now - d*86400000 + (9 + s*4 + rng()*2)*3600000;
        this.simulateSession(profileKey, rng, Math.round(start));
        made++;
      }
    }
    return made;
  },

  clear(){
    Store.saveSessions(Store.sessions().filter(s => !s.simulated));
    const settings = Store.settings();
    if (settings.progressBackup){
      try { Store.saveProgress(JSON.parse(settings.progressBackup)); } catch(e){}
      delete settings.progressBackup;
      Store.saveSettings(settings);
    }
  },
};

/* ═══════════════════ 9b · Insights from telemetry ═════════════════════════
   Turns the raw event stream into the findings a designer iterates on. */
function computeInsights(sessions){
  const out = [];
  if (sessions.length < 3) return out;
  const stats = computeStats(sessions);

  // 1 · Generalization transfer per node (memorization risk)
  for (const n of NODES){
    const p = stats.per[n.key];
    if (!p || p.genN < 3 || p.testN < 3) continue;
    const tr = p.testOk/p.testN, gr = p.genOk/p.genN;
    if (tr - gr > .25){
      out.push({ level:'serious', title:`Memorization risk on ${n.parentName}`,
        body:`Test success is ${Math.round(tr*100)}% but generalization drops to ${Math.round(gr*100)}%. The visual pattern may be memorized rather than the concept acquired — consider more variety in the ${n.levels.find(l=>l.isGen).id} asset pool.` });
    } else if (gr >= tr - .1){
      out.push({ level:'good', title:`${n.parentName} transfers well`,
        body:`Generalization success (${Math.round(gr*100)}%) keeps pace with tests (${Math.round(tr*100)}%) — evidence of true conceptual acquisition.` });
    }
  }

  // 2 · Frustration hotspots by micro-level
  const frusByLevel = {};
  for (const s of sessions){
    const f = countFrustration(s.events);
    if (f) frusByLevel[s.levelId] = (frusByLevel[s.levelId]||0) + f;
  }
  const hot = Object.entries(frusByLevel).sort((a,b)=>b[1]-a[1])[0];
  if (hot && hot[1] >= 3){
    out.push({ level:'serious', title:`Frustration hotspot at level ${hot[0]}`,
      body:`${hot[1]} rapid-tap episodes concentrated on micro-level ${hot[0]}. Its difficulty step may be too steep — widen the snap radius, cut a distractor, or soften the prompt pacing.` });
  }

  // 3 · TTFT trend (early vs late sessions)
  const ordered = sessions.slice().sort((a,b)=>a.startTime-b.startTime);
  const half = Math.floor(ordered.length/2);
  if (half >= 3){
    const t1 = median(computeStats(ordered.slice(0,half)).all.ttfts);
    const t2 = median(computeStats(ordered.slice(half)).all.ttfts);
    if (t1 && t2){
      const delta = (t2-t1)/t1;
      if (delta < -.15) out.push({ level:'good', title:'Processing speed improving',
        body:`Median time-to-first-touch fell from ${fmtMs(t1)} to ${fmtMs(t2)} between the first and second half of sessions — prompts are being understood faster.` });
      else if (delta > .25) out.push({ level:'warning', title:'Responses slowing down',
        body:`Median time-to-first-touch rose from ${fmtMs(t1)} to ${fmtMs(t2)}. Recent levels may demand more scanning than earlier ones — check whether the current micro-level jumped too far.` });
    }
  }

  // 4 · Miss profile: motor vs conceptual errors
  const a = stats.all;
  if (a.missNear + a.missFar >= 5){
    const nearRatio = a.missNear/(a.missNear+a.missFar);
    if (nearRatio > .6) out.push({ level:'warning', title:'Misses are motor, not conceptual',
      body:`${Math.round(nearRatio*100)}% of first-attempt misses land within 48px of the correct target — the intent is right but the targets are hard to hit. Consider enlarging touch targets before lowering difficulty.` });
    else if (nearRatio < .3) out.push({ level:'warning', title:'Wrong choices dominate misses',
      body:`${Math.round((1-nearRatio)*100)}% of first-attempt misses are far from the target — these are conceptual, not motor. The DDA step-down path is the right lever here.` });
  }

  // 5 · DDA repair loops
  const downs = {};
  for (const s of sessions) if (s.outcome==='down') downs[s.node] = (downs[s.node]||0)+1;
  for (const [k,v] of Object.entries(downs)){
    if (v >= 2){
      const n = NODES.find(x=>x.key===k);
      out.push({ level:'warning', title:`Repair loop active on ${n.parentName}`,
        body:`The difficulty engine has stepped ${n.parentName} down ${v} times to rebuild the foundation — expected behavior, but if it persists, the level below may not be isolating the right variable.` });
    }
  }

  const rank = { serious:0, warning:1, good:2 };
  return out.sort((x,y)=>rank[x.level]-rank[y.level]);
}

/* ═══════════════════════ 10 · Home ════════════════════════════════════════ */
function fmtMs(ms){
  if (ms === null || ms === undefined || isNaN(ms)) return '—';
  return (ms/1000).toFixed(1) + 's';
}
function computeStats(sessions){
  const per = {}; // node → aggregates
  const all = { ttfts:[], testN:0, testOk:0, genN:0, genOk:0, frus:0, missNear:0, missFar:0 };
  for (const s of sessions){
    const node = s.node;
    per[node] = per[node] || { ttfts:[], testN:0, testOk:0, genN:0, genOk:0, frus:0 };
    per[node].frus += countFrustration(s.events);
    all.frus += countFrustration(s.events);
    for (const t of s.trials){
      if (t.state !== 'TEST' && t.state !== 'GENERALIZE') continue;
      const evs = s.events.filter(e => e.trialId === t.id);
      const first = evs.find(e => e.type==='TAP' || e.type==='DRAG_START');
      if (first && first.timeSincePromptMs !== null){
        per[node].ttfts.push(first.timeSincePromptMs);
        all.ttfts.push(first.timeSincePromptMs);
      }
      const firstAttempt = evs.find(e => e.type==='TAP' || e.type==='DRAG_END');
      if (firstAttempt && !firstAttempt.isCorrectIntent && firstAttempt.missDistancePx !== null){
        if (firstAttempt.missDistancePx < 48) all.missNear++; else all.missFar++;
      }
      const ok = t.firstAttemptCorrect === true;
      if (t.state === 'TEST'){ per[node].testN++; all.testN++; if (ok){ per[node].testOk++; all.testOk++; } }
      else { per[node].genN++; all.genN++; if (ok){ per[node].genOk++; all.genOk++; } }
    }
  }
  return { per, all };
}

let tipEl = null;
function attachTips(container){
  tipEl = container.querySelector('.viz-tip');
  container.querySelectorAll('[data-tip]').forEach(n => {
    n.addEventListener('pointerenter', () => {
      const r = n.getBoundingClientRect(), cr = container.getBoundingClientRect();
      tipEl.innerHTML = n.dataset.tip;
      tipEl.style.left = (r.left + r.width/2 - cr.left)+'px';
      tipEl.style.top = (r.top - cr.top)+'px';
      tipEl.style.opacity = '1';
    });
    n.addEventListener('pointerleave', () => { tipEl.style.opacity = '0'; });
  });
}

function barChartTTFT(stats){
  const data = NODES.map(n => ({ name: n.parentName, v: median(stats.per[n.key] ? stats.per[n.key].ttfts : []) }))
    .filter(d => d.v !== null);
  if (!data.length) return '';
  const W=640, Hh=210, padL=40, padB=26, padT=14;
  const maxV = Math.max(...data.map(d=>d.v), 2000);
  const top = Math.ceil(maxV/1000)*1000;
  const bw = 34, gap = (W-padL-20)/data.length;
  const y = v => padT + (Hh-padT-padB) * (1 - v/top);
  const grid = [0, top/2, top].map(v =>
    `<line x1="${padL}" y1="${y(v)}" x2="${W-8}" y2="${y(v)}" stroke="var(--d-grid)" stroke-width="1"/>
     <text x="${padL-6}" y="${y(v)+4}" text-anchor="end" font-size="11" fill="var(--d-muted)">${(v/1000)}s</text>`).join('');
  const bars = data.map((d,i) => {
    const cx = padL + gap*i + gap/2;
    const h = Hh-padB - y(d.v);
    return `
      <path d="M${cx-bw/2} ${Hh-padB} L${cx-bw/2} ${y(d.v)+4} Q${cx-bw/2} ${y(d.v)} ${cx-bw/2+4} ${y(d.v)} L${cx+bw/2-4} ${y(d.v)} Q${cx+bw/2} ${y(d.v)} ${cx+bw/2} ${y(d.v)+4} L${cx+bw/2} ${Hh-padB} Z" fill="var(--s1)"/>
      <rect x="${cx-gap/2}" y="${padT}" width="${gap}" height="${Hh-padT-padB}" fill="transparent" data-tip="<b>${d.name}</b> · median ${fmtMs(d.v)}"/>
      <text x="${cx}" y="${y(d.v)-6}" text-anchor="middle" font-size="11" fill="var(--d-ink2)">${fmtMs(d.v)}</text>
      <text x="${cx}" y="${Hh-8}" text-anchor="middle" font-size="12" fill="var(--d-ink2)">${d.name}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${Hh}" style="width:100%;height:auto" role="img" aria-label="Median time to first touch by concept">
    ${grid}<line x1="${padL}" y1="${Hh-padB}" x2="${W-8}" y2="${Hh-padB}" stroke="var(--d-axis)" stroke-width="1"/>${bars}</svg>`;
}

function barChartTransfer(stats){
  const data = NODES.map(n => {
    const p = stats.per[n.key];
    if (!p || (p.testN===0 && p.genN===0)) return null;
    return { name: n.parentName,
      test: p.testN ? p.testOk/p.testN : null,
      gen:  p.genN ? p.genOk/p.genN : null };
  }).filter(Boolean);
  if (!data.length) return '';
  const W=640, Hh=210, padL=40, padB=26, padT=14;
  const y = v => padT + (Hh-padT-padB) * (1 - v);
  const gap = (W-padL-20)/data.length, bw=22;
  const grid = [0,.5,1].map(v =>
    `<line x1="${padL}" y1="${y(v)}" x2="${W-8}" y2="${y(v)}" stroke="var(--d-grid)" stroke-width="1"/>
     <text x="${padL-6}" y="${y(v)+4}" text-anchor="end" font-size="11" fill="var(--d-muted)">${v*100}%</text>`).join('');
  const bar = (cx, v, color, label) => v===null ? '' : `
    <path d="M${cx-bw/2} ${Hh-padB} L${cx-bw/2} ${Math.min(y(v)+4, Hh-padB)} Q${cx-bw/2} ${y(v)} ${cx-bw/2+4} ${y(v)} L${cx+bw/2-4} ${y(v)} Q${cx+bw/2} ${y(v)} ${cx+bw/2} ${Math.min(y(v)+4, Hh-padB)} L${cx+bw/2} ${Hh-padB} Z" fill="${color}"/>
    <rect x="${cx-bw/2-2}" y="${padT}" width="${bw+4}" height="${Hh-padT-padB}" fill="transparent" data-tip="${label} · ${Math.round(v*100)}%"/>`;
  const bars = data.map((d,i) => {
    const cx = padL + gap*i + gap/2;
    return bar(cx-bw/2-1, d.test, 'var(--s1)', `<b>${d.name}</b> test`) +
           bar(cx+bw/2+1, d.gen, 'var(--s2)', `<b>${d.name}</b> generalize`) +
           `<text x="${cx}" y="${Hh-8}" text-anchor="middle" font-size="12" fill="var(--d-ink2)">${d.name}</text>`;
  }).join('');
  return `
    <div class="legend"><span><i style="background:var(--s1)"></i>Test success</span>
    <span><i style="background:var(--s2)"></i>Generalize success</span></div>
    <svg viewBox="0 0 ${W} ${Hh}" style="width:100%;height:auto" role="img" aria-label="Test versus generalization success by concept">
    ${grid}<line x1="${padL}" y1="${Hh-padB}" x2="${W-8}" y2="${Hh-padB}" stroke="var(--d-axis)" stroke-width="1"/>${bars}</svg>`;
}

function renderDash(){
  const body = $('#dash-body');
  const sessions = Store.sessions();
  const settings = Store.settings();

  const nodeMap = NODES.map(n => {
    const np = nodeProgress(n.key);
    const steps = n.levels.map((lv,i) =>
      `<i class="${np.mastered.includes(lv.id)?'done':i===np.levelIdx?'cur':''}" title="${lv.id} ${lv.name}"></i>`).join('');
    const cur = n.levels[clamp(np.levelIdx,0,n.levels.length-1)];
    const doneAll = np.mastered.length >= n.levels.length;
    return `<div class="nodecard"><div class="nn">${n.num} · ${n.parentName}</div>
      <div class="nl">${doneAll ? 'Complete' : 'On ' + cur.id + ' — ' + cur.name}</div>
      <div class="steps">${steps}</div></div>`;
  }).join('');

  const simCount = sessions.filter(s=>s.simulated).length;
  const controls = `
    <h2>Usage simulator</h2>
    <p class="h2-sub">A test harness for the telemetry loop: synthetic sessions run through the same level generators, event schema, and difficulty engine as real play, so you can preview how the dashboard and insights respond to different learner profiles.</p>
    <div class="sim-card">
      <div class="sim-row">
        <select id="sim-profile" aria-label="Learner profile">
          ${Object.entries(PROFILES).map(([k,p])=>`<option value="${k}">${p.label}</option>`).join('')}
        </select>
        <button id="btn-sim-week" class="btn-primary">Simulate 7 days</button>
        <button id="btn-sim-day" class="btn-quiet">Simulate 1 day</button>
        ${simCount ? `<button id="btn-sim-clear" class="btn-quiet">Remove simulated data (${simCount})</button>` : ''}
      </div>
      <div class="sim-note">Simulated sessions advance the curriculum exactly as real play would. Removing them also restores the curriculum position from before the first simulation.</div>
    </div>

    <h2>Settings &amp; data</h2>
    <div class="dash-controls">
      <div class="ctl"><button id="sw-unlock" class="switch ${settings.unlockAll?'on':''}" role="switch" aria-checked="${settings.unlockAll}" aria-label="Unlock every game"></button>
        <span>Unlock every game (skip prerequisites)</span></div>
      <div class="ctl"><button id="sw-cc" class="switch ${settings.cc?'on':''}" role="switch" aria-checked="${!!settings.cc}" aria-label="Captions"></button>
        <span>Captions (CC) — show spoken words as text</span></div>
      <div class="ctl"><button id="sw-dark" class="switch ${effectiveDark()?'on':''}" role="switch" aria-checked="${effectiveDark()}" aria-label="Dark mode"></button>
        <span>Dark mode${typeof settings.darkMode==='boolean' ? '' : ' (following device setting)'}</span></div>
      <button id="btn-wipe" class="danger">Erase all data</button>
    </div>`;

  if (!sessions.length){
    body.innerHTML = `
      <h2>Curriculum position</h2>
      <p class="h2-sub">Where your child sits on each node's micro-level ladder.</p>
      <div class="nodemap">${nodeMap}</div>
      <div class="empty"><b>No sessions yet</b>Hand the device to your child and play a game — every touch lands here as data.</div>
      ${controls}`;
  } else {
    const stats = computeStats(sessions);
    const a = stats.all;
    const transferRatio = (a.testN && a.genN) ? (a.genOk/a.genN) / Math.max(.0001,(a.testOk/a.testN)) : null;
    const recent = sessions.slice(-12).reverse();
    const rows = recent.map(s => {
      const tests = s.trials.filter(t => t.state==='TEST'||t.state==='GENERALIZE');
      const ok = tests.filter(t=>t.firstAttemptCorrect).length;
      const tt = [];
      for (const t of tests){
        const first = s.events.find(e => e.trialId===t.id && (e.type==='TAP'||e.type==='DRAG_START'));
        if (first && first.timeSincePromptMs!==null) tt.push(first.timeSincePromptMs);
      }
      const d = new Date(s.startTime);
      const when = d.toLocaleDateString(undefined,{month:'short',day:'numeric'}) + ' ' +
                   d.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
      return `<tr>
        <td>${when}</td>
        <td>${s.nodeTitle} <span class="pill ${s.isGen?'gen':'test'}">${s.levelId}</span>${s.simulated?' <span class="pill sim">sim</span>':''}</td>
        <td class="num">${ok}/${tests.length}</td>
        <td class="num">${fmtMs(median(tt))}</td>
        <td class="num">${countFrustration(s.events)}</td>
      </tr>`;
    }).join('');

    body.innerHTML = `
      <div class="tiles">
        <div class="tile"><div class="tv">${sessions.length}</div><div class="tl">Sessions</div>
          <div class="th">${sessions.filter(s=>s.completed).length} finished full runs</div></div>
        <div class="tile"><div class="tv">${fmtMs(median(a.ttfts))}</div><div class="tl">Median time to first touch</div>
          <div class="th">From the end of the spoken prompt to the first touch — a proxy for processing speed.</div></div>
        <div class="tile"><div class="tv">${transferRatio===null?'—':Math.round(transferRatio*100)+'%'}</div><div class="tl">Generalization transfer</div>
          <div class="th">Success on generalization levels relative to standard tests. Near 100% suggests real acquisition, not visual memorization.</div></div>
        <div class="tile"><div class="tv">${a.frus}</div><div class="tl">Frustration episodes</div>
          <div class="th">Bursts of 4+ rapid unproductive taps within a second. Each one triggers an automatic step-down.</div></div>
      </div>

      ${(() => {
        const ins = computeInsights(sessions);
        if (!ins.length) return '';
        const icon = { good:'✓', warning:'!', serious:'!' };
        const tag = { good:'On track', warning:'Watch', serious:'Action' };
        return `<h2>Insights</h2>
          <p class="h2-sub">Findings derived automatically from the event stream — the feedback loop for tuning levels, targets, and pacing.</p>
          <div class="insights">${ins.map(i => `
            <div class="insight ${i.level}">
              <span class="ic" aria-hidden="true">${icon[i.level]}</span>
              <div><div class="it">${i.title}<span class="tag">${tag[i.level]}</span></div>
              <div class="ib">${i.body}</div></div>
            </div>`).join('')}</div>`;
      })()}

      <h2>Curriculum position</h2>
      <p class="h2-sub">Where your child sits on each node's micro-level ladder. Green = mastered, blue = current.</p>
      <div class="nodemap">${nodeMap}</div>

      <h2>Time to first touch</h2>
      <p class="h2-sub">Median latency between prompt end and first touch, per concept node. Falling latency over time indicates faster comprehension.</p>
      <div class="chart-card" id="chart-ttft">${barChartTTFT(stats)}<div class="viz-tip"></div></div>

      <h2>Test vs. generalize</h2>
      <p class="h2-sub">First-attempt success on standard tests against generalization levels. A large gap means the pattern was memorized, not the concept.</p>
      <div class="chart-card" id="chart-transfer">${barChartTransfer(stats)}<div class="viz-tip"></div></div>

      <h2>Recent sessions</h2>
      <p class="h2-sub">Miss-distance detail: ${a.missNear} near-misses under 48px (motor slips) vs ${a.missFar} far misses (wrong choice) on first attempts.</p>
      <div style="overflow-x:auto"><table>
        <thead><tr><th>When</th><th>Level</th><th class="num">First-try correct</th><th class="num">Median TTFT</th><th class="num">Frustration</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      ${controls}`;

    attachTips($('#chart-ttft'));
    attachTips($('#chart-transfer'));
  }

  const profileSel = $('#sim-profile');
  if (profileSel && settings.lastProfile) profileSel.value = settings.lastProfile;
  const runSim = days => {
    const key = profileSel.value;
    const s = Store.settings(); s.lastProfile = key; Store.saveSettings(s);
    Simulator.run(key, days);
    renderDash(); renderHome();
  };
  $('#btn-sim-week').addEventListener('click', () => runSim(7));
  $('#btn-sim-day').addEventListener('click', () => runSim(1));
  const simClear = $('#btn-sim-clear');
  if (simClear) simClear.addEventListener('click', () => { Simulator.clear(); renderDash(); renderHome(); });

  $('#sw-unlock').addEventListener('click', () => {
    const s = Store.settings(); s.unlockAll = !s.unlockAll; Store.saveSettings(s);
    renderDash();
  });
  $('#sw-cc').addEventListener('click', () => {
    const s = Store.settings(); s.cc = !s.cc; Store.saveSettings(s);
    renderDash();
  });
  $('#sw-dark').addEventListener('click', () => {
    const s = Store.settings(); s.darkMode = !effectiveDark(); Store.saveSettings(s);
    applyTheme(); renderDash();
  });
  const wipe = $('#btn-wipe');
  wipe.addEventListener('click', () => {
    if (!wipe.classList.contains('armed')){
      wipe.classList.add('armed'); wipe.textContent = 'Tap again to erase everything';
      setTimeout(()=>{ wipe.classList.remove('armed'); wipe.textContent='Erase all data'; }, 3500);
    } else {
      Store.wipe(); renderDash(); renderHome();
    }
  });
}

/* ═══════════════════════ 11 · Shell / routing ═════════════════════════════ */

export { PROFILES, Simulator, computeInsights, fmtMs, computeStats, tipEl, attachTips, barChartTTFT, barChartTransfer, renderDash };

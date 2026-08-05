import { $, clamp } from './core.js';
import { Store } from './store.js';

const Captions = {
  el: null, timer: 0,
  hide(){ if (this.el) this.el.classList.remove('on'); },
  enabled(){
    return !!Store.settings().cc || new URLSearchParams(location.search).has('cc');
  },
  show(text){
    if (!this.enabled()) return;
    if (!this.el){
      this.el = document.createElement('div');
      this.el.className = 'cc-bar';
      this.el.setAttribute('aria-live', 'polite');
      document.body.appendChild(this.el);
    }
    this.el.textContent = text;
    this.el.classList.add('on');
    clearTimeout(this.timer);
    // linger long enough to read, roughly matching speech duration
    this.timer = setTimeout(() => this.el.classList.remove('on'),
      Math.max(1600, 500 + text.length * 70));
  },
};

const Audio2 = (() => {
  let ctx = null, master = null, voice = null, unlocked = false;
  // ?mute=1 silences speech and tones (for automated testing); prompt timing
  // still fires so TTFT telemetry keeps its semantics.
  const muted = new URLSearchParams(location.search).has('mute');
  // master volume 0..1 — scales both Web Audio (via the master gain node) and
  // TTS (via utterance.volume). Loaded from settings in init(), persisted here.
  let vol = 1;
  function setVolume(v){
    vol = Math.max(0, Math.min(1, v));
    if (master) master.gain.value = vol;
    try { const s = Store.settings(); s.volume = vol; Store.saveSettings(s); } catch(e){}
  }
  const getVolume = () => vol;

  function unlock(){
    if (unlocked) return; unlocked = true;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      master = ctx.createGain(); master.gain.value = vol; master.connect(ctx.destination);
    } catch(e){ ctx = null; }
    if ('speechSynthesis' in window){
      const load = () => {
        const vs = speechSynthesis.getVoices().filter(v => v.lang.startsWith('en'));
        voice = vs.find(v => /Samantha|Karen|Google US/i.test(v.name)) || vs[0] || null;
      };
      load(); speechSynthesis.onvoiceschanged = load;
    }
  }

  /* Recorded-clip layer. A spoken phrase plays a real audio clip when one is
     mapped; anything unmapped falls back to synthesized speech. Add a phrase
     by dropping clips/<name>.mp3 and one CLIP_MAP entry — nothing else changes.
     Disable with ?noclips=1 (falls back to TTS everywhere). */
  const clipsOff = new URLSearchParams(location.search).has('noclips');
  const CLIP_MAP = {
    'great job': 'great_job.mp3',
    'yay': 'yay.mp3',
    'hooray': 'hooray.mp3',
    'we did it': 'we_did_it.mp3',
    'peekaboo': 'peekaboo.mp3',
    'lets play hide and seek': 'lets_play_hide_and_seek.mp3',
    'uh oh': 'uh_oh.mp3',
    'pop': 'pop.mp3',
    'cuckoo': 'cuckoo.mp3',
    'you did it': 'you_did_it.mp3',
    'baby put your pants on pants on pants on': 'pants_on.mp3',
    'open them shut them': 'open_shut.mp3',
    'bubble bubble bubble bubble bubble pop': 'bubble_pop.mp3',
    // itsy-bitsy-spider song (spout cause→effect) — one continuous take, 3 lines
    'the itsy bitsy spider went up the water spout': 'spider_up.mp3',
    'down came the rain and washed the spider out': 'spider_washed_out.mp3',
    'out came the sun and dried up all the rain and the itsy bitsy spider went up the spout again': 'spider_sun_again.mp3',
  };
  // strip apostrophes first (so "let's" → "lets", not "let s"), then the rest
  const normPhrase = t => t.toLowerCase().replace(/['’`]/g,'').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
  const clipBuffers = {};   // url → Promise<AudioBuffer>
  function loadClip(url){
    if (!clipBuffers[url]){
      clipBuffers[url] = fetch(url)
        .then(r => r.ok ? r.arrayBuffer() : Promise.reject(new Error('404')))
        .then(a => ctx.decodeAudioData(a));
    }
    return clipBuffers[url];
  }
  let talkTimer = 0;
  function talkFor(ms){
    const spk = $('#btn-replay');
    if (!spk) return;
    spk.classList.add('talking');
    const ring = spk.querySelector('.spk-ring-fill');
    if (ring){
      ring.style.transition = 'none'; ring.style.strokeDashoffset = '157';
      void ring.getBoundingClientRect();
      ring.style.transition = 'stroke-dashoffset ' + ms + 'ms linear';
      ring.style.strokeDashoffset = '0';
    }
    clearTimeout(talkTimer);
    talkTimer = setTimeout(() => {
      spk.classList.remove('talking');
      if (ring){ ring.style.transition = 'none'; ring.style.strokeDashoffset = '157'; }
    }, ms);
  }
  function ttsSpeak(text, onend){
    if (!('speechSynthesis' in window)){ if (onend) setTimeout(onend, 600); return; }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.rate = 0.9; u.pitch = 1.1; u.volume = vol;
    let done = false;
    const fin = () => { if (!done){ done = true; if (onend) onend(); } };
    u.onend = fin; u.onerror = fin;
    setTimeout(fin, 900 + text.length * 90);   // some engines never fire onend
    talkFor(900 + text.length * 90);
    speechSynthesis.speak(u);
  }

  /* Play a clip without an AudioContext. Nothing may have been tapped yet (a
     deep link, an autoplaying prompt), and a letter MUST come from its clip —
     falling through to the voice is what produces "capital N". */
  /* Only one recording plays at a time. speechSynthesis.cancel() ends a
     synthesized line, but a WebAudio source keeps going until it is told to
     stop — so a prompt repeating, or a new trial starting, layered a second
     copy of the clip over the first. Two offset copies of a 0.8s "uh-oh" sound
     like one clip cut apart. */
  let playing = null;
  function stopSound(){
    if (!playing) return;
    try { playing.stop(); } catch (e){}
    playing = null;
  }

  function playClipEl(url, onend){
    stopSound();
    let done = false;
    const fin = () => { if (!done){ done = true; if (onend) onend(); } };
    const a = new Audio(url);
    playing = { stop: () => { a.pause(); a.currentTime = 0; } };
    a.volume = vol;
    a.onended = fin; a.onerror = fin;
    a.onloadedmetadata = () => talkFor(a.duration * 1000 + 150);
    setTimeout(fin, 3000);                       // safety net
    a.play().catch(fin);
  }

  function speakOne(text, onend){
    if (muted){ if (onend) setTimeout(onend, 250); return; }
    const clip = !clipsOff && CLIP_MAP[normPhrase(text)];
    note(text, clip);
    if (clip && !ctx){ playClipEl('./clips/' + clip, onend); return; }
    if (clip){
      loadClip('./clips/' + clip).then(buf => {
        let done = false;
        const fin = () => { if (!done){ done = true; if (onend) onend(); } };
        stopSound();
        const src = ctx.createBufferSource();
        src.buffer = buf; src.connect(master);
        src.onended = fin;
        playing = { stop: () => src.stop() };
        setTimeout(fin, buf.duration * 1000 + 250);   // onended safety net
        talkFor(buf.duration * 1000 + 150);
        src.start();
      }).catch(() => playClipEl('./clips/' + clip, () => ttsSpeak(text, onend)));
      return;
    }
    ttsSpeak(text, onend);
  }

  /* A "|" in a phrase is a BEAT: the phrase is spoken in segments with a real
     gap between them. Letter names are one syllable and run straight into the
     next word — "and this one is are a different letter" — and no engine
     honours a period reliably enough to separate them. A beat is a hard stop
     the voice cannot smooth over. Captions still read as one line, and each
     segment is looked up in CLIP_MAP on its own, so a curated letter clip
     drops straight in. */
  /* `|` is a short beat, `||` a long one (letters read as a list want room).
     220ms read as a stumble between "letter" and the name; 120 flows. */
  const BEAT_MS = 120, LONG_BEAT_MS = 300;
  function beatParts(t){
    const out = [];
    let gap = 0;
    for (const tok of String(t).split(/(\|+)/)){
      if (/^\|+$/.test(tok)){ gap = tok.length > 1 ? LONG_BEAT_MS : BEAT_MS; continue; }
      const seg = tok.trim();
      if (seg) out.push({ seg, gap: out.length ? gap : 0 });
    }
    return out;
  }
  const beats = t => beatParts(t).map(p => p.seg);

  /* Debug surface (see js/voices.js). `resolve` answers "what will this line
     actually sound like" — which beats play a recording and which are
     synthesized — without speaking it. `history` is what really got said, so a
     wrong line can be found after the fact instead of reproduced. */
  function resolve(text){
    return beats(text).map(seg => {
      const clip = !clipsOff && CLIP_MAP[normPhrase(seg)];
      return { seg, norm: normPhrase(seg), clip: clip || null,
               url: clip ? './clips/' + clip : null };
    });
  }
  const history = [];
  function note(seg, clip){
    history.push({ seg, clip: clip || null, at: Date.now() });
    if (history.length > 800) history.shift();
  }
  /* Every line gets a generation number. A beat chain checks it before each
     segment, so starting a new line abandons the old one instead of letting it
     wake up mid-word and speak a leftover fragment over the top — which is
     what made spelled-out names trail off into garbled audio. */
  let gen = 0;
  const stop = () => { gen++; stopSound(); if (window.speechSynthesis) speechSynthesis.cancel(); };
  /* `onBeat(index, seg)` fires as each beat begins, which is what lets the
     stage move in time with the words — a letter hops as its name is said. */
  function speak(text, onend, onBeat){
    if (document.hidden){ if (onend) setTimeout(onend, 250); return; }
    const parts = beatParts(text);
    stopSound();                       // this line replaces whatever is sounding
    const mine = ++gen;
    Captions.show(parts.map(p => p.seg).join(' '));
    let i = 0;
    const next = () => {
      if (mine !== gen) return;                 // a newer line took over
      if (i >= parts.length){ if (onend) onend(); return; }
      const at = i, part = parts[i++];
      if (onBeat) onBeat(at, part.seg);
      speakOne(part.seg, () => {
        if (mine !== gen) return;
        if (i >= parts.length){ if (onend) onend(); }
        else setTimeout(next, parts[i].gap);
      });
    };
    if (parts.length && parts[0].gap) setTimeout(next, parts[0].gap); else next();
  }

  function tone(freq, t0, dur, type='sine', gain=0.16){
    if (!ctx || muted) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, ctx.currentTime + t0);
    g.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t0 + dur);
    o.connect(g); g.connect(master);
    o.start(ctx.currentTime + t0); o.stop(ctx.currentTime + t0 + dur + 0.05);
  }
  function clack(intensity){
    // wood-on-wood impact: a deep, subdued CLUNK — a damped low knock (fast
    // pitch drop, like a woodblock an octave down) plus a tiny lowpassed
    // contact tick. The old 1.4kHz bandpassed noise burst read as tinny.
    if (!ctx || muted) return;
    const t0 = ctx.currentTime, k = clamp(intensity, .15, 1);
    // body knock: 150–230 Hz falling to ~55% over 70ms, gone in ~120ms
    const o = ctx.createOscillator(), og = ctx.createGain();
    const f0 = 150 + Math.random()*40 + k*40;      // small per-hit variation
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(f0*0.55, t0 + 0.07);
    og.gain.setValueAtTime(0.85*k, t0);
    og.gain.exponentialRampToValueAtTime(0.001, t0 + 0.11);
    o.connect(og); og.connect(master);
    o.start(t0); o.stop(t0 + 0.12);
    // contact transient: 30ms of noise through a dark lowpass
    const dur = 0.03;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate*dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i=0;i<data.length;i++) data[i] = (Math.random()*2-1) * Math.pow(1 - i/data.length, 2);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const lp = ctx.createBiquadFilter(); lp.type='lowpass'; lp.frequency.value = 550 + 450*k; lp.Q.value = 0.7;
    const g = ctx.createGain(); g.gain.value = 0.4 * k;
    src.connect(lp); lp.connect(g); g.connect(master);
    src.start(t0);
  }
  function bell(){
    // church-bell partial stack on C5: hum, prime, tierce (the minor third
    // that makes a bell sound like a bell), quint, nominal — lower partials
    // ring longer, tiny detune keeps repeated strikes alive
    if (!ctx || muted) return;
    const t0 = ctx.currentTime;
    for (const [f, amp, dur] of [[261.6,.16,1.9],[523.3,.4,1.5],[622.3,.22,1.2],[784,.14,1.0],[1046.5,.1,.6]]){
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f * (1 + (Math.random()-.5)*.004);
      g.gain.setValueAtTime(amp*.8, t0);
      g.gain.exponentialRampToValueAtTime(.0004, t0 + dur);
      o.connect(g); g.connect(master);
      o.start(t0); o.stop(t0 + dur + .05);
    }
  }
  const correct  = () => { tone(660,0,.18,'triangle'); tone(880,.12,.25,'triangle'); };
  const wrong    = () => { tone(180,0,.22,'sine',.1); };
  const snapSnd  = () => { tone(520,0,.1,'triangle',.12); tone(780,.06,.12,'triangle',.12); };
  const fanfare  = () => { [523,659,784,1047].forEach((f,i)=>tone(f, i*.13, .3, 'triangle')); };
  function pop(){
    // a soft soap-bubble pop: a quick downward pitch blip
    if (!ctx || muted) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(820 + Math.random()*260, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(180, ctx.currentTime + 0.09);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.13);
    o.connect(g); g.connect(master);
    o.start(); o.stop(ctx.currentTime + 0.15);
  }
  // play a recorded clip as a plain sound effect — no caption, no speaker ring
  function sfx(file){
    if (!ctx || muted || clipsOff) return;
    loadClip('./clips/' + file).then(buf => {
      const src = ctx.createBufferSource(); src.buffer = buf;
      src.connect(master); src.start();
    }).catch(() => {});
  }
  return { unlock, speak, stop, correct, wrong, snapSnd, fanfare, clack, pop, bell, sfx, setVolume, getVolume,
           resolve, history, CLIP_MAP };
})();

/* ════════════════════════════════ 3 · Art (flat SVG, no raster) ═══════════ */

export { Captions, Audio2 };

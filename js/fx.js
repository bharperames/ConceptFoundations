import { C } from './art.js';
import { $ } from './core.js';

const FX = {
  layer: null,
  init(){ this.layer = $('#fx-layer'); },
  burst(x, y, colors){
    const cols = colors || [C.sun, C.coral, C.sea, C.grass, C.grape];
    for (let i=0;i<12;i++){
      const s = document.createElement('span');
      s.className = 'spark';
      const ang = (i/12)*Math.PI*2 + Math.random()*.5;
      const d = 60 + Math.random()*70;
      s.style.left = x+'px'; s.style.top = y+'px';
      s.style.setProperty('--dx', Math.cos(ang)*d+'px');
      s.style.setProperty('--dy', Math.sin(ang)*d+'px');
      const c = cols[i % cols.length];
      s.innerHTML = `<svg viewBox="0 0 20 20"><path d="M10 0 L12.5 7.5 L20 10 L12.5 12.5 L10 20 L7.5 12.5 L0 10 L7.5 7.5 Z" fill="${c}"/></svg>`;
      this.layer.appendChild(s);
      setTimeout(()=>s.remove(), 900);
    }
  },
  confetti(){
    const cols = [C.sun, C.coral, C.sea, C.grass, C.grape, C.tang];
    for (let i=0;i<44;i++){
      const c = document.createElement('span');
      c.className = 'confetto';
      c.style.left = Math.random()*100+'vw';
      c.style.background = cols[i % cols.length];
      c.style.animationDelay = (Math.random()*.7)+'s';
      this.layer.appendChild(c);
      setTimeout(()=>c.remove(), 3400);
    }
  },
  cheer(msg){
    const d = document.createElement('div');
    d.className = 'cheer';
    d.innerHTML = `<div class="big">🎉</div><div class="msg">${msg}</div>`;
    document.body.appendChild(d);
    setTimeout(()=>d.remove(), 2400);
  },
};

/* Full-screen finale: a canvas fireworks particle sim behind a bouncing
   trophy ("You won!" — node complete) or award rosette ("You did it!"). */
const TROPHY = `<svg viewBox="0 0 120 122" width="150" height="152" aria-hidden="true">
  <defs><linearGradient id="cgold" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#FFE79A"/><stop offset=".5" stop-color="#F5B831"/><stop offset="1" stop-color="#D8922A"/></linearGradient></defs>
  <path d="M28 22 Q6 22 10 44 Q13 60 34 58" fill="none" stroke="url(#cgold)" stroke-width="7"/>
  <path d="M92 22 Q114 22 110 44 Q107 60 86 58" fill="none" stroke="url(#cgold)" stroke-width="7"/>
  <path d="M26 16 L94 16 L90 52 Q86 76 60 78 Q34 76 30 52 Z" fill="url(#cgold)"/>
  <ellipse cx="60" cy="16" rx="34" ry="7" fill="#FFEDB6"/>
  <path d="M60 30 l4.7 9.5 10.5 1.5 -7.6 7.4 1.8 10.4 -9.4-4.9 -9.4 4.9 1.8-10.4 -7.6-7.4 10.5-1.5 Z" fill="#FFF6D2"/>
  <rect x="54" y="78" width="12" height="13" fill="url(#cgold)"/>
  <path d="M40 91 L80 91 L86 104 L34 104 Z" fill="url(#cgold)"/>
  <rect x="30" y="104" width="60" height="11" rx="3" fill="url(#cgold)"/></svg>`;
const RIBBON = `<svg viewBox="0 0 120 148" width="150" height="185" aria-hidden="true">
  <path d="M46 90 L38 138 L52 126 L58 140 L64 94 Z" fill="#2E6FCE"/>
  <path d="M74 90 L82 138 L68 126 L62 140 L56 94 Z" fill="#3D8BFF"/>
  <g>${Array.from({length:16},(_,i)=>{const a=i/16*Math.PI*2;return `<circle cx="${(60+Math.cos(a)*33).toFixed(1)}" cy="${(50+Math.sin(a)*33).toFixed(1)}" r="12" fill="${i%2?'#2E6FCE':'#6BA6F5'}"/>`;}).join('')}</g>
  <circle cx="60" cy="50" r="30" fill="#3D8BFF"/><circle cx="60" cy="50" r="24" fill="#EAF3FF"/>
  <path d="M60 34 l4.7 9.5 10.5 1.5 -7.6 7.4 1.8 10.4 -9.4-4.9 -9.4 4.9 1.8-10.4 -7.6-7.4 10.5-1.5 Z" fill="#F5B831"/></svg>`;

const Celebrate = {
  raf: 0, active: false,
  run(kind, msg, extraHTML=''){
    FX.confetti();
    const layer = document.createElement('div');
    layer.className = 'celebrate';
    layer.innerHTML = `<canvas class="cel-canvas"></canvas>
      <div class="cel-center"><div class="cel-badge">${kind==='trophy'?TROPHY:RIBBON}</div>
      <div class="cel-msg">${msg}</div>${extraHTML}</div>`;
    document.body.appendChild(layer);
    const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduce) this.fireworks(layer.querySelector('canvas'));
    setTimeout(() => { this.active = false; cancelAnimationFrame(this.raf); layer.remove(); }, 4700);
  },
  fireworks(canvas){
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = window.innerWidth, H = window.innerHeight;
    canvas.width = W*dpr; canvas.height = H*dpr;
    const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
    const COLORS = ['#FFC02E','#FF5D55','#3D8BFF','#33C06A','#9B6DF2','#FF8A3C','#FFFFFF'];
    const G = 620, shells = [], parts = [];
    const launch = () => shells.push({
      x: W*(0.18 + Math.random()*0.64), y: H+10,
      vx: (Math.random()-0.5)*70, vy: -(Math.sqrt(2*G*(H*(0.34+Math.random()*0.52)))),
      color: COLORS[Math.floor(Math.random()*COLORS.length)] });
    const boom = (x, y, color) => {
      // vary the burst: small crackles up to big, wide, large-particle bursts
      const big = Math.random() < 0.4;
      const n = big ? 90 + (Math.random()*60|0) : 34 + (Math.random()*30|0);
      const spread = (big ? 300 : 180) + Math.random()*120;   // amplitude
      const rmul = big ? 1.7 + Math.random()*0.9 : 0.8 + Math.random()*0.7;  // particle size
      const life = big ? 1.3 : 0.9;
      const two = Math.random() < 0.3 ? COLORS[Math.floor(Math.random()*COLORS.length)] : color;
      for (let i=0;i<n;i++){
        const a = Math.random()*Math.PI*2, sp = 40 + Math.random()*spread;
        parts.push({ x, y, vx: Math.cos(a)*sp, vy: Math.sin(a)*sp,
          life: life + Math.random()*0.8, max: life + 0.8,
          color: Math.random()<0.2 ? '#FFFFFF' : (Math.random()<0.5 ? color : two),
          r: (1.3 + Math.random()*2.0) * rmul });
      }
      if (big){  // a bright core flash for big shells
        for (let i=0;i<10;i++){
          const a = Math.random()*Math.PI*2, sp = Math.random()*70;
          parts.push({ x, y, vx: Math.cos(a)*sp, vy: Math.sin(a)*sp,
            life: 0.35, max: 0.35, color: '#FFFFFF', r: 3 + Math.random()*3 });
        }
      }
    };
    this.active = true;
    let last = performance.now(), sinceLaunch = 0, launched = 0;
    const frame = (t) => {
      if (!this.active) return;
      const dt = Math.min((t-last)/1000, 0.05); last = t;
      sinceLaunch += dt;
      if (launched < 13 && sinceLaunch > 0.34){ sinceLaunch = 0; launch(); launched++; if(launched<3){launch();launched++;} }
      // dark night-sky backdrop + motion trails
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(12,18,32,0.30)'; ctx.fillRect(0,0,W,H);
      ctx.globalCompositeOperation = 'lighter';
      for (let i=shells.length-1;i>=0;i--){
        const sh = shells[i]; sh.vy += G*dt; sh.x += sh.vx*dt; sh.y += sh.vy*dt;
        ctx.globalAlpha = 1; ctx.fillStyle = sh.color;
        ctx.beginPath(); ctx.arc(sh.x, sh.y, 2.2, 0, 7); ctx.fill();
        if (sh.vy >= -30){ boom(sh.x, sh.y, sh.color); shells.splice(i,1); }
      }
      for (let i=parts.length-1;i>=0;i--){
        const q = parts[i]; q.vy += G*0.4*dt; q.vx *= (1-1.1*dt); q.vy *= (1-1.1*dt);
        q.x += q.vx*dt; q.y += q.vy*dt; q.life -= dt;
        if (q.life <= 0){ parts.splice(i,1); continue; }
        ctx.globalAlpha = Math.max(0, q.life/q.max);
        ctx.fillStyle = q.color;
        ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, 7); ctx.fill();
      }
      ctx.globalAlpha = 1;
      this.raf = requestAnimationFrame(frame);
    };
    this.raf = requestAnimationFrame(frame);
  },
};

/* ═══════════════ Bubble Pop — a standalone arcade mini game ═══════════════
   Soap bubbles drift down; tap to pop them (droplet burst + pop sound). If one
   reaches the ground the round ends. Score = bubbles popped. Its own canvas
   loop, independent of the teaching engine. */

export { FX, TROPHY, RIBBON, Celebrate };

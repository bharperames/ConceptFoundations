import { Audio2 } from '../audio.js';
import { $ } from '../core.js';
import { showView } from '../router.js';

const BubbleGame = {
  raf:0, running:false, bubbles:[], pops:[], score:0, elapsed:0, spawnIn:0, last:0,
  canvas:null, ctx:null, W:0, H:0, ground:0,
  HUES:[195, 265, 155, 210, 320, 45],

  start(){
    Audio2.unlock();
    showView('bubbles');
    this.canvas = $('#bub-canvas'); this.ctx = this.canvas.getContext('2d');
    $('#bub-over').classList.add('hidden');
    this.size();
    this.bubbles = []; this.pops = []; this.score = 0; this.elapsed = 0; this.spawnIn = 0.3;
    this.setScore(0);
    this.running = false;
    this.ctx.clearRect(0, 0, this.W, this.H);
    Audio2.speak('Bubble bubble bubble bubble bubble pop');   // clipped intro
    // a "get ready" countdown before bubbles start falling
    this.countdown(() => {
      this.running = true; this.last = performance.now();
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(t => this.loop(t));
    });
  },
  countdown(done){
    const el = $('#bub-countdown');
    const seq = ['Get ready!', '3', '2', '1', 'Go!'];
    let i = 0;
    el.classList.remove('hidden');
    const tick = () => {
      if (i >= seq.length){ el.classList.add('hidden'); done(); return; }
      el.textContent = seq[i];
      el.classList.remove('cd-pop'); void el.offsetWidth; el.classList.add('cd-pop');
      if (i === seq.length - 1) Audio2.correct(); else if (i > 0) Audio2.snapSnd();
      i++;
      this.cdTimer = setTimeout(tick, i === 1 ? 850 : 700);
    };
    tick();
  },
  stop(){
    this.running = false;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.cdTimer);
    $('#bub-countdown').classList.add('hidden');
  },
  size(){
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = window.innerWidth; this.H = window.innerHeight; this.ground = this.H - 6;
    this.canvas.width = this.W*dpr; this.canvas.height = this.H*dpr;
    this.ctx.setTransform(dpr,0,0,dpr,0,0);
  },
  setScore(n){ this.score = n; const el = $('#bub-score'); if (el) el.firstElementChild.textContent = n; },

  spawn(){
    const r = 34 + Math.random()*28;
    this.bubbles.push({
      x: r + Math.random()*(this.W - 2*r), y: -r, r,
      vy: 85 + this.elapsed*9 + Math.random()*55,   // px/s, ramps with time
      wobA: 8 + Math.random()*16, wobF: 0.8 + Math.random()*1.2, phase: Math.random()*7,
      hue: this.HUES[Math.floor(Math.random()*this.HUES.length)], t: 0,
    });
  },
  update(dt){
    this.elapsed += dt;
    this.spawnIn -= dt;
    if (this.spawnIn <= 0){ this.spawn(); this.spawnIn = Math.max(0.5, 1.1 - this.elapsed*0.018 - this.score*0.012); }
    for (let i=this.bubbles.length-1;i>=0;i--){
      const b = this.bubbles[i]; b.t += dt;
      b.y += b.vy*dt;
      b.x += Math.sin(b.t*b.wobF + b.phase) * b.wobA * dt;
      if (b.y + b.r >= this.ground){ this.gameOver(); return; }
    }
    for (let i=this.pops.length-1;i>=0;i--){
      const q = this.pops[i]; q.life -= dt;
      if (q.life <= 0){ this.pops.splice(i,1); continue; }
      if (q.drop){ q.vy += 900*dt; q.x += q.vx*dt; q.y += q.vy*dt; }
      else q.rr += q.vr*dt;   // ring
    }
  },
  hit(px, py){
    for (let i=this.bubbles.length-1;i>=0;i--){   // topmost first
      const b = this.bubbles[i];
      if ((px-b.x)**2 + (py-b.y)**2 <= (b.r+6)**2){ this.pop(i); return; }
    }
  },
  pop(i){
    const b = this.bubbles.splice(i,1)[0];
    Audio2.pop();
    this.setScore(this.score + 1);
    // expanding ring
    this.pops.push({ x:b.x, y:b.y, rr:b.r*0.7, vr:b.r*7, life:0.32, max:0.32, hue:b.hue, ring:true });
    // droplet spray
    const n = 8 + (Math.random()*5|0);
    for (let k=0;k<n;k++){
      const a = Math.random()*Math.PI*2, sp = 60 + Math.random()*160;
      this.pops.push({ x:b.x, y:b.y, vx:Math.cos(a)*sp, vy:Math.sin(a)*sp - 40,
        r: 2 + Math.random()*4, life:0.5+Math.random()*0.3, max:0.8, hue:b.hue, drop:true });
    }
  },
  drawBubble(ctx, b){
    const {x,y,r,hue} = b;
    // translucent iridescent body
    const g = ctx.createRadialGradient(x-r*0.25, y-r*0.25, r*0.1, x, y, r);
    g.addColorStop(0,   'rgba(255,255,255,0.05)');
    g.addColorStop(0.68,`hsla(${hue},80%,78%,0.10)`);
    g.addColorStop(0.88,`hsla(${hue},85%,68%,0.34)`);
    g.addColorStop(1,   `hsla(${hue},90%,72%,0.7)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x,y,r,0,7); ctx.fill();
    // iridescent rim
    ctx.lineWidth = 2; ctx.strokeStyle = `hsla(${(hue+45)%360},90%,72%,0.75)`; ctx.stroke();
    // faint refraction arc lower-right
    ctx.lineWidth = 3; ctx.strokeStyle = `hsla(${(hue+180)%360},80%,88%,0.18)`;
    ctx.beginPath(); ctx.arc(x,y,r*0.82, 0.15*Math.PI, 0.75*Math.PI); ctx.stroke();
    // big soft specular highlight
    const hl = ctx.createRadialGradient(x-r*0.34,y-r*0.4,0, x-r*0.34,y-r*0.4, r*0.55);
    hl.addColorStop(0,'rgba(255,255,255,0.85)'); hl.addColorStop(1,'rgba(255,255,255,0)');
    ctx.fillStyle = hl; ctx.beginPath(); ctx.arc(x-r*0.34,y-r*0.4,r*0.55,0,7); ctx.fill();
    // sharp glint
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath(); ctx.arc(x-r*0.12,y-r*0.55,r*0.08,0,7); ctx.fill();
  },
  render(){
    const ctx = this.ctx; ctx.clearRect(0,0,this.W,this.H);
    for (const b of this.bubbles) this.drawBubble(ctx, b);
    for (const q of this.pops){
      const a = Math.max(0, q.life/q.max);
      if (q.ring){
        ctx.globalAlpha = a*0.7; ctx.lineWidth = 3;
        ctx.strokeStyle = `hsla(${q.hue},85%,80%,1)`;
        ctx.beginPath(); ctx.arc(q.x,q.y,q.rr,0,7); ctx.stroke();
      } else {
        ctx.globalAlpha = a; ctx.fillStyle = `hsla(${q.hue},85%,85%,0.9)`;
        ctx.beginPath(); ctx.arc(q.x,q.y,q.r,0,7); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  },
  loop(t){
    if (!this.running) return;
    const dt = Math.min((t-this.last)/1000, 0.05); this.last = t;
    this.update(dt);
    if (!this.running) return;   // gameOver may have fired
    this.render();
    this.raf = requestAnimationFrame(tt => this.loop(tt));
  },
  gameOver(){
    this.stop();
    $('#bub-final').textContent = this.score;
    $('#bub-over').classList.remove('hidden');
    Audio2.speak(this.score > 0 ? 'Great job!' : 'Uh oh');
  },
};

/* ═══════════════ Picture Puzzle — rotating triangular-prism tiles ═══════════
   Nine tiles in a 3x3 frame; each tile is a triangular prism whose three square
   faces show the same cell from three different complete scenes. Tapping a tile
   tumbles it 120° to the next face. Match all nine to one scene to build the
   picture. */

export { BubbleGame };

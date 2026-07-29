// PlanetGL — "the real thing": a WebGL fragment shader ray-traces a sphere and
// samples a procedurally generated EQUIRECTANGULAR texture, so planet balls get
// true spherical mapping: features wrap around the limb, foreshorten near the
// edge, and the lighting (Lambert + limb darkening + a whisper of specular)
// lives in the shader, fixed in screen space while the surface spins.
//
// The physics body's angle drives LONGITUDE: a rolling ball's surface flows
// around the sphere. (In a 2D world the physically exact spin axis is the
// screen normal — a coin. Mapping spin to longitude trades that pedantry for
// an actual rotating planet, which is the point.)
//
// Textures are generated at runtime into canvases (value-noise fBm, seeded,
// x-tileable so longitude 0/360 seams vanish) — the app ships no image assets.
// One shared offscreen GL context renders every ball; each ball owns only a
// small 2D canvas that receives drawImage blits. Browsers cap live WebGL
// contexts (~8-16); with no block cap, per-ball contexts would die.

const TEX_W = 512, TEX_H = 256;
const NAMES = ['mercury','venus','earth','mars','jupiter','saturn','uranus','neptune'];
// axis tilt in screen radians (aesthetic; uranus famously sideways)
const TILT = { mercury:.03, venus:.05, earth:.2, mars:.22, jupiter:.06, saturn:-.33, uranus:1.42, neptune:.25 };

/* ── seeded value-noise fBm, tileable in x (longitude) ── */
function makeNoise(seed){
  const P = 256, lat = new Float32Array(P*P);
  let s = seed|0 || 1;
  const rnd = () => (s = (s*1664525 + 1013904223)|0, ((s>>>9)/8388608) % 1);
  for (let i = 0; i < P*P; i++) lat[i] = rnd();
  const sm = t => t*t*(3-2*t);
  // sample with x wrapped at `period` lattice cells → seamless longitude
  return function noise(x, y, period){
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x-xi, yf = y-yi, u = sm(xf), v = sm(yf);
    const X0 = ((xi % period)+period)%period, X1 = ((xi+1) % period+period)%period;
    const Y0 = yi & (P-1), Y1 = (yi+1) & (P-1);
    const a = lat[Y0*P + X0], b = lat[Y0*P + X1], c = lat[Y1*P + X0], d = lat[Y1*P + X1];
    return a + (b-a)*u + (c-a)*v + (a-b-c+d)*u*v;
  };
}
function fbmFn(noise){
  return function fbm(x, y, oct, basePeriod){
    let a = 0, amp = .5, f = 1;
    for (let o = 0; o < oct; o++){
      a += amp * noise(x*f, y*f, basePeriod*f);
      amp *= .5; f *= 2;
    }
    return a;   // ~0..1
  };
}
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const mix = (a, b, t) => a + (b-a)*t;
const hex = h => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
function ramp(stops){       // [[t,'#hex'],...] → t→rgb
  const S = stops.map(([t,c]) => [t, hex(c)]);
  return t => {
    t = clamp01(t);
    for (let i = 1; i < S.length; i++) if (t <= S[i][0]){
      const [t0,c0] = S[i-1], [t1,c1] = S[i], k = (t-t0)/((t1-t0)||1);
      return [mix(c0[0],c1[0],k), mix(c0[1],c1[1],k), mix(c0[2],c1[2],k)];
    }
    return S[S.length-1][1];
  };
}

/* ── per-planet equirect painters: (lon 0..1, lat 0..1 pole→pole) → [r,g,b] ── */
function makePainter(name){
  const noise = makeNoise(name.length*7919 + name.charCodeAt(0)*131);
  const fbm = fbmFn(noise);
  const PER = 8;                          // lattice cells across the seamless x span
  const craters = [];
  if (name === 'mercury' || name === 'mars'){
    const n2 = makeNoise(999);
    let s = 4242; const rnd = () => (s = (s*1664525+1013904223)|0, ((s>>>9)/8388608)%1);
    const count = name === 'mercury' ? 90 : 22;
    for (let i = 0; i < count; i++) craters.push([rnd(), .12+rnd()*.76, (.004+rnd()*rnd()*.05)]);
  }
  const craterAt = (x, y) => {            // returns [depthShade, rimLight]
    let dsh = 0, rim = 0;
    for (const [cx, cy, cr] of craters){
      let dx = Math.abs(x-cx); if (dx > .5) dx = 1-dx;   // wrap
      dx *= 2;                                            // aspect (2:1 map)
      const dd = Math.sqrt(dx*dx + (y-cy)*(y-cy));
      if (dd < cr){ dsh = Math.max(dsh, .5*(1 - dd/cr)); }
      else if (dd < cr*1.25){ rim = Math.max(rim, .5*(1 - (dd-cr)/(cr*.25))); }
    }
    return [dsh, rim];
  };
  const G = {
    mercury(x, y){
      const m = fbm(x*PER, y*PER*0.5 + 3, 5, PER);
      let v = .42 + (m-.5)*.5;
      const big = fbm(x*PER*.4+9, y*PER*.25, 2, Math.ceil(PER*.4));
      v += (big-.5)*.24;
      const [dsh, rim] = craterAt(x, y);
      v = v*(1-dsh*.85) + rim*.22;
      const g = clamp01(v)*175 + 45;
      return [g, g*.965, g*.92];
    },
    venus(x, y){
      const warp = (fbm(x*PER+5, y*PER*.7, 3, PER)-.5)*.34;
      const t = Math.sin((y + warp)*Math.PI*7 + 1.2)*.5+.5;
      const w = fbm(x*PER*1.6, y*PER+11, 4, Math.ceil(PER*1.6));
      const R = ramp([[0,'#b98a4c'],[.4,'#d9b87e'],[.7,'#efd9a8'],[1,'#f7ecd0']]);
      return R(clamp01(t*.6 + w*.55 - .12));
    },
    earth(x, y){
      const lat = Math.abs(y-.5)*2;
      const cont = fbm(x*PER*.9+2, y*PER*.45+7, 5, Math.ceil(PER*.9));
      const land = cont > .52;
      let r, g, b;
      if (lat > .88 || (land && lat > .8)){ r=238; g=244; b=248; }          // ice
      else if (land){
        const veg = fbm(x*PER*2+8, y*PER+3, 4, PER*2);
        const R = ramp([[0,'#2f6d33'],[.45,'#4d9a50'],[.7,'#9aa04e'],[1,'#c2a768']]);
        [r,g,b] = R(clamp01(veg*.9 + lat*.35 - .18));
        const coast = cont - .52;
        if (coast < .02){ r=mix(200,r,coast/.02); g=mix(190,g,coast/.02); b=mix(150,b,coast/.02); }
      } else {
        const depth = fbm(x*PER*1.3+4, y*PER*.6+1, 4, Math.ceil(PER*1.3));
        const R = ramp([[0,'#173f7c'],[.5,'#2461ad'],[.8,'#2f77c8'],[1,'#3f8ed8']]);
        [r,g,b] = R(clamp01((cont-.1)*1.1 + depth*.3));
      }
      const cl = fbm(x*PER*1.7+13, y*PER*.8+21, 5, Math.ceil(PER*1.7));
      const cloud = clamp01((cl-.56)*4.5) * (1 - clamp01((lat-.9)*8));
      return [mix(r,252,cloud), mix(g,253,cloud), mix(b,255,cloud)];
    },
    mars(x, y){
      const lat = Math.abs(y-.5)*2;
      const m = fbm(x*PER+1, y*PER*.5+6, 5, PER);
      const dark = clamp01((fbm(x*PER*.5+17, y*PER*.3+2, 3, Math.ceil(PER*.5)) - .55)*3);
      const R = ramp([[0,'#5f2a12'],[.35,'#98411f'],[.6,'#bd5527'],[.85,'#d06a35'],[1,'#dd8a55']]);
      let [r,g,b] = R(clamp01(.35 + (m-.5)*.9 - dark*.4));
      const [dsh, rim] = craterAt(x, y);
      r = r*(1-dsh*.5)+rim*30; g = g*(1-dsh*.5)+rim*26; b = b*(1-dsh*.5)+rim*22;
      const cap = clamp01((lat-.82)*10) * clamp01((m-.2)*3);
      return [mix(r,246,cap), mix(g,242,cap), mix(b,236,cap)];
    },
    jupiter(x, y){
      const warp = (fbm(x*PER*1.2+3, y*PER*1.4, 4, Math.ceil(PER*1.2))-.5)*.11
                 + (fbm(x*PER*3+8, y*PER*3, 3, PER*3)-.5)*.03;
      const yy = y + warp;
      const R = ramp([[0,'#c8a97e'],[.12,'#ecdebc'],[.2,'#a06a48'],[.28,'#f0e4c8'],[.37,'#b3805a'],
        [.45,'#e8d8b4'],[.53,'#c09068'],[.6,'#eee0c0'],[.68,'#a87454'],[.76,'#e4d4b0'],[.85,'#c8a97e'],[1,'#ecdfc2']]);
      let [r,g,b] = R(((yy % 1)+1)%1);
      // Great Red Spot at (lon .68, lat .63)
      let dx = Math.abs(x-.68); if (dx > .5) dx = 1-dx;
      const ds = Math.sqrt((dx*2.2)*(dx*2.2) + ((y-.63)*3.4)*((y-.63)*3.4));
      if (ds < .18){
        const k = 1 - ds/.18;
        const swirl = .5 + .5*Math.sin(ds*40 - 2);
        r = mix(r, mix(184, 232, swirl*k*.4), clamp01(k*1.6));
        g = mix(g, mix(68, 118, swirl*k*.4), clamp01(k*1.6));
        b = mix(b, mix(46, 88, swirl*k*.4), clamp01(k*1.6));
      }
      return [r,g,b];
    },
    saturn(x, y){
      const warp = (fbm(x*PER+6, y*PER*1.2, 3, PER)-.5)*.07;
      const yy = y + warp;
      const R = ramp([[0,'#cbb384'],[.15,'#ecdfc0'],[.3,'#c2a276'],[.45,'#eadcb8'],[.55,'#bfa070'],
        [.7,'#e8dab6'],[.82,'#c8ab7c'],[1,'#e6d8b4']]);
      const [r,g,b] = R(((yy % 1)+1)%1);
      const soft = fbm(x*PER*2+9, y*PER+14, 3, PER*2);
      return [mix(r,r*soft*2,.06), mix(g,g*soft*2,.06), mix(b,b*soft*2,.06)];
    },
    uranus(x, y){
      const m = fbm(x*PER*.8+2, y*PER*.5+5, 3, Math.ceil(PER*.8));
      const bandT = Math.sin(y*Math.PI*5+.6)*.5+.5;
      const R = ramp([[0,'#84c2ca'],[.5,'#a3dade'],[1,'#c4ecef']]);
      return R(clamp01(.35 + bandT*.25 + (m-.5)*.3));
    },
    neptune(x, y){
      const m = fbm(x*PER+4, y*PER*.7+9, 4, PER);
      const bandT = Math.sin(y*Math.PI*6 + m*1.5)*.5+.5;
      const R = ramp([[0,'#16307e'],[.4,'#2349a8'],[.7,'#2e5ac4'],[1,'#4a7ad8']]);
      let [r,g,b] = R(clamp01(.25 + bandT*.3 + (m-.5)*.5));
      let dx = Math.abs(x-.3); if (dx > .5) dx = 1-dx;
      const ds = Math.sqrt((dx*2.4)*(dx*2.4) + ((y-.42)*3.6)*((y-.42)*3.6));
      if (ds < .13){ const k = 1-ds/.13; r = mix(r,16,k*.8); g = mix(g,32,k*.8); b = mix(b,86,k*.8); }
      const streak = clamp01((fbm(x*PER*2.4+21, y*PER*1.4+8, 3, Math.ceil(PER*2.4)) - .62)*6)
        * clamp01(1 - Math.abs(y-.36)*6);
      return [mix(r,235,streak), mix(g,242,streak), mix(b,255,streak)];
    },
  };
  return G[name];
}

function genTexture(gl, name){
  const cv = document.createElement('canvas');
  cv.width = TEX_W; cv.height = TEX_H;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(TEX_W, TEX_H);
  const paint = makePainter(name), data = img.data;
  for (let py = 0; py < TEX_H; py++){
    const y = (py + .5)/TEX_H;
    for (let px = 0; px < TEX_W; px++){
      const [r, g, b] = paint((px + .5)/TEX_W, y);
      const i = (py*TEX_W + px)*4;
      data[i] = r; data[i+1] = g; data[i+2] = b; data[i+3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);      // longitude wraps
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

const VS = `attribute vec2 aP; varying vec2 vP;
void main(){ vP = aP; gl_Position = vec4(aP, 0., 1.); }`;
const FS = `precision mediump float;
varying vec2 vP; uniform sampler2D uTex; uniform float uSpin, uTilt;
void main(){
  float rr = dot(vP, vP);
  if (rr > 1.0) discard;
  // sphere surface point facing the camera
  vec3 N = vec3(vP.x, vP.y, sqrt(max(0., 1. - rr)));
  // tilt the spin axis in the screen plane
  float ct = cos(uTilt), st = sin(uTilt);
  vec3 M = vec3(ct*N.x + st*N.y, -st*N.x + ct*N.y, N.z);
  // latitude / longitude, spin advances longitude
  float lat = asin(clamp(M.y, -1., 1.));
  float lon = atan(M.x, M.z) + uSpin;
  vec3 col = texture2D(uTex, vec2(lon/6.2831853 + .5, lat/3.1415926 + .5)).rgb;
  // lighting fixed in SCREEN space: sun upper-left, in front
  vec3 L = normalize(vec3(-.45, -.52, .73));
  float diff = clamp(dot(N, L), 0., 1.);
  col *= .34 + .78*diff;
  col += vec3(1.) * pow(clamp(dot(reflect(-L, N), vec3(0.,0.,1.)), 0., 1.), 30.) * .12;
  col *= mix(1., .55, smoothstep(.62, 1., rr));            // limb darkening
  float aa = 1. - smoothstep(.962, 1., rr);                // anti-aliased rim
  gl_FragColor = vec4(col*aa, aa);
}`;

const PlanetGL = {
  gl: null, cv: null, prog: null, texes: {}, failed: false, SIZE: 288,
  ok(){
    if (this.failed) return false;
    if (this.gl) return true;
    try {
      const cv = document.createElement('canvas');
      cv.width = cv.height = this.SIZE;
      const gl = cv.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false });
      if (!gl) throw 0;
      const mk = (t, src) => { const sh = gl.createShader(t); gl.shaderSource(sh, src); gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw gl.getShaderInfoLog(sh); return sh; };
      const prog = gl.createProgram();
      gl.attachShader(prog, mk(gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw gl.getProgramInfoLog(prog);
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
      const aP = gl.getAttribLocation(prog, 'aP');
      gl.enableVertexAttribArray(aP);
      gl.vertexAttribPointer(aP, 2, gl.FLOAT, false, 0, 0);
      this.uSpin = gl.getUniformLocation(prog, 'uSpin');
      this.uTilt = gl.getUniformLocation(prog, 'uTilt');
      this.gl = gl; this.cv = cv; this.prog = prog;
      return true;
    } catch (e){ this.failed = true; return false; }
  },
  // render planet `name` at spin (rad) into the ball's own 2D canvas
  draw(name, spin, outCv, outCtx){
    const gl = this.gl;
    if (!this.texes[name]) this.texes[name] = genTexture(gl, name);
    gl.bindTexture(gl.TEXTURE_2D, this.texes[name]);
    gl.uniform1f(this.uSpin, spin);
    gl.uniform1f(this.uTilt, TILT[name] || 0);
    gl.viewport(0, 0, this.SIZE, this.SIZE);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    outCtx.clearRect(0, 0, outCv.width, outCv.height);
    outCtx.drawImage(this.cv, 0, 0, this.SIZE, this.SIZE, 0, 0, outCv.width, outCv.height);
  },
};

// ring overlays, z-buffered the DOM way: each ring ellipse is split along its
// major axis into a FAR arc and a NEAR arc, and the planet canvas is
// sandwiched between them (back svg -> WebGL globe -> front svg), so the far
// side genuinely passes behind the planet. The split line crosses the rings
// exactly at the limb, and the two halves are the same ellipse, so the joint
// is seamless in the open-space wings. Rings hold still while the globe
// spins beneath them — correct, since the element itself never rotates.
const RINGS = {
  saturn: { rot: -19, rings: [
    [.85, .24, '#cdb684', .075, .55],
    [.74, .2,  '#e5d4a8', .05,  .95],
    [.63, .165,'#b59a6b', .035, .85],
    [.56, .145,'#8f7a55', .014, .6],
  ]},
  uranus: { rot: 74, rings: [
    [.72, .16, '#dff2f4', .02, .5],
  ]},
};
function ringOverlay(name, d, half){
  const cfg = RINGS[name];
  if (!cfg) return '';
  const n = x => (+x).toFixed(1), r = d/2, C = v => n(v*d);
  const uid = 'rg' + name + half + Math.floor(Math.random()*1e6);
  // in ring-local coords the far arc is above the major axis (y < r)
  const clip = half === 'back'
    ? `<rect x="${n(-d)}" y="${n(-d)}" width="${n(3*d)}" height="${n(d + r)}"/>`
    : `<rect x="${n(-d)}" y="${n(r)}" width="${n(3*d)}" height="${n(2*d)}"/>`;
  const ell = cfg.rings.map(([rx, ry, col, wsc, op]) =>
    `<ellipse cx="${n(r)}" cy="${n(r)}" rx="${C(rx)}" ry="${C(ry)}" stroke="${col}" stroke-width="${C(wsc)}" opacity="${op}"/>`).join('');
  return `<svg viewBox="0 0 ${d} ${d}" style="position:absolute;inset:0;overflow:visible" aria-hidden="true">
    <defs><clipPath id="${uid}">${clip}</clipPath></defs>
    <g transform="rotate(${cfg.rot} ${n(r)} ${n(r)})"><g clip-path="url(#${uid})" fill="none">${ell}</g></g></svg>`;
}

export { PlanetGL, ringOverlay, NAMES as PLANET_NAMES };

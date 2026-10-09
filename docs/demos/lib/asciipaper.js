// asciipaper runtime: frame pacing, pointer input, host settings and a GPU ASCII renderer.
// The asciipaper host (and Lively export) injects this file before the page runs, with the user's
// settings in window.__asciipaperOptions. Pages include it too so they also work in a plain browser;
// the second load is a no-op. Docs: ../../README.md#write-your-own
(() => {
  if (window.asciipaper?.ascii) return;
  const here = document.currentScript?.src || location.href;   // lib/ (for media.glsl)

  const options = Object.assign({fps: 24, idleFps: 12, quality: 1, pointer: 1, speed: 1, clicks: false, paused: false},
                                window.__asciipaperOptions);
  const pointer = {x: .5, y: .5, vx: 0, vy: 0, down: false, inside: false, moved: -1e9, clicks: []};

  // ---- Frame pacing. Pages keep calling requestAnimationFrame as usual; callbacks run at `fps`
  // while the pointer is active, `idleFps` otherwise, and not at all while paused. When idle we wait
  // on a timer (instead of skipping vsyncs), so a 120 Hz monitor costs no more than a 60 Hz one.
  const nativeRaf = window.requestAnimationFrame.bind(window);
  const nativeCancel = window.cancelAnimationFrame.bind(window);
  const callbacks = new Map();
  let nextId = 1, timer = 0, pending = 0, last = 0;
  const active = () => performance.now() - pointer.moved < 2000;
  const rate = () => active() ? options.fps : options.idleFps;
  function flush(now) {
    pending = 0;
    if (document.hidden || options.paused) return;
    last = now;
    const run = [...callbacks.values()]; callbacks.clear();
    for (const callback of run) try { callback(now); } catch (error) { reportError(error); }
  }
  // WebKit dispatches pointer events only at rendering updates, so while the pointer is active we
  // tick every vsync (callbacks still run at `fps`); on the timer alone most pointermoves are dropped.
  function tick(now) {
    pending = 0;
    if (now - last >= 1000 / rate() - 2) flush(now); else schedule();
  }
  function schedule() {
    if (timer || pending || document.hidden || options.paused || !callbacks.size) return;
    if (active()) { pending = nativeRaf(tick); return; }
    const wait = last + 1000 / rate() - performance.now();
    const go = () => { timer = 0; pending = nativeRaf(flush); };
    if (wait > 0) timer = setTimeout(go, wait); else go();
  }
  function reschedule() {
    clearTimeout(timer); timer = 0;
    if (pending) nativeCancel(pending); pending = 0;
    const el = document.getElementById('asciipaper-media');
    if (el?.pause) {
      if (document.hidden || options.paused) el.pause(); else el.play().catch(() => {});
    }
    schedule();
  }
  addEventListener('visibilitychange', reschedule);
  window.requestAnimationFrame = callback => { const id = nextId++; callbacks.set(id, callback); schedule(); return id; };
  window.cancelAnimationFrame = id => { callbacks.delete(id); };

  // ---- Pointer state, for shaders and scripts. Coordinates are 0..1 from the top left.
  addEventListener('pointermove', e => {
    const now = performance.now(), dt = Math.max(.001, (now - pointer.moved) / 1000);
    const x = e.clientX / innerWidth, y = e.clientY / innerHeight;
    if (dt < .25) { pointer.vx += ((x - pointer.x) / dt - pointer.vx) * .5; pointer.vy += ((y - pointer.y) / dt - pointer.vy) * .5; }
    const wasIdle = now - pointer.moved >= 2000;
    Object.assign(pointer, {x, y, inside: true, moved: now});
    if (wasIdle) reschedule();                          // wake from idle rate right away
  }, {capture: true, passive: true});
  addEventListener('pointerdown', e => {
    pointer.down = true;
    pointer.clicks.unshift({x: e.clientX / innerWidth, y: e.clientY / innerHeight, time: performance.now()});
    pointer.clicks.length = Math.min(pointer.clicks.length, 8);
  }, {capture: true, passive: true});
  addEventListener('pointerup', () => { pointer.down = false; }, {capture: true, passive: true});
  addEventListener('pointerout', e => {
    if (!e.relatedTarget) { pointer.inside = pointer.down = false; pointer.vx = pointer.vy = 0; }
  }, {capture: true, passive: true});

  // ---- Host settings. `quality` scales devicePixelRatio, so canvases that follow it render fewer pixels.
  const dprDescriptor = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
  const realDpr = () => dprDescriptor?.get ? dprDescriptor.get.call(window) : dprDescriptor?.value || 1;
  let configuredDpr = null;
  function set(next) {
    Object.assign(options, next);
    options.fps = Math.max(1, Math.min(60, Number(options.fps) || 24));
    options.idleFps = Math.max(1, Math.min(options.fps, Number(options.idleFps) || options.fps));
    options.quality = Math.max(.5, Math.min(2, Number(options.quality) || 1));
    options.pointer = Math.max(0, Math.min(2, Number(options.pointer) || 0));
    options.speed = Math.max(.1, Math.min(2, Number(options.speed) || 1));   // calm < 1 < lively
    options.paused = !!options.paused;
    options.clicks = !!options.clicks;   // click effects (ripples) are opt-in
    const dpr = realDpr() * options.quality;
    if (dpr !== configuredDpr) {
      configuredDpr = dpr;
      try { Object.defineProperty(window, 'devicePixelRatio', {configurable: true, get: () => configuredDpr}); } catch (_) {}
      dispatchEvent(new Event('resize'));
    }
    reschedule();
    dispatchEvent(new CustomEvent('asciipaper-settings', {detail: {...options}}));
  }

  // ---- ascii(config): a two pass WebGL renderer. Pass 1 runs your `cell()` GLSL once per character
  // cell into a cols x rows texture; pass 2 draws each cell's glyph from an atlas. Per frame the CPU only
  // sets uniforms, so a full screen of characters costs about as much as one quad.
  const HEADER = `precision highp float;
varying vec2 v_uv;
uniform float u_time, u_aspect, u_down, u_strength, u_idle;
uniform vec2 u_grid, u_size, u_pointer, u_velocity;
uniform vec3 u_clicks[8];
uniform sampler2D u_data;
`;
  const QUAD = 'attribute vec2 p;varying vec2 v_uv;void main(){v_uv=p;gl_Position=vec4(p*2.0-1.0,0,1);}';
  // Pass 1 also applies the look's `dither` (an ordered pattern over the cells) and `palette` (nearest colour).
  const CELL_MAIN = `
uniform sampler2D u_lut;uniform float u_glyphs,u_useLut,u_dither,u_paletteSize,u_interact,u_interactStrength,u_interactRadius;uniform vec3 u_palette[16];
float ap_reach;
vec2 ap_interact(vec2 uv){ap_reach=0.0;if(u_interact<0.5)return uv;
vec2 k=vec2(u_aspect,1.0),q=(uv-u_pointer)*k,dir=q/max(length(q),1e-4)/k;float d=length(q),r=max(u_interactRadius,0.02);
float on=u_strength*u_interactStrength*clamp(1.5-u_idle*0.5,0.0,1.0);ap_reach=on*smoothstep(r,0.0,d);
if(u_interact<1.5)return uv;if(u_interact<2.5)return u_pointer+(uv-u_pointer)*(1.0-0.5*ap_reach);
if(u_interact<3.5)return uv-dir*ap_reach*r*0.35;if(u_interact<4.5)return uv+dir*ap_reach*r*0.35;
if(u_interact<5.5){float t=ap_reach*2.5;return u_pointer+mat2(cos(t),sin(t),-sin(t),cos(t))*q/k;}
return uv+dir*sin(d*60.0-u_time*6.0)*0.012*on*smoothstep(r*2.0,0.0,d);}
float ap_b2(vec2 a){a=floor(a);return fract(a.x*0.5+a.y*a.y*0.75);}
float ap_b4(vec2 a){return ap_b2(0.5*a)*0.25+ap_b2(a);}
float ap_b8(vec2 a){return ap_b4(0.5*a)*0.25+ap_b2(a);}
float ap_dither(vec2 a){float m=u_dither;
if(m<1.5)return ap_b2(a);if(m<2.5)return ap_b4(a);if(m<3.5)return ap_b8(a);if(m<4.5)return ap_b8(0.5*a)*0.25+ap_b2(a);
if(m<5.5)return clamp(length(fract(a/4.0)-0.5)*1.41,0.0,1.0);if(m<6.5)return fract(length(a-u_grid*0.5)/4.0);
if(m<7.5)return fract(a.y/4.0);if(m<8.5)return fract(a.x/4.0);if(m<9.5)return fract((a.x+a.y)/4.0);
if(m<10.5)return fract(sin(dot(floor(a),vec2(12.9898,78.233)))*43758.5453);
return fract(52.9829189*fract(dot(floor(a),vec2(0.06711056,0.00583715))));}
void main(){vec4 c=cell(ap_interact(vec2(v_uv.x,1.0-v_uv.y)));float l=clamp(c.a,0.0,1.0);vec3 rgb=clamp(c.rgb,0.0,1.0);
if(u_interact>0.5&&u_interact<1.5){l=clamp(l+ap_reach*0.45,0.0,1.0);rgb=clamp(rgb+ap_reach*0.25,0.0,1.0);}
if(u_dither>0.5){float t=ap_dither(gl_FragCoord.xy)-0.5;if(l>0.0)l=clamp(l+t/max(u_glyphs-1.0,1.0),0.0,1.0);
if(u_paletteSize>0.5)rgb=clamp(rgb+t*pow(max(u_paletteSize-1.0,1.0),-0.333),0.0,1.0);}
if(u_paletteSize>0.5){vec3 best=u_palette[0];float bd=1e9;for(int i=0;i<16;i++){if(float(i)>=u_paletteSize)break;
vec3 e=rgb-u_palette[i];float d=dot(e*e,vec3(0.3,0.59,0.11));if(d<bd){bd=d;best=u_palette[i];}}rgb=best;}
float g=u_useLut>0.5?texture2D(u_lut,vec2((floor(l*255.0+0.5)+0.5)/256.0,0.5)).a*255.0:floor(l*(u_glyphs-1.0)+0.5);
gl_FragColor=vec4(g/255.0,rgb);}`;
  // Pass 2: `fill` (0..1) lays each glyph's colour faintly behind it, scaled by its density, so pictures read
  // through the gaps; `shape` draws pixels, tiles, dots, LEGO… instead of glyphs; fxA/B/C are the post effects.
  const GLYPHS = `precision highp float;varying vec2 v_uv;uniform sampler2D cells,atlas;uniform vec2 grid,cell,atlasSize;uniform float tile,pad,fill,glyphs,shape,time;uniform vec3 bg;uniform vec4 fxA,fxB,fxC;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
vec4 at(vec2 p){return texture2D(cells,(floor(p*grid)+0.5)/grid);}
float inside(float d){return clamp(0.5-d,0.0,1.0);}
float box(vec2 q,vec2 h){vec2 d=abs(q)-h;return length(max(d,0.0))+min(max(d.x,d.y),0.0);}
vec3 cmyk(vec2 px){vec3 col=bg;vec4 ang=vec4(0.26,1.31,0.0,0.79);float s=min(cell.x,cell.y)*0.9;
for(int k=0;k<4;k++){float a=ang[k];mat2 r=mat2(cos(a),-sin(a),sin(a),cos(a));vec2 q=r*px,c=(floor(q/s)+0.5)*s;
vec3 rgb=at((c*r)/(grid*cell)).gba;float K=1.0-max(max(rgb.r,rgb.g),rgb.b);vec4 ink=vec4((1.0-rgb-K)/max(1.0-K,0.001),K);
float dot_=inside(length(q-c)-s*0.55*sqrt(ink[k]));
vec3 tone=k==0?vec3(0.0,0.68,0.94):k==1?vec3(0.93,0.0,0.55):k==2?vec3(1.0,0.95,0.0):vec3(0.1);col*=mix(vec3(1.0),tone,dot_);}
return col;}
vec3 draw(vec2 p){vec4 d=at(p);vec2 l=fract(vec2(p.x,1.0-p.y)*grid);float g=floor(d.r*255.0+0.5),v=g/max(glyphs-1.0,1.0),s=floor(shape+0.5);
vec3 under=bg+d.gba*fill*v,c=d.gba;
if(s<0.5){float cols=floor(atlasSize.x/tile);vec2 uv=(vec2(mod(g,cols)*tile,floor(g/cols)*(ceil(cell.y)+pad*2.0))+pad+l*cell)/atlasSize;return mix(under,c,texture2D(atlas,uv).a);}
if(s>11.5)return cmyk(p*grid*cell);
vec2 q=(l-0.5)*cell;float r=min(cell.x,cell.y)*0.5,gap=max(1.0,r*0.12),k=0.0;
if(g<0.5&&s!=4.0)return under;
if(s<1.5)return c;
if(s<2.5||s>10.5){k=inside(box(q,cell*0.5-gap));
if(s>10.5){vec2 id=floor(p*grid);c+=pow(max(0.0,sin(time*2.0+hash(id)*6.283)),24.0)*inside(length(q+r*0.35)-r*0.25)*0.9;}}
else if(s<3.5)k=inside(length(q)-r*1.15*sqrt(v));
else if(s<4.5){k=inside(length(q)-r*0.78);c=max(c*(0.12+0.88*v),vec3(0.05));}
else if(s<5.5){k=inside(box(q,cell*0.5-gap*0.6));float st=length(q)-r*0.5;
c*=(1.0-0.35*inside(abs(st)-gap*0.5))*(1.0+0.3*inside(st)*clamp(-(q.x+q.y)/r,0.0,1.0));}
else if(s<6.5){float a=r*v*1.1,t=max(1.0,r*0.28);k=inside(min(box(q,vec2(a,t)),box(q,vec2(t,a))));}
else if(s<7.5)k=inside((abs(q.x)+abs(q.y)-r*1.3*v)*0.707);
else if(s<8.5)k=inside(abs(q.x)-cell.x*0.5*v);
else if(s<9.5)k=inside(abs(q.x+q.y)*0.707-r*0.75*v);
else{float h=r*(0.35+0.6*v);k=inside(box(q,vec2(h)));c*=q.y<-h*0.35?1.25:q.x>h*0.35?0.62:1.0;}
return mix(under,c,k);}
void main(){vec2 p=v_uv;
if(fxA.z>0.0){vec2 o=p-0.5;p=0.5+o*(1.0+fxA.z*0.35*dot(o,o)*4.0);if(p.x<0.0||p.x>1.0||p.y<0.0||p.y>1.0){gl_FragColor=vec4(0.0,0.0,0.0,1.0);return;}}
if(fxB.y>0.0){float t=floor(time*9.0),band=floor(p.y*18.0+hash(vec2(t,3.0))*6.0);if(hash(vec2(band,t))<fxB.y*0.35)p.x=fract(p.x+(hash(vec2(t,band))-0.5)*0.12*fxB.y);}
vec3 col=draw(p);
if(fxA.w>0.0){float o=fxA.w*6.0/(grid.x*cell.x);col.r=draw(p+vec2(o,0.0)).r;col.b=draw(p-vec2(o,0.0)).b;}
if(fxB.z>0.0){vec3 b=vec3(0.0);for(int i=-1;i<=1;i++)for(int j=-1;j<=1;j++){vec4 e=texture2D(cells,(floor(p*grid)+vec2(float(i),float(j))+0.5)/grid);
b+=e.gba*min(e.r*255.0,1.0)/(1.0+float(i*i+j*j));}col+=b*fxB.z*0.22;}
if(fxC.x!=0.0){float y=dot(col,vec3(0.299,0.587,0.114));col=mix(vec3(y),col,1.0+fxC.x);}
if(fxC.y!=0.0){float a=fxC.y*6.283;vec3 k=vec3(0.57735);col=col*cos(a)+cross(k,col)*sin(a)+k*dot(k,col)*(1.0-cos(a));}
if(fxA.y>0.0)col*=1.0-fxA.y*0.55*(0.5+0.5*cos(gl_FragCoord.y*2.094));
if(fxA.x>0.0)col*=1.0-fxA.x*smoothstep(0.35,1.0,length(v_uv-0.5)*1.41);
if(fxB.x>0.0)col+=(hash(gl_FragCoord.xy+fract(time*7.0)*91.0)-0.5)*fxB.x*0.35;
if(fxB.w>0.0)col=mix(col,vec3(0.82),step(1.0-fxB.w*0.004,hash(floor(gl_FragCoord.xy/2.0)+floor(time*12.0)*7.31)));
if(fxC.z>0.0)col*=1.0-fxC.z*0.12*hash(vec2(floor(time*20.0),5.0));
gl_FragColor=vec4(clamp(col,0.0,1.0),1.0);}`;
  const CPU_CELL = 'vec4 cell(vec2 uv){return texture2D(u_data,uv);}';
  const PAD = 3;
  // Look names, by index: the same tables as native/spec.c. A config may also give the index.
  const SHAPES = ['glyph', 'pixel', 'mosaic', 'dots', 'led', 'lego', 'cross', 'diamond', 'lines', 'diagonal', 'voxel', 'disco', 'cmyk'];
  const DITHERS = ['none', 'bayer2', 'bayer4', 'bayer8', 'bayer16', 'halftone', 'radial', 'linesH', 'linesV', 'linesD', 'whiteNoise', 'blueNoise'];
  const INTERACTIONS = ['none', 'glow', 'magnify', 'repel', 'attract', 'swirl', 'ripple'];
  const FX = ['vignette', 'scanlines', 'crt', 'rgbSplit', 'grain', 'glitch', 'bloom', 'dust', 'saturation', 'hue', 'flicker', ''];
  const named = (v, names) => typeof v === 'number' ? v : Math.max(0, names.indexOf(v));
  const rgb = v => (v.match(/[0-9a-f]{2}/gi) || ['00', '00', '00']).map(h => parseInt(h, 16) / 255);
  let lastScene = null;

  function ascii(config = {}) {
    const cfg = Object.assign({charset: ' .:-=+*#%@', cell: 8, aspect: .6, maxCells: 40000, background: '#080909',
      font: '"JetBrains Mono", ui-monospace, monospace', time: 0, period: 2000 * Math.PI, fill: 0}, config);
    const chars = [...cfg.charset];
    if (chars.length > 256) throw new Error('asciipaper: charset is limited to 256 glyphs');
    const canvas = cfg.canvas || (document.body || document.documentElement).appendChild(document.createElement('canvas'));
    canvas.style.cssText += ';position:fixed;inset:0;width:100vw;height:100vh;display:block';
    canvas.addEventListener('webglcontextlost', e => e.preventDefault());
    canvas.addEventListener('webglcontextrestored', () => location.reload());   // e.g. after suspend
    const gl = canvas.getContext('webgl', {antialias: false, depth: false, stencil: false, alpha: false, preserveDrawingBuffer: !!window.__asciipaperThumbnail || /[?&]thumbnail\b/.test(location.search)});

    const compile = (type, code) => { const s = gl.createShader(type); gl.shaderSource(s, code); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('asciipaper shader: ' + gl.getShaderInfoLog(s)); return s; };
    const program = frag => { const p = gl.createProgram(); gl.attachShader(p, compile(gl.VERTEX_SHADER, QUAD));
      gl.attachShader(p, compile(gl.FRAGMENT_SHADER, frag)); gl.bindAttribLocation(p, 0, 'p'); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('asciipaper shader: ' + gl.getProgramInfoLog(p));
      const cache = {}; p.u = name => name in cache ? cache[name] : cache[name] = gl.getUniformLocation(p, name); return p; };
    const texture = (unit, filter) => { const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
      for (const k of ['WRAP_S', 'WRAP_T']) gl.texParameteri(gl.TEXTURE_2D, gl[`TEXTURE_${k}`], gl.CLAMP_TO_EDGE);
      for (const k of ['MIN_FILTER', 'MAG_FILTER']) gl.texParameteri(gl.TEXTURE_2D, gl[`TEXTURE_${k}`], filter); return t; };

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    const cellsTex = texture(0, gl.NEAREST), atlasTex = texture(1, gl.LINEAR), dataTex = texture(2, gl.NEAREST), lutTex = texture(3, gl.NEAREST);
    const glyphProg = program(GLYPHS);
    const cellProg = program(HEADER + (cfg.glsl || CPU_CELL) + CELL_MAIN);
    const fbo = gl.createFramebuffer();
    const bg = (cfg.background.match(/[0-9a-f]{2}/gi) || ['08', '09', '09']).map(h => parseInt(h, 16) / 255);
    gl.useProgram(glyphProg);
    gl.uniform1i(glyphProg.u('cells'), 0); gl.uniform1i(glyphProg.u('atlas'), 1); gl.uniform3fv(glyphProg.u('bg'), bg);
    gl.uniform1f(glyphProg.u('fill'), cfg.fill); gl.uniform1f(glyphProg.u('glyphs'), chars.length);
    gl.uniform1f(glyphProg.u('shape'), named(cfg.shape || 0, SHAPES));
    const fx = FX.map(k => Number(cfg.effects?.[k]) || 0);
    ['fxA', 'fxB', 'fxC'].forEach((k, i) => gl.uniform4fv(glyphProg.u(k), fx.slice(i * 4, i * 4 + 4)));
    gl.useProgram(cellProg);
    const palette = (cfg.palette || []).slice(0, 16).map(rgb);
    // interaction: how the wallpaper answers the pointer, on top of whatever the scene does itself
    const interaction = typeof cfg.interaction === 'string' ? {mode: cfg.interaction} : cfg.interaction || {};
    gl.uniform1f(cellProg.u('u_interact'), named(interaction.mode || 0, INTERACTIONS));
    gl.uniform1f(cellProg.u('u_interactStrength'), interaction.strength ?? 1); gl.uniform1f(cellProg.u('u_interactRadius'), interaction.radius ?? .25);
    gl.uniform1f(cellProg.u('u_dither'), named(cfg.dither || 0, DITHERS)); gl.uniform1f(cellProg.u('u_paletteSize'), palette.length);
    if (palette.length) gl.uniform3fv(cellProg.u('u_palette'), palette.flat());
    gl.uniform1i(cellProg.u('u_data'), 2); gl.uniform1i(cellProg.u('u_lut'), 3);
    gl.uniform1f(cellProg.u('u_glyphs'), chars.length); gl.uniform1f(cellProg.u('u_useLut'), cfg.lut ? 1 : 0);
    if (cfg.lut) {   // lut[i] = glyph index for level i/255, for exact brightness ramps
      const bytes = new Uint8Array(256 * 4); for (let i = 0; i < 256; i++) bytes[i * 4 + 3] = cfg.lut[i] || 0;
      gl.activeTexture(gl.TEXTURE3); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    }

    const textures = {};
    const scene = {
      gl, canvas, cols: 0, rows: 0, width: 0, height: 0, time: cfg.time, pointer, options, uniforms: {}, data: null,
      // Write cell (col, row) for CPU-driven scenes: level 0..1 picks the glyph, r g b 0..1 its colour.
      put(col, row, level, r = 1, g = 1, b = 1) {
        const i = (row * scene.cols + col) * 4, d = scene.data;
        d[i] = r * 255; d[i + 1] = g * 255; d[i + 2] = b * 255; d[i + 3] = level * 255;
      },
      // Upload an RGBA byte image your GLSL reads as `uniform sampler2D <name>` (row 0 = top).
      texture(name, width, height, bytes, linear = true) {
        let t = textures[name];
        if (!t) t = textures[name] = {unit: 4 + Object.keys(textures).length, tex: texture(4 + Object.keys(textures).length, linear ? gl.LINEAR : gl.NEAREST)};
        gl.activeTexture(gl.TEXTURE0 + t.unit); gl.bindTexture(gl.TEXTURE_2D, t.tex);
        if (t.width === width && t.height === height) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
        else { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes); t.width = width; t.height = height; }
        gl.useProgram(cellProg); gl.uniform1i(cellProg.u(name), t.unit);
      },
    };

    function resize() {
      const W = innerWidth, H = innerHeight, dpr = devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(W * dpr)); canvas.height = Math.max(1, Math.round(H * dpr));
      const cellW = Math.max(cfg.cell, Math.sqrt(W * H * cfg.aspect / cfg.maxCells));
      Object.assign(scene, {width: W, height: H, cols: Math.max(1, Math.floor(W / cellW)), rows: Math.max(1, Math.floor(H * cfg.aspect / cellW))});
      const {cols, rows} = scene;
      if (!cfg.glsl) {
        scene.data = new Uint8Array(cols * rows * 4);
        gl.activeTexture(gl.TEXTURE2); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, cols, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      }
      gl.activeTexture(gl.TEXTURE0); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, cols, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, cellsTex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);

      // Glyphs are rasterized at the exact cell size in device pixels, as asciify.org does.
      const cw = canvas.width / cols, ch = canvas.height / rows, tile = Math.ceil(cw) + PAD * 2;
      const atlas = document.createElement('canvas'), ax = atlas.getContext('2d');
      const atlasCols = Math.min(chars.length, Math.max(1, Math.floor(gl.getParameter(gl.MAX_TEXTURE_SIZE) / tile)));
      const atlasRow = Math.ceil(ch) + PAD * 2;
      atlas.width = tile * atlasCols; atlas.height = atlasRow * Math.ceil(chars.length / atlasCols);
      if (atlas.height > gl.getParameter(gl.MAX_TEXTURE_SIZE)) throw new Error('Character atlas exceeds the device texture limit');
      ax.font = `${cfg.weight || 400} ${.9 * Math.min(cw / .55, ch)}px ${cfg.font}`;
      ax.textAlign = 'center'; ax.textBaseline = 'middle'; ax.fillStyle = '#fff';
      chars.forEach((c, i) => ax.fillText(c, (i % atlasCols) * tile + PAD + cw / 2, Math.floor(i / atlasCols) * atlasRow + PAD + ch / 2));
      gl.activeTexture(gl.TEXTURE1); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
      gl.useProgram(glyphProg);
      gl.uniform2f(glyphProg.u('grid'), cols, rows); gl.uniform2f(glyphProg.u('cell'), cw, ch);
      gl.uniform2f(glyphProg.u('atlasSize'), atlas.width, atlas.height);
      gl.uniform1f(glyphProg.u('tile'), tile); gl.uniform1f(glyphProg.u('pad'), PAD);
      gl.useProgram(cellProg);
      gl.uniform2f(cellProg.u('u_grid'), cols, rows); gl.uniform2f(cellProg.u('u_size'), W, H); gl.uniform1f(cellProg.u('u_aspect'), W / H);
      cfg.resize?.(scene);
    }
    addEventListener('resize', resize); resize();

    const clicks = new Float32Array(24);
    const captures = [];
    lastScene = scene;
    scene.capture = async () => {
      if (document.hidden) throw new Error('Open the preview before saving an image');
      const paused = options.paused;
      if (paused) set({paused: false});
      try { return await new Promise((resolve, reject) => captures.push(() => canvas.toBlob(b => b ? resolve(b) : reject(new Error('Image capture failed')), 'image/png'))); }
      finally { if (paused) set({paused: true}); }
    };
    let previous = 0;
    function frame(now) {
      requestAnimationFrame(frame);
      const dt = (previous ? Math.min(.1, (now - previous) / 1000) : 1 / 60) * options.speed * (cfg.pace || 1); previous = now;
      scene.time = cfg.time + (scene.time - cfg.time + dt) % cfg.period;   // wrapped: floats stay precise for weeks
      cfg.update?.(scene, dt);
      gl.useProgram(cellProg);
      if (scene.data) { gl.activeTexture(gl.TEXTURE2); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, scene.cols, scene.rows, gl.RGBA, gl.UNSIGNED_BYTE, scene.data); }
      clicks.fill(0);
      const shown = options.clicks ? pointer.clicks : [];
      shown.forEach((c, i) => clicks.set([c.x, c.y, (now - c.time) / 1000], i * 3));
      for (let i = shown.length; i < 8; i++) clicks[i * 3 + 2] = 1e4;
      gl.uniform1f(cellProg.u('u_time'), scene.time);
      gl.uniform2f(cellProg.u('u_pointer'), pointer.x, pointer.y); gl.uniform2f(cellProg.u('u_velocity'), pointer.vx, pointer.vy);
      gl.uniform1f(cellProg.u('u_down'), pointer.down ? 1 : 0); gl.uniform1f(cellProg.u('u_strength'), options.pointer);
      gl.uniform1f(cellProg.u('u_idle'), (now - pointer.moved) / 1000); gl.uniform3fv(cellProg.u('u_clicks'), clicks);
      for (const [name, value] of Object.entries(scene.uniforms)) {
        const v = typeof value === 'number' ? [value] : value;
        gl[`uniform${v.length}fv`](cellProg.u(name), v);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, scene.cols, scene.rows); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(glyphProg); gl.uniform1f(glyphProg.u('time'), scene.time); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      for (const capture of captures.splice(0)) capture();
    }
    requestAnimationFrame(frame);
    return scene;
  }

  // ---- spec(runtime): the web version of a wallpaper spec (asciipaper writes the page, with the
  // shader inlined). The media, if any, is the page's #asciipaper-media <img> or <video>; each
  // frame is drawn small and handed to the shader as `media`, like asciipaper-engine does.
  const color = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? [1, 3, 5].map(i => parseInt(v.slice(i, i + 2), 16) / 255) : v;
  const LOOK = ['charset', 'cell', 'aspect', 'maxCells', 'background', 'font', 'time', 'period', 'fill', 'weight', 'shape', 'dither', 'palette', 'effects', 'interaction', 'pace'];
  let live = null;   // the running spec: {uniforms, look} for patch()

  function spec(s) {
    if (s.scene) return import(window.__asciipaperLegacyURL || new URL('legacy.js', here)).then(module => module.run(s.scene, s));
    const uniforms = {};
    for (const [k, v] of Object.entries(s.uniforms || {})) uniforms[k] = typeof v === 'boolean' ? +v : color(v);
    live = {uniforms, look: JSON.stringify(LOOK.map(k => s[k])), shader: s.glsl};
    const config = {glsl: s.glsl};
    for (const k of LOOK) if (s[k] !== undefined) config[k] = s[k];
    const el = s.media && document.getElementById('asciipaper-media');
    if (el && 'playbackRate' in el) { el.playbackRate = uniforms.speed || 1; el.play?.().catch(() => {}); }
    live.media = el;
    let frame = null, placeholder = false;
    return ascii(Object.assign(config, {
      update(scene) {
        Object.assign(scene.uniforms, uniforms);
        const w0 = el && (el.videoWidth || el.naturalWidth), h0 = el && (el.videoHeight || el.naturalHeight);
        if (!w0) {   // no media, or not loaded yet: bind something, or the sampler reads the frame being drawn
          if (!placeholder) { scene.texture('media', 1, 1, new Uint8Array([0, 0, 0, 255])); scene.uniforms.mediaSize = [1, 1]; placeholder = true; }
          return;
        }
        if (!frame) {
          const k = Math.min(1, 256 / Math.max(w0, h0)), w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));   // 256 px on the longer side
          frame = Object.assign(document.createElement('canvas'), {width: w, height: h}).getContext('2d', {willReadFrequently: true});
        }
        const {width, height} = frame.canvas;
        frame.drawImage(el, 0, 0, width, height);
        scene.texture('media', width, height, new Uint8Array(frame.getImageData(0, 0, width, height).data.buffer));
        scene.uniforms.mediaSize = [width, height];
      },
    }));
  }

  // ---- load(url): run a wallpaper spec straight from its JSON (pages served over http(s), where
  // fetch works: the Windows app, a local server). Resolves the shader file or the built-in media
  // shader, its `// defaults:` line, and the media element.
  async function resolveSpec(url) {
    const base = new URL(url, location.href), s = await (await fetch(base, {cache: 'no-store'})).json();
    let glsl = s.shader ?? (s.media ? 'media' : null);
    if (typeof glsl !== 'string') throw new Error('asciipaper: a spec needs "shader" or "media"');
    if (!/\bcell\s*\(/.test(glsl)) glsl = await (await fetch(glsl === 'media' ? new URL('media.glsl', here) : new URL(glsl, base), {cache: 'no-store'})).text();
    const first = glsl.split('\n', 1)[0];
    const defaults = first.startsWith('// defaults:') ? JSON.parse(first.slice(12)) : {};
    return {...s, glsl, uniforms: {...defaults, ...s.uniforms}, mediaUrl: s.media && new URL(s.media, base).href};
  }
  async function load(url) {
    const s = await resolveSpec(url);
    if (s.scene) return (await import(new URL('legacy.js', here))).run(s.scene, s);
    if (s.mediaUrl) {
      const still = s.mediaType?.startsWith('image/') || /\.(gif|png|jpe?g|webp|bmp|avif|apng)$/i.test(new URL(s.mediaUrl).pathname);
      const el = document.createElement(still ? 'img' : 'video');
      Object.assign(el, {id: 'asciipaper-media', hidden: true, src: s.mediaUrl, crossOrigin: 'anonymous'});
      if (!still) Object.assign(el, {muted: true, loop: true, autoplay: true, playsInline: true});
      document.body.append(el);
    }
    return spec(s);
  }
  // patch(url): after the spec changed on disk. Uniform-only changes apply live; returns false when
  // the page must reload (characters, size, shader, media…).
  async function patch(url) {
    if (!live) return false;
    const s = await resolveSpec(url);
    if (JSON.stringify(LOOK.map(k => s[k])) !== live.look || s.glsl !== live.shader) return false;
    for (const k of Object.keys(live.uniforms)) delete live.uniforms[k];
    for (const [k, v] of Object.entries(s.uniforms)) live.uniforms[k] = typeof v === 'boolean' ? +v : color(v);
    if (live.media && 'playbackRate' in live.media) live.media.playbackRate = live.uniforms.speed || 1;
    return true;
  }

  window.asciipaper = {options, pointer, set, ascii, spec, load, patch,
    get ready() { return !!lastScene; },
    capture: () => lastScene ? lastScene.capture() : Promise.reject(new Error('Preview is still loading')),
    onChange(callback) { addEventListener('asciipaper-settings', event => callback(event.detail)); }};
  set({});
})();

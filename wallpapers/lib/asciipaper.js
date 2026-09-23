// asciipaper runtime: frame pacing, pointer input, host settings and a GPU ASCII renderer.
// The asciipaper host (and Lively export) injects this file before the page runs, with the user's
// settings in window.__asciipaperOptions. Pages include it too so they also work in a plain browser;
// the second load is a no-op. Docs: ../../README.md#write-your-own
(() => {
  if (window.asciipaper?.ascii) return;

  const options = Object.assign({fps: 24, idleFps: 12, quality: 1, pointer: 1, paused: false},
                                window.__asciipaperOptions);
  const pointer = {x: .5, y: .5, vx: 0, vy: 0, down: false, inside: false, moved: -1e9, clicks: []};

  // ---- Frame pacing. Pages keep calling requestAnimationFrame as usual; callbacks run at `fps`
  // while the pointer is active, `idleFps` otherwise, and not at all while paused. Waiting on a
  // timer (instead of skipping vsyncs) means a 120 Hz monitor costs no more than a 60 Hz one.
  const nativeRaf = window.requestAnimationFrame.bind(window);
  const callbacks = new Map();
  let nextId = 1, timer = 0, pending = 0, last = 0;
  const rate = () => performance.now() - pointer.moved < 2000 ? options.fps : options.idleFps;
  function flush(now) {
    pending = 0; last = now;
    const run = [...callbacks.values()]; callbacks.clear();
    for (const callback of run) try { callback(now); } catch (error) { reportError(error); }
  }
  function schedule() {
    if (timer || pending || options.paused || !callbacks.size) return;
    const wait = last + 1000 / rate() - performance.now();
    const go = () => { timer = 0; pending = nativeRaf(flush); };
    if (wait > 0) timer = setTimeout(go, wait); else go();
  }
  function reschedule() { clearTimeout(timer); timer = 0; schedule(); }
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
    options.paused = !!options.paused;
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
  const CELL_MAIN = `
uniform sampler2D u_lut;uniform float u_glyphs,u_useLut;
void main(){vec4 c=cell(vec2(v_uv.x,1.0-v_uv.y));float l=clamp(c.a,0.0,1.0);
float g=u_useLut>0.5?texture2D(u_lut,vec2((floor(l*255.0+0.5)+0.5)/256.0,0.5)).a*255.0:floor(l*(u_glyphs-1.0)+0.5);
gl_FragColor=vec4(g/255.0,clamp(c.rgb,0.0,1.0));}`;
  const GLYPHS = `precision highp float;varying vec2 v_uv;uniform sampler2D cells,atlas;uniform vec2 grid,cell,atlasSize;uniform float tile,pad;uniform vec3 bg;
void main(){vec4 d=texture2D(cells,(floor(v_uv*grid)+0.5)/grid);vec2 l=fract(vec2(v_uv.x,1.0-v_uv.y)*grid);
vec2 uv=(vec2(floor(d.r*255.0+0.5)*tile,0.0)+pad+l*cell)/atlasSize;gl_FragColor=vec4(mix(bg,d.gba,texture2D(atlas,uv).a),1.0);}`;
  const CPU_CELL = 'vec4 cell(vec2 uv){return texture2D(u_data,uv);}';
  const PAD = 3;

  function ascii(config = {}) {
    const cfg = Object.assign({charset: ' .:-=+*#%@', cell: 8, aspect: .6, maxCells: 40000, background: '#080909',
      font: '"JetBrains Mono", ui-monospace, monospace', time: 0, period: 2000 * Math.PI}, config);
    const chars = [...cfg.charset];
    if (chars.length > 256) throw new Error('asciipaper: charset is limited to 256 glyphs');
    const canvas = cfg.canvas || (document.body || document.documentElement).appendChild(document.createElement('canvas'));
    canvas.style.cssText += ';position:fixed;inset:0;width:100vw;height:100vh;display:block';
    canvas.addEventListener('webglcontextlost', e => e.preventDefault());
    canvas.addEventListener('webglcontextrestored', () => location.reload());   // e.g. after suspend
    const gl = canvas.getContext('webgl', {antialias: false, depth: false, stencil: false, alpha: false, preserveDrawingBuffer: false});

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
    gl.useProgram(cellProg);
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
      atlas.width = tile * chars.length; atlas.height = Math.ceil(ch) + PAD * 2;
      ax.font = `${.9 * Math.min(cw / .55, ch)}px ${cfg.font}`;
      ax.textAlign = 'center'; ax.textBaseline = 'middle'; ax.fillStyle = '#fff';
      chars.forEach((c, i) => ax.fillText(c, i * tile + PAD + cw / 2, PAD + ch / 2));
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
    let previous = 0;
    function frame(now) {
      requestAnimationFrame(frame);
      const dt = previous ? Math.min(.1, (now - previous) / 1000) : 1 / 60; previous = now;
      scene.time = cfg.time + (scene.time - cfg.time + dt) % cfg.period;   // wrapped: floats stay precise for weeks
      cfg.update?.(scene, dt);
      gl.useProgram(cellProg);
      if (scene.data) { gl.activeTexture(gl.TEXTURE2); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, scene.cols, scene.rows, gl.RGBA, gl.UNSIGNED_BYTE, scene.data); }
      clicks.fill(0);
      pointer.clicks.forEach((c, i) => clicks.set([c.x, c.y, (now - c.time) / 1000], i * 3));
      for (let i = pointer.clicks.length; i < 8; i++) clicks[i * 3 + 2] = 1e4;
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
      gl.useProgram(glyphProg); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    requestAnimationFrame(frame);
    return scene;
  }

  window.asciipaper = {options, pointer, set, ascii,
    onChange(callback) { addEventListener('asciipaper-settings', event => callback(event.detail)); }};
  set({});
})();

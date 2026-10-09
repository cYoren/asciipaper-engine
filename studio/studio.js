// The asciipaper Studio: choose, port, customize. Runs inside the Windows app (WebView2), which
// answers `host.call(method, params)` and serves everything from one origin: /app/ (this page,
// wallpapers/) and /library/ (the user's wallpapers). ?mock uses a fake host, for development.
'use strict';

// Portable storage is asynchronous; the Windows bridge is immediately ready.
(async () => {
await window.portableReady;
const WP = new URL('../wallpapers/', location.href);
if (window.AndroidPaper) {
  const button=document.querySelector('#platform-wallpaper');button.hidden=false;
  button.addEventListener('click',()=>window.paperPortable.native('wallpaper',{}));
}

const $ = s => document.querySelector(s);
const desktopHost=!!window.chrome?.webview || (!!window.webkit?.messageHandlers?.paper && !/iPhone|iPad|iPod/.test(navigator.userAgent));
if(!desktopHost) $('.eyebrow').textContent='Selected wallpaper';
if(!window.chrome?.webview){
  $('#autostart').closest('label').hidden=true;
  $('#open-folder').hidden=true;
  $('#drawer-export').hidden=true;
}
const CHARSETS = {
  Classic: ' .:-=+*#%@',
  Detailed: " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
  Blocks: ' ░▒▓█',
  Braille: ' ⠁⠃⠇⡇⣇⣧⣷⣿',
  Dots: ' ·•●',
  Letters: ' .ilLCFTYASMW',
  Asciify: ' .:-=+ASCIIFY#@',
  Binary: ' 01',
};

// ---- Host bridge
const host = (() => {
  if (window.chrome?.webview) {
    let seq = 0;
    const pending = new Map(), listeners = {};
    chrome.webview.addEventListener('message', e => {
      const m = e.data;
      if (m.id && pending.has(m.id)) {
        const {resolve, reject} = pending.get(m.id); pending.delete(m.id);
        m.error ? reject(new Error(m.error)) : resolve(m.result);
      } else if (m.event) listeners[m.event]?.(m.data);
    });
    const send = (method, params, files) => new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, {resolve, reject});
      files ? chrome.webview.postMessageWithAdditionalObjects({id, method, params}, files) : chrome.webview.postMessage({id, method, params});
    });
    return {call: (method, params = {}) => send(method, params), files: (method, files) => send(method, {}, files),
            on: (event, fn) => { listeners[event] = fn; }};
  }
  return window.mockHost;   // set by mock.js
})();

let state = null, editing = null, saveTimer = 0, savePending = null;
async function flushSave() { clearTimeout(saveTimer); const action=savePending;savePending=null;if(action)await action(); }

function toast(text) {
  const t = Object.assign(document.createElement('div'), {className: 'toast', textContent: text});
  $('#toasts').append(t);
  setTimeout(() => t.remove(), 4200);
}
const fail = error => toast(`Something went wrong: ${error.message || error}`);
const item = name => state.library.find(w => w.name === name);
const withParam = (url, param) => url + (url.includes('?') ? '&' : '?') + param;

function ask(title, body, placeholder = '') {
  const dialog = $('#ask');
  $('#ask-title').textContent = title; $('#ask-body').textContent = body;
  const input = $('#ask-input'); input.value = ''; input.placeholder = placeholder;
  dialog.showModal(); input.focus();
  return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok' ? input.value.trim() : null), {once: true}));
}

// ---- Rendering the page
function render() {
  const current = item(state.current);
  $('#now-name').textContent = current ? current.title : 'Nothing yet';
  $('#now-customize').hidden = !current?.spec;
  const preview = $('#now-preview');
  if (current && preview.dataset.url !== current.url) { preview.dataset.url = current.url; preview.src = current.url; }
  $('#pause').textContent = state.paused ? 'Resume' : 'Pause';
  $('#pause').setAttribute('aria-pressed', state.paused);
  $('#now-hint').textContent = state.paused ? 'Paused. Resume to bring it back.' :
    window.chrome?.webview ? 'It lives behind your desktop icons, and pauses by itself while a window covers the screen.' :
    'Your library is saved on this device. Save a project to carry the complete wallpaper to another platform.';
  syncPreviews();

  const gallery = $('#gallery');
  gallery.replaceChildren(...state.library.map(w => {
    const card = document.createElement('div');
    card.className = 'card' + (w.name === state.current ? ' current' : '');
    card.role = 'listitem'; card.tabIndex = 0; card.title = `Select ${w.title}`;
    card.innerHTML = `<div class="thumb"></div><div class="meta"><span class="name"></span></div>`;
    const thumb = card.querySelector('.thumb');
    if (w.thumb) thumb.style.backgroundImage = `url("${w.thumb}")`;
    else thumb.textContent = w.kind === 'html' ? 'HTML' : '…';
    card.querySelector('.name').textContent = w.title;
    if (w.own) card.querySelector('.meta').insertAdjacentHTML('beforeend', '<span class="badge">Yours</span>');
    if (w.name === state.current) card.insertAdjacentHTML('beforeend', '<span class="on">On</span>');
    if (w.spec) {
      const edit = Object.assign(document.createElement('button'), {className: 'edit', textContent: 'Customize'});
      edit.addEventListener('click', e => { e.stopPropagation(); openDrawer(w.name); });
      card.append(edit);
    }
    const apply = () => host.call('apply', {name: w.name}).then(update).then(() => toast(desktopHost ? `${w.title} is on your desktop` : `${w.title} selected`)).catch(fail);
    card.addEventListener('click', apply);
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); apply(); } });
    return card;
  }));
  queueThumbnails();
}

function update(next) { state = next; render(); if (document.activeElement !== speedInput) { speedInput.value = state.options?.speed ?? 1; speedInput.nextElementSibling.value = (+speedInput.value).toFixed(2); } if (editing && !item(editing)) closeDrawer(); }

// ---- Thumbnails: render each wallpaper once, off to the side, and keep a snapshot.
let thumbnailing = false;
async function queueThumbnails() {
  if (thumbnailing) return;
  thumbnailing = true;
  try {
    for (const w of state.library.filter(w => !w.thumb && w.kind !== 'html').slice(0, 4)) {
      if (document.hidden || window.paperNativeHidden) break;
      const frame = Object.assign(document.createElement('iframe'), {src: withParam(w.url, 'thumbnail=1')});
      $('#thumbnailer').replaceChildren(frame);
      await new Promise(r => setTimeout(r, 2600));
      if(document.hidden || window.paperNativeHidden){$('#thumbnailer').replaceChildren();break;}
      const canvas = frame.contentDocument?.querySelector('canvas');
      if (canvas) {
        const data = canvas.toDataURL('image/jpeg', 0.85);
        const saved = await host.call('saveThumb', {name: w.name, data}).catch(() => null);
        if (saved) { w.thumb = saved; render(); }
      }
      $('#thumbnailer').replaceChildren();
    }
  } finally { thumbnailing = false; }
}

// ---- Porting: the host stores the media; the page measures it and writes the wallpaper spec.
async function measure(url) {
  const still = /\.(gif|png|jpe?g|webp|bmp|avif|apng)(\?|$)/i.test(url);
  const el = document.createElement(still ? 'img' : 'video');
  el.crossOrigin = 'anonymous'; el.muted = true; el.preload = 'auto'; el.src = url;
  await new Promise((resolve, reject) => { el.onerror = () => reject(new Error("can't read that file as a picture or video")); el[still ? 'onload' : 'onloadeddata'] = resolve; });
  const w0 = el.naturalWidth || el.videoWidth, h0 = el.naturalHeight || el.videoHeight;
  const canvas = Object.assign(document.createElement('canvas'), {width: 96, height: Math.max(1, Math.round(96 * h0 / w0))});
  const g = canvas.getContext('2d', {willReadFrequently: true});
  const pixels = [];
  const grab = () => { g.drawImage(el, 0, 0, canvas.width, canvas.height); pixels.push(g.getImageData(0, 0, canvas.width, canvas.height).data); };
  if (still) grab();
  else for (const at of [0.1, 0.35, 0.6, 0.85]) {
    el.currentTime = at * (el.duration || 0);
    await new Promise(r => { el.onseeked = r; setTimeout(r, 1500); });
    grab();
  }
  // Same rules as the Linux importer (look() in asciipaper): stretch the 2nd..98th percentile
  // luminance, invert paper-like pictures, take tint and background from the average colour.
  const luma = [], sum = [0, 0, 0]; let chroma = 0, n = 0;
  for (const d of pixels) for (let i = 0; i < d.length; i += 4) {
    const r = d[i], gg = d[i + 1], b = d[i + 2];
    luma.push(0.299 * r + 0.587 * gg + 0.114 * b); sum[0] += r; sum[1] += gg; sum[2] += b;
    chroma += Math.max(r, gg, b) - Math.min(r, gg, b); n++;
  }
  luma.sort((a, b) => a - b);
  const lo = luma[Math.floor(n * .02)] / 255, hi = luma[Math.floor(n * .98)] / 255;
  const contrast = Math.min(4, 1 / Math.max(hi - lo, .25));
  const median = (luma[n >> 1] / 255 - lo) * contrast;
  const mean = sum.map(v => v / n), peak = Math.max(...mean) || 1;
  const hex = scale => '#' + mean.map(v => Math.min(255, Math.round(v / peak * scale)).toString(16).padStart(2, '0')).join('');
  const uniforms = {contrast: +contrast.toFixed(2), brightness: +(contrast * (.5 - lo) - .5).toFixed(2), tint: hex(255)};
  if (median > .55 && chroma / n / 255 < .15) uniforms.invert = 1;
  return {uniforms, background: hex(18)};
}

async function port(imported) {
  if (!imported) return;
  toast('Turning it into ASCII…');
  try {
    const look = await measure(imported.media);
    const spec = {title: imported.title || imported.name, media: imported.relative, charset: CHARSETS.Detailed,
                  cell: 7, aspect: 0.55, weight: 700, fill: 0.25, background: look.background, uniforms: look.uniforms};
    await host.call('saveSpec', {name: imported.name, spec});
    update(await host.call('apply', {name: imported.name}));
    toast(`${spec.title} is ready. Customize it any time.`);
  } catch (error) {
    await host.call('remove', {name: imported.name}).catch(() => {});
    fail(error);
  }
}

$('#add-file').addEventListener('click', () => host.call('pickMedia').then(port).catch(fail));
$('#add-link').addEventListener('click', async () => {
  const link = await ask('Paste a link', 'A post on X or Twitter, or a direct link to a picture, GIF or video.', 'https://x.com/…/status/…');
  if (!link) return;
  if (!/^https?:\/\//.test(link)) return toast("That doesn't look like a link");
  toast('Downloading…');
  host.call('importUrl', {url: link}).then(port).catch(fail);
});
$('#add-shader').addEventListener('click', async () => {
  const name = await ask('New shader wallpaper', 'Write a GLSL cell shader and save it to your library.', 'my-wallpaper');
  if (name) host.call('newShader', {name}).then(update).catch(fail);
});
$('#add-text').addEventListener('click',async ()=>{
  try {
    const text=await ask('Text wallpaper','A word, name or short message to draw in characters.','HELLO');if(!text)return;
    const canvas=Object.assign(document.createElement('canvas'),{width:1920,height:1080}),g=canvas.getContext('2d');
    g.fillStyle='#000';g.fillRect(0,0,1920,1080);g.fillStyle='#fff';g.textAlign='center';g.textBaseline='middle';
    let size=300;g.font=`bold ${size}px monospace`;size=Math.min(size,1600/g.measureText(text).width*size);g.font=`bold ${size}px monospace`;g.fillText(text,960,540);
    const shader=await (await fetch(new URL('lib/media.glsl',WP))).text(),blob=await new Promise(ok=>canvas.toBlob(ok,'image/png'));
    const project=PaperProject.create({title:text,shader,media:'media/text.png',cell:8,aspect:.55,charset:CHARSETS.Detailed}, {name:'text.png',mime:'image/png',data:await PaperProject.base64(blob)});
    update(await host.call('importProject',{project}));toast('Text wallpaper created');
  }catch(e){fail(e);}
});

const drop = $('#drop');
for (const type of ['dragenter', 'dragover']) document.addEventListener(type, e => { e.preventDefault(); drop.classList.add('over'); });
for (const type of ['dragleave', 'drop']) document.addEventListener(type, e => { if (type === 'drop' || !e.relatedTarget) drop.classList.remove('over'); });
document.addEventListener('drop', e => {
  e.preventDefault();
  const files = [...(e.dataTransfer?.files || [])];
  if (files.length) host.files('importDropped', files.slice(0, 1)).then(port).catch(fail);
});

// ---- Customize drawer: every change is saved to the spec; the desktop and preview update live.
const CONTROLS = [
  {group: 'Characters'},
  {key: 'charset', label: 'Characters', type: 'select', options: CHARSETS, fallback: CHARSETS.Classic},
  {key: 'cell', label: 'Size', type: 'range', min: 4, max: 24, step: 1, fallback: 8},
  {key: 'weight', label: 'Weight', type: 'select', options: {Light: 300, Regular: 400, Bold: 700, Heavy: 900}, fallback: 400},
  {key: 'fill', label: 'Glow', hint: "Each character's colour, faintly, behind it", type: 'range', min: 0, max: 1, step: .05, fallback: 0},
  {key: 'background', label: 'Background', type: 'color', fallback: '#000000'},
  {group: 'Colour', media: true},
  {key: 'u.colorMode', label: 'Colours', type: 'select', options: {"The picture's own": 0, 'One colour': 1, Gradient: 2}, fallback: 0, media: true},
  {key: 'u.tint', label: 'Tint', hint: 'Dark or grey parts, and one colour', type: 'color', fallback: '#e8b900', media: true},
  {key: 'u.tint2', label: 'Second colour', hint: "The gradient's bright end", type: 'color', fallback: '#ff3355', media: true},
  {key: 'u.vivid', label: 'Colour lift', type: 'range', min: 0, max: 1, step: .05, fallback: .5, media: true},
  {key: 'u.contrast', label: 'Contrast', type: 'range', min: .2, max: 4, step: .05, fallback: 1, media: true},
  {key: 'u.brightness', label: 'Brightness', type: 'range', min: -1, max: 1, step: .05, fallback: 0, media: true},
  {key: 'u.invert', label: 'Invert', hint: 'Dense characters for the dark parts', type: 'switch', fallback: 0, media: true},
  {group: 'Picture', media: true},
  {key: 'u.fit', label: 'Fill the screen', hint: 'Crop instead of showing everything', type: 'switch', fallback: 0, media: true},
  {key: 'u.backdrop', label: 'Backdrop', hint: "A dim copy where the picture doesn't reach", type: 'range', min: 0, max: 1, step: .05, fallback: .3, media: true},
  {key: 'u.zoom', label: 'Zoom', type: 'range', min: .5, max: 3, step: .05, fallback: 1, media: true},
  {key: 'u.speed', label: 'Playback speed', type: 'range', min: .1, max: 3, step: .05, fallback: 1, media: true},
  {group: 'Mouse effects', media: true},
  {key: 'u.lens', label: 'Hover lens', type: 'range', min: 0, max: 2, step: .1, fallback: 1, media: true},
  {key: 'u.ripple', label: 'Click ripple', type: 'range', min: 0, max: 2, step: .1, fallback: 1, media: true},
];

// The looks the Linux app has too (styles, shapes, palettes, dithers, effects, warps), from one shared file.
let LOOKS = null;
const NAMES = {crt: 'CRT curve', rgbSplit: 'RGB split', cmyk: 'CMYK', led: 'LED', lego: 'LEGO', c64: 'C64', nes: 'NES', cga: 'CGA', pico8: 'PICO-8'};
const title = k => NAMES[k] || k[0].toUpperCase() + k.slice(1).replace(/([A-Z])/g, ' $1').toLowerCase();
function lookControls() {
  const L = LOOKS, pick = names => Object.fromEntries(names.map(n => [title(n), n]));
  const styles = {Custom: null};
  for (const name of Object.keys(L.styles)) styles[title(name)] = name;
  return [
    {group: 'Look'},
    {key: 'style', label: 'Style', hint: 'A whole look at once; fine-tune it below', type: 'select', options: styles, fallback: null},
    {key: 'shape', label: 'Shape', hint: 'Characters, or pixels, tiles, dots, LEGO…', type: 'select', options: pick(L.shapes), fallback: 'glyph'},
    {key: 'palette', label: 'Palette', type: 'select', fallback: [],
     options: {'Own colours': [], ...Object.fromEntries(Object.entries(L.palettes).map(([k, v]) => [title(k), v]))}},
    {key: 'dither', label: 'Dither', type: 'select', options: pick(L.dithers), fallback: 'none'},
    {key: 'u.warp', label: 'Warp', type: 'select', options: Object.fromEntries(L.warps.map((w, i) => [title(w), i])), fallback: 0, media: true},
    {key: 'u.warpAmount', label: 'Warp amount', type: 'range', min: -1, max: 1, step: .05, fallback: .5, media: true},
    {group: 'Effects'},
    ...Object.entries(L.effects).map(([k, [min, max]]) => ({key: 'fx.' + k, label: title(k), type: 'range', min, max, step: .05, fallback: 0})),
  ];
}
// A style resets shape, dither, palette and effects, then sets its own (as `asciipaper look NAME STYLE` does).
function applyStyle(spec, name) {
  const {about, uniforms, ...look} = LOOKS.styles[name], before = LOOKS.styles[spec.style] || {};
  for (const k of Object.keys(before.uniforms || {})) if (!(k in (uniforms || {}))) delete spec.uniforms?.[k];   // undo the last style
  if (before.background && !look.background) spec.background = '#080909';
  delete spec.shape; delete spec.dither; delete spec.palette; delete spec.effects;
  Object.assign(spec, look, {style: name});
  if (look.charset in LOOKS.charsets) spec.charset = LOOKS.charsets[look.charset];
  if (typeof look.palette === 'string') spec.palette = LOOKS.palettes[look.palette];
  if (uniforms) spec.uniforms = {...spec.uniforms, ...uniforms};
}

async function openDrawer(name) {
  await flushSave();
  let w = item(name);
  if (!w.own) {   // built-ins stay as shipped: customize your own copy
    const copy = await host.call('copyBuiltin', {name}).catch(fail);
    if (!copy) return;
    update(copy.state); w = item(copy.name); name = copy.name;
    toast(`Customizing your copy: ${w.title}`);
  }
  editing = name;
  const spec = await (await fetch(w.spec, {cache: 'no-store'})).json();
  let defaults = {};
  if (spec.media || spec.shader === 'media') {
    const glsl = await (await fetch(new URL('lib/media.glsl', WP))).text();
    defaults = JSON.parse(glsl.split('\n', 1)[0].slice(12));
  }
  $('#drawer-title').textContent = `Customize ${w.title}`;
  $('#drawer-delete').hidden = !w.own;
  $('#drawer-recipe').hidden = $('#drawer-paste').hidden = !w.spec;
  const preview = $('#drawer-preview');
  preview.src = w.url;
  LOOKS ||= await (await fetch(new URL('lib/looks.json', WP))).json();
  const get = c => c.key.startsWith('u.') ? (spec.uniforms?.[c.key.slice(2)] ?? defaults[c.key.slice(2)] ?? c.fallback)
    : c.key.startsWith('fx.') ? (spec.effects?.[c.key.slice(3)] ?? c.fallback) : (spec[c.key] ?? c.fallback);
  const set = async (c, value) => {
    if (c.key === 'style') {
      if (!value) return;
      applyStyle(spec, value);
      await host.call('saveSpec', {name, spec}).catch(fail);
      return openDrawer(name);
    }
    if (c.key.startsWith('u.')) (spec.uniforms ||= {})[c.key.slice(2)] = value;
    else if (c.key.startsWith('fx.')) (spec.effects ||= {})[c.key.slice(3)] = value;
    else spec[c.key] = value;
    clearTimeout(saveTimer);
    savePending = async () => {
      try {
        await host.call('saveSpec', {name, spec});
        const fresh = await host.call('state'); state = fresh; w = item(name);
        const live = preview.contentWindow?.asciipaper;
        if (!live || !(await live.patch(w.spec).catch(() => false))) preview.src = w.url;
      } catch (error) { fail(error); }
    };
    saveTimer = setTimeout(flushSave, 160);
  };
  const media = !!(spec.media || spec.shader === 'media');
  const charsets = Object.fromEntries(Object.entries(LOOKS.charsets).map(([k, v]) => [title(k), v]));
  const controls = [...lookControls(), ...CONTROLS.map(c => c.key === 'charset' ? {...c, options: charsets} : c)];
  $('#controls').replaceChildren(...controls.filter(c => media || !c.media).map(c => {
    if (c.group) return Object.assign(document.createElement('div'), {className: 'group', textContent: c.group});
    const row = document.createElement('label');
    row.innerHTML = `<span></span>`;
    row.firstChild.textContent = c.label;
    if (c.hint) row.firstChild.append(Object.assign(document.createElement('small'), {textContent: c.hint}));
    const value = get(c);
    if (c.type === 'range') {
      row.className = 'slider-row';
      const input = Object.assign(document.createElement('input'), {type: 'range', min: c.min, max: c.max, step: c.step, value});
      const out = Object.assign(document.createElement('output'), {value: (+value).toFixed(c.step < 1 ? 2 : 0)});
      input.addEventListener('input', () => { out.value = (+input.value).toFixed(c.step < 1 ? 2 : 0); set(c, +input.value); });
      row.append(input, out);
    } else if (c.type === 'switch') {
      row.className = 'switch-row';
      const input = Object.assign(document.createElement('input'), {type: 'checkbox', checked: !!value});
      input.addEventListener('change', () => set(c, input.checked ? 1 : 0));
      row.append(input);
    } else if (c.type === 'color') {
      row.className = 'color-row';
      const input = Object.assign(document.createElement('input'), {type: 'color', value});
      input.addEventListener('input', () => set(c, input.value));
      row.append(input);
    } else {
      row.className = 'select-row';
      const select = document.createElement('select');
      const entries = Object.entries(c.options);
      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      if (!entries.some(([, v]) => same(v, value))) entries.push(['Custom', value]);
      for (const [label, v] of entries) select.append(new Option(label, JSON.stringify(v), false, same(v, value)));
      select.addEventListener('change', () => set(c, JSON.parse(select.value)));
      row.append(select);
    }
    return row;
  }));
  $('#drawer').classList.add('open'); $('#drawer').setAttribute('aria-hidden', 'false');
  syncPreviews();
}
async function closeDrawer() {
  await flushSave();
  editing = null;
  $('#drawer').classList.remove('open'); $('#drawer').setAttribute('aria-hidden', 'true');
  $('#drawer-preview').src = 'about:blank';
  host.call('state').then(update).catch(() => {});   // thumbnails may be stale now
}
$('#drawer-close').addEventListener('click', closeDrawer);
$('#now-customize').addEventListener('click', () => openDrawer(state.current));
// ---- Share: the same web page `asciipaper export` makes, and the same look codes as the Linux app.
const RUNTIME = ['scene', 'charset', 'cell', 'aspect', 'maxCells', 'background', 'font', 'time', 'period', 'fill', 'weight', 'shape', 'dither', 'palette', 'effects'];
const LOOK_KEYS = ['charset', 'cell', 'aspect', 'maxCells', 'background', 'font', 'fill', 'weight', 'shape', 'dither', 'palette', 'effects', 'uniforms'];
const RECIPE = 'asciipaper:v1:';
async function specOf(w) {
  const url = new URL(w.spec, location.href), spec = await (await fetch(url, {cache: 'no-store'})).json();
  let glsl = spec.shader ?? (spec.media ? 'media' : null);
  if (!/\bcell\s*\(/.test(glsl)) glsl = await (await fetch(glsl === 'media' ? new URL('lib/media.glsl', WP) : new URL(glsl, url))).text();
  return {spec, glsl};
}
async function exportPage(w) {
  if (!w.spec) return {html: await (await fetch(w.url)).text(), media: null};
  const {spec, glsl} = await specOf(w), first = glsl.split('\n', 1)[0];
  const runtime = Object.fromEntries(RUNTIME.filter(k => k in spec).map(k => [k, spec[k]]));
  Object.assign(runtime, {glsl, uniforms: {...(first.startsWith('// defaults:') ? JSON.parse(first.slice(12)) : {}), ...spec.uniforms}, media: !!spec.media});
  const esc = v => String(v).replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
  const media = !spec.media ? '' : /\.(gif|png|jpe?g|webp|bmp|avif|apng)$/i.test(spec.media)
    ? `<img id="asciipaper-media" src="${esc(spec.media)}" alt="" hidden>`
    : `<video id="asciipaper-media" src="${esc(spec.media)}" autoplay loop muted playsinline hidden></video>`;
  const html = `<!doctype html>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>${esc(spec.title || w.title)}</title>
<script src="./lib/asciipaper.js"></script>\n<style>html,body{margin:0;height:100%;overflow:hidden;background:${esc(spec.background || '#000000')}}</style>
${media}\n<script>asciipaper.spec(${JSON.stringify(runtime).replace(/<\//g, '<\\/')});</script>\n`;
  return {html, media: spec.media || null};
}
const pump = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
async function encodeRecipe(w) {
  const {spec, glsl} = await specOf(w);
  const recipe = Object.fromEntries(LOOK_KEYS.filter(k => k in spec).map(k => [k, spec[k]]));
  if (typeof spec.shader === 'string' && !spec.media) recipe.shader = glsl;
  const packed = await pump(new TextEncoder().encode(JSON.stringify(recipe)), new CompressionStream('deflate'));
  return RECIPE + (await PaperProject.base64(new Blob([packed]))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function decodeRecipe(code) {
  if (!code.startsWith(RECIPE)) throw new Error(`A look code starts with ${RECIPE}`);
  if(code.length>512*1024)throw new Error('Look code is too large');
  const b64 = code.slice(RECIPE.length).replace(/-/g, '+').replace(/_/g, '/');
  const bytes = Uint8Array.from(atob(b64 + '='.repeat(-b64.length & 3)), c => c.charCodeAt(0));
  const reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate')).getReader(),parts=[];let total=0;
  try{for(;;){const {value,done}=await reader.read();if(done)break;total+=value.length;if(total>256*1024)throw new Error('Decoded look is too large');parts.push(value);}}finally{await reader.cancel();}
  const result=JSON.parse(await new Blob(parts).text());
  if(!result||typeof result!=='object'||Array.isArray(result))throw new Error('Invalid look code');
  return result;
}
$('#drawer-export').addEventListener('click', async () => {
  const w = item(editing);
  try {
    const {html, media} = await exportPage(w);
    const file = await host.call('exportZip', {title: w.title, html, media});
    if (file) toast(`Exported. Open it with Wallpaper Engine or Lively, or unzip it into Plash on a Mac`);
  } catch (error) { fail(error); }
});
$('#drawer-recipe').addEventListener('click', async () => {
  try {
    const text=await encodeRecipe(item(editing));
    if(window.webkit?.messageHandlers?.paper)await paperPortable.native('copyText',{text});else await navigator.clipboard.writeText(text);
    toast('Look code copied');
  } catch (error) { fail(error); }
});
$('#drawer-paste').addEventListener('keydown', async e => {
  if (e.key !== 'Enter') return;
  const text = e.target.value.trim(), name = editing;
  try {
    const {spec} = await specOf(item(name));
    if (text in LOOKS.styles) applyStyle(spec, text);
    else {   // a whole look: reset, then layer (uniforms merge, so a picture keeps its exposure)
      const {shader, uniforms, ...look} = await decodeRecipe(text);
      for (const k of ['shape', 'dither', 'palette', 'effects', 'style']) delete spec[k];
      for(const key of LOOK_KEYS)if(key!=='uniforms'&&key in look)spec[key]=look[key];
      spec.uniforms = {...spec.uniforms, ...uniforms};
    }
    await host.call('saveSpec', {name, spec});
    e.target.value = ''; toast('Look applied'); openDrawer(name);
  } catch (error) { fail(error); }
});
$('#drawer-delete').addEventListener('click', async () => {
  const name = editing, w = item(name);
  if (!confirm(`Delete ${w.title}? Its file and media are removed.`)) return;
  await closeDrawer();
  host.call('remove', {name}).then(update).then(() => toast(`Deleted ${w.title}`)).catch(fail);
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && editing) closeDrawer(); });

// ---- Pause and settings
$('#pause').addEventListener('click', () => host.call('pause', {paused: !state.paused}).then(update).catch(fail));
$('#open-settings').addEventListener('click', () => {
  $('#autostart').checked = state.autostart;
  $('#clicks').checked = !!state.options.clicks;
  for (const key of ['fps', 'idleFps', 'quality', 'pointer']) {
    const input = $('#' + key); input.value = state.options[key]; input.nextElementSibling.value = input.value;
  }
  $('#version').textContent = `asciipaper ${state.version}`;
  $('#settings').showModal();
});
$('#autostart').addEventListener('change', e => host.call('setAutostart', {on: e.target.checked}).then(update).catch(fail));
$('#clicks').addEventListener('change', e => host.call('setOptions', {options: {clicks: e.target.checked}}).then(update).catch(fail));
for (const key of ['fps', 'idleFps', 'quality', 'pointer']) {
  const input = $('#' + key);
  input.addEventListener('input', () => { input.nextElementSibling.value = input.value; });
  input.addEventListener('change', () => host.call('setOptions', {options: {[key]: +input.value}}).then(update).catch(fail));
}
// Speed: the calm control, right under the wallpaper. Previews follow it live; the desktop on release.
const speedInput = $('#speed'), previews = () => ['#now-preview', '#drawer-preview'].map(id => $(id)?.contentWindow?.asciipaper).filter(Boolean);
speedInput.addEventListener('input', () => {
  speedInput.nextElementSibling.value = (+speedInput.value).toFixed(2);
  for (const live of previews()) live.set({speed: +speedInput.value});
});
speedInput.addEventListener('change', () => host.call('setOptions', {options: {speed: +speedInput.value}}).then(update).catch(fail));
for (const id of ['#now-preview', '#drawer-preview'])
  $(id).addEventListener('load', e => e.target.contentWindow?.asciipaper?.set({speed: state.options?.speed ?? 1}));
$('#open-folder').addEventListener('click', () => host.call('openFolder').catch(fail));

host.on('state', update);
host.call('state').then(update).catch(fail);

// Only the preview the user can see gets animation time. Parent visibility is
// propagated explicitly because iframe visibility alone doesn't stop its rAF.
function syncPreviews() {
  if(document.hidden || window.paperNativeHidden)$('#thumbnailer').replaceChildren();
  for (const id of ['now-preview','drawer-preview']) {
    const frame = $('#' + id), drawer = $('#drawer').classList.contains('open');
    const paused = window.paperNativeHidden || document.hidden || state?.paused || (id === 'now-preview' && drawer) || (id === 'drawer-preview' && !drawer);
    const cap=window.paperEnergyCap||60;
    frame.contentWindow?.asciipaper?.set({...state?.options, fps:Math.min(cap,state?.options.fps||24),idleFps:Math.min(cap,state?.options.idleFps||12),paused});
  }
}
for (const id of ['now-preview','drawer-preview']) $('#' + id).addEventListener('load',syncPreviews);
document.addEventListener('visibilitychange',syncPreviews);
window.paperEnergy = cap => {window.paperEnergyCap=cap;syncPreviews();};
window.paperVisibility = hidden => { window.paperNativeHidden=hidden;syncPreviews(); };
async function saveFile(name,mime,blob) { return host.call('saveFile',{name,mime,data:await PaperProject.base64(blob)}); }
async function editingProject() {
  if (window.paperPortable) return paperPortable.projectOf(editing);
  const w=item(editing); return PaperProject.pack(await (await fetch(w.spec,{cache:'no-store'})).json(),w.spec);
}
$('#import-project').addEventListener('click',()=>{
  const input=document.createElement('input'); input.type='file'; input.accept='.asciipaper.json,application/json';
  input.onchange=async ()=>{try{const f=input.files[0];if(!f)return;if(f.size>90*1024*1024)throw new Error('Project is too large');update(await host.call('importProject',{project:PaperProject.validate(JSON.parse(await f.text()))}));toast('Project imported');}catch(e){fail(e);}};input.click();
});
$('#drawer-project').addEventListener('click',async ()=>{try{const p=await editingProject();await saveFile(`${editing}.asciipaper.json`,'application/json',new Blob([JSON.stringify(p)]));toast('Project saved');}catch(e){fail(e);}});
$('#drawer-html').addEventListener('click',async ()=>{try{
  const p=await editingProject();let html=PaperProject.html(p);
  const runtime=await (await fetch(new URL('lib/asciipaper.js',WP))).text();
  let loader='';
  if(p.spec.scene){
    let legacy=await (await fetch(new URL('lib/legacy.js',WP))).text();
    for(const name of ['asciify-core.js','fluid-field.js']){
      const source=await (await fetch(new URL('lib/'+name,WP))).text();
      legacy=legacy.replace(`'./${name}'`,JSON.stringify('data:text/javascript;base64,'+await PaperProject.base64(new Blob([source]))));
    }
    loader='window.__asciipaperLegacyURL='+JSON.stringify('data:text/javascript;base64,'+await PaperProject.base64(new Blob([legacy])))+';';
  }
  html=html.replace('<script src="./lib/asciipaper.js"></script>',`<script>${loader}${runtime.replace(/<\/script/gi,'<\\/script')}</script>`);
  await saveFile(`${editing}.html`,'text/html',new Blob([html]));toast('HTML saved');
}catch(e){fail(e);}});
$('#drawer-image').addEventListener('click',async ()=>{try{const live=$('#drawer-preview').contentWindow?.asciipaper;if(!live)throw new Error('Preview is still loading');const blob=await PaperProject.pngWithRecipe(await live.capture(),await encodeRecipe(item(editing)));await saveFile(`${editing}.png`,'image/png',blob);}catch(e){fail(e);}});
$('#drawer-record').addEventListener('click',async ()=>{
  const button=$('#drawer-record');
  try {
    const c=$('#drawer-preview').contentDocument.querySelector('canvas');
    if(!c?.captureStream || typeof MediaRecorder==='undefined')throw new Error('Video recording is unavailable in this system WebView; save a project and record it on desktop');
    button.disabled=true;
    const mime=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/mp4'].find(m=>MediaRecorder.isTypeSupported(m));
    if(!mime)throw new Error('No video encoder available');
    const stream=c.captureStream(Math.min(30,state.options.fps)),recorder=new MediaRecorder(stream,{mimeType:mime}),chunks=[];
    recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
    const done=new Promise((ok,no)=>{recorder.onstop=ok;recorder.onerror=e=>no(e.error||new Error('Recording failed'));});
    recorder.start();toast('Recording 5 seconds…');setTimeout(()=>recorder.state!=='inactive'&&recorder.stop(),5000);
    try{await done;}finally{stream.getTracks().forEach(t=>t.stop());}
    await saveFile(`${editing}.${mime.startsWith('video/mp4')?'mp4':'webm'}`,mime.split(';')[0],new Blob(chunks,{type:mime}));
  }catch(e){fail(e);}finally{button.disabled=false;}
});
})().catch(error => { document.querySelector('#now-name').textContent = 'Could not open library'; document.querySelector('#now-hint').textContent = error.message; });

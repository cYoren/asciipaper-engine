// The asciipaper Studio: choose, port, customize. Runs inside the Windows app (WebView2), which
// answers `host.call(method, params)` and serves everything from one origin: /app/ (this page,
// wallpapers/) and /library/ (the user's wallpapers). ?mock uses a fake host, for development.
'use strict';

const $ = s => document.querySelector(s);
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

let state = null, editing = null, saveTimer = 0;

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
    'It lives behind your desktop icons, and pauses by itself while a window covers the screen.';

  const gallery = $('#gallery');
  gallery.replaceChildren(...state.library.map(w => {
    const card = document.createElement('div');
    card.className = 'card' + (w.name === state.current ? ' current' : '');
    card.role = 'listitem'; card.tabIndex = 0; card.title = `Put ${w.title} on your desktop`;
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
    const apply = () => host.call('apply', {name: w.name}).then(update).then(() => toast(`${w.title} is on your desktop`)).catch(fail);
    card.addEventListener('click', apply);
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); apply(); } });
    return card;
  }));
  queueThumbnails();
}

function update(next) { state = next; render(); if (editing && !item(editing)) closeDrawer(); }

// ---- Thumbnails: render each wallpaper once, off to the side, and keep a snapshot.
let thumbnailing = false;
async function queueThumbnails() {
  if (thumbnailing) return;
  thumbnailing = true;
  try {
    for (const w of state.library.filter(w => !w.thumb && w.kind !== 'html')) {
      const frame = Object.assign(document.createElement('iframe'), {src: withParam(w.url, 'thumbnail=1')});
      $('#thumbnailer').replaceChildren(frame);
      await new Promise(r => setTimeout(r, 2600));
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
    toast(`${spec.title} is on your desktop. Customize it any time.`);
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
  const name = await ask('New shader wallpaper', 'Opens a GLSL file in your editor. Every save shows on your desktop.', 'my-wallpaper');
  if (name) host.call('newShader', {name}).then(update).catch(fail);
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

async function openDrawer(name) {
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
    const glsl = await (await fetch('/app/wallpapers/lib/media.glsl')).text();
    defaults = JSON.parse(glsl.split('\n', 1)[0].slice(12));
  }
  $('#drawer-title').textContent = `Customize ${w.title}`;
  $('#drawer-delete').hidden = !w.own;
  const preview = $('#drawer-preview');
  preview.src = w.url;
  const get = c => c.key.startsWith('u.') ? (spec.uniforms?.[c.key.slice(2)] ?? defaults[c.key.slice(2)] ?? c.fallback) : (spec[c.key] ?? c.fallback);
  const set = (c, value) => {
    if (c.key.startsWith('u.')) (spec.uniforms ||= {})[c.key.slice(2)] = value; else spec[c.key] = value;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      await host.call('saveSpec', {name, spec}).catch(fail);
      const live = preview.contentWindow?.asciipaper;
      if (!live || !(await live.patch(w.spec).catch(() => false))) preview.src = w.url;
    }, 160);
  };
  const media = !!(spec.media || spec.shader === 'media');
  $('#controls').replaceChildren(...CONTROLS.filter(c => media || !c.media).map(c => {
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
      if (!entries.some(([, v]) => v === value)) entries.push(['Custom', value]);
      for (const [label, v] of entries) select.append(new Option(label, JSON.stringify(v), false, v === value));
      select.addEventListener('change', () => set(c, JSON.parse(select.value)));
      row.append(select);
    }
    return row;
  }));
  $('#drawer').classList.add('open'); $('#drawer').setAttribute('aria-hidden', 'false');
}
function closeDrawer() {
  editing = null;
  $('#drawer').classList.remove('open'); $('#drawer').setAttribute('aria-hidden', 'true');
  $('#drawer-preview').src = 'about:blank';
  host.call('state').then(update).catch(() => {});   // thumbnails may be stale now
}
$('#drawer-close').addEventListener('click', closeDrawer);
$('#now-customize').addEventListener('click', () => openDrawer(state.current));
$('#drawer-delete').addEventListener('click', async () => {
  const name = editing, w = item(name);
  if (!confirm(`Delete ${w.title}? Its file and media are removed.`)) return;
  closeDrawer();
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
$('#open-folder').addEventListener('click', () => host.call('openFolder').catch(fail));

host.on('state', update);
host.call('state').then(update).catch(fail);

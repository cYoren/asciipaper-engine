// Portable projects contain data, never HTML or external file references.
// This module also runs under Node for format/conformance tests.
(function(root) {
  'use strict';
  const FORMAT = 'asciipaper.project', VERSION = 1, MAX_MEDIA = 64 * 1024 * 1024;
  const copy = x => JSON.parse(JSON.stringify(x));
  function validate(input) {
    const p = copy(input);
    if (p.format !== FORMAT || p.version !== VERSION) throw new Error('Unsupported ASCII Paper project version');
    if (!p.spec || typeof p.spec !== 'object' || Array.isArray(p.spec)) throw new Error('Missing wallpaper spec');
    const s = p.spec;
    if (typeof s.shader !== 'string' || !/\bcell\s*\(/.test(s.shader) || s.shader.length > 256 * 1024)
      throw new Error('A project needs its GLSL cell shader embedded');
    for (const [k, min, max] of [['cell',1,128],['aspect',.1,4],['maxCells',1,100000],['fill',0,1],['weight',100,900],['period',.001,1e8],['time',-1e8,1e8]])
      if (k in s && (typeof s[k] !== 'number' || !Number.isFinite(s[k]) || s[k] < min || s[k] > max)) throw new Error(`Invalid ${k}`);
    if (s.charset != null && (typeof s.charset !== 'string' || !s.charset.length || [...s.charset].length > 256)) throw new Error('Use 1 to 256 characters');
    if (s.background != null && !/^#[a-f\d]{6}$/i.test(s.background)) throw new Error('Invalid background colour');
    if (s.palette != null && (!Array.isArray(s.palette) || s.palette.length > 16 || s.palette.some(c => !/^#[a-f\d]{6}$/i.test(c)))) throw new Error('Invalid palette');
    for (const k of ['uniforms', 'effects']) if (s[k] != null && (typeof s[k] !== 'object' || Array.isArray(s[k]))) throw new Error(`Invalid ${k}`);
    for(const [key,value] of Object.entries(s.uniforms||{})){
      if(!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key))throw new Error('Invalid uniform name');
      const valid=typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)||typeof value==='string'&&/^#[a-f\d]{6}$/i.test(value)||Array.isArray(value)&&value.length>=1&&value.length<=4&&value.every(n=>typeof n==='number'&&Number.isFinite(n));
      if(!valid)throw new Error('Invalid uniform '+key);
    }
    if(s.scene!=null&&!['fluid','flow','matrix','yin-yang'].includes(s.scene))throw new Error('Unknown simulation scene');
    if (p.media != null) {
      const m = p.media;
      if (typeof m.name !== 'string' || !/^[a-z\d][a-z\d._-]{0,127}$/i.test(m.name) || m.name.includes('..')) throw new Error('Invalid media name');
      if (!/^(image|video)\/[a-z\d.+-]+$/i.test(m.mime)) throw new Error('Invalid media type');
      if (typeof m.data !== 'string' || m.data.length > Math.ceil(MAX_MEDIA / 3) * 4 || m.data.length % 4 || /[^A-Za-z0-9+/=]/.test(m.data)) throw new Error('Invalid media data (maximum 64 MiB)');
      const padding=m.data.indexOf('=');
      if(padding>=0&&(padding<m.data.length-2||!/^={1,2}$/.test(m.data.slice(padding))))throw new Error('Invalid base64 padding');
      s.media = 'media/' + m.name;
    } else if (s.media) throw new Error('The project is missing its media');
    delete s.frames; // platform caches are regenerated, never shared
    p.title = String(p.title || s.title || 'Wallpaper').slice(0, 128);
    return p;
  }
  function create(spec, media = null) { return validate({format: FORMAT, version: VERSION, title: spec.title, spec, media}); }
  function bytes(base64) { return Uint8Array.from(atob(base64), c => c.charCodeAt(0)); }
  async function base64(blob) {
    const a = new Uint8Array(await blob.arrayBuffer());
    let text = '';
    for (let i = 0; i < a.length; i += 32768) text += String.fromCharCode(...a.subarray(i, i + 32768));
    return btoa(text);
  }
  async function pack(spec, base) {
    const s = copy(spec), url = new URL(base, location.href);
    if (!/\bcell\s*\(/.test(s.shader || '')) {
      const shader = s.shader === 'media' || (!s.shader && s.media) ? new URL('../wallpapers/lib/media.glsl', location.href) : new URL(s.shader, url);
      const r = await fetch(shader); if (!r.ok) throw new Error('Missing shader: '+shader.href+' (status '+r.status+')'); s.shader = await r.text();
    }
    const catalog = await (await fetch(new URL('../wallpapers/lib/looks.json', location.href))).json();
    if (s.charset in catalog.charsets) s.charset = catalog.charsets[s.charset];
    if (typeof s.palette === 'string') s.palette = catalog.palettes[s.palette] || [];
    let media = null;
    if (s.media) {
      const r = await fetch(new URL(s.media, url)); if (!r.ok) throw new Error('Missing media');
      const blob = await r.blob(); if (blob.size > MAX_MEDIA) throw new Error('Maximum media size is 64 MiB');
      const name = s.media.split('/').pop().replace(/[^a-z\d._-]/gi, '_');
      media = {name: /^[a-z\d]/i.test(name) ? name : 'media-' + name, mime: blob.type || 'video/mp4', data: await base64(blob)};
    }
    return create(s, media);
  }
  async function pngWithRecipe(blob, code) {
    const png=new Uint8Array(await blob.arrayBuffer());
    if(png.length<20||png[0]!==137||png[1]!==80)throw new Error('Invalid PNG');
    const text=new TextEncoder().encode('asciipaperRecipe\0'+code),chunk=new Uint8Array(text.length+12),view=new DataView(chunk.buffer);
    view.setUint32(0,text.length);chunk.set([116,69,88,116],4);chunk.set(text,8);
    let crc=0xffffffff;
    for(const b of chunk.subarray(4,8+text.length)){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
    view.setUint32(chunk.length-4,(crc^0xffffffff)>>>0);
    return new Blob([png.subarray(0,png.length-12),chunk,png.subarray(png.length-12)],{type:'image/png'});
  }
  function html(project) {
    const p = validate(project), runtime = copy(p.spec);
    runtime.glsl = runtime.shader; delete runtime.shader;
    const first = runtime.glsl.split('\n')[0];
    runtime.uniforms = {...(first.startsWith('// defaults:') ? JSON.parse(first.slice(12)) : {}), ...runtime.uniforms};
    runtime.media = !!p.media;
    const media = !p.media ? '' : p.media.mime.startsWith('image/')
      ? `<img id="asciipaper-media" src="data:${p.media.mime};base64,${p.media.data}" hidden>`
      : `<video id="asciipaper-media" src="data:${p.media.mime};base64,${p.media.data}" autoplay loop muted playsinline hidden></video>`;
    return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;height:100%;overflow:hidden;background:#000}</style><script src="./lib/asciipaper.js"></script>${media}<script>asciipaper.spec(${JSON.stringify(runtime).replace(/</g,'\\u003c')});</script>`;
  }
  const api = {FORMAT, VERSION, MAX_MEDIA, validate, create, pack, html, bytes, base64, pngWithRecipe};
  if (typeof module !== 'undefined') module.exports = api; else root.PaperProject = api;
})(globalThis);

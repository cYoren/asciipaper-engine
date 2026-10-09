// The same Studio runs in a browser, Android WebView, and Apple WKWebView.
// Native hosts only implement platform actions; IndexedDB owns the portable library.
window.portableReady = (async () => {
  'use strict';
  if (window.chrome?.webview || window.mockHost) return;
  const WP = new URL('../wallpapers/', location.href), P = PaperProject;
  const native = async (method, params) => {
    if (window.AndroidPaper) return JSON.parse(await AndroidPaper.call(method,JSON.stringify(params)));
    if (window.webkit?.messageHandlers?.paper) return window.webkit.messageHandlers.paper.postMessage({method,params});
    return null;
  };
  const apple=!!window.webkit?.messageHandlers?.paper;
  let db;
  if(!apple){
    const open = indexedDB.open('asciipaper-library', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('projects');
    db = await new Promise((ok,no) => { open.onsuccess = () => ok(open.result); open.onerror = () => no(open.error); });
  }
  const transact = (mode, fn) => apple ? fn({
    getAll:()=>native('loadLibrary',{}),put:record=>native('saveProject',record),delete:name=>native('removeProject',{name})
  }) : new Promise((ok,no) => {
    const tx = db.transaction('projects', mode), req = fn(tx.objectStore('projects'));
    tx.oncomplete = () => ok(req.result); tx.onerror = () => no(tx.error); tx.onabort = () => no(tx.error || new Error('Storage aborted'));
  });
  const projects = new Map(), urls = new Map(), listeners = {};
  const persisted=apple ? await native('loadState',{}) : {};
  const getSetting = key => {if(key in persisted)return persisted[key];try{return localStorage.getItem(key);}catch(_){return null;}};
  const setSetting = (key,value) => {persisted[key]=value;if(apple)native('saveState',persisted).catch(console.error);else try{localStorage.setItem(key,value);}catch(_){}};
  const options = {...{fps:24,idleFps:12,quality:1,pointer:1,clicks:false}, ...JSON.parse(getSetting('options') || '{}')};
  const state = {current:getSetting('current') || 'synthwave', paused:getSetting('paused')==='true', autostart:false, version:'1.2.0', options, library:[]};
  const builtins = await (await fetch(new URL('catalog.json', WP))).json();
  for (const w of builtins) state.library.push({...w, own:false, url:new URL(w.url, WP).href, spec:w.spec ? new URL(w.spec, WP).href : null, thumb:new URL(`thumbnails/${w.name}.jpg`, WP).href});
  const saved = await transact('readonly', s => s.getAll());
  const revoke = name => { for (const u of urls.get(name) || []) URL.revokeObjectURL(u); urls.delete(name); };
  function materialize(name, project) {
    revoke(name);
    const p = P.validate(project), s = structuredClone(p.spec), allocated = [];
    const blob = (data,type) => { const u = URL.createObjectURL(new Blob([data], {type})); allocated.push(u); return u; };
    if (p.media) { s.media = blob(P.bytes(p.media.data), p.media.mime); s.mediaType = p.media.mime; }
    const spec = blob(JSON.stringify(s), 'application/json');
    urls.set(name, allocated); projects.set(name,p);
    const w = {name,title:p.title,own:true,kind:'spec',spec,url:new URL('run.html', WP).href+'?spec='+encodeURIComponent(spec),thumb:null};
    const i = state.library.findIndex(x => x.name === name); if (i >= 0) state.library[i] = w; else state.library.push(w);
  }
  for (const record of saved) materialize(record.name, record.project);
  if (!state.library.some(w => w.name === state.current)) state.current = 'synthwave';
  const snapshot = () => structuredClone(state);
  const freshName = title => { const stem = title.toLowerCase().replace(/[^a-z0-9_-]/g,'-').slice(0,40) || 'wallpaper'; let n=stem,i=1; while (state.library.some(w=>w.name===n)) n=stem+'-'+ ++i; return n; };
  async function store(name,p) { p=P.validate(p); await transact('readwrite',s=>s.put({name,project:p},name)); materialize(name,p); return p; }
  async function projectOf(name) {
    if (projects.has(name)) return structuredClone(projects.get(name));
    const w = state.library.find(w=>w.name===name);
    if (!w?.spec) throw new Error('This scene is available for playback; portable editing needs a shader spec');
    return P.pack(await (await fetch(w.spec)).json(),w.spec);
  }
  async function apply(name) {
    const w = state.library.find(w=>w.name===name); if (!w) throw new Error('Unknown wallpaper');
    if (window.AndroidPaper || window.webkit?.messageHandlers?.paper) {
      const project = w.spec ? await projectOf(name) : null;
      const result = await native('apply',{name,project,url:w.url});
      if (result?.error) throw new Error(result.error);
      await native('options',options);await native('pause',{paused:state.paused});
    }
    state.current=name; setSetting('current',name); return snapshot();
  }
  async function importFile(file) {
    if (file.size > P.MAX_MEDIA) throw new Error('Maximum media size is 64 MiB');
    if (/\.asciipaper\.json$/i.test(file.name) || file.type === 'application/json') return methods.importProject({project:JSON.parse(await file.text())});
    if (!/^(image|video)\//.test(file.type)) throw new Error('Choose an image, GIF or video');
    const name=freshName(file.name.replace(/\.[^.]+$/,'')), shader=await (await fetch(new URL('lib/media.glsl',WP))).text();
    const p=P.create({title:file.name,shader,media:'media/media',cell:8,aspect:.55,charset:' .:-=+*#%@'}, {name:'source'+(file.name.match(/\.[a-z0-9]+$/i)?.[0] || '.bin'),mime:file.type,data:await P.base64(file)});
    await store(name,p); await apply(name); listeners.state?.(snapshot());
    return null; // import is complete; Studio's desktop measurement path isn't needed
  }
  const pick = accept => new Promise(ok => { const input=document.createElement('input'); input.type='file'; input.accept=accept; input.onchange=()=>ok(input.files[0]||null); input.oncancel=()=>ok(null); input.click(); });
  async function editShader(initial) {
    const dialog=document.createElement('dialog'),form=document.createElement('form');form.method='dialog';
    const heading=Object.assign(document.createElement('h2'),{textContent:'GLSL shader'});
    const code=Object.assign(document.createElement('textarea'),{value:initial,rows:16,spellcheck:false});code.style.cssText='width:100%;font:12px monospace';
    const cancel=Object.assign(document.createElement('button'),{textContent:'Cancel',value:'cancel'}),save=Object.assign(document.createElement('button'),{textContent:'Save shader',value:'save'});
    form.append(heading,code,cancel,save);dialog.append(form);document.body.append(dialog);dialog.showModal();
    return new Promise(ok=>dialog.addEventListener('close',()=>{ok(dialog.returnValue==='save'?code.value:null);dialog.remove();},{once:true}));
  }
  const methods = {
    state:snapshot, apply:({name})=>apply(name), pause:async ({paused})=>{state.paused=paused;setSetting('paused',String(paused));await native('pause',{paused});return snapshot();},
    setOptions:async ({options:next})=>{Object.assign(options,next);setSetting('options',JSON.stringify(options));await native('options',options);return snapshot();},
    setAutostart:()=>{throw new Error('Manage startup in your system settings');},
    openFolder:()=>{throw new Error('Use Import project and Save project to manage portable files');},
    saveThumb:({name,data})=>{const w=state.library.find(w=>w.name===name);if(w)w.thumb=data;return data;},
    copyBuiltin:async ({name})=>{const p=await projectOf(name),n=freshName(name+'-mine');await store(n,p);return {name:n,state:snapshot()};},
    saveSpec:async ({name,spec})=>{const old=projects.get(name);const s=structuredClone(spec);if(old?.media)s.media='media/'+old.media.name;await store(name,P.create(s,old?.media||null));if(state.current===name)await apply(name);return true;},
    remove:async ({name})=>{if(!projects.has(name))throw new Error('Built-in wallpapers cannot be deleted');await transact('readwrite',s=>s.delete(name));projects.delete(name);revoke(name);state.library=state.library.filter(w=>w.name!==name);if(state.current===name)await apply('synthwave');return snapshot();},
    pickMedia:async ()=>{const f=await pick('image/*,video/*');if(f)await importFile(f);return null;},
    importUrl:async ({url})=>{
      let b;
      if(window.AndroidPaper||apple){const r=await native('downloadURL',{url});if(r?.error)throw new Error(r.error);b=new Blob([P.bytes(r.data)],{type:r.mime});}
      else{const r=await fetch(url);if(!r.ok)throw new Error('Download failed');b=await r.blob();}
      const ext=b.type==='image/jpeg'?'.jpg':'.'+b.type.split('/')[1].replace(/[^a-z0-9]/gi,'');
      const name=new URL(url).pathname.split('/').pop()||'media'+ext;
      await importFile(new File([b],/\.[a-z0-9]+$/i.test(name)?name:name+ext,{type:b.type}));return null;
    },
    importProject:async ({project})=>{const p=P.validate(project),name=freshName(p.title);await store(name,p);return apply(name);},
    newShader:async ({name})=>{const shader=await editShader(await (await fetch(new URL('starter.glsl',WP))).text());if(!shader)return snapshot();const n=freshName(name);await store(n,P.create({title:name,shader}));return apply(n);},
    saveFile:async ({name,mime,data})=>{
      if(window.AndroidPaper || window.webkit?.messageHandlers?.paper){const result=await native('saveFile',{name,mime,data});if(result?.error)throw new Error(result.error);return true;}
      const u=URL.createObjectURL(new Blob([P.bytes(data)],{type:mime}));const a=Object.assign(document.createElement('a'),{href:u,download:name});a.click();setTimeout(()=>URL.revokeObjectURL(u),60000);return true;
    },
    exportZip:()=>{throw new Error('Use Save project or Save HTML on this platform');},
  };
  window.mockHost={call:async (m,p={})=>{if(!methods[m])throw new Error(`Unsupported action: ${m}`);return methods[m](p);},files:async (m,files)=>{if(m==='importDropped'&&files[0])return importFile(files[0]);throw new Error('No file selected');},on:(e,fn)=>listeners[e]=fn};
  window.paperPortable={projectOf, native};
})();

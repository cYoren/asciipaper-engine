// Browser conformance without npm dependencies. Runs only against a temporary
// Chromium profile and a loopback server; never touches the user's library.
import {createServer} from 'node:http';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {resolve,dirname,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const profile=await mkdtemp(resolve(tmpdir(),'paper-studio-'));
const mime={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.glsl':'text/plain','.jpg':'image/jpeg'};
const server=createServer(async(req,res)=>{try{const p=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!p.startsWith(root+sep))throw Error('Bad path');const data=await readFile(p);res.setHeader('Content-Type',mime[extname(p)]||'application/octet-stream');res.end(data);}catch(_){res.writeHead(404);res.end();}});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const entry=`http://127.0.0.1:${server.address().port}/studio/index.html`;
const probe=await fetch(entry);if(!probe.ok||!probe.headers.get('content-type')?.includes('text/html'))throw Error('Local asset server failed '+root+' '+probe.status+' '+probe.headers.get('content-type'));
let browser,ws;
try{
  let base=process.env.PAPER_CDP_ENDPOINT;
  if(!base){
  browser=spawn(process.env.CHROMIUM||'chromium',['--headless','--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--remote-debugging-port=0','--user-data-dir='+profile,entry],{stdio:['ignore','ignore','pipe']});
  const endpoint=await new Promise((ok,no)=>{let log='';const t=setTimeout(()=>no(Error('Chromium startup timed out')),15000);browser.stderr.on('data',b=>{log+=b;const m=log.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(t);ok(m[1]);}});browser.on('error',no);});
  base='http://'+new URL(endpoint).host;
  }
  const pages=await (await fetch(base+'/json/list')).json();
  const page=pages.find(p=>p.type==='page'&&!p.url.startsWith('chrome-extension:'));
  if(!page)throw Error('No test page found');
  ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok,no)=>{ws.onopen=ok;ws.onerror=no;});let seq=0;const pending=new Map(),errors=[];
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}else if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);};
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
  const wait=async expression=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out: '+expression+' '+JSON.stringify({errors,page:await evaluate('({url:location.href,html:document.documentElement.outerHTML.slice(0,1400)})')}));};
  await call('Runtime.enable');await call('Page.enable');
  await wait("!!window.paperPortable && document.querySelectorAll('.card').length>=11");
  await wait("!!document.querySelector('#now-preview').contentWindow.asciipaper?.capture");
  const result=await evaluate(`(async()=>{
    const host=window.mockHost;
    const p=await paperPortable.projectOf('synthwave');p.title='Roundtrip project';p.spec.effects={crt:.3};p.spec.shader='vec4 cell(vec2 uv){return vec4(uv.x,uv.y,0.5,1.0);}';
    const state=await host.call('importProject',{project:p});
    const saved=await paperPortable.projectOf(state.current);
    if(saved.spec.effects.crt!==.3||!saved.spec.shader.includes('cell('))throw Error('Project fields were lost');
    const frame=document.querySelector('#now-preview');frame.src=state.library.find(w=>w.name===state.current).url;
    await new Promise(ok=>frame.onload=ok);
    for(let i=0;i<50&&!frame.contentDocument.querySelector('canvas');i++)await new Promise(ok=>setTimeout(ok,100));
    frame.contentWindow.asciipaper.set({paused:false});
    document.querySelectorAll('.card .edit')[7]?.focus();
    const blob=await document.querySelector('#now-preview').contentWindow.asciipaper.capture();
    const bitmap=await createImageBitmap(blob),c=document.createElement('canvas');c.width=bitmap.width;c.height=bitmap.height;const g=c.getContext('2d');g.drawImage(bitmap,0,0);const pixels=g.getImageData(0,0,c.width,c.height).data;
    if(!pixels.some((v,i)=>i%4!==3&&v>30))throw Error('Captured image is blank');
    return {name:state.current,imageBytes:blob.size,projectBytes:JSON.stringify(saved).length};
  })()`);
  await call('Page.reload');await wait("!!window.paperPortable && document.querySelector('#now-name').textContent==='Roundtrip project'");
  await wait("!!document.querySelector('#now-preview').contentWindow.asciipaper?.capture");
  await evaluate("window.paperVisibility(true)");
  const paused=await evaluate("document.querySelector('#now-preview').contentWindow.asciipaper.options.paused");if(!paused)throw Error('Hidden Studio kept drawing');
  // A late iframe load must preserve the native host's hidden state.
  await evaluate("(async()=>{const frame=document.querySelector('#now-preview');await new Promise(ok=>{frame.addEventListener('load',ok,{once:true});frame.contentWindow.location.reload();});})()");
  await wait("!!document.querySelector('#now-preview').contentWindow.asciipaper?.capture");
  await wait("document.querySelector('#now-preview').contentWindow.asciipaper.options.paused");
  if(errors.length)throw Error(errors.join('\n'));
  console.log('PASS Studio project persistence, WebGL capture and visibility',JSON.stringify(result));
  if(process.env.PAPER_CDP_ENDPOINT){
    // Host integration persists complete native specs for every built-in scene.
    for(const name of ['fluid','flow','matrix','yin-yang','synthwave'])await evaluate(`window.mockHost.call('apply',{name:${JSON.stringify(name)}})`);
    console.log('PASS Android bridge accepts all four shared native scenes and shader projects');
    if(process.env.ANDROID_SERIAL){
      if(!/^emulator-\d+$/.test(process.env.ANDROID_SERIAL))throw Error('Native smoke tests require an emulator');
      const adb=(...args)=>execFileSync(process.env.ADB||'adb',['-s',process.env.ANDROID_SERIAL,...args],{encoding:'utf8',timeout:30000});
      adb('logcat','-c');
      await evaluate("window.paperPortable.native('wallpaper',{})");
      await new Promise(r=>setTimeout(r,4000));
      for(const name of ['fluid','flow','matrix','yin-yang','donut','fire','ocean','plasma','starfield','synthwave','tunnel']){
        await evaluate(`window.mockHost.call('apply',{name:${JSON.stringify(name)}})`);
        let dump='';
        for(let i=0;i<20;i++){
          await new Promise(r=>setTimeout(r,250));
          dump=adb('shell','dumpsys','activity','service','io.github.cyoren.asciipaper/.WallpaperService');
          if(/asciipaper frames=[1-9]\d* drawing=true/.test(dump))break;
        }
        if(!/asciipaper frames=[1-9]\d* drawing=true/.test(dump))throw Error('Native scene did not draw: '+name+' '+dump.slice(-1500));
      }
      const shader=await readFile(resolve(root,'wallpapers/lib/media.glsl'),'utf8');
      const fixtures=[
        {name:'source.png',mime:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAAA1BMVEX/AAAZ4gk3AAAAC0lEQVQI12NgQAUAABAAAaHFIcEAAAAASUVORK5CYII='},
        {name:'source.gif',mime:'image/gif',data:'R0lGODlhCAAIAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQAFAAAACwAAAAACAAIAAACB4SPqcvtXQAAIfkEABQAAAAsAAAAAAgACACAAAD/AAAAAgeEj6nL7V0AADs='},
        {name:'source.mp4',mime:'video/mp4',data:(await readFile(resolve(root,'assets/demo.mp4'))).toString('base64')}
      ];
      for(const media of fixtures){
        const project={format:'asciipaper.project',version:1,title:media.name,spec:{shader,media:'media/'+media.name},media};
        await evaluate(`window.mockHost.call('importProject',{project:${JSON.stringify(project)}})`);
        let dump='';
        for(let i=0;i<30;i++){
          await new Promise(r=>setTimeout(r,250));
          dump=adb('shell','dumpsys','activity','service','io.github.cyoren.asciipaper/.WallpaperService');
          if(/mediaFrames=[1-9]\d*/.test(dump))break;
        }
        if(!/asciipaper frames=[1-9]\d* drawing=true/.test(dump)||!/mediaFrames=[1-9]\d*/.test(dump))throw Error('Media did not decode and draw: '+media.name+' '+dump.slice(-1500));
      }
      const log=adb('logcat','-d','-s','asciipaper:E','AndroidRuntime:E','DEBUG:E');
      if(/can't draw|shader:|link:|Cannot load media|Video decode error|FATAL EXCEPTION|Fatal signal/.test(log))throw Error(log.slice(-4000));
      adb('shell','input','keyevent','KEYCODE_HOME');await new Promise(r=>setTimeout(r,500));
      if(/asciipaper frames=\d+ drawing=true/.test(adb('shell','dumpsys','activity','service','io.github.cyoren.asciipaper/.WallpaperService')))throw Error('Native preview kept drawing after leaving');
      console.log('PASS all 11 native scenes, PNG/GIF/video media and hidden-engine pause');
    }
  }
}finally{ws?.close();if(browser){browser.kill('SIGTERM');await new Promise(ok=>{browser.once('exit',ok);setTimeout(ok,3000);});}await new Promise(ok=>server.close(ok));await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:300});}

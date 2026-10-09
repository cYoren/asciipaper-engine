import Foundation
import WebKit
import Darwin

// Runs only when explicitly requested by CI, with an isolated project library.
enum StudioSelfTest {
    static let enabled = ProcessInfo.processInfo.arguments.contains("--selftest")
    static let library = FileManager.default.temporaryDirectory.appendingPathComponent("paper-selftest-"+UUID().uuidString,isDirectory:true)
    // A hung step must still produce a report, naming where it stopped (CI otherwise sees nothing).
    static func watch(_ web: WKWebView) {
        DispatchQueue.main.asyncAfter(deadline:.now()+150) {
            web.evaluateJavaScript("String(window.__selftestStep || 'Studio never loaded')") { step,_ in
                finish(nil,NSError(domain:"selftest",code:1,userInfo:[NSLocalizedDescriptionKey:"Timed out at: \(step as? String ?? "unknown")"]))
            }
        }
    }
    static func run(_ web: WKWebView, attempt: Int = 0) {
        web.evaluateJavaScript("!!window.paperPortable && document.querySelectorAll('.card').length >= 11") { result,error in
            if result as? Bool != true {
                if attempt < 120 {
                    DispatchQueue.main.asyncAfter(deadline:.now()+0.5) { run(web,attempt:attempt+1) }
                } else { finish(nil,error ?? PaperError.invalidProject) }
                return
            }
            let script = """
            window.__selftestStep='project';const p=await paperPortable.projectOf('synthwave');
            p.title='Apple roundtrip';p.spec.shader='vec4 cell (vec2 uv){return vec4(uv.x,uv.y,0.5,1.0);}';p.spec.effects={crt:0.3};
            window.__selftestStep='import';const state=await mockHost.call('importProject',{project:p});
            const saved=await paperPortable.projectOf(state.current);
            if(saved.spec.effects.crt!==0.3)throw Error('Project fields were lost');
            window.__selftestStep='native library';const records=await paperPortable.native('loadLibrary',{});
            if(!records.some(r=>r.name===state.current))throw Error('Native library did not persist the project');
            const frame=document.querySelector('#now-preview');
            window.__selftestStep='preview load';await new Promise(ok=>{frame.addEventListener('load',ok,{once:true});frame.src=state.library.find(w=>w.name===state.current).url;});
            window.__selftestStep='preview ready';for(let i=0;i<100&&!frame.contentWindow.asciipaper?.ready;i++)await new Promise(ok=>setTimeout(ok,100));
            if(!frame.contentWindow.asciipaper?.ready)throw Error('Preview failed: '+frame.contentDocument.body.textContent);
            frame.contentWindow.asciipaper.set({paused:false});
            window.__selftestStep='capture';const blob=await frame.contentWindow.asciipaper.capture();
            window.__selftestStep='decode capture';const image=document.createElement('img'),url=URL.createObjectURL(blob);image.src=url;await image.decode();
            const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
            const g=canvas.getContext('2d');g.drawImage(image,0,0);
            if(!g.getImageData(0,0,canvas.width,canvas.height).data.some((v,i)=>i%4!==3&&v>30))throw Error('Captured image is blank');
            URL.revokeObjectURL(url);
            window.__selftestStep='visibility';window.paperVisibility(true);
            if(!frame.contentWindow.asciipaper.options.paused)throw Error('Hidden Studio kept drawing');
            return {ok:true,scenes:state.library.filter(w=>!w.own).length,name:state.current,image:await PaperProject.base64(blob)};
            """
            // Plain evaluateJavaScript plus polling: callAsyncJavaScript's Swift form needs libswiftWebKit,
            // which iOS 17 and 18 don't ship, and linking it made the app crash at launch there.
            let wrapped = "(async()=>{try{window.__selftestResult=JSON.stringify(await (async()=>{\(script)})())}catch(e){window.__selftestResult=JSON.stringify({ok:false,error:String(e&&e.message||e)})}})();0"
            web.evaluateJavaScript(wrapped) { _,error in
                if let error { finish(nil,error) } else { poll(web) }
            }
        }
    }
    private static func poll(_ web: WKWebView) {
        web.evaluateJavaScript("window.__selftestResult || ''") { value,_ in
            guard let text = value as? String, !text.isEmpty, let data = text.data(using:.utf8) else {
                DispatchQueue.main.asyncAfter(deadline:.now()+0.5) { poll(web) }; return
            }
            let result = (try? JSONSerialization.jsonObject(with:data)) as? [String:Any]
            finish(result, result?["ok"] as? Bool == true ? nil : NSError(domain:"selftest",code:2,userInfo:[NSLocalizedDescriptionKey:result?["error"] as? String ?? "Bad report"]))
        }
    }
    private static func finish(_ result: [String:Any]?, _ error: Error?) {
        do {
            let args=ProcessInfo.processInfo.arguments
            let index=args.firstIndex(of:"--selftest")!
            let folder=index+1<args.count ? URL(fileURLWithPath:args[index+1],isDirectory:true) : FileManager.default.urls(for:.documentDirectory,in:.userDomainMask)[0]
            try FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true)
            var report=result ?? ["ok":false,"error":error?.localizedDescription ?? "No result"]
            if let error=error as NSError? { report["details"]=error.userInfo.mapValues{String(describing:$0)} }
            if let image=report.removeValue(forKey:"image") as? String,let data=Data(base64Encoded:image) {
                try data.write(to:folder.appendingPathComponent("studio.png"))
            }
            try JSONSerialization.data(withJSONObject:report,options:[.prettyPrinted,.sortedKeys]).write(to:folder.appendingPathComponent("selftest.json"))
        } catch { fputs("Apple self-test: \(error)\n",stderr);exit(1) }
        exit(error == nil && result?["ok"] as? Bool == true ? 0 : 1)
    }
}

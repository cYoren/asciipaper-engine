import Foundation
import Combine
import WebKit
import UniformTypeIdentifiers
#if os(iOS)
import UIKit
#else
import AppKit
#endif

// Apple uses the bundled common Studio and WebKit's GPU backend. No deprecated
// OpenGL ES host, private wallpaper API, or perpetual background task is needed.
final class PaperController: NSObject, ObservableObject, WKScriptMessageHandlerWithReply, WKNavigationDelegate, WKUIDelegate {
    private let assets = PaperAssets()
    private var observers: [NSObjectProtocol] = []
    private var isVisible = true
    private var selfTestStarted = false
    lazy var web: WKWebView = {
        let config = configuration()
        config.userContentController.addScriptMessageHandler(WeakPaperBridge(self), contentWorld: .page, name: "paper")
        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = self
        view.uiDelegate = self
        #if DEBUG
        view.isInspectable = true
        #endif
        view.load(URLRequest(url: URL(string: "paper://app/studio/index.html")!))
        return view
    }()
    #if os(macOS)
    private var wallpaper: DesktopWallpaper?
    #endif
    override init() {
        super.init()
        for event in [Notification.Name.NSProcessInfoPowerStateDidChange, ProcessInfo.thermalStateDidChangeNotification] {
            observers.append(NotificationCenter.default.addObserver(forName: event, object: nil, queue: .main) { [weak self] _ in self?.energy() })
        }
    }
    deinit { for o in observers { NotificationCenter.default.removeObserver(o) } }
    private func configuration() -> WKWebViewConfiguration {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(assets, forURLScheme: "paper")
        #if os(iOS)
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        #endif
        return config
    }
    func visible(_ on: Bool) {
        isVisible = on
        web.evaluateJavaScript("window.paperVisibility?.(\(on ? "false" : "true"))", completionHandler: nil)
        if on { energy() }
    }
    private func energy() {
        let state = ProcessInfo.processInfo
        let cap = state.thermalState == .critical ? 1 : state.thermalState == .serious ? 6 : state.isLowPowerModeEnabled || state.thermalState == .fair ? 12 : 60
        web.evaluateJavaScript("window.paperEnergy?.(\(cap))", completionHandler: nil)
        #if os(macOS)
        wallpaper?.energy(cap: cap)
        #endif
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        energy();visible(isVisible)
        if StudioSelfTest.enabled && !selfTestStarted { selfTestStarted=true;StudioSelfTest.run(webView) }
    }
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let u = action.request.url else { decisionHandler(.cancel); return }
        decisionHandler(["paper", "blob", "about", "data"].contains(u.scheme ?? "") ? .allow : .cancel)
    }
    #if os(macOS)
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel=NSOpenPanel();panel.canChooseFiles=true;panel.canChooseDirectories=parameters.allowsDirectories;panel.allowsMultipleSelection=parameters.allowsMultipleSelection
        panel.begin { result in completionHandler(result == .OK ? panel.urls : nil) }
    }
    #endif
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage, replyHandler reply: @escaping (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame, message.frameInfo.request.url?.scheme == "paper",
              let body = message.body as? [String: Any], let method = body["method"] as? String,
              let p = body["params"] as? [String: Any] else { reply(nil,"Untrusted platform request"); return }
        do {
            switch method {
            case "copyText":
                guard let text=p["text"] as? String,text.count<=512*1024 else { throw PaperError.invalidProject }
                #if os(macOS)
                NSPasteboard.general.clearContents();NSPasteboard.general.setString(text,forType:.string)
                #else
                UIPasteboard.general.string=text
                #endif
                reply(true,nil)
            case "downloadURL":
                guard let text=p["url"] as? String,let url=URL(string:text),url.scheme=="https",url.user==nil else { throw PaperError.invalidProject }
                URLSession.shared.downloadTask(with:url) { file,response,error in
                    defer { if let file=file { try? FileManager.default.removeItem(at:file) } }
                    do {
                        if let error=error { throw error }
                        guard let file=file,let response=response as? HTTPURLResponse,response.statusCode==200,
                              let mime=response.mimeType,mime.hasPrefix("image/") || mime.hasPrefix("video/"),
                              let size=try file.resourceValues(forKeys:[.fileSizeKey]).fileSize,size<=64*1024*1024 else { throw PaperError.invalidProject }
                        let data=try Data(contentsOf:file).base64EncodedString()
                        DispatchQueue.main.async { reply(["mime":mime,"data":data],nil) }
                    } catch { DispatchQueue.main.async { reply(nil,error.localizedDescription) } }
                }.resume()
            case "loadState": reply(UserDefaults.standard.dictionary(forKey:"studioState") ?? [:],nil)
            case "saveState":
                let allowed=p.filter { ["current","options","paused"].contains($0.key) && $0.value is String }
                UserDefaults.standard.set(allowed,forKey:"studioState");reply(true,nil)
            case "loadLibrary": reply(try assets.loadLibrary(),nil)
            case "saveProject": try assets.saveProject(p); reply(true,nil)
            case "removeProject": try assets.removeProject(p); reply(true,nil)
            case "apply":
                #if os(macOS)
                let url: URL
                if let project = p["project"] as? [String: Any] { url = try assets.store(project) }
                else if let name = p["name"] as? String, ["fluid","flow","matrix","yin-yang"].contains(name) { url = URL(string:"paper://app/wallpapers/\(name).html")! }
                else { throw PaperError.invalidProject }
                if wallpaper == nil { wallpaper = DesktopWallpaper.shared }
                wallpaper?.show(url)
                energy()
                #endif
                // iOS selects the library item; only system Settings can set its wallpaper.
                reply([:],nil)
            case "options":
                #if os(macOS)
                wallpaper?.options(p)
                #endif
                reply([:],nil)
            case "pause":
                #if os(macOS)
                wallpaper?.options(["paused":p["paused"] as? Bool ?? false])
                #endif
                reply([:],nil)
            case "saveFile":
                guard let name = p["name"] as? String, let text = p["data"] as? String, text.count <= 128*1024*1024, let data = Data(base64Encoded:text) else { throw PaperError.invalidProject }
                export(data, name: (name as NSString).lastPathComponent, reply: reply)
            default: reply(nil,"Unsupported platform action")
            }
        } catch { reply(nil,error.localizedDescription) }
    }
    private func export(_ data: Data, name: String, reply: @escaping (Any?, String?) -> Void) {
        #if os(macOS)
        let panel = NSSavePanel(); panel.nameFieldStringValue = name
        panel.begin { result in
            guard result == .OK, let url = panel.url else { reply(false,nil); return }
            do { try data.write(to:url,options:.atomic); reply(true,nil) } catch { reply(nil,error.localizedDescription) }
        }
        #else
        do {
            let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory:true)
            try FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true)
            let url = folder.appendingPathComponent(name); try data.write(to:url,options:.atomic)
            guard let scene = UIApplication.shared.connectedScenes.first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene,
                  var presenter = scene.windows.first(where: \.isKeyWindow)?.rootViewController else { throw PaperError.invalidProject }
            while let next = presenter.presentedViewController { presenter = next }
            let share = UIActivityViewController(activityItems:[url],applicationActivities:nil)
            share.popoverPresentationController?.sourceView = presenter.view
            share.popoverPresentationController?.sourceRect = CGRect(x:presenter.view.bounds.midX,y:presenter.view.bounds.midY,width:1,height:1)
            share.completionWithItemsHandler = { _,completed,_,error in try? FileManager.default.removeItem(at:folder); reply(error == nil ? completed : nil,error?.localizedDescription) }
            presenter.present(share,animated:true)
        } catch { reply(nil,error.localizedDescription) }
        #endif
    }
}

enum PaperError: LocalizedError {
    case invalidProject
    var errorDescription: String? { "Invalid or incomplete ASCII Paper project" }
}

private final class WeakPaperBridge: NSObject, WKScriptMessageHandlerWithReply {
    weak var owner: PaperController?
    init(_ owner: PaperController) { self.owner=owner }
    func userContentController(_ controller: WKUserContentController,didReceive message: WKScriptMessage,replyHandler: @escaping (Any?,String?)->Void) {
        guard let owner=owner else { replyHandler(nil,"Studio is closed");return }
        owner.userContentController(controller,didReceive:message,replyHandler:replyHandler)
    }
}

final class PaperAssets: NSObject, WKURLSchemeHandler {
    private let bundle = Bundle.main.resourceURL!
    private let library: URL = {
        let root = StudioSelfTest.enabled ? StudioSelfTest.library : FileManager.default.urls(for:.applicationSupportDirectory,in:.userDomainMask)[0].appendingPathComponent("ASCIIPaper",isDirectory:true)
        try? FileManager.default.createDirectory(at:root,withIntermediateDirectories:true)
        return root
    }()
    private func recordURL(_ name: String) throws -> URL {
        guard name.range(of:"^[a-z0-9_-]{1,48}$",options:.regularExpression) != nil else { throw PaperError.invalidProject }
        return library.appendingPathComponent(name + ".project.json")
    }
    func loadLibrary() throws -> [[String: Any]] {
        try FileManager.default.contentsOfDirectory(at:library,includingPropertiesForKeys:nil)
            .filter { $0.lastPathComponent.hasSuffix(".project.json") }
            .map { guard let record = try JSONSerialization.jsonObject(with:Data(contentsOf:$0)) as? [String: Any] else { throw PaperError.invalidProject }; return record }
    }
    func saveProject(_ record: [String: Any]) throws {
        guard let name = record["name"] as? String, let project = record["project"] as? [String: Any], project["format"] as? String == "asciipaper.project" else { throw PaperError.invalidProject }
        try JSONSerialization.data(withJSONObject:record).write(to:recordURL(name),options:.atomic)
    }
    func removeProject(_ record: [String: Any]) throws {
        guard let name = record["name"] as? String else { throw PaperError.invalidProject }
        try FileManager.default.removeItem(at:recordURL(name))
    }
    func store(_ project: [String: Any]) throws -> URL {
        guard project["format"] as? String == "asciipaper.project", project["version"] as? Int == 1,
              var spec = project["spec"] as? [String: Any], let shader = spec["shader"] as? String,
              shader.range(of:"\\bcell\\s*\\(",options:.regularExpression) != nil, shader.count <= 262144 else { throw PaperError.invalidProject }
        let folder = library.appendingPathComponent("active",isDirectory:true)
        try FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true)
        do {
            if let media = project["media"] as? [String: Any] {
                guard let name = media["name"] as? String, name.range(of:"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$",options:.regularExpression) != nil,
                      !name.contains(".."), let text = media["data"] as? String, text.count <= 89478488, let data = Data(base64Encoded:text) else { throw PaperError.invalidProject }
                try data.write(to:folder.appendingPathComponent(name),options:.atomic)
                spec["media"] = name
                spec["mediaType"] = media["mime"]
            } else if spec["media"] != nil { throw PaperError.invalidProject }
            spec.removeValue(forKey:"frames")
            try JSONSerialization.data(withJSONObject:spec).write(to:folder.appendingPathComponent("spec.json"),options:.atomic)
            let path = "paper://app/library/\(folder.lastPathComponent)/spec.json"
            var components = URLComponents(string:"paper://app/wallpapers/run.html")!
            components.queryItems = [URLQueryItem(name:"spec",value:path)]
            return components.url!
        } catch { try? FileManager.default.removeItem(at:folder); throw error }
    }
    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, url.host == "app" else { task.didFailWithError(PaperError.invalidProject); return }
        let local = url.path.hasPrefix("/library/")
        let root = local ? library : bundle
        let relative = local ? String(url.path.dropFirst("/library/".count)) : String(url.path.dropFirst())
        let file = root.appendingPathComponent(relative).standardizedFileURL.resolvingSymlinksInPath()
        guard file.path.hasPrefix(root.standardizedFileURL.resolvingSymlinksInPath().path + "/") else { task.didFailWithError(PaperError.invalidProject); return }
        do {
            let data = try Data(contentsOf:file,options:.mappedIfSafe)
            let ext = file.pathExtension
            let mime = ext == "js" ? "text/javascript" : ext == "glsl" ? "text/plain" : UTType(filenameExtension:ext)?.preferredMIMEType ?? "application/octet-stream"
            var headers=["Content-Type":mime+(mime.hasPrefix("text/") || ext == "json" ? "; charset=utf-8" : ""),"Access-Control-Allow-Origin":"*","Accept-Ranges":"bytes"]
            var status=200,payload=data
            if let range=task.request.value(forHTTPHeaderField:"Range"),range.hasPrefix("bytes=") {
                let parts=range.dropFirst(6).split(separator:"-",omittingEmptySubsequences:false)
                if parts.count==2,let start=Int(parts[0]),start>=0,start<data.count {
                    let end=min(Int(parts[1]) ?? data.count-1,data.count-1)
                    if end>=start { status=206;payload=data.subdata(in:start..<(end+1));headers["Content-Range"]="bytes \(start)-\(end)/\(data.count)" }
                }
            }
            headers["Content-Length"]=String(payload.count)
            // Fetch exposes status 0 for a generic URLResponse, so .ok checks fail.
            task.didReceive(HTTPURLResponse(url:url,statusCode:status,httpVersion:"HTTP/1.1",headerFields:headers)!)
            task.didReceive(payload); task.didFinish()
        } catch { task.didFailWithError(error) }
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

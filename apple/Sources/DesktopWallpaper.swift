#if os(macOS)
import AppKit
import WebKit

final class DesktopWallpaper: NSObject, WKNavigationDelegate {
    static let shared = DesktopWallpaper(assets:PaperAssets())
    private let assets: PaperAssets
    private var windows: [NSWindow] = []
    private var views: [WKWebView] = []
    private var observers: [NSObjectProtocol] = []
    private var selected: URL?
    private var settings: [String: Any] = ["fps":24,"idleFps":12,"pointer":1]
    private var cap = 60
    private var sleeping = false
    private var globalMouse: Any?
    private var localMouse: Any?
    private var lastMove = Date.distantPast
    init(assets: PaperAssets) {
        self.assets = assets; super.init()
        observers.append(NotificationCenter.default.addObserver(forName:NSApplication.didChangeScreenParametersNotification,object:nil,queue:.main){[weak self] _ in if let u=self?.selected {self?.show(u)}})
        for event in [NSWorkspace.screensDidSleepNotification, NSWorkspace.screensDidWakeNotification] {
            observers.append(NSWorkspace.shared.notificationCenter.addObserver(forName:event,object:nil,queue:.main){[weak self] n in self?.sleeping = n.name == NSWorkspace.screensDidSleepNotification; self?.refresh()})
        }
        observers.append(NotificationCenter.default.addObserver(forName:NSWindow.didChangeOcclusionStateNotification,object:nil,queue:.main){[weak self] _ in self?.refresh()})
        let events: NSEvent.EventTypeMask = [.mouseMoved,.leftMouseDragged,.leftMouseDown,.leftMouseUp]
        globalMouse=NSEvent.addGlobalMonitorForEvents(matching:events){[weak self] event in self?.pointer(event)}
        localMouse=NSEvent.addLocalMonitorForEvents(matching:events){[weak self] event in self?.pointer(event);return event}
    }
    deinit {
        if let monitor=globalMouse { NSEvent.removeMonitor(monitor) }
        if let monitor=localMouse { NSEvent.removeMonitor(monitor) }
        for o in observers { NotificationCenter.default.removeObserver(o); NSWorkspace.shared.notificationCenter.removeObserver(o) }
        for w in windows { w.close() }
    }
    func show(_ url: URL) {
        selected = url
        for w in windows { w.close() }; windows.removeAll(); views.removeAll()
        for screen in NSScreen.screens {
            let config = WKWebViewConfiguration(); config.setURLSchemeHandler(assets,forURLScheme:"paper")
            let view = WKWebView(frame:NSRect(origin:.zero,size:screen.frame.size),configuration:config); view.navigationDelegate = self
            let window = NSWindow(contentRect:screen.frame,styleMask:.borderless,backing:.buffered,defer:false)
            window.level = NSWindow.Level(rawValue:Int(CGWindowLevelForKey(.desktopWindow))+1)
            window.collectionBehavior = [.canJoinAllSpaces,.stationary,.ignoresCycle]
            window.ignoresMouseEvents = true; window.isReleasedWhenClosed = false
            window.contentView = view; window.orderBack(nil)
            windows.append(window); views.append(view); view.load(URLRequest(url:url))
        }
    }
    func options(_ next: [String: Any]) { settings.merge(next){_,new in new}; refresh() }
    func energy(cap: Int) { self.cap=cap;refresh() }
    func webView(_ webView: WKWebView,didFinish navigation: WKNavigation!) { refresh() }
    private func pointer(_ event: NSEvent) {
        guard !sleeping,settings["paused"] as? Bool != true else { return }
        let moved=event.type == .mouseMoved || event.type == .leftMouseDragged
        if moved && Date().timeIntervalSince(lastMove)<1.0/30 { return }
        lastMove=Date()
        let point=NSEvent.mouseLocation
        for (i,view) in views.enumerated() where windows[i].frame.contains(point) && windows[i].occlusionState.contains(.visible) {
            let frame=windows[i].frame,x=(point.x-frame.minX)/frame.width,y=1-(point.y-frame.minY)/frame.height
            let type=moved ? "pointermove" : event.type == .leftMouseDown ? "pointerdown" : "pointerup"
            view.evaluateJavaScript("dispatchEvent(new PointerEvent('\(type)',{clientX:\(x)*innerWidth,clientY:\(y)*innerHeight,buttons:\(NSEvent.pressedMouseButtons)}))",completionHandler:nil)
        }
    }
    private func refresh() {
        for (i,view) in views.enumerated() {
            var value = settings
            value["fps"] = min(cap,settings["fps"] as? Int ?? 24)
            value["idleFps"] = min(cap,settings["idleFps"] as? Int ?? 12)
            value["paused"] = (settings["paused"] as? Bool ?? false) || sleeping || !windows[i].occlusionState.contains(.visible)
            if let data=try? JSONSerialization.data(withJSONObject:value),let json=String(data:data,encoding:.utf8){view.evaluateJavaScript("window.asciipaper?.set(\(json))",completionHandler:nil)}
        }
    }
}
#endif

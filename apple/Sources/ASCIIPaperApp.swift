import SwiftUI
import WebKit

@main
struct ASCIIPaperApp: App {
    var body: some Scene {
        WindowGroup {
            StudioView()
                .frame(minWidth: 320, minHeight: 480)
        }
        #if os(macOS)
        .defaultSize(width: 1080, height: 800)
        #endif
    }
}

struct StudioView: View {
    @Environment(\.scenePhase) private var phase
    @StateObject private var controller = PaperController()
    var body: some View {
        PaperWebView(controller: controller)
            .onChange(of: phase) { _, value in controller.visible(value == .active) }
    }
}

#if os(iOS)
struct PaperWebView: UIViewRepresentable {
    let controller: PaperController
    func makeUIView(context: Context) -> WKWebView { controller.web }
    func updateUIView(_ view: WKWebView, context: Context) {}
}
#else
struct PaperWebView: NSViewRepresentable {
    let controller: PaperController
    func makeNSView(context: Context) -> WKWebView { controller.web }
    func updateNSView(_ view: WKWebView, context: Context) {}
}
#endif

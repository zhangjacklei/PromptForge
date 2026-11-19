import SwiftUI
import WebKit

#if os(macOS)
import AppKit
#else
import UIKit
#endif

// MARK: - 应用状态

@MainActor
final class AppModel: ObservableObject {

    enum Phase: Equatable {
        case booting
        case ready(URL)
        case failed(String)
    }

    @Published private(set) var phase: Phase = .booting
    /// 变化即重建 WKWebView（换 id），用于「重新载入」。
    @Published private(set) var reloadToken = 0

    let bridge = ExportBridge()
    private var server: LocalWebServer?

    /// 本地服务 + 内置页面；启动一次即可，之后只重载页面。
    func boot() {
        guard server == nil else { return }

        guard let html = WebAsset.indexHTML() else {
            phase = .failed("找不到内置页面 index.html，请先运行 tools/build_web.py 重新打包。")
            return
        }

        let route = LocalWebServer.Route(mime: "text/html; charset=utf-8", body: html)
        let web = LocalWebServer(routes: ["/": route, "/index.html": route])

        guard let port = web.start(), let url = URL(string: "http://127.0.0.1:\(port)/") else {
            phase = .failed("本地服务启动失败：18777–18780 端口都被占用。")
            return
        }

        server = web
        phase = .ready(url)
    }

    func reloadPage() {
        reloadToken += 1
    }

    func restart() {
        server?.stop()
        server = nil
        reloadToken += 1
        phase = .booting
        boot()
    }
}

// MARK: - 界面

struct ContentView: View {

    @StateObject private var model = AppModel()

    var body: some View {
        ZStack {
            switch model.phase {
            case .booting:
                splash(text: "正在启动本地工作台…", showsSpinner: true)
            case .ready(let url):
                PromptForgeWebView(url: url, bridge: model.bridge)
                    .id("\(url.absoluteString)#\(model.reloadToken)")
            case .failed(let message):
                splash(text: message, showsSpinner: false)
            }
        }
        .frame(minWidth: 720, minHeight: 520)
        .onReceive(NotificationCenter.default.publisher(for: .promptForgeReload)) { _ in
            model.reloadPage()
        }
        .task { model.boot() }
    }

    private func splash(text: String, showsSpinner: Bool) -> some View {
        VStack(spacing: 16) {
            Text("◆")
                .font(.system(size: 40, weight: .bold))
                .foregroundStyle(.secondary)
            Text("PromptForge")
                .font(.system(size: 22, weight: .semibold))
            if showsSpinner {
                ProgressView().controlSize(.small)
            }
            Text(text)
                .font(.system(size: 13))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 420)
            if !showsSpinner {
                Button("重试") { model.restart() }
                    .buttonStyle(.borderedProminent)
            }
        }
        .padding(40)
    }
}

// MARK: - WKWebView 包装

enum WebViewFactory {

    static func make(url: URL, bridge: ExportBridge) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.userContentController.add(bridge, name: ExportBridge.handlerName)
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        config.websiteDataStore = .default()

        let webView = WKWebView(frame: .zero, configuration: config)

        #if os(macOS)
        webView.allowsBackForwardNavigationGestures = true
        webView.underPageBackgroundColor = .textBackgroundColor
        #else
        webView.allowsBackForwardNavigationGestures = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isOpaque = false
        webView.backgroundColor = .clear
        #endif

        if #available(macOS 13.3, iOS 16.4, *) {
            webView.isInspectable = true   // 允许 Safari 调试界面，正式发布可关闭
        }

        webView.load(URLRequest(url: url))
        return webView
    }
}

#if os(macOS)
struct PromptForgeWebView: NSViewRepresentable {
    let url: URL
    let bridge: ExportBridge

    func makeNSView(context: Context) -> WKWebView {
        WebViewFactory.make(url: url, bridge: bridge)
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {}
}
#else
struct PromptForgeWebView: UIViewRepresentable {
    let url: URL
    let bridge: ExportBridge

    func makeUIView(context: Context) -> WKWebView {
        WebViewFactory.make(url: url, bridge: bridge)
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
#endif

import SwiftUI

/// PromptForge —— 提示词锻造台（macOS / iOS 共用一套 SwiftUI 壳）
///
/// 界面本体是一个纯前端单文件页面，App 只负责三件事：
/// 1. 在 127.0.0.1 上起一个只服务这一个文件的本地 HTTP 服务；
/// 2. 用 WKWebView 加载它（因此 localStorage、剪贴板、字体渲染都与 Safari 一致）；
/// 3. 通过 `pfExport` 桥把「导出」接到系统保存 / 分享面板。
@main
struct PromptForgeApp: App {

    #if os(macOS)
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    #endif

    var body: some Scene {
        #if os(macOS)
        WindowGroup("PromptForge") {
            ContentView()
        }
        .defaultSize(width: 1320, height: 880)
        .commands {
            CommandGroup(replacing: .newItem) {}
            CommandGroup(after: .toolbar) {
                Button("重新载入页面") {
                    NotificationCenter.default.post(name: .promptForgeReload, object: nil)
                }
                .keyboardShortcut("r", modifiers: .command)
            }
        }
        #else
        WindowGroup {
            ContentView()
        }
        #endif
    }
}

extension Notification.Name {
    static let promptForgeReload = Notification.Name("app.promptforge.reload")
}

#if os(macOS)
/// SPM 直接产出的可执行文件需要显式把进程提到前台，否则从终端 `swift run` 启动时窗口不出现在最前。
final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }
}
#endif

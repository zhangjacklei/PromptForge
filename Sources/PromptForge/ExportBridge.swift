import Foundation
import WebKit

#if os(macOS)
import AppKit
#else
import UIKit
#endif

/// 导出桥：页面里的「导出清单 / 补丁 CSV / 修复补丁」在原生壳里走系统保存面板。
///
/// 网页端 `download()` 先检测 `window.webkit.messageHandlers.pfExport`，
/// 存在就把 `{name, text, mime}` 交给原生；浏览器里则照旧用 Blob 下载。
/// 只用公开 API，不依赖任何私有框架。
final class ExportBridge: NSObject, WKScriptMessageHandler {

    static let handlerName = "pfExport"

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard message.name == Self.handlerName,
              let body = message.body as? [String: Any],
              let name = body["name"] as? String,
              let text = body["text"] as? String else { return }

        let mime = body["mime"] as? String ?? "text/plain;charset=utf-8"
        DispatchQueue.main.async {
            Self.present(name: name, text: text, mime: mime)
        }
    }

    // MARK: - 落地

    private static func present(name: String, text: String, mime: String) {
        let fileName = safeFileName(name)
        let tmpURL = FileManager.default.temporaryDirectory.appendingPathComponent(fileName)
        do {
            try Data(text.utf8).write(to: tmpURL, options: .atomic)
        } catch {
            NSLog("PromptForge export failed: %@", String(describing: error))
            return
        }

        #if os(macOS)
        saveOnMac(from: tmpURL, suggestedName: fileName)
        #else
        shareOnIOS(fileURL: tmpURL)
        #endif
        _ = mime
    }

    private static func safeFileName(_ raw: String) -> String {
        let illegal = CharacterSet(charactersIn: "/\\:*?\"<>|\n\r\t")
        var cleaned = raw.components(separatedBy: illegal).joined(separator: "-")
        cleaned = cleaned.trimmingCharacters(in: .whitespacesAndNewlines)
        if cleaned.isEmpty { cleaned = "promptforge-export.txt" }
        if cleaned.count > 120 { cleaned = String(cleaned.prefix(120)) }
        return cleaned
    }

    #if os(macOS)
    private static func saveOnMac(from tmpURL: URL, suggestedName: String) {
        let panel = NSSavePanel()
        panel.title = "保存导出文件"
        panel.nameFieldStringValue = suggestedName
        panel.canCreateDirectories = true
        panel.isExtensionHidden = false
        panel.begin { response in
            guard response == .OK, let target = panel.url else { return }
            do {
                if FileManager.default.fileExists(atPath: target.path) {
                    try FileManager.default.removeItem(at: target)
                }
                try FileManager.default.copyItem(at: tmpURL, to: target)
            } catch {
                NSLog("PromptForge save failed: %@", String(describing: error))
            }
        }
    }
    #else
    private static func shareOnIOS(fileURL: URL) {
        guard let host = topViewController() else { return }
        let controller = UIActivityViewController(activityItems: [fileURL], applicationActivities: nil)
        if let popover = controller.popoverPresentationController {
            popover.sourceView = host.view
            popover.sourceRect = CGRect(x: host.view.bounds.midX, y: host.view.bounds.midY,
                                        width: 1, height: 1)
            popover.permittedArrowDirections = []
        }
        host.present(controller, animated: true)
    }

    private static func topViewController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes
        let active = scenes.compactMap { $0 as? UIWindowScene }
            .first { $0.activationState == .foregroundActive } ?? scenes.compactMap { $0 as? UIWindowScene }.first
        guard var top = active?.windows.first(where: { $0.isKeyWindow })?.rootViewController
                ?? active?.windows.first?.rootViewController else { return nil }
        while let presented = top.presentedViewController {
            top = presented
        }
        return top
    }
    #endif
}

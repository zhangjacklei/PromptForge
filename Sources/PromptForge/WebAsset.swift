import Foundation

/// 定位内置的单文件页面。
///
/// 三种运行形态都要能拿到同一份 index.html：
/// 1. Xcode 构建的 .app / .app（iOS）—— 资源以 folder reference 形式拷进 bundle 的 `web/`；
/// 2. `swift run`（SPM）—— 资源在 `Bundle.module` 里；
/// 3. 调试时用环境变量 `PROMPTFORGE_WEB_ROOT` 指向源码目录。
enum WebAsset {

    static let fileName = "index"

    static func indexHTML() -> Data? {
        for url in candidateURLs() {
            if let data = try? Data(contentsOf: url), !data.isEmpty {
                return data
            }
        }
        return nil
    }

    private static func candidateURLs() -> [URL] {
        var urls: [URL] = []

        if let root = ProcessInfo.processInfo.environment["PROMPTFORGE_WEB_ROOT"] {
            urls.append(URL(fileURLWithPath: root).appendingPathComponent("index.html"))
        }

        #if SWIFT_PACKAGE
        if let u = Bundle.module.url(forResource: fileName, withExtension: "html", subdirectory: "web") {
            urls.append(u)
        }
        if let u = Bundle.module.url(forResource: fileName, withExtension: "html") {
            urls.append(u)
        }
        #endif

        if let u = Bundle.main.url(forResource: fileName, withExtension: "html", subdirectory: "web") {
            urls.append(u)
        }
        if let u = Bundle.main.url(forResource: fileName, withExtension: "html") {
            urls.append(u)
        }
        if let res = Bundle.main.resourceURL {
            urls.append(res.appendingPathComponent("web/index.html"))
            urls.append(res.appendingPathComponent("index.html"))
        }

        return urls
    }
}

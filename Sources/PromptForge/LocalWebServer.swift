import Foundation
import Network

/// 极简本地静态服务。
///
/// 为什么需要它：WKWebView 直接用 `file://` 加载页面时，localStorage 的 origin 是
/// `null`，刷新即丢；而且 `navigator.clipboard` 在非安全上下文不可用。
/// 起一个只监听 127.0.0.1 的 HTTP 服务，页面就落在 `http://127.0.0.1:<port>` 上，
/// 属于「potentially trustworthy origin」，localStorage 与剪贴板都能正常工作。
///
/// 端口优先固定（18777 起），保证 origin 稳定 —— 换端口等于换 origin，历史记录会与
/// 新数据「分家」。端口被占用时才顺延或退到系统随机端口。
final class LocalWebServer {

    private let routes: [String: Route]
    private let queue = DispatchQueue(label: "app.promptforge.localweb")
    private var listener: NWListener?

    private(set) var port: UInt16 = 0

    struct Route {
        let mime: String
        let body: Data
    }

    init(routes: [String: Route]) {
        self.routes = routes
    }

    /// 启动监听，返回实际端口；全部候选端口都失败时返回 nil。
    @discardableResult
    func start(preferredPorts: [UInt16] = [18777, 18778, 18779, 18780, 0]) -> UInt16? {
        for candidate in preferredPorts {
            if let bound = listen(on: candidate) {
                port = bound
                return bound
            }
        }
        return nil
    }

    func stop() {
        listener?.cancel()
        listener = nil
        port = 0
    }

    // MARK: - 监听

    private func listen(on rawPort: UInt16) -> UInt16? {
        let params = NWParameters.tcp
        params.allowLocalEndpointReuse = true
        let endpointPort = NWEndpoint.Port(rawValue: rawPort) ?? .any
        params.requiredLocalEndpoint = .hostPort(host: .ipv4(.loopback), port: endpointPort)

        guard let candidate = try? NWListener(using: params) else { return nil }
        let listenerCandidate = candidate

        let ready = DispatchSemaphore(value: 0)
        var boundPort: UInt16?

        listenerCandidate.stateUpdateHandler = { state in
            switch state {
            case .ready:
                boundPort = listenerCandidate.port?.rawValue
                ready.signal()
            case .failed, .cancelled:
                ready.signal()
            default:
                break
            }
        }
        listenerCandidate.newConnectionHandler = { [weak self] connection in
            self?.accept(connection)
        }
        listenerCandidate.start(queue: queue)

        _ = ready.wait(timeout: .now() + 3)

        if let boundPort, boundPort != 0 {
            listener = listenerCandidate
            return boundPort
        }
        listenerCandidate.cancel()
        return nil
    }

    // MARK: - 请求处理

    private func accept(_ connection: NWConnection) {
        connection.start(queue: queue)
        connection.receive(minimumIncompleteLength: 1, maximumLength: 32 * 1024) { [weak self] data, _, _, _ in
            guard let self else {
                connection.cancel()
                return
            }
            let head = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
            let path = Self.path(fromRequestHead: head)
            let (status, route) = self.resolve(path: path)

            var header = "HTTP/1.1 \(status)\r\n"
            header += "Content-Type: \(route.mime)\r\n"
            header += "Content-Length: \(route.body.count)\r\n"
            header += "Cache-Control: no-store\r\n"
            header += "X-Content-Type-Options: nosniff\r\n"
            header += "Connection: close\r\n\r\n"

            var payload = Data(header.utf8)
            payload.append(route.body)
            connection.send(content: payload, completion: .contentProcessed { _ in
                connection.cancel()
            })
        }
    }

    private func resolve(path: String) -> (String, Route) {
        if let route = routes[path] {
            return ("200 OK", route)
        }
        if path == "/favicon.ico" {
            return ("204 No Content", Route(mime: "image/x-icon", body: Data()))
        }
        return ("404 Not Found", Route(mime: "text/plain; charset=utf-8", body: Data("Not Found".utf8)))
    }

    /// 从 `GET /path?query HTTP/1.1` 里取 path；异常请求一律当作 `/`。
    static func path(fromRequestHead head: String) -> String {
        guard let firstLine = head.split(separator: "\r\n", maxSplits: 1,
                                          omittingEmptySubsequences: true).first else { return "/" }
        let parts = firstLine.split(separator: " ")
        guard parts.count >= 2 else { return "/" }
        var target = String(parts[1])
        if target.isEmpty || target == "/" { return "/" }
        if let q = target.firstIndex(of: "?") { target = String(target[..<q]) }
        if let h = target.firstIndex(of: "#") { target = String(target[..<h]) }
        return target.isEmpty ? "/" : target
    }
}

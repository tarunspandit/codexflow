import AppKit
import Foundation
import SwiftUI
import WebKit

struct BrowserAnnotationTarget: Equatable {
    let sessionID: String
    let selector: String
    let target: String
}

struct BrowserConsoleDiagnostic: Identifiable, Equatable {
    let at: String
    let level: String
    let message: String
    let source: String?
    let line: Int?
    var id: String { "\(at):\(level):\(message):\(line ?? 0)" }
}

struct BrowserNetworkDiagnostic: Identifiable, Equatable {
    let url: String
    let kind: String
    let status: Int?
    let durationMS: Int
    let transferBytes: Int?
    var id: String { "\(kind):\(url):\(durationMS):\(status ?? 0)" }
}

struct BrowserSourceDiagnostic: Identifiable, Equatable {
    let url: String
    let kind: String
    var id: String { "\(kind):\(url)" }
}

struct BrowserDiagnosticSnapshot: Equatable {
    let capturedAt: String
    let console: [BrowserConsoleDiagnostic]
    let network: [BrowserNetworkDiagnostic]
    let sources: [BrowserSourceDiagnostic]
}

private final class WeakBrowserMessageHandler: NSObject, WKScriptMessageHandler {
    weak var delegate: WKScriptMessageHandler?
    init(delegate: WKScriptMessageHandler) { self.delegate = delegate }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        delegate?.userContentController(userContentController, didReceive: message)
    }
}

@MainActor
final class BrowserController: NSObject, ObservableObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    @Published private(set) var selectedSessionID: String?
    @Published private(set) var revision = 0
    @Published private(set) var annotationMode = false
    @Published private(set) var annotationTarget: BrowserAnnotationTarget?
    @Published private(set) var diagnosticsBySession: [String: BrowserDiagnosticSnapshot] = [:]
    @Published private(set) var diagnosticsBusy = false
    @Published private(set) var diagnosticsError: String?

    private struct Session {
        let id: String
        let webView: WKWebView
        var allowedOrigins: Set<String>
        var lastError: String?
    }

    private var sessions: [String: Session] = [:]
    private var inFlight = Set<String>()

    func begin(_ commandID: String) -> Bool {
        inFlight.insert(commandID).inserted
    }

    func finish(_ commandID: String) {
        inFlight.remove(commandID)
    }

    func select(_ sessionID: String) {
        guard sessions[sessionID] != nil else { return }
        if let selectedSessionID, selectedSessionID != sessionID, annotationMode {
            setAnnotationMode(false, sessionID: selectedSessionID)
        }
        selectedSessionID = sessionID
        annotationMode = false
        annotationTarget = nil
        revision &+= 1
    }

    func toggleAnnotationMode() {
        guard let selectedSessionID, sessions[selectedSessionID] != nil else { return }
        annotationMode.toggle()
        annotationTarget = nil
        setAnnotationMode(annotationMode, sessionID: selectedSessionID)
    }

    func clearAnnotationTarget(keepMode: Bool = true) {
        annotationTarget = nil
        if let selectedSessionID {
            if keepMode && annotationMode {
                setAnnotationMode(true, sessionID: selectedSessionID)
            } else if !keepMode {
                annotationMode = false
                setAnnotationMode(false, sessionID: selectedSessionID)
            }
        }
    }

    func webView(for sessionID: String?) -> WKWebView? {
        guard let sessionID else { return nil }
        return sessions[sessionID]?.webView
    }

    var selectedDiagnostics: BrowserDiagnosticSnapshot? {
        guard let selectedSessionID else { return nil }
        return diagnosticsBySession[selectedSessionID]
    }

    func refreshSelectedDiagnostics() async {
        guard let selectedSessionID, let webView = sessions[selectedSessionID]?.webView, !diagnosticsBusy else { return }
        diagnosticsBusy = true
        diagnosticsError = nil
        defer { diagnosticsBusy = false }
        do {
            let result = try await collectDiagnostics(webView: webView)
            diagnosticsBySession[selectedSessionID] = diagnosticSnapshot(from: result)
            revision &+= 1
        } catch {
            diagnosticsError = error.localizedDescription
        }
    }

    func reconcile(sessionIDs: Set<String>) {
        let removed = Set(sessions.keys).subtracting(sessionIDs)
        guard !removed.isEmpty else { return }
        for id in removed {
            guard let session = sessions.removeValue(forKey: id) else { continue }
            session.webView.stopLoading()
            session.webView.navigationDelegate = nil
            session.webView.uiDelegate = nil
            session.webView.configuration.userContentController.removeScriptMessageHandler(forName: "codexflowAnnotation")
            diagnosticsBySession.removeValue(forKey: id)
        }
        if let selectedSessionID, removed.contains(selectedSessionID) {
            self.selectedSessionID = sessions.keys.sorted().first
            annotationMode = false
            annotationTarget = nil
        }
        revision &+= 1
    }

    func execute(_ command: BrowserNativeCommand) async throws -> [String: Any] {
        switch command.action {
        case "open":
            guard let rawURL = command.url, let url = URL(string: rawURL) else { throw BrowserExecutionError.message("The browser URL was invalid.") }
            let webView = makeWebView()
            sessions[command.sessionId] = Session(
                id: command.sessionId, webView: webView,
                allowedOrigins: Set((command.allowedOrigins ?? []).map { $0.lowercased() }), lastError: nil
            )
            selectedSessionID = command.sessionId
            revision &+= 1
            webView.load(URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 20))
            try await waitForLoad(webView, sessionID: command.sessionId)
            return pageIdentity(webView)
        case "observe":
            guard let session = sessions[command.sessionId] else { throw BrowserExecutionError.message("The ephemeral browser session is no longer open.") }
            updateOrigins(command.allowedOrigins, sessionID: command.sessionId)
            if session.webView.isLoading { try await waitForLoad(session.webView, sessionID: command.sessionId) }
            let nativeSnapshot = "nav_\(Self.randomHex(bytes: 8))"
            let elements = try await observe(webView: session.webView, nativeSnapshot: nativeSnapshot)
            let image = try await snapshot(webView: session.webView)
            return pageIdentity(session.webView).merging([
                "native_snapshot_id": nativeSnapshot,
                "elements": elements,
                "screenshot_base64": image.base64EncodedString()
            ]) { _, new in new }
        case "act":
            guard let session = sessions[command.sessionId], let snapshotID = command.snapshotId,
                  let elementID = command.elementId, let operation = command.operation else {
                throw BrowserExecutionError.message("The browser action was incomplete or its session closed.")
            }
            updateOrigins(command.allowedOrigins, sessionID: command.sessionId)
            let result = try await act(
                webView: session.webView, snapshotID: snapshotID, elementID: elementID,
                operation: operation, value: command.value, key: command.key
            )
            return ["operation": operation, "result": result]
        case "diagnostics":
            guard let session = sessions[command.sessionId] else { throw BrowserExecutionError.message("The ephemeral browser session is no longer open.") }
            updateOrigins(command.allowedOrigins, sessionID: command.sessionId)
            if session.webView.isLoading { try await waitForLoad(session.webView, sessionID: command.sessionId) }
            let result = try await collectDiagnostics(webView: session.webView)
            diagnosticsBySession[command.sessionId] = diagnosticSnapshot(from: result)
            revision &+= 1
            return result
        case "close":
            if let session = sessions.removeValue(forKey: command.sessionId) {
                session.webView.stopLoading()
                session.webView.navigationDelegate = nil
                session.webView.uiDelegate = nil
                session.webView.configuration.userContentController.removeScriptMessageHandler(forName: "codexflowAnnotation")
            }
            diagnosticsBySession.removeValue(forKey: command.sessionId)
            if selectedSessionID == command.sessionId {
                selectedSessionID = sessions.keys.sorted().first
                annotationMode = false
                annotationTarget = nil
            }
            revision &+= 1
            return ["closed": true]
        default:
            throw BrowserExecutionError.message("Unsupported native browser command.")
        }
    }

    private func makeWebView() -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.mediaTypesRequiringUserActionForPlayback = .all
        configuration.applicationNameForUserAgent = "CodexFlow Ephemeral Browser"
        configuration.userContentController.addUserScript(WKUserScript(
            source: Self.diagnosticsBootstrapScript, injectionTime: .atDocumentStart, forMainFrameOnly: true
        ))
        configuration.userContentController.add(WeakBrowserMessageHandler(delegate: self), name: "codexflowAnnotation")
        let view = WKWebView(frame: CGRect(x: 0, y: 0, width: 1280, height: 760), configuration: configuration)
        view.navigationDelegate = self
        view.uiDelegate = self
        view.allowsMagnification = true
        return view
    }

    private func setAnnotationMode(_ enabled: Bool, sessionID: String) {
        guard let webView = sessions[sessionID]?.webView else { return }
        let flag = enabled ? "true" : "false"
        let script = """
        (() => {
          if (!window.__codexflowAnnotationState) {
            const state = {enabled:false, overlay:null};
            const clear = () => { if (state.overlay) state.overlay.remove(); state.overlay = null; };
            const selectorFor = (element) => {
              const parts = [];
              let node = element;
              while (node && node.nodeType === 1 && parts.length < 8) {
                let part = node.tagName.toLowerCase();
                const parent = node.parentElement;
                if (parent) {
                  const siblings = Array.from(parent.children).filter(candidate => candidate.tagName === node.tagName);
                  if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
                }
                parts.unshift(part);
                if (node === document.body) break;
                node = parent;
              }
              return parts.join(' > ').slice(0, 1000);
            };
            document.addEventListener('click', (event) => {
              if (!state.enabled) return;
              const element = event.target instanceof Element ? event.target : null;
              if (!element || String(element.type || '').toLowerCase() === 'password') return;
              event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
              clear();
              const rect = element.getBoundingClientRect();
              const overlay = document.createElement('div');
              overlay.setAttribute('data-codexflow-annotation-overlay', '');
              Object.assign(overlay.style, {
                position:'fixed', pointerEvents:'none', zIndex:'2147483647',
                left:`${Math.max(0, rect.left)}px`, top:`${Math.max(0, rect.top)}px`,
                width:`${Math.max(1, rect.width)}px`, height:`${Math.max(1, rect.height)}px`,
                border:'2px solid #79B5DC', borderRadius:'4px', boxSizing:'border-box',
                background:'rgba(121,181,220,0.10)', boxShadow:'0 0 0 3px rgba(8,9,11,0.28)'
              });
              document.documentElement.appendChild(overlay); state.overlay = overlay;
              const role = element.getAttribute('role') || element.tagName.toLowerCase();
              const label = element.getAttribute('aria-label') || element.getAttribute('title') || (element.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 180);
              window.webkit.messageHandlers.codexflowAnnotation.postMessage({
                selector: selectorFor(element), target: `${role}${label ? ` · ${label}` : ''}`.slice(0, 300)
              });
            }, true);
            window.__codexflowAnnotationState = state;
          }
          const state = window.__codexflowAnnotationState;
          state.enabled = \(flag);
          document.documentElement.style.cursor = state.enabled ? 'crosshair' : '';
          if (state.overlay) { state.overlay.remove(); state.overlay = null; }
          return state.enabled;
        })()
        """
        webView.evaluateJavaScript(script, completionHandler: nil)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "codexflowAnnotation", let webView = message.webView,
              let body = message.body as? [String: Any], let selector = body["selector"] as? String,
              let target = body["target"] as? String else { return }
        guard let sessionID = sessions.first(where: { $0.value.webView === webView })?.key,
              annotationMode, !selector.isEmpty, selector.count <= 1000,
              !target.isEmpty, target.count <= 300 else { return }
        annotationTarget = BrowserAnnotationTarget(sessionID: sessionID, selector: selector, target: target)
        revision &+= 1
    }

    private func updateOrigins(_ values: [String]?, sessionID: String) {
        guard let values, var session = sessions[sessionID] else { return }
        session.allowedOrigins = Set(values.map { $0.lowercased() })
        sessions[sessionID] = session
    }

    private func waitForLoad(_ webView: WKWebView, sessionID: String) async throws {
        let deadline = Date().addingTimeInterval(22)
        while webView.isLoading && Date() < deadline {
            try await Task.sleep(nanoseconds: 80_000_000)
        }
        if webView.isLoading { webView.stopLoading(); throw BrowserExecutionError.message("The page did not finish loading in time.") }
        if let error = sessions[sessionID]?.lastError { throw BrowserExecutionError.message(error) }
        guard let url = webView.url, isAllowed(url, for: sessionID) else {
            throw BrowserExecutionError.message("The page reached a website origin that is not approved.")
        }
    }

    private func pageIdentity(_ webView: WKWebView) -> [String: Any] {
        ["url": webView.url?.absoluteString ?? "about:blank", "title": webView.title ?? webView.url?.host ?? "Untitled"]
    }

    private func collectDiagnostics(webView: WKWebView) async throws -> [String: Any] {
        let script = """
        (() => {
          const cleanURL = (raw) => {
            try {
              const value = new URL(String(raw || ''), document.baseURI);
              if (value.protocol !== 'http:' && value.protocol !== 'https:') return null;
              return `${value.origin}${value.pathname}`.slice(0, 1000);
            } catch { return null; }
          };
          const number = (value, max) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(max, Math.round(Number(value)))) : 0;
          const state = window.__codexflowDiagnostics;
          const consoleEntries = Array.isArray(state?.console) ? state.console.slice(-100) : [];
          const timing = [...performance.getEntriesByType('navigation').slice(-1), ...performance.getEntriesByType('resource').slice(-99)];
          const network = timing.map((entry) => {
            const url = cleanURL(entry.name); if (!url) return null;
            const status = number(entry.responseStatus, 599);
            return {
              url, kind: String(entry.initiatorType || entry.entryType || 'resource').slice(0, 40),
              status: status || undefined, duration_ms: number(entry.duration, 600000),
              transfer_bytes: number(entry.transferSize, 100000000) || undefined
            };
          }).filter(Boolean);
          const sources = [];
          const seen = new Set();
          const addSource = (raw, kind) => {
            const url = cleanURL(raw); if (!url) return;
            const key = `${kind}|${url}`; if (seen.has(key)) return;
            seen.add(key); sources.push({url, kind});
          };
          addSource(location.href, 'document');
          document.querySelectorAll('script[src]').forEach(node => addSource(node.src, 'script'));
          document.querySelectorAll('link[rel~="stylesheet"][href]').forEach(node => addSource(node.href, 'stylesheet'));
          return {captured_at:new Date().toISOString(), console:consoleEntries, network, sources:sources.slice(0,100)};
        })()
        """
        let raw = try await evaluate(webView, script: script)
        let result = raw as? [String: Any] ?? [:]
        let snapshot = diagnosticSnapshot(from: result)
        return [
            "captured_at": snapshot.capturedAt,
            "console": snapshot.console.map { entry in
                var value: [String: Any] = ["at": entry.at, "level": entry.level, "message": entry.message]
                if let source = entry.source { value["source"] = source }
                if let line = entry.line { value["line"] = line }
                return value
            },
            "network": snapshot.network.map { entry in
                var value: [String: Any] = ["url": entry.url, "kind": entry.kind, "duration_ms": entry.durationMS]
                if let status = entry.status { value["status"] = status }
                if let transferBytes = entry.transferBytes { value["transfer_bytes"] = transferBytes }
                return value
            },
            "sources": snapshot.sources.map { ["url": $0.url, "kind": $0.kind] }
        ]
    }

    private func diagnosticSnapshot(from result: [String: Any]) -> BrowserDiagnosticSnapshot {
        let console = (result["console"] as? [[String: Any]] ?? []).suffix(100).compactMap { item -> BrowserConsoleDiagnostic? in
            guard let rawMessage = item["message"] as? String, !rawMessage.isEmpty else { return nil }
            return BrowserConsoleDiagnostic(
                at: (item["at"] as? String) ?? ISO8601DateFormatter().string(from: Date()),
                level: ["debug", "info", "log", "warn", "error"].contains(item["level"] as? String ?? "") ? (item["level"] as? String ?? "log") : "log",
                message: Self.sanitizeDiagnosticText(rawMessage), source: Self.safeDiagnosticURL(item["source"] as? String),
                line: (item["line"] as? NSNumber)?.intValue
            )
        }
        let network = (result["network"] as? [[String: Any]] ?? []).suffix(100).compactMap { item -> BrowserNetworkDiagnostic? in
            guard let url = Self.safeDiagnosticURL(item["url"] as? String) else { return nil }
            let status = (item["status"] as? NSNumber)?.intValue
            return BrowserNetworkDiagnostic(
                url: url, kind: String((item["kind"] as? String ?? "resource").prefix(40)),
                status: status.map { max(0, min(599, $0)) },
                durationMS: max(0, min(600_000, (item["duration_ms"] as? NSNumber)?.intValue ?? 0)),
                transferBytes: (item["transfer_bytes"] as? NSNumber).map { max(0, min(100_000_000, $0.intValue)) }
            )
        }
        let sources = (result["sources"] as? [[String: Any]] ?? []).prefix(100).compactMap { item -> BrowserSourceDiagnostic? in
            guard let url = Self.safeDiagnosticURL(item["url"] as? String) else { return nil }
            let rawKind = item["kind"] as? String ?? "resource"
            return BrowserSourceDiagnostic(url: url, kind: ["document", "script", "stylesheet"].contains(rawKind) ? rawKind : "resource")
        }
        return BrowserDiagnosticSnapshot(
            capturedAt: (result["captured_at"] as? String) ?? ISO8601DateFormatter().string(from: Date()),
            console: console, network: network, sources: sources
        )
    }

    private static func safeDiagnosticURL(_ raw: String?) -> String? {
        guard let raw, var components = URLComponents(string: raw), let scheme = components.scheme?.lowercased(),
              ["http", "https"].contains(scheme), components.host != nil else { return nil }
        components.user = nil; components.password = nil; components.query = nil; components.fragment = nil
        return components.url?.absoluteString.prefix(1000).description
    }

    private static func sanitizeDiagnosticText(_ raw: String) -> String {
        var value = String(raw.prefix(1000))
        let patterns = [
            #"(?i)(?:token|secret|password|credential|api[_-]?key)\s*[:=]\s*[^\s,;]+"#,
            #"(?i)\b(?:sk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{16,}\b"#
        ]
        for pattern in patterns {
            value = value.replacingOccurrences(of: pattern, with: "[redacted]", options: .regularExpression)
        }
        return value
    }

    private static let diagnosticsBootstrapScript = """
    (() => {
      if (window.__codexflowDiagnostics) return;
      const state = {console:[]};
      window.__codexflowDiagnostics = state;
      const format = (value) => {
        try {
          if (typeof value === 'string') return value.slice(0, 500);
          if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value).slice(0, 500);
          if (value instanceof Error) return `${value.name}: ${value.message}`.slice(0, 500);
          return Object.prototype.toString.call(value).slice(0, 120);
        } catch { return '[unavailable value]'; }
      };
      const capture = (level, values, source, line) => {
        state.console.push({
          at:new Date().toISOString(), level, message:Array.from(values || []).map(format).join(' ').slice(0,1000),
          source:source ? String(source).slice(0,1000) : undefined,
          line:Number.isFinite(Number(line)) ? Number(line) : undefined
        });
        if (state.console.length > 100) state.console.splice(0, state.console.length - 100);
      };
      ['debug','info','log','warn','error'].forEach((level) => {
        try {
          const original = console[level];
          console[level] = function(...values) { capture(level, values); return Reflect.apply(original, this, values); };
        } catch {}
      });
      addEventListener('error', event => capture('error', [event.message || 'Window error'], event.filename, event.lineno));
      addEventListener('unhandledrejection', event => capture('error', ['Unhandled promise rejection', event.reason]));
    })();
    """

    private func observe(webView: WKWebView, nativeSnapshot: String) async throws -> [[String: Any]] {
        let snapshotLiteral = try Self.jsonLiteral(nativeSnapshot)
        let script = """
        (() => {
          const snapshot = \(snapshotLiteral);
          const visible = (el) => {
            const r = el.getBoundingClientRect();
            const s = getComputedStyle(el);
            return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
          };
          const nodes = Array.from(document.querySelectorAll('a[href],button,input,textarea,select,summary,[role], [tabindex]'))
            .filter(visible).slice(0, 300);
          const map = new Map();
          const randomId = () => {
            const bytes = new Uint8Array(8); crypto.getRandomValues(bytes);
            return 'dom_' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
          };
          const values = nodes.map((el) => {
            const id = randomId(); map.set(id, el);
            const type = String(el.type || '').slice(0, 80);
            const secure = type.toLowerCase() === 'password';
            const role = el.getAttribute('role') || ({A:'link',BUTTON:'button',INPUT:'textbox',TEXTAREA:'textbox',SELECT:'combobox',SUMMARY:'button'}[el.tagName] || el.tagName.toLowerCase());
            const name = el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || (el.innerText || '').trim().slice(0, 300);
            const text = secure ? '' : (el.innerText || el.value || '').trim().slice(0, 500);
            const href = el.href ? String(el.href).slice(0, 1000) : undefined;
            return { id, role, name, text, type, href, disabled: !!el.disabled };
          });
          window.__codexflowSnapshot = snapshot;
          window.__codexflowElements = map;
          return values;
        })()
        """
        let raw = try await evaluate(webView, script: script)
        return raw as? [[String: Any]] ?? []
    }

    private func act(webView: WKWebView, snapshotID: String, elementID: String, operation: String, value: String?, key: String?) async throws -> Any {
        let arguments: [String: Any?] = ["snapshot": snapshotID, "element": elementID, "operation": operation, "value": value, "key": key]
        let data = try JSONSerialization.data(withJSONObject: arguments.mapValues { $0 ?? NSNull() })
        let literal = String(decoding: data, as: UTF8.self)
        let script = """
        (() => {
          const args = \(literal);
          if (window.__codexflowSnapshot !== args.snapshot || !(window.__codexflowElements instanceof Map)) throw new Error('The browser snapshot is stale.');
          const el = window.__codexflowElements.get(args.element);
          if (!el || !el.isConnected) throw new Error('The DOM element changed. Observe the page again.');
          if (el.disabled) throw new Error('The DOM element is disabled.');
          switch (args.operation) {
            case 'click': el.click(); break;
            case 'focus': el.focus(); break;
            case 'scroll_into_view': el.scrollIntoView({block:'center', inline:'nearest'}); break;
            case 'set_value':
              if (String(el.type || '').toLowerCase() === 'password') throw new Error('Password fields are blocked.');
              el.focus();
              const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
              if (descriptor && descriptor.set) descriptor.set.call(el, args.value); else el.value = args.value;
              el.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText', data:args.value}));
              el.dispatchEvent(new Event('change', {bubbles:true})); break;
            case 'key':
              el.focus();
              const names = {return:'Enter', tab:'Tab', escape:'Escape', space:' ', delete:'Delete'};
              const name = names[args.key]; if (!name) throw new Error('Unsupported key.');
              const accepted = el.dispatchEvent(new KeyboardEvent('keydown', {key:name, bubbles:true, cancelable:true}));
              el.dispatchEvent(new KeyboardEvent('keyup', {key:name, bubbles:true}));
              if (accepted && args.key === 'return' && el.form && typeof el.form.requestSubmit === 'function') el.form.requestSubmit();
              if (args.key === 'tab') {
                const focusable = Array.from(document.querySelectorAll('a[href],button,input,textarea,select,[tabindex]')).filter(visible => !visible.disabled && visible.tabIndex >= 0);
                const index = focusable.indexOf(el); if (focusable.length) focusable[(index + 1) % focusable.length].focus();
              }
              break;
            default: throw new Error('Unsupported browser operation.');
          }
          window.__codexflowSnapshot = null; window.__codexflowElements = null;
          return {ok:true};
        })()
        """
        return try await evaluate(webView, script: script)
    }

    private func evaluate(_ webView: WKWebView, script: String) async throws -> Any {
        try await withCheckedThrowingContinuation { continuation in
            webView.evaluateJavaScript(script) { result, error in
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: result ?? NSNull()) }
            }
        }
    }

    private func snapshot(webView: WKWebView) async throws -> Data {
        let image: NSImage = try await withCheckedThrowingContinuation { continuation in
            let configuration = WKSnapshotConfiguration()
            configuration.rect = webView.bounds
            webView.takeSnapshot(with: configuration) { image, error in
                if let error { continuation.resume(throwing: error) }
                else if let image { continuation.resume(returning: image) }
                else { continuation.resume(throwing: BrowserExecutionError.message("The browser snapshot was empty.")) }
            }
        }
        guard let data = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: data),
              let png = bitmap.representation(using: .png, properties: [:]), png.count <= 8 * 1024 * 1024 else {
            throw BrowserExecutionError.message("The browser snapshot could not be encoded within the safety limit.")
        }
        return png
    }

    private func isAllowed(_ url: URL, for sessionID: String) -> Bool {
        guard !Self.isSensitiveTarget(url), let origin = Self.origin(url), let session = sessions[sessionID] else { return false }
        return session.allowedOrigins.contains(origin)
    }

    private static func isSensitiveTarget(_ url: URL) -> Bool {
        let host = (url.host ?? "").lowercased()
        let path = url.path.lowercased()
        let authenticationHosts: Set<String> = [
            "accounts.google.com", "appleid.apple.com", "auth.openai.com", "login.live.com", "login.microsoftonline.com"
        ]
        if authenticationHosts.contains(host) { return true }
        let parts = path.split(separator: "/").map(String.init)
        if parts.contains("checkout") || parts.contains("payment") { return true }
        for index in parts.indices where ["account", "settings"].contains(parts[index]) {
            guard parts.indices.contains(index + 1) else { continue }
            if ["security", "billing", "password", "payment", "payments"].contains(parts[index + 1]) { return true }
        }
        return false
    }

    private static func origin(_ url: URL) -> String? {
        guard let scheme = url.scheme?.lowercased(), ["http", "https"].contains(scheme), let host = url.host?.lowercased() else { return nil }
        let port = url.port.map { ":\($0)" } ?? ""
        return "\(scheme)://\(host)\(port)"
    }

    private static func jsonLiteral(_ value: String) throws -> String {
        String(decoding: try JSONEncoder().encode(value), as: UTF8.self)
    }

    private static func randomHex(bytes: Int) -> String {
        (0..<bytes).map { _ in String(format: "%02x", UInt8.random(in: 0...255)) }.joined()
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let sessionID = sessions.first(where: { $0.value.webView === webView })?.key else { decisionHandler(.cancel); return }
        guard navigationAction.targetFrame != nil, !navigationAction.shouldPerformDownload,
              let url = navigationAction.request.url, isAllowed(url, for: sessionID) else {
            if var session = sessions[sessionID] {
                session.lastError = "Navigation was blocked because the destination origin is not approved."
                sessions[sessionID] = session
            }
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { setError(error, for: webView) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { setError(error, for: webView) }
    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        guard let key = sessions.first(where: { $0.value.webView === webView })?.key, var session = sessions[key] else { return }
        session.lastError = nil
        sessions[key] = session
        diagnosticsBySession.removeValue(forKey: key)
        if key == selectedSessionID { annotationTarget = nil }
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard annotationMode, let key = sessions.first(where: { $0.value.webView === webView })?.key,
              key == selectedSessionID else { return }
        setAnnotationMode(true, sessionID: key)
    }
    private func setError(_ error: Error, for webView: WKWebView) {
        guard let key = sessions.first(where: { $0.value.webView === webView })?.key, var session = sessions[key] else { return }
        session.lastError = error.localizedDescription
        sessions[key] = session
    }

    func webView(_ webView: WKWebView, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        completionHandler(.cancelAuthenticationChallenge, nil)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? { nil }
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) { decisionHandler(.deny) }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) { completionHandler() }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) { completionHandler(false) }
    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) { completionHandler(nil) }
}

private enum BrowserExecutionError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let value) = self { value } else { nil } }
}

struct BrowserWebContainer: NSViewRepresentable {
    @ObservedObject var controller: BrowserController
    let sessionID: String?

    func makeNSView(context: Context) -> NSView { NSView(frame: .zero) }

    func updateNSView(_ container: NSView, context: Context) {
        container.subviews.forEach { $0.removeFromSuperview() }
        guard let webView = controller.webView(for: sessionID) else { return }
        webView.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: container.trailingAnchor),
            webView.topAnchor.constraint(equalTo: container.topAnchor),
            webView.bottomAnchor.constraint(equalTo: container.bottomAnchor)
        ])
    }
}

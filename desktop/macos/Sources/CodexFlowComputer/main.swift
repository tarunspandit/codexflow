import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
import ScreenCaptureKit
import Security

private struct Request: Decodable {
    let action: String
    let bundleId: String?
    let elementPath: [Int]?
    let expectedRole: String?
    let expectedTitle: String?
    let operation: String?
    let value: String?
    let key: String?
    let expectedIdentity: String?
}

private struct AppRecord: Encodable {
    let bundleId: String
    let name: String
    let pid: Int32
    let active: Bool
    let identity: String
}

private struct ElementRecord: Encodable {
    let path: [Int]
    let role: String
    let subrole: String?
    let title: String?
    let value: String?
    let x: Double?
    let y: Double?
    let width: Double?
    let height: Double?
    let actions: [String]
}

private enum HelperError: LocalizedError {
    case message(String)
    var errorDescription: String? {
        switch self { case .message(let message): message }
    }
}

private func attribute(_ element: AXUIElement, _ name: CFString) -> CFTypeRef? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, name, &value) == .success else { return nil }
    return value
}

private func stringAttribute(_ element: AXUIElement, _ name: CFString) -> String? {
    attribute(element, name) as? String
}

private func pointAttribute(_ element: AXUIElement, _ name: CFString) -> CGPoint? {
    guard let value = attribute(element, name), CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
    var point = CGPoint.zero
    return AXValueGetValue(value as! AXValue, .cgPoint, &point) ? point : nil
}

private func sizeAttribute(_ element: AXUIElement, _ name: CFString) -> CGSize? {
    guard let value = attribute(element, name), CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
    var size = CGSize.zero
    return AXValueGetValue(value as! AXValue, .cgSize, &size) ? size : nil
}

private func actions(_ element: AXUIElement) -> [String] {
    var names: CFArray?
    guard AXUIElementCopyActionNames(element, &names) == .success else { return [] }
    return (names as? [String] ?? []).sorted()
}

private func children(_ element: AXUIElement) -> [AXUIElement] {
    attribute(element, kAXChildrenAttribute as CFString) as? [AXUIElement] ?? []
}

private func targetApp(_ bundleId: String) throws -> NSRunningApplication {
    guard let app = NSWorkspace.shared.runningApplications.first(where: { $0.bundleIdentifier == bundleId && !$0.isTerminated }) else {
        throw HelperError.message("The approved app is not currently running.")
    }
    return app
}

private func signingIdentity(_ app: NSRunningApplication) throws -> String {
    guard let bundleURL = app.bundleURL else { throw HelperError.message("The target app has no stable bundle location.") }
    var staticCode: SecStaticCode?
    guard SecStaticCodeCreateWithPath(bundleURL as CFURL, [], &staticCode) == errSecSuccess, let staticCode else {
        throw HelperError.message("The target app code-signing identity could not be read.")
    }
    let validationFlags = SecCSFlags(rawValue: kSecCSCheckAllArchitectures | kSecCSStrictValidate)
    guard SecStaticCodeCheckValidity(staticCode, validationFlags, nil) == errSecSuccess else {
        throw HelperError.message("The target app code signature is invalid.")
    }
    var rawInfo: CFDictionary?
    guard SecCodeCopySigningInformation(staticCode, SecCSFlags(rawValue: kSecCSSigningInformation), &rawInfo) == errSecSuccess,
          let info = rawInfo as? [String: Any] else {
        throw HelperError.message("The target app code-signing identity could not be read.")
    }
    let identifier = info[kSecCodeInfoIdentifier as String] as? String ?? app.bundleIdentifier ?? "unknown"
    let team = info[kSecCodeInfoTeamIdentifier as String] as? String ?? "adhoc"
    guard let cdHash = info[kSecCodeInfoUnique as String] as? Data, !cdHash.isEmpty else {
        throw HelperError.message("The target app does not expose a code-signing fingerprint.")
    }
    return "\(identifier)|\(team)|\(cdHash.base64EncodedString())"
}

private func verifyIdentity(_ app: NSRunningApplication, expected: String?) throws -> String {
    let current = try signingIdentity(app)
    if let expected, expected != current { throw HelperError.message("The target app identity changed. Revoke and approve the app again before use.") }
    return current
}

private func targetWindow(_ app: NSRunningApplication) throws -> AXUIElement {
    let application = AXUIElementCreateApplication(app.processIdentifier)
    if let focused = attribute(application, kAXFocusedWindowAttribute as CFString), CFGetTypeID(focused) == AXUIElementGetTypeID() {
        return unsafeBitCast(focused, to: AXUIElement.self)
    }
    if let windows = attribute(application, kAXWindowsAttribute as CFString) as? [AXUIElement], let first = windows.first {
        return first
    }
    throw HelperError.message("The approved app has no accessible window.")
}

private func element(at path: [Int], in root: AXUIElement) throws -> AXUIElement {
    var current = root
    for index in path {
        let values = children(current)
        guard values.indices.contains(index) else { throw HelperError.message("The interface changed. Capture a fresh snapshot before acting.") }
        current = values[index]
    }
    return current
}

private func collectElements(_ root: AXUIElement, limit: Int = 240, depthLimit: Int = 9) -> [ElementRecord] {
    var records: [ElementRecord] = []
    var queue: [(AXUIElement, [Int], Int)] = [(root, [], 0)]
    while !queue.isEmpty && records.count < limit {
        let (element, path, depth) = queue.removeFirst()
        let role = stringAttribute(element, kAXRoleAttribute as CFString) ?? "AXUnknown"
        let title = stringAttribute(element, kAXTitleAttribute as CFString)
            ?? stringAttribute(element, kAXDescriptionAttribute as CFString)
        let rawValue = stringAttribute(element, kAXValueAttribute as CFString)
        let position = pointAttribute(element, kAXPositionAttribute as CFString)
        let size = sizeAttribute(element, kAXSizeAttribute as CFString)
        records.append(ElementRecord(
            path: path, role: role,
            subrole: stringAttribute(element, kAXSubroleAttribute as CFString),
            title: title?.prefix(300).description,
            value: rawValue?.prefix(500).description,
            x: position.map { Double($0.x) }, y: position.map { Double($0.y) },
            width: size.map { Double($0.width) }, height: size.map { Double($0.height) },
            actions: actions(element)
        ))
        if depth < depthLimit {
            for (index, child) in children(element).prefix(80).enumerated() {
                queue.append((child, path + [index], depth + 1))
            }
        }
    }
    return records
}

private func windowImage(_ app: NSRunningApplication) async throws -> String {
    let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: true)
    guard let window = content.windows.first(where: { $0.owningApplication?.processID == app.processIdentifier && $0.isOnScreen }) else {
        throw HelperError.message("The approved app window could not be captured.")
    }
    let configuration = SCStreamConfiguration()
    configuration.width = min(1440, Int(window.frame.width * 2))
    configuration.height = max(1, Int(Double(configuration.width) * window.frame.height / max(window.frame.width, 1)))
    configuration.showsCursor = false
    configuration.ignoreShadowsSingleWindow = true
    let filter = SCContentFilter(desktopIndependentWindow: window)
    let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
    let maximumWidth: CGFloat = 1440
    let target: CGImage
    if CGFloat(image.width) > maximumWidth {
        let scale = maximumWidth / CGFloat(image.width)
        let width = Int(maximumWidth)
        let height = max(1, Int(CGFloat(image.height) * scale))
        guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
            throw HelperError.message("The captured window could not be resized.")
        }
        context.interpolationQuality = .high
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        guard let resized = context.makeImage() else { throw HelperError.message("The captured window could not be resized.") }
        target = resized
    } else {
        target = image
    }
    let representation = NSBitmapImageRep(cgImage: target)
    guard let data = representation.representation(using: .png, properties: [:]) else {
        throw HelperError.message("The captured window could not be encoded.")
    }
    if data.count > 8 * 1024 * 1024 { throw HelperError.message("The captured window exceeds the 8 MB safety limit.") }
    return data.base64EncodedString()
}

private func perform(_ request: Request) throws -> [String: Any] {
    guard AXIsProcessTrusted() else { throw HelperError.message("Accessibility permission is not granted to CodexFlow Computer.") }
    guard let bundleId = request.bundleId, let path = request.elementPath, let operation = request.operation else {
        throw HelperError.message("A target app, element path, and operation are required.")
    }
    let app = try targetApp(bundleId)
    _ = try verifyIdentity(app, expected: request.expectedIdentity)
    let root = try targetWindow(app)
    let target = try element(at: path, in: root)
    let role = stringAttribute(target, kAXRoleAttribute as CFString) ?? "AXUnknown"
    let title = stringAttribute(target, kAXTitleAttribute as CFString)
        ?? stringAttribute(target, kAXDescriptionAttribute as CFString)
    guard role == request.expectedRole && title == request.expectedTitle else {
        throw HelperError.message("The target interface element changed. Capture a fresh snapshot before acting.")
    }
    app.activate()
    switch operation {
    case "press":
        guard AXUIElementPerformAction(target, kAXPressAction as CFString) == .success else {
            throw HelperError.message("The selected interface element did not accept a press action.")
        }
    case "focus":
        guard AXUIElementSetAttributeValue(target, kAXFocusedAttribute as CFString, kCFBooleanTrue) == .success else {
            throw HelperError.message("The selected interface element could not receive focus.")
        }
    case "set_value":
        let subrole = stringAttribute(target, kAXSubroleAttribute as CFString) ?? ""
        if subrole.localizedCaseInsensitiveContains("secure") { throw HelperError.message("CodexFlow will not type into secure or password fields.") }
        guard let value = request.value, value.count <= 4000 else { throw HelperError.message("Text input must contain at most 4000 characters.") }
        guard AXUIElementSetAttributeValue(target, kAXValueAttribute as CFString, value as CFString) == .success else {
            throw HelperError.message("The selected interface element did not accept text input.")
        }
    case "key":
        let keys: [String: CGKeyCode] = ["return": 36, "tab": 48, "escape": 53, "space": 49, "delete": 51]
        guard let key = request.key, let code = keys[key] else { throw HelperError.message("Unsupported key. Use return, tab, escape, space, or delete.") }
        guard AXUIElementSetAttributeValue(target, kAXFocusedAttribute as CFString, kCFBooleanTrue) == .success else {
            throw HelperError.message("The selected interface element could not receive keyboard focus.")
        }
        CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true)?.post(tap: .cghidEventTap)
        CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false)?.post(tap: .cghidEventTap)
    default:
        throw HelperError.message("Unsupported Computer Use operation.")
    }
    return ["ok": true, "bundle_id": bundleId, "role": role, "title": title ?? NSNull(), "operation": operation]
}

private func response(for request: Request) async throws -> [String: Any] {
    switch request.action {
    case "status":
        return ["ok": true, "platform": "macos", "screen_recording": CGPreflightScreenCaptureAccess(), "accessibility": AXIsProcessTrusted()]
    case "request_permissions":
        let accessibilityOptions = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        let accessibility = AXIsProcessTrustedWithOptions(accessibilityOptions)
        let screenRecording = CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess()
        return ["ok": true, "platform": "macos", "screen_recording": screenRecording, "accessibility": accessibility]
    case "list_apps":
        let apps = NSWorkspace.shared.runningApplications.compactMap { app -> AppRecord? in
            guard app.activationPolicy == .regular, !app.isTerminated,
                  let bundleId = app.bundleIdentifier, let name = app.localizedName else { return nil }
            guard let identity = try? signingIdentity(app) else { return nil }
            return AppRecord(bundleId: bundleId, name: name, pid: app.processIdentifier, active: app.isActive, identity: identity)
        }.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        return ["ok": true, "apps": try jsonObject(apps)]
    case "snapshot":
        guard CGPreflightScreenCaptureAccess() else { throw HelperError.message("Screen Recording permission is not granted to CodexFlow Computer.") }
        guard AXIsProcessTrusted() else { throw HelperError.message("Accessibility permission is not granted to CodexFlow Computer.") }
        guard let bundleId = request.bundleId else { throw HelperError.message("A target app is required.") }
        let app = try targetApp(bundleId)
        let identity = try verifyIdentity(app, expected: request.expectedIdentity)
        let root = try targetWindow(app)
        return [
            "ok": true, "bundle_id": bundleId, "app_name": app.localizedName ?? bundleId,
            "pid": app.processIdentifier, "identity": identity, "elements": try jsonObject(collectElements(root)),
            "screenshot_base64": try await windowImage(app)
        ]
    case "perform":
        return try perform(request)
    default:
        throw HelperError.message("Unknown CodexFlow Computer helper action.")
    }
}

private func jsonObject<T: Encodable>(_ value: T) throws -> Any {
    let data = try JSONEncoder().encode(value)
    return try JSONSerialization.jsonObject(with: data)
}

private func write(_ value: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0A]))
}

@main
private struct CodexFlowComputerHelper {
    static func main() async {
        do {
            let input = FileHandle.standardInput.readDataToEndOfFile()
            let request = try JSONDecoder().decode(Request.self, from: input)
            write(try await response(for: request))
        } catch {
            write(["ok": false, "error": error.localizedDescription])
            exit(1)
        }
    }
}

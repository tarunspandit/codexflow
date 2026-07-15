import SwiftUI

enum FlowColor {
    static let ground = Color(hex: 0x08090B)
    static let groundRaised = Color(hex: 0x111419)
    static let groundSoft = Color(hex: 0x181D24)
    static let paper = Color(hex: 0xF3EEE8)
    static let paperBright = Color(hex: 0xFBF8F4)
    static let paperMuted = Color(hex: 0xE8E1D9)
    static let ink = Color(hex: 0x16191D)
    static let inkMuted = Color(hex: 0x66645F)
    static let line = Color(hex: 0xD7CEC4)
    static let lineDark = Color.white.opacity(0.12)
    static let signal = Color(hex: 0x6EADD7)
    static let signalBright = Color(hex: 0x9BD2F3)
    static let signalWash = Color(hex: 0xDCECF7)
    static let success = Color(hex: 0x3D8A68)
    static let warning = Color(hex: 0xB67638)
    static let danger = Color(hex: 0xB85A54)
}

enum FlowType {
    static func display(_ size: CGFloat) -> Font { .custom("Geologica", fixedSize: size).weight(.medium) }
    static func title(_ size: CGFloat) -> Font { .custom("Geologica", fixedSize: size).weight(.semibold) }
    static func body(_ size: CGFloat = 14) -> Font { .custom("Geologica", fixedSize: size).weight(.regular) }
    static func label(_ size: CGFloat = 12) -> Font { .custom("Geologica", fixedSize: size).weight(.medium) }
    static func mono(_ size: CGFloat = 12) -> Font { .system(size: size, weight: .regular, design: .monospaced) }
}

extension Color {
    init(hex: UInt32, alpha: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: alpha
        )
    }
}

struct PaperCard<Content: View>: View {
    let padding: CGFloat
    @ViewBuilder let content: Content

    init(padding: CGFloat = 20, @ViewBuilder content: () -> Content) {
        self.padding = padding
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            content
        }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(padding)
            .background(FlowColor.paperBright)
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(FlowColor.line.opacity(0.78), lineWidth: 1)
            )
            .shadow(color: FlowColor.ground.opacity(0.035), radius: 18, y: 8)
    }
}

struct FlowButtonStyle: ButtonStyle {
    enum Kind { case primary, secondary, quiet, danger }
    let kind: Kind
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(FlowType.label(13))
            .foregroundStyle(foreground)
            .padding(.horizontal, kind == .quiet ? 11 : 16)
            .frame(minHeight: 44)
            .background(background.opacity(configuration.isPressed ? 0.76 : 1))
            .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 11, style: .continuous)
                    .stroke(border, lineWidth: 1)
            )
            .contentShape(Rectangle())
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
            .opacity(isEnabled ? 1 : 0.42)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }

    private var foreground: Color {
        switch kind {
        case .primary: FlowColor.ground
        case .secondary, .quiet: FlowColor.ink
        case .danger: FlowColor.danger
        }
    }

    private var background: Color {
        switch kind {
        case .primary: FlowColor.signalBright
        case .secondary: FlowColor.paperBright
        case .quiet: Color.clear
        case .danger: FlowColor.danger.opacity(0.08)
        }
    }

    private var border: Color {
        switch kind {
        case .primary: FlowColor.signal.opacity(0.6)
        case .secondary: FlowColor.line
        case .quiet: Color.clear
        case .danger: FlowColor.danger.opacity(0.28)
        }
    }
}

struct StateDot: View {
    let color: Color
    var pulse = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var expanded = false

    var body: some View {
        ZStack {
            if pulse && !reduceMotion {
                Circle()
                    .fill(color.opacity(0.22))
                    .frame(width: expanded ? 22 : 9, height: expanded ? 22 : 9)
                    .opacity(expanded ? 0 : 1)
            }
            Circle().fill(color).frame(width: 8, height: 8)
        }
        .frame(width: 22, height: 22)
        .onAppear {
            guard pulse && !reduceMotion else { return }
            withAnimation(.easeOut(duration: 1.45).repeatForever(autoreverses: false)) {
                expanded = true
            }
        }
    }
}

struct StatusPill: View {
    let label: String
    let color: Color
    var pulse = false

    var body: some View {
        HStack(spacing: 4) {
            StateDot(color: color, pulse: pulse)
            Text(label)
        }
        .font(FlowType.label(11))
        .foregroundStyle(FlowColor.ink)
        .padding(.trailing, 11)
        .padding(.leading, 2)
        .frame(minHeight: 30)
        .background(color.opacity(0.10))
        .clipShape(Capsule())
        .overlay(Capsule().stroke(color.opacity(0.22), lineWidth: 1))
    }
}

struct SectionHeading: View {
    let eyebrow: String
    let title: String
    let detail: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(eyebrow.uppercased())
                .font(FlowType.label(10))
                .tracking(1.5)
                .foregroundStyle(FlowColor.inkMuted)
            Text(title)
                .font(FlowType.display(31))
                .foregroundStyle(FlowColor.ink)
            Text(detail)
                .font(FlowType.body(14))
                .foregroundStyle(FlowColor.inkMuted)
                .lineSpacing(3)
                .frame(maxWidth: 670, alignment: .leading)
        }
    }
}

struct EmptyState: View {
    let symbol: String
    let title: String
    let detail: String

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: symbol)
                .font(.system(size: 25, weight: .light))
                .foregroundStyle(FlowColor.signal)
            Text(title).font(FlowType.title(16)).foregroundStyle(FlowColor.ink)
            Text(detail)
                .font(FlowType.body(13))
                .foregroundStyle(FlowColor.inkMuted)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 360)
        }
        .frame(maxWidth: .infinity, minHeight: 180)
        .padding(21)
    }
}

struct FlowDivider: View {
    var body: some View { Rectangle().fill(FlowColor.line).frame(height: 1) }
}

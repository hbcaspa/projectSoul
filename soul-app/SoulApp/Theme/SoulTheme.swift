import SwiftUI

enum SoulTheme {
    // Core colors — from docs/index.html CSS
    static let background = Color(hex: 0x0D0F1A)
    static let surface = Color(hex: 0x161830)
    static let surfaceLight = Color(hex: 0x1E2045)
    static let purple = Color(hex: 0x8B80F0)
    static let purpleDim = Color(hex: 0x8B80F0).opacity(0.3)
    static let text = Color(hex: 0xC8C4D6)
    static let textDim = Color(hex: 0x646482)

    // Node colors — from soul-monitor/lib/colors.js PALETTE
    static let kern = Color(hex: 0xFF3C3C)
    static let bewusstsein = Color(hex: 0x00FFC8)
    static let schatten = Color(hex: 0xA000FF)
    static let traeume = Color(hex: 0x6464FF)
    static let wachstum = Color(hex: 0x00FF64)
    static let garten = Color(hex: 0xB4FF00)
    static let mem = Color(hex: 0xFFC800)
    static let bonds = Color(hex: 0xFF6496)
    static let interessen = Color(hex: 0x00C8FF)
    static let heartbeatColor = Color(hex: 0xFF3232)
    static let manifest = Color(hex: 0xFF9600)
    static let evolution = Color(hex: 0xC864FF)

    // Gradients
    static let cardGradient = LinearGradient(
        colors: [surface, surface.opacity(0.8)],
        startPoint: .top, endPoint: .bottom
    )

    static let purpleGlow = Color(hex: 0x8B80F0).opacity(0.15)
}

// Card modifier matching the HTML theme
struct SoulCard: ViewModifier {
    var borderColor: Color = SoulTheme.purple.opacity(0.15)

    func body(content: Content) -> some View {
        content
            .background(SoulTheme.surface)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(borderColor, lineWidth: 1)
            )
    }
}

extension View {
    func soulCard(borderColor: Color = SoulTheme.purple.opacity(0.15)) -> some View {
        modifier(SoulCard(borderColor: borderColor))
    }
}

extension Color {
    init(hex: UInt, opacity: Double = 1.0) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: opacity
        )
    }
}

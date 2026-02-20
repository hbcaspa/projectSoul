import SwiftUI

struct ChatBubble: View {
    let message: ChatMessage

    private var isUser: Bool { message.role == "user" }

    var body: some View {
        HStack {
            if isUser { Spacer(minLength: 60) }

            VStack(alignment: isUser ? .trailing : .leading, spacing: 4) {
                Text(message.content)
                    .foregroundColor(isUser ? .white : SoulTheme.text)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(isUser ? SoulTheme.purple : SoulTheme.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
                    .overlay(
                        RoundedRectangle(cornerRadius: 16)
                            .stroke(
                                isUser ? Color.clear : SoulTheme.purple.opacity(0.1),
                                lineWidth: 1
                            )
                    )

                Text(formatTime(message.timestamp))
                    .font(.caption2)
                    .foregroundColor(SoulTheme.textDim)
                    .padding(.horizontal, 4)
            }

            if !isUser { Spacer(minLength: 60) }
        }
        .padding(.horizontal)
    }

    private func formatTime(_ iso: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else {
            return ""
        }
        let tf = DateFormatter()
        tf.dateFormat = "HH:mm"
        return tf.string(from: date)
    }
}

struct TypingIndicator: View {
    @State private var dotCount = 0

    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<3) { i in
                Circle()
                    .fill(SoulTheme.purple)
                    .frame(width: 6, height: 6)
                    .opacity(dotCount == i ? 1.0 : 0.3)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(SoulTheme.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .onAppear {
            Timer.scheduledTimer(withTimeInterval: 0.4, repeats: true) { _ in
                dotCount = (dotCount + 1) % 3
            }
        }
    }
}

struct PulseIndicator: View {
    let pulse: PulseInfo
    @State private var isGlowing = false

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(SoulTheme.purple)
                .frame(width: 6, height: 6)
                .opacity(isGlowing ? 1.0 : 0.4)
                .animation(.easeInOut(duration: 1).repeatForever(), value: isGlowing)

            Text(pulse.label)
                .font(.caption)
                .foregroundColor(SoulTheme.textDim)

            Spacer()
        }
        .padding(.vertical, 4)
        .onAppear { isGlowing = true }
    }
}

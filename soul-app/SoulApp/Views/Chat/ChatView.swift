import SwiftUI

struct ChatView: View {
    @EnvironmentObject var settings: Settings
    @EnvironmentObject var wsClient: WebSocketClient
    @State private var inputText = ""
    @State private var showSettings = false
    @FocusState private var isInputFocused: Bool

    var body: some View {
        NavigationStack {
            ZStack {
                SoulTheme.background.ignoresSafeArea()

                if !settings.isConfigured {
                    notConfiguredView
                } else {
                    VStack(spacing: 0) {
                        // Pulse indicator
                        if let pulse = wsClient.currentPulse {
                            PulseIndicator(pulse: pulse)
                                .padding(.horizontal)
                                .padding(.top, 4)
                        }

                        // Messages
                        ScrollViewReader { proxy in
                            ScrollView {
                                LazyVStack(spacing: 12) {
                                    ForEach(wsClient.messages) { message in
                                        ChatBubble(message: message)
                                            .id(message.id)
                                    }

                                    if wsClient.isTyping {
                                        HStack {
                                            TypingIndicator()
                                            Spacer()
                                        }
                                        .padding(.horizontal)
                                        .id("typing")
                                    }
                                }
                                .padding(.vertical, 12)
                            }
                            .onChange(of: wsClient.messages.count) {
                                withAnimation {
                                    if let last = wsClient.messages.last {
                                        proxy.scrollTo(last.id, anchor: .bottom)
                                    }
                                }
                            }
                        }

                        // Input bar
                        inputBar
                    }
                }
            }
            .navigationTitle(wsClient.soulName)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Circle()
                        .fill(wsClient.isConnected ? .green : .red)
                        .frame(width: 8, height: 8)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showSettings = true } label: {
                        Image(systemName: "gearshape")
                            .foregroundColor(SoulTheme.purple)
                    }
                }
            }
            .sheet(isPresented: $showSettings) { SettingsView() }
            .task {
                if settings.isConfigured && !wsClient.isConnected {
                    wsClient.connect()
                    await wsClient.loadHistory()
                }
            }
        }
    }

    private var notConfiguredView: some View {
        VStack(spacing: 20) {
            Image(systemName: "antenna.radiowaves.left.and.right.slash")
                .font(.system(size: 48))
                .foregroundColor(SoulTheme.purple.opacity(0.5))
            Text("Not Connected")
                .font(.title2)
                .foregroundColor(SoulTheme.text)
            Text("Configure your server URL and API key in Settings to connect to your soul.")
                .multilineTextAlignment(.center)
                .foregroundColor(SoulTheme.textDim)
                .padding(.horizontal, 40)
            Button("Open Settings") { showSettings = true }
                .foregroundColor(SoulTheme.purple)
                .padding(.horizontal, 24)
                .padding(.vertical, 10)
                .background(SoulTheme.purple.opacity(0.15))
                .clipShape(Capsule())
        }
    }

    private var inputBar: some View {
        HStack(spacing: 12) {
            TextField("Message...", text: $inputText, axis: .vertical)
                .lineLimit(1...5)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(SoulTheme.surface)
                .clipShape(RoundedRectangle(cornerRadius: 20))
                .overlay(
                    RoundedRectangle(cornerRadius: 20)
                        .stroke(SoulTheme.purple.opacity(0.2), lineWidth: 1)
                )
                .focused($isInputFocused)

            Button(action: sendMessage) {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 32))
                    .foregroundColor(inputText.isEmpty ? SoulTheme.textDim : SoulTheme.purple)
            }
            .disabled(inputText.isEmpty || !wsClient.isConnected)
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(SoulTheme.background)
    }

    private func sendMessage() {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        wsClient.send(text: text)
        inputText = ""
    }
}

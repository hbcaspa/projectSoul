import Foundation
import SwiftUI

@MainActor
class WebSocketClient: ObservableObject {
    @Published var isConnected = false
    @Published var messages: [ChatMessage] = []
    @Published var currentPulse: PulseInfo?
    @Published var isTyping = false
    @Published var soulName: String = "Soul"

    private var task: URLSessionWebSocketTask?
    private let settings: Settings
    private var shouldReconnect = true

    init(settings: Settings) {
        self.settings = settings
    }

    func connect() {
        guard let url = settings.wsURL else { return }
        shouldReconnect = true
        task = URLSession.shared.webSocketTask(with: url)
        task?.resume()
        authenticate()
        receiveLoop()
    }

    func disconnect() {
        shouldReconnect = false
        task?.cancel(with: .normalClosure, reason: nil)
        isConnected = false
    }

    func send(text: String) {
        let msg = WSChatMessage(type: "message", text: text)
        guard let data = try? JSONEncoder().encode(msg),
              let str = String(data: data, encoding: .utf8) else { return }
        task?.send(.string(str)) { _ in }

        messages.append(ChatMessage(role: "user", content: text))
        isTyping = true
    }

    func loadHistory() async {
        let client = APIClient(settings: settings)
        do {
            let history = try await client.fetchChatHistory()
            messages = history
        } catch { /* ignore */ }
    }

    // MARK: - Private

    private func authenticate() {
        let auth = WSAuthMessage(type: "auth", apiKey: settings.apiKey)
        guard let data = try? JSONEncoder().encode(auth),
              let str = String(data: data, encoding: .utf8) else { return }
        task?.send(.string(str)) { _ in }
    }

    private func receiveLoop() {
        task?.receive { [weak self] result in
            Task { @MainActor in
                switch result {
                case .success(let message):
                    self?.handleMessage(message)
                    self?.receiveLoop()
                case .failure:
                    self?.isConnected = false
                    if self?.shouldReconnect == true {
                        try? await Task.sleep(nanoseconds: 3_000_000_000)
                        self?.connect()
                    }
                }
            }
        }
    }

    private func handleMessage(_ message: URLSessionWebSocketTask.Message) {
        guard case .string(let text) = message,
              let data = text.data(using: .utf8),
              let msg = try? JSONDecoder().decode(WSResponse.self, from: data) else { return }

        switch msg.type {
        case "auth_ok":
            isConnected = true
            soulName = msg.name ?? "Soul"
        case "auth_error":
            isConnected = false
            disconnect()
        case "response":
            isTyping = false
            if let text = msg.text {
                messages.append(ChatMessage(role: "assistant", content: text, timestamp: msg.timestamp ?? ""))
            }
        case "pulse":
            if let activity = msg.activity, let label = msg.label {
                currentPulse = PulseInfo(type: activity, label: label)
            }
        case "typing":
            isTyping = true
        default:
            break
        }
    }
}

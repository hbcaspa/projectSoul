import SwiftUI

@main
struct SoulApp: App {
    @StateObject private var settings = Settings()
    @StateObject private var wsClient: WebSocketClient

    init() {
        let s = Settings()
        _settings = StateObject(wrappedValue: s)
        _wsClient = StateObject(wrappedValue: WebSocketClient(settings: s))
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(settings)
                .environmentObject(wsClient)
                .preferredColorScheme(.dark)
        }
    }
}

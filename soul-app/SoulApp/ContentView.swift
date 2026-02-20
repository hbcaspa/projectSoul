import SwiftUI

struct ContentView: View {
    @EnvironmentObject var settings: Settings
    @EnvironmentObject var wsClient: WebSocketClient
    @Environment(\.scenePhase) var scenePhase

    var body: some View {
        TabView {
            ChatView()
                .tabItem {
                    Label("Chat", systemImage: "message.fill")
                }

            StatusView()
                .tabItem {
                    Label("Status", systemImage: "waveform.path.ecg")
                }

            MemoriesView()
                .tabItem {
                    Label("Memories", systemImage: "book.fill")
                }

            HeartbeatView()
                .tabItem {
                    Label("Heartbeat", systemImage: "heart.fill")
                }

            SoulCardView()
                .tabItem {
                    Label("Soul", systemImage: "person.crop.rectangle.fill")
                }
        }
        .tint(SoulTheme.purple)
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .active && settings.isConfigured && !wsClient.isConnected {
                wsClient.connect()
            }
        }
    }
}

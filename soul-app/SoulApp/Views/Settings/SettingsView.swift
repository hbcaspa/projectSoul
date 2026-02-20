import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var settings: Settings
    @EnvironmentObject var wsClient: WebSocketClient
    @State private var connectionStatus: ConnectionStatus = .idle
    @Environment(\.dismiss) var dismiss

    enum ConnectionStatus {
        case idle, testing, success, failure
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack {
                        Image(systemName: "server.rack")
                            .foregroundColor(SoulTheme.purple)
                        TextField("http://localhost:3001", text: $settings.serverURL)
                            .textContentType(.URL)
                            .autocapitalization(.none)
                            .disableAutocorrection(true)
                    }
                } header: {
                    Text("Server URL")
                }

                Section {
                    HStack {
                        Image(systemName: "key.fill")
                            .foregroundColor(SoulTheme.purple)
                        SecureField("API Key", text: $settings.apiKey)
                            .autocapitalization(.none)
                            .disableAutocorrection(true)
                    }
                } header: {
                    Text("API Key")
                }

                Section {
                    Button(action: testConnection) {
                        HStack {
                            switch connectionStatus {
                            case .idle:
                                Image(systemName: "antenna.radiowaves.left.and.right")
                                Text("Test Connection")
                            case .testing:
                                ProgressView()
                                    .tint(SoulTheme.purple)
                                Text("Testing...")
                            case .success:
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundColor(.green)
                                Text("Connected!")
                            case .failure:
                                Image(systemName: "xmark.circle.fill")
                                    .foregroundColor(.red)
                                Text("Connection Failed")
                            }
                        }
                    }
                    .disabled(connectionStatus == .testing || !settings.isConfigured)
                }

                Section {
                    HStack {
                        Circle()
                            .fill(wsClient.isConnected ? .green : SoulTheme.textDim)
                            .frame(width: 8, height: 8)
                        Text(wsClient.isConnected ? "WebSocket Connected" : "WebSocket Disconnected")
                            .foregroundColor(SoulTheme.text)
                    }
                } header: {
                    Text("Live Connection")
                }

                Section {
                    Text("Soul Protocol v1.0")
                        .foregroundColor(SoulTheme.textDim)
                } header: {
                    Text("About")
                }
            }
            .scrollContentBackground(.hidden)
            .background(SoulTheme.background)
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done") { dismiss() }
                        .foregroundColor(SoulTheme.purple)
                }
            }
        }
    }

    private func testConnection() {
        connectionStatus = .testing
        Task {
            let client = APIClient(settings: settings)
            let ok = await client.testConnection()
            connectionStatus = ok ? .success : .failure

            if ok && !wsClient.isConnected {
                wsClient.connect()
            }

            try? await Task.sleep(nanoseconds: 3_000_000_000)
            if connectionStatus != .testing { connectionStatus = .idle }
        }
    }
}

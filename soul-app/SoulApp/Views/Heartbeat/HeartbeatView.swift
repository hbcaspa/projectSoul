import SwiftUI

struct HeartbeatView: View {
    @EnvironmentObject var settings: Settings
    @State private var dates: [String] = []
    @State private var entries: [(String, String)] = [] // (date, content)
    @State private var isLoading = true
    @State private var showSettings = false

    var body: some View {
        NavigationStack {
            ScrollView {
                if !entries.isEmpty {
                    LazyVStack(spacing: 16) {
                        ForEach(entries, id: \.0) { date, content in
                            HeartbeatCard(date: date, content: content)
                        }
                    }
                    .padding()
                } else if isLoading {
                    ProgressView()
                        .tint(SoulTheme.purple)
                        .padding(.top, 60)
                } else {
                    VStack(spacing: 12) {
                        Image(systemName: "heart.slash")
                            .font(.system(size: 40))
                            .foregroundColor(SoulTheme.heartbeatColor.opacity(0.4))
                        Text("No heartbeat logs yet")
                            .foregroundColor(SoulTheme.textDim)
                    }
                    .padding(.top, 60)
                }
            }
            .background(SoulTheme.background)
            .navigationTitle("Heartbeat")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showSettings = true } label: {
                        Image(systemName: "gearshape")
                            .foregroundColor(SoulTheme.purple)
                    }
                }
            }
            .sheet(isPresented: $showSettings) { SettingsView() }
            .task { await loadHeartbeats() }
            .refreshable { await loadHeartbeats() }
        }
    }

    private func loadHeartbeats() async {
        isLoading = true
        let client = APIClient(settings: settings)
        do {
            dates = try await client.fetchHeartbeatDates()
            var loaded: [(String, String)] = []
            for date in dates.prefix(10) {
                let content = try await client.fetchHeartbeat(date: date)
                loaded.append((date, content))
            }
            entries = loaded
        } catch { /* ignore */ }
        isLoading = false
    }
}

struct HeartbeatCard: View {
    let date: String
    let content: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Timeline dot + date
            HStack(spacing: 10) {
                Circle()
                    .fill(SoulTheme.heartbeatColor)
                    .frame(width: 10, height: 10)
                    .shadow(color: SoulTheme.heartbeatColor.opacity(0.5), radius: 4)

                Text(date)
                    .font(.subheadline.bold())
                    .foregroundColor(SoulTheme.heartbeatColor)

                Spacer()
            }

            // Content
            Text(content)
                .font(.system(.caption, design: .monospaced))
                .foregroundColor(SoulTheme.text.opacity(0.8))
                .lineLimit(20)
        }
        .padding()
        .soulCard(borderColor: SoulTheme.heartbeatColor.opacity(0.2))
    }
}

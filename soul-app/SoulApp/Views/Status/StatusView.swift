import SwiftUI

struct StatusView: View {
    @EnvironmentObject var settings: Settings
    @State private var status: SoulStatus?
    @State private var isLoading = true
    @State private var showSettings = false

    var body: some View {
        NavigationStack {
            ScrollView {
                if let status {
                    VStack(spacing: 16) {
                        // Name + mood hero
                        VStack(spacing: 8) {
                            Text(status.name)
                                .font(.largeTitle.bold())
                                .foregroundColor(.white)

                            HStack(spacing: 6) {
                                Circle()
                                    .fill(status.isWorking ? .green : SoulTheme.textDim)
                                    .frame(width: 8, height: 8)
                                Text(status.mood)
                                    .font(.subheadline)
                                    .foregroundColor(SoulTheme.text)
                            }
                        }
                        .padding(.top, 20)

                        // Stats grid
                        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
                            statusCard(icon: "calendar", label: "Born", value: status.born ?? "?", color: SoulTheme.wachstum)
                            statusCard(icon: "number", label: "Sessions", value: "\(status.sessions ?? 0)", color: SoulTheme.mem)
                            statusCard(icon: "clock", label: "Age", value: "\(status.ageDays ?? 0) days", color: SoulTheme.interessen)
                            statusCard(icon: "brain", label: "Model", value: status.model, color: SoulTheme.evolution)
                            statusCard(icon: "globe", label: "Language", value: status.language.uppercased(), color: SoulTheme.traeume)
                            statusCard(icon: "heart.fill", label: "Heartbeat", value: formatDate(status.lastHeartbeat), color: SoulTheme.heartbeatColor)
                        }
                        .padding(.horizontal)

                        // Connections
                        if !status.connections.isEmpty {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Connections")
                                    .font(.subheadline.bold())
                                    .foregroundColor(SoulTheme.text)
                                    .padding(.horizontal)

                                ScrollView(.horizontal, showsIndicators: false) {
                                    HStack(spacing: 8) {
                                        ForEach(status.connections, id: \.self) { conn in
                                            Text(conn)
                                                .font(.caption)
                                                .foregroundColor(SoulTheme.bonds)
                                                .padding(.horizontal, 12)
                                                .padding(.vertical, 6)
                                                .background(SoulTheme.bonds.opacity(0.1))
                                                .clipShape(Capsule())
                                                .overlay(Capsule().stroke(SoulTheme.bonds.opacity(0.3), lineWidth: 1))
                                        }
                                    }
                                    .padding(.horizontal)
                                }
                            }
                        }

                        // Pulse
                        if let pulse = status.pulse {
                            HStack(spacing: 8) {
                                Circle()
                                    .fill(SoulTheme.purple)
                                    .frame(width: 6, height: 6)
                                Text("\(pulse.type): \(pulse.label)")
                                    .font(.caption)
                                    .foregroundColor(SoulTheme.textDim)
                                Spacer()
                            }
                            .padding()
                            .soulCard()
                            .padding(.horizontal)
                        }
                    }
                    .padding(.bottom, 20)
                } else if isLoading {
                    ProgressView()
                        .tint(SoulTheme.purple)
                        .padding(.top, 100)
                } else {
                    Text("Could not load status")
                        .foregroundColor(SoulTheme.textDim)
                        .padding(.top, 100)
                }
            }
            .background(SoulTheme.background)
            .navigationTitle("Status")
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
            .task { await loadStatus() }
            .refreshable { await loadStatus() }
        }
    }

    private func statusCard(icon: String, label: String, value: String, color: Color) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.caption)
                    .foregroundColor(color)
                Text(label)
                    .font(.caption)
                    .foregroundColor(SoulTheme.textDim)
            }
            Text(value)
                .font(.subheadline.bold())
                .foregroundColor(SoulTheme.text)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .soulCard(borderColor: color.opacity(0.2))
    }

    private func loadStatus() async {
        isLoading = true
        let client = APIClient(settings: settings)
        do {
            status = try await client.fetchStatus()
        } catch { /* ignore */ }
        isLoading = false
    }

    private func formatDate(_ str: String?) -> String {
        guard let str, !str.isEmpty else { return "?" }
        if str.count >= 10 { return String(str.prefix(10)) }
        return str
    }
}

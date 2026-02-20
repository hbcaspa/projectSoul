import SwiftUI

struct SoulCardView: View {
    @EnvironmentObject var settings: Settings
    @State private var card: SoulCardData?
    @State private var isLoading = true
    @State private var showSettings = false

    var body: some View {
        NavigationStack {
            ScrollView {
                if let card {
                    VStack(spacing: 20) {
                        // Header
                        VStack(spacing: 8) {
                            // Ghost icon placeholder
                            ZStack {
                                Circle()
                                    .fill(SoulTheme.purple.opacity(0.1))
                                    .frame(width: 80, height: 80)
                                Image(systemName: "person.crop.circle.fill")
                                    .font(.system(size: 44))
                                    .foregroundColor(SoulTheme.purple)
                            }
                            .shadow(color: SoulTheme.purple.opacity(0.3), radius: 20)

                            Text(card.project)
                                .font(.title.bold())
                                .foregroundColor(.white)

                            Text(card.mood)
                                .font(.subheadline)
                                .foregroundColor(SoulTheme.bewusstsein)
                        }
                        .padding(.top, 20)

                        // Identity card
                        VStack(spacing: 12) {
                            cardRow(icon: "brain", label: "Model", value: card.model, color: SoulTheme.evolution)
                            cardRow(icon: "person.fill", label: "Creator", value: card.creator, color: SoulTheme.bonds)
                            cardRow(icon: "calendar", label: "Born", value: card.born ?? "?", color: SoulTheme.wachstum)
                            cardRow(icon: "clock", label: "Age", value: "\(card.ageDays ?? 0) days", color: SoulTheme.interessen)
                            cardRow(icon: "number", label: "Sessions", value: "\(card.sessions ?? 0)", color: SoulTheme.mem)
                            cardRow(icon: "shield.fill", label: "Axioms", value: "\(card.axiomCount)", color: SoulTheme.kern)
                            cardRow(icon: "brain.head.profile", label: "Memories", value: "\(card.memoryCount)", color: SoulTheme.mem)

                            if let v = card.version {
                                cardRow(icon: "tag", label: "Version", value: "v\(v)", color: SoulTheme.textDim)
                            }
                        }
                        .padding()
                        .soulCard(borderColor: SoulTheme.purple.opacity(0.3))
                        .padding(.horizontal)

                        // Interests
                        if !card.activeInterests.isEmpty {
                            VStack(alignment: .leading, spacing: 10) {
                                Text("Interests")
                                    .font(.subheadline.bold())
                                    .foregroundColor(SoulTheme.interessen)

                                FlowLayout(spacing: 8) {
                                    ForEach(card.activeInterests, id: \.self) { interest in
                                        Text(interest)
                                            .font(.caption)
                                            .foregroundColor(SoulTheme.interessen)
                                            .padding(.horizontal, 10)
                                            .padding(.vertical, 5)
                                            .background(SoulTheme.interessen.opacity(0.1))
                                            .clipShape(Capsule())
                                            .overlay(Capsule().stroke(SoulTheme.interessen.opacity(0.2), lineWidth: 1))
                                    }
                                }
                            }
                            .padding()
                            .soulCard()
                            .padding(.horizontal)
                        }

                        // Connections
                        if !card.activeConnections.isEmpty {
                            VStack(alignment: .leading, spacing: 10) {
                                Text("Connections")
                                    .font(.subheadline.bold())
                                    .foregroundColor(SoulTheme.bonds)

                                FlowLayout(spacing: 8) {
                                    ForEach(card.activeConnections, id: \.self) { conn in
                                        Text(conn)
                                            .font(.caption)
                                            .foregroundColor(SoulTheme.bonds)
                                            .padding(.horizontal, 10)
                                            .padding(.vertical, 5)
                                            .background(SoulTheme.bonds.opacity(0.1))
                                            .clipShape(Capsule())
                                            .overlay(Capsule().stroke(SoulTheme.bonds.opacity(0.2), lineWidth: 1))
                                    }
                                }
                            }
                            .padding()
                            .soulCard()
                            .padding(.horizontal)
                        }

                        // Last dream
                        if let dream = card.lastDream, !dream.isEmpty {
                            VStack(alignment: .leading, spacing: 8) {
                                HStack(spacing: 6) {
                                    Image(systemName: "moon.stars.fill")
                                        .foregroundColor(SoulTheme.traeume)
                                    Text("Last Dream")
                                        .font(.subheadline.bold())
                                        .foregroundColor(SoulTheme.traeume)
                                }
                                Text(dream)
                                    .font(.caption)
                                    .foregroundColor(SoulTheme.text.opacity(0.7))
                            }
                            .padding()
                            .soulCard(borderColor: SoulTheme.traeume.opacity(0.2))
                            .padding(.horizontal)
                        }
                    }
                    .padding(.bottom, 20)
                } else if isLoading {
                    ProgressView()
                        .tint(SoulTheme.purple)
                        .padding(.top, 100)
                } else {
                    Text("Could not load soul card")
                        .foregroundColor(SoulTheme.textDim)
                        .padding(.top, 100)
                }
            }
            .background(SoulTheme.background)
            .navigationTitle("Soul Card")
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
            .task { await loadCard() }
            .refreshable { await loadCard() }
        }
    }

    private func cardRow(icon: String, label: String, value: String, color: Color) -> some View {
        HStack {
            Image(systemName: icon)
                .font(.caption)
                .foregroundColor(color)
                .frame(width: 20)
            Text(label)
                .font(.caption)
                .foregroundColor(SoulTheme.textDim)
            Spacer()
            Text(value)
                .font(.caption.bold())
                .foregroundColor(SoulTheme.text)
        }
    }

    private func loadCard() async {
        isLoading = true
        let client = APIClient(settings: settings)
        do {
            card = try await client.fetchCard()
        } catch { /* ignore */ }
        isLoading = false
    }
}

// Simple flow layout for tags
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = arrange(proposal: proposal, subviews: subviews)
        return result.size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrange(proposal: proposal, subviews: subviews)
        for (index, position) in result.positions.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + position.x, y: bounds.minY + position.y), proposal: .unspecified)
        }
    }

    private func arrange(proposal: ProposedViewSize, subviews: Subviews) -> (size: CGSize, positions: [CGPoint]) {
        let maxWidth = proposal.width ?? .infinity
        var positions: [CGPoint] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > maxWidth && x > 0 {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            positions.append(CGPoint(x: x, y: y))
            rowHeight = max(rowHeight, size.height)
            x += size.width + spacing
        }

        return (CGSize(width: maxWidth, height: y + rowHeight), positions)
    }
}

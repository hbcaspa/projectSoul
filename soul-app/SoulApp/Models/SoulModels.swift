import Foundation

// MARK: - Status

struct SoulStatus: Codable {
    let name: String
    let mood: String
    let born: String?
    let sessions: Int?
    let ageDays: Int?
    let language: String
    let model: String
    let lastHeartbeat: String?
    let connections: [String]
    let isWorking: Bool
    let pulse: PulseInfo?
}

struct PulseInfo: Codable {
    let type: String
    let label: String
}

// MARK: - Card

struct SoulCardData: Codable {
    let project: String
    let model: String
    let creator: String
    let born: String?
    let sessions: Int?
    let ageDays: Int?
    let axiomCount: Int
    let mood: String
    let activeInterests: [String]
    let lastDream: String?
    let activeConnections: [String]
    let memoryCount: Int
    let version: String?
}

// MARK: - Seed

struct SeedData: Codable {
    let version: String?
    let born: String?
    let condensed: String?
    let sessions: Int?
    let blocks: [String: [String: String]]
}

// MARK: - Chat

struct ChatMessage: Identifiable, Codable, Equatable {
    var id = UUID()
    let role: String
    let content: String
    let timestamp: String
    var name: String?

    enum CodingKeys: String, CodingKey {
        case role, content, timestamp, name
    }

    init(role: String, content: String, timestamp: String = ISO8601DateFormatter().string(from: Date()), name: String? = nil) {
        self.role = role
        self.content = content
        self.timestamp = timestamp
        self.name = name
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        role = try container.decode(String.self, forKey: .role)
        content = try container.decode(String.self, forKey: .content)
        timestamp = try container.decodeIfPresent(String.self, forKey: .timestamp) ?? ""
        name = try container.decodeIfPresent(String.self, forKey: .name)
    }

    static func == (lhs: ChatMessage, rhs: ChatMessage) -> Bool {
        lhs.id == rhs.id
    }
}

// MARK: - Memories

struct DateList: Codable {
    let dates: [String]
}

struct MemoryContent: Codable {
    let date: String
    let content: String
}

// MARK: - WebSocket Messages

struct WSAuthMessage: Codable {
    let type: String
    let apiKey: String
}

struct WSChatMessage: Codable {
    let type: String
    let text: String
}

struct WSResponse: Codable {
    let type: String
    let text: String?
    let name: String?
    let message: String?
    let activity: String?
    let label: String?
    let timestamp: String?
}

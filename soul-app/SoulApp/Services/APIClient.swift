import Foundation

class APIClient {
    let settings: Settings

    init(settings: Settings) {
        self.settings = settings
    }

    private func request(_ path: String, method: String = "GET", body: Data? = nil) -> URLRequest? {
        guard let base = settings.baseURL else { return nil }
        let url = base.appendingPathComponent(path)
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("Bearer \(settings.apiKey)", forHTTPHeaderField: "Authorization")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.timeoutInterval = 60
        if let body { req.httpBody = body }
        return req
    }

    // MARK: - Status & Identity

    func fetchStatus() async throws -> SoulStatus {
        guard let req = request("/api/status") else { throw APIError.notConfigured }
        let (data, _) = try await URLSession.shared.data(for: req)
        return try JSONDecoder().decode(SoulStatus.self, from: data)
    }

    func fetchCard() async throws -> SoulCardData {
        guard let req = request("/api/card") else { throw APIError.notConfigured }
        let (data, _) = try await URLSession.shared.data(for: req)
        return try JSONDecoder().decode(SoulCardData.self, from: data)
    }

    func fetchSeed() async throws -> SeedData {
        guard let req = request("/api/seed") else { throw APIError.notConfigured }
        let (data, _) = try await URLSession.shared.data(for: req)
        return try JSONDecoder().decode(SeedData.self, from: data)
    }

    // MARK: - Memories

    func fetchDailyDates() async throws -> [String] {
        guard let req = request("/api/memories/daily") else { throw APIError.notConfigured }
        let (data, _) = try await URLSession.shared.data(for: req)
        let result = try JSONDecoder().decode(DateList.self, from: data)
        return result.dates
    }

    func fetchDaily(date: String) async throws -> String {
        guard let req = request("/api/memories/daily/\(date)") else { throw APIError.notConfigured }
        let (data, _) = try await URLSession.shared.data(for: req)
        let result = try JSONDecoder().decode(MemoryContent.self, from: data)
        return result.content
    }

    func fetchHeartbeatDates() async throws -> [String] {
        guard let req = request("/api/memories/heartbeat") else { throw APIError.notConfigured }
        let (data, _) = try await URLSession.shared.data(for: req)
        let result = try JSONDecoder().decode(DateList.self, from: data)
        return result.dates
    }

    func fetchHeartbeat(date: String) async throws -> String {
        guard let req = request("/api/memories/heartbeat/\(date)") else { throw APIError.notConfigured }
        let (data, _) = try await URLSession.shared.data(for: req)
        let result = try JSONDecoder().decode(MemoryContent.self, from: data)
        return result.content
    }

    // MARK: - Chat (HTTP fallback)

    func fetchChatHistory() async throws -> [ChatMessage] {
        guard let req = request("/api/chat/history") else { throw APIError.notConfigured }
        let (data, _) = try await URLSession.shared.data(for: req)
        return try JSONDecoder().decode([ChatMessage].self, from: data)
    }

    func sendMessage(_ text: String) async throws -> String {
        let body = try JSONEncoder().encode(["text": text])
        guard let req = request("/api/chat", method: "POST", body: body) else { throw APIError.notConfigured }
        let (data, _) = try await URLSession.shared.data(for: req)
        let result = try JSONDecoder().decode([String: String].self, from: data)
        return result["response"] ?? ""
    }

    // MARK: - Connection test

    func testConnection() async -> Bool {
        guard let req = request("/api/status") else { return false }
        do {
            let (_, response) = try await URLSession.shared.data(for: req)
            return (response as? HTTPURLResponse)?.statusCode == 200
        } catch {
            return false
        }
    }
}

enum APIError: LocalizedError {
    case notConfigured

    var errorDescription: String? {
        switch self {
        case .notConfigured: return "Server not configured. Set URL and API key in Settings."
        }
    }
}

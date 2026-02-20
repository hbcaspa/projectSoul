import Foundation
import SwiftUI

class Settings: ObservableObject {
    @Published var serverURL: String {
        didSet { UserDefaults.standard.set(serverURL, forKey: "serverURL") }
    }
    @Published var apiKey: String {
        didSet { UserDefaults.standard.set(apiKey, forKey: "apiKey") }
    }

    init() {
        self.serverURL = UserDefaults.standard.string(forKey: "serverURL") ?? "http://localhost:3001"
        self.apiKey = UserDefaults.standard.string(forKey: "apiKey") ?? ""
    }

    var isConfigured: Bool {
        !apiKey.isEmpty && baseURL != nil
    }

    var baseURL: URL? {
        URL(string: serverURL)
    }

    var wsURL: URL? {
        guard let base = baseURL else { return nil }
        var components = URLComponents(url: base, resolvingAgainstBaseURL: false)
        components?.scheme = base.scheme == "https" ? "wss" : "ws"
        components?.path = "/ws"
        return components?.url
    }
}

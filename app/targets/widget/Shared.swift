import Foundation
import UIKit

/// Values shared between the widget timeline and the goodnight AppIntent.
/// The React Native app writes these keys through `ExtensionStorage`
/// (`app/src/widgets/ios/sync.ts`).
enum WNS {
  static let appGroup = "group.com.copizza.whonotsleep"
  static let widgetKind = "WhoNotSleepWidget"
  static let defaultServer = "https://wns.168-231-73-244.sslip.io"
  static let deepLink = URL(string: "whonotsleep://room")!
  static let refreshInterval: TimeInterval = 10 * 60
  static let requestTimeout: TimeInterval = 8

  // Mirrors shared/protocol.js
  static let offlineAfterMs: Double = 90_000
  static let goodnightTtlMs: Double = 14 * 3_600_000

  static var defaults: UserDefaults? { UserDefaults(suiteName: appGroup) }
}

/// Session stored in the App Group by the app.
struct WNSSession {
  let serverUrl: String
  let roomCode: String
  let memberId: String
  let token: String
  let roomName: String
  let summary: String

  static func load() -> WNSSession? {
    guard let d = WNS.defaults else { return nil }
    // Room codes are ASCII alphanumerics (server route: /api/rooms/[A-Za-z0-9]+); anything
    // else is dropped so a bad value can never inject path segments or query strings.
    let code = String((d.string(forKey: "roomCode") ?? "").unicodeScalars
      .filter { $0.isASCII && CharacterSet.alphanumerics.contains($0) }
      .map(Character.init))
    let token = (d.string(forKey: "token") ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    guard !code.isEmpty, !token.isEmpty else { return nil }
    var server = (d.string(forKey: "serverUrl") ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    // Only send the bearer token to an http(s) origin.
    let lower = server.lowercased()
    if server.isEmpty || !(lower.hasPrefix("https://") || lower.hasPrefix("http://")) {
      server = WNS.defaultServer
    }
    while server.hasSuffix("/") { server.removeLast() }
    return WNSSession(
      serverUrl: server,
      roomCode: code,
      memberId: d.string(forKey: "memberId") ?? "",
      token: token,
      roomName: d.string(forKey: "roomName") ?? "",
      summary: d.string(forKey: "summary") ?? ""
    )
  }
}

/// Which pre-rendered scene layout to ask the server for (see shared/scene.js LAYOUTS).
enum SceneLayout: String {
  case small, wide, room

  var placeholderAsset: String {
    switch self {
    case .small: return "placeholder_small"
    case .wide: return "placeholder_wide"
    case .room: return "placeholder_room"
    }
  }

  /// Base pixel size of the layout; used for aspect ratio.
  var baseSize: CGSize {
    switch self {
    case .small: return CGSize(width: 96, height: 96)
    case .wide: return CGSize(width: 192, height: 88)
    case .room: return CGSize(width: 192, height: 120)
    }
  }
}

/// Status derived from `GET /api/rooms/:code` using the same rules as deriveScene().
struct RoomStatus {
  var roomName: String
  var online: Int
  var total: Int
  var owlNames: [String]
  var meSaidGoodnight: Bool
  /// My goodnightAt (ms epoch) from the server, nil if never / unknown.
  var meGoodnightAt: Double?

  var line: String {
    if !owlNames.isEmpty {
      let names = owlNames.prefix(2).joined(separator: "、")
      return "🦉 \(names)\(owlNames.count > 2 ? "等" : "") 还没睡！"
    }
    if total == 0 { return "房间空空" }
    return "\(online)/\(total) 在线"
  }

  static func parse(_ data: Data, memberId: String, now: Date = Date()) -> RoomStatus? {
    guard
      let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let room = root["room"] as? [String: Any]
    else { return nil }
    let nowMs = now.timeIntervalSince1970 * 1000
    let members = room["members"] as? [[String: Any]] ?? []
    var online = 0
    var owls: [String] = []
    var meGoodnight = false
    var meGoodnightAt: Double? = nil
    for m in members {
      let lastSeen = num(m["lastSeen"]) ?? 0
      let isOnline = nowMs - lastSeen < WNS.offlineAfterMs
      if isOnline { online += 1 }
      let status = isOnline ? (m["status"] as? String ?? "offline") : "offline"
      let goodnightAt = num(m["goodnightAt"])
      let saidGoodnight = goodnightAt.map { nowMs - $0 < WNS.goodnightTtlMs } ?? false
      let tz = num(m["tzOffset"]) ?? 0
      var mins = (nowMs / 60000 + tz).truncatingRemainder(dividingBy: 1440)
      if mins < 0 { mins += 1440 }
      let hour = mins / 60
      let night = hour >= 0 && hour < 6
      let statusSince = num(m["statusSince"]) ?? 0
      let owl = saidGoodnight && status == "working" && (night || statusSince > (goodnightAt ?? 0))
      if owl { owls.append(m["name"] as? String ?? "?") }
      if !memberId.isEmpty, (m["id"] as? String) == memberId {
        meGoodnight = saidGoodnight
        meGoodnightAt = goodnightAt
      }
    }
    return RoomStatus(
      roomName: room["name"] as? String ?? "",
      online: online,
      total: members.count,
      owlNames: owls,
      meSaidGoodnight: meGoodnight,
      meGoodnightAt: meGoodnightAt
    )
  }

  private static func num(_ v: Any?) -> Double? {
    if let n = v as? NSNumber { return n.doubleValue }
    if let d = v as? Double { return d }
    if let i = v as? Int { return Double(i) }
    return nil
  }
}

enum WNSError: Error {
  case noSession
  case badURL
  case http(Int)
}

/// Minimal HTTP client for the WhoNotSleep REST API.
enum WNSClient {
  static let session: URLSession = {
    let c = URLSessionConfiguration.ephemeral
    c.timeoutIntervalForRequest = WNS.requestTimeout
    c.timeoutIntervalForResource = WNS.requestTimeout
    c.requestCachePolicy = .reloadIgnoringLocalCacheData
    c.waitsForConnectivity = false
    return URLSession(configuration: c)
  }()

  /// Already sanitized to [A-Za-z0-9] in WNSSession.load().
  static func roomCodePath(_ s: WNSSession) -> String { s.roomCode }

  static func sceneURL(_ s: WNSSession, layout: SceneLayout) -> URL? {
    var c = URLComponents(string: "\(s.serverUrl)/api/rooms/\(roomCodePath(s))/scene.png")
    var items = [
      URLQueryItem(name: "layout", value: layout.rawValue),
      URLQueryItem(name: "scale", value: "4"),
    ]
    if !s.memberId.isEmpty { items.append(URLQueryItem(name: "focus", value: s.memberId)) }
    // No `t`: the server then uses its time bucket as animation time and can serve all
    // widgets of the room from its scene cache (an explicit t would force a fresh render
    // per request). The URLSession ignores local caches, so no cache-buster is needed.
    c?.queryItems = items
    return c?.url
  }

  static func fetchScene(_ s: WNSSession, layout: SceneLayout) async throws -> Data {
    guard let url = sceneURL(s, layout: layout) else { throw WNSError.badURL }
    var req = URLRequest(url: url, timeoutInterval: WNS.requestTimeout)
    req.setValue("image/png", forHTTPHeaderField: "Accept")
    let (data, resp) = try await session.data(for: req)
    try check(resp)
    return data
  }

  static func fetchRoom(_ s: WNSSession) async throws -> Data {
    guard let url = URL(string: "\(s.serverUrl)/api/rooms/\(roomCodePath(s))") else { throw WNSError.badURL }
    var req = URLRequest(url: url, timeoutInterval: WNS.requestTimeout)
    req.setValue("application/json", forHTTPHeaderField: "Accept")
    // GET /api/rooms/:code is public: don't attach the bearer token where it isn't needed.
    let (data, resp) = try await session.data(for: req)
    try check(resp)
    return data
  }

  static func goodnight(_ s: WNSSession) async throws {
    guard let url = URL(string: "\(s.serverUrl)/api/me/goodnight") else { throw WNSError.badURL }
    var req = URLRequest(url: url, timeoutInterval: WNS.requestTimeout)
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.setValue("Bearer \(s.token)", forHTTPHeaderField: "Authorization")
    req.httpBody = Data("{}".utf8)
    let (_, resp) = try await session.data(for: req)
    try check(resp)
  }

  private static func check(_ resp: URLResponse) throws {
    if let h = resp as? HTTPURLResponse, !(200..<300).contains(h.statusCode) {
      throw WNSError.http(h.statusCode)
    }
  }
}

/// Offline cache of the last good PNG + status line per layout, kept in the App Group container.
enum WNSCache {
  static var directory: URL? {
    guard
      let base = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: WNS.appGroup)
    else { return nil }
    let dir = base.appendingPathComponent("widget-cache", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
  }

  private static func key(_ s: WNSSession, _ layout: SceneLayout) -> String {
    // Bind cache to room + member so switching rooms never shows a stale room.
    let raw = "\(s.roomCode)-\(s.memberId)-\(layout.rawValue)"
    return raw.unicodeScalars.map { CharacterSet.alphanumerics.contains($0) || $0 == "-" ? String($0) : "_" }.joined()
  }

  static func savePNG(_ data: Data, _ s: WNSSession, _ layout: SceneLayout) {
    guard let dir = directory else { return }
    try? data.write(to: dir.appendingPathComponent("\(key(s, layout)).png"), options: .atomic)
  }

  static func loadPNG(_ s: WNSSession, _ layout: SceneLayout) -> Data? {
    guard let dir = directory else { return nil }
    return try? Data(contentsOf: dir.appendingPathComponent("\(key(s, layout)).png"))
  }

  static func saveStatus(_ line: String, _ s: WNSSession) {
    WNS.defaults?.set(line, forKey: "widgetStatus:\(s.roomCode)")
  }

  static func loadStatus(_ s: WNSSession) -> String? {
    WNS.defaults?.string(forKey: "widgetStatus:\(s.roomCode)")
  }

  /// Last known goodnightAt for this room+member (server truth when online, set
  /// optimistically by GoodnightIntent). 0 = not said / cleared (e.g. said morning).
  private static func goodnightKey(_ s: WNSSession) -> String {
    "widgetGoodnightAt:\(s.roomCode):\(s.memberId)"
  }

  static func saveGoodnightAt(_ ms: Double?, _ s: WNSSession) {
    if let ms, ms > 0 { WNS.defaults?.set(ms, forKey: goodnightKey(s)) }
    else { WNS.defaults?.removeObject(forKey: goodnightKey(s)) }
  }

  static func loadGoodnightAt(_ s: WNSSession) -> Double {
    WNS.defaults?.double(forKey: goodnightKey(s)) ?? 0
  }
}

/// Decodes PNG data, downsampling is unnecessary at scale=4 (max 768x480).
func decodeImage(_ data: Data?) -> UIImage? {
  guard let data, !data.isEmpty else { return nil }
  return UIImage(data: data)
}

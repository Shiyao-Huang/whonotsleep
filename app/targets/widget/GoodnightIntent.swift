import AppIntents
import Foundation
import WidgetKit

/// Interactive "晚安" button (iOS 17 `Button(intent:)`).
/// Runs inside the widget extension: POST /api/me/goodnight, then reload timelines.
struct GoodnightIntent: AppIntent {
  static let title: LocalizedStringResource = "说晚安"
  static let description = IntentDescription("告诉房间里的朋友你要睡了。")
  static let openAppWhenRun: Bool = false

  init() {}

  func perform() async throws -> some IntentResult {
    guard let session = WNSSession.load() else {
      throw WNSError.noSession
    }
    try await WNSClient.goodnight(session)
    // Optimistic flag so the next timeline shows "已晚安" even if the room fetch fails.
    WNSCache.saveGoodnightAt(Date().timeIntervalSince1970 * 1000, session)
    WidgetCenter.shared.reloadAllTimelines()
    return .result()
  }
}

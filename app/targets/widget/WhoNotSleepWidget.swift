import AppIntents
import SwiftUI
import WidgetKit

// MARK: - Palette

extension Color {
  init(hex: UInt32, opacity: Double = 1) {
    self.init(
      .sRGB,
      red: Double((hex >> 16) & 0xff) / 255,
      green: Double((hex >> 8) & 0xff) / 255,
      blue: Double(hex & 0xff) / 255,
      opacity: opacity
    )
  }
  static let wnsBackground = Color(hex: 0x0b0d1a)
  static let wnsPanel = Color(hex: 0x161a33)
  static let wnsAmber = Color(hex: 0xffc35a)
  static let wnsMoon = Color(hex: 0xa9b8ff)
  static let wnsText = Color(hex: 0xe8e9ff)
  static let wnsDim = Color(hex: 0x8a8fb5)
  static let wnsOwl = Color(hex: 0xff6b6b)
}

// MARK: - Timeline entry

struct WNSEntry: TimelineEntry {
  enum Kind { case noRoom, ready }

  let date: Date
  let kind: Kind
  let layout: SceneLayout
  let image: UIImage?
  let status: String
  let roomName: String
  let summary: String
  let hasOwls: Bool
  let meSaidGoodnight: Bool
  /// True when we are showing cached / placeholder art because the network failed.
  let stale: Bool

  static func empty(_ layout: SceneLayout) -> WNSEntry {
    WNSEntry(
      date: Date(), kind: .noRoom, layout: layout, image: nil, status: "", roomName: "",
      summary: "", hasOwls: false, meSaidGoodnight: false, stale: false)
  }

  static func sample(_ layout: SceneLayout) -> WNSEntry {
    WNSEntry(
      date: Date(), kind: .ready, layout: layout,
      image: UIImage(named: layout.placeholderAsset),
      // Matches the placeholder art (scripts/make-ios-widget-assets.mjs): one caught owl.
      status: "🦉 Me 还没睡！", roomName: "谁还没睡", summary: "",
      hasOwls: true, meSaidGoodnight: false, stale: false)
  }
}

// MARK: - Provider

struct WNSProvider: TimelineProvider {
  func placeholder(in context: Context) -> WNSEntry {
    .sample(layout(for: context.family))
  }

  func getSnapshot(in context: Context, completion: @escaping (WNSEntry) -> Void) {
    let layout = layout(for: context.family)
    if context.isPreview {
      // Widget gallery: must be fast. Use cache if we have a session, else sample art.
      if let s = WNSSession.load(), let img = decodeImage(WNSCache.loadPNG(s, layout)) {
        completion(cachedEntry(s, layout: layout, image: img, stale: false))
      } else {
        completion(.sample(layout))
      }
      return
    }
    Task {
      completion(await makeEntry(layout: layout))
    }
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<WNSEntry>) -> Void) {
    let layout = layout(for: context.family)
    Task {
      let entry = await makeEntry(layout: layout)
      let next = Date().addingTimeInterval(WNS.refreshInterval)
      completion(Timeline(entries: [entry], policy: .after(next)))
    }
  }

  private func layout(for family: WidgetFamily) -> SceneLayout {
    switch family {
    case .systemSmall: return .small
    case .systemMedium: return .wide
    default: return .room
    }
  }

  private func makeEntry(layout: SceneLayout) async -> WNSEntry {
    guard let s = WNSSession.load() else { return .empty(layout) }

    async let pngTask: Data? = try? WNSClient.fetchScene(s, layout: layout)
    async let roomTask: Data? = try? WNSClient.fetchRoom(s)
    let (png, roomData) = await (pngTask, roomTask)

    var image: UIImage? = nil
    var stale = false
    if let png, let img = decodeImage(png) {
      image = img
      WNSCache.savePNG(png, s, layout)
    } else {
      stale = true
      image = decodeImage(WNSCache.loadPNG(s, layout)) ?? UIImage(named: layout.placeholderAsset)
    }

    if let roomData, let status = RoomStatus.parse(roomData, memberId: s.memberId) {
      let line = status.line
      WNSCache.saveStatus(line, s)
      if !s.memberId.isEmpty { WNSCache.saveGoodnightAt(status.meGoodnightAt, s) }
      return WNSEntry(
        date: Date(), kind: .ready, layout: layout, image: image, status: line,
        roomName: status.roomName.isEmpty ? s.roomName : status.roomName,
        summary: s.summary, hasOwls: !status.owlNames.isEmpty,
        meSaidGoodnight: status.meSaidGoodnight, stale: stale)
    }
    return cachedEntry(s, layout: layout, image: image, stale: true)
  }

  private func cachedEntry(_ s: WNSSession, layout: SceneLayout, image: UIImage?, stale: Bool) -> WNSEntry {
    let nowMs = Date().timeIntervalSince1970 * 1000
    let gnAt = WNSCache.loadGoodnightAt(s)
    let status = WNSCache.loadStatus(s) ?? (s.summary.isEmpty ? "离线" : s.summary)
    return WNSEntry(
      date: Date(), kind: .ready, layout: layout, image: image,
      status: stale ? "⌁ \(status)" : status,
      roomName: s.roomName, summary: s.summary, hasOwls: status.contains("🦉"),
      meSaidGoodnight: gnAt > 0 && nowMs - gnAt < WNS.goodnightTtlMs, stale: stale)
  }
}

// MARK: - Building blocks

struct PixelScene: View {
  let image: UIImage?
  let layout: SceneLayout
  var contentMode: ContentMode = .fill

  var body: some View {
    if let image {
      if contentMode == .fill {
        // Fill without letting the oversized image dictate the layout size (which would
        // push the overlaid pill/button off-centre): size comes from the clear container.
        Color.clear
          .overlay {
            Image(uiImage: image)
              .interpolation(.none)
              .resizable()
              .aspectRatio(contentMode: .fill)
          }
          .clipped()
      } else {
        Image(uiImage: image)
          .interpolation(.none)
          .resizable()
          .aspectRatio(contentMode: .fit)
      }
    } else if contentMode == .fill {
      Color.wnsBackground
    } else {
      Color.wnsBackground
        .aspectRatio(layout.baseSize.width / layout.baseSize.height, contentMode: contentMode)
    }
  }
}

struct StatusPill: View {
  let text: String
  let hasOwls: Bool
  var size: CGFloat = 10

  var body: some View {
    Text(text)
      .font(.system(size: size, weight: .bold, design: .monospaced))
      .foregroundStyle(hasOwls ? Color.wnsOwl : Color.wnsText)
      .lineLimit(1)
      .minimumScaleFactor(0.7)
      .padding(.horizontal, 6)
      .padding(.vertical, 3)
      .background(Color.wnsBackground.opacity(0.78), in: RoundedRectangle(cornerRadius: 4))
  }
}

struct GoodnightButton: View {
  let said: Bool
  var compact: Bool = false

  var body: some View {
    Button(intent: GoodnightIntent()) {
      Group {
        if compact {
          Text(said ? "💤" : "🌙")
            .font(.system(size: 14))
            .frame(width: 26, height: 26)
        } else {
          Text(said ? "💤 已晚安" : "🌙 晚安")
            .font(.system(size: 12, weight: .bold, design: .monospaced))
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
        }
      }
      .foregroundStyle(said ? Color.wnsDim : Color.wnsBackground)
      .background(said ? Color.wnsPanel.opacity(0.9) : Color.wnsAmber, in: RoundedRectangle(cornerRadius: 6))
      .overlay(RoundedRectangle(cornerRadius: 6).stroke(Color.wnsBackground.opacity(0.6), lineWidth: 1))
    }
    .buttonStyle(.plain)
  }
}

struct EmptyStateView: View {
  let family: WidgetFamily

  var body: some View {
    VStack(spacing: 6) {
      Text("🌙")
        .font(.system(size: family == .systemSmall ? 28 : 36))
      Text("谁还没睡")
        .font(.system(size: 13, weight: .bold, design: .monospaced))
        .foregroundStyle(Color.wnsAmber)
      Text("打开 App 加入房间")
        .font(.system(size: 11, weight: .medium, design: .monospaced))
        .foregroundStyle(Color.wnsDim)
        .multilineTextAlignment(.center)
    }
    .padding(12)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}

// MARK: - Family views

struct SmallView: View {
  let entry: WNSEntry

  var body: some View {
    ZStack(alignment: .bottom) {
      PixelScene(image: entry.image, layout: .small)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipped()
      HStack(alignment: .bottom, spacing: 4) {
        StatusPill(text: entry.status, hasOwls: entry.hasOwls, size: 9)
        Spacer(minLength: 0)
        GoodnightButton(said: entry.meSaidGoodnight, compact: true)
      }
      .padding(6)
    }
  }
}

struct MediumView: View {
  let entry: WNSEntry

  var body: some View {
    ZStack(alignment: .bottom) {
      PixelScene(image: entry.image, layout: .wide)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipped()
      HStack(alignment: .bottom, spacing: 6) {
        VStack(alignment: .leading, spacing: 2) {
          if !entry.roomName.isEmpty {
            StatusPill(text: entry.roomName, hasOwls: false, size: 9)
          }
          StatusPill(text: entry.status, hasOwls: entry.hasOwls, size: 10)
        }
        Spacer(minLength: 0)
        GoodnightButton(said: entry.meSaidGoodnight)
      }
      .padding(8)
    }
  }
}

struct LargeView: View {
  let entry: WNSEntry

  var body: some View {
    VStack(spacing: 0) {
      PixelScene(image: entry.image, layout: .room, contentMode: .fit)
        .frame(maxWidth: .infinity)
      VStack(alignment: .leading, spacing: 6) {
        HStack {
          Text(entry.roomName.isEmpty ? "谁还没睡" : entry.roomName)
            .font(.system(size: 15, weight: .bold, design: .monospaced))
            .foregroundStyle(Color.wnsAmber)
            .lineLimit(1)
          Spacer(minLength: 4)
          Text(entry.date, style: .time)
            .font(.system(size: 10, design: .monospaced))
            .foregroundStyle(Color.wnsDim)
        }
        Text(entry.status)
          .font(.system(size: 13, weight: .semibold, design: .monospaced))
          .foregroundStyle(entry.hasOwls ? Color.wnsOwl : Color.wnsText)
          .lineLimit(1)
        if !entry.summary.isEmpty {
          Text(entry.summary)
            .font(.system(size: 11, design: .monospaced))
            .foregroundStyle(Color.wnsDim)
            .lineLimit(2)
        }
        Spacer(minLength: 0)
        HStack {
          Spacer()
          GoodnightButton(said: entry.meSaidGoodnight)
        }
      }
      .padding(12)
      .frame(maxHeight: .infinity, alignment: .top)
    }
  }
}

struct WNSWidgetView: View {
  @Environment(\.widgetFamily) private var family
  let entry: WNSEntry

  var body: some View {
    Group {
      if entry.kind == .noRoom {
        EmptyStateView(family: family)
      } else {
        switch family {
        case .systemSmall: SmallView(entry: entry)
        case .systemMedium: MediumView(entry: entry)
        default: LargeView(entry: entry)
        }
      }
    }
    .containerBackground(for: .widget) { Color.wnsBackground }
    .widgetURL(WNS.deepLink)
  }
}

// MARK: - Widget

struct WhoNotSleepWidget: Widget {
  let kind: String = WNS.widgetKind

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: WNSProvider()) { entry in
      WNSWidgetView(entry: entry)
    }
    .configurationDisplayName("谁还没睡")
    .description("像素小人房间：看看谁还在和 AI 熬夜。")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    .contentMarginsDisabled()
  }
}

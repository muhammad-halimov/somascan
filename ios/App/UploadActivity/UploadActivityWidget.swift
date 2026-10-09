import ActivityKit
import SwiftUI
import UIKit
import WidgetKit

/**
 * Расширение с Live Activity выгрузки в таблицу (iOS 16.2+): экран блокировки и Dynamic Island.
 * Данные и тексты присылает приложение (`UploadLiveActivity`), вид — системный: значок состояния,
 * заголовок, «Осталось записать: N», проценты и полоса прогресса (переходы между обновлениями система
 * анимирует сама).
 */
@main
struct UploadActivityBundle: WidgetBundle {
    var body: some Widget {
        UploadActivityWidget()
    }
}

struct UploadActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: UploadActivityAttributes.self) { context in
            UploadActivityLockScreen(context: context)
                .activitySystemActionForegroundColor(Palette.accent)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    StatusIcon(state: context.state)
                        .font(.title2)
                        .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Counter(state: context.state)
                        .font(.headline)
                        .padding(.trailing, 4)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.attributes.title)
                        .font(.headline)
                        .lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 6) {
                        ProgressView(value: context.state.fraction)
                            .tint(Palette.tint(context.state))
                        Text(context.state.subtitle)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                    .padding(.horizontal, 4)
                }
            } compactLeading: {
                StatusIcon(state: context.state)
            } compactTrailing: {
                Counter(state: context.state)
                    .foregroundStyle(Palette.tint(context.state))
            } minimal: {
                if context.state.finished {
                    StatusIcon(state: context.state)
                } else {
                    Gauge(value: context.state.fraction) {
                        EmptyView()
                    }
                    .gaugeStyle(.accessoryCircularCapacity)
                    .tint(Palette.accent)
                }
            }
            .keylineTint(Palette.accent)
        }
    }
}

/// Экран блокировки (и баннер на устройствах без Dynamic Island).
struct UploadActivityLockScreen: View {
    let context: ActivityViewContext<UploadActivityAttributes>

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                StatusIcon(state: context.state)
                    .font(.title2)
                VStack(alignment: .leading, spacing: 2) {
                    Text(context.attributes.title)
                        .font(.headline)
                        .lineLimit(1)
                    Text(context.state.subtitle)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                Spacer(minLength: 8)
                Counter(state: context.state)
                    .font(.headline)
            }
            ProgressView(value: context.state.fraction)
                .tint(Palette.tint(context.state))
        }
        .padding(16)
    }
}

/// Значок состояния: стрелка — пишется, галочка — записано всё, знак — не всё.
struct StatusIcon: View {
    let state: UploadActivityAttributes.ContentState

    var body: some View {
        Image(systemName: name)
            .symbolRenderingMode(.hierarchical)
            .foregroundStyle(Palette.tint(state))
    }

    private var name: String {
        if !state.finished {
            return "arrow.up.circle.fill"
        }
        return state.isComplete ? "checkmark.circle.fill" : "exclamationmark.triangle.fill"
    }
}

/// Счётчик справа цифрами одной ширины: проценты по ходу, «2/3» — если записано не всё.
struct Counter: View {
    let state: UploadActivityAttributes.ContentState

    var body: some View {
        Text(state.counter)
            .monospacedDigit()
            .lineLimit(1)
    }
}

/// Цвета приложения: акцент (как на экране приложения), итог — системные зелёный и оранжевый.
enum Palette {
    static let accent = Color(UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(red: 0xA7 / 255, green: 0xB4 / 255, blue: 0xFF / 255, alpha: 1)
            : UIColor(red: 0x53 / 255, green: 0x6D / 255, blue: 0xFE / 255, alpha: 1)
    })

    static func tint(_ state: UploadActivityAttributes.ContentState) -> Color {
        if !state.finished {
            return accent
        }
        return state.isComplete ? .green : .orange
    }
}

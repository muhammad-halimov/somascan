import Foundation
import UIKit
import Capacitor

/**
 * Синхронизирует нативную часть iOS с темой из настроек приложения (аналог Android-плагина).
 *
 * Веб-часть сама красится через CSS, но системные элементы — алерты (Dialog), панель действий
 * (ActionSheet), клавиатура и фон под WebView — следуют теме системы. Стиль окна
 * (`overrideUserInterfaceStyle`) подгоняет их все под тему, выбранную в приложении.
 */
@objc(NativeThemePlugin)
public class NativeThemePlugin: CAPInstancePlugin, CAPBridgedPlugin {
    public let identifier = "NativeThemePlugin"
    public let jsName = "NativeTheme"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setMode", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setWindowBackground", returnType: CAPPluginReturnPromise)
    ]

    /// Режим темы для системных элементов. Параметр `mode`: `system` | `light` | `dark`.
    @objc public func setMode(_ call: CAPPluginCall) {
        let mode = call.getString("mode") ?? "system"
        DispatchQueue.main.async { [weak self] in
            let style: UIUserInterfaceStyle = mode == "dark" ? .dark : (mode == "light" ? .light : .unspecified)
            self?.bridge?.viewController?.view.window?.overrideUserInterfaceStyle = style
            call.resolve()
        }
    }

    /// Фон WebView, его прокрутки и окна — цвет фона приложения (`--bg`): без вспышки системного
    /// цвета при анимации клавиатуры и смене темы. Параметр `background` — цвет `#rrggbb`.
    @objc public func setWindowBackground(_ call: CAPPluginCall) {
        guard let hex = call.getString("background"), let color = UIColor.capacitor.color(fromHex: hex) else {
            call.reject("Некорректный цвет: \(call.getString("background") ?? "")")
            return
        }
        DispatchQueue.main.async { [weak self] in
            self?.bridge?.webView?.backgroundColor = color
            self?.bridge?.webView?.scrollView.backgroundColor = color
            self?.bridge?.viewController?.view.backgroundColor = color
            self?.bridge?.viewController?.view.window?.backgroundColor = color
            call.resolve()
        }
    }
}

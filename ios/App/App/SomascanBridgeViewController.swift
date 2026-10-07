import UIKit
import WebKit
import Capacitor

/**
 * Мост Capacitor с нативными настройками WKWebView, которых нет в capacitor.config.ts,
 * и локальными плагинами iOS (аналог registerPlugin в MainActivity на Android).
 */
final class SomascanBridgeViewController: CAPBridgeViewController {

    /// webView и bridge уже созданы, страница ещё не загружена.
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(NativeThemePlugin())
        bridge?.registerPluginInstance(SmbSharePlugin())
        bridge?.registerPluginInstance(GoogleDriveAuthPlugin())
        bridge?.registerPluginInstance(NativeHttpPlugin())

        guard let webView = bridge?.webView else { return }
        let scrollView = webView.scrollView
        // Экран фиксированной высоты: документ не прокручивается и не пружинит, пружинят списки внутри.
        scrollView.bounces = false
        scrollView.alwaysBounceVertical = false
        scrollView.alwaysBounceHorizontal = false
        // Индикаторы прокрутки документа не нужны: у внутренних списков свои, их рисует WebKit.
        scrollView.showsVerticalScrollIndicator = false
        scrollView.showsHorizontalScrollIndicator = false
        // Долгое нажатие на ссылку не показывает предпросмотр страницы (дублирует ios.allowsLinkPreview).
        webView.allowsLinkPreview = false

        // Точная версия iOS до первого кадра: user-agent WKWebView не содержит версии системы,
        // а Device.getInfo() асинхронен — иначе первый кадр был бы в не том дизайне (glass/classic).
        let script = WKUserScript(
            source: "window.__somascanNative = { platform: 'ios', osVersion: '\(UIDevice.current.systemVersion)' };",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        webView.configuration.userContentController.addUserScript(script)
    }
}

import UIKit
import WebKit
import Capacitor

/**
 * Уменьшенный снимок экрана приложения (WKWebView) — для стекла окон «Настройки» и «Загрузки» (аналог Android-плагина).
 *
 * Под открытым окном экран неподвижен, поэтому стекло окна — один раз размытый снимок, а не размытие, которое
 * пересчитывается на каждом кадре движения внутри окна. Размывает снимок веб-часть.
 */
@objc(ScreenSnapshotPlugin)
public class ScreenSnapshotPlugin: CAPInstancePlugin, CAPBridgedPlugin {
    public let identifier = "ScreenSnapshotPlugin"
    public let jsName = "ScreenSnapshot"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "capture", returnType: CAPPluginReturnPromise)
    ]

    /// Снимок WebView размером `width` × `height` пикселей. Ответ: `image` — PNG в виде data URL.
    @objc public func capture(_ call: CAPPluginCall) {
        let width = call.getInt("width") ?? 0
        let height = call.getInt("height") ?? 0
        guard width > 0, height > 0 else {
            call.reject("Invalid snapshot size")
            return
        }
        DispatchQueue.main.async { [weak self] in
            guard let webView = self?.bridge?.webView, webView.bounds.width > 0 else {
                call.reject("WebView is not laid out")
                return
            }
            let size = CGSize(width: width, height: height)
            let configuration = WKSnapshotConfiguration()
            configuration.rect = webView.bounds
            // Ширина снимка — в точках: сразу примерно нужного размера, без снимка во всё разрешение экрана.
            configuration.snapshotWidth = NSNumber(value: Double(width) / Double(webView.window?.screen.scale ?? UIScreen.main.scale))
            // То, что уже на экране: окно ещё не открыто, ждать следующего кадра незачем.
            configuration.afterScreenUpdates = false
            webView.takeSnapshot(with: configuration) { snapshot, error in
                guard let snapshot else {
                    call.reject(error?.localizedDescription ?? "Snapshot failed")
                    return
                }
                let format = UIGraphicsImageRendererFormat()
                format.scale = 1
                format.opaque = true
                let image = UIGraphicsImageRenderer(size: size, format: format).image { _ in
                    snapshot.draw(in: CGRect(origin: .zero, size: size))
                }
                guard let png = image.pngData() else {
                    call.reject("PNG encoding failed")
                    return
                }
                call.resolve(["image": "data:image/png;base64," + png.base64EncodedString()])
            }
        }
    }
}

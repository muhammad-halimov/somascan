import UIKit
import Capacitor
import GoogleSignIn

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        // Подкласс моста: нативные настройки WKWebView и локальные плагины (см. SomascanBridgeViewController).
        let bridge = SomascanBridgeViewController()
        bridge.view.backgroundColor = .systemBackground
        window?.rootViewController = bridge
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        // Обратный вызов входа через Google (URL-схема com.googleusercontent.apps.…) обрабатывает SDK.
        let handled = URLContexts.filter { GIDSignIn.sharedInstance.handle($0.url) }
        guard handled.count < URLContexts.count else { return }
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts.subtracting(handled))
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }

    func sceneDidEnterBackground(_ scene: UIScene) {
        // Очередь выгрузки дописывается в фоне (UploadBackground).
        UploadBackground.shared.didEnterBackground()
    }

    func sceneWillEnterForeground(_ scene: UIScene) {
        UploadBackground.shared.willEnterForeground()
    }
}

import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.somascan.app',
  appName: 'Somascan',
  webDir: 'dist',
  ios: {
    // Отступы считает CSS через env(safe-area-inset-*); UIKit ничего не добавляет.
    contentInset: 'never',
    // Долгое нажатие на ссылку не показывает предпросмотр страницы (веб-поведение WKWebView).
    allowsLinkPreview: false,
    // На iPad WKWebView иначе выбирает «десктопный» режим (UA Macintosh, эмуляция наведения).
    preferredContentMode: 'mobile',
  },
  plugins: {
    // Безопасные зоны и системные панели ведёт встроенный плагин SystemBars: подсказка `cover`
    // убирает скачок раскладки на первом кадре (WebView сразу делается edge-to-edge).
    SystemBars: {
      initialViewportFitValueHint: 'cover',
      insetsHandling: 'css',
      style: 'DEFAULT',
    },
    Keyboard: {
      // iOS: WKWebView сжимается под клавиатуру, как Android с adjustResize — 100dvh и видимая область совпадают,
      // и WebKit не сдвигает страницу, чтобы показать поле. Панель «< > Готово» над клавиатурой плагин скрывает сам.
      resize: 'native',
      // Цвет окна под клавиатурой во время анимации — из фона страницы, без белой или чёрной полосы.
      autoBackdropColor: 'dom',
    },
    SplashScreen: {
      // Подстраховка: на iOS ручной SplashScreen.hide() может прийти раньше, чем сплэш
      // успеет показаться, и тогда он не скрывается вовсе. Поэтому сплэш скрывается сам
      // через 500 мс после загрузки; на Android приложение обычно скрывает его раньше.
      launchAutoHide: true,
      launchShowDuration: 500,
      launchFadeOutDuration: 180,
    },
  },
};

export default config;

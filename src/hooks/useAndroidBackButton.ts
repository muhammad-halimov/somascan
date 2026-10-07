import { useEffect } from 'react'
import { App as NativeApp } from '@capacitor/app'
import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { backHandlers } from '@/lib/navigation/BackHandlerStack'

/**
 * Обрабатывает аппаратную кнопку «Назад» на Android: сначала закрывается самый верхний открытый слой;
 * если ничего не открыто, происходит переход назад или выход из приложения. Ставится один раз, в корневом компоненте.
 */
export function useAndroidBackButton() {
  useEffect(() => {
    if (Capacitor.getPlatform() !== 'android') return
    let handle: PluginListenerHandle | undefined
    // Слушатель регистрируется асинхронно; эффект может быть очищен раньше.
    let active = true

    void NativeApp.addListener('backButton', ({ canGoBack }) => {
      if (backHandlers.handleBack()) return
      if (canGoBack) window.history.back()
      else void NativeApp.exitApp()
    }).then((result) => {
      handle = result
      if (!active) void result.remove()
    }).catch(() => undefined)

    return () => {
      active = false
      void handle?.remove()
    }
  }, [])
}

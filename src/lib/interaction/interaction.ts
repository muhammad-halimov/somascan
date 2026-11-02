/**
 * Поведение касаний как в нативном приложении.
 *
 * На сенсорных платформах (iOS и Android — в приложении и в браузере) отклик на нажатие
 * ведёт код, а не браузерные `:active`/`:hover`: это надёжнее в WebView и позволяет
 * повторить нативные паттерны (задержка в списках, отмена при прокрутке, волна Material,
 * подсветка UIKit). Признак режима — атрибут `<html data-press="js">`, на который
 * опираются стили. На десктопе остаются обычные `:hover`/`:active`.
 */
import { DesignFeedback } from './PressFeedback'
import { PressController } from './PressController'
import { TouchDiscipline } from './TouchDiscipline'

/** Запускает контроллер нажатий и правила касаний. Вызывается один раз после `initPlatform()`. */
export function initInteraction() {
  const root = document.documentElement
  if (root.dataset.platform === 'web') return
  // подсветка или волна — по оформлению в момент нажатия (оформление меняется в настройках без перезапуска)
  new PressController(new DesignFeedback()).attach()
  new TouchDiscipline().attach()
  root.dataset.press = 'js'
}

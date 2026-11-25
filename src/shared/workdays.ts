/**
 * Рабочие дни: понедельник–пятница; выходные (суббота и воскресенье) в сроках между датами таблиц не считаются.
 * Даты — полночь UTC, как даты Excel в таблицах.
 */

/** Миллисекунд в сутках. */
const DAY_MS = 864e5

/** Суббота или воскресенье. */
export const isWeekend = (date: Date): boolean => date.getUTCDay() === 0 || date.getUTCDay() === 6

/**
 * Сколько рабочих дней после `from` по `to` включительно: пятница → понедельник — 1, тот же день — 0.
 * `to` раньше `from` — число со знаком минус.
 */
export function workdaysBetween(from: Date, to: Date): number {
  const days = Math.round((to.getTime() - from.getTime()) / DAY_MS)
  if (days < 0) return -workdaysBetween(to, from)
  const weeks = Math.floor(days / 7)
  let count = weeks * 5
  for (let i = weeks * 7 + 1; i <= days; i++) if (!isWeekend(new Date(from.getTime() + i * DAY_MS))) count++
  return count
}

/** Самая ранняя дата, от которой до `to` не больше `workdays` рабочих дней (начало окна срока). */
export function workdaysBefore(to: Date, workdays: number): Date {
  let date = to
  for (;;) {
    const prev = new Date(date.getTime() - DAY_MS)
    if (workdaysBetween(prev, to) > workdays) return date
    date = prev
  }
}

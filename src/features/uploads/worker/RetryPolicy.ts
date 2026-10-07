/**
 * Пауза перед повторной попыткой записи: растёт с каждой неудачей и упирается в потолок.
 * Временные сбои (нет сети, таблица занята) повторяются бесконечно — до успеха или удаления записи.
 */
export class RetryPolicy {
  /** Паузы по умолчанию: 15 с, 30 с, 1, 2, 5, 10 и далее каждые 15 минут. */
  static readonly DEFAULT_DELAYS_MS: readonly number[] = [15_000, 30_000, 60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000, 15 * 60_000]

  /** Паузы по номеру неудачной попытки; последняя повторяется. */
  private readonly delays: readonly number[]

  /** @param delays Паузы по номеру неудачной попытки (с первой). */
  constructor(delays: readonly number[] = RetryPolicy.DEFAULT_DELAYS_MS) {
    this.delays = delays
  }

  /** Пауза после `attempt`-й неудачной попытки (с единицы), мс. */
  delayFor(attempt: number): number {
    const index = Math.min(Math.max(attempt, 1), this.delays.length) - 1
    return this.delays[index]!
  }
}

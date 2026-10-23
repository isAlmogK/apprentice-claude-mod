export const CARDS_PER_HOUR = 6
export const HOUR_MS = 3_600_000

export function cardsWithinHour(times: number[], now: number): number[] {
  return times.filter(t => now - t < HOUR_MS)
}

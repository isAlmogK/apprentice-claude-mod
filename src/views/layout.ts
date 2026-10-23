import type { Area } from '../core/types.ts'

export const MAP_WIDTH = 640
export const MAP_HEIGHT = 300
const GOLDEN_ANGLE = 2.399963

export type Star = { id: string; x: number; y: number; r: number }

const clamp = (x: number, low: number, high: number) => Math.min(high, Math.max(low, x))

// Sorted by id so the same areas always land in the same places.
export function layoutStars(areas: Area[]): Star[] {
  const total = areas.reduce((sum, a) => sum + a.lines, 0) || 1
  const ordered = [...areas].sort((a, b) => a.id.localeCompare(b.id))
  return ordered.map((a, i) => {
    const t = Math.sqrt((i + 0.5) / ordered.length)
    const angle = i * GOLDEN_ANGLE
    const x = clamp(MAP_WIDTH / 2 + Math.cos(angle) * t * 250, 60, MAP_WIDTH - 60)
    const y = clamp(MAP_HEIGHT / 2 - 20 + Math.sin(angle) * t * 95, 40, MAP_HEIGHT - 70)
    return { id: a.id, x: Math.round(x), y: Math.round(y), r: Math.round(8 + 24 * Math.sqrt(a.lines / total)) }
  })
}

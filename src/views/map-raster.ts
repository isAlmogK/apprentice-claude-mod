import type { Area } from '../core/types.ts'
import { MAP_HEIGHT, MAP_WIDTH, type Star } from './layout.ts'

export const DEFAULT_COLOR = 0x01000000
export const RASTER_ROWS = 12
const BRIGHT = 0x5dcaa5
const MID = 0x1d9e75
const DIM = 0x5f5e5a

export type Cell = { char: string; color: number }

export function starColor(score: number): number {
  if (score >= 0.66) return BRIGHT
  if (score >= 0.33) return MID
  return DIM
}

export function rasterGrid(areas: Area[], stars: Star[], columns: number, rows: number): Cell[][] {
  const grid: Cell[][] = Array.from({ length: rows }, () =>
    Array.from({ length: columns }, () => ({ char: ' ', color: DEFAULT_COLOR })))
  const byId = new Map(areas.map(a => [a.id, a]))
  for (const s of stars) {
    const a = byId.get(s.id)
    if (!a) continue
    const col = Math.round((s.x / MAP_WIDTH) * (columns - 1))
    const row = Math.round((s.y / MAP_HEIGHT) * (rows - 1))
    grid[row][col] = { char: a.editsSinceLooked > 0 ? '○' : '●', color: starColor(a.score) }
  }
  return grid
}

export function encodeCells(grid: Cell[][]): string {
  const numbers = grid.flat().flatMap(c => [c.char.codePointAt(0) ?? 32, c.color, DEFAULT_COLOR])
  // Uint8Array.prototype.toBase64 is an ES2025 method; the mods runtime has it.
  return (new Uint8Array(Uint32Array.from(numbers).buffer) as any).toBase64()
}

export function rasterCells(areas: Area[], stars: Star[], columns: number, rows: number): string {
  return encodeCells(rasterGrid(areas, stars, columns, rows))
}

import type { Area } from '../core/types.ts'

export const MAP_WIDTH = 640
export const MAP_HEIGHT = 300
// From a circle's bottom edge to the bottom of its label: the name (13px) and the percent line (11px).
export const LABEL_HEIGHT = 36
const GOLDEN_ANGLE = 2.399963
const PAD = 4
// A wide estimate for 13px bold sans-serif, so a label is never drawn wider than its room.
const NAME_CHAR_WIDTH = 8
// Room for the widest percent line, "100% · 99 new".
const DETAIL_WIDTH = 90

// label: the name as drawn, cut short with "…" when it doesn't fit. w: the label's width.
export type Star = { id: string; x: number; y: number; r: number; label: string; w: number }

const clamp = (x: number, low: number, high: number) => Math.min(high, Math.max(low, x))

function rowsFor(n: number): number {
  if (n <= 3) return 1
  if (n <= 8) return 2
  return 3
}

function fitLabel(name: string, room: number): string {
  const chars = Math.floor(room / NAME_CHAR_WIDTH)
  return name.length <= chars ? name : name.slice(0, Math.max(1, chars - 1)).trimEnd() + '…'
}

// Each star gets its own cell in a grid, so circles and labels never overlap. Inside its cell a star is
// nudged by a fixed amount per position, so the map reads as a sky rather than a table.
// Sorted by id so the same areas always land in the same places.
export function layoutStars(areas: Area[]): Star[] {
  const total = areas.reduce((sum, a) => sum + a.lines, 0) || 1
  const ordered = [...areas].sort((a, b) => a.id.localeCompare(b.id))
  const rows = rowsFor(ordered.length)
  const columns = Math.ceil(ordered.length / rows) || 1
  const cellW = MAP_WIDTH / columns
  const cellH = MAP_HEIGHT / rows
  const maxR = Math.floor(Math.min((cellH - LABEL_HEIGHT) / 2 - PAD, cellW / 2 - PAD, 32))
  return ordered.map((a, i) => {
    const row = Math.floor(i / columns)
    const inRow = Math.min(columns, ordered.length - row * columns)
    // A short last row is centered.
    const left = ((columns - inRow) * cellW) / 2 + (i - row * columns) * cellW
    const top = row * cellH
    const r = Math.min(maxR, Math.round(8 + 24 * Math.sqrt(a.lines / total)))
    const label = fitLabel(a.name, cellW - 2 * PAD)
    const w = Math.max(label.length * NAME_CHAR_WIDTH, DETAIL_WIDTH)
    const half = Math.max(r, w / 2)
    const xLow = left + PAD + half
    const xHigh = left + cellW - PAD - half
    const yLow = top + PAD + r
    const yHigh = top + cellH - PAD - LABEL_HEIGHT - r
    const x = (xLow + xHigh) / 2 + Math.sin(i * GOLDEN_ANGLE) * 0.7 * ((xHigh - xLow) / 2)
    const y = (yLow + yHigh) / 2 + Math.cos(i * GOLDEN_ANGLE) * 0.6 * ((yHigh - yLow) / 2)
    return {
      id: a.id,
      x: Math.round(clamp(x, xLow, xHigh)),
      y: Math.round(clamp(y, yLow, yHigh)),
      r,
      label,
      w,
    }
  })
}

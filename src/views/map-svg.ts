import type { Area } from '../core/types.ts'
import { knownPercent } from '../core/understanding.ts'
import { MAP_HEIGHT, MAP_WIDTH, type Star } from './layout.ts'

// The SVG is drawn as an image, outside the app's theme, so colors are mid-tones that read on light and dark.
const TEAL = '#1D9E75'
const GRAY = '#888780'

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function mapSvg(areas: Area[], stars: Star[]): string {
  const byId = new Map(areas.map(a => [a.id, a]))
  const parts = stars.map(s => {
    const a = byId.get(s.id)
    if (!a) return ''
    const changed = a.editsSinceLooked > 0
    const circle =
      `<circle cx="${s.x}" cy="${s.y}" r="${s.r}" fill="${TEAL}" fill-opacity="${(0.12 + 0.88 * a.score).toFixed(2)}" ` +
      `stroke="${changed ? GRAY : TEAL}" stroke-width="1.5"${changed ? ' stroke-dasharray="4 3"' : ''}/>`
    const name =
      `<text x="${s.x}" y="${s.y + s.r + 16}" text-anchor="middle" font-size="13" font-weight="600" fill="${GRAY}">${escapeXml(s.label)}</text>`
    const detail =
      `<text x="${s.x}" y="${s.y + s.r + 31}" text-anchor="middle" font-size="11" fill="${GRAY}">` +
      `${Math.round(a.score * 100)}%${changed ? ` · ${a.editsSinceLooked} new` : ''}</text>`
    return circle + name + detail
  })
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MAP_WIDTH} ${MAP_HEIGHT}" width="${MAP_WIDTH}" height="${MAP_HEIGHT}" font-family="sans-serif">` +
    parts.join('') +
    '</svg>'
  )
}

export function mapAlt(areas: Area[]): string {
  return `Knowledge map of ${areas.length} areas: you know ${knownPercent(areas)}% of the code as it is today`
}

import { expect, test } from 'claude-code/testing'
import type { Area } from '../src/core/types.ts'
import { LABEL_HEIGHT, MAP_HEIGHT, MAP_WIDTH, layoutStars, type Star } from '../src/views/layout.ts'
import { escapeXml, mapAlt, mapSvg } from '../src/views/map-svg.ts'
import { DEFAULT_COLOR, encodeCells, rasterGrid, starColor } from '../src/views/map-raster.ts'

const area = (id: string, over: Partial<Area> = {}): Area => ({
  id, name: id, paths: [`${id}/`], lines: 100, score: 0.5, editsSinceLooked: 0, level: 'mid', streak: 0, ...over,
})
const areas = [area('auth', { score: 0.92, lines: 300 }), area('billing', { score: 0.31, editsSinceLooked: 14, name: 'Billing & Co' }), area('docs', { score: 0.1 })]

test('layoutStars is stable and sizes stars by their share of lines', async () => {
  const stars = layoutStars(areas)
  expect(layoutStars([...areas].reverse())).toEqual(stars)
  expect(stars.map(s => s.id)).toEqual(['auth', 'billing', 'docs'])
  expect(stars[0].r > stars[2].r).toBe(true)
})

// A star takes its circle plus the label under it: the name and the percent line.
type Box = [number, number, number, number]
const boxesOf = (s: Star): Box[] => [
  [s.x - s.r, s.y - s.r, s.x + s.r, s.y + s.r],
  [s.x - s.w / 2, s.y + s.r, s.x + s.w / 2, s.y + s.r + LABEL_HEIGHT],
]
const overlaps = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]
const NAMES = ['Billing', 'Auth', 'API routes', 'Web app', 'Database', 'Background jobs and scheduled workers', 'Root files', 'Other',
  'Payments', 'Search', 'Notifications', 'Admin dashboard', 'Infrastructure', 'Mobile app', 'Shared UI components']

test('layoutStars keeps every star and label inside the map and apart from the others', async () => {
  for (let n = 1; n <= 15; n++) {
    // One large area and many small ones, the hardest case for star sizes.
    const set = NAMES.slice(0, n).map((name, i) => area(`a${String(i).padStart(2, '0')}`, { name, lines: i === 0 ? 20000 : 150 + i * 97 }))
    const stars = layoutStars(set)
    expect(stars.length).toBe(n)
    for (const s of stars) {
      for (const [x1, y1, x2, y2] of boxesOf(s)) {
        expect(x1 >= 0 && y1 >= 0 && x2 <= MAP_WIDTH && y2 <= MAP_HEIGHT).toBe(true)
      }
    }
    for (let i = 0; i < stars.length; i++) {
      for (let j = i + 1; j < stars.length; j++) {
        for (const a of boxesOf(stars[i])) for (const b of boxesOf(stars[j])) expect(overlaps(a, b)).toBe(false)
      }
    }
  }
})

test('a name too long for its room is cut short', async () => {
  const set = NAMES.map((name, i) => area(`a${String(i).padStart(2, '0')}`, { name }))
  const long = layoutStars(set).find(s => s.id === 'a05')!
  expect(long.label.endsWith('…')).toBe(true)
  expect(NAMES[5].startsWith(long.label.slice(0, -1))).toBe(true)
  expect(mapSvg(set, layoutStars(set))).toContain(`>${long.label}</text>`)
  expect(layoutStars([area('a', { name: 'Billing' })])[0].label).toBe('Billing')
})

test('mapSvg draws a star per area, dashed when Claude changed it', async () => {
  const svg = mapSvg(areas, layoutStars(areas))
  expect(svg.startsWith('<svg')).toBe(true)
  expect(svg.match(/<circle/g)?.length).toBe(3)
  expect(svg).toContain('Billing &amp; Co')
  expect(svg).toContain('31% · 14 new')
  expect(svg.match(/stroke-dasharray/g)?.length).toBe(1)
  expect(escapeXml('<a "b">')).toBe('&lt;a &quot;b&quot;&gt;')
})

test('mapAlt states the headline', async () => {
  // (0.92 × 300 + 0.31 × 100 + 0.1 × 100) ÷ 500 = 0.634
  expect(mapAlt(areas)).toBe('Knowledge map of 3 areas: you know 63% of the code as it is today')
})

test('rasterGrid places one cell per star and colors it by score', async () => {
  const grid = rasterGrid(areas, layoutStars(areas), 60, 12)
  expect(grid.length).toBe(12)
  expect(grid[0].length).toBe(60)
  const marks = grid.flat().filter(c => c.char !== ' ')
  expect(marks.length).toBe(3)
  expect(marks.filter(c => c.char === '○').length).toBe(1)
  expect(starColor(0.9)).toBe(0x5dcaa5)
  expect(starColor(0.5)).toBe(0x1d9e75)
  expect(starColor(0.1)).toBe(0x5f5e5a)
  expect(grid[0].find(c => c.char === ' ')?.color).toBe(DEFAULT_COLOR)
})

test('encodeCells packs three 32-bit numbers per cell', async () => {
  const encoded = encodeCells([[{ char: 'A', color: 0x112233 }]])
  const bytes = (Uint8Array as any).fromBase64(encoded) as Uint8Array
  expect([...new Uint32Array(bytes.buffer)]).toEqual([65, 0x112233, DEFAULT_COLOR])
})

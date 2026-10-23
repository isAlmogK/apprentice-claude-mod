import { expect, test } from 'claude-code/testing'
import type { Area } from '../src/core/types.ts'
import { MAP_HEIGHT, MAP_WIDTH, layoutStars } from '../src/views/layout.ts'
import { escapeXml, mapAlt, mapSvg } from '../src/views/map-svg.ts'
import { DEFAULT_COLOR, encodeCells, rasterGrid, starColor } from '../src/views/map-raster.ts'

const area = (id: string, over: Partial<Area> = {}): Area => ({
  id, name: id, paths: [`${id}/`], lines: 100, score: 0.5, editsSinceLooked: 0, level: 'mid', streak: 0, ...over,
})
const areas = [area('auth', { score: 0.92, lines: 300 }), area('billing', { score: 0.31, editsSinceLooked: 14, name: 'Billing & Co' }), area('docs', { score: 0.1 })]

test('layoutStars is stable and stays inside the map', async () => {
  const stars = layoutStars(areas)
  expect(layoutStars([...areas].reverse())).toEqual(stars)
  expect(stars.map(s => s.id)).toEqual(['auth', 'billing', 'docs'])
  for (const s of stars) {
    expect(s.x >= 60 && s.x <= MAP_WIDTH - 60).toBe(true)
    expect(s.y >= 40 && s.y <= MAP_HEIGHT - 70).toBe(true)
  }
  expect(stars[0].r > stars[2].r).toBe(true)
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

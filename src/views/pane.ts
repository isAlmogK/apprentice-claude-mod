import type { Area, Card } from '../core/types.ts'
import { knownPercent } from '../core/understanding.ts'
import { line, type Elements } from './elements.ts'
import { layoutStars } from './layout.ts'
import { RASTER_ROWS, rasterCells } from './map-raster.ts'
import { mapAlt, mapSvg } from './map-svg.ts'

export type PaneStatus = 'no-git' | 'idle' | 'mapping' | 'ready' | 'failed'

export type PaneModel = {
  surface: string
  status: PaneStatus
  progress: string
  error: string
  repoName: string
  areas: Area[]
  selectedId: string | null
  pending: Card[]
  columns: number
}

export type PaneHandlers = {
  onSelect: (id: string | null) => void
  onRename: (id: string, name: string) => void
  onMerge: (fromId: string, intoId: string) => void
  onRestore: (index: number) => void
}

export function areaLabel(a: Area): string {
  const base = `${a.name} · ${Math.round(a.score * 100)}%`
  if (a.editsSinceLooked === 0) return base
  const edits = a.editsSinceLooked === 1 ? '1 Claude edit' : `${a.editsSinceLooked} Claude edits`
  return `${base} · ${edits} since you looked`
}

function cardTitle(card: Card): string {
  const text = card.kind === 'question' ? card.question : `Spot the flaw in ${card.file}`
  return text.length > 70 ? text.slice(0, 69) + '…' : text
}

function mapElement(E: Elements, m: PaneModel): unknown | null {
  const stars = layoutStars(m.areas)
  if (m.surface === 'desktop' && E.Svg) return E.Svg({ source: mapSvg(m.areas, stars), alt: mapAlt(m.areas) })
  if (m.surface === 'terminal' && E.Raster) {
    return E.Raster({ key: 'map', columns: m.columns, rows: RASTER_ROWS, cells: rasterCells(m.areas, stars, m.columns, RASTER_ROWS) })
  }
  return null
}

function details(E: Elements, m: PaneModel, a: Area, h: PaneHandlers): unknown {
  const others = m.areas.filter(o => o.id !== a.id)
  const children: unknown[] = [line(E, a.name, { bold: true })]
  if (E.Input) {
    children.push(E.Input({ key: 'rename', label: 'Rename', value: a.name, submitLabel: 'rename', onSubmit: (value: string) => h.onRename(a.id, value) }))
  }
  if (E.Select && others.length > 0) {
    children.push(E.Select({
      key: 'merge', label: 'Merge into',
      options: others.map(o => ({ value: o.id, label: o.name })),
      onSelect: (value: string) => h.onMerge(a.id, value),
    }))
  }
  if (m.pending.length > 0) {
    children.push(line(E, 'Skipped cards', { dimColor: true }))
    m.pending.forEach((card, i) => {
      children.push(E.Button({ key: `pending-${i}`, label: cardTitle(card), plain: true, onPress: () => h.onRestore(i) }))
    })
  }
  children.push(E.Button({ key: 'close-area', label: 'Close', plain: true, dimColor: true, onPress: () => h.onSelect(null) }))
  return E.Box({ flexDirection: 'column', borderStyle: 'round', paddingX: 1, children })
}

export function renderPane(E: Elements, m: PaneModel, h: PaneHandlers): unknown {
  const column = (children: unknown[]) => E.Box({ flexDirection: 'column', children })
  if (m.surface === 'vscode') return column([line(E, 'Apprentice supports the Desktop app and the terminal.')])
  if (m.status === 'no-git') return column([line(E, 'Apprentice needs a git repo.')])
  if (m.status === 'failed') return column([line(E, m.error), line(E, 'Run /apprentice remap to try again.', { dimColor: true })])
  if (m.areas.length === 0) return column([line(E, m.status === 'idle' ? 'Run /apprentice to map this repo.' : m.progress)])

  const children: unknown[] = [
    E.Box({
      flexDirection: 'row', columnGap: 2,
      children: [line(E, m.repoName, { bold: true }), line(E, `You know ${knownPercent(m.areas)}% of the code as it is today`)],
    }),
  ]
  const map = mapElement(E, m)
  if (map) children.push(map)
  children.push(line(E, m.surface === 'terminal'
    ? '● you know it · ○ Claude changed it since'
    : 'Bright: you know it · Dashed: Claude changed it since', { dimColor: true }))
  if (m.status === 'mapping') children.push(line(E, m.progress, { dimColor: true }))
  for (const a of [...m.areas].sort((x, y) => y.lines - x.lines || x.id.localeCompare(y.id))) {
    children.push(E.Button({ key: `area-${a.id}`, label: areaLabel(a), plain: true, onPress: () => h.onSelect(a.id) }))
  }
  const selected = m.areas.find(a => a.id === m.selectedId)
  if (selected) children.push(details(E, m, selected, h))
  return column(children)
}

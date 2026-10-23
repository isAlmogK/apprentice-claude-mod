import { expect, test } from 'claude-code/testing'
import type { Area, QuestionCard } from '../src/core/types.ts'
import { areaLabel, renderPane, type PaneModel } from '../src/views/pane.ts'
import { renderWrapped } from '../src/views/wrapped.ts'
import { byKey, fakeElements, textsOf, walk } from './helpers.ts'

const area = (id: string, over: Partial<Area> = {}): Area => ({
  id, name: id, paths: [`${id}/`], lines: 100, score: 0.5, editsSinceLooked: 0, level: 'mid', streak: 0, ...over,
})
const areas = [area('auth', { name: 'Auth', score: 0.92, lines: 300 }), area('billing', { name: 'Billing', score: 0.31, editsSinceLooked: 14 })]
const model = (over: Partial<PaneModel> = {}): PaneModel => ({
  surface: 'desktop', status: 'ready', progress: '', error: '', repoName: 'dogbase', areas, selectedId: null, pending: [], columns: 60, ...over,
})
const events: string[] = []
const handlers = {
  onSelect: (id: string | null) => events.push('select ' + id),
  onRename: (id: string, name: string) => events.push(`rename ${id} ${name}`),
  onMerge: (from: string, into: string) => events.push(`merge ${from} ${into}`),
  onRestore: (i: number) => events.push('restore ' + i),
}

test('areaLabel mentions Claude edits only when there are some', async () => {
  expect(areaLabel(areas[0])).toBe('Auth · 92%')
  expect(areaLabel(areas[1])).toBe('Billing · 31% · 14 Claude edits since you looked')
  expect(areaLabel(area('x', { name: 'X', editsSinceLooked: 1 }))).toBe('X · 50% · 1 Claude edit since you looked')
})

test('the Desktop pane shows the headline, an Svg and the area list', async () => {
  const tree = renderPane(fakeElements, model(), handlers)
  expect(textsOf(tree)).toContain('You know 77% of the code as it is today')
  expect(walk(tree).find(n => n.type === 'Svg')?.props.alt).toContain('Knowledge map of 2 areas')
  expect(byKey(tree, 'area-billing')?.props.label).toBe('Billing · 31% · 14 Claude edits since you looked')
  byKey(tree, 'area-billing')?.props.onPress()
  expect(events.splice(0)).toEqual(['select billing'])
})

test('the terminal pane draws a Raster instead', async () => {
  const tree = renderPane(fakeElements, model({ surface: 'terminal' }), handlers)
  expect(walk(tree).find(n => n.type === 'Svg')).toBeUndefined()
  expect(byKey(tree, 'map')?.props).toMatchObject({ columns: 60, rows: 12 })
})

test('a selected area can be renamed, merged and its cards restored', async () => {
  const pending: QuestionCard[] = [{
    kind: 'question', areaId: 'billing', level: 'junior', file: 'f', question: 'Why add an index?', options: ['a', 'b', 'c'],
    answer: 0, explanation: 'x', editId: 'e', dimmedBy: 0,
  }]
  const tree = renderPane(fakeElements, model({ selectedId: 'billing', pending }), handlers)
  byKey(tree, 'rename')?.props.onSubmit('Payments')
  byKey(tree, 'merge')?.props.onSelect('auth')
  byKey(tree, 'pending-0')?.props.onPress()
  byKey(tree, 'close-area')?.props.onPress()
  expect(byKey(tree, 'merge')?.props.options).toEqual([{ value: 'auth', label: 'Auth' }])
  expect(events.splice(0)).toEqual(['rename billing Payments', 'merge billing auth', 'restore 0', 'select null'])
})

test('status screens', async () => {
  expect(textsOf(renderPane(fakeElements, model({ surface: 'vscode' }), handlers))).toEqual(['Apprentice supports the Desktop app and the terminal.'])
  expect(textsOf(renderPane(fakeElements, model({ status: 'no-git' }), handlers))).toEqual(['Apprentice needs a git repo.'])
  expect(textsOf(renderPane(fakeElements, model({ status: 'failed', error: 'Mapping stopped while listing files.' }), handlers)))
    .toEqual(['Mapping stopped while listing files.', 'Run /apprentice remap to try again.'])
  expect(textsOf(renderPane(fakeElements, model({ status: 'mapping', areas: [], progress: 'Mapping your repo…' }), handlers))).toEqual(['Mapping your repo…'])
})

test('Wrapped shows four tiles, the jump and Copy', async () => {
  let copied = 0
  const tree = renderWrapped(fakeElements, { mastered: 3, flawsCaught: 4, answered: 37, darkZones: 2, biggestJump: { name: 'Firestore rules', from: 20, to: 55 } }, 'dogbase', '2026-W43', { onCopy: () => copied++ })
  const texts = textsOf(tree)
  expect(texts).toContain('Your week in dogbase')
  expect(texts).toContain('Cards answered')
  expect(texts).toContain('37')
  expect(texts).toContain('Biggest jump: Firestore rules, 20% to 55%')
  byKey(tree, 'copy')?.props.onPress()
  expect(copied).toBe(1)
})

test('a short pane fits the terminal map to its rows and stacks a long headline', async () => {
  // dogbase plus the 39-character headline needs 48 columns, so at 45 the headline goes under the name.
  const tree = renderPane(fakeElements, model({ surface: 'terminal', columns: 45, rows: 8 }), handlers)
  expect(byKey(tree, 'header')?.props.flexDirection).toBe('column')
  // 8 rows, less 2 for the stacked header and 1 for the legend.
  expect(byKey(tree, 'map')?.props).toMatchObject({ columns: 45, rows: 5 })
  expect(byKey(renderPane(fakeElements, model({ surface: 'terminal', columns: 45, rows: 3 }), handlers), 'map')?.props.rows).toBe(4)
  const wide = renderPane(fakeElements, model({ surface: 'terminal', columns: 60, rows: 30 }), handlers)
  expect(byKey(wide, 'header')?.props.flexDirection).toBe('row')
  expect(byKey(wide, 'map')?.props.rows).toBe(12)
})

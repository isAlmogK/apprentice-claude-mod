import { expect, test } from 'claude-code/testing'
import type { Area } from '../src/core/types.ts'
import { areaForPath, draftToArea, groupAreas, mergeAreas, renameArea } from '../src/core/areas.ts'

const file = (path: string, lines: number) => ({ path, lines })

test('top-level folders become areas', async () => {
  const drafts = groupAreas([file('a/x.ts', 100), file('b/y.ts', 100), file('c/z.ts', 100), file('d/w.ts', 100)], [])
  expect(drafts.map(d => d.id)).toEqual(['a', 'b', 'c', 'd'])
  expect(drafts[0]).toMatchObject({ name: 'a', paths: ['a/'], lines: 100 })
})

test('a folder over 25% of lines splits into its subfolders', async () => {
  const drafts = groupAreas([
    file('src/app/a.ts', 300), file('src/lib/b.ts', 200), file('src/index.ts', 100), file('docs/r.md', 400),
  ], [])
  expect(drafts.map(d => d.id)).toEqual(['docs', 'src-app', 'src-lib', 'src'])
  expect(drafts.find(d => d.id === 'src')?.paths).toEqual(['src/'])
})

test('root files get their own area', async () => {
  const drafts = groupAreas([file('package.json', 100), file('a/x.ts', 100), file('b/y.ts', 100), file('c/z.ts', 100), file('d/w.ts', 100)], [])
  expect(drafts.find(d => d.id === 'root')).toMatchObject({ name: 'Root files', paths: [''] })
})

test('folders under 2% of lines merge into Other', async () => {
  const drafts = groupAreas([file('a/x.ts', 500), file('b/y.ts', 490), file('x/tiny.ts', 5), file('y/tiny.ts', 5)], [])
  expect(drafts.find(d => d.id === 'other')).toMatchObject({ name: 'Other', paths: ['x/', 'y/'], lines: 10 })
})

test('folders that change together merge, but not below 6 areas', async () => {
  const files = ['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8'].map(g => file(`${g}/f.ts`, 100))
  const commits = [
    ['g1/f.ts', 'g2/f.ts'], ['g1/f.ts', 'g2/f.ts'], ['g1/f.ts', 'g2/f.ts'], ['g1/f.ts', 'g2/f.ts'],
    ['g3/f.ts', 'g4/f.ts'], ['g3/f.ts', 'g4/f.ts'], ['g3/f.ts', 'g4/f.ts'],
    ['g5/f.ts', 'g6/f.ts'], ['g5/f.ts', 'g6/f.ts'], ['g5/f.ts', 'g6/f.ts'],
  ]
  const drafts = groupAreas(files, commits)
  expect(drafts.map(d => d.id)).toEqual(['g1', 'g3', 'g5', 'g6', 'g7', 'g8'])
  expect(drafts[0].paths).toEqual(['g1/', 'g2/'])
})

test('there are never more than 15 areas', async () => {
  const files = Array.from({ length: 20 }, (_, i) => file(`d${String(i).padStart(2, '0')}/f.ts`, 100 + i * 10))
  expect(groupAreas(files, []).length).toBe(15)
})

test('an empty repo has no areas', async () => {
  expect(groupAreas([], [])).toEqual([])
})

test('areaForPath picks the longest matching prefix', async () => {
  const list = [{ id: 'src', paths: ['src/'] }, { id: 'billing', paths: ['src/billing/'] }, { id: 'root', paths: [''] }]
  expect(areaForPath(list, 'src/billing/invoice.ts')?.id).toBe('billing')
  expect(areaForPath(list, 'src/index.ts')?.id).toBe('src')
  expect(areaForPath(list, 'README.md')?.id).toBe('root')
  expect(areaForPath([{ id: 'a', paths: ['a/'] }], 'b/x.ts')).toBeUndefined()
})

const area = (id: string, over: Partial<Area> = {}): Area => ({
  id, name: id, paths: [`${id}/`], lines: 100, score: 0.5, editsSinceLooked: 0, level: 'mid', streak: 0, ...over,
})

test('draftToArea starts with no edits and the level for its score', async () => {
  const a = draftToArea({ id: 'a', name: 'A', paths: ['a/'], lines: 10, files: [] }, 0.8)
  expect(a).toEqual({ id: 'a', name: 'A', paths: ['a/'], lines: 10, score: 0.8, editsSinceLooked: 0, level: 'senior', streak: 0 })
})

test('renameArea trims and ignores empty names', async () => {
  expect(renameArea([area('a')], 'a', '  Billing ')[0].name).toBe('Billing')
  expect(renameArea([area('a')], 'a', '   ')[0].name).toBe('a')
})

test('mergeAreas joins paths and weighs scores by lines', async () => {
  const merged = mergeAreas([area('a', { score: 1, lines: 300, editsSinceLooked: 1 }), area('b', { score: 0, lines: 100, editsSinceLooked: 2 })], 'b', 'a')
  expect(merged).toEqual([{ id: 'a', name: 'a', paths: ['a/', 'b/'], lines: 400, score: 0.75, editsSinceLooked: 3, level: 'mid', streak: 0 }])
  expect(mergeAreas([area('a')], 'a', 'a')).toEqual([area('a')])
})

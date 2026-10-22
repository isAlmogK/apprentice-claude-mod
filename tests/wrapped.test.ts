import { expect, test } from 'claude-code/testing'
import type { Answer, Area } from '../src/core/types.ts'
import { buildWrapped, isoWeek, weekIndex, wrappedText } from '../src/core/wrapped.ts'

test('isoWeek follows ISO 8601', async () => {
  expect(isoWeek(Date.UTC(2026, 9, 23, 12))).toBe('2026-W43')
  expect(isoWeek(Date.UTC(2021, 0, 1, 12))).toBe('2020-W53')
  expect(isoWeek(Date.UTC(2025, 11, 29, 12))).toBe('2026-W01')
})

test('weekIndex orders weeks across years', async () => {
  expect(weekIndex('2026-W43') - weekIndex('2026-W35')).toBe(8)
  expect(weekIndex('2026-W01') > weekIndex('2025-W52')).toBe(true)
})

const area = (id: string, score: number, name = id): Area => ({
  id, name, paths: [`${id}/`], lines: 100, score, editsSinceLooked: 0, level: 'mid', streak: 0,
})
const answer = (over: Partial<Answer>): Answer => ({
  at: 0, areaId: 'a', level: 'mid', kind: 'question', skipped: false, isRight: true, flagged: false, haikuSeesFlaw: false, ...over,
})

test('buildWrapped counts the week', async () => {
  const w = buildWrapped(
    [answer({}), answer({ skipped: true }), answer({ kind: 'flaw', flagged: true, haikuSeesFlaw: true }), answer({ kind: 'flaw', flagged: true })],
    [area('a', 0.85, 'Auth'), area('b', 0.2), area('c', 0.55, 'Firestore rules')],
    { a: 0.7, b: 0.25, c: 0.2 },
  )
  expect(w).toEqual({ mastered: 1, flawsCaught: 1, answered: 3, darkZones: 1, biggestJump: { name: 'Firestore rules', from: 20, to: 55 } })
})

test('no jump when nothing rose', async () => {
  expect(buildWrapped([], [area('a', 0.5)], { a: 0.5 }).biggestJump).toBe(null)
})

test('wrappedText is ready to post', async () => {
  const text = wrappedText({ mastered: 3, flawsCaught: 4, answered: 37, darkZones: 2, biggestJump: { name: 'Firestore rules', from: 20, to: 55 } }, 'dogbase', '2026-W43')
  expect(text).toBe([
    'My week in dogbase (2026-W43), from Apprentice:',
    '- Areas mastered: 3',
    '- Flaws I caught: 4',
    '- Cards answered: 37',
    '- Dark zones left: 2',
    '- Biggest jump: Firestore rules, 20% to 55%',
  ].join('\n'))
})

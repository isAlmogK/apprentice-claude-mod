import { expect, test } from 'claude-code/testing'
import type { Area, FlawCard } from '../src/core/types.ts'
import {
  applyAnswer, applyDim, changedLinesOf, countLines, dimmedByFor, initialLevel,
  isFlawAnswerRight, knownPercent, seedScore,
} from '../src/core/understanding.ts'

const area = (over: Partial<Area> = {}): Area => ({
  id: 'billing', name: 'Billing', paths: ['src/billing/'], lines: 100,
  score: 0.5, editsSinceLooked: 0, level: 'mid', streak: 0, ...over,
})

test('seedScore is your share of blamed lines, capped at 0.9', async () => {
  expect(seedScore(3, 4)).toBe(0.75)
  expect(seedScore(10, 10)).toBe(0.9)
  expect(seedScore(0, 0)).toBe(0)
})

test('initialLevel follows the score bands', async () => {
  expect(initialLevel(0.39)).toBe('junior')
  expect(initialLevel(0.4)).toBe('mid')
  expect(initialLevel(0.74)).toBe('mid')
  expect(initialLevel(0.75)).toBe('senior')
})

test('changedLinesOf counts lines per tool', async () => {
  expect(countLines('')).toBe(0)
  expect(countLines('a\nb')).toBe(2)
  expect(changedLinesOf('Edit', { old_string: 'a', new_string: 'a\nb\nc' })).toBe(3)
  expect(changedLinesOf('Write', { content: 'x\ny' })).toBe(2)
  expect(changedLinesOf('MultiEdit', { edits: [{ old_string: 'a\nb', new_string: 'c' }, { old_string: 'd', new_string: 'e\nf\ng' }] })).toBe(5)
  expect(changedLinesOf('Read', { file_path: 'x' })).toBe(0)
})

test('dimming takes the changed share, never more than the score', async () => {
  expect(dimmedByFor(area(), 3)).toBe(0.03)
  expect(dimmedByFor(area({ score: 0.01 }), 50)).toBe(0.01)
  expect(dimmedByFor(area({ lines: 0 }), 1)).toBe(0.5)
  expect(applyDim(area(), 0.03)).toMatchObject({ score: 0.47, editsSinceLooked: 1 })
})

test('a right answer restores the dimming plus a bonus', async () => {
  const after = applyAnswer(area({ score: 0.47, editsSinceLooked: 2 }), 0.03, true)
  expect(after).toMatchObject({ score: 0.52, streak: 1, editsSinceLooked: 0 })
})

test('a wrong answer restores a quarter and starts a negative streak', async () => {
  const after = applyAnswer(area({ score: 0.47, streak: 2 }), 0.03, false)
  expect(after).toMatchObject({ score: 0.4775, streak: -1 })
})

test('three right answers in a row level up; two wrong level down', async () => {
  expect(applyAnswer(area({ streak: 2 }), 0, true)).toMatchObject({ level: 'senior', streak: 0 })
  expect(applyAnswer(area({ streak: -1 }), 0, false)).toMatchObject({ level: 'junior', streak: 0 })
  expect(applyAnswer(area({ level: 'senior', streak: 2 }), 0, true)).toMatchObject({ level: 'senior', streak: 0 })
  expect(applyAnswer(area({ score: 0.99 }), 0.5, true).score).toBe(1)
})

test('a flaw answer is right when it agrees with Haiku', async () => {
  const card = { haikuSeesFlaw: true } as FlawCard
  expect(isFlawAnswerRight(card, 'flag')).toBe(true)
  expect(isFlawAnswerRight(card, 'looks-fine')).toBe(false)
  expect(isFlawAnswerRight({ haikuSeesFlaw: false } as FlawCard, 'looks-fine')).toBe(true)
})

test('knownPercent weighs scores by lines', async () => {
  expect(knownPercent([area({ score: 1, lines: 300 }), area({ id: 'b', score: 0, lines: 100 })])).toBe(75)
  expect(knownPercent([])).toBe(0)
})

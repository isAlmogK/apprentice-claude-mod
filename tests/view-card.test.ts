import { expect, test } from 'claude-code/testing'
import type { FlawCard, QuestionCard } from '../src/core/types.ts'
import { renderCard } from '../src/views/card.ts'
import { byKey, fakeElements, textsOf } from './helpers.ts'

const question: QuestionCard = {
  kind: 'question', areaId: 'billing', level: 'junior', file: 'src/billing/invoice.ts',
  question: 'Why add an index on invoices.team_id?', options: ['Faster lookups by team', 'Unique teams', 'Foreign key'],
  answer: 0, explanation: 'Queries filter invoices by team.', editId: 'e1', dimmedBy: 0.03,
}
const flaw: FlawCard = {
  kind: 'flaw', areaId: 'auth', level: 'senior', file: 'src/auth/session.ts', hunk: '-  return deny(res)\n+  await refresh(session)',
  haikuSeesFlaw: true, summary: 'Expired sessions are refreshed.', explanation: 'The deny path is gone.', editId: 'e2', dimmedBy: 0.05,
}

const calls: string[] = []
const handlers = {
  onAnswer: (i: number) => calls.push('answer ' + i),
  onFlaw: (p: string) => calls.push('flaw ' + p),
  onSkip: () => calls.push('skip'),
  onQuiet: () => calls.push('quiet'),
}

test('a question card has three numbered answers, Skip and Quiet', async () => {
  const tree = renderCard(fakeElements, { card: question, areaName: 'Billing', revealed: null }, handlers)
  expect(textsOf(tree)).toContain('Apprentice · Billing · junior card')
  expect(textsOf(tree)).toContain('Why add an index on invoices.team_id?')
  expect(byKey(tree, 'ans-0')?.props).toMatchObject({ label: '1 · Faster lookups by team', hotkey: '1' })
  expect(byKey(tree, 'ans-2')?.props.hotkey).toBe('3')
  byKey(tree, 'ans-1')?.props.onPress()
  byKey(tree, 'skip')?.props.onPress()
  byKey(tree, 'quiet')?.props.onPress()
  expect(calls.splice(0)).toEqual(['answer 1', 'skip', 'quiet'])
})

test('a flaw card shows the hunk and two choices', async () => {
  const tree = renderCard(fakeElements, { card: flaw, areaName: 'Auth', revealed: null }, handlers)
  expect(textsOf(tree)).toContain('Apprentice · Auth · senior card · spot the flaw')
  const code = byKey(tree, 'hunk')
  expect(code?.type).toBe('Code')
  expect(code?.props).toMatchObject({ source: flaw.hunk, path: 'src/auth/session.ts', format: 'diff' })
  expect(byKey(tree, 'flaw-ok')?.props).toMatchObject({ label: '1 · Looks fine', hotkey: '1' })
  expect(byKey(tree, 'flaw-flag')?.props).toMatchObject({ label: '2 · Flag to Claude', hotkey: '2' })
  byKey(tree, 'flaw-flag')?.props.onPress()
  expect(calls.splice(0)).toEqual(['flaw flag'])
})

test('a revealed card shows the result and the explanation, without buttons', async () => {
  const tree = renderCard(fakeElements, { card: question, areaName: 'Billing', revealed: { isRight: false } }, handlers)
  expect(textsOf(tree)).toContain('Not quite. The answer was 1 · Faster lookups by team.')
  expect(textsOf(tree)).toContain('Queries filter invoices by team.')
  expect(textsOf(tree)).toContain("Haiku's view, not a verdict on the code.")
  expect(byKey(tree, 'ans-0')).toBeUndefined()
})

test('a flaw card trims its hunk to fit the band', async () => {
  const body = Array.from({ length: 40 }, (_, i) => `+line ${i}`)
  const hunk = [...body, '… 10 more lines'].join('\n')
  const tree = renderCard(fakeElements, { card: { ...flaw, hunk }, areaName: 'Auth', revealed: null, maxRows: 12 }, handlers)
  expect(byKey(tree, 'hunk')?.props.source).toBe([...body.slice(0, 5), '… 45 more lines'].join('\n'))
  const plain = renderCard(fakeElements, { card: { ...flaw, hunk: body.join('\n') }, areaName: 'Auth', revealed: null, maxRows: 4 }, handlers)
  expect(byKey(plain, 'hunk')?.props.source).toBe([...body.slice(0, 3), '… 37 more lines'].join('\n'))
  const roomy = renderCard(fakeElements, { card: { ...flaw, hunk }, areaName: 'Auth', revealed: null, maxRows: 60 }, handlers)
  expect(byKey(roomy, 'hunk')?.props.source).toBe(hunk)
  expect(byKey(renderCard(fakeElements, { card: { ...flaw, hunk }, areaName: 'Auth', revealed: null }, handlers), 'hunk')?.props.source).toBe(hunk)
})

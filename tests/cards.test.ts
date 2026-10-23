import { expect, test } from 'claude-code/testing'
import type { FlawCard } from '../src/core/types.ts'
import { isSecretPath } from '../src/cards/exclude.ts'
import { cardsWithinHour } from '../src/cards/policy.ts'
import { buildCardRequest, buildNamingRequest, diffOf, editTextsOf, flagPromptText } from '../src/cards/prompt.ts'
import { extractJson, parseAreaNames, parseCardReply } from '../src/cards/parse.ts'

test('secret paths never go to Haiku', async () => {
  for (const p of ['.env', 'app/.env.local', 'certs/server.pem', 'keys/api.key', 'home/id_rsa.pub', 'id_ed25519', 'src/secrets.ts', 'config/credentials.json']) {
    expect(isSecretPath(p)).toBe(true)
  }
  expect(isSecretPath('src/billing/invoice.ts')).toBe(false)
})

test('cardsWithinHour keeps the last hour', async () => {
  expect(cardsWithinHour([0, 1000, 3_600_000, 3_700_000], 4_000_000)).toEqual([3_600_000, 3_700_000])
})

test('editTextsOf reads each tool', async () => {
  expect(editTextsOf('Edit', { old_string: 'a', new_string: 'b' })).toEqual({ oldText: 'a', newText: 'b' })
  expect(editTextsOf('Write', { content: 'x' })).toEqual({ oldText: '', newText: 'x' })
  expect(editTextsOf('MultiEdit', { edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: 'd' }] })).toEqual({ oldText: 'a\nc', newText: 'b\nd' })
})

test('diffOf marks lines and cuts long diffs', async () => {
  expect(diffOf({ file: 'f', oldText: 'a', newText: 'b\nc' }, 10)).toBe('-a\n+b\n+c')
  const long = diffOf({ file: 'f', oldText: '', newText: Array.from({ length: 130 }, (_, i) => `l${i}`).join('\n') }, 120)
  expect(long.split('\n').length).toBe(121)
  expect(long.split('\n').at(-1)).toBe('… 10 more lines')
})

test('buildCardRequest picks instructions by level', async () => {
  const edit = { file: 'src/a.ts', oldText: 'a', newText: 'b' }
  expect(buildCardRequest('Billing', 'junior', edit).system).toContain('what the change does or why')
  expect(buildCardRequest('Billing', 'mid', edit).system).toContain('what would break')
  expect(buildCardRequest('Billing', 'senior', edit).system).toContain('You review one code change')
  expect(buildCardRequest('Billing', 'junior', edit).prompt).toBe('Area: Billing\nFile: src/a.ts\nChange:\n-a\n+b')
})

test('buildNamingRequest lists each area', async () => {
  const req = buildNamingRequest([{ id: 'src-billing', name: 'src/billing', paths: ['src/billing/'], lines: 9, files: [{ path: 'src/billing/invoice.ts', lines: 9 }] }])
  expect(req.system).toContain('You name areas')
  expect(req.prompt).toBe('src-billing: folders src/billing/; files src/billing/invoice.ts')
})

test('buildNamingRequest leaves secret paths out', async () => {
  const files = [{ path: 'src/.env', lines: 50 }, { path: 'src/secrets.ts', lines: 40 }, { path: 'src/app.ts', lines: 5 }]
  const req = buildNamingRequest([{ id: 'src', name: 'src', paths: ['src/'], lines: 95, files }])
  expect(req.prompt).toBe('src: folders src/; files src/app.ts')
})

test('buildNamingRequest drops areas made only of secret paths', async () => {
  const req = buildNamingRequest([
    { id: 'secrets', name: 'secrets', paths: ['secrets/'], lines: 10, files: [{ path: 'secrets/prod.ts', lines: 10 }] },
    { id: 'src', name: 'src', paths: ['src/'], lines: 9, files: [{ path: 'src/app.ts', lines: 9 }] },
  ])
  expect(req.prompt).toBe('src: folders src/; files src/app.ts')
  expect(req.ids).toEqual(['src'])
  expect(buildNamingRequest([{ id: 'credentials', name: 'credentials', paths: ['credentials/'], lines: 1, files: [{ path: 'credentials/a.json', lines: 1 }] }]).prompt).toBe('')
})

test('flagPromptText quotes the concern', async () => {
  const card = { file: 'src/auth/session.ts', haikuSeesFlaw: true, summary: 'Expired sessions are refreshed.' } as FlawCard
  expect(flagPromptText(card)).toBe('Apprentice flag on src/auth/session.ts: the user reviewed this change and is concerned: "Expired sessions are refreshed.". Check whether it was intended, and fix it if not.')
  expect(flagPromptText({ ...card, haikuSeesFlaw: false })).toContain('"something in this change looks wrong to them"')
})

test('extractJson tolerates prose around the object', async () => {
  expect(extractJson('Sure! {"a": 1} Hope that helps.')).toEqual({ a: 1 })
  expect(extractJson('{"a": ')).toBe(null)
  expect(extractJson('no json')).toBe(null)
})

const meta = (level: 'junior' | 'mid' | 'senior') => ({ areaId: 'billing', level, file: 'src/a.ts', editId: 'e1', dimmedBy: 0.03, hunk: '-a\n+b' })

test('parseCardReply accepts a valid question', async () => {
  const card = parseCardReply('{"question":"Why?","options":["A","B","C"],"answer":2,"explanation":"Because."}', meta('junior'))
  expect(card).toEqual({ kind: 'question', areaId: 'billing', level: 'junior', file: 'src/a.ts', question: 'Why?', options: ['A', 'B', 'C'], answer: 2, explanation: 'Because.', editId: 'e1', dimmedBy: 0.03 })
})

test('parseCardReply rejects bad questions', async () => {
  expect(parseCardReply('{"question":"Why?","options":["A","B"],"answer":0,"explanation":"x"}', meta('mid'))).toBe(null)
  expect(parseCardReply('{"question":"Why?","options":["A","B","C"],"answer":3,"explanation":"x"}', meta('mid'))).toBe(null)
  expect(parseCardReply('{"question":"Why?","options":["A","","C"],"answer":0,"explanation":"x"}', meta('mid'))).toBe(null)
  expect(parseCardReply(`{"question":"Why?","options":["A","B","C"],"answer":0,"explanation":"${'x'.repeat(601)}"}`, meta('mid'))).toBe(null)
})

test('parseCardReply builds a flaw card for seniors with our own hunk', async () => {
  const card = parseCardReply('{"haikuSeesFlaw":true,"summary":"Skips the deny.","explanation":"It refreshes instead."}', meta('senior'))
  expect(card).toEqual({ kind: 'flaw', areaId: 'billing', level: 'senior', file: 'src/a.ts', hunk: '-a\n+b', haikuSeesFlaw: true, summary: 'Skips the deny.', explanation: 'It refreshes instead.', editId: 'e1', dimmedBy: 0.03 })
  expect(parseCardReply('{"haikuSeesFlaw":"yes","summary":"x","explanation":"y"}', meta('senior'))).toBe(null)
})

test('parseAreaNames keeps valid names for known ids', async () => {
  expect(parseAreaNames('{"a":" Billing ","b":"","c":"Extra"}', ['a', 'b'])).toEqual({ a: 'Billing' })
  expect(parseAreaNames('nope', ['a'])).toEqual({})
})

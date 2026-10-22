import { expect, test } from 'claude-code/testing'
import { ROOT, areaIn, bandSite, mapFixture, paneSite, repoId, stubWorld, until } from './helpers.ts'

const BILLING = `${ROOT}/src/billing/invoice.ts`
const AUTH = `${ROOT}/src/auth/login.ts`
const cardCalls = (w: any) => w.modelCalls.filter((c: any) => !String(c.system).includes('You name areas')).length

async function bandHas($: any, key: string, surface: 'desktop' | 'terminal' = 'desktop'): Promise<boolean> {
  const ui = await $.ui.mount(bandSite(surface))
  const found = await ui.find({ key })
  await ui.unmount()
  return found !== undefined
}

async function edit($: any, file: string, turnId: string) {
  await $.turn.start({ turnId })
  await $.tool.call({ tool: 'Edit', file_path: file, old_string: 'a', new_string: 'a\nlog(invoice)' })
}

test('an edit dims its area and a spot-the-flaw card appears for a senior area', async ($, on) => {
  const w = stubWorld(on)
  await mapFixture($, w)
  await edit($, BILLING, 't1')
  expect(await areaIn(w, 'src-billing')).toMatchObject({ score: 0.73, editsSinceLooked: 1 })
  await until(w, () => bandHas($, 'flaw-flag'))
  expect(w.modelCalls.at(-1)).toMatchObject({ model: 'haiku', maxTokens: 600 })
})

test('a junior area gets a question card, in the terminal too', async ($, on) => {
  const w = stubWorld(on)
  await mapFixture($, w)
  await edit($, AUTH, 't1')
  await until(w, () => bandHas($, 'ans-0', 'terminal'))
})

test('only the first edit of a turn makes a card', async ($, on) => {
  const w = stubWorld(on)
  await mapFixture($, w)
  await edit($, AUTH, 't1')
  await $.tool.call({ tool: 'Edit', file_path: BILLING, old_string: 'a', new_string: 'b' })
  await until(w, () => bandHas($, 'ans-0'))
  expect(cardCalls(w)).toBe(1)
  expect((await areaIn(w, 'src-billing')).editsSinceLooked).toBe(1)
  await edit($, BILLING, 't2')
  await until(w, () => cardCalls(w) === 2)
})

test('a right answer relights the area and is logged', async ($, on) => {
  const w = stubWorld(on)
  await mapFixture($, w)
  await edit($, BILLING, 't1')
  await until(w, () => bandHas($, 'flaw-flag'))
  const ui = await $.ui.mount(bandSite('desktop'))
  await ui.press({ key: 'flaw-flag' })
  expect(await areaIn(w, 'src-billing')).toMatchObject({ score: 0.77, streak: 1, editsSinceLooked: 0 })
  expect(await ui.find({ type: 'Text', text: 'Right.' })).toBeDefined()
  const log = w.store.get(`repo:${await repoId()}:answers:2026-W43`)
  expect(log).toMatchObject([{ areaId: 'src-billing', kind: 'flaw', isRight: true, flagged: true, haikuSeesFlaw: true, skipped: false }])
})

test('a wrong answer shows the right one, then clears after 8 seconds', async ($, on) => {
  const w = stubWorld(on)
  await mapFixture($, w)
  await edit($, AUTH, 't1')
  await until(w, () => bandHas($, 'ans-0'))
  const ui = await $.ui.mount(bandSite('desktop'))
  await ui.press({ key: 'ans-1' })
  expect(await ui.find({ type: 'Text', text: 'Not quite. The answer was 1 · A log line.' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'It logs each invoice.' })).toBeDefined()
  await ui.unmount()
  await w.clock.advance(8000)
  for (let i = 0; i < 20; i++) await w.clock.settle()
  const after = await $.ui.mount(bandSite('desktop'))
  expect(await after.find({ type: 'Text', text: 'It logs each invoice.' })).toBeUndefined()
})

test('Skip keeps the card for later and Restore brings it back', async ($, on) => {
  const w = stubWorld(on)
  await mapFixture($, w)
  await edit($, AUTH, 't1')
  await until(w, () => bandHas($, 'ans-0'))
  const band = await $.ui.mount(bandSite('desktop'))
  await band.press({ key: 'skip' })
  await band.unmount()
  expect(await bandHas($, 'ans-0')).toBe(false)
  expect(w.store.get(`repo:${await repoId()}:pending:src-auth`).length).toBe(1)
  const pane = await $.ui.mount(paneSite('desktop'))
  await pane.press({ key: 'area-src-auth' })
  await pane.press({ key: 'pending-0' })
  expect(await bandHas($, 'ans-0')).toBe(true)
  expect(w.store.get(`repo:${await repoId()}:pending:src-auth`).length).toBe(0)
})

test('Quiet 1h stops new cards until the hour is up', async ($, on) => {
  const w = stubWorld(on)
  await mapFixture($, w)
  await edit($, AUTH, 't1')
  await until(w, () => bandHas($, 'quiet'))
  const band = await $.ui.mount(bandSite('desktop'))
  await band.press({ key: 'quiet' })
  await edit($, AUTH, 't2')
  for (let i = 0; i < 20; i++) await w.clock.settle()
  expect(cardCalls(w)).toBe(1)
  await w.clock.advance(3_600_000)
  await edit($, AUTH, 't3')
  await until(w, () => cardCalls(w) === 2)
})

test('/apprentice quiet 30 pauses cards for 30 minutes', async ($, on) => {
  const w = stubWorld(on)
  await mapFixture($, w)
  const answer = await $.command.run({ command: 'apprentice', args: 'quiet 30' })
  expect(answer.text).toBe('Cards are paused for 30 minutes.')
  await edit($, AUTH, 't1')
  for (let i = 0; i < 20; i++) await w.clock.settle()
  expect(cardCalls(w)).toBe(0)
})

test('secret files dim but never reach Haiku', async ($, on) => {
  const w = stubWorld(on)
  await mapFixture($, w)
  await edit($, `${ROOT}/src/billing/.env.local`, 't1')
  for (let i = 0; i < 20; i++) await w.clock.settle()
  expect(cardCalls(w)).toBe(0)
  expect((await areaIn(w, 'src-billing')).editsSinceLooked).toBe(1)
})

test('files git ignores never reach Haiku', async ($, on) => {
  const w = stubWorld(on, { git: { 'check-ignore -q': { exitCode: 0, stdout: '' } } })
  await mapFixture($, w)
  await edit($, AUTH, 't1')
  for (let i = 0; i < 20; i++) await w.clock.settle()
  expect(cardCalls(w)).toBe(0)
})

test('at most 6 cards an hour', async ($, on) => {
  const w = stubWorld(on)
  await mapFixture($, w)
  for (let i = 1; i <= 6; i++) {
    await edit($, AUTH, `t${i}`)
    await until(w, () => cardCalls(w) === i)
    // Let the reply be parsed and the card's time recorded before the next turn
    for (let k = 0; k < 20; k++) await w.clock.settle()
  }
  await edit($, AUTH, 't7')
  for (let i = 0; i < 20; i++) await w.clock.settle()
  expect(cardCalls(w)).toBe(6)
})

test('a failed model call shows no card and keeps the dimming', async ($, on) => {
  const w = stubWorld(on, { model: (e: any) => (String(e.system).includes('You name areas') ? '{}' : null) })
  await mapFixture($, w)
  await edit($, BILLING, 't1')
  for (let i = 0; i < 20; i++) await w.clock.settle()
  expect(await bandHas($, 'flaw-flag')).toBe(false)
  expect((await areaIn(w, 'src-billing')).score).toBe(0.73)
})

test('an edit still succeeds when saving the dimming fails', async ($, on) => {
  let diskFull = false
  const w = stubWorld(on, { storeFails: () => diskFull })
  await mapFixture($, w)
  diskFull = true
  await $.turn.start({ turnId: 't1' })
  const result = await $.tool.call({ tool: 'Edit', file_path: AUTH, old_string: 'a', new_string: 'a\nlog(invoice)' })
  expect(result).toMatchObject({ result: 'ok' })
})

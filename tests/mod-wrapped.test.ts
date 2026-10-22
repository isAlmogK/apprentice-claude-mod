import { expect, test } from 'claude-code/testing'
import { ROOT, bandSite, mapFixture, paneSite, repoId, stubWorld, until } from './helpers.ts'

const BILLING = `${ROOT}/src/billing/invoice.ts`

async function flawCardShown($: any, w: any) {
  await $.turn.start({ turnId: 't1' })
  await $.tool.call({ tool: 'Edit', file_path: BILLING, old_string: 'a', new_string: 'a\nb' })
  await until(w, async () => {
    const ui = await $.ui.mount(bandSite('desktop'))
    const found = await ui.find({ key: 'flaw-flag' })
    await ui.unmount()
    return found !== undefined
  })
}

const answer = (over: Record<string, unknown> = {}) => ({
  at: 0, areaId: 'src-auth', level: 'junior', kind: 'question', skipped: false, isRight: true, flagged: false, haikuSeesFlaw: false, ...over,
})

test('Flag to Claude submits a prompt about the file', async ($, on) => {
  const w = stubWorld(on)
  await mapFixture($, w)
  await flawCardShown($, w)
  const band = await $.ui.mount(bandSite('desktop'))
  await band.press({ key: 'flaw-flag' })
  await until(w, () => w.submitted.length === 1)
  expect(w.submitted[0]).toBe('Apprentice flag on src/billing/invoice.ts: the user reviewed this change and is concerned: "Expired sessions are refreshed instead of denied.". Check whether it was intended, and fix it if not.')
})

test('a dropped flag is sent again after the next turn', async ($, on) => {
  const w = stubWorld(on)
  w.submitReplies.push({ drop: 'the session was stopped and nobody has sent input since' })
  await mapFixture($, w)
  await flawCardShown($, w)
  const band = await $.ui.mount(bandSite('desktop'))
  await band.press({ key: 'flaw-flag' })
  await until(w, () => w.submitted.length === 1)
  await $.turn.complete({ turnId: 't1', answer: '', durationMs: 1, isAborted: false, usage: null })
  await until(w, () => w.submitted.length === 2)
})

test('the first answer of a week saves week-start scores and prunes old logs', async ($, on) => {
  const id = await repoId()
  const w = stubWorld(on, { store: { [`repo:${id}:answers:2026-W30`]: [answer()], [`repo:${id}:answers:2026-W40`]: [answer()] } })
  await mapFixture($, w)
  await flawCardShown($, w)
  const band = await $.ui.mount(bandSite('desktop'))
  await band.press({ key: 'flaw-ok' })
  expect(w.store.get(`repo:${id}:meta`).weekStart).toMatchObject({ week: '2026-W43', scores: { 'src-billing': 0.73 } })
  expect(w.store.has(`repo:${id}:answers:2026-W30`)).toBe(false)
  expect(w.store.has(`repo:${id}:answers:2026-W40`)).toBe(true)
})

test('/apprentice wrapped shows the week and copies it as text', async ($, on) => {
  const id = await repoId()
  const w = stubWorld(on)
  await mapFixture($, w)
  w.store.set(`repo:${id}:answers:2026-W43`, [answer(), answer(), answer({ skipped: true }), answer({ kind: 'flaw', flagged: true, haikuSeesFlaw: true })])
  w.store.set(`repo:${id}:meta`, { ...w.store.get(`repo:${id}:meta`), weekStart: { week: '2026-W43', scores: { docs: 0.9, 'src-auth': 0, 'src-billing': 0.5 } } })
  await $.command.run({ command: 'apprentice', args: 'wrapped' })
  const ui = await $.ui.mount(paneSite('desktop', 'apprentice-wrapped'))
  expect(await ui.find({ type: 'Text', text: 'Your week in dogbase' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Biggest jump: Billing, 50% to 75%' })).toBeDefined()
  await ui.press({ key: 'copy' })
  expect(w.copied[0]).toContain('- Cards answered: 3')
  expect(w.copied[0]).toContain('- Flaws I caught: 1')
  expect(w.toasts).toContain('Copied')
})

test('a toast says Wrapped is ready once a week, after 5 answers', async ($, on) => {
  const id = await repoId()
  const w = stubWorld(on, { store: { [`repo:${id}:answers:2026-W43`]: [answer(), answer(), answer(), answer(), answer()] } })
  await mapFixture($, w)
  await w.clock.advance(3_600_000)
  await until(w, () => w.toasts.includes('Codebase Wrapped is ready: run /apprentice wrapped'))
  await w.clock.advance(3_600_000)
  for (let i = 0; i < 20; i++) await w.clock.settle()
  expect(w.toasts.filter(t => t.startsWith('Codebase Wrapped')).length).toBe(1)
})

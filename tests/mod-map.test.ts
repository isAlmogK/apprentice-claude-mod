import { expect, test } from 'claude-code/testing'
import { areaIn, mapFixture, paneSite, repoId, ROOT, stubWorld, until } from './helpers.ts'

test('/apprentice maps the repo, names areas and seeds scores from blame', async ($, on) => {
  const w = stubWorld(on)
  await mapFixture($, w)
  expect(await areaIn(w, 'src-billing')).toMatchObject({ name: 'Billing', score: 0.75, level: 'senior', lines: 100 })
  expect(await areaIn(w, 'src-auth')).toMatchObject({ name: 'Auth', score: 0, level: 'junior' })
  expect(await areaIn(w, 'docs')).toMatchObject({ name: 'Docs', score: 0.9, level: 'senior' })
  expect(w.store.get(`repo:${await repoId()}:meta`)).toMatchObject({ areaIds: ['docs', 'src-auth', 'src-billing'] })
})

test('the Desktop pane shows the headline, the Svg map and the area list', async ($, on) => {
  const w = stubWorld(on)
  await mapFixture($, w)
  const ui = await $.ui.mount(paneSite('desktop'))
  expect(await ui.find({ type: 'Text', text: 'You know 55% of the code as it is today' })).toBeDefined()
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  expect(await ui.find({ key: 'area-src-billing' })).toBeDefined()
})

test('the terminal pane draws a Raster', async ($, on) => {
  const w = stubWorld(on)
  await mapFixture($, w)
  const ui = await $.ui.mount(paneSite('terminal'))
  expect(await ui.find({ type: 'Raster' })).toBeDefined()
})

test('renaming an area is saved and survives a remap', async ($, on) => {
  const w = stubWorld(on)
  await mapFixture($, w)
  const ui = await $.ui.mount(paneSite('desktop'))
  await ui.press({ key: 'area-src-billing' })
  await ui.input({ key: 'rename', text: 'Payments' })
  expect((await areaIn(w, 'src-billing')).name).toBe('Payments')
  w.store.delete(`repo:${await repoId()}:meta`)
  await $.command.run({ command: 'apprentice', args: 'remap' })
  await until(w, async () => w.store.has(`repo:${await repoId()}:meta`))
  expect((await areaIn(w, 'src-billing')).name).toBe('Payments')
})

test('merging an area removes it and joins its paths', async ($, on) => {
  const w = stubWorld(on)
  await mapFixture($, w)
  const ui = await $.ui.mount(paneSite('desktop'))
  await ui.press({ key: 'area-src-auth' })
  await ui.select({ key: 'merge', value: 'src-billing' })
  expect(await areaIn(w, 'src-auth')).toBeUndefined()
  expect((await areaIn(w, 'src-billing')).paths).toEqual(['src/billing/', 'src/auth/'])
  expect(w.store.get(`repo:${await repoId()}:meta`).areaIds).toEqual(['docs', 'src-billing'])
})

test('a failed git step is reported in the pane', async ($, on) => {
  const w = stubWorld(on, { git: { 'ls-tree -r -l HEAD': { exitCode: 128, stdout: '' } } })
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work/dogbase' })
  await $.command.run({ command: 'apprentice', args: '' })
  await until(w, async () => {
    const ui = await $.ui.mount(paneSite('desktop'))
    const found = await ui.find({ type: 'Text', text: 'Mapping stopped while listing files.' })
    await ui.unmount()
    return found !== undefined
  })
})

test('outside a git repo the pane says so', async ($, on) => {
  stubWorld(on, { repo: false })
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/tmp' })
  await $.command.run({ command: 'apprentice', args: '' })
  const ui = await $.ui.mount(paneSite('desktop'))
  expect(await ui.find({ type: 'Text', text: 'Apprentice needs a git repo.' })).toBeDefined()
})

test('an unknown argument prints the usage', async ($, on) => {
  stubWorld(on)
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work/dogbase' })
  const answer = await $.command.run({ command: 'apprentice', args: 'nonsense' })
  expect(answer.text).toBe('Usage: /apprentice [wrapped | quiet [minutes] | remap]')
})

test('a remap keeps learned progress and takes the new paths and lines', async ($, on) => {
  const w = stubWorld(on)
  await mapFixture($, w)
  const key = `repo:${await repoId()}:area:src-billing`
  // Pretend an earlier session learned something, with stale paths and lines, then restart so loadAreas reads it.
  w.store.set(key, { ...(await areaIn(w, 'src-billing')), score: 0.3, level: 'junior', streak: 2, editsSinceLooked: 4, lines: 7, paths: ['old/'] })
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: ROOT })
  w.store.delete(`repo:${await repoId()}:meta`)
  w.modelCalls.length = 0
  await $.command.run({ command: 'apprentice', args: 'remap' })
  await until(w, async () => w.store.has(`repo:${await repoId()}:meta`))
  expect(await areaIn(w, 'src-billing')).toMatchObject({ score: 0.3, level: 'junior', streak: 2, editsSinceLooked: 4, lines: 100, paths: ['src/billing/'] })
})

async function paneHasText($: any, text: string): Promise<boolean> {
  const ui = await $.ui.mount(paneSite('desktop'))
  const found = await ui.find({ type: 'Text', text })
  await ui.unmount()
  return found !== undefined
}

// What another session in the same repo would do: write the stored copy behind this session's back.
async function otherSessionSaves(w: any, id: string, change: Record<string, unknown>) {
  w.store.set(`repo:${await repoId()}:area:${id}`, { ...(await areaIn(w, id)), ...change })
}

test('a remap and a merge keep progress another session saved', async ($, on) => {
  const w = stubWorld(on)
  await mapFixture($, w)
  await otherSessionSaves(w, 'src-billing', { score: 0.42, level: 'mid', streak: 2, editsSinceLooked: 3 })
  await $.command.run({ command: 'apprentice', args: 'remap' })
  await until(w, () => w.gitCalls.filter(c => c.args.startsWith('ls-tree')).length === 2)
  for (let i = 0; i < 30; i++) await w.clock.settle()
  expect(await areaIn(w, 'src-billing')).toMatchObject({ score: 0.42, level: 'mid', streak: 2, editsSinceLooked: 3 })
  await otherSessionSaves(w, 'src-auth', { editsSinceLooked: 5 })
  const ui = await $.ui.mount(paneSite('desktop'))
  await ui.press({ key: 'area-src-auth' })
  await ui.select({ key: 'merge', value: 'src-billing' })
  expect(await areaIn(w, 'src-billing')).toMatchObject({ score: 0.21, editsSinceLooked: 8, lines: 200 })
})

test('an edit dims the stored copy and the map shows what was saved', async ($, on) => {
  const w = stubWorld(on)
  await mapFixture($, w)
  await otherSessionSaves(w, 'src-auth', { score: 0.5, level: 'mid' })
  await $.turn.start({ turnId: 't1' })
  await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/src/auth/login.ts`, old_string: 'a', new_string: 'a\nb' })
  expect((await areaIn(w, 'src-auth')).score).toBe(0.48)
  expect(await paneHasText($, 'You know 71% of the code as it is today')).toBe(true)
})

test('/apprentice reloads the map from the store', async ($, on) => {
  const w = stubWorld(on)
  await mapFixture($, w)
  await otherSessionSaves(w, 'src-auth', { score: 0.5, level: 'mid' })
  await $.command.run({ command: 'apprentice', args: '' })
  expect(await paneHasText($, 'You know 72% of the code as it is today')).toBe(true)
})

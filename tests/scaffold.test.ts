import { expect, mock, test } from 'claude-code/testing'
import type { Area } from '../src/core/types.ts'

test('session.start registers /apprentice', async ($, on) => {
  const registered: string[] = []
  // Task 12 starts an hourly timer in session.start, so answer $.clock from the start
  mock.clock(on)
  on('session.start', () => ({ cwd: '/work' }))
  on('session.repo', () => ({ value: null }))
  on('command.register', ($, e) => {
    registered.push(e.name)
    return { value: undefined }
  })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  expect(registered).toEqual(['apprentice'])
})

test('test files can import the core types', async () => {
  const area: Area = { id: 'a', name: 'A', paths: ['a/'], lines: 1, score: 0, editsSinceLooked: 0, level: 'junior', streak: 0 }
  expect(area.id).toBe('a')
})

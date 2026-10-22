import { expect, test } from 'claude-code/testing'
import { parseBlame, parseLog, parseLsTree, relativeTo, repoIdFrom, repoNameOf, sampleFiles } from '../src/core/git.ts'

test('parseLsTree estimates lines from blob sizes and skips submodules', async () => {
  const out = [
    '100644 blob 1111111111111111111111111111111111111111    4000\tsrc/a.ts',
    '100644 blob 2222222222222222222222222222222222222222      10\tREADME.md',
    '160000 commit 3333333333333333333333333333333333333333       -\tvendor/lib',
    '',
  ].join('\n')
  expect(parseLsTree(out)).toEqual([{ path: 'src/a.ts', lines: 100 }, { path: 'README.md', lines: 1 }])
})

test('parseLog splits commits on the marker', async () => {
  const out = '@@commit\n\nsrc/a.ts\nsrc/b.ts\n@@commit\n\n@@commit\n\ndocs/r.md\n'
  expect(parseLog(out)).toEqual([['src/a.ts', 'src/b.ts'], ['docs/r.md']])
})

test('parseBlame counts your lines by email, ignoring case', async () => {
  const out = ['author Me', 'author-mail <Me@Example.com>', 'author-mail <other@example.com>', 'author-mail <me@example.com>'].join('\n')
  expect(parseBlame(out, 'me@example.com\n')).toEqual({ mine: 2, total: 3 })
})

test('repoIdFrom is the first 16 hex characters of the SHA-256', async () => {
  expect(await repoIdFrom('hello')).toBe('2cf24dba5fb0a30e')
})

test('relativeTo makes paths relative to the repo root', async () => {
  expect(relativeTo('/work/repo', '/work/repo/src/a.ts')).toBe('src/a.ts')
  expect(relativeTo('/work/repo/', '/work/repo/src/a.ts')).toBe('src/a.ts')
  expect(relativeTo('/work/repo', '/elsewhere/a.ts')).toBe(null)
  expect(relativeTo('/work/repo', './src/a.ts')).toBe('src/a.ts')
})

test('repoNameOf and sampleFiles', async () => {
  expect(repoNameOf('/work/dogbase/')).toBe('dogbase')
  const files = [{ path: 'b', lines: 5 }, { path: 'a', lines: 5 }, { path: 'c', lines: 9 }]
  expect(sampleFiles(files, 2)).toEqual([{ path: 'c', lines: 9 }, { path: 'a', lines: 5 }])
})

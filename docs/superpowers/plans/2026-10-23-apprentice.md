# Apprentice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Apprentice v1, a Claude Code mod that maps a repo into areas, scores how well the user knows each one, dims areas as Claude edits them, and relights them through one Haiku-written card per editing turn.

**Architecture:** One plugin. A pure TypeScript core (`src/core`, `src/cards`, `src/views`) holds every rule and every drawing and never touches the mods API. `hooks/register.ts` is the only file that calls `$`: it wires hooks, storage, git, the model and the panes to the core. Claude Code loads `.ts` directly, so there is no build step.

**Tech Stack:** TypeScript loaded by Claude Code's mod runtime; the mods API (`$.store`, `$.process.run`, `$.model.complete`, `$.ui`, `$.clock`, `$.prompt.submit`); `claude plugin test` with the `claude-code/testing` kit; git.

**Spec:** [docs/superpowers/specs/2026-10-23-apprentice-design.md](../specs/2026-10-23-apprentice-design.md)

## Global Constraints

- Work on the branch `feat/apprentice-v1`. Never commit on `main`. Conventional commit messages, each ending with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Claude Code v2.1.296 or later (`claude --version`). Do not use `Text` props `weight`, `size`, `mono` or `tabular`, or named `Box` spacing steps (`'xs'`…`'xl'`): they need v2.1.299. Use `bold: true` and numbers.
- The hooks module and everything it imports: no Node APIs, no `setTimeout`/`setInterval`, ES modules only, relative imports of files inside the plugin, and the only bare import is `claude-code`. Tests may also import `claude-code/testing`.
- Only `hooks/register.ts` calls `$`. Write every call in full (`$.store.get(...)`), never assign `$` or a namespace to a variable, and pass `$` only to functions declared at the top level of `register.ts`.
- Every git command: `$.process.run(['git', ...args], { cwd: <repo root>, timeoutMs: 600000 })`.
- Model calls: `model: 'haiku'`. Cards: `maxTokens: 600`, `timeoutMs: 20000`.
- Numbers from the spec: seed cap 0.9; levels junior < 0.4 ≤ mid < 0.75 ≤ senior; right answer `+dimmedBy + 0.02` (max 1); wrong `+dimmedBy × 0.25`; streak +3 levels up, −2 levels down; split groups over 25% of lines; groups under 2% go to "Other"; co-change merge ratio over 0.6 with at least 3 commits each, only while more than 6 groups remain; at most 15 areas; blame samples the 20 largest files per area; at most 6 cards an hour; explanation shown 8 seconds; diff to Haiku at most 120 lines; flaw-card hunk at most 40 lines; at most 5 skipped cards per area; answer logs older than 8 weeks are deleted; the Wrapped toast needs 5 answers in the week.
- Names: plugin `apprentice`; command `/apprentice`; panes `apprentice` (map) and `apprentice-wrapped`.
- Store keys: `repo:<repoId>:area:<areaId>`, `repo:<repoId>:meta`, `repo:<repoId>:answers:<ISO week>`, `repo:<repoId>:pending:<areaId>`, `repo:<repoId>:toasted`.
- Copy: sentence case, contractions, no "please", "successfully", "simply" or "just", no exclamation marks.
- Run tests with `claude plugin test` from the repo root; it finds every `tests/*.test.ts`.

## File structure

| File | Responsibility |
| --- | --- |
| `.claude-plugin/plugin.json` | Manifest |
| `hooks/hooks.json` | Points Claude Code at `register.ts` |
| `hooks/register.ts` | All hooks and mods API calls; module state |
| `src/core/types.ts` | `Level`, `Area`, `QuestionCard`, `FlawCard`, `Card`, `Answer` |
| `src/core/understanding.ts` | Seeding, dimming, answering, levels, the headline number |
| `src/core/areas.ts` | Grouping files into areas; find, rename, merge |
| `src/core/git.ts` | Parsing git output; repo id; paths |
| `src/core/wrapped.ts` | ISO weeks; the weekly summary and its text |
| `src/cards/exclude.ts` | Secret paths |
| `src/cards/policy.ts` | The hourly card cap |
| `src/cards/prompt.ts` | Edit text, diffs, Haiku requests, the flag prompt |
| `src/cards/parse.ts` | Parsing Haiku replies |
| `src/views/elements.ts` | The element-constructor types views take |
| `src/views/card.ts` | The band card |
| `src/views/layout.ts` | Star positions |
| `src/views/map-svg.ts` | The Desktop map |
| `src/views/map-raster.ts` | The terminal map |
| `src/views/pane.ts` | The map pane |
| `src/views/wrapped.ts` | The Wrapped pane |
| `tests/helpers.ts` | Fake elements, tree search, the stubbed world for mod tests |
| `tests/*.test.ts` | One file per unit, plus `mod-*.test.ts` for hooks |

---

### Task 1: Scaffold the plugin and confirm the toolchain

**Files:**
- Create: `.claude-plugin/plugin.json`, `hooks/hooks.json`, `hooks/register.ts`, `src/core/types.ts`, `.gitignore`, `tests/scaffold.test.ts`

**Interfaces:**
- Produces: `src/core/types.ts` with `Level`, `Area`, `QuestionCard`, `FlawCard`, `Card`, `Answer` (used by every later task); the `/apprentice` command registration.

- [ ] **Step 1: Create the branch and check the version**

```bash
git checkout -b feat/apprentice-v1
claude --version
```

Expected: a version of `2.1.296` or later. If it is older, stop and update Claude Code.

- [ ] **Step 2: Write the manifest, hooks.json and .gitignore**

`.claude-plugin/plugin.json`:

```json
{
  "name": "apprentice",
  "version": "0.1.0",
  "description": "Learn the code Claude is changing in your repo: a knowledge map plus one short card per editing turn",
  "author": { "name": "Almog Koren", "url": "https://almog.io" },
  "license": "Apache-2.0"
}
```

`hooks/hooks.json`:

```json
{
  "description": "The Apprentice hooks module",
  "modules": ["./register.ts"]
}
```

`.gitignore`:

```
.claude-plugin/types/
/tsconfig.json
```

- [ ] **Step 3: Write the shared types**

`src/core/types.ts`:

```ts
export type Level = 'junior' | 'mid' | 'senior'

export type Area = {
  id: string
  name: string
  paths: string[]
  lines: number
  score: number
  editsSinceLooked: number
  level: Level
  streak: number
}

export type QuestionCard = {
  kind: 'question'
  areaId: string
  level: 'junior' | 'mid'
  file: string
  question: string
  options: [string, string, string]
  answer: 0 | 1 | 2
  explanation: string
  editId: string
  dimmedBy: number
}

export type FlawCard = {
  kind: 'flaw'
  areaId: string
  level: 'senior'
  file: string
  hunk: string
  haikuSeesFlaw: boolean
  summary: string
  explanation: string
  editId: string
  dimmedBy: number
}

export type Card = QuestionCard | FlawCard

export type Answer = {
  at: number
  areaId: string
  level: Level
  kind: Card['kind']
  skipped: boolean
  isRight: boolean
  flagged: boolean
  haikuSeesFlaw: boolean
}
```

- [ ] **Step 4: Write the failing test**

`tests/scaffold.test.ts`:

```ts
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
```

- [ ] **Step 5: Run it to see it fail**

Run: `claude plugin test`
Expected: FAIL. The hooks module doesn't exist yet, so loading the mod fails.

- [ ] **Step 6: Write the minimal hooks module**

`hooks/register.ts`:

```ts
import type { Area } from '../src/core/types.ts'

export const MAP_PANE = 'apprentice'

// Module state. Task 10 adds the rest.
let areas: Area[] = []

export function register(on: any) {
  on('session.start', async ($: any, e: any, next: any) => {
    await $.command.register({
      name: 'apprentice',
      description: 'Open your knowledge map of this repo',
      argumentHint: '[wrapped | quiet [minutes] | remap]',
      immediate: true,
    })
    return next(e)
  })

  on('command.run', { command: 'apprentice' }, async () => {
    return { text: 'Apprentice has ' + areas.length + ' areas mapped.' }
  })
}
```

- [ ] **Step 7: Run the tests and validate**

Run: `claude plugin test`
Expected: PASS, 2 tests.

Run: `claude plugin validate .`
Expected: `✔ Validation passed`, with a `hooks:` line listing `session.start, command.run{command=apprentice}` and a `calls:` line listing `$.command.register`.

If either command rejects the import `'../src/core/types.ts'`, change every relative import in this plan to end in `.js` instead of `.ts` (for example `'../src/core/types.js'`), rerun both commands, and use `.js` in all later tasks. Record which one worked in the commit message.

- [ ] **Step 8: Generate the types for this build and check four assumptions**

In a separate terminal, start one interactive session from the repo root so Claude Code writes the type declarations, then quit it:

```bash
claude --plugin-dir .
```

Then check the generated declarations:

```bash
grep -n "timeoutMs" .claude-plugin/types/claude-code/index.d.ts | head -5
grep -n -A3 "copy: (" .claude-plugin/types/claude-code/index.d.ts | head -8
grep -n -A2 "keys: (" .claude-plugin/types/claude-code/index.d.ts | head -6
grep -n -A12 "export type TurnStartInput" .claude-plugin/types/claude-code/index.d.ts | head -14
```

Expected, and what to do if not:
- `ModelCompleteRequest` has `timeoutMs`. If not, drop `timeoutMs` from the `$.model.complete` calls in Tasks 10 and 11.
- `$.ui.copy` takes the text to copy as its first argument. If its shape differs, adjust `copyWrapped` in Task 12 and the `ui.copy` stub in `tests/helpers.ts` to match.
- `$.store.keys` takes no arguments and resolves to `string[]`. If it takes a prefix, pass `'repo:'` in `pruneAnswers` (Task 12).
- Whether `TurnStartInput` has `agentId`. If not, the `turn.start` hook in Task 11 still works: `e.agentId` is always `undefined`.

- [ ] **Step 9: Commit**

```bash
git add .claude-plugin/plugin.json hooks src tests .gitignore
git commit -m "chore: scaffold the apprentice mod

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Understanding rules

**Files:**
- Create: `src/core/understanding.ts`
- Test: `tests/understanding.test.ts`

**Interfaces:**
- Consumes: `Area`, `FlawCard`, `Level` from `src/core/types.ts`.
- Produces:
  - `round4(x: number): number`
  - `seedScore(mine: number, sampled: number): number`
  - `initialLevel(score: number): Level`
  - `countLines(text: unknown): number`
  - `changedLinesOf(tool: string, input: Record<string, unknown>): number`
  - `dimmedByFor(area: Area, changedLines: number): number`
  - `applyDim(area: Area, dimmedBy: number): Area`
  - `applyAnswer(area: Area, dimmedBy: number, isRight: boolean): Area`
  - `isFlawAnswerRight(card: FlawCard, pressed: 'flag' | 'looks-fine'): boolean`
  - `knownPercent(areas: Area[]): number`

- [ ] **Step 1: Write the failing tests**

`tests/understanding.test.ts`:

```ts
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
```

- [ ] **Step 2: Run them to see them fail**

Run: `claude plugin test tests/understanding.test.ts`
Expected: FAIL, the module `src/core/understanding.ts` can't be found.

- [ ] **Step 3: Implement**

`src/core/understanding.ts`:

```ts
import type { Area, FlawCard, Level } from './types.ts'

export const SEED_CAP = 0.9
export const RIGHT_BONUS = 0.02
export const WRONG_SHARE = 0.25
const LEVELS: Level[] = ['junior', 'mid', 'senior']

export function round4(x: number): number {
  return Math.round(x * 10000) / 10000
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

export function seedScore(mine: number, sampled: number): number {
  if (sampled <= 0) return 0
  return round4(Math.min(SEED_CAP, mine / sampled))
}

export function initialLevel(score: number): Level {
  if (score < 0.4) return 'junior'
  if (score < 0.75) return 'mid'
  return 'senior'
}

export function countLines(text: unknown): number {
  if (typeof text !== 'string' || text === '') return 0
  return text.split('\n').length
}

export function changedLinesOf(tool: string, input: Record<string, unknown>): number {
  if (tool === 'Write') return countLines(input.content)
  if (tool === 'Edit') return Math.max(countLines(input.old_string), countLines(input.new_string))
  if (tool === 'MultiEdit' && Array.isArray(input.edits)) {
    return input.edits.reduce(
      (sum: number, edit: any) => sum + Math.max(countLines(edit?.old_string), countLines(edit?.new_string)),
      0,
    )
  }
  return 0
}

export function dimmedByFor(area: Area, changedLines: number): number {
  const share = area.lines > 0 ? changedLines / area.lines : 1
  return round4(Math.min(area.score, Math.max(0, share)))
}

export function applyDim(area: Area, dimmedBy: number): Area {
  const taken = Math.min(area.score, dimmedBy)
  return { ...area, score: round4(area.score - taken), editsSinceLooked: area.editsSinceLooked + 1 }
}

export function applyAnswer(area: Area, dimmedBy: number, isRight: boolean): Area {
  const raised = isRight ? area.score + dimmedBy + RIGHT_BONUS : area.score + dimmedBy * WRONG_SHARE
  let streak = isRight ? Math.max(area.streak, 0) + 1 : Math.min(area.streak, 0) - 1
  let level = area.level
  const index = LEVELS.indexOf(level)
  if (streak >= 3) {
    level = LEVELS[Math.min(index + 1, LEVELS.length - 1)]
    streak = 0
  } else if (streak <= -2) {
    level = LEVELS[Math.max(index - 1, 0)]
    streak = 0
  }
  return { ...area, score: round4(clamp01(raised)), streak, level, editsSinceLooked: 0 }
}

export function isFlawAnswerRight(card: FlawCard, pressed: 'flag' | 'looks-fine'): boolean {
  return (pressed === 'flag') === card.haikuSeesFlaw
}

export function knownPercent(areas: Area[]): number {
  const total = areas.reduce((sum, a) => sum + a.lines, 0)
  if (total === 0) return 0
  return Math.round((areas.reduce((sum, a) => sum + a.score * a.lines, 0) / total) * 100)
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `claude plugin test tests/understanding.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/understanding.ts tests/understanding.test.ts
git commit -m "feat(core): add seeding, dimming and answer rules

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Grouping files into areas

**Files:**
- Create: `src/core/areas.ts`
- Test: `tests/areas.test.ts`

**Interfaces:**
- Consumes: `Area` from `types.ts`; `initialLevel`, `round4` from `understanding.ts`.
- Produces:
  - `type FileInfo = { path: string; lines: number }`
  - `type AreaDraft = { id: string; name: string; paths: string[]; lines: number; files: FileInfo[] }`
  - `groupAreas(files: FileInfo[], commits: string[][]): AreaDraft[]` (sorted by lines, largest first, then id)
  - `draftToArea(draft: AreaDraft, score: number): Area`
  - `areaForPath<T extends { paths: string[] }>(list: T[], path: string): T | undefined`
  - `renameArea(list: Area[], id: string, name: string): Area[]`
  - `mergeAreas(list: Area[], fromId: string, intoId: string): Area[]`

- [ ] **Step 1: Write the failing tests**

`tests/areas.test.ts`:

```ts
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
```

- [ ] **Step 2: Run them to see them fail**

Run: `claude plugin test tests/areas.test.ts`
Expected: FAIL, `src/core/areas.ts` can't be found.

- [ ] **Step 3: Implement**

`src/core/areas.ts`:

```ts
import type { Area } from './types.ts'
import { initialLevel, round4 } from './understanding.ts'

export type FileInfo = { path: string; lines: number }
export type AreaDraft = { id: string; name: string; paths: string[]; lines: number; files: FileInfo[] }

export const SPLIT_SHARE = 0.25
export const SMALL_SHARE = 0.02
export const COCHANGE_RATIO = 0.6
export const MIN_COMMITS = 3
export const MIN_AREAS = 6
export const MAX_AREAS = 15

// A folder prefix such as 'src/' (everything under it), or its direct files only.
type Group = { prefix: string; direct: boolean; files: FileInfo[] }
type Cluster = { id: string; name: string; paths: string[]; files: FileInfo[] }

const sumLines = (files: FileInfo[]) => files.reduce((sum, f) => sum + f.lines, 0)

function idForPrefix(prefix: string): string {
  if (prefix === '') return 'root'
  return prefix.replace(/\/$/, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'root'
}

function nameForPrefix(prefix: string): string {
  return prefix === '' ? 'Root files' : prefix.replace(/\/$/, '')
}

function initialGroups(files: FileInfo[]): Group[] {
  const groups = new Map<string, Group>()
  for (const f of files) {
    const slash = f.path.indexOf('/')
    const direct = slash === -1
    const prefix = direct ? '' : f.path.slice(0, slash + 1)
    const key = (direct ? '=' : '') + prefix
    if (!groups.has(key)) groups.set(key, { prefix, direct, files: [] })
    groups.get(key)!.files.push(f)
  }
  return [...groups.values()]
}

function childPrefix(prefix: string, path: string): string | null {
  const rest = path.slice(prefix.length)
  const slash = rest.indexOf('/')
  return slash === -1 ? null : prefix + rest.slice(0, slash + 1)
}

function canSplit(g: Group): boolean {
  return !g.direct && g.files.some(f => childPrefix(g.prefix, f.path) !== null)
}

function split(g: Group): Group[] {
  const children = new Map<string, Group>()
  const direct: FileInfo[] = []
  for (const f of g.files) {
    const child = childPrefix(g.prefix, f.path)
    if (child === null) {
      direct.push(f)
      continue
    }
    if (!children.has(child)) children.set(child, { prefix: child, direct: false, files: [] })
    children.get(child)!.files.push(f)
  }
  const out = [...children.values()]
  if (direct.length > 0) out.push({ prefix: g.prefix, direct: true, files: direct })
  return out
}

function commitSet(cluster: Cluster, commits: string[][]): Set<number> {
  const mine = new Set(cluster.files.map(f => f.path))
  const touched = new Set<number>()
  commits.forEach((commit, i) => {
    if (commit.some(path => mine.has(path))) touched.add(i)
  })
  return touched
}

// Keeps the larger cluster's id and name; on a tie, the first one's.
function mergePair(list: Cluster[], i: number, j: number): Cluster[] {
  const [a, b] = [list[i], list[j]]
  const keep = sumLines(b.files) > sumLines(a.files) ? b : a
  const merged: Cluster = { id: keep.id, name: keep.name, paths: [...a.paths, ...b.paths], files: [...a.files, ...b.files] }
  return list.filter((_, k) => k !== i && k !== j).concat(merged)
}

function mergeByCoChange(clusters: Cluster[], commits: string[][]): Cluster[] {
  let list = clusters
  while (list.length > MIN_AREAS) {
    const sets = list.map(c => commitSet(c, commits))
    let best: { i: number; j: number; ratio: number } | null = null
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (list[i].id === 'other' || list[j].id === 'other') continue
        if (sets[i].size < MIN_COMMITS || sets[j].size < MIN_COMMITS) continue
        const both = [...sets[i]].filter(c => sets[j].has(c)).length
        const either = new Set([...sets[i], ...sets[j]]).size
        const ratio = both / either
        if (ratio > COCHANGE_RATIO && (!best || ratio > best.ratio)) best = { i, j, ratio }
      }
    }
    if (!best) break
    list = mergePair(list, best.i, best.j)
  }
  return list
}

function capCount(clusters: Cluster[]): Cluster[] {
  let list = clusters
  while (list.length > MAX_AREAS) {
    const order = list
      .map((c, i) => ({ i, lines: sumLines(c.files), id: c.id }))
      .sort((a, b) => a.lines - b.lines || a.id.localeCompare(b.id))
    const [first, second] = [order[0].i, order[1].i].sort((a, b) => a - b)
    list = mergePair(list, first, second)
  }
  return list
}

function uniqueIds(clusters: Cluster[]): Cluster[] {
  const seen = new Map<string, number>()
  return clusters.map(c => {
    const count = (seen.get(c.id) ?? 0) + 1
    seen.set(c.id, count)
    return count === 1 ? c : { ...c, id: `${c.id}-${count}` }
  })
}

export function groupAreas(files: FileInfo[], commits: string[][]): AreaDraft[] {
  const total = sumLines(files)
  if (total === 0) return []
  let groups = initialGroups(files)
  for (let guard = 0; guard < 500; guard++) {
    const big = groups
      .filter(g => sumLines(g.files) > SPLIT_SHARE * total && canSplit(g))
      .sort((a, b) => sumLines(b.files) - sumLines(a.files))[0]
    if (!big) break
    groups = [...groups.filter(g => g !== big), ...split(big)]
  }
  const small = groups.filter(g => sumLines(g.files) < SMALL_SHARE * total)
  const kept = groups.filter(g => !small.includes(g))
  let clusters: Cluster[] = kept.map(g => ({
    id: idForPrefix(g.prefix), name: nameForPrefix(g.prefix), paths: [g.prefix], files: g.files,
  }))
  if (small.length > 0) {
    clusters.push({ id: 'other', name: 'Other', paths: small.map(g => g.prefix), files: small.flatMap(g => g.files) })
  }
  clusters = capCount(mergeByCoChange(uniqueIds(clusters), commits))
  return clusters
    .map(c => ({ id: c.id, name: c.name, paths: [...c.paths].sort(), lines: sumLines(c.files), files: c.files }))
    .sort((a, b) => b.lines - a.lines || a.id.localeCompare(b.id))
}

export function draftToArea(draft: AreaDraft, score: number): Area {
  return {
    id: draft.id, name: draft.name, paths: draft.paths, lines: draft.lines,
    score, editsSinceLooked: 0, level: initialLevel(score), streak: 0,
  }
}

export function areaForPath<T extends { paths: string[] }>(list: T[], path: string): T | undefined {
  let best: T | undefined
  let bestLength = -1
  for (const item of list) {
    for (const prefix of item.paths) {
      if (path.startsWith(prefix) && prefix.length > bestLength) {
        best = item
        bestLength = prefix.length
      }
    }
  }
  return best
}

export function renameArea(list: Area[], id: string, name: string): Area[] {
  const clean = name.trim()
  if (clean === '') return list
  return list.map(a => (a.id === id ? { ...a, name: clean } : a))
}

export function mergeAreas(list: Area[], fromId: string, intoId: string): Area[] {
  const from = list.find(a => a.id === fromId)
  const into = list.find(a => a.id === intoId)
  if (!from || !into || from === into) return list
  const lines = from.lines + into.lines
  const score = lines > 0 ? round4((from.score * from.lines + into.score * into.lines) / lines) : 0
  const merged: Area = {
    ...into, paths: [...into.paths, ...from.paths], lines, score,
    editsSinceLooked: from.editsSinceLooked + into.editsSinceLooked, streak: 0,
  }
  return list.filter(a => a !== from).map(a => (a === into ? merged : a))
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `claude plugin test tests/areas.test.ts`
Expected: PASS, 11 tests. If the co-change test's order differs, check that `mergePair` appends the merged cluster at the end and that the final sort is by lines, then id.

- [ ] **Step 5: Commit**

```bash
git add src/core/areas.ts tests/areas.test.ts
git commit -m "feat(core): group repo files into areas

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Parsing git output

**Files:**
- Create: `src/core/git.ts`
- Test: `tests/git.test.ts`

**Interfaces:**
- Consumes: `FileInfo` from `areas.ts`.
- Produces:
  - `BYTES_PER_LINE = 40`, `BLAME_SAMPLE = 20`
  - `parseLsTree(stdout: string): FileInfo[]`
  - `parseLog(stdout: string): string[][]`
  - `parseBlame(stdout: string, email: string): { mine: number; total: number }`
  - `repoIdFrom(text: string): Promise<string>`
  - `relativeTo(root: string, path: string): string | null`
  - `repoNameOf(root: string): string`
  - `sampleFiles(files: FileInfo[], n: number): FileInfo[]`

- [ ] **Step 1: Write the failing tests**

`tests/git.test.ts`:

```ts
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
```

- [ ] **Step 2: Run them to see them fail**

Run: `claude plugin test tests/git.test.ts`
Expected: FAIL, `src/core/git.ts` can't be found.

- [ ] **Step 3: Implement**

`src/core/git.ts`:

```ts
import type { FileInfo } from './areas.ts'

export const BYTES_PER_LINE = 40
export const BLAME_SAMPLE = 20
const LS_TREE_LINE = /^\d+ blob [0-9a-f]+\s+(\d+)\t(.+)$/

export function parseLsTree(stdout: string): FileInfo[] {
  const files: FileInfo[] = []
  for (const line of stdout.split('\n')) {
    const match = LS_TREE_LINE.exec(line)
    if (match) files.push({ path: match[2], lines: Math.max(1, Math.round(Number(match[1]) / BYTES_PER_LINE)) })
  }
  return files
}

export function parseLog(stdout: string): string[][] {
  const commits: string[][] = []
  let current: string[] | null = null
  for (const raw of stdout.split('\n')) {
    const line = raw.trim()
    if (line === '@@commit') {
      current = []
      commits.push(current)
    } else if (line !== '' && current) {
      current.push(line)
    }
  }
  return commits.filter(c => c.length > 0)
}

export function parseBlame(stdout: string, email: string): { mine: number; total: number } {
  const want = `<${email.trim().toLowerCase()}>`
  let mine = 0
  let total = 0
  for (const line of stdout.split('\n')) {
    if (!line.startsWith('author-mail ')) continue
    total += 1
    if (line.slice('author-mail '.length).trim().toLowerCase() === want) mine += 1
  }
  return { mine, total }
}

export async function repoIdFrom(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
}

export function relativeTo(root: string, path: string): string | null {
  if (!path.startsWith('/')) return path.replace(/^\.\//, '')
  const base = root.endsWith('/') ? root : root + '/'
  return path.startsWith(base) ? path.slice(base.length) : null
}

export function repoNameOf(root: string): string {
  return root.split('/').filter(Boolean).at(-1) ?? root
}

export function sampleFiles(files: FileInfo[], n: number): FileInfo[] {
  return [...files].sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path)).slice(0, n)
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `claude plugin test tests/git.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/git.ts tests/git.test.ts
git commit -m "feat(core): parse git ls-tree, log and blame output

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Weeks and Wrapped

**Files:**
- Create: `src/core/wrapped.ts`
- Test: `tests/wrapped.test.ts`

**Interfaces:**
- Consumes: `Answer`, `Area` from `types.ts`.
- Produces:
  - `isoWeek(ms: number): string` (such as `'2026-W43'`)
  - `weekIndex(week: string): number`
  - `type Wrapped = { mastered: number; flawsCaught: number; answered: number; darkZones: number; biggestJump: { name: string; from: number; to: number } | null }`
  - `buildWrapped(answers: Answer[], areas: Area[], startScores: Record<string, number>): Wrapped`
  - `wrappedText(w: Wrapped, repoName: string, week: string): string`

- [ ] **Step 1: Write the failing tests**

`tests/wrapped.test.ts`:

```ts
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
```

- [ ] **Step 2: Run them to see them fail**

Run: `claude plugin test tests/wrapped.test.ts`
Expected: FAIL, `src/core/wrapped.ts` can't be found.

- [ ] **Step 3: Implement**

`src/core/wrapped.ts`:

```ts
import type { Answer, Area } from './types.ts'

export const MASTERED = 0.8
export const DARK = 0.3

export function isoWeek(ms: number): string {
  const date = new Date(ms)
  const dayFromMonday = (date.getUTCDay() + 6) % 7
  const thursday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - dayFromMonday + 3))
  const year = thursday.getUTCFullYear()
  // January 4th is always in week 1
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const jan4FromMonday = (jan4.getUTCDay() + 6) % 7
  const week = 1 + Math.round(((thursday.getTime() - jan4.getTime()) / 864e5 - 3 + jan4FromMonday) / 7)
  return `${year}-W${String(week).padStart(2, '0')}`
}

export function weekIndex(week: string): number {
  const [year, number] = week.split('-W').map(Number)
  return year * 53 + number
}

export type Wrapped = {
  mastered: number
  flawsCaught: number
  answered: number
  darkZones: number
  biggestJump: { name: string; from: number; to: number } | null
}

export function buildWrapped(answers: Answer[], areas: Area[], startScores: Record<string, number>): Wrapped {
  const startOf = (a: Area) => startScores[a.id] ?? a.score
  let jump: { name: string; from: number; to: number; gain: number } | null = null
  for (const a of areas) {
    const gain = a.score - startOf(a)
    if (gain > 0 && (!jump || gain > jump.gain)) {
      jump = { name: a.name, from: Math.round(startOf(a) * 100), to: Math.round(a.score * 100), gain }
    }
  }
  return {
    mastered: areas.filter(a => startOf(a) < MASTERED && a.score >= MASTERED).length,
    flawsCaught: answers.filter(a => a.flagged && a.haikuSeesFlaw).length,
    answered: answers.filter(a => !a.skipped).length,
    darkZones: areas.filter(a => a.score < DARK).length,
    biggestJump: jump ? { name: jump.name, from: jump.from, to: jump.to } : null,
  }
}

export function wrappedText(w: Wrapped, repoName: string, week: string): string {
  const lines = [
    `My week in ${repoName} (${week}), from Apprentice:`,
    `- Areas mastered: ${w.mastered}`,
    `- Flaws I caught: ${w.flawsCaught}`,
    `- Cards answered: ${w.answered}`,
    `- Dark zones left: ${w.darkZones}`,
  ]
  if (w.biggestJump) lines.push(`- Biggest jump: ${w.biggestJump.name}, ${w.biggestJump.from}% to ${w.biggestJump.to}%`)
  return lines.join('\n')
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `claude plugin test tests/wrapped.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/core/wrapped.ts tests/wrapped.test.ts
git commit -m "feat(core): add ISO weeks and the Wrapped summary

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Card requests, replies, exclusions and the hourly cap

**Files:**
- Create: `src/cards/exclude.ts`, `src/cards/policy.ts`, `src/cards/prompt.ts`, `src/cards/parse.ts`
- Test: `tests/cards.test.ts`

**Interfaces:**
- Consumes: `Card`, `FlawCard`, `Level` from `types.ts`; `AreaDraft` from `areas.ts`; `sampleFiles` from `git.ts`.
- Produces:
  - `isSecretPath(path: string): boolean`
  - `CARDS_PER_HOUR = 6`, `HOUR_MS = 3600000`, `cardsWithinHour(times: number[], now: number): number[]`
  - `MAX_DIFF_LINES = 120`, `MAX_HUNK_LINES = 40`
  - `type EditText = { file: string; oldText: string; newText: string }`
  - `editTextsOf(tool: string, input: Record<string, unknown>): { oldText: string; newText: string }`
  - `diffOf(edit: EditText, maxLines: number): string`
  - `buildCardRequest(areaName: string, level: Level, edit: EditText): { system: string; prompt: string }`
  - `buildNamingRequest(drafts: AreaDraft[]): { system: string; prompt: string }`
  - `flagPromptText(card: FlawCard): string`
  - `type CardMeta = { areaId: string; level: Level; file: string; editId: string; dimmedBy: number; hunk: string }`
  - `extractJson(text: string): unknown`
  - `parseCardReply(text: string, meta: CardMeta): Card | null`
  - `parseAreaNames(text: string, ids: string[]): Record<string, string>`

- [ ] **Step 1: Write the failing tests**

`tests/cards.test.ts`:

```ts
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
```

- [ ] **Step 2: Run them to see them fail**

Run: `claude plugin test tests/cards.test.ts`
Expected: FAIL, `src/cards/exclude.ts` can't be found.

- [ ] **Step 3: Implement**

`src/cards/exclude.ts`:

```ts
const SECRET_PATTERNS = [
  /(^|\/)\.env/i,
  /\.pem$/i,
  /\.key$/i,
  /(^|\/)id_rsa/i,
  /(^|\/)id_ed25519/i,
  /secret/i,
  /credential/i,
]

export function isSecretPath(path: string): boolean {
  return SECRET_PATTERNS.some(pattern => pattern.test(path))
}
```

`src/cards/policy.ts`:

```ts
export const CARDS_PER_HOUR = 6
export const HOUR_MS = 3_600_000

export function cardsWithinHour(times: number[], now: number): number[] {
  return times.filter(t => now - t < HOUR_MS)
}
```

`src/cards/prompt.ts`:

```ts
import type { AreaDraft } from '../core/areas.ts'
import { sampleFiles } from '../core/git.ts'
import type { FlawCard, Level } from '../core/types.ts'

export const MAX_DIFF_LINES = 120
export const MAX_HUNK_LINES = 40

export type EditText = { file: string; oldText: string; newText: string }

const QUESTION_SHAPE =
  'Reply with only JSON: {"question": string, "options": [string, string, string], "answer": 0 | 1 | 2, "explanation": string}. ' +
  'Keep the question under 140 characters, each option under 60, and the explanation under 400. Exactly one option is correct, and the others are plausible.'

const SYSTEMS: Record<Level, string> = {
  junior:
    'You write one multiple-choice question that helps a developer understand a change Claude just made in their own project. ' +
    'Ask what the change does or why it was made. ' + QUESTION_SHAPE,
  mid:
    'You write one multiple-choice question that helps a developer understand a change Claude just made in their own project. ' +
    'Ask what would break without it, or what it depends on. ' + QUESTION_SHAPE,
  senior:
    'You review one code change for a senior developer. Decide whether it has a real flaw: a bug, a security problem, or a behavior change that looks unintended. ' +
    'Reply with only JSON: {"haikuSeesFlaw": boolean, "summary": string, "explanation": string}. ' +
    'summary is one sentence under 200 characters that names the flaw, or says why the change looks fine. explanation is under 400 characters.',
}

const NAMING_SYSTEM =
  'You name areas of a codebase. Reply with only JSON that maps each area id to a name of one to three words, such as "Billing" or "Dog transfers". ' +
  'Use the folder and file names to pick names a developer on this project would use.'

const text = (value: unknown) => (typeof value === 'string' ? value : '')

export function editTextsOf(tool: string, input: Record<string, unknown>): { oldText: string; newText: string } {
  if (tool === 'Write') return { oldText: '', newText: text(input.content) }
  if (tool === 'MultiEdit' && Array.isArray(input.edits)) {
    return {
      oldText: input.edits.map((e: any) => text(e?.old_string)).join('\n'),
      newText: input.edits.map((e: any) => text(e?.new_string)).join('\n'),
    }
  }
  return { oldText: text(input.old_string), newText: text(input.new_string) }
}

export function diffOf(edit: EditText, maxLines: number): string {
  const lines = [
    ...(edit.oldText ? edit.oldText.split('\n').map(l => '-' + l) : []),
    ...(edit.newText ? edit.newText.split('\n').map(l => '+' + l) : []),
  ]
  if (lines.length <= maxLines) return lines.join('\n')
  return [...lines.slice(0, maxLines), `… ${lines.length - maxLines} more lines`].join('\n')
}

export function buildCardRequest(areaName: string, level: Level, edit: EditText): { system: string; prompt: string } {
  return {
    system: SYSTEMS[level],
    prompt: `Area: ${areaName}\nFile: ${edit.file}\nChange:\n${diffOf(edit, MAX_DIFF_LINES)}`,
  }
}

export function buildNamingRequest(drafts: AreaDraft[]): { system: string; prompt: string } {
  const lines = drafts.map(d => {
    const folders = d.paths.map(p => p || '(repo root)').join(', ')
    const files = sampleFiles(d.files, 5).map(f => f.path).join(', ')
    return `${d.id}: folders ${folders}; files ${files}`
  })
  return { system: NAMING_SYSTEM, prompt: lines.join('\n') }
}

export function flagPromptText(card: FlawCard): string {
  const concern = card.haikuSeesFlaw ? card.summary : 'something in this change looks wrong to them'
  return `Apprentice flag on ${card.file}: the user reviewed this change and is concerned: "${concern}". Check whether it was intended, and fix it if not.`
}
```

`src/cards/parse.ts`:

```ts
import type { Card, Level } from '../core/types.ts'

export type CardMeta = { areaId: string; level: Level; file: string; editId: string; dimmedBy: number; hunk: string }

export function extractJson(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

const isText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim() !== '' && value.length <= max

export function parseCardReply(text: string, meta: CardMeta): Card | null {
  const data = extractJson(text) as Record<string, unknown> | null
  if (!data || typeof data !== 'object') return null
  const base = { areaId: meta.areaId, file: meta.file, editId: meta.editId, dimmedBy: meta.dimmedBy }
  if (meta.level === 'senior') {
    if (typeof data.haikuSeesFlaw !== 'boolean') return null
    if (!isText(data.summary, 200) || !isText(data.explanation, 600)) return null
    return {
      kind: 'flaw', ...base, level: 'senior', hunk: meta.hunk,
      haikuSeesFlaw: data.haikuSeesFlaw, summary: data.summary.trim(), explanation: data.explanation.trim(),
    }
  }
  const options = data.options
  if (!isText(data.question, 300) || !Array.isArray(options) || options.length !== 3) return null
  if (!options.every(o => isText(o, 120))) return null
  if (data.answer !== 0 && data.answer !== 1 && data.answer !== 2) return null
  if (!isText(data.explanation, 600)) return null
  return {
    kind: 'question', ...base, level: meta.level,
    question: data.question.trim(),
    options: [options[0].trim(), options[1].trim(), options[2].trim()],
    answer: data.answer, explanation: data.explanation.trim(),
  }
}

export function parseAreaNames(text: string, ids: string[]): Record<string, string> {
  const data = extractJson(text) as Record<string, unknown> | null
  const names: Record<string, string> = {}
  if (!data || typeof data !== 'object') return names
  for (const id of ids) {
    if (isText(data[id], 40)) names[id] = (data[id] as string).trim()
  }
  return names
}
```

Key order matters for `toEqual` only if the runner compares order; if a `toEqual` on a card fails only on key order, switch that assertion to `toMatchObject`.

- [ ] **Step 4: Run them to see them pass**

Run: `claude plugin test tests/cards.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/cards tests/cards.test.ts
git commit -m "feat(cards): build Haiku requests and parse replies

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Test helpers and the band card view

**Files:**
- Create: `src/views/elements.ts`, `src/views/card.ts`, `tests/helpers.ts`
- Test: `tests/view-card.test.ts`

**Interfaces:**
- Consumes: `Card` from `types.ts`.
- Produces:
  - `type Ctor = (props: Record<string, unknown>) => unknown`
  - `type Elements = { Box: Ctor; Text: Ctor; Button: Ctor; Code: Ctor; Input?: Ctor; Select?: Ctor; Svg?: Ctor; Raster?: Ctor }`
  - `type CardView = { card: Card; areaName: string; revealed: { isRight: boolean } | null }`
  - `type CardHandlers = { onAnswer: (index: number) => void; onFlaw: (pressed: 'flag' | 'looks-fine') => void; onSkip: () => void; onQuiet: () => void }`
  - `renderCard(E: Elements, view: CardView, h: CardHandlers): unknown`
  - Button keys: `ans-0`, `ans-1`, `ans-2`, `flaw-ok`, `flaw-flag`, `skip`, `quiet`
  - `tests/helpers.ts`: `fakeElements`, `walk(tree)`, `byKey(tree, key)`, `textsOf(tree)` (Task 10 adds the mod-test helpers to this file)

- [ ] **Step 1: Write the helpers and the element types**

`src/views/elements.ts`:

```ts
export type Ctor = (props: Record<string, unknown>) => unknown

export type Elements = {
  Box: Ctor
  Text: Ctor
  Button: Ctor
  Code: Ctor
  Input?: Ctor
  Select?: Ctor
  Svg?: Ctor
  Raster?: Ctor
}

export function line(E: Elements, text: string, props: Record<string, unknown> = {}): unknown {
  return E.Text({ ...props, children: [text] })
}
```

`tests/helpers.ts`:

```ts
import type { Elements } from '../src/views/elements.ts'

type Node = { type: string; props: Record<string, any> }

const make = (type: string) => (props: Record<string, unknown>) => ({ type, props })

export const fakeElements: Elements = {
  Box: make('Box'), Text: make('Text'), Button: make('Button'), Code: make('Code'),
  Input: make('Input'), Select: make('Select'), Svg: make('Svg'), Raster: make('Raster'),
}

export function walk(tree: unknown): Node[] {
  if (!tree || typeof tree !== 'object') return []
  const node = tree as Node
  const children = Array.isArray(node.props?.children) ? node.props.children : []
  return [node, ...children.flatMap(walk)]
}

export const byKey = (tree: unknown, key: string) => walk(tree).find(n => n.props?.key === key)

export const textsOf = (tree: unknown) =>
  walk(tree).filter(n => n.type === 'Text').map(n => (n.props.children ?? []).join(''))
```

- [ ] **Step 2: Write the failing tests**

`tests/view-card.test.ts`:

```ts
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
```

- [ ] **Step 3: Run them to see them fail**

Run: `claude plugin test tests/view-card.test.ts`
Expected: FAIL, `src/views/card.ts` can't be found.

- [ ] **Step 4: Implement**

`src/views/card.ts`:

```ts
import type { Card } from '../core/types.ts'
import { line, type Elements } from './elements.ts'

export type CardView = { card: Card; areaName: string; revealed: { isRight: boolean } | null }
export type CardHandlers = {
  onAnswer: (index: number) => void
  onFlaw: (pressed: 'flag' | 'looks-fine') => void
  onSkip: () => void
  onQuiet: () => void
}

function header(card: Card, areaName: string): string {
  const base = `Apprentice · ${areaName} · ${card.level} card`
  return card.kind === 'flaw' ? base + ' · spot the flaw' : base
}

function resultLine(card: Card, isRight: boolean): string {
  if (isRight) return 'Right.'
  if (card.kind === 'question') return `Not quite. The answer was ${card.answer + 1} · ${card.options[card.answer]}.`
  return card.haikuSeesFlaw ? 'Not quite. Haiku sees a flaw here.' : 'Not quite. Haiku thinks this change looks fine.'
}

function footer(E: Elements, h: CardHandlers): unknown {
  return E.Box({
    flexDirection: 'row', columnGap: 2,
    children: [
      E.Button({ key: 'skip', label: 'Skip', plain: true, dimColor: true, onPress: h.onSkip }),
      E.Button({ key: 'quiet', label: 'Quiet 1h', plain: true, dimColor: true, onPress: h.onQuiet }),
    ],
  })
}

export function renderCard(E: Elements, view: CardView, h: CardHandlers): unknown {
  const { card, areaName, revealed } = view
  const children: unknown[] = [line(E, header(card, areaName), { dimColor: true })]
  if (revealed) {
    children.push(line(E, resultLine(card, revealed.isRight), { bold: true, color: revealed.isRight ? 'green' : 'yellow' }))
    if (card.kind === 'flaw') children.push(line(E, card.summary))
    children.push(line(E, card.explanation))
    children.push(line(E, "Haiku's view, not a verdict on the code.", { dimColor: true }))
  } else if (card.kind === 'question') {
    children.push(line(E, card.question))
    children.push(E.Box({
      flexDirection: 'row', columnGap: 2,
      children: card.options.map((option, i) =>
        E.Button({ key: `ans-${i}`, label: `${i + 1} · ${option}`, hotkey: String(i + 1), onPress: () => h.onAnswer(i) })),
    }))
    children.push(footer(E, h))
  } else {
    children.push(E.Code({ key: 'hunk', source: card.hunk, path: card.file, format: 'diff' }))
    children.push(E.Box({
      flexDirection: 'row', columnGap: 2,
      children: [
        E.Button({ key: 'flaw-ok', label: '1 · Looks fine', hotkey: '1', onPress: () => h.onFlaw('looks-fine') }),
        E.Button({ key: 'flaw-flag', label: '2 · Flag to Claude', hotkey: '2', onPress: () => h.onFlaw('flag') }),
      ],
    }))
    children.push(footer(E, h))
  }
  return E.Box({ flexDirection: 'column', borderStyle: 'round', paddingX: 1, children })
}
```

`Code` doesn't list `key` among its props in the reference. If a mount test in Task 11 reports `Code prop "key" is not allowed`, remove `key: 'hunk'` here and find the `Code` element by `type` in this test instead.

- [ ] **Step 5: Run them to see them pass**

Run: `claude plugin test tests/view-card.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add src/views/elements.ts src/views/card.ts tests/helpers.ts tests/view-card.test.ts
git commit -m "feat(views): draw question and spot-the-flaw cards

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The map, as SVG and as a raster

**Files:**
- Create: `src/views/layout.ts`, `src/views/map-svg.ts`, `src/views/map-raster.ts`
- Test: `tests/view-map.test.ts`

**Interfaces:**
- Consumes: `Area` from `types.ts`; `knownPercent` from `understanding.ts`.
- Produces:
  - `MAP_WIDTH = 640`, `MAP_HEIGHT = 300`, `type Star = { id: string; x: number; y: number; r: number }`, `layoutStars(areas: Area[]): Star[]`
  - `escapeXml(s: string): string`, `mapSvg(areas: Area[], stars: Star[]): string`, `mapAlt(areas: Area[]): string`
  - `DEFAULT_COLOR = 0x01000000`, `RASTER_ROWS = 12`, `type Cell = { char: string; color: number }`, `starColor(score: number): number`, `rasterGrid(areas: Area[], stars: Star[], columns: number, rows: number): Cell[][]`, `encodeCells(grid: Cell[][]): string`, `rasterCells(areas: Area[], stars: Star[], columns: number, rows: number): string`

- [ ] **Step 1: Write the failing tests**

`tests/view-map.test.ts`:

```ts
import { expect, test } from 'claude-code/testing'
import type { Area } from '../src/core/types.ts'
import { MAP_HEIGHT, MAP_WIDTH, layoutStars } from '../src/views/layout.ts'
import { escapeXml, mapAlt, mapSvg } from '../src/views/map-svg.ts'
import { DEFAULT_COLOR, encodeCells, rasterGrid, starColor } from '../src/views/map-raster.ts'

const area = (id: string, over: Partial<Area> = {}): Area => ({
  id, name: id, paths: [`${id}/`], lines: 100, score: 0.5, editsSinceLooked: 0, level: 'mid', streak: 0, ...over,
})
const areas = [area('auth', { score: 0.92, lines: 300 }), area('billing', { score: 0.31, editsSinceLooked: 14, name: 'Billing & Co' }), area('docs', { score: 0.1 })]

test('layoutStars is stable and stays inside the map', async () => {
  const stars = layoutStars(areas)
  expect(layoutStars([...areas].reverse())).toEqual(stars)
  expect(stars.map(s => s.id)).toEqual(['auth', 'billing', 'docs'])
  for (const s of stars) {
    expect(s.x >= 60 && s.x <= MAP_WIDTH - 60).toBe(true)
    expect(s.y >= 40 && s.y <= MAP_HEIGHT - 70).toBe(true)
  }
  expect(stars[0].r > stars[2].r).toBe(true)
})

test('mapSvg draws a star per area, dashed when Claude changed it', async () => {
  const svg = mapSvg(areas, layoutStars(areas))
  expect(svg.startsWith('<svg')).toBe(true)
  expect(svg.match(/<circle/g)?.length).toBe(3)
  expect(svg).toContain('Billing &amp; Co')
  expect(svg).toContain('31% · 14 new')
  expect(svg.match(/stroke-dasharray/g)?.length).toBe(1)
  expect(escapeXml('<a "b">')).toBe('&lt;a &quot;b&quot;&gt;')
})

test('mapAlt states the headline', async () => {
  // (0.92 × 300 + 0.31 × 100 + 0.1 × 100) ÷ 500 = 0.634
  expect(mapAlt(areas)).toBe('Knowledge map of 3 areas: you know 63% of the code as it is today')
})

test('rasterGrid places one cell per star and colors it by score', async () => {
  const grid = rasterGrid(areas, layoutStars(areas), 60, 12)
  expect(grid.length).toBe(12)
  expect(grid[0].length).toBe(60)
  const marks = grid.flat().filter(c => c.char !== ' ')
  expect(marks.length).toBe(3)
  expect(marks.filter(c => c.char === '○').length).toBe(1)
  expect(starColor(0.9)).toBe(0x5dcaa5)
  expect(starColor(0.5)).toBe(0x1d9e75)
  expect(starColor(0.1)).toBe(0x5f5e5a)
  expect(grid[0].find(c => c.char === ' ')?.color).toBe(DEFAULT_COLOR)
})

test('encodeCells packs three 32-bit numbers per cell', async () => {
  const encoded = encodeCells([[{ char: 'A', color: 0x112233 }]])
  const bytes = (Uint8Array as any).fromBase64(encoded) as Uint8Array
  expect([...new Uint32Array(bytes.buffer)]).toEqual([65, 0x112233, DEFAULT_COLOR])
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `claude plugin test tests/view-map.test.ts`
Expected: FAIL, `src/views/layout.ts` can't be found.

- [ ] **Step 3: Implement**

`src/views/layout.ts`:

```ts
import type { Area } from '../core/types.ts'

export const MAP_WIDTH = 640
export const MAP_HEIGHT = 300
const GOLDEN_ANGLE = 2.399963

export type Star = { id: string; x: number; y: number; r: number }

const clamp = (x: number, low: number, high: number) => Math.min(high, Math.max(low, x))

// Sorted by id so the same areas always land in the same places.
export function layoutStars(areas: Area[]): Star[] {
  const total = areas.reduce((sum, a) => sum + a.lines, 0) || 1
  const ordered = [...areas].sort((a, b) => a.id.localeCompare(b.id))
  return ordered.map((a, i) => {
    const t = Math.sqrt((i + 0.5) / ordered.length)
    const angle = i * GOLDEN_ANGLE
    const x = clamp(MAP_WIDTH / 2 + Math.cos(angle) * t * 250, 60, MAP_WIDTH - 60)
    const y = clamp(MAP_HEIGHT / 2 - 20 + Math.sin(angle) * t * 95, 40, MAP_HEIGHT - 70)
    return { id: a.id, x: Math.round(x), y: Math.round(y), r: Math.round(8 + 24 * Math.sqrt(a.lines / total)) }
  })
}
```

`src/views/map-svg.ts`:

```ts
import type { Area } from '../core/types.ts'
import { knownPercent } from '../core/understanding.ts'
import { MAP_HEIGHT, MAP_WIDTH, type Star } from './layout.ts'

// The SVG is drawn as an image, outside the app's theme, so colors are mid-tones that read on light and dark.
const TEAL = '#1D9E75'
const GRAY = '#888780'

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function mapSvg(areas: Area[], stars: Star[]): string {
  const byId = new Map(areas.map(a => [a.id, a]))
  const parts = stars.map(s => {
    const a = byId.get(s.id)
    if (!a) return ''
    const changed = a.editsSinceLooked > 0
    const circle =
      `<circle cx="${s.x}" cy="${s.y}" r="${s.r}" fill="${TEAL}" fill-opacity="${(0.12 + 0.88 * a.score).toFixed(2)}" ` +
      `stroke="${changed ? GRAY : TEAL}" stroke-width="1.5"${changed ? ' stroke-dasharray="4 3"' : ''}/>`
    const name =
      `<text x="${s.x}" y="${s.y + s.r + 16}" text-anchor="middle" font-size="13" font-weight="600" fill="${GRAY}">${escapeXml(a.name)}</text>`
    const detail =
      `<text x="${s.x}" y="${s.y + s.r + 31}" text-anchor="middle" font-size="11" fill="${GRAY}">` +
      `${Math.round(a.score * 100)}%${changed ? ` · ${a.editsSinceLooked} new` : ''}</text>`
    return circle + name + detail
  })
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MAP_WIDTH} ${MAP_HEIGHT}" width="${MAP_WIDTH}" height="${MAP_HEIGHT}" font-family="sans-serif">` +
    parts.join('') +
    '</svg>'
  )
}

export function mapAlt(areas: Area[]): string {
  return `Knowledge map of ${areas.length} areas: you know ${knownPercent(areas)}% of the code as it is today`
}
```

`src/views/map-raster.ts`:

```ts
import type { Area } from '../core/types.ts'
import { MAP_HEIGHT, MAP_WIDTH, type Star } from './layout.ts'

export const DEFAULT_COLOR = 0x01000000
export const RASTER_ROWS = 12
const BRIGHT = 0x5dcaa5
const MID = 0x1d9e75
const DIM = 0x5f5e5a

export type Cell = { char: string; color: number }

export function starColor(score: number): number {
  if (score >= 0.66) return BRIGHT
  if (score >= 0.33) return MID
  return DIM
}

export function rasterGrid(areas: Area[], stars: Star[], columns: number, rows: number): Cell[][] {
  const grid: Cell[][] = Array.from({ length: rows }, () =>
    Array.from({ length: columns }, () => ({ char: ' ', color: DEFAULT_COLOR })))
  const byId = new Map(areas.map(a => [a.id, a]))
  for (const s of stars) {
    const a = byId.get(s.id)
    if (!a) continue
    const col = Math.round((s.x / MAP_WIDTH) * (columns - 1))
    const row = Math.round((s.y / MAP_HEIGHT) * (rows - 1))
    grid[row][col] = { char: a.editsSinceLooked > 0 ? '○' : '●', color: starColor(a.score) }
  }
  return grid
}

export function encodeCells(grid: Cell[][]): string {
  const numbers = grid.flat().flatMap(c => [c.char.codePointAt(0) ?? 32, c.color, DEFAULT_COLOR])
  // Uint8Array.prototype.toBase64 is an ES2025 method; the mods runtime has it.
  return (new Uint8Array(Uint32Array.from(numbers).buffer) as any).toBase64()
}

export function rasterCells(areas: Area[], stars: Star[], columns: number, rows: number): string {
  return encodeCells(rasterGrid(areas, stars, columns, rows))
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `claude plugin test tests/view-map.test.ts`
Expected: PASS, 5 tests. If two stars land on the same raster cell and the marks count is 2, raise `RASTER_ROWS` in the test call to 16 rather than changing the layout.

- [ ] **Step 5: Commit**

```bash
git add src/views/layout.ts src/views/map-svg.ts src/views/map-raster.ts tests/view-map.test.ts
git commit -m "feat(views): draw the knowledge map as SVG and as a raster

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The map pane and the Wrapped pane

**Files:**
- Create: `src/views/pane.ts`, `src/views/wrapped.ts`
- Test: `tests/view-pane.test.ts`

**Interfaces:**
- Consumes: `Area`, `Card` from `types.ts`; `knownPercent`; `Wrapped` from `wrapped.ts`; `layoutStars`, `mapSvg`, `mapAlt`, `rasterCells`, `RASTER_ROWS`; `line`, `Elements`.
- Produces:
  - `type PaneStatus = 'no-git' | 'idle' | 'mapping' | 'ready' | 'failed'`
  - `type PaneModel = { surface: string; status: PaneStatus; progress: string; error: string; repoName: string; areas: Area[]; selectedId: string | null; pending: Card[]; columns: number }`
  - `type PaneHandlers = { onSelect: (id: string | null) => void; onRename: (id: string, name: string) => void; onMerge: (fromId: string, intoId: string) => void; onRestore: (index: number) => void }`
  - `areaLabel(a: Area): string`, `renderPane(E: Elements, m: PaneModel, h: PaneHandlers): unknown`
  - `renderWrapped(E: Elements, w: Wrapped, repoName: string, week: string, h: { onCopy: () => void }): unknown`
  - Keys: `area-<id>`, `rename`, `merge`, `pending-<i>`, `close-area`, `copy`, `map`

- [ ] **Step 1: Write the failing tests**

`tests/view-pane.test.ts`:

```ts
import { expect, test } from 'claude-code/testing'
import type { Area, QuestionCard } from '../src/core/types.ts'
import { areaLabel, renderPane, type PaneModel } from '../src/views/pane.ts'
import { renderWrapped } from '../src/views/wrapped.ts'
import { byKey, fakeElements, textsOf, walk } from './helpers.ts'

const area = (id: string, over: Partial<Area> = {}): Area => ({
  id, name: id, paths: [`${id}/`], lines: 100, score: 0.5, editsSinceLooked: 0, level: 'mid', streak: 0, ...over,
})
const areas = [area('auth', { name: 'Auth', score: 0.92, lines: 300 }), area('billing', { name: 'Billing', score: 0.31, editsSinceLooked: 14 })]
const model = (over: Partial<PaneModel> = {}): PaneModel => ({
  surface: 'desktop', status: 'ready', progress: '', error: '', repoName: 'dogbase', areas, selectedId: null, pending: [], columns: 60, ...over,
})
const events: string[] = []
const handlers = {
  onSelect: (id: string | null) => events.push('select ' + id),
  onRename: (id: string, name: string) => events.push(`rename ${id} ${name}`),
  onMerge: (from: string, into: string) => events.push(`merge ${from} ${into}`),
  onRestore: (i: number) => events.push('restore ' + i),
}

test('areaLabel mentions Claude edits only when there are some', async () => {
  expect(areaLabel(areas[0])).toBe('Auth · 92%')
  expect(areaLabel(areas[1])).toBe('Billing · 31% · 14 Claude edits since you looked')
  expect(areaLabel(area('x', { name: 'X', editsSinceLooked: 1 }))).toBe('X · 50% · 1 Claude edit since you looked')
})

test('the Desktop pane shows the headline, an Svg and the area list', async () => {
  const tree = renderPane(fakeElements, model(), handlers)
  expect(textsOf(tree)).toContain('You know 77% of the code as it is today')
  expect(walk(tree).find(n => n.type === 'Svg')?.props.alt).toContain('Knowledge map of 2 areas')
  expect(byKey(tree, 'area-billing')?.props.label).toBe('Billing · 31% · 14 Claude edits since you looked')
  byKey(tree, 'area-billing')?.props.onPress()
  expect(events.splice(0)).toEqual(['select billing'])
})

test('the terminal pane draws a Raster instead', async () => {
  const tree = renderPane(fakeElements, model({ surface: 'terminal' }), handlers)
  expect(walk(tree).find(n => n.type === 'Svg')).toBeUndefined()
  expect(byKey(tree, 'map')?.props).toMatchObject({ columns: 60, rows: 12 })
})

test('a selected area can be renamed, merged and its cards restored', async () => {
  const pending: QuestionCard[] = [{
    kind: 'question', areaId: 'billing', level: 'junior', file: 'f', question: 'Why add an index?', options: ['a', 'b', 'c'],
    answer: 0, explanation: 'x', editId: 'e', dimmedBy: 0,
  }]
  const tree = renderPane(fakeElements, model({ selectedId: 'billing', pending }), handlers)
  byKey(tree, 'rename')?.props.onSubmit('Payments')
  byKey(tree, 'merge')?.props.onSelect('auth')
  byKey(tree, 'pending-0')?.props.onPress()
  byKey(tree, 'close-area')?.props.onPress()
  expect(byKey(tree, 'merge')?.props.options).toEqual([{ value: 'auth', label: 'Auth' }])
  expect(events.splice(0)).toEqual(['rename billing Payments', 'merge billing auth', 'restore 0', 'select null'])
})

test('status screens', async () => {
  expect(textsOf(renderPane(fakeElements, model({ surface: 'vscode' }), handlers))).toEqual(['Apprentice supports the Desktop app and the terminal.'])
  expect(textsOf(renderPane(fakeElements, model({ status: 'no-git' }), handlers))).toEqual(['Apprentice needs a git repo.'])
  expect(textsOf(renderPane(fakeElements, model({ status: 'failed', error: 'Mapping stopped while listing files.' }), handlers)))
    .toEqual(['Mapping stopped while listing files.', 'Run /apprentice remap to try again.'])
  expect(textsOf(renderPane(fakeElements, model({ status: 'mapping', areas: [], progress: 'Mapping your repo…' }), handlers))).toEqual(['Mapping your repo…'])
})

test('Wrapped shows four tiles, the jump and Copy', async () => {
  let copied = 0
  const tree = renderWrapped(fakeElements, { mastered: 3, flawsCaught: 4, answered: 37, darkZones: 2, biggestJump: { name: 'Firestore rules', from: 20, to: 55 } }, 'dogbase', '2026-W43', { onCopy: () => copied++ })
  const texts = textsOf(tree)
  expect(texts).toContain('Your week in dogbase')
  expect(texts).toContain('Cards answered')
  expect(texts).toContain('37')
  expect(texts).toContain('Biggest jump: Firestore rules, 20% to 55%')
  byKey(tree, 'copy')?.props.onPress()
  expect(copied).toBe(1)
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `claude plugin test tests/view-pane.test.ts`
Expected: FAIL, `src/views/pane.ts` can't be found.

- [ ] **Step 3: Implement**

`src/views/pane.ts`:

```ts
import type { Area, Card } from '../core/types.ts'
import { knownPercent } from '../core/understanding.ts'
import { line, type Elements } from './elements.ts'
import { layoutStars } from './layout.ts'
import { RASTER_ROWS, rasterCells } from './map-raster.ts'
import { mapAlt, mapSvg } from './map-svg.ts'

export type PaneStatus = 'no-git' | 'idle' | 'mapping' | 'ready' | 'failed'

export type PaneModel = {
  surface: string
  status: PaneStatus
  progress: string
  error: string
  repoName: string
  areas: Area[]
  selectedId: string | null
  pending: Card[]
  columns: number
}

export type PaneHandlers = {
  onSelect: (id: string | null) => void
  onRename: (id: string, name: string) => void
  onMerge: (fromId: string, intoId: string) => void
  onRestore: (index: number) => void
}

export function areaLabel(a: Area): string {
  const base = `${a.name} · ${Math.round(a.score * 100)}%`
  if (a.editsSinceLooked === 0) return base
  const edits = a.editsSinceLooked === 1 ? '1 Claude edit' : `${a.editsSinceLooked} Claude edits`
  return `${base} · ${edits} since you looked`
}

function cardTitle(card: Card): string {
  const text = card.kind === 'question' ? card.question : `Spot the flaw in ${card.file}`
  return text.length > 70 ? text.slice(0, 69) + '…' : text
}

function mapElement(E: Elements, m: PaneModel): unknown | null {
  const stars = layoutStars(m.areas)
  if (m.surface === 'desktop' && E.Svg) return E.Svg({ source: mapSvg(m.areas, stars), alt: mapAlt(m.areas) })
  if (m.surface === 'terminal' && E.Raster) {
    return E.Raster({ key: 'map', columns: m.columns, rows: RASTER_ROWS, cells: rasterCells(m.areas, stars, m.columns, RASTER_ROWS) })
  }
  return null
}

function details(E: Elements, m: PaneModel, a: Area, h: PaneHandlers): unknown {
  const others = m.areas.filter(o => o.id !== a.id)
  const children: unknown[] = [line(E, a.name, { bold: true })]
  if (E.Input) {
    children.push(E.Input({ key: 'rename', label: 'Rename', value: a.name, submitLabel: 'rename', onSubmit: (value: string) => h.onRename(a.id, value) }))
  }
  if (E.Select && others.length > 0) {
    children.push(E.Select({
      key: 'merge', label: 'Merge into',
      options: others.map(o => ({ value: o.id, label: o.name })),
      onSelect: (value: string) => h.onMerge(a.id, value),
    }))
  }
  if (m.pending.length > 0) {
    children.push(line(E, 'Skipped cards', { dimColor: true }))
    m.pending.forEach((card, i) => {
      children.push(E.Button({ key: `pending-${i}`, label: cardTitle(card), plain: true, onPress: () => h.onRestore(i) }))
    })
  }
  children.push(E.Button({ key: 'close-area', label: 'Close', plain: true, dimColor: true, onPress: () => h.onSelect(null) }))
  return E.Box({ flexDirection: 'column', borderStyle: 'round', paddingX: 1, children })
}

export function renderPane(E: Elements, m: PaneModel, h: PaneHandlers): unknown {
  const column = (children: unknown[]) => E.Box({ flexDirection: 'column', children })
  if (m.surface === 'vscode') return column([line(E, 'Apprentice supports the Desktop app and the terminal.')])
  if (m.status === 'no-git') return column([line(E, 'Apprentice needs a git repo.')])
  if (m.status === 'failed') return column([line(E, m.error), line(E, 'Run /apprentice remap to try again.', { dimColor: true })])
  if (m.areas.length === 0) return column([line(E, m.status === 'idle' ? 'Run /apprentice to map this repo.' : m.progress)])

  const children: unknown[] = [
    E.Box({
      flexDirection: 'row', columnGap: 2,
      children: [line(E, m.repoName, { bold: true }), line(E, `You know ${knownPercent(m.areas)}% of the code as it is today`)],
    }),
  ]
  const map = mapElement(E, m)
  if (map) children.push(map)
  children.push(line(E, m.surface === 'terminal'
    ? '● you know it · ○ Claude changed it since'
    : 'Bright: you know it · Dashed: Claude changed it since', { dimColor: true }))
  if (m.status === 'mapping') children.push(line(E, m.progress, { dimColor: true }))
  for (const a of [...m.areas].sort((x, y) => y.lines - x.lines || x.id.localeCompare(y.id))) {
    children.push(E.Button({ key: `area-${a.id}`, label: areaLabel(a), plain: true, onPress: () => h.onSelect(a.id) }))
  }
  const selected = m.areas.find(a => a.id === m.selectedId)
  if (selected) children.push(details(E, m, selected, h))
  return column(children)
}
```

`src/views/wrapped.ts`:

```ts
import type { Wrapped } from '../core/wrapped.ts'
import { line, type Elements } from './elements.ts'

function tile(E: Elements, label: string, value: number): unknown {
  return E.Box({
    flexDirection: 'column', borderStyle: 'round', paddingX: 1,
    children: [line(E, label, { dimColor: true }), line(E, String(value), { bold: true })],
  })
}

export function renderWrapped(E: Elements, w: Wrapped, repoName: string, week: string, h: { onCopy: () => void }): unknown {
  const children: unknown[] = [line(E, `Your week in ${repoName}`, { bold: true }), line(E, week, { dimColor: true })]
  if (w.answered === 0) {
    children.push(line(E, 'No cards answered this week yet.'))
    return E.Box({ flexDirection: 'column', children })
  }
  children.push(E.Box({
    flexDirection: 'row', columnGap: 2,
    children: [
      tile(E, 'Areas mastered', w.mastered),
      tile(E, 'Flaws you caught', w.flawsCaught),
      tile(E, 'Cards answered', w.answered),
      tile(E, 'Dark zones left', w.darkZones),
    ],
  }))
  if (w.biggestJump) {
    children.push(line(E, `Biggest jump: ${w.biggestJump.name}, ${w.biggestJump.from}% to ${w.biggestJump.to}%`))
  }
  children.push(E.Button({ key: 'copy', label: 'Copy', onPress: h.onCopy }))
  return E.Box({ flexDirection: 'column', children })
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `claude plugin test tests/view-pane.test.ts`
Expected: PASS, 6 tests. The headline is 77% because (0.92 × 300 + 0.31 × 100) ÷ 400 = 0.7675.

- [ ] **Step 5: Commit**

```bash
git add src/views/pane.ts src/views/wrapped.ts tests/view-pane.test.ts
git commit -m "feat(views): draw the map pane and the Wrapped pane

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Mapping the repo and the map pane

**Files:**
- Modify: `hooks/register.ts` (replace whole file), `tests/helpers.ts` (append), `tests/scaffold.test.ts` (one stub)
- Test: `tests/mod-map.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1 to 9.
- Produces, in `hooks/register.ts`: module state (`repo`, `status`, `progress`, `mapError`, `areas`, `selectedId`, `pendingCards`); top-level helpers `runGit($, root, args)`, `areaKey(id)`, `metaKey()`, `loadAreas($, r)`, `saveAllAreas($, r, list)`, `updateArea($, r, id, change)`, `startMapping($)`, `mapRepo($)`, `nameAreas($, drafts)`, `selectArea($, id)`, `renameAndSave($, id, name)`, `mergeAndSave($, fromId, intoId)`, `paneModel(e)`; the hooks `session.start`, `command.run` (`/apprentice`, `/apprentice remap`), `ui.render` for `Pane`. Section markers `// --- cards ---` and `// --- more hooks ---` that Tasks 11 and 12 add to.
- Produces, in `tests/helpers.ts`: `ROOT`, `REMOTE`, `NOW`, `GIT`, `NAMES_REPLY`, `QUESTION_REPLY`, `FLAW_REPLY`, `defaultModel`, `type World`, `stubWorld(on, opts)`, `paneSite(surface, requestId?)`, `bandSite(surface)`, `until(w, check, tries?)`, `mapFixture($, w)`, `areaIn(w, id)`.

- [ ] **Step 1: Append the mod-test helpers**

Append to `tests/helpers.ts`:

```ts
import { mock } from 'claude-code/testing'
import { repoIdFrom } from '../src/core/git.ts'

export const ROOT = '/work/dogbase'
export const REMOTE = 'git@github.com:example/dogbase.git'
// Friday 2026-10-23 12:00 UTC, ISO week 2026-W43
export const NOW = Date.UTC(2026, 9, 23, 12, 0, 0)

const blame = (emails: string[]) => emails.map(m => `author-mail <${m}>`).join('\n')

// Three files of 100 lines each: Billing (you wrote 3 of 4 sampled lines), Auth (none), Docs (all).
export const GIT: Record<string, { exitCode?: number; stdout: string }> = {
  'ls-tree -r -l HEAD': {
    stdout: [
      '100644 blob 1111111111111111111111111111111111111111    4000\tsrc/billing/invoice.ts',
      '100644 blob 2222222222222222222222222222222222222222    4000\tsrc/auth/login.ts',
      '100644 blob 3333333333333333333333333333333333333333    4000\tdocs/guide.md',
    ].join('\n'),
  },
  'log --name-only': { stdout: '@@commit\n\nsrc/billing/invoice.ts\n' },
  'config user.email': { stdout: 'me@example.com\n' },
  'blame --line-porcelain -- src/billing/invoice.ts': { stdout: blame(['me@example.com', 'me@example.com', 'me@example.com', 'other@example.com']) },
  'blame --line-porcelain -- src/auth/login.ts': { stdout: blame(['other@example.com']) },
  'blame --line-porcelain -- docs/guide.md': { stdout: blame(['me@example.com']) },
}

export const NAMES_REPLY = '{"docs":"Docs","src-auth":"Auth","src-billing":"Billing"}'
export const QUESTION_REPLY = JSON.stringify({
  question: 'What does this change add?', options: ['A log line', 'A delete', 'A rename'], answer: 0, explanation: 'It logs each invoice.',
})
export const FLAW_REPLY = JSON.stringify({
  haikuSeesFlaw: true, summary: 'Expired sessions are refreshed instead of denied.', explanation: 'The deny path is gone.',
})

export function defaultModel(e: any): string | null {
  const system = String(e.system ?? '')
  if (system.includes('You name areas')) return NAMES_REPLY
  if (system.includes('You review one code change')) return FLAW_REPLY
  return QUESTION_REPLY
}

export type World = {
  store: Map<string, any>
  submitted: string[]
  submitReplies: any[]
  toasts: string[]
  copied: string[]
  modelCalls: any[]
  clock: any
}

export type WorldOptions = {
  git?: Record<string, { exitCode?: number; stdout: string }>
  model?: (e: any) => string | null
  repo?: boolean
  store?: Record<string, unknown>
}

export function stubWorld(on: any, opts: WorldOptions = {}): World {
  const w: World = {
    store: new Map(Object.entries(opts.store ?? {})), submitted: [], submitReplies: [],
    toasts: [], copied: [], modelCalls: [], clock: null,
  }
  const git = { ...GIT, ...(opts.git ?? {}) }
  w.clock = mock.clock(on, { now: NOW })
  on('session.start', () => ({ cwd: ROOT }))
  on('command.register', () => ({ value: undefined }))
  on('session.repo', () => ({ value: opts.repo === false ? null : { root: ROOT, remote: REMOTE, internal: false } }))
  on('store.get', ($: any, e: any) => ({ value: w.store.get(e.key) }))
  on('store.set', ($: any, e: any) => { w.store.set(e.key, e.value); return { value: undefined } })
  on('store.delete', ($: any, e: any) => { w.store.delete(e.key); return { value: undefined } })
  on('store.keys', () => ({ value: [...w.store.keys()] }))
  on('process.run', ($: any, e: any) => {
    const args = e.argv.slice(1).join(' ')
    const hit = Object.entries(git).find(([k]) => args.startsWith(k))
    return { value: hit ? { exitCode: hit[1].exitCode ?? 0, stdout: hit[1].stdout, stderr: '' } : { exitCode: 1, stdout: '', stderr: 'no stub' } }
  })
  on('model.complete', ($: any, e: any) => {
    w.modelCalls.push(e)
    const text = (opts.model ?? defaultModel)(e)
    if (text === null) return { value: { isAnswered: false, reason: 'stubbed failure' } }
    return { value: { isAnswered: true, text, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', ($: any, e: any) => { w.toasts.push(e.text); return { value: undefined } })
  on('ui.copy', ($: any, e: any) => { w.copied.push(e.text); return { value: { isCopied: true } } })
  on('prompt.submit', ($: any, e: any) => { w.submitted.push(e.text); return w.submitReplies.shift() ?? { text: e.text } })
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['drawn by Claude Code'] }))
  on('tool.call', () => ({ result: 'ok' }))
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  return w
}

const viewport = { columns: 120, rows: 40 }

export function paneSite(surface: 'desktop' | 'terminal' | 'vscode', requestId = 'apprentice') {
  return {
    plugin: 'apprentice', component: 'Pane', requestId, surface, viewport,
    props: { title: 'Apprentice', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
  } as const
}

export function bandSite(surface: 'desktop' | 'terminal' | 'vscode') {
  return {
    plugin: 'apprentice', component: 'AbovePrompt', surface, viewport,
    props: { hasSurvey: false, isWorking: true, maxRows: 12, bodyColumns: 80, scroll: { offset: 0, bodyRows: 12 }, view: {} },
  } as const
}

// Background work runs on mock-clock timers and awaits stubs; settle and yield until the check passes.
export async function until(w: World, check: () => boolean | Promise<boolean>, tries = 300): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (await check()) return
    await w.clock.settle()
    await Promise.resolve()
  }
  throw new Error('condition never became true')
}

export async function repoId(): Promise<string> {
  return repoIdFrom(REMOTE)
}

export async function areaIn(w: World, id: string): Promise<any> {
  return w.store.get(`repo:${await repoId()}:area:${id}`)
}

export async function mapFixture($: any, w: World): Promise<void> {
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: ROOT })
  await $.command.run({ command: 'apprentice', args: '' })
  const key = `repo:${await repoId()}:meta`
  await until(w, () => w.store.has(key))
}
```

Move the two new `import` lines to the top of `tests/helpers.ts`, next to the existing import.

- [ ] **Step 2: Write the failing tests**

`tests/mod-map.test.ts`:

```ts
import { expect, test } from 'claude-code/testing'
import { areaIn, mapFixture, paneSite, repoId, stubWorld, until } from './helpers.ts'

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
```

The fixture's headline is 55%: (0.9 + 0 + 0.75) × 100 lines ÷ 300 lines.

- [ ] **Step 3: Run them to see them fail**

Run: `claude plugin test tests/mod-map.test.ts`
Expected: FAIL. The first test times out in `until` (`condition never became true`) because nothing maps yet.

- [ ] **Step 4: Replace the hooks module**

Replace `hooks/register.ts` with:

```ts
import { areaForPath, draftToArea, groupAreas, mergeAreas, renameArea, type AreaDraft } from '../src/core/areas.ts'
import { BLAME_SAMPLE, parseBlame, parseLog, parseLsTree, repoIdFrom, repoNameOf, sampleFiles } from '../src/core/git.ts'
import type { Area, Card } from '../src/core/types.ts'
import { initialLevel, seedScore } from '../src/core/understanding.ts'
import { parseAreaNames } from '../src/cards/parse.ts'
import { buildNamingRequest } from '../src/cards/prompt.ts'
import { renderPane, type PaneModel, type PaneStatus } from '../src/views/pane.ts'

export const MAP_PANE = 'apprentice'
export const WRAPPED_PANE = 'apprentice-wrapped'
const GIT_TIMEOUT_MS = 600_000
const USAGE = 'Usage: /apprentice [wrapped | quiet [minutes] | remap]'

type Repo = { id: string; root: string; name: string }
type Meta = { areaIds: string[]; weekStart?: { week: string; scores: Record<string, number> } }

// --- state ---
let repo: Repo | null = null
let status: PaneStatus = 'no-git'
let progress = ''
let mapError = ''
let areas: Area[] = []
let selectedId: string | null = null
let pendingCards: Card[] = []

// --- helpers ---
function areaKey(id: string): string {
  return `repo:${repo?.id}:area:${id}`
}

function metaKey(): string {
  return `repo:${repo?.id}:meta`
}

async function runGit($: any, root: string, args: string[]): Promise<{ exitCode: number; stdout: string }> {
  return $.process.run(['git', ...args], { cwd: root, timeoutMs: GIT_TIMEOUT_MS })
}

async function loadAreas($: any, r: Repo): Promise<Area[]> {
  const meta: Meta | undefined = await $.store.get(`repo:${r.id}:meta`)
  if (!meta || !Array.isArray(meta.areaIds)) return []
  const loaded: Area[] = []
  for (const id of meta.areaIds) {
    const a = await $.store.get(`repo:${r.id}:area:${id}`)
    if (a) loaded.push(a)
  }
  return loaded
}

async function saveAllAreas($: any, r: Repo, list: Area[]): Promise<void> {
  for (const a of list) await $.store.set(`repo:${r.id}:area:${a.id}`, a)
  const meta: Meta | undefined = await $.store.get(`repo:${r.id}:meta`)
  await $.store.set(`repo:${r.id}:meta`, { ...(meta ?? {}), areaIds: list.map(a => a.id) })
}

// Read the stored copy, apply the same pure change, write it back: safe when two sessions share a repo.
async function updateArea($: any, r: Repo, id: string, change: (a: Area) => Area): Promise<void> {
  const key = `repo:${r.id}:area:${id}`
  const stored: Area | undefined = await $.store.get(key)
  if (stored) await $.store.set(key, change(stored))
}

async function nameAreas($: any, drafts: AreaDraft[]): Promise<Record<string, string>> {
  const request = buildNamingRequest(drafts)
  try {
    const reply = await $.model.complete({ model: 'haiku', system: request.system, prompt: request.prompt, maxTokens: 600, timeoutMs: 20000 })
    return reply.isAnswered ? parseAreaNames(reply.text, drafts.map(d => d.id)) : {}
  } catch {
    return {}
  }
}

async function mapRepo($: any): Promise<void> {
  if (!repo) return
  const r = repo
  let step = 'listing files'
  try {
    const tree = await runGit($, r.root, ['ls-tree', '-r', '-l', 'HEAD'])
    if (tree.exitCode !== 0) throw new Error(step)
    const files = parseLsTree(tree.stdout)
    step = 'reading history'
    const log = await runGit($, r.root, ['log', '--name-only', '--format=@@commit', '-n', '500'])
    const commits = log.exitCode === 0 ? parseLog(log.stdout) : []
    const drafts = groupAreas(files, commits)
    step = 'naming areas'
    const names = await nameAreas($, drafts)
    const kept = new Map(areas.map(a => [a.id, a.name]))
    areas = drafts.map(d => draftToArea({ ...d, name: kept.get(d.id) ?? names[d.id] ?? d.name }, 0))
    $.ui.invalidate('ui.render')
    step = 'reading your git email'
    const email = (await runGit($, r.root, ['config', 'user.email'])).stdout.trim()
    step = 'seeding scores'
    for (let i = 0; i < drafts.length; i++) {
      const draft = drafts[i]
      let mine = 0
      let total = 0
      if (email !== '') {
        for (const f of sampleFiles(draft.files, BLAME_SAMPLE)) {
          const blamed = await runGit($, r.root, ['blame', '--line-porcelain', '--', f.path])
          if (blamed.exitCode !== 0) continue
          const counted = parseBlame(blamed.stdout, email)
          mine += counted.mine
          total += counted.total
        }
      }
      const score = seedScore(mine, total)
      areas = areas.map(a => (a.id === draft.id ? { ...a, score, level: initialLevel(score) } : a))
      progress = `Mapping your repo… ${i + 1} of ${drafts.length} areas seeded`
      $.ui.invalidate('ui.render')
    }
    step = 'saving'
    await saveAllAreas($, r, areas)
    status = 'ready'
    progress = ''
  } catch {
    status = 'failed'
    mapError = `Mapping stopped while ${step}.`
  }
  $.ui.invalidate('ui.render')
}

function startMapping($: any): void {
  status = 'mapping'
  progress = 'Mapping your repo…'
  selectedId = null
  $.ui.invalidate('ui.render')
  $.clock.after(0, () => mapRepo($))
}

async function selectArea($: any, id: string | null): Promise<void> {
  selectedId = id
  pendingCards = id && repo ? ((await $.store.get(`repo:${repo.id}:pending:${id}`)) ?? []) : []
  $.ui.invalidate('ui.render')
}

async function renameAndSave($: any, id: string, name: string): Promise<void> {
  if (!repo || name.trim() === '') return
  areas = renameArea(areas, id, name)
  $.ui.invalidate('ui.render')
  await updateArea($, repo, id, a => ({ ...a, name: name.trim() }))
}

async function mergeAndSave($: any, fromId: string, intoId: string): Promise<void> {
  if (!repo) return
  areas = mergeAreas(areas, fromId, intoId)
  const merged = areas.find(a => a.id === intoId)
  if (!merged) return
  await $.store.set(areaKey(intoId), merged)
  await $.store.delete(areaKey(fromId))
  const meta: Meta | undefined = await $.store.get(metaKey())
  await $.store.set(metaKey(), { ...(meta ?? {}), areaIds: areas.map(a => a.id) })
  selectedId = intoId
  pendingCards = (await $.store.get(`repo:${repo.id}:pending:${intoId}`)) ?? []
  $.ui.invalidate('ui.render')
}

function paneModel(e: any): PaneModel {
  return {
    surface: e.surface, status, progress, error: mapError, repoName: repo?.name ?? '',
    areas, selectedId, pending: pendingCards,
    columns: Math.max(20, Math.min(60, Number(e.props?.bodyColumns ?? 60))),
  }
}

// --- cards ---

export function register(on: any) {
  on('session.start', async ($: any, e: any, next: any) => {
    const found = await $.session.repo()
    if (found) {
      repo = { id: await repoIdFrom(found.remote ?? found.root), root: found.root, name: repoNameOf(found.root) }
      areas = await loadAreas($, repo)
      status = areas.length > 0 ? 'ready' : 'idle'
    }
    await $.command.register({
      name: 'apprentice',
      description: 'Open your knowledge map of this repo',
      argumentHint: '[wrapped | quiet [minutes] | remap]',
      immediate: true,
    })
    return next(e)
  })

  on('command.run', { command: 'apprentice' }, async ($: any, e: any) => {
    const [sub = ''] = String(e.args ?? '').trim().split(/\s+/)
    if (sub !== '' && sub !== 'remap') return { text: USAGE }
    if (repo && (sub === 'remap' || status === 'idle' || status === 'failed')) startMapping($)
    await $.ui.open({ id: MAP_PANE, title: 'Apprentice', focus: true, closeOnEscape: true })
    return {}
  })

  on('ui.render', { component: 'Pane' }, async ($: any, e: any, next: any) => {
    if (e.requestId !== MAP_PANE) return next(e)
    const E = $.ui.resolve(e)
    return renderPane(E, paneModel(e), {
      onSelect: (id: string | null) => selectArea($, id),
      onRename: (id: string, name: string) => renameAndSave($, id, name),
      onMerge: (fromId: string, intoId: string) => mergeAndSave($, fromId, intoId),
      onRestore: () => {},
    })
  })

  // --- more hooks ---
}
```

`onRestore` is a no-op only until Task 11, which replaces this `ui.render` hook. `areaForPath` is imported now and used in Task 11.

- [ ] **Step 5: Update the scaffold test's stubs**

`session.start` now reads the store when a repo exists. In `tests/scaffold.test.ts`, the stub `on('session.repo', () => ({ value: null }))` already returns no repo, so no store stub is needed. Leave the file as is.

- [ ] **Step 6: Run all tests and validate**

Run: `claude plugin test`
Expected: PASS, every test in every file.

Run: `claude plugin validate .`
Expected: `✔ Validation passed`. Its `calls:` line lists the calls with `(via mapRepo)` and similar. If validation reports that `$` is passed to a function defined inside a hook (the `onSelect` and similar arrows), move each handler's body inline, for example `onSelect: async (id) => { selectedId = id; … $.ui.invalidate('ui.render') }`, and rerun.

- [ ] **Step 7: Commit**

```bash
git add hooks/register.ts tests/helpers.ts tests/mod-map.test.ts
git commit -m "feat(mod): map the repo and show the knowledge map pane

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Dimming on edits and cards in the band

**Files:**
- Modify: `hooks/register.ts`
- Test: `tests/mod-cards.test.ts`

**Interfaces:**
- Consumes: `applyAnswer`, `applyDim`, `changedLinesOf`, `dimmedByFor`, `isFlawAnswerRight` (Task 2); `relativeTo` (Task 4); `isSecretPath`, `cardsWithinHour`, `CARDS_PER_HOUR`, `HOUR_MS`, `buildCardRequest`, `diffOf`, `editTextsOf`, `MAX_HUNK_LINES`, `parseCardReply` (Task 6); `renderCard` (Task 7); `isoWeek` (Task 5).
- Produces, in `register.ts`: state `card`, `revealed`, `quietUntil`, `cardTimes`, `firstEditDone`; top-level `makeCard($, ctx)`, `logAnswer($, c, outcome)`, `answerCard($, c, isRight, flagged)`, `skipCard($, c)`, `quietCards($, minutes)`, `restorePending($, index)`; hooks `turn.start`, `tool.call` for `Edit`/`Write`/`MultiEdit`, `ui.render` for `AbovePrompt`; `/apprentice quiet [minutes]`. Constants `REVEAL_MS = 8000`, `PENDING_MAX = 5`.

- [ ] **Step 1: Write the failing tests**

`tests/mod-cards.test.ts`:

```ts
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
```

- [ ] **Step 2: Run them to see them fail**

Run: `claude plugin test tests/mod-cards.test.ts`
Expected: FAIL. The first test fails on the `editsSinceLooked` assertion, because nothing dims yet.

- [ ] **Step 3: Add the imports**

Add to the imports at the top of `hooks/register.ts`:

```ts
import { relativeTo } from '../src/core/git.ts'
import { applyAnswer, applyDim, changedLinesOf, dimmedByFor, isFlawAnswerRight } from '../src/core/understanding.ts'
import { isoWeek } from '../src/core/wrapped.ts'
import { isSecretPath } from '../src/cards/exclude.ts'
import { CARDS_PER_HOUR, HOUR_MS, cardsWithinHour } from '../src/cards/policy.ts'
import { MAX_HUNK_LINES, buildCardRequest, diffOf, editTextsOf, type EditText } from '../src/cards/prompt.ts'
import { parseCardReply } from '../src/cards/parse.ts'
import { renderCard } from '../src/views/card.ts'
```

Merge them with the existing import lines from the same files (for example, add `relativeTo` to the existing `../src/core/git.ts` import) so each file is imported once.

- [ ] **Step 4: Add the card state and functions**

Below the `// --- cards ---` marker in `hooks/register.ts`, add:

```ts
const REVEAL_MS = 8000
const PENDING_MAX = 5

type CardContext = { areaId: string; areaName: string; level: Area['level']; edit: EditText; dimmedBy: number; editId: string }

let card: Card | null = null
let revealed: { isRight: boolean } | null = null
let quietUntil = 0
let cardTimes: number[] = []
let firstEditDone = false

async function makeCard($: any, ctx: CardContext): Promise<void> {
  if (!repo) return
  const ignored = await runGit($, repo.root, ['check-ignore', '-q', ctx.edit.file])
  if (ignored.exitCode === 0) return
  const request = buildCardRequest(ctx.areaName, ctx.level, ctx.edit)
  let reply: any
  try {
    reply = await $.model.complete({ model: 'haiku', system: request.system, prompt: request.prompt, maxTokens: 600, timeoutMs: 20000 })
  } catch {
    return
  }
  if (!reply?.isAnswered) return
  const parsed = parseCardReply(reply.text, {
    areaId: ctx.areaId, level: ctx.level, file: ctx.edit.file, editId: ctx.editId,
    dimmedBy: ctx.dimmedBy, hunk: diffOf(ctx.edit, MAX_HUNK_LINES),
  })
  if (!parsed) return
  const now = await $.clock.now()
  card = parsed
  revealed = null
  cardTimes = [...cardsWithinHour(cardTimes, now), now]
  $.ui.invalidate('ui.render')
}

async function logAnswer($: any, c: Card, outcome: { skipped: boolean; isRight: boolean; flagged: boolean }): Promise<void> {
  if (!repo) return
  const now = await $.clock.now()
  const key = `repo:${repo.id}:answers:${isoWeek(now)}`
  const log = (await $.store.get(key)) ?? []
  const entry = {
    at: now, areaId: c.areaId, level: c.level, kind: c.kind, ...outcome,
    haikuSeesFlaw: c.kind === 'flaw' ? c.haikuSeesFlaw : false,
  }
  await $.store.set(key, [...log, entry])
}

async function answerCard($: any, c: Card, isRight: boolean, flagged: boolean): Promise<void> {
  if (!repo || card !== c || revealed) return
  revealed = { isRight }
  areas = areas.map(a => (a.id === c.areaId ? applyAnswer(a, c.dimmedBy, isRight) : a))
  $.ui.invalidate('ui.render')
  await updateArea($, repo, c.areaId, a => applyAnswer(a, c.dimmedBy, isRight))
  await logAnswer($, c, { skipped: false, isRight, flagged })
  $.clock.after(REVEAL_MS, () => {
    if (card === c) {
      card = null
      revealed = null
      $.ui.invalidate('ui.render')
    }
  })
}

async function skipCard($: any, c: Card): Promise<void> {
  if (!repo || card !== c) return
  card = null
  revealed = null
  $.ui.invalidate('ui.render')
  const key = `repo:${repo.id}:pending:${c.areaId}`
  const pending: Card[] = (await $.store.get(key)) ?? []
  const updated = [...pending, c].slice(-PENDING_MAX)
  await $.store.set(key, updated)
  if (selectedId === c.areaId) pendingCards = updated
  await logAnswer($, c, { skipped: true, isRight: false, flagged: false })
}

async function quietCards($: any, minutes: number): Promise<void> {
  quietUntil = (await $.clock.now()) + minutes * 60_000
  card = null
  revealed = null
  $.ui.invalidate('ui.render')
}

async function restorePending($: any, index: number): Promise<void> {
  if (!repo || !selectedId) return
  const key = `repo:${repo.id}:pending:${selectedId}`
  const pending: Card[] = (await $.store.get(key)) ?? []
  const chosen = pending[index]
  if (!chosen) return
  const rest = pending.filter((_, i) => i !== index)
  await $.store.set(key, rest)
  pendingCards = rest
  card = chosen
  revealed = null
  $.ui.invalidate('ui.render')
}
```

- [ ] **Step 5: Replace the command and pane hooks, and add the new hooks**

In `register`, replace the `command.run` hook with:

```ts
  on('command.run', { command: 'apprentice' }, async ($: any, e: any) => {
    const [sub = '', arg = ''] = String(e.args ?? '').trim().split(/\s+/)
    if (sub === 'quiet') {
      const minutes = Number(arg) > 0 ? Math.round(Number(arg)) : 60
      await quietCards($, minutes)
      return { text: `Cards are paused for ${minutes} minutes.` }
    }
    if (sub !== '' && sub !== 'remap') return { text: USAGE }
    if (repo && (sub === 'remap' || status === 'idle' || status === 'failed')) startMapping($)
    await $.ui.open({ id: MAP_PANE, title: 'Apprentice', focus: true, closeOnEscape: true })
    return {}
  })
```

Replace the `ui.render` hook for `Pane` with:

```ts
  on('ui.render', { component: 'Pane' }, async ($: any, e: any, next: any) => {
    if (e.requestId !== MAP_PANE) return next(e)
    const E = $.ui.resolve(e)
    return renderPane(E, paneModel(e), {
      onSelect: (id: string | null) => selectArea($, id),
      onRename: (id: string, name: string) => renameAndSave($, id, name),
      onMerge: (fromId: string, intoId: string) => mergeAndSave($, fromId, intoId),
      onRestore: (index: number) => restorePending($, index),
    })
  })
```

Below the `// --- more hooks ---` marker, add:

```ts
  on('turn.start', async ($: any, e: any, next: any) => {
    if (e.agentId === undefined) firstEditDone = false
    return next(e)
  })

  on('tool.call', { tool: ['Edit', 'Write', 'MultiEdit'] }, async ($: any, e: any, next: any) => {
    const result = await next(e)
    if (result?.deny || result?.isError || status !== 'ready' || !repo) return result
    const rel = relativeTo(repo.root, String(e.file_path ?? ''))
    if (rel === null) return result
    const area = areaForPath(areas, rel)
    if (!area) return result
    const dimmedBy = dimmedByFor(area, changedLinesOf(e.tool, e))
    areas = areas.map(a => (a.id === area.id ? applyDim(a, dimmedBy) : a))
    $.ui.invalidate('ui.render')
    await updateArea($, repo, area.id, a => applyDim(a, dimmedBy))
    const now = await $.clock.now()
    const wantsCard = !firstEditDone && now >= quietUntil
      && cardsWithinHour(cardTimes, now).length < CARDS_PER_HOUR && !isSecretPath(rel)
    firstEditDone = true
    if (wantsCard) {
      const ctx: CardContext = {
        areaId: area.id, areaName: area.name, level: area.level,
        edit: { file: rel, ...editTextsOf(e.tool, e) }, dimmedBy, editId: `${now}`,
      }
      $.clock.after(0, () => makeCard($, ctx))
    }
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($: any, e: any, next: any) => {
    if (!card || e.surface === 'vscode') return next(e)
    const shown = card
    const E = $.ui.resolve(e)
    const areaName = areas.find(a => a.id === shown.areaId)?.name ?? 'Other'
    const theirs = await next(e)
    return E.Box({
      flexDirection: 'column',
      children: [
        renderCard(E, { card: shown, areaName, revealed }, {
          onAnswer: (index: number) => answerCard($, shown, shown.kind === 'question' && index === shown.answer, false),
          onFlaw: (pressed: 'flag' | 'looks-fine') =>
            answerCard($, shown, shown.kind === 'flaw' && isFlawAnswerRight(shown, pressed), pressed === 'flag'),
          onSkip: () => skipCard($, shown),
          onQuiet: () => quietCards($, 60),
        }),
        theirs,
      ],
    })
  })
```

`HOUR_MS` is imported for Task 12's toast timer; leave the import in place.

- [ ] **Step 6: Run all tests and validate**

Run: `claude plugin test`
Expected: PASS, every test in every file.

Run: `claude plugin validate .`
Expected: `✔ Validation passed`, with `tool.call{tool=Edit,Write,MultiEdit}`, `turn.start` and `ui.render{component=AbovePrompt}` on the `hooks:` line.

- [ ] **Step 7: Commit**

```bash
git add hooks/register.ts tests/mod-cards.test.ts
git commit -m "feat(mod): dim areas on edits and show cards in the band

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Flag to Claude, Wrapped, and the weekly bookkeeping

**Files:**
- Modify: `hooks/register.ts`
- Test: `tests/mod-wrapped.test.ts`

**Interfaces:**
- Consumes: `flagPromptText` (Task 6); `buildWrapped`, `isoWeek`, `weekIndex`, `wrappedText` (Task 5); `renderWrapped` (Task 9); `HOUR_MS` (Task 6).
- Produces, in `register.ts`: state `pendingFlag`; top-level `submitFlag($, text)`, `ensureWeekStart($, now)`, `pruneAnswers($, repoId, week)`, `checkWrappedToast($)`, `copyWrapped($, text)`; an updated `answerCard` and `skipCard`; hooks `turn.complete` and the `Pane` branch for `apprentice-wrapped`; `/apprentice wrapped`; an hourly timer in `session.start`. Constants `KEEP_WEEKS = 8`, `TOAST_MIN_ANSWERS = 5`.

- [ ] **Step 1: Write the failing tests**

`tests/mod-wrapped.test.ts`:

```ts
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
```

- [ ] **Step 2: Run them to see them fail**

Run: `claude plugin test tests/mod-wrapped.test.ts`
Expected: FAIL. The first test times out waiting for `w.submitted.length === 1`.

- [ ] **Step 3: Add the imports**

Add to the existing imports in `hooks/register.ts` (merge with lines from the same files):

```ts
import { buildWrapped, isoWeek, weekIndex, wrappedText } from '../src/core/wrapped.ts'
import { flagPromptText } from '../src/cards/prompt.ts'
import { renderWrapped } from '../src/views/wrapped.ts'
import type { Answer } from '../src/core/types.ts'
```

- [ ] **Step 4: Add the weekly and flag functions**

Below the card functions (after `restorePending`), add:

```ts
const KEEP_WEEKS = 8
const TOAST_MIN_ANSWERS = 5

let pendingFlag: string | null = null

async function submitFlag($: any, text: string): Promise<void> {
  let reason = ''
  try {
    const result = await $.prompt.submit({ text })
    reason = result?.drop ?? ''
  } catch (error: any) {
    reason = String(error?.message ?? error)
  }
  if (reason.includes('the session was stopped and nobody has sent input since') || reason.includes('was removed from the queue before it ran')) {
    pendingFlag = text
  }
}

async function pruneAnswers($: any, id: string, week: string): Promise<void> {
  const prefix = `repo:${id}:answers:`
  const keys: string[] = (await $.store.keys()) ?? []
  for (const key of keys) {
    if (!key.startsWith(prefix)) continue
    if (weekIndex(week) - weekIndex(key.slice(prefix.length)) > KEEP_WEEKS) await $.store.delete(key)
  }
}

async function ensureWeekStart($: any, now: number): Promise<void> {
  if (!repo) return
  const week = isoWeek(now)
  const meta: Meta = (await $.store.get(metaKey())) ?? { areaIds: areas.map(a => a.id) }
  if (meta.weekStart?.week === week) return
  const scores = Object.fromEntries(areas.map(a => [a.id, a.score]))
  await $.store.set(metaKey(), { ...meta, weekStart: { week, scores } })
  await pruneAnswers($, repo.id, week)
}

async function checkWrappedToast($: any): Promise<void> {
  if (!repo) return
  const week = isoWeek(await $.clock.now())
  const log: Answer[] = (await $.store.get(`repo:${repo.id}:answers:${week}`)) ?? []
  if (log.length < TOAST_MIN_ANSWERS) return
  const toastedKey = `repo:${repo.id}:toasted`
  if ((await $.store.get(toastedKey)) === week) return
  await $.store.set(toastedKey, week)
  $.ui.toast('Codebase Wrapped is ready: run /apprentice wrapped')
}

async function copyWrapped($: any, text: string): Promise<void> {
  await $.ui.copy(text)
  $.ui.toast('Copied')
}
```

- [ ] **Step 5: Replace `answerCard` and `skipCard`**

Replace both functions with these versions, which record the week's starting scores before changing anything and send the flag:

```ts
async function answerCard($: any, c: Card, isRight: boolean, flagged: boolean): Promise<void> {
  if (!repo || card !== c || revealed) return
  revealed = { isRight }
  await ensureWeekStart($, await $.clock.now())
  areas = areas.map(a => (a.id === c.areaId ? applyAnswer(a, c.dimmedBy, isRight) : a))
  $.ui.invalidate('ui.render')
  await updateArea($, repo, c.areaId, a => applyAnswer(a, c.dimmedBy, isRight))
  await logAnswer($, c, { skipped: false, isRight, flagged })
  if (flagged && c.kind === 'flaw') submitFlag($, flagPromptText(c))
  $.clock.after(REVEAL_MS, () => {
    if (card === c) {
      card = null
      revealed = null
      $.ui.invalidate('ui.render')
    }
  })
}

async function skipCard($: any, c: Card): Promise<void> {
  if (!repo || card !== c) return
  card = null
  revealed = null
  $.ui.invalidate('ui.render')
  await ensureWeekStart($, await $.clock.now())
  const key = `repo:${repo.id}:pending:${c.areaId}`
  const pending: Card[] = (await $.store.get(key)) ?? []
  const updated = [...pending, c].slice(-PENDING_MAX)
  await $.store.set(key, updated)
  if (selectedId === c.areaId) pendingCards = updated
  await logAnswer($, c, { skipped: true, isRight: false, flagged: false })
}
```

`answerCard` sets `revealed` before its first `await`, so a second press during the awaits is ignored.

- [ ] **Step 6: Update the hooks**

In the `session.start` hook, add this line right before `await $.command.register(...)`:

```ts
    $.clock.every(HOUR_MS, () => checkWrappedToast($))
```

In the `command.run` hook, add this branch right after the `quiet` branch:

```ts
    if (sub === 'wrapped') {
      await $.ui.open({ id: WRAPPED_PANE, title: 'Codebase Wrapped', focus: true, closeOnEscape: true })
      return {}
    }
```

In the `ui.render` hook for `Pane`, replace its first line, `if (e.requestId !== MAP_PANE) return next(e)`, with:

```ts
    if (e.requestId === WRAPPED_PANE && repo) {
      const E = $.ui.resolve(e)
      const week = isoWeek(await $.clock.now())
      const log: Answer[] = (await $.store.get(`repo:${repo.id}:answers:${week}`)) ?? []
      const meta: Meta | undefined = await $.store.get(metaKey())
      const start = meta?.weekStart?.week === week ? meta.weekStart.scores : {}
      const summary = buildWrapped(log, areas, start)
      const name = repo.name
      return renderWrapped(E, summary, name, week, { onCopy: () => copyWrapped($, wrappedText(summary, name, week)) })
    }
    if (e.requestId !== MAP_PANE) return next(e)
```

Below the `// --- more hooks ---` marker, add:

```ts
  on('turn.complete', async ($: any, e: any, next: any) => {
    if (pendingFlag !== null) {
      const text = pendingFlag
      pendingFlag = null
      // Not awaited: the hook would stay open until the new turn starts
      submitFlag($, text)
    }
    return next(e)
  })
```

- [ ] **Step 7: Run all tests and validate**

Run: `claude plugin test`
Expected: PASS, every test in every file. In the Wrapped test, Billing rose from 0.5 at the week's start to 0.75 now, so the jump reads "Billing, 50% to 75%".

Run: `claude plugin validate .`
Expected: `✔ Validation passed`, with `turn.complete` on the `hooks:` line and `$.prompt.submit`, `$.ui.copy`, `$.store.keys` on the `calls:` line.

- [ ] **Step 8: Commit**

```bash
git add hooks/register.ts tests/mod-wrapped.test.ts
git commit -m "feat(mod): add Flag to Claude, Codebase Wrapped and weekly upkeep

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Try it for real, document it, and close the spec

**Files:**
- Create: `README.md`, `docs/apprentice.md`, `CLAUDE.md`, `LICENSE`
- Modify: `docs/superpowers/specs/2026-10-23-apprentice-design.md`

- [ ] **Step 1: Run the full suite and validation**

Run: `claude plugin test && claude plugin validate .`
Expected: every test passes; `✔ Validation passed`.

- [ ] **Step 2: Try it in the Desktop app on a real repo**

This step needs a person at the keyboard. In the Desktop app, open a local session in `dogbase-web-app-v2` with the plugin loaded. The Desktop app reads `CLAUDE_CODE_PLUGIN_DIRS`, so add this to `~/.claude/settings.json` under `env` for the test, then start a new session:

```json
{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/Users/Almog/Engineering/Open Source/apprentice" } }
```

Check each item and note anything that differs:

- [ ] `/apprentice` opens the pane, shows progress, then the map, the headline and the area list.
- [ ] The area names make sense to the repo's author.
- [ ] Asking Claude for a small edit dims the right area and shows a card in the band within about 20 seconds.
- [ ] Typing `1` into the empty prompt answers the card.
- [ ] A spot-the-flaw card appears for an area you wrote most of.
- [ ] Flag to Claude starts a turn once Claude is idle.
- [ ] Skip, the area's details, and restoring a skipped card all work.
- [ ] `/apprentice wrapped` shows the tiles, and Copy puts the text on the clipboard.
- [ ] In a terminal (`claude --plugin-dir "/Users/Almog/Engineering/Open Source/apprentice"`), the pane shows the raster map and the band shows cards.

Remove the `CLAUDE_CODE_PLUGIN_DIRS` entry afterwards.

- [ ] **Step 3: Write the evergreen doc**

`docs/apprentice.md`, the current truth about how Apprentice works. Write these sections, filled from the code as it now stands (not from the spec): what it is (one paragraph); commands; how areas are made (the grouping rules with their numbers); how scores move (seeding, dimming, the answer table, levels); cards (levels, the hourly cap, exclusions, the 8-second reveal); storage (the key table); surfaces (Desktop, terminal, VS Code); testing (`claude plugin test`, `claude plugin validate .`, and the manual check list from Step 2).

- [ ] **Step 4: Write the README, the license and CLAUDE.md**

`README.md` follows the style of the trustbut and Holdline READMEs: a centered title block with a one-line pitch ("Learn the code Claude is changing, while it changes it."), a short "Why I'm building this" on comprehension debt, install (`/plugin marketplace add isAlmogK/apprentice` then `/plugin install apprentice@apprentice`), what you see (the band, the map, Wrapped, with screenshots from Step 2 saved under `docs/images/`), commands, privacy (what goes to Haiku and what never does), requirements (Claude Code v2.1.296 or later, Desktop app or terminal), the sibling projects (trustbut, Holdline), "About me" with the open-to-work line, and the license.

`LICENSE`: the Apache-2.0 text, copied from the trustbut repo: `cp "../trustbut/LICENSE" LICENSE`.

`CLAUDE.md`:

```markdown
# Apprentice

A Claude Code mod. Read [docs/apprentice.md](docs/apprentice.md) for how it works today.

- Only `hooks/register.ts` calls `$`. Everything in `src/` is pure and tested directly.
- Run `claude plugin test` and `claude plugin validate .` before every commit.
- Specs and plans live in `docs/superpowers/`.
```

`claude plugin validate .` warns that a `CLAUDE.md` at the plugin root isn't loaded as project context. That's expected: the file is for people and agents working on this repo, not for users of the mod.

- [ ] **Step 5: Close the spec**

In `docs/superpowers/specs/2026-10-23-apprentice-design.md`, set the status line to `**Status:** Implemented (YYYY-MM-DD)` with the date of this step, and add a `## As built` section after section 11 that lists every place the code differs from the spec, or "none". Include at least: `src/cards/policy.ts` exists (not in the spec's tree); and every adjustment made during Tasks 1 to 12 (for example the import extension, any removed `key` on `Code`, any change to the `$.ui.copy` call).

- [ ] **Step 6: Commit**

```bash
git add README.md LICENSE CLAUDE.md docs
git commit -m "docs: add README, evergreen doc and close the spec

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Spec coverage

| Spec section | Task |
| --- | --- |
| 2 User flow: install, first run, every editing turn, controls, weekly, commands | 1, 10, 11, 12, 13 |
| 3 Cards in the band | 7, 11 |
| 3 Knowledge map pane, area list, details | 8, 9, 10, 11 |
| 3 Codebase Wrapped | 5, 9, 12 |
| 3 Surfaces, VS Code note, panes opened only on request | 9, 10, 11 |
| 4 Architecture, no build step | 1 to 12 |
| 5 Data model and storage keys | 1, 10, 11, 12 |
| 6 Mapping a repo | 3, 4, 10 |
| 6 Dimming on an edit | 2, 11 |
| 6 Making a card | 6, 11 |
| 6 Answering, levels | 2, 11, 12 |
| 6 Flag to Claude and retry | 6, 12 |
| 6 Headline number | 2, 9 |
| 6 Wrapped and the weekly toast | 5, 12 |
| 7 Errors and limits | 6, 10, 11, 12 |
| 8 Testing | every task; manual check in 13 |

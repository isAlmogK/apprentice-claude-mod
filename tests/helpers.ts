import { mock } from 'claude-code/testing'
import { repoIdFrom } from '../src/core/git.ts'
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
  'worktree list --porcelain': { stdout: `worktree ${ROOT}\nHEAD 1111111111111111111111111111111111111111\nbranch refs/heads/main\n` },
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
  gitCalls: { args: string; cwd: string }[]
  commands: string[]
  clock: any
}

export type WorldOptions = {
  git?: Record<string, { exitCode?: number; stdout: string }>
  model?: (e: any) => string | null | Promise<string | null>
  // The session's working directory; `git rev-parse --show-toplevel` answers it unless `git` overrides that.
  cwd?: string
  repo?: boolean | 'throws'
  store?: Record<string, unknown>
  storeFails?: () => boolean
}

export function stubWorld(on: any, opts: WorldOptions = {}): World {
  const w: World = {
    store: new Map(Object.entries(opts.store ?? {})), submitted: [], submitReplies: [],
    toasts: [], copied: [], modelCalls: [], gitCalls: [], commands: [], clock: null,
  }
  const cwd = opts.cwd ?? ROOT
  const git = { ...GIT, 'rev-parse --show-toplevel': { stdout: `${cwd}\n` }, ...(opts.git ?? {}) }
  w.clock = mock.clock(on, { now: NOW })
  on('session.start', () => ({ cwd: ROOT }))
  on('command.register', ($: any, e: any) => { w.commands.push(e.name); return { value: undefined } })
  on('session.cwd', () => ({ value: cwd }))
  on('session.repo', () => {
    if (opts.repo === 'throws') throw new Error('git is broken')
    return { value: opts.repo === false ? null : { root: ROOT, remote: REMOTE, internal: false } }
  })
  on('store.get', ($: any, e: any) => ({ value: w.store.get(e.key) }))
  on('store.set', ($: any, e: any) => { if (opts.storeFails?.()) throw new Error('disk full'); w.store.set(e.key, e.value); return { value: undefined } })
  on('store.delete', ($: any, e: any) => { w.store.delete(e.key); return { value: undefined } })
  on('store.keys', () => ({ value: [...w.store.keys()] }))
  on('process.run', ($: any, e: any) => {
    // Skip git's leading `-c name=value` options, so stubs match on the command itself
    const argv: string[] = e.argv.slice(1)
    while (argv[0] === '-c') argv.splice(0, 2)
    const args = argv.join(' ')
    w.gitCalls.push({ args, cwd: e.init?.cwd ?? '' })
    const hit = Object.entries(git).find(([k]) => args.startsWith(k))
    return { value: hit ? { exitCode: hit[1].exitCode ?? 0, stdout: hit[1].stdout, stderr: '' } : { exitCode: 1, stdout: '', stderr: 'no stub' } }
  })
  on('model.complete', async ($: any, e: any) => {
    w.modelCalls.push(e)
    const text = await (opts.model ?? defaultModel)(e)
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

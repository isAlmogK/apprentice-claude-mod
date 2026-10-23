import { areaForPath, carryProgress, draftToArea, groupAreas, mergeAreas, renameArea, type AreaDraft } from '../src/core/areas.ts'
import { BLAME_SAMPLE, parseBlame, parseLog, parseLsTree, parseWorktreeList, relativeTo, repoIdFrom, repoNameOf, rootFor, sampleFiles } from '../src/core/git.ts'
import type { Answer, Area, Card } from '../src/core/types.ts'
import { applyAnswer, applyDim, changedLinesOf, dimmedByFor, initialLevel, isFlawAnswerRight, seedScore } from '../src/core/understanding.ts'
import { buildWrapped, isoWeek, weekIndex, wrappedText } from '../src/core/wrapped.ts'
import { isSecretPath } from '../src/cards/exclude.ts'
import { CARDS_PER_HOUR, HOUR_MS, cardsWithinHour } from '../src/cards/policy.ts'
import { parseAreaNames, parseCardReply } from '../src/cards/parse.ts'
import { MAX_HUNK_LINES, buildCardRequest, flagPromptText, buildNamingRequest, diffOf, editTextsOf, type EditText } from '../src/cards/prompt.ts'
import { renderCard } from '../src/views/card.ts'
import { renderWrapped } from '../src/views/wrapped.ts'
import { renderPane, type PaneModel, type PaneStatus } from '../src/views/pane.ts'

export const MAP_PANE = 'apprentice'
export const WRAPPED_PANE = 'apprentice-wrapped'
const GIT_TIMEOUT_MS = 600_000
const USAGE = 'Usage: /apprentice [wrapped | quiet [minutes] | remap]'

// root is the session's working tree (a linked worktree's own root, not the main checkout's): mapping and blame run there.
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
  // core.quotepath=false: paths with non-ASCII characters come back as they are, not quoted
  return $.process.run(['git', '-c', 'core.quotepath=false', ...args], { cwd: root, timeoutMs: GIT_TIMEOUT_MS })
}

// The working tree an edited file lives in, found among the repo's worktrees (longest root wins).
// Listed on every edit, so a worktree made during the session is found too.
async function fileRootOf($: any, r: Repo, path: string): Promise<string> {
  if (!path.startsWith('/')) return r.root
  const listed = await runGit($, r.root, ['worktree', 'list', '--porcelain'])
  const roots = listed.exitCode === 0 ? parseWorktreeList(listed.stdout) : []
  return rootFor([r.root, ...roots], path) ?? r.root
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

// Read the stored copy, apply the pure change, write it back, and return what was written: the store
// is the source of truth, so two sessions in one repo don't overwrite each other.
async function updateArea($: any, r: Repo, id: string, change: (a: Area) => Area): Promise<Area | undefined> {
  const key = `repo:${r.id}:area:${id}`
  const stored: Area | undefined = await $.store.get(key)
  if (!stored) return undefined
  const written = change(stored)
  await $.store.set(key, written)
  return written
}

// Put a value read from or written to the store into the in-memory list.
function putArea(saved: Area | undefined): void {
  if (saved) areas = areas.map(a => (a.id === saved.id ? saved : a))
}

async function nameAreas($: any, drafts: AreaDraft[]): Promise<Record<string, string>> {
  const request = buildNamingRequest(drafts)
  if (request.ids.length === 0) return {}
  try {
    const reply = await $.model.complete({ model: 'haiku', system: request.system, prompt: request.prompt, maxTokens: 600, timeoutMs: 20000 })
    return reply.isAnswered ? parseAreaNames(reply.text, request.ids) : {}
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
    // Start from the stored areas, which hold what other sessions in this repo learned.
    const stored = await loadAreas($, r)
    const previous = stored.length > 0 ? stored : areas
    const kept = new Map(previous.map(a => [a.id, a.name]))
    const known = new Set(previous.map(a => a.id))
    areas = carryProgress(previous, drafts.map(d => draftToArea({ ...d, name: kept.get(d.id) ?? names[d.id] ?? d.name }, 0)))
    const fresh = drafts.filter(d => !known.has(d.id))
    $.ui.invalidate('ui.render')
    step = 'reading your git email'
    const email = fresh.length > 0 ? (await runGit($, r.root, ['config', 'user.email'])).stdout.trim() : ''
    step = 'seeding scores'
    for (let i = 0; i < fresh.length; i++) {
      const draft = fresh[i]
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
      progress = `Mapping your repo… ${i + 1} of ${fresh.length} areas seeded`
      $.ui.invalidate('ui.render')
    }
    step = 'saving'
    // Seeding can take a while: take progress saved meanwhile for the surviving ids before writing.
    const latest = await loadAreas($, r)
    if (latest.length > 0) areas = carryProgress(latest, areas)
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
  putArea(await updateArea($, repo, id, a => ({ ...a, name: name.trim() })))
  $.ui.invalidate('ui.render')
}

async function mergeAndSave($: any, fromId: string, intoId: string): Promise<void> {
  if (!repo) return
  // Merge the stored copies, which hold what other sessions learned; memory is the fallback.
  const from: Area | undefined = (await $.store.get(areaKey(fromId))) ?? areas.find(a => a.id === fromId)
  const into: Area | undefined = (await $.store.get(areaKey(intoId))) ?? areas.find(a => a.id === intoId)
  if (!from || !into || fromId === intoId) return
  const merged = mergeAreas([into, from], fromId, intoId)[0]
  areas = areas.filter(a => a.id !== fromId).map(a => (a.id === intoId ? merged : a))
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
    rows: Number(e.props?.scroll?.bodyRows) || undefined,
  }
}

// --- cards ---
const REVEAL_MS = 8000
const PENDING_MAX = 5

type CardContext = { root: string; areaId: string; areaName: string; level: Area['level']; edit: EditText; dimmedBy: number; editId: string }

let card: Card | null = null
let revealed: { isRight: boolean } | null = null
let quietUntil = 0
let cardTimes: number[] = []
let firstEditDone = false

async function makeCard($: any, ctx: CardContext): Promise<void> {
  if (!repo) return
  // Exit 1 is the only "not ignored": 0 is ignored, and anything else is a git error, so fail closed.
  const ignored = await runGit($, ctx.root, ['check-ignore', '-q', ctx.edit.file])
  if (ignored.exitCode !== 1) return
  const request = buildCardRequest(ctx.areaName, ctx.level, ctx.edit)
  // Count the request, not the card shown, so replies that never make a card still count against the cap.
  const asked = await $.clock.now()
  cardTimes = [...cardsWithinHour(cardTimes, asked), asked]
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
  // Cards may have been paused while Haiku was answering.
  if ((await $.clock.now()) < quietUntil) return
  card = parsed
  revealed = null
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
  $.ui.invalidate('ui.render')
  // Clear and flag first, so a store failure below never leaves the card stuck or drops the flag.
  $.clock.after(REVEAL_MS, () => {
    if (card === c) {
      card = null
      revealed = null
      $.ui.invalidate('ui.render')
    }
  })
  if (flagged && c.kind === 'flaw') submitFlag($, flagPromptText(c))
  const r = repo
  try {
    await ensureWeekStart($, await $.clock.now())
    putArea(await updateArea($, r, c.areaId, a => applyAnswer(a, c.dimmedBy, isRight)))
    $.ui.invalidate('ui.render')
    await logAnswer($, c, { skipped: false, isRight, flagged })
  } catch {
    // The answer still shows; only its saving failed.
  }
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
  if (log.filter(a => !a.skipped).length < TOAST_MIN_ANSWERS) return
  const toastedKey = `repo:${repo.id}:toasted`
  if ((await $.store.get(toastedKey)) === week) return
  await $.store.set(toastedKey, week)
  $.ui.toast('Codebase Wrapped is ready: run /apprentice wrapped')
}

async function copyWrapped($: any, text: string): Promise<void> {
  await $.ui.copy({ text })
  $.ui.toast('Copied')
}

export function register(on: any) {
  on('session.start', async ($: any, e: any, next: any) => {
    try {
      const found = await $.session.repo()
      if (found) {
        // repo() names the main checkout for every worktree: it keys progress, so all worktrees share it.
        // Path work uses the session's own working tree.
        const cwd = String((await $.session.cwd()) ?? found.root)
        const top = await runGit($, cwd, ['rev-parse', '--show-toplevel'])
        const root = top.exitCode === 0 && top.stdout.trim() !== '' ? top.stdout.trim() : found.root
        const r: Repo = { id: await repoIdFrom(found.remote ?? found.root), root, name: repoNameOf(found.root) }
        areas = await loadAreas($, r)
        repo = r
        status = areas.length > 0 ? 'ready' : 'idle'
      }
    } catch {
      // Without a repo Apprentice stays off, but /apprentice is still registered and says why.
      repo = null
      areas = []
      status = 'no-git'
    }
    $.clock.every(HOUR_MS, () => checkWrappedToast($))
    await $.command.register({
      name: 'apprentice',
      description: 'Open your knowledge map of this repo',
      argumentHint: '[wrapped | quiet [minutes] | remap]',
      immediate: true,
    })
    return next(e)
  })

  on('command.run', { command: 'apprentice' }, async ($: any, e: any) => {
    const [sub = '', arg = ''] = String(e.args ?? '').trim().split(/\s+/)
    if (sub === 'quiet') {
      const minutes = Number(arg) > 0 ? Math.max(1, Math.round(Number(arg))) : 60
      await quietCards($, minutes)
      return { text: `Cards are paused for ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.` }
    }
    if (sub === 'wrapped') {
      if (!repo) return { text: 'Apprentice needs a git repo.' }
      await $.ui.open({ id: WRAPPED_PANE, title: 'Codebase Wrapped', focus: true, closeOnEscape: true })
      return {}
    }
    if (sub !== '' && sub !== 'remap') return { text: USAGE }
    // While a mapping runs, /apprentice remap only opens the pane.
    if (repo && status !== 'mapping' && (sub === 'remap' || status === 'idle' || status === 'failed')) startMapping($)
    else if (repo && status === 'ready') {
      // Pick up what other sessions in this repo saved since this one loaded.
      const loaded = await loadAreas($, repo)
      if (loaded.length > 0) areas = loaded
    }
    await $.ui.open({ id: MAP_PANE, title: 'Apprentice', focus: true, closeOnEscape: true })
    return {}
  })

  on('ui.render', { component: 'Pane' }, async ($: any, e: any, next: any) => {
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
    const E = $.ui.resolve(e)
    return renderPane(E, paneModel(e), {
      onSelect: (id: string | null) => selectArea($, id),
      onRename: (id: string, name: string) => renameAndSave($, id, name),
      onMerge: (fromId: string, intoId: string) => mergeAndSave($, fromId, intoId),
      onRestore: (index: number) => restorePending($, index),
    })
  })

  // --- more hooks ---

  on('turn.complete', async ($: any, e: any, next: any) => {
    if (pendingFlag !== null) {
      const text = pendingFlag
      pendingFlag = null
      // Not awaited: the hook would stay open until the new turn starts
      submitFlag($, text)
    }
    return next(e)
  })

  on('turn.start', async ($: any, e: any, next: any) => {
    if (e.agentId === undefined) firstEditDone = false
    return next(e)
  })

  on('tool.call', { tool: ['Edit', 'Write', 'MultiEdit'] }, async ($: any, e: any, next: any) => {
    const result = await next(e)
    try {
      if (result?.deny || result?.isError || status !== 'ready' || !repo) return result
      const path = String(e.file_path ?? '')
      const root = await fileRootOf($, repo, path)
      const rel = relativeTo(root, path)
      if (rel === null) return result
      const area = areaForPath(areas, rel)
      if (!area) return result
      const changed = changedLinesOf(e.tool, e)
      // Dim the stored copy by what its own score allows, and keep that amount for the card.
      let dimmedBy = 0
      putArea(await updateArea($, repo, area.id, a => {
        dimmedBy = dimmedByFor(a, changed)
        return applyDim(a, dimmedBy)
      }))
      $.ui.invalidate('ui.render')
      const now = await $.clock.now()
      const wantsCard = !firstEditDone && now >= quietUntil
        && cardsWithinHour(cardTimes, now).length < CARDS_PER_HOUR && !isSecretPath(rel)
      firstEditDone = true
      if (wantsCard) {
        const ctx: CardContext = {
          root, areaId: area.id, areaName: area.name, level: area.level,
          edit: { file: rel, ...editTextsOf(e.tool, e) }, dimmedBy, editId: `${now}`,
        }
        $.clock.after(0, () => makeCard($, ctx))
      }
      return result
    } catch {
      return result
    }
  }).catch(async ($: any, e: any, next: any) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($: any, e: any, next: any) => {
    if (!card || e.surface === 'vscode') return next(e)
    const shown = card
    const E = $.ui.resolve(e)
    const areaName = areas.find(a => a.id === shown.areaId)?.name ?? 'Other'
    const theirs = await next(e)
    return E.Box({
      flexDirection: 'column',
      children: [
        renderCard(E, { card: shown, areaName, revealed, maxRows: Number(e.props?.maxRows) || undefined, columns: Number(e.props?.bodyColumns) || undefined }, {
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
}

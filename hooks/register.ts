import { areaForPath, carryProgress, draftToArea, groupAreas, mergeAreas, renameArea, type AreaDraft } from '../src/core/areas.ts'
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
    const previous = areas
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

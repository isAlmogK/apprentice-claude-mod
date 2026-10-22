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

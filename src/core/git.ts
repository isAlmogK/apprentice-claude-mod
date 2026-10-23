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

// The `worktree <path>` lines of `git worktree list --porcelain`: every working tree of the repo.
export function parseWorktreeList(stdout: string): string[] {
  return stdout.split('\n').filter(l => l.startsWith('worktree ')).map(l => l.slice('worktree '.length).trim()).filter(Boolean)
}

// The working tree an absolute path is in: the longest root it sits under, or null.
export function rootFor(roots: string[], path: string): string | null {
  if (!path.startsWith('/')) return null
  let best: string | null = null
  for (const root of roots) {
    if (relativeTo(root, path) !== null && (best === null || root.length > best.length)) best = root
  }
  return best
}

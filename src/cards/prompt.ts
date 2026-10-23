import type { AreaDraft } from '../core/areas.ts'
import { sampleFiles } from '../core/git.ts'
import { isSecretPath } from './exclude.ts'
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

export const moreLines = (n: number) => `… ${n} more ${n === 1 ? 'line' : 'lines'}`
export const MORE_LINES = /^… (\d+) more lines?$/

// Claude carries unchanged lines around an edit so old_string is unique. Lines the old and new text share at
// the start and end are context (' '), and only the lines between them are removed ('-') and added ('+').
export function diffOf(edit: EditText, maxLines: number): string {
  const before = edit.oldText ? edit.oldText.split('\n') : []
  const after = edit.newText ? edit.newText.split('\n') : []
  let head = 0
  while (head < before.length && head < after.length && before[head] === after[head]) head++
  let tail = 0
  while (tail < before.length - head && tail < after.length - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++
  const lines = [
    ...before.slice(0, head).map(l => ' ' + l),
    ...before.slice(head, before.length - tail).map(l => '-' + l),
    ...after.slice(head, after.length - tail).map(l => '+' + l),
    ...after.slice(after.length - tail).map(l => ' ' + l),
  ]
  if (lines.length <= maxLines) return lines.join('\n')
  return [...lines.slice(0, maxLines), moreLines(lines.length - maxLines)].join('\n')
}

export function buildCardRequest(areaName: string, level: Level, edit: EditText): { system: string; prompt: string } {
  return {
    system: SYSTEMS[level],
    prompt: `Area: ${areaName}\nFile: ${edit.file}\nChange:\n${diffOf(edit, MAX_DIFF_LINES)}`,
  }
}

// Areas made only of secret paths are left out entirely (they keep their default names), so neither
// their folders nor their ids reach Haiku. ids lists the areas the prompt names.
export function buildNamingRequest(drafts: AreaDraft[]): { system: string; prompt: string; ids: string[] } {
  const named = drafts.filter(d => !(d.paths.every(isSecretPath) && d.files.every(f => isSecretPath(f.path))))
  const lines = named.map(d => {
    const folders = d.paths.filter(p => !isSecretPath(p)).map(p => p || '(repo root)').join(', ')
    const files = sampleFiles(d.files.filter(f => !isSecretPath(f.path)), 5).map(f => f.path).join(', ')
    return `${d.id}: folders ${folders}; files ${files}`
  })
  return { system: NAMING_SYSTEM, prompt: lines.join('\n'), ids: named.map(d => d.id) }
}

export function flagPromptText(card: FlawCard): string {
  const concern = card.haikuSeesFlaw ? card.summary : 'something in this change looks wrong to them'
  return `Apprentice flag on ${card.file}: the user reviewed this change and is concerned: "${concern}". Check whether it was intended, and fix it if not.`
}

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

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

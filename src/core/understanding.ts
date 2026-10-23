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

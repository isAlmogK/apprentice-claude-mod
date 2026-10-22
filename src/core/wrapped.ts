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

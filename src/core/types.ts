export type Level = 'junior' | 'mid' | 'senior'

export type Area = {
  id: string
  name: string
  paths: string[]
  lines: number
  score: number
  editsSinceLooked: number
  level: Level
  streak: number
}

export type QuestionCard = {
  kind: 'question'
  areaId: string
  level: 'junior' | 'mid'
  file: string
  question: string
  options: [string, string, string]
  answer: 0 | 1 | 2
  explanation: string
  editId: string
  dimmedBy: number
}

export type FlawCard = {
  kind: 'flaw'
  areaId: string
  level: 'senior'
  file: string
  hunk: string
  haikuSeesFlaw: boolean
  summary: string
  explanation: string
  editId: string
  dimmedBy: number
}

export type Card = QuestionCard | FlawCard

export type Answer = {
  at: number
  areaId: string
  level: Level
  kind: Card['kind']
  skipped: boolean
  isRight: boolean
  flagged: boolean
  haikuSeesFlaw: boolean
}

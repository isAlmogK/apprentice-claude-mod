import type { Wrapped } from '../core/wrapped.ts'
import { line, type Elements } from './elements.ts'

function tile(E: Elements, label: string, value: number): unknown {
  return E.Box({
    flexDirection: 'column', borderStyle: 'round', paddingX: 1,
    children: [line(E, label, { dimColor: true }), line(E, String(value), { bold: true })],
  })
}

export function renderWrapped(E: Elements, w: Wrapped, repoName: string, week: string, h: { onCopy: () => void }): unknown {
  const children: unknown[] = [line(E, `Your week in ${repoName}`, { bold: true }), line(E, week, { dimColor: true })]
  if (w.answered === 0) {
    children.push(line(E, 'No cards answered this week yet.'))
    return E.Box({ flexDirection: 'column', children })
  }
  children.push(E.Box({
    flexDirection: 'row', columnGap: 2,
    children: [
      tile(E, 'Areas mastered', w.mastered),
      tile(E, 'Flaws you caught', w.flawsCaught),
      tile(E, 'Cards answered', w.answered),
      tile(E, 'Dark zones left', w.darkZones),
    ],
  }))
  if (w.biggestJump) {
    children.push(line(E, `Biggest jump: ${w.biggestJump.name}, ${w.biggestJump.from}% to ${w.biggestJump.to}%`))
  }
  children.push(E.Button({ key: 'copy', label: 'Copy', onPress: h.onCopy }))
  return E.Box({ flexDirection: 'column', children })
}

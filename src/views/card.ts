import type { Card } from '../core/types.ts'
import { line, type Elements } from './elements.ts'

// maxRows: the band's rows (AbovePrompt's e.props.maxRows). A taller card scrolls and loses its hotkeys,
// so a spot-the-flaw hunk is trimmed to fit.
export type CardView = { card: Card; areaName: string; revealed: { isRight: boolean } | null; maxRows?: number }

// Rows a flaw card takes besides its hunk: border (2), header, buttons, footer, the "more lines" marker, one spare.
const FLAW_CARD_ROWS = 7
const MORE_LINES = /^… (\d+) more lines$/

export function fitHunk(hunk: string, maxRows: number | undefined): string {
  if (maxRows === undefined) return hunk
  const lines = hunk.split('\n')
  const marker = MORE_LINES.exec(lines.at(-1) ?? '')
  const body = marker ? lines.slice(0, -1) : lines
  const total = body.length + (marker ? Number(marker[1]) : 0)
  const room = Math.max(3, maxRows - FLAW_CARD_ROWS)
  if (body.length <= room) return hunk
  return [...body.slice(0, room), `… ${total - room} more lines`].join('\n')
}
export type CardHandlers = {
  onAnswer: (index: number) => void
  onFlaw: (pressed: 'flag' | 'looks-fine') => void
  onSkip: () => void
  onQuiet: () => void
}

function header(card: Card, areaName: string): string {
  const base = `Apprentice · ${areaName} · ${card.level} card`
  return card.kind === 'flaw' ? base + ' · spot the flaw' : base
}

function resultLine(card: Card, isRight: boolean): string {
  if (isRight) return 'Right.'
  if (card.kind === 'question') return `Not quite. The answer was ${card.answer + 1} · ${card.options[card.answer]}.`
  return card.haikuSeesFlaw ? 'Not quite. Haiku sees a flaw here.' : 'Not quite. Haiku thinks this change looks fine.'
}

function footer(E: Elements, h: CardHandlers): unknown {
  return E.Box({
    flexDirection: 'row', columnGap: 2,
    children: [
      E.Button({ key: 'skip', label: 'Skip', plain: true, dimColor: true, onPress: h.onSkip }),
      E.Button({ key: 'quiet', label: 'Quiet 1h', plain: true, dimColor: true, onPress: h.onQuiet }),
    ],
  })
}

export function renderCard(E: Elements, view: CardView, h: CardHandlers): unknown {
  const { card, areaName, revealed, maxRows } = view
  const children: unknown[] = [line(E, header(card, areaName), { dimColor: true })]
  if (revealed) {
    children.push(line(E, resultLine(card, revealed.isRight), { bold: true, color: revealed.isRight ? 'green' : 'yellow' }))
    if (card.kind === 'flaw') children.push(line(E, card.summary))
    children.push(line(E, card.explanation))
    children.push(line(E, "Haiku's view, not a verdict on the code.", { dimColor: true }))
  } else if (card.kind === 'question') {
    children.push(line(E, card.question))
    children.push(E.Box({
      flexDirection: 'row', columnGap: 2,
      children: card.options.map((option, i) =>
        E.Button({ key: `ans-${i}`, label: `${i + 1} · ${option}`, hotkey: String(i + 1), onPress: () => h.onAnswer(i) })),
    }))
    children.push(footer(E, h))
  } else {
    children.push(E.Code({ key: 'hunk', source: fitHunk(card.hunk, maxRows), path: card.file, format: 'diff' }))
    children.push(E.Box({
      flexDirection: 'row', columnGap: 2,
      children: [
        E.Button({ key: 'flaw-ok', label: '1 · Looks fine', hotkey: '1', onPress: () => h.onFlaw('looks-fine') }),
        E.Button({ key: 'flaw-flag', label: '2 · Flag to Claude', hotkey: '2', onPress: () => h.onFlaw('flag') }),
      ],
    }))
    children.push(footer(E, h))
  }
  return E.Box({ flexDirection: 'column', borderStyle: 'round', paddingX: 1, children })
}

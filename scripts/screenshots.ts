// Renders the README images from the real view code with demo data: node scripts/screenshots.ts
// Each view's element tree is drawn as HTML and captured with headless Chrome into docs/images/.
// These are previews of what the views draw, not captures of a live session.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Area, FlawCard, QuestionCard } from '../src/core/types.ts'
import type { Elements } from '../src/views/elements.ts'
import { renderCard } from '../src/views/card.ts'
import { renderPane, type PaneModel } from '../src/views/pane.ts'
import { renderWrapped } from '../src/views/wrapped.ts'
import { DEFAULT_COLOR } from '../src/views/map-raster.ts'

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const OUT = resolve(import.meta.dirname, '../docs/images')

// The mods runtime has Uint8Array.prototype.toBase64 (ES2025); older Node doesn't.
const u8 = Uint8Array.prototype as any
if (!u8.toBase64) u8.toBase64 = function (this: Uint8Array) { return Buffer.from(this).toString('base64') }

type Props = Record<string, any>
const esc = (s: unknown) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const kids = (p: Props) => (Array.isArray(p.children) ? p.children : p.children === undefined ? [] : [p.children]).join('')
const hex = (n: number) => '#' + n.toString(16).padStart(6, '0')
const COLORS: Record<string, string> = { green: '#4ec98f', yellow: '#e5c07b' }

function textStyle(p: Props): string {
  return [p.bold ? 'font-weight:700' : '', p.dimColor ? 'opacity:.55' : '', p.color ? `color:${COLORS[p.color] ?? p.color}` : ''].join(';')
}

function diffLine(l: string): string {
  const cls = l.startsWith('@@') ? 'hunk' : l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : l.startsWith('…') ? 'more' : ''
  return `<div class="${cls}">${esc(l) || ' '}</div>`
}

function raster(p: Props): string {
  const words = new Uint32Array(Uint8Array.from(Buffer.from(p.cells, 'base64')).buffer)
  const rows: string[] = []
  for (let r = 0; r < p.rows; r++) {
    let row = ''
    for (let c = 0; c < p.columns; c++) {
      const i = (r * p.columns + c) * 3
      const ch = String.fromCodePoint(words[i])
      row += words[i + 1] === DEFAULT_COLOR ? esc(ch) : `<span style="color:${hex(words[i + 1])}">${esc(ch)}</span>`
    }
    rows.push(row)
  }
  return `<pre class="raster">${rows.join('\n')}</pre>`
}

const html: Elements = {
  Box: p => `<div class="box${p.borderStyle ? ' bordered' : ''}" style="flex-direction:${p.flexDirection ?? 'column'};column-gap:${(p.columnGap ?? 0)}ch;padding:${p.borderStyle ? '0.25em' : 0} ${p.paddingX ?? 0}ch">${kids(p)}</div>`,
  Text: p => `<div style="${textStyle(p)}">${esc(kids(p))}</div>`,
  Button: p => `<div class="${p.plain ? 'link' : 'button'}" style="${p.dimColor ? 'opacity:.55' : ''}">${esc(p.label)}</div>`,
  Code: p => `<div class="code">${String(p.source).split('\n').map(diffLine).join('')}</div>`,
  Input: p => `<div class="row"><span class="dim">${esc(p.label)}</span><span class="input">${esc(p.value)}</span><span class="button">${esc(p.submitLabel)}</span></div>`,
  Select: p => `<div class="row"><span class="dim">${esc(p.label)}</span><span class="input">${esc(p.options[0]?.label ?? '')} ▾</span></div>`,
  Svg: p => `<div class="svg">${p.source}</div>`,
  Raster: raster,
}

const PAGE_STYLE = `
  * { box-sizing: border-box; margin: 0 }
  body { background: #1b1b1a; color: #e8e6df; font: 15px/1.55 "SF Mono", Menlo, monospace; padding: 28px; width: max-content }
  .box { display: flex; gap: 0.15em 0; align-items: flex-start }
  .bordered { border: 1.5px solid #5f5e5a; border-radius: 10px }
  .button { border: 1px solid #6b6a64; border-radius: 6px; padding: 0 0.8ch; white-space: nowrap }
  .link { text-decoration: underline; text-decoration-color: #6b6a64; text-underline-offset: 3px }
  .code { background: #242423; border-radius: 6px; padding: 0.4em 1ch; margin: 0.2em 0; white-space: pre }
  .add { color: #4ec98f } .del { color: #e06c75 } .hunk { color: #7fa7d6 } .more { opacity: .55 }
  .row { display: flex; gap: 1.5ch; align-items: center } .dim { opacity: .55 }
  .input { border: 1px solid #5f5e5a; border-radius: 6px; padding: 0 1ch; min-width: 18ch }
  .raster { line-height: 1.25 }
  .svg { border: 1px solid #333331; border-radius: 10px; margin: 0.4em 0 }
  .prompt { margin-top: 14px; border: 1.5px solid #5f5e5a; border-radius: 10px; padding: 0.5em 1.5ch; opacity: .8 }
  .caption { margin-bottom: 14px; opacity: .55 }
`

// The script writes the page's natural size into the DOM, which --dump-dom prints, so each capture fits its content.
const SIZE_PROBE = '<script>const r = document.body.getBoundingClientRect(); document.body.dataset.size = Math.ceil(r.width) + "x" + Math.ceil(r.height)</script>'
const page = (body: string) => `<!doctype html><meta charset="utf-8"><style>${PAGE_STYLE}</style><body><main>${body}</main>${SIZE_PROBE}</body>`
// Shown under a card, so the band reads as sitting above the prompt.
const prompt = (keys: string) => `<div class="prompt">&gt; <span class="dim">Claude is working · type ${keys} to answer</span></div>`

const noop = () => {}
const cardHandlers = { onAnswer: noop, onFlaw: noop, onSkip: noop, onQuiet: noop }
const paneHandlers = { onSelect: noop, onRename: noop, onMerge: noop, onRestore: noop }

const area = (id: string, name: string, lines: number, score: number, editsSinceLooked = 0): Area =>
  ({ id, name, paths: [id], lines, score, editsSinceLooked, level: 'mid', streak: 0 })

const AREAS: Area[] = [
  area('src-billing', 'Billing', 5200, 0.41, 3),
  area('src-auth', 'Auth', 3100, 0.86),
  area('src-api', 'API routes', 6400, 0.78),
  area('web', 'Web app', 9800, 0.64, 1),
  area('src-db', 'Database', 2900, 0.22),
  area('src-jobs', 'Background jobs', 1800, 0.55),
  area('root', 'Root files', 700, 0.9),
  area('other', 'Other', 1500, 0.3),
]

const QUESTION: QuestionCard = {
  kind: 'question', areaId: 'src-billing', level: 'mid', file: 'src/billing/invoice.ts',
  question: 'chargeInvoice() now returns early when the invoice is already paid. What does that prevent?',
  options: ['A double charge on retry', 'A slow query', 'A missing receipt'], answer: 0,
  explanation: 'Retries call chargeInvoice() again; the early return keeps a paid invoice from being charged twice.',
  editId: 'demo', dimmedBy: 0.05,
}

const FLAW: FlawCard = {
  kind: 'flaw', areaId: 'src-auth', level: 'senior', file: 'src/auth/session.ts',
  hunk: [
    '@@ -12,7 +12,6 @@ export async function refreshSession(token: string) {',
    '   const session = await sessions.find(token)',
    "-  if (session.expiresAt < Date.now()) return deny('expired')",
    "+  if (!session) return deny('missing')",
    '   return issue(session.userId)',
  ].join('\n'),
  haikuSeesFlaw: true, summary: 'Expired sessions are refreshed instead of denied.',
  explanation: 'The expiry check is gone, so an expired token still gets a new session.',
  editId: 'demo', dimmedBy: 0.03,
}

const pane = (surface: string, columns: number): PaneModel => ({
  surface, status: 'ready', progress: '', error: '', repoName: 'acme-shop',
  areas: AREAS, selectedId: null, pending: [], columns,
})

const shots: Record<string, string> = {
  'band-question': page(renderCard(html, { card: QUESTION, areaName: 'Billing', revealed: null }, cardHandlers) + prompt('1, 2 or 3')),
  'band-answered': page(renderCard(html, { card: QUESTION, areaName: 'Billing', revealed: { isRight: true } }, cardHandlers) as string),
  'band-flaw': page(renderCard(html, { card: FLAW, areaName: 'Auth', revealed: null, maxRows: 14 }, cardHandlers) + prompt('1 or 2')),
  'map-desktop': page(renderPane(html, pane('desktop', 80), paneHandlers) as string),
  'map-terminal': page(renderPane(html, pane('terminal', 64), paneHandlers) as string),
  'wrapped': page(renderWrapped(html, {
    mastered: 2, flawsCaught: 3, answered: 17, darkZones: 1, biggestJump: { name: 'Billing', from: 41, to: 83 },
  }, 'acme-shop', '2026-W43', { onCopy: noop }) as string),
}

mkdirSync(OUT, { recursive: true })
const work = mkdtempSync(join(tmpdir(), 'apprentice-shots-'))
const only = process.argv.slice(2)
for (const [name, doc] of Object.entries(shots)) {
  if (only.length && !only.includes(name)) continue
  const file = join(work, `${name}.html`)
  writeFileSync(file, doc)
  const dom = execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--window-size=2000,2000', '--dump-dom', `file://${file}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  const [w, h] = (/data-size="(\d+)x(\d+)"/.exec(dom) ?? []).slice(1).map(Number)
  if (!w || !h) throw new Error(`could not measure ${name}`)
  execFileSync(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=2',
    `--window-size=${w},${h}`, `--screenshot=${join(OUT, `${name}.png`)}`, `file://${file}`,
  ], { stdio: 'ignore' })
  console.log(`docs/images/${name}.png`)
}

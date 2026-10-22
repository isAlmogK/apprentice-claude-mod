# Apprentice: Design

**Status:** Draft (2026-10-23)

**Repos:** apprentice (this spec: the whole feature). No other repo changes.

Apprentice is a Claude Code mod that teaches you the code Claude is changing in your own project, while Claude works. It draws a knowledge map of your repo that brightens where you understand the code and dims where Claude changed code you haven't seen, and it asks one short question per editing turn to relight it.

## 1. Why

AI agents now write a large share of the code people ship. Writing is no longer the slow part. Understanding is: code changes faster than its owners can read it, and that gap grows quietly. This spec calls the gap **comprehension debt**: code that changed since you last understood it.

Juniors feel it as "I ship code I can't explain." Seniors feel it as "Claude changed `billing/` 14 times this week and I haven't looked." Nothing in Claude Code measures it or helps pay it down.

**One line:** Apprentice shows how much of your codebase you still understand, and teaches you the rest while Claude works.

**Goals of the project:**

- A mod people keep installed because it does something every editing turn (the most-starred mods on [claude-mods.com](https://claude-mods.com/) all do).
- Useful to juniors and seniors in the same install, through adaptive card levels.
- A launch that spreads: a map worth a screenshot and a weekly card built for posting.
- A portfolio piece that fits the author's theme of tools for working with AI agents, next to [trustbut](https://github.com/isAlmogK/trustbut) and [Holdline](https://github.com/isAlmogK/holdline), without overlapping either.

**Not goals:** judging whether Claude's code is correct (that is trustbut's and Holdline's job), replacing code review, or tracking anyone other than the person at the keyboard.

### Prior art (checked 2026-10-23)

Of the 278 mods listed on claude-mods.com, none teaches the user their own codebase. The closest are `medan` (generic Anki cards while waiting), `DeutschLoop` (German lessons), `qa-guide` (explains the questions Claude asks), and `What's Agent Doing` (plain-English status). The "While you wait" category has 45 mods, which shows that filling waiting time is a popular use.

## 2. User flow

### Install

```
/plugin marketplace add isAlmogK/apprentice
/plugin install apprentice@apprentice
```

Requires Claude Code v2.1.299 or later (for `Text` `weight` and the step names in `Box` spacing).

### First run in a repo

1. The user runs `/apprentice`. The map pane opens and shows "Mapping your repo…".
2. In the background, Apprentice groups the repo's folders into 6 to 15 areas, asks Haiku to name them, and seeds each area's score from `git blame` authorship under the user's git email.
3. The map appears. A senior opening their own repo sees mostly bright areas; a new hire sees mostly dark ones.
4. The user can rename or merge areas from the pane. Their changes are kept.

### Every editing turn

1. Claude makes its first real edit of the turn (`Edit`, `Write` or `MultiEdit`).
2. Apprentice dims the edited area and, in the background, asks Haiku for a card about that edit at the user's level for that area.
3. The card appears in the band above the prompt while Claude keeps working. The user answers with a click or by typing 1, 2 or 3 into the empty prompt.
4. The answer reveals the explanation and relights the area. A wrong answer still shows the explanation.
5. On a spot-the-flaw card, **Flag to Claude** queues a prompt describing the user's concern. It runs when Claude is idle.

Later edits in the same turn dim their areas but make no new card.

### Controls on every card

- **Skip**: dismisses the card. It waits in the area's list in the pane.
- **Quiet 1h**: no new cards for an hour. Dimming continues.

### Weekly

Once a week a toast says Codebase Wrapped is ready. `/apprentice wrapped` opens it. It has a **Copy image** button and never contains code.

### Commands

| Command | Does |
| --- | --- |
| `/apprentice` | Opens the map pane (maps the repo first if needed) |
| `/apprentice wrapped` | Opens this week's Codebase Wrapped |
| `/apprentice quiet [minutes]` | Pauses cards, 60 minutes by default |
| `/apprentice remap` | Regroups areas and refreshes the authorship seed |

## 3. What it looks like

Approved mockups (2026-10-23) show three surfaces. Numbers in them were placeholders.

### Cards in the band (`AbovePrompt`)

Two kinds, each one glance tall:

- **Question card** (junior and mid levels): a header (`Apprentice · <area> · <level> card`), one question about the edit, three numbered answers, Skip and Quiet 1h.
- **Spot-the-flaw card** (senior level): the same header, the hunk Claude just wrote in a `Code` element with `format: 'diff'`, and two buttons: **Looks fine** and **Flag to Claude**.

Answer buttons carry digit hotkeys (1 to 3; 1 and 2 on a flaw card), which the band also fires when the user types that digit alone into an empty prompt. After an answer, the card shows the explanation for 8 seconds or until the next card, then clears.

The band is shared with other mods, so the card is drawn above `await next(e)` in one `Box`, keeping what other mods show there. With no card on screen, the hook returns `next(e)`.

### Knowledge map (pane)

- Title row: repo name and the headline number, "You know N% of the code as it is today".
- One star per area. Size = the area's share of lines. Brightness = its understanding score.
- A dashed outline marks an area Claude changed since its score was last raised, with "N Claude edits since you looked" under the name.
- Faint dashed lines join areas that often change together.
- Clicking a star lists the area's skipped cards so the user can clear a dark zone on purpose.
- A legend line: bright = you know it, dashed = Claude changed it since, lines = change together.

### Codebase Wrapped (pane)

Four numbers (areas mastered, flaws caught, cards answered, dark zones left), the week's biggest jump ("Firestore rules, 20% to 55%"), and **Copy image**.

### Surfaces

| Surface | Map | Cards | Wrapped |
| --- | --- | --- | --- |
| Desktop app (primary) | `Svg` in a `Pane` | `AbovePrompt` band | `Svg` in a `Pane` |
| Terminal | `Raster` grid in a `Pane`, same layout as cells | `AbovePrompt` band, drawn as text | Text and numbers in a `Pane`; no Copy image |
| VS Code extension | Not supported in v1 | Not supported in v1 | Not supported in v1 |

VS Code is out of v1 because it doesn't draw `AbovePrompt`. The mod checks `e.surface` and draws a one-line "Apprentice supports the Desktop app and the terminal" note in its pane there.

Panes open only from a command or a press, never on their own, because a pane a mod opens unasked doesn't appear in a terminal narrower than 144 columns.

## 4. Architecture

One plugin with a pure core inside it. The core is plain TypeScript with no mods API, so it is unit-tested directly and a CLI or web version can reuse it later. A thin hooks layer connects it to Claude Code.

```
apprentice/
├── .claude-plugin/plugin.json
├── hooks/hooks.json            → "modules": ["./register.js"] (built)
├── src/
│   ├── core/
│   │   ├── areas.ts            group folders into areas, keep names and renames
│   │   ├── understanding.ts    seed, dim, relight; the headline number
│   │   ├── levels.ts           pick the card level per area
│   │   └── wrapped.ts          weekly summary from the answer log
│   ├── cards/
│   │   ├── prompt.ts           build the Haiku request
│   │   └── parse.ts            validate Haiku's JSON into a Card or nothing
│   ├── views/
│   │   ├── map-svg.ts          map for Desktop
│   │   ├── map-raster.ts       map for the terminal
│   │   ├── card.ts             band card, both surfaces
│   │   └── wrapped.ts          Wrapped, both surfaces
│   └── register.ts             hooks: wires core, cards and views to the mods API
├── types/index.d.ts            PluginState declarations for $.state
└── test/                       Vitest for core and cards; *.test.ts for the mod harness
```

The build bundles `src/register.ts` and everything it imports into one hooks module.

| Unit | Job | Depends on |
| --- | --- | --- |
| `core/areas` | Group files into areas; apply renames and merges | File list and co-change pairs, passed in |
| `core/understanding` | Score each area from 0 to 1; dim on edits; relight on answers | `areas` |
| `core/levels` | Choose junior, mid or senior per area from the answer history | Answer log |
| `core/wrapped` | Build the weekly summary | Scores, answer log |
| `cards` | Build the Haiku request; parse and validate the reply | Nothing from the mods API |
| `views` | Turn core data into element trees | Element functions passed in |
| `register` | Hooks, commands, storage, model and git calls | The mods API and everything above |

Only `register.ts` touches `$`. Every other unit takes plain data in and returns plain data.

## 5. Data model

### Area

```ts
type Area = {
  id: string              // stable slug, kept across renames
  name: string            // from Haiku, or the user's rename
  paths: string[]         // folder prefixes that belong to the area
  lines: number           // tracked lines at last map
  score: number           // 0 to 1: understanding of the code as it is now
  editsSinceLooked: number
  level: 'junior' | 'mid' | 'senior'
  streak: number          // signed: +right answers in a row, −wrong answers in a row
}
```

### Card

```ts
type Card =
  | { kind: 'question'; areaId: string; level: 'junior' | 'mid'; question: string;
      options: [string, string, string]; answer: 0 | 1 | 2; explanation: string;
      editId: string; dimmedBy: number }
  | { kind: 'flaw'; areaId: string; level: 'senior'; hunk: string; file: string;
      haikuSeesFlaw: boolean; explanation: string; editId: string; dimmedBy: number }
```

`dimmedBy` is how much the edit lowered the area's score, so a right answer can restore exactly that.

### Answer log entry

```ts
type Answer = { at: number; areaId: string; level: Card['level']; kind: Card['kind'];
                outcome: 'right' | 'wrong' | 'skipped' | 'flagged' | 'looks-fine' }
```

### Storage

| Data | Where | Key |
| --- | --- | --- |
| Areas for a repo | `$.store` | `repo:<repoId>:area:<areaId>`, one key per area |
| Area list and map layout | `$.store` | `repo:<repoId>:meta` |
| Answer log | `$.store` | `repo:<repoId>:answers:<ISO week>` |
| Pending (skipped) cards | `$.store` | `repo:<repoId>:pending:<areaId>`, at most 5 per area, newest kept |
| The card on screen, quiet-until time | `$.state` | Declared in `types/index.d.ts` |

`repoId` is the first 16 hex characters of the SHA-256 of the repo's `origin` remote URL, or of the repo root path when there is no remote. One key per area keeps two sessions in one repo from overwriting each other's progress; each write reads the key first, as the [mods docs advise](https://code.claude.com/docs/en/plugins/mods/interface.md#save-from-more-than-one-session). `$.store` holds 4 MiB in total, so answer logs older than 8 weeks are deleted when a new week's key is written.

## 6. How it works

### Mapping a repo

1. `git ls-files` lists tracked files. Each file's line count is estimated as its `$.fs.stat` size divided by 40 bytes. Line counts only weigh star sizes and dimming, so an estimate is enough (see open questions).
2. `git log --name-only --format=%x00 -n 500` gives co-change pairs: files changed in the same commit.
3. `core/areas` groups files:
   - Start from top-level folders. Split any folder over 25% of all lines into its subfolders, repeatedly. Merge folders under 2% of lines into an "Other" area.
   - Merge two areas when more than 60% of their commits touch both.
   - Stop when there are 6 to 15 areas; if still over 15, merge the smallest pairs with the most co-change.
4. One `$.model.complete` call with `model: 'haiku'` names all areas from their paths and five sample file names each. The reply is JSON `{ "<areaId>": "<name>" }`. If it fails, areas keep their folder names.
5. Seed: for each area, sample up to 20 files (largest first), run `git blame --line-porcelain` on each, and count lines whose `author-mail` matches `git config user.email`. Score = your lines ÷ sampled lines, capped at 0.9 so no area starts "mastered".

All git work runs through `$.process.spawn`, which streams output, so a long `git log` or `git blame` doesn't hit `$.process.run`'s 30-second default. It starts from the `command.run` hook, which returns at once; the pane updates as results arrive.

### Dimming on an edit

A `tool.call` hook matches `Edit`, `Write` and `MultiEdit`. It calls `next(e)` first, so the edit is never delayed, then:

1. Finds the area by the longest matching path prefix of `file_path`. A file outside every area goes to "Other".
2. Estimates changed lines from the tool input: `old_string` and `new_string` line counts for `Edit`, the sum over edits for `MultiEdit`, the new content's line count for `Write`.
3. Applies `dim = min(score, changedLines ÷ area.lines)`, then `score -= dim` and `editsSinceLooked += 1`.
4. If this is the turn's first edit, cards aren't quiet, the hourly cap isn't reached, and the file isn't excluded (section 7), it starts card generation without awaiting it.

The turn's "first edit" is tracked from `turn.start`, which resets a flag.

### Making a card

`cards/prompt.ts` builds one `$.model.complete` request:

- `model: 'haiku'`, `maxTokens: 600`, `timeoutMs: 20000`.
- `prompt` as blocks: the static instructions and JSON schema first with `cache: true`, then the area name, the level, the file path, and the edit's diff (`old_string` → `new_string`, at most 120 lines; longer diffs are cut to the first 120).
- Level guidance: junior asks what the change does or why; mid asks what would break or what it depends on; senior returns the hunk and whether Haiku sees a flaw, with a one-paragraph explanation either way.

`cards/parse.ts` accepts only JSON that matches the `Card` shape: exactly three non-empty options, an answer index of 0 to 2, an explanation under 600 characters, a hunk under 40 lines. Anything else returns nothing, and no card is shown.

### Answering

| Outcome | Score | Level streak |
| --- | --- | --- |
| Right | `+ dimmedBy`, plus 0.02 (capped at 1) | `streak = max(streak, 0) + 1` |
| Wrong | `+ dimmedBy × 0.25` | `streak = min(streak, 0) − 1` |
| Looks fine | `+ dimmedBy` | No change |
| Flagged | `+ dimmedBy` | `streak = max(streak, 0) + 1` |
| Skipped | No change | No change |

Any answer except Skip sets `editsSinceLooked` to 0. A streak of +3 moves the area up a level and resets the streak; −2 moves it down and resets. Areas start at junior if their score is under 0.4, mid under 0.75, senior otherwise.

On a flaw card the user is right with **Looks fine** when Haiku saw no flaw, and right with **Flag to Claude** when it did. The explanation always says it is Haiku's opinion, not a verdict on the code.

### Flag to Claude

`$.prompt.submit({ text })` with:

> Apprentice flag on `<file>`: the user reviewed this change and is concerned: "<Haiku's flaw summary, or 'something looks wrong here'>". Check whether it was intended, and fix it if not.

Not awaited, because `submit` resolves only when the next turn starts. If the result reports a drop because the user stopped the turn, the text is kept and resubmitted from the next `turn.complete`, as the [mods API docs show](https://code.claude.com/docs/en/plugins/mods/api.md#retry-a-refused-or-dropped-call).

### Headline number

`known = Σ(area.score × area.lines) ÷ Σ(area.lines)`, shown as a whole percent.

### Wrapped

Computed from the current ISO week's answer log and area scores at the start and end of the week (stored in `meta` on the first event of each week):

- Areas mastered: areas that crossed 0.8 this week.
- Flaws caught: flagged answers on cards where Haiku saw a flaw.
- Cards answered: entries other than Skip.
- Dark zones left: areas under 0.3.
- Biggest jump: the area with the largest score gain, with its start and end percent.

A `session.start` timer checks once an hour and toasts once per week when the week has at least 5 answers.

## 7. Errors and limits

The rule: Apprentice never blocks Claude or the user, and never shows an error where a quiet absence will do.

| Case | Behaviour |
| --- | --- |
| Haiku fails, times out, or returns invalid JSON | No card this turn. The dimming still counts. A line goes to the debug log. |
| Not a git repo | Cards work. Areas come from folders with no co-change step. The map starts dark and says "No git history: scores start at zero." |
| `git blame` is slow or the repo is huge | Seed sampling caps at 20 files per area; the pane shows progress; scores fill in as each area finishes. |
| Secrets | Edits to files matching `.env*`, `*.pem`, `*.key`, `id_*`, `*secret*`, `*credential*`, or ignored by `.gitignore` (checked with `git check-ignore`) never go to Haiku. They still dim. |
| Cost | At most 6 cards an hour by default (`userConfig.cardsPerHour`). Naming is one call per repo per remap. |
| Two sessions in one repo | Per-area keys, read before write. A lost update costs at most one answer's relight. |
| Pane in a narrow terminal | Opened only from commands or presses, so it always appears. |
| VS Code | A one-line note in the pane; no hooks draw elsewhere. |
| User stops a turn | A pending card stays; a flag is retried after the next input, as in section 6. |

## 8. Testing

Test first, per the author's workflow.

- **Core (Vitest):** area grouping on fixture file lists and co-change pairs, including the split, merge and 6-to-15 bounds; seeding from fixture blame counts; dimming, relighting and the cap; level changes from streaks; the headline number; Wrapped totals across a week boundary.
- **Cards (Vitest):** `parse.ts` against saved Haiku replies: valid question and flaw cards, wrong option counts, out-of-range answers, extra prose around the JSON, truncated JSON. `prompt.ts` snapshot tests for each level, and diff truncation at 120 lines.
- **Mod (`claude plugin test`):** with the model and process calls stubbed: an `Edit` dims the right area and produces one card per turn; a second edit in the turn produces none; Quiet 1h suppresses cards; pressing 1, 2 or 3 records the outcome; Flag calls `$.prompt.submit`; the map renders as `Svg` on the `desktop` surface and as `Raster` on `terminal`; excluded files never reach the model stub.
- **Manual:** a week of real use on `dogbase-web-app-v2` and `trustbut`, checking that the areas make sense to their author and that cards are worth answering.

## 9. Scope

### v1

Map (Desktop `Svg`, terminal `Raster`), adaptive cards (question and spot-the-flaw), Flag to Claude, Codebase Wrapped, the four commands, renaming and merging areas.

### Later

- Streaks (a daily counter). Left out of v1 because it can nag.
- Team view: teammates' maps for onboarding. Needs a sharing mechanism.
- VS Code support, once it draws `AbovePrompt`, or with cards moved into a pane there.
- Cards for edits made by people, not only Claude.

## 10. Decisions

| Decision | Chosen | Over | Why |
| --- | --- | --- | --- |
| Primary surface | Desktop `Svg` | Terminal `Raster` first | The map is the visual hook; the author works in Desktop; the terminal still gets a fallback |
| Understanding signal | Git authorship seed, dim on Claude's edits, relight with cards | Cards only; self-reported | Makes the map meaningful to seniors on day one and turns Claude's edits into visible debt |
| Areas | Folders grouped automatically, named once by Haiku, user can rename | Plain folders | Readable at a glance; one model call per repo |
| Card timing | One card per editing turn, never blocking | Only on demand | Every-turn use without nagging |
| Game layer | Light: Wrapped only | XP, levels, characters | Reads as childish to the senior developers the project wants to impress |
| Structure | One mod with a pure core | All logic in hooks; separate npm package | Testable and reusable without publishing two packages before anyone uses either |

## 11. Open questions

- [ ] Does `tool.call` fire for subagents' edits with the same fields? If not, subagent edits need `classic.PostToolUse`.
- [ ] Can `Copy image` render the Wrapped `Svg` to a PNG inside the mod, or does it copy the SVG text?
- [ ] Is a line estimate from file size good enough for dimming, or should mapping count lines exactly for files under 1 MiB?

## Sources

- [Mods overview](https://code.claude.com/docs/en/plugins/mods/overview)
- [Mods API](https://code.claude.com/docs/en/plugins/mods/api.md)
- [Draw in the interface](https://code.claude.com/docs/en/plugins/mods/interface.md)
- [Mods reference](https://code.claude.com/docs/en/plugins/mods/reference.md)
- [claude-mods.com](https://claude-mods.com/)

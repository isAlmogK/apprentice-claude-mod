# Apprentice: Design

**Status:** Implemented (2026-10-23), manual check pending

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

Requires Claude Code v2.1.296 or later, the version it is built and tested on. Apprentice avoids element props that need v2.1.299 (`Text` `weight`, named `Box` spacing steps).

### First run in a repo

1. The user runs `/apprentice`. The map pane opens and shows "Mapping your repo…".
2. In the background, Apprentice groups the repo's folders into at most 15 areas, asks Haiku to name them, and seeds each area's score from `git blame` authorship under the user's git email.
3. The map appears. A senior opening their own repo sees mostly bright areas; a new hire sees mostly dark ones.
4. The user can rename or merge areas from the pane. Their changes are kept.

Outside a git repo, the pane says "Apprentice needs a git repo" and the mod does nothing else.

### Every editing turn

1. Claude makes its first successful edit of the turn (`Edit`, `Write` or `MultiEdit`), in the main conversation or a subagent.
2. Apprentice dims the edited area and, in the background, asks Haiku for a card about that edit at the user's level for that area.
3. The card appears in the band above the prompt while Claude keeps working. The user answers with a click or by typing 1, 2 or 3 into the empty prompt.
4. The answer reveals the explanation and relights the area. A wrong answer still shows the explanation.
5. On a spot-the-flaw card, **Flag to Claude** queues a prompt describing the concern. It runs when Claude is idle.

Later edits in the same turn dim their areas but make no new card.

### Controls on every card

- **Skip**: dismisses the card. It waits in the area's list in the pane.
- **Quiet 1h**: no new cards for an hour. Dimming continues.

### Weekly

Once a week, when the week has at least 5 answers, a toast says Codebase Wrapped is ready. `/apprentice wrapped` opens it. Its **Copy** button copies a text version for posting. It never contains code.

### Commands

One registered command, `/apprentice`, with an optional argument:

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
- **Spot-the-flaw card** (senior level): the same header, the hunk Claude just wrote in a `Code` element with `format: 'diff'`, and two buttons: **Looks fine** (1) and **Flag to Claude** (2).

Answer buttons carry digit hotkeys, which the band also fires when the user types that digit alone into an empty prompt. After an answer, the card shows the explanation for 8 seconds, then clears.

The band is shared with other mods, so the card is drawn above `await next(e)` in one `Box`, keeping what other mods show there. With no card on screen, the hook returns `next(e)`.

### Knowledge map (pane)

- Title row: repo name and the headline number, "You know N% of the code as it is today".
- The map: one star per area. Size = the area's share of lines. Brightness = its understanding score. A dashed outline marks an area Claude changed since its score was last raised. The map is a picture and takes no clicks.
- A legend line: bright = you know it, dashed = Claude changed it since.
- The area list under the map: one button per area, such as `Billing · 31% · 14 Claude edits since you looked`. Pressing one opens its details: a field to rename it, a list to merge it into another area, and its skipped cards, each of which can be brought back into the band.

The approved mockup also drew faint lines between areas that change together. They are left out of v1: the co-change data is used to group areas, and the lines added clutter without a decision attached.

### Codebase Wrapped (pane)

Four numbers in bordered tiles (areas mastered, flaws caught, cards answered, dark zones left), the week's biggest jump ("Firestore rules, 20% to 55%"), and **Copy**. Built from `Box` and `Text`, so it looks the same in the Desktop app and the terminal.

### Surfaces

| Surface | Map | Cards | Wrapped |
| --- | --- | --- | --- |
| Desktop app (primary) | `Svg` in a `Pane` | `AbovePrompt` band | `Box` tiles in a `Pane` |
| Terminal | `Raster` grid in a `Pane`, same layout as cells | `AbovePrompt` band, drawn as text | `Box` tiles in a `Pane` |
| VS Code extension | Not supported in v1 | Not supported in v1 | Not supported in v1 |

VS Code is out of v1 because it doesn't draw `AbovePrompt`. There, the pane shows one line: "Apprentice supports the Desktop app and the terminal."

Panes open only from a command or a press, never on their own, because a pane a mod opens unasked doesn't appear in a terminal narrower than 144 columns.

## 4. Architecture

One plugin with a pure core inside it. Claude Code loads `.ts` files directly, so there is no build step and no Node toolchain. The core is plain TypeScript with no mods API, so it is tested directly and a CLI or web version can reuse it later. A thin hooks module connects it to Claude Code.

```
apprentice/
├── .claude-plugin/plugin.json
├── hooks/
│   ├── hooks.json              "modules": ["./register.ts"]
│   └── register.ts             every hook and every mods API call
├── src/
│   ├── core/
│   │   ├── types.ts            Area, Card, Answer, Level
│   │   ├── understanding.ts    seed, dim, relight, levels, the headline number
│   │   ├── areas.ts            group files into areas; find, rename, merge
│   │   ├── git.ts              parse git output; repo id
│   │   └── wrapped.ts          ISO weeks and the weekly summary
│   ├── cards/
│   │   ├── exclude.ts          paths that never go to Haiku
│   │   ├── prompt.ts           build the Haiku request
│   │   └── parse.ts            validate Haiku's JSON into a Card or nothing
│   └── views/
│       ├── elements.ts         the element-constructor type views take
│       ├── layout.ts           star positions
│       ├── map-svg.ts          map for Desktop
│       ├── map-raster.ts       map for the terminal
│       ├── card.ts             band card
│       ├── pane.ts             map pane: map, legend, area list, area details
│       └── wrapped.ts          Wrapped pane
└── tests/                      *.test.ts, run by `claude plugin test`
```

| Unit | Job | Depends on |
| --- | --- | --- |
| `core/*` | Pure data rules | Nothing |
| `cards/*` | Build the Haiku request; parse the reply; exclude secret paths | `core/types` |
| `views/*` | Turn data into element trees, given the element constructors | `core/types` |
| `hooks/register.ts` | Hooks, commands, storage, model and git calls | The mods API and everything above |

Only `register.ts` touches `$`. The mods validator allows passing `$` only to functions declared at the top level of the same file, so every mods API call lives there. Views receive the element constructors from `$.ui.resolve(e)` and return trees.

## 5. Data model

```ts
type Level = 'junior' | 'mid' | 'senior'

type Area = {
  id: string              // stable slug, kept across renames
  name: string            // from Haiku, or the user's rename
  paths: string[]         // folder prefixes that belong to the area, such as 'src/billing/'
  lines: number           // estimated lines at last map
  score: number           // 0 to 1: understanding of the code as it is now
  editsSinceLooked: number
  level: Level
  streak: number          // +right answers in a row, or −wrong answers in a row
}

type QuestionCard = {
  kind: 'question'; areaId: string; level: 'junior' | 'mid'; file: string
  question: string; options: [string, string, string]; answer: 0 | 1 | 2
  explanation: string; editId: string; dimmedBy: number
}

type FlawCard = {
  kind: 'flaw'; areaId: string; level: 'senior'; file: string
  hunk: string            // the edit's diff, at most 40 lines, built by Apprentice
  haikuSeesFlaw: boolean; summary: string; explanation: string
  editId: string; dimmedBy: number
}

type Card = QuestionCard | FlawCard

type Answer = {
  at: number; areaId: string; level: Level; kind: Card['kind']
  skipped: boolean; isRight: boolean; flagged: boolean; haikuSeesFlaw: boolean
}
```

`dimmedBy` is how much the edit lowered the area's score, so a right answer can restore exactly that.

### Storage

| Data | Where | Key |
| --- | --- | --- |
| One area | `$.store` | `repo:<repoId>:area:<areaId>` |
| Area ids, layout seed, week-start scores | `$.store` | `repo:<repoId>:meta` |
| Answer log for a week | `$.store` | `repo:<repoId>:answers:<ISO week>` |
| Skipped cards for an area | `$.store` | `repo:<repoId>:pending:<areaId>`, at most 5, newest kept |
| Week of the last Wrapped toast | `$.store` | `repo:<repoId>:toasted` |
| The card on screen, quiet-until time, the cards-this-hour list | Module variables | Lost on a reload, which costs at most one card |

`repoId` is the first 16 hex characters of the SHA-256 of the repo's `origin` remote URL, or of the repo root path when there is no remote, from `$.session.repo()`. One key per area keeps two sessions in one repo from overwriting each other: each write reads the key, applies the same pure change, and writes it back, as the [mods docs advise](https://code.claude.com/docs/en/plugins/mods/interface.md#save-from-more-than-one-session). `$.store` holds 4 MiB in total, so answer logs older than 8 weeks are deleted when a new week's key is first written.

## 6. How it works

### Mapping a repo

All git commands run through `$.process.run` with `cwd` set to the repo root and `timeoutMs: 600000`, the 10-minute maximum. Mapping starts from a `$.clock.after(0, …)` timer so the command returns at once; the pane redraws as results arrive.

1. `git ls-tree -r -l HEAD` lists tracked files with their sizes. Each file's lines are estimated as `max(1, round(size ÷ 40))`. Line counts only weigh star sizes and dimming, so an estimate is enough.
2. `git log --name-only --format=@@commit -n 500` gives the files changed together in each of the last 500 commits.
3. `core/areas` groups files:
   - Start from top-level folders. Files at the repo root form a "Root files" group.
   - Split the largest group over 25% of all lines into its subfolders (its direct files stay as their own group), and repeat until no group over 25% can split.
   - Merge every group under 2% of lines into one "Other" area.
   - Merge the pair with the highest co-change (commits touching both ÷ commits touching either, counting only groups with at least 3 commits) while that ratio is over 0.6 and more than 6 groups remain.
   - While more than 15 groups remain, merge the two smallest.
4. One `$.model.complete` call with `model: 'haiku'` names all areas from their paths and up to five file names each. The reply is JSON `{ "<areaId>": "<name>" }`. Any area missing from a valid reply, or all of them when the call fails, keeps its default name.
5. Seed: for each area, sample its 20 largest files, run `git blame --line-porcelain -- <file>` on each, and count `author-mail` lines that match `git config user.email`. Score = your lines ÷ sampled lines, capped at 0.9 so no area starts mastered. Level starts at junior under 0.4, mid under 0.75, senior otherwise.

### Dimming on an edit

A `tool.call` hook matches `Edit`, `Write` and `MultiEdit`. It awaits `next(e)`, so the edit runs first and is never delayed by Apprentice. Then, if the result has no `deny` and no `isError`:

1. Finds the area by the longest path prefix that matches the edited file's path relative to the repo root. A file under no area's prefix is ignored.
2. Estimates changed lines: the larger of `old_string` and `new_string` line counts for `Edit`, the sum of that over `edits` for `MultiEdit`, and the `content` line count for `Write`.
3. Applies `dimmedBy = min(score, changedLines ÷ area.lines)`, then `score −= dimmedBy` and `editsSinceLooked += 1`, in memory and in the store.
4. If this is the turn's first edit, cards aren't quiet, fewer than 6 cards were shown in the last hour, and the path isn't excluded (section 7), it starts card generation from a `$.clock.after(0, …)` timer.

A `turn.start` hook with no `agentId` (the main conversation) clears the first-edit flag.

### Making a card

`cards/prompt.ts` builds one `$.model.complete` request: `model: 'haiku'`, `maxTokens: 600`, `timeoutMs: 20000`, a `system` text with the instructions and JSON shape for the level, and a `prompt` with the area name, the file path, and the edit's diff (old lines prefixed `-`, new lines prefixed `+`, at most 120 lines).

- Junior asks what the change does or why.
- Mid asks what would break or what it depends on.
- Senior returns whether Haiku sees a flaw, a one-sentence summary of it (or of why it looks fine), and an explanation.

`cards/parse.ts` takes the text between the first `{` and the last `}`, parses it, and accepts only the expected shape: three non-empty options, an answer of 0, 1 or 2, an explanation of at most 600 characters, a summary of at most 200. Anything else returns nothing, and no card is shown. The flaw card's hunk is Apprentice's own diff, cut to 40 lines, not Haiku's text.

### Answering

Both card kinds score as right or wrong. On a question card, right means picking the answer Haiku marked. On a flaw card, right means **Flag to Claude** when Haiku saw a flaw and **Looks fine** when it didn't. The explanation always says it is Haiku's view, not a verdict on the code.

| Outcome | Score | Streak |
| --- | --- | --- |
| Right | `+ dimmedBy + 0.02`, at most 1 | `max(streak, 0) + 1` |
| Wrong | `+ dimmedBy × 0.25` | `min(streak, 0) − 1` |
| Skipped | No change | No change |

Right and wrong set `editsSinceLooked` to 0. A streak of +3 moves the area up a level and resets the streak to 0; −2 moves it down and resets it. Senior is the top and junior the bottom.

Each answer, skipped or not, is appended to the week's answer log.

### Flag to Claude

`$.prompt.submit({ text })`, not awaited (it resolves only when the next turn starts), with:

> Apprentice flag on `<file>`: the user reviewed this change and is concerned: "<summary>". Check whether it was intended, and fix it if not.

If the result reports that the prompt was dropped because the user stopped the turn, the text is kept and submitted again from the next `turn.complete`, as the [mods API docs show](https://code.claude.com/docs/en/plugins/mods/api.md#retry-a-refused-or-dropped-call).

### Headline number

`known = Σ(area.score × area.lines) ÷ Σ(area.lines)`, shown as a whole percent.

### Wrapped

Computed from the current ISO week's answer log, the area scores now, and the scores at the start of the week (saved in `meta` by the first answer of each week):

- Areas mastered: areas that were under 0.8 at the start of the week and are at or over 0.8 now.
- Flaws caught: answers with `flagged` and `haikuSeesFlaw`.
- Cards answered: answers not skipped.
- Dark zones left: areas under 0.3 now.
- Biggest jump: the area with the largest gain, with its start and end percent; none when nothing rose.

An hourly `$.clock.every` timer toasts once per week when the week has at least 5 answers.

## 7. Errors and limits

The rule: Apprentice never blocks Claude or the user, and never shows an error where a quiet absence will do.

| Case | Behaviour |
| --- | --- |
| Haiku fails, times out, or returns invalid JSON | No card this turn. The dimming still counts. |
| Not a git repo | The pane says "Apprentice needs a git repo"; nothing else happens. |
| A git command fails during mapping | Mapping stops, and the pane says which step failed. `/apprentice remap` tries again. |
| Large repo | Blame samples at most 20 files per area; the pane shows progress as each area finishes. |
| Secrets | Paths matching `.env*`, `*.pem`, `*.key`, `id_rsa*`, `id_ed25519*`, `*secret*` or `*credential*`, or ignored by git (`git check-ignore -q`), never go to Haiku. They still dim. |
| Cost | At most 6 cards an hour. Naming is one call per map. A user setting for the cap is left for later, until someone asks for it. |
| Two sessions in one repo | Per-area keys, read before write. |
| Pane in a narrow terminal | Opened only from commands or presses, so it always appears. |
| VS Code | One line in the pane; the band hook draws nothing there. |
| User stops a turn | A card on screen stays; a dropped flag is retried after the next turn. |

## 8. Testing

Test first, per the author's workflow. Every test runs with `claude plugin test`, which loads `.ts` test files from `tests/`; no Node install is needed.

- **Core:** grouping on fixture file lists and commits (top-level groups, splitting, "Other", co-change merges, the cap of 15); finding an area by path; rename and merge; seeding; dimming; answering and level changes; the headline number; git output parsing; ISO weeks and Wrapped totals.
- **Cards:** the request for each level and diff truncation; `parse.ts` against valid question and flaw replies, wrong option counts, out-of-range answers, prose around the JSON, truncated JSON; the secret-path list.
- **Views:** trees built with fake element constructors: buttons and hotkeys on each card kind, the area list, the Svg on `desktop` and the Raster on `terminal`.
- **Mod:** with the store, process, model and UI calls stubbed: `/apprentice` maps a fixture repo; an `Edit` dims the right area and produces one card per turn; a second edit in the turn produces none; quiet and the hourly cap suppress cards; pressing 1, 2 or 3 records the outcome and relights the area; Flag calls `$.prompt.submit`; excluded files never reach the model stub; the pane and band render on `desktop` and `terminal`.
- **Manual:** a week of real use on `dogbase-web-app-v2` and `trustbut`, checking that the areas make sense to their author and that cards are worth answering.

## 9. Scope

### v1

Map (Desktop `Svg`, terminal `Raster`), adaptive cards (question and spot-the-flaw), Flag to Claude, Codebase Wrapped, `/apprentice` and its three arguments, renaming and merging areas.

### Later

- Lines between areas that change together on the map.
- Streaks (a daily counter). Left out of v1 because it can nag.
- Team view: teammates' maps for onboarding. Needs a sharing mechanism.
- VS Code support, once it draws `AbovePrompt`, or with cards moved into a pane there.
- Cards for edits made by people, not only Claude.
- Repos without git.

## 10. Decisions

| Decision | Chosen | Over | Why |
| --- | --- | --- | --- |
| Primary surface | Desktop `Svg` | Terminal `Raster` first | The map is the visual hook; the author works in Desktop; the terminal still gets a fallback |
| Understanding signal | Git authorship seed, dim on Claude's edits, relight with cards | Cards only; self-reported | Makes the map meaningful to seniors on day one and turns Claude's edits into visible debt |
| Areas | Folders grouped automatically, named once by Haiku, user can rename | Plain folders | Readable at a glance; one model call per map |
| Card timing | One card per editing turn, never blocking | Only on demand | Every-turn use without nagging |
| Game layer | Light: Wrapped only | XP, levels, characters | Reads as childish to the senior developers the project wants to impress |
| Structure | One mod with a pure core, no build step | All logic in hooks; separate npm package | Testable and reusable without publishing two packages before anyone uses either |
| Test runner | `claude plugin test` for everything | Vitest for the core | One runner, no Node toolchain; the kit imports plain `.ts` files |
| Area interaction | Buttons in a list under the map | Clicking stars | `Svg` is drawn as an image and takes no presses |
| Wrapped sharing | Copy as text | Copy as image | The mods API copies text; no way to render the SVG to a PNG inside the mod |

## 11. Open questions

- [ ] Is a line estimate from file size good enough for dimming, or should mapping count lines exactly for small files?

Resolved while planning (2026-10-23): `tool.call` fires for subagents' tool calls too ([events docs](https://code.claude.com/docs/en/plugins/mods/events.md#guard-or-change-a-tool-call)), and Wrapped copies text, not an image.

## As built

Where the code differs from this spec, as of 2026-10-23. The current truth is in [docs/apprentice.md](../../apprentice.md).

1. `src/cards/policy.ts` exists (`CARDS_PER_HOUR`, `HOUR_MS`, `cardsWithinHour`, the hourly cap). It isn't in the file tree in section 4.
2. `/apprentice remap` keeps learned progress. Areas whose id survives keep their score, level, streak and `editsSinceLooked` and take only the new paths and lines; only new ids are seeded from blame (`carryProgress` in `src/core/areas.ts`). The spec said a remap refreshes the seed for every area. The user chose this on 2026-10-23. A remap also keeps existing area names, so renames survive it.
3. The edit hook wraps its work after the edit in try/catch and has a `.catch` handler, so a failure in Apprentice never affects Claude's edit.
4. `$.ui.copy` is called as `$.ui.copy({ text })`, not with the bare string.
5. The flag's fallback text, used when Haiku saw no flaw, is "something in this change looks wrong to them". Section 6 had the placeholder "something looks wrong here"; the user confirmed the code's wording.
6. The co-change merge never merges the "Other" area (skipped by id), which the spec didn't say.
7. Relative imports end in `.ts`. Tests run only as a whole suite: `claude plugin test` takes a plugin folder, not a file.
8. `$.ui.copy`, `timeoutMs` on `$.model.complete` and `$.store.keys()` were confirmed by the test kit, not by locally generated type declarations.
9. Edits are ignored (no dimming, no card) until the map is ready, which the spec didn't state.
10. The terminal map legend reads "● you know it · ○ Claude changed it since" instead of the Desktop wording.
11. `/apprentice quiet` also clears a card that is on screen.
12. A remap doesn't delete the stored keys of area ids that vanished (`saveAllAreas`); they stay orphaned and unread.
13. The area-naming request leaves out secret paths (`isSecretPath`), as section 7 requires; the plan's first version didn't filter it. An area whose paths and files are all secret is left out of the request entirely.
14. Git commands don't all run in "the repo root". `$.session.repo()` names the main checkout even in a linked worktree, so it only keys the repo id (shared by every worktree). Mapping and blame run in the session's own working tree (`git rev-parse --show-toplevel` in `$.session.cwd()`), and each edited file is matched to its worktree from `git worktree list --porcelain`, longest root first; its relative path and `git check-ignore` use that root. Every git command also passes `-c core.quotepath=false`.
15. Finding an area by path: the Root files prefix `''` matches only files at the repo root, so a file in a new top-level folder is ignored, as section 6 says. A split folder's direct-files prefix, such as `src/`, still matches files in new subfolders of `src/`, so those dim that area.
16. The band trims a spot-the-flaw hunk to `max(3, maxRows - 7)` lines plus "… N more lines", from `AbovePrompt`'s `maxRows`, so the card never scrolls (a scrolling band arms no digit hotkey). The stored hunk keeps up to 40 lines.
17. The hourly cap counts card requests to Haiku when they're made, not cards shown, so replies that make no card count too.
18. The repo is published as `isAlmogK/apprentice-claude-mod`, so the install is `/plugin marketplace add isAlmogK/apprentice-claude-mod`, then `/plugin install apprentice@apprentice` (the marketplace and plugin are still named `apprentice`).
19. The map lays stars out on a grid, one cell per area with its label inside the cell, instead of a free scatter, so stars and labels never overlap; long names are cut short with "…" on the map. The first layout, a golden-angle spiral, overlapped about 3 times on a map of 7 to 10 areas.

## Sources

- [Mods overview](https://code.claude.com/docs/en/plugins/mods/overview)
- [Create a mod](https://code.claude.com/docs/en/plugins/mods/create.md)
- [React to events](https://code.claude.com/docs/en/plugins/mods/events.md)
- [Mods API](https://code.claude.com/docs/en/plugins/mods/api.md)
- [Draw in the interface](https://code.claude.com/docs/en/plugins/mods/interface.md)
- [Test a mod](https://code.claude.com/docs/en/plugins/mods/test.md)
- [Mods reference](https://code.claude.com/docs/en/plugins/mods/reference.md)
- [Mods type declarations](https://github.com/anthropics/claude-code/blob/main/mods/types/claude-code.d.ts)
- [claude-mods.com](https://claude-mods.com/)

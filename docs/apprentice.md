# Apprentice

How Apprentice works today. This file describes the code as it stands; the design spec ([2026-10-23-apprentice-design.md](superpowers/specs/2026-10-23-apprentice-design.md)) records the intent on the day it was written, and its "As built" section lists where the two differ.

## What it is

Apprentice is a Claude Code mod that teaches you the code Claude is changing in your own repo, while Claude works. It groups the repo into at most 15 areas, draws them as a knowledge map, and scores how much of each area you understand. When Claude edits a file, the area dims, and Apprentice asks Haiku for one short card about that edit. Answering the card relights the area. All logic that doesn't need Claude Code lives in `src/` as plain TypeScript; `hooks/register.ts` is the only file that calls the mods API.

## Commands

One command, `/apprentice`, registered at `session.start` (with `immediate: true`).

| Command | Does |
| --- | --- |
| `/apprentice` | Opens the map pane. Maps the repo first when the repo has no saved map or the last mapping failed; otherwise reloads the saved areas from the store, so it shows what other sessions in the repo saved. |
| `/apprentice wrapped` | Opens the Codebase Wrapped pane for the current ISO week. Outside a git repo it replies "Apprentice needs a git repo." |
| `/apprentice quiet [minutes]` | Pauses new cards, 60 minutes by default, and clears the card on screen. Dimming continues. Minutes are rounded to a whole number, at least 1. Replies "Cards are paused for N minutes." ("1 minute" in the singular). |
| `/apprentice remap` | Regroups the repo into areas. Keeps what you learned (see "How areas are made"). While a mapping is already running, it only opens the pane. |

Any other argument replies `Usage: /apprentice [wrapped | quiet [minutes] | remap]`. Panes open only from a command or a press, never on their own. If looking up the repo fails at `session.start`, Apprentice stays off as if outside a repo, but `/apprentice` is still registered.

## Repos and worktrees

`$.session.repo()` gives the main checkout's root and the origin remote, for a linked worktree too. The repo id comes from those, so every worktree of a repo shares one map and one set of scores.

Path work uses working trees instead. At `session.start`, `git rev-parse --show-toplevel`, run in `$.session.cwd()`, gives the session's own working tree (falling back to the `repo()` root): mapping, blame and `git config user.email` run there. On each edit, `git worktree list --porcelain` lists the repo's working trees, and the edited file belongs to the longest root it sits under (the session's tree when none matches). Its repo-relative path, used to find the area and in the card, is taken from that root, and `git check-ignore` runs there.

Every git command is `$.process.run(['git', '-c', 'core.quotepath=false', ...])` with `timeoutMs: 600000`, so paths with non-ASCII characters come back unquoted.

## How areas are made

`src/core/areas.ts` (`groupAreas`) turns the tracked files (with estimated line counts) and the last commits into drafts:

1. Files are estimated at `max(1, round(bytes / 40))` lines, from `git ls-tree -r -l HEAD`.
2. Start from top-level folders. Files at the repo root form "Root files" (id `root`, path prefix `''`).
3. A group over 25% of all lines is split into its subfolders; its direct files stay as their own group. This repeats until no group over 25% can split.
4. Groups under 2% of lines merge into one "Other" area (id `other`).
5. Co-change merge: the pair whose commits overlap most (commits touching both divided by commits touching either) merges while that ratio is over 0.6, both groups have at least 3 commits, and more than 6 groups remain. The "Other" area is never merged this way.
6. While more than 15 groups remain, the two smallest merge.
7. Ids are slugs of the folder prefix, made unique with a numeric suffix. Names default to the prefix; one Haiku call (`$.model.complete`, `model: 'haiku'`) renames them all from folder paths and up to five file names each (secret paths left out), and any area missing from a valid reply keeps its default name. An area whose paths and files are all secret is left out of the request entirely and keeps its default name; when no area is left, no call is made.

Co-change data comes from `git log --name-only --format=@@commit -n 500`.

Remap and learned progress: the remap starts from the areas in the store (what every session in the repo saved; the in-memory list only when the store has none), and `carryProgress` keeps `score`, `level`, `streak` and `editsSinceLooked` for every area whose id survives, and takes only the new paths and lines. Existing area names (including your renames) are kept. Only areas with a new id are seeded from blame. Just before saving, it reads the store again and carries progress saved meanwhile, so a remap never overwrites another session's progress.

Seeding (new ids only): for each area, the 20 largest files are run through `git blame --line-porcelain`, and `author-mail` lines matching `git config user.email` are counted. Score is your lines divided by sampled lines, capped at 0.9. If the git email is empty, or blame fails, the area seeds at 0.

Renaming and merging are done in the pane. A merge reads both areas from the store (falling back to memory) and combines paths and lines, blends the score weighted by lines, adds the edit counts, keeps the target's level and resets the streak.

## How scores move

- **Level at seeding:** junior under 0.4, mid under 0.75, senior otherwise.
- **Dimming on an edit:** `dimmedBy = min(score, changedLines / area.lines)`; `score -= dimmedBy`; `editsSinceLooked += 1`. Changed lines are the larger of the old and new line counts for `Edit`, summed over `edits` for `MultiEdit`, and the content's line count for `Write`. Edits are ignored while the map isn't ready, or when the file is outside every area's paths.
- **Which area an edit is in:** the longest matching path prefix (`areaForPath`). The `''` prefix of Root files matches only files at the repo root, so a file in a new top-level folder, or in an untracked one such as `.claude/`, is in no area and is ignored. A prefix such as `src/` (a split folder's direct files) still takes files in a new subfolder of `src/`.
- **Answers:**

| Outcome | Score | Streak |
| --- | --- | --- |
| Right | `+ dimmedBy + 0.02`, at most 1 | `max(streak, 0) + 1` |
| Wrong | `+ dimmedBy x 0.25` | `min(streak, 0) - 1` |
| Skipped | No change | No change |

Right and wrong set `editsSinceLooked` to 0. A streak of +3 raises the level and resets the streak; -2 lowers it and resets the streak. Senior is the top, junior the bottom.

- **Headline:** `known = sum(score x lines) / sum(lines)`, as a whole percent: "You know N% of the code as it is today".

## Cards

- **One per editing turn.** `turn.start` without an `agentId` resets the first-edit flag; the first successful `Edit`, `Write` or `MultiEdit` of the turn (main conversation or a subagent) can make a card. Later edits in the turn only dim.
- **Levels.** Junior asks what the change does or why. Mid asks what would break or what it depends on. Both are question cards: three options, one answer. Senior gets a spot-the-flaw card: the edit's diff (at most 40 lines, built by Apprentice) and two buttons, **Looks fine** (1) and **Flag to Claude** (2). The card uses the area's current level.
- **Request.** `model: 'haiku'`, `maxTokens: 600`, `timeoutMs: 20000`. The prompt has the area name, the repo-relative file path, and the edit's diff, at most 120 lines. `src/cards/parse.ts` takes the text between the first `{` and the last `}` and accepts only the expected shape; anything else shows no card.
- **Hourly cap.** At most 6 card requests to Haiku in any rolling hour (`src/cards/policy.ts`). A request counts when it's made, so replies that make no card count too. `/apprentice quiet` and the card's **Quiet 1h** button pause cards too, and a reply that arrives after a pause started shows no card.
- **Exclusions.** Paths matching `.env*`, `*.pem`, `*.key`, `id_rsa*`, `id_ed25519*`, `*secret*` or `*credential*` never get a card, and neither do files git ignores (`git check-ignore -q`). Only exit 1 counts as not ignored: a git error keeps the file from Haiku too. They still dim.
- **Answering.** Click, or type 1, 2 or 3 into the empty prompt (the buttons carry digit hotkeys). A question is right when you pick Haiku's answer. A flaw card is right when you press Flag and Haiku saw a flaw, or Looks fine and it didn't.
- **8-second reveal.** After an answer the card shows the result and Haiku's explanation for 8 seconds, then clears. A wrong answer still shows the explanation. The text says it is Haiku's view, not a verdict on the code. The clear is scheduled and the flag sent before the answer is saved, and the store writes are wrapped in try/catch, so a store failure never leaves a card stuck or drops a flag.
- **Skip.** Moves the card to the area's skipped list (at most 5, newest kept). The area's details in the pane list them, and pressing one brings it back to the band.
- **Flag to Claude.** Calls `$.prompt.submit({ text })` with "Apprentice flag on `<file>`: the user reviewed this change and is concerned: ...". The concern is Haiku's one-sentence summary, or "something in this change looks wrong to them" when Haiku saw no flaw. It isn't awaited. If the prompt is dropped (the turn was stopped, or it left the queue), the text is submitted again at the next `turn.complete`.
- **The band.** The card is drawn above `await next(e)` in one `Box`, so what other mods show there is kept. With no card, or in VS Code, the hook returns `next(e)`. A taller tree than `AbovePrompt`'s `maxRows` would scroll and lose its digit hotkeys, so a spot-the-flaw card shows at most `max(3, maxRows - 7)` hunk lines, then "… N more lines" (`fitHunk` in `src/views/card.ts`). The stored hunk keeps up to 40 lines.
- **Failure.** The edit hook awaits the edit first, wraps all its own work in try/catch and has a `.catch` handler, so a failure in Apprentice never changes or fails Claude's edit. A failed Haiku call shows no card.

## Codebase Wrapped

Built from this ISO week's answer log, the current scores, and the scores saved at the start of the week (`meta.weekStart`, written by the first answer or skip of each week):

- Areas mastered: under 0.8 at the start of the week, at or over 0.8 now.
- Flaws caught: answers with `flagged` and `haikuSeesFlaw`.
- Cards answered: answers that weren't skipped.
- Dark zones left: areas under 0.3 now.
- Biggest jump: the largest gain, as start and end percent; none when nothing rose.

**Copy** calls `$.ui.copy({ text })` with a text version that never contains code. An hourly `$.clock.every` check toasts "Codebase Wrapped is ready: run /apprentice wrapped" once per week when the week's log has at least 5 answered cards (skipped cards don't count).

## Storage

All keys are in `$.store`, per repo. `repoId` is the first 16 hex characters of the SHA-256 of the origin remote URL, or the main checkout's root path when there is no remote, so every worktree of a repo shares its keys.

| Key | Holds |
| --- | --- |
| `repo:<repoId>:area:<areaId>` | One area (`Area`) |
| `repo:<repoId>:meta` | `areaIds`, and `weekStart` (the week and each area's score at its start) |
| `repo:<repoId>:answers:<ISO week>` | The week's answer log; weeks more than 8 behind are deleted when a new week's start is first written |
| `repo:<repoId>:pending:<areaId>` | Skipped cards for the area, at most 5 |
| `repo:<repoId>:toasted` | The week of the last Wrapped toast |

A remap doesn't delete the stored keys of area ids that no longer exist; they stay orphaned and are never read, because `meta.areaIds` no longer lists them.

Module variables, lost on a reload: the card on screen, the quiet-until time, the cards-this-hour list, the first-edit flag and a flag waiting to be resubmitted. The in-memory area list is a copy of the store, which is the source of truth: each area write (`updateArea`) reads the stored copy, applies the pure change, writes it back and puts what it wrote into memory; a remap and a merge start from the stored copies; and `/apprentice` reloads the list. So two sessions in one repo don't overwrite each other.

## Surfaces

| Surface | Map | Cards | Wrapped |
| --- | --- | --- | --- |
| Desktop app | `Svg` in a `Pane` | `AbovePrompt` band | `Box` tiles in a `Pane` |
| Terminal | `Raster` grid in a `Pane` | `AbovePrompt` band, as text | `Box` tiles in a `Pane` |
| VS Code | Not supported in v1: the pane says "Apprentice supports the Desktop app and the terminal." | Not drawn | Not supported |

How the map is laid out (`layoutStars` in `src/views/layout.ts`): areas, sorted by id, fill a grid of 1 row (up to 3 areas), 2 rows (up to 8) or 3 rows, row by row, with a short last row centered. Each star gets its own cell and stays inside it, circle and label, so nothing overlaps and nothing leaves the 640 × 300 map. Inside its cell a star is nudged by a fixed amount for its position, so the map doesn't look like a table. A star's radius is `8 + 24 × sqrt(lines share)`, capped so it fits its cell (at most 32). A name wider than its cell, estimated at 8px a character, is cut short with "…" (the area list under the map shows the full name). The terminal raster places each star at the same relative position.

Outside a git repo the pane says "Apprentice needs a git repo." and nothing else happens. If a mapping step fails, the pane says which one and suggests `/apprentice remap`. The map takes no clicks; areas are opened from the list under it.

## Testing

Run both from the repo root before every commit:

```
claude plugin test
claude plugin validate .
```

`claude plugin test` runs every `tests/*.test.ts` as one suite (it takes a plugin folder, not a file). `claude plugin validate .` checks the hooks module; it warns that `CLAUDE.md` at the plugin root isn't loaded as project context, which is expected, because that file is for people working on this repo.

README images: `node scripts/screenshots.ts` draws each view (`renderCard`, `renderPane`, `renderWrapped`) with demo data into HTML and captures it with headless Chrome into `docs/images/`. It needs Node 22.18 or later (it runs the `.ts` files directly) and Google Chrome (`CHROME` overrides the path). The images are previews of what the views draw, not captures of a live session.

Manual check, in the Desktop app on a real repo (add `{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "<path to this repo>" } }` to `~/.claude/settings.json`, start a new session, and remove the entry afterwards):

- [x] `/apprentice` opens the pane, shows progress, then the map, the headline and the area list.
- [x] The area names make sense to the repo's author.
- [x] Asking Claude for a small edit dims the right area and shows a card in the band within about 20 seconds.
- [x] Typing `1` into the empty prompt answers the card.
- [x] A spot-the-flaw card appears for an area you wrote most of.
- [x] Flag to Claude starts a turn once Claude is idle.
- [x] Skip, the area's details, and restoring a skipped card all work.
- [x] `/apprentice wrapped` shows the tiles, and Copy puts the text on the clipboard.
- [x] In a terminal (`claude --plugin-dir <path to this repo>`), the pane shows the raster map and the band shows cards.
- [x] In a session started in a linked worktree (`git worktree add ../<repo>-wt`), `/apprentice` shows the same map, and an edit there dims the right area and shows a card.

Status: run on 2026-10-23 on `trustbut` (8 areas, all written by the author), installed from GitHub with `claude plugin marketplace add isAlmogK/apprentice-claude-mod`, on Claude Code v2.1.296. Every item passed. The cards in that run were all spot-the-flaw cards, because every area started at the 90% seed cap, which is senior level; a question card wasn't seen live.

What the run found:

- **Another mod can hide the card.** Mods draw the band in a chain, and a mod earlier in the chain that returns its own tree without `await next(e)` hides Apprentice's card. replay-theater (Anthropic's example mod) does this once a turn has edits, so the card disappears when the turn ends. Apprentice keeps the card; it shows again when replay-theater stops drawing, or with replay-theater turned off. Apprentice can't move itself earlier in the chain.
- **Desktop: `/apprentice` appears after the session starts.** A new Desktop session starts its Claude Code process with the first message, and mods register their commands then. Send any message first, or send `/apprentice` in full.
- **Desktop: `/apprentice` waits for the turn.** The Desktop app queues it while Claude is working, despite `immediate: true`. **Send now** runs it.
- **The card's diff repeats unchanged lines.** `diffOf` marks every old line `-` and every new line `+`, so lines Claude's edit carried for context show as removed and added again. Haiku noticed it in one explanation.
- **A long diff line can clip the card.** `fitHunk` counts lines, not wrapped rows, so a diff whose lines wrap can be taller than the band; the card's bottom border was cut off once. The hotkeys still worked.
- **"… 1 more lines".** The trim marker doesn't use the singular.
- **A narrow terminal cuts the map pane off.** At 47 columns the pane sits above the prompt and shows only the first row of stars; the repo name wraps.
- **Small edits don't move the score you see.** A 2-line edit in a large area dims it by well under a point, so the star turns dashed but the percent stays the same. This is the dimming rule working as designed.

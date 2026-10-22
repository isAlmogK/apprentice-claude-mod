# Apprentice

How Apprentice works today. This file describes the code as it stands; the design spec ([2026-10-23-apprentice-design.md](superpowers/specs/2026-10-23-apprentice-design.md)) records the intent on the day it was written, and its "As built" section lists where the two differ.

## What it is

Apprentice is a Claude Code mod that teaches you the code Claude is changing in your own repo, while Claude works. It groups the repo into at most 15 areas, draws them as a knowledge map, and scores how much of each area you understand. When Claude edits a file, the area dims, and Apprentice asks Haiku for one short card about that edit. Answering the card relights the area. All logic that doesn't need Claude Code lives in `src/` as plain TypeScript; `hooks/register.ts` is the only file that calls the mods API.

## Commands

One command, `/apprentice`, registered at `session.start` (with `immediate: true`).

| Command | Does |
| --- | --- |
| `/apprentice` | Opens the map pane. Maps the repo first when the repo has no saved map or the last mapping failed. |
| `/apprentice wrapped` | Opens the Codebase Wrapped pane for the current ISO week. |
| `/apprentice quiet [minutes]` | Pauses new cards, 60 minutes by default, and clears the card on screen. Dimming continues. Replies "Cards are paused for N minutes." |
| `/apprentice remap` | Regroups the repo into areas. Keeps what you learned (see "How areas are made"). |

Any other argument replies `Usage: /apprentice [wrapped | quiet [minutes] | remap]`. Panes open only from a command or a press, never on their own.

## How areas are made

`src/core/areas.ts` (`groupAreas`) turns the tracked files (with estimated line counts) and the last commits into drafts:

1. Files are estimated at `max(1, round(bytes / 40))` lines, from `git ls-tree -r -l HEAD`.
2. Start from top-level folders. Files at the repo root form "Root files" (id `root`).
3. A group over 25% of all lines is split into its subfolders; its direct files stay as their own group. This repeats until no group over 25% can split.
4. Groups under 2% of lines merge into one "Other" area (id `other`).
5. Co-change merge: the pair whose commits overlap most (commits touching both divided by commits touching either) merges while that ratio is over 0.6, both groups have at least 3 commits, and more than 6 groups remain. The "Other" area is never merged this way.
6. While more than 15 groups remain, the two smallest merge.
7. Ids are slugs of the folder prefix, made unique with a numeric suffix. Names default to the prefix; one Haiku call (`$.model.complete`, `model: 'haiku'`) renames them all from folder paths and up to five file names each (secret paths left out), and any area missing from a valid reply keeps its default name.

Co-change data comes from `git log --name-only --format=@@commit -n 500`.

Remap and learned progress: `carryProgress` keeps `score`, `level`, `streak` and `editsSinceLooked` for every area whose id survives, and takes only the new paths and lines. Existing area names (including your renames) are kept. Only areas with a new id are seeded from blame.

Seeding (new ids only): for each area, the 20 largest files are run through `git blame --line-porcelain`, and `author-mail` lines matching `git config user.email` are counted. Score is your lines divided by sampled lines, capped at 0.9. If the git email is empty, or blame fails, the area seeds at 0.

Renaming and merging are done in the pane. A merge combines paths and lines, blends the score weighted by lines, adds the edit counts, keeps the target's level and resets the streak.

## How scores move

- **Level at seeding:** junior under 0.4, mid under 0.75, senior otherwise.
- **Dimming on an edit:** `dimmedBy = min(score, changedLines / area.lines)`; `score -= dimmedBy`; `editsSinceLooked += 1`. Changed lines are the larger of the old and new line counts for `Edit`, summed over `edits` for `MultiEdit`, and the content's line count for `Write`. Edits are ignored while the map isn't ready, or when the file is outside every area's paths.
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
- **Hourly cap.** At most 6 cards in any rolling hour (`src/cards/policy.ts`). `/apprentice quiet` and the card's **Quiet 1h** button pause cards too.
- **Exclusions.** Paths matching `.env*`, `*.pem`, `*.key`, `id_rsa*`, `id_ed25519*`, `*secret*` or `*credential*` never get a card, and neither do files git ignores (`git check-ignore -q`). They still dim.
- **Answering.** Click, or type 1, 2 or 3 into the empty prompt (the buttons carry digit hotkeys). A question is right when you pick Haiku's answer. A flaw card is right when you press Flag and Haiku saw a flaw, or Looks fine and it didn't.
- **8-second reveal.** After an answer the card shows the result and Haiku's explanation for 8 seconds, then clears. A wrong answer still shows the explanation. The text says it is Haiku's view, not a verdict on the code.
- **Skip.** Moves the card to the area's skipped list (at most 5, newest kept). The area's details in the pane list them, and pressing one brings it back to the band.
- **Flag to Claude.** Calls `$.prompt.submit({ text })` with "Apprentice flag on `<file>`: the user reviewed this change and is concerned: ...". The concern is Haiku's one-sentence summary, or "something in this change looks wrong to them" when Haiku saw no flaw. It isn't awaited. If the prompt is dropped (the turn was stopped, or it left the queue), the text is submitted again at the next `turn.complete`.
- **The band.** The card is drawn above `await next(e)` in one `Box`, so what other mods show there is kept. With no card, or in VS Code, the hook returns `next(e)`.
- **Failure.** The edit hook awaits the edit first, wraps all its own work in try/catch and has a `.catch` handler, so a failure in Apprentice never changes or fails Claude's edit. A failed Haiku call shows no card.

## Codebase Wrapped

Built from this ISO week's answer log, the current scores, and the scores saved at the start of the week (`meta.weekStart`, written by the first answer or skip of each week):

- Areas mastered: under 0.8 at the start of the week, at or over 0.8 now.
- Flaws caught: answers with `flagged` and `haikuSeesFlaw`.
- Cards answered: answers that weren't skipped.
- Dark zones left: areas under 0.3 now.
- Biggest jump: the largest gain, as start and end percent; none when nothing rose.

**Copy** calls `$.ui.copy({ text })` with a text version that never contains code. An hourly `$.clock.every` check toasts "Codebase Wrapped is ready: run /apprentice wrapped" once per week when the week's log has at least 5 entries (skipped entries count).

## Storage

All keys are in `$.store`, per repo. `repoId` is the first 16 hex characters of the SHA-256 of the origin remote URL, or the repo root path when there is no remote.

| Key | Holds |
| --- | --- |
| `repo:<repoId>:area:<areaId>` | One area (`Area`) |
| `repo:<repoId>:meta` | `areaIds`, and `weekStart` (the week and each area's score at its start) |
| `repo:<repoId>:answers:<ISO week>` | The week's answer log; weeks more than 8 behind are deleted when a new week's start is first written |
| `repo:<repoId>:pending:<areaId>` | Skipped cards for the area, at most 5 |
| `repo:<repoId>:toasted` | The week of the last Wrapped toast |

A remap doesn't delete the stored keys of area ids that no longer exist; they stay orphaned and are never read, because `meta.areaIds` no longer lists them.

Module variables, lost on a reload: the card on screen, the quiet-until time, the cards-this-hour list, the first-edit flag and a flag waiting to be resubmitted. Each area write reads the stored copy, applies the same pure change and writes it back, so two sessions in one repo don't overwrite each other.

## Surfaces

| Surface | Map | Cards | Wrapped |
| --- | --- | --- | --- |
| Desktop app | `Svg` in a `Pane` | `AbovePrompt` band | `Box` tiles in a `Pane` |
| Terminal | `Raster` grid in a `Pane` | `AbovePrompt` band, as text | `Box` tiles in a `Pane` |
| VS Code | Not supported in v1: the pane says "Apprentice supports the Desktop app and the terminal." | Not drawn | Not supported |

Outside a git repo the pane says "Apprentice needs a git repo." and nothing else happens. If a mapping step fails, the pane says which one and suggests `/apprentice remap`. The map takes no clicks; areas are opened from the list under it.

## Testing

Run both from the repo root before every commit:

```
claude plugin test
claude plugin validate .
```

`claude plugin test` runs every `tests/*.test.ts` as one suite (it takes a plugin folder, not a file). `claude plugin validate .` checks the hooks module; it warns that `CLAUDE.md` at the plugin root isn't loaded as project context, which is expected, because that file is for people working on this repo.

Manual check, in the Desktop app on a real repo (add `{ "env": { "CLAUDE_CODE_PLUGIN_DIRS": "<path to this repo>" } }` to `~/.claude/settings.json`, start a new session, and remove the entry afterwards):

- [ ] `/apprentice` opens the pane, shows progress, then the map, the headline and the area list.
- [ ] The area names make sense to the repo's author.
- [ ] Asking Claude for a small edit dims the right area and shows a card in the band within about 20 seconds.
- [ ] Typing `1` into the empty prompt answers the card.
- [ ] A spot-the-flaw card appears for an area you wrote most of.
- [ ] Flag to Claude starts a turn once Claude is idle.
- [ ] Skip, the area's details, and restoring a skipped card all work.
- [ ] `/apprentice wrapped` shows the tiles, and Copy puts the text on the clipboard.
- [ ] In a terminal (`claude --plugin-dir <path to this repo>`), the pane shows the raster map and the band shows cards.

Status: not run yet.

<div align="center">

# 🎓 apprentice

### Learn the code Claude is changing, while it changes it.

**Claude changed `billing/` 14 times this week. Do you still understand it?**

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-%E2%89%A52.1.296-d97757.svg)](#requirements)
[![Status](https://img.shields.io/badge/status-alpha-orange.svg)](docs/apprentice.md)
[![Sponsor](https://img.shields.io/badge/sponsor-%E2%99%A5-ea4aaa?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/isAlmogK)

[Why](#why-im-building-this) · [Install](#install) · [What you see](#what-you-see) · [Commands](#commands) · [Privacy](#privacy) · [Requirements](#requirements) · [Sibling projects](#sibling-projects) · [About me](#about-me)

</div>

---

Apprentice is a mod for Claude Code. It draws a **knowledge map** of your repo that is bright where you understand the code and dim where Claude changed code you haven't seen. After each editing turn it asks **one short question** about the edit, at your level for that area, and a right answer relights the area.

No account, no server. It runs inside Claude Code and uses Haiku, through Claude Code, for the cards.

<!-- Screenshots go here, saved under docs/images/: the band with a card, the knowledge map, Codebase Wrapped. -->

## Why I'm building this

AI agents now write a large share of the code I ship. Writing it is no longer the slow part. **Understanding it is.** Code changes faster than its owners can read it, and the gap grows quietly. I call that gap **comprehension debt**: code that changed since you last understood it.

Juniors feel it as "I ship code I can't explain." Seniors feel it as "Claude changed `billing/` 14 times this week and I haven't looked." Nothing in Claude Code measures that gap, or helps pay it down.

Apprentice does both. The map shows how much of your codebase you still understand, and the cards teach you the rest while Claude works, a few seconds at a time, without blocking anything.

## Install

```
/plugin marketplace add isAlmogK/apprentice
/plugin install apprentice@apprentice
```

Then open a git repo and run `/apprentice`.

## What you see

**The band.** After Claude's first edit of a turn, a card appears above your prompt while Claude keeps working. Juniors and mids get a question with three numbered answers. Seniors get a spot-the-flaw card: the diff Claude just wrote, with **Looks fine** and **Flag to Claude**. Answer with a click, or type `1`, `2` or `3` into the empty prompt. A wrong answer still shows the explanation. **Skip** keeps the card in the area's list for later; **Quiet 1h** pauses cards.

**The map.** `/apprentice` groups your repo into at most 15 areas, names them, and seeds each score from `git blame`: lines you wrote count as lines you understand. Each area is a star, sized by its share of the code and brighter the more you know it. A dashed outline means Claude changed it since you last looked. The headline reads "You know N% of the code as it is today". The Desktop app draws it as an image; the terminal draws a character grid. Under the map, each area is a button for its details: rename it, merge it into another, or bring back a skipped card.

**Codebase Wrapped.** Once a week, when you've answered at least 5 cards, a toast says your week is ready. `/apprentice wrapped` shows areas mastered, flaws caught, cards answered, dark zones left and your biggest jump. **Copy** puts a text version on your clipboard, ready to post. It never contains code.

## Commands

| Command | Does |
| --- | --- |
| `/apprentice` | Opens the map (maps the repo first if needed) |
| `/apprentice wrapped` | Opens this week's Codebase Wrapped |
| `/apprentice quiet [minutes]` | Pauses cards, 60 minutes by default. Dimming continues |
| `/apprentice remap` | Regroups the areas. Areas that keep their id keep what you learned |

## Privacy

Everything stays on your machine except what Apprentice asks Haiku, through Claude Code.

**Goes to Haiku:**

- For each card: one edit's diff (at most 120 lines), the file's path and the area's name.
- Once per map: the area folder paths and up to five file names per area, to name the areas.

**Never goes to Haiku:**

- Paths that look secret (`.env*`, `*.pem`, `*.key`, `id_rsa*`, `id_ed25519*`, anything with `secret` or `credential` in the path). Their edits still dim the map, but they never get a card.
- Files git ignores.
- File contents beyond the edit's diff.

Scores, answers and skipped cards are stored locally in Claude Code's mod store. At most 6 cards are made an hour.

## Requirements

- Claude Code v2.1.296 or later.
- The Claude Code Desktop app or the terminal. The VS Code extension isn't supported in v1, because it doesn't draw the band above the prompt.
- A git repo.

## Sibling projects

Apprentice belongs with two other tools I build for working with AI agents. They don't overlap.

- [trustbut](https://github.com/isAlmogK/trustbut) checks that a change is actually tested.
- [Holdline](https://github.com/isAlmogK/holdline) checks that a change didn't break a business rule you approved.
- Apprentice makes sure you understand the change.

## Docs

[How it works today](docs/apprentice.md) · [Design spec](docs/superpowers/specs/2026-10-23-apprentice-design.md)

## About me

I'm Almog Koren, a software engineer in Tallinn with more than 15 years of shipping production software. I founded and built [DogBase](https://www.dogbase.co), a bootstrapped SaaS for working-dog teams that won the main pitch competition at Latitude59 2026, and before that I was co-founder and CTO of Platfarm, which was acquired. I took both companies through Techstars.

These days I mostly build AI agents and the systems around them. Apprentice came out of that work: I wanted to keep understanding the code my agents were changing in my own projects.

**I'm open to work:** full-time roles, fractional CTO work and AI agent projects. My CV and contact details are at [almog.io](https://almog.io).

## License

[Apache-2.0](LICENSE)

---

<div align="center">

Built by **Almog Koren** · [almog.io](https://almog.io) · [@isAlmogK](https://github.com/isAlmogK). If Apprentice helps you keep up with your agent, a ⭐ helps others find it, and [sponsoring](https://github.com/sponsors/isAlmogK) helps keep it going.

</div>

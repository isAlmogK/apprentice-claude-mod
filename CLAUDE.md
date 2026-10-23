# Apprentice

A Claude Code mod. Read [docs/apprentice.md](docs/apprentice.md) for how it works today.

- Only `hooks/register.ts` calls `$`. Everything in `src/` is pure and tested directly.
- Run `claude plugin test` and `claude plugin validate .` before every commit.
- Specs and plans live in `docs/superpowers/`.
- Bump `version` in `.claude-plugin/plugin.json` in every PR that changes the mod: `claude plugin update` compares versions, so without a bump nobody gets the change.

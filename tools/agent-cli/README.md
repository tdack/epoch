# agent-cli

One entry point for the lookups and commands that coding agents kept re-deriving across sessions
in this repository. Output is terse and written for an agent, not a person; every subcommand takes
`--help` and `--json`. It has no dependencies beyond Node and git, and works from any directory.

```sh
tools/agent-cli/agent-cli                 # list commands
tools/agent-cli/agent-cli <command> --help
tools/agent-cli/agent-cli <command> --json
```

| Need | Command |
| --- | --- |
| Where am I: branch, dirty files, ahead/behind `origin/main`, worktrees, remotes | `status` |
| Files this branch changed (committed, uncommitted, untracked) | `changed [base]` |
| Format and lint only the changed files, then knip | `lint` (`--full` for `npm run lint`) |
| Type check | `check` |
| Tests for what changed, named files, or everything | `test --changed`, `test <files>`, `test --all` |
| Browser tests | `e2e [spec]` |
| The full pre-push run: lint, check, vitest | `gate [--e2e]` |
| Next ADR number and its `decisions.md` row; list, show or search ADRs | `adr next \| list \| show <n> \| grep <term>` |
| Next or latest migration; show or search migration SQL | `migration next \| latest \| list \| show <n> \| grep <term>` |
| Backlog outline, search, or one section | `backlog`, `backlog <term>`, `backlog --section <name>` |
| Search the other docs, with the heading each hit sits under | `docs <term>`, `docs --outline <file>` |
| Search source, skipping tests | `find <regex> [-i] [-l] [--svelte\|--ts] [--in dir]` |
| Who imports a component or module | `uses <Name>` |
| Read a definition | `def <symbol> [-A lines]` |
| A file's exports, such as the real-D1 test helpers | `exports [file]` |
| Where each layer lives | `map [layer]` |
| Dev server: live port, `.dev.vars`, local D1, seeding | `dev`, `dev seed` |
| Claude Code memory notes for this project | `memory [name]` |
| The project rules in one screen; check a commit subject | `rules`, `commit-check "<subject>"` |
| After a push: `main` against `origin` and `cloudflare`, `cf` login, migrations not yet on origin | `remotes [--fetch]` |
| Push `main` to cloudflare (deploys) and origin | `ship` (a dry run; `ship --yes` pushes) |

`ship --yes` deploys production and runs pending migrations there. Pass it only after the user has
approved that push.

Add a subcommand when a lookup or command is repeated across sessions; keep its output to what an
agent acts on, and give it `--help` text that names what it replaces.

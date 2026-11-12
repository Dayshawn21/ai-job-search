# weworkremotely-cli

CLI for searching remote jobs on [We Work Remotely](https://weworkremotely.com) through its
public category RSS feeds, plus reading individual public job pages.

**Data source**: category RSS feeds (search) and `/remote-jobs/<slug>` pages (detail).
**Authentication**: None.
**Dependencies**: None (plain `bun` + `fetch` + regex parsing). `bun install` is optional and only pulls dev type defs.

> **Personal use only.** Keep volume low, do not use it commercially or for bulk data collection, and respect the site's Terms of Use.

## Installation

```bash
cd .agents/skills/weworkremotely-search/cli
bun install   # optional - only installs TypeScript dev types
```

## Commands

| Command | Description |
|---------|-------------|
| `search` | Filter a category feed: `--query/-q`, `--category frontend\|fullstack\|backend\|all-programming\|all`, `--jobage <days>`, `--us-only`, `--limit/-n`, `--format json\|table\|plain` |
| `detail <slug\|url>` | Full description, salary, skills and dates for one posting (`--format json\|plain`) |

Filtering is client-side because the feeds have no search parameters. Each feed holds about
the 100 most recent postings, so there is no `--page`. All errors go to **stderr** as
`{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
bun run src/cli.ts search -q "react" --category fullstack --jobage 14 --us-only --limit 5 --format table
bun run src/cli.ts detail some-company-senior-react-engineer --format plain
```

## Tests

```bash
bun run test        # bun test --timeout 30000 (parsing tests are offline; search.test.ts makes 3 live requests)
bun run typecheck   # tsc --noEmit
```

See `../url-reference.md` for the feed URLs, RSS fields and page anchors.

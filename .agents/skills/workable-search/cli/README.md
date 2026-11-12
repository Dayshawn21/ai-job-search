# workable-cli

CLI for searching jobs on Workable's public job board (`jobs.workable.com`), for any
location or remote, across any sector.

**Data source**: the board's public JSON API (`/api/v1/jobs` and `/api/v1/jobs/<id>`). The HTML `/search` pages are disallowed by `robots.txt` and are never fetched.
**Authentication**: None required.
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only pulls dev type defs.

> **Personal use only.** Keep volume low, don't use it commercially or for bulk data
> collection, and run it on your own responsibility.

## Installation

```bash
cd .agents/skills/workable-search/cli
bun install   # optional - only installs TypeScript dev types
```

## Commands

| Command | Description |
|---------|-------------|
| `search` | Search for job listings |
| `detail` | Fetch full detail for one posting (UUID, short id, or `/view/` URL) |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts `--format json|plain`.
All errors are written to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
bun run src/cli.ts search -q "react engineer" -l "United States" --remote remote --jobage 7 --format table
bun run src/cli.ts detail 747efea0-09c7-4d5a-8703-e117901d7041 --format plain
```

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | Keywords (title / skill / role). |
| `--location` | `-l` | Location text, e.g. `"United States"`, `"Houston, TX"`. |
| `--remote` | | `remote` \| `hybrid` \| `onsite`. |
| `--jobage` | | Posted within N days (server-side). |
| `--page` | | 1-indexed page (20 results/page). |
| `--limit` | `-n` | Cap results emitted. |
| `--format` | | `json` \| `table` \| `plain`. |

## Tests

```bash
bun test --timeout 30000   # offline parser/retry tests plus a small live smoke test
bun run typecheck
```

See `../SKILL.md` for the flag reference and `../url-reference.md` for the API notes.

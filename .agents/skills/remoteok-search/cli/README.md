# remoteok-cli

CLI for searching [Remote OK](https://remoteok.com)'s public JSON job feed (global,
remote-only jobs).

**Data source**: `https://remoteok.com/api`.
**Authentication**: None required. No proxy or credential.
**Dependencies**: None (plain `bun` + `fetch`). `bun install` is optional and only pulls dev type defs.

> **Personal use only.** Keep volume low, no commercial or bulk use. Per Remote OK's API
> terms, link back to the posting on remoteok.com and mention Remote OK as the source; every
> result keeps its `url` for that purpose.

## Installation

```bash
cd .agents/skills/remoteok-search/cli
bun install   # optional - only installs TypeScript dev types
```

## Commands

| Command | Description |
|---------|-------------|
| `search` | Filter the feed by keywords, age and US-friendliness |
| `detail` | Full description for one posting (id or remoteok.com URL) |

`search` accepts `--format json|table|plain` (default `json`); `detail` accepts `--format json|plain`.
Errors go to **stderr** as `{ "error": "...", "code": "..." }` with exit code `1`.

## Quick examples

```bash
bun run src/cli.ts search -q "react" --jobage 14 --us-only --limit 5 --format table
bun run src/cli.ts detail 1137704 --format plain
```

## Search flags

| Flag | Alias | Description |
|------|-------|-------------|
| `--query` | `-q` | Keywords; all must match title, company, location or tags |
| `--jobage` | | Posted within N days (client-side) |
| `--us-only` | | Keep empty/worldwide/US/North America locations, drop explicit non-US ones |
| `--limit` | `-n` | Cap results emitted |
| `--format` | | `json` \| `table` \| `plain` |

## Tests

```bash
bun test          # unit tests plus a small live smoke test
bunx tsc --noEmit # typecheck
```

See `../SKILL.md` for the full reference and `../url-reference.md` for the feed shape.

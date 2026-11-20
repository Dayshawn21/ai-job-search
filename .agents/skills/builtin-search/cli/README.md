# builtin-cli

Zero-dependency Bun CLI for Built In (builtin.com) category/remote job listings. Personal use
only; low volume; obeys robots.txt (site search is never used). See `../SKILL.md`.

```bash
bun run src/cli.ts search --remote --category dev-engineering -q react --limit 5
bun run src/cli.ts detail <url>
bun test
```

#!/usr/bin/env bun
// Self-contained CLI for listing jobs from Built In (builtin.com) category / remote
// listing pages, and reading single job pages. Zero runtime dependencies.
//
// Personal use only. Keep volume low; do not use it commercially or for bulk data
// collection. Only paths allowed by builtin.com's robots.txt are ever requested
// (site search is disallowed, so --query is a client-side filter).

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { isSlug } from "./helpers.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", n: "limit", c: "category" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith("-")) {
      const key = alias[a.replace(/^-+/, "")] ?? a.replace(/^-+/, "")
      const next = argv[i + 1]
      if (key === "remote" || next === undefined || next.startsWith("-")) {
        flags[key] = true
      } else {
        flags[key] = next
        i++
      }
    } else {
      ;(flags._ as string[]).push(a)
    }
  }
  return flags
}

const HELP = `builtin-cli - list jobs from Built In (builtin.com) category pages

USAGE
  bun run src/cli.ts search [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS
  --category, -c <slug>   Category listing, e.g. dev-engineering, data-analytics, design-ux, product.
  --subcategory <slug>    Sub-listing under a category, e.g. react (needs --category).
  --remote                Use the remote listing (/jobs/remote/...).
  --query, -q <text>      CLIENT-SIDE keyword filter (all words) over title/company/summary/skills.
  --jobage <days>         Client-side: keep postings from the last N days.
  --page <n>              1-indexed listing page (25 results/page). Default 1.
  --pages <n>             Fetch n consecutive pages starting at --page (max 5). Default 1.
  --limit, -n <n>         Cap results emitted.
  --format <fmt>          json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search --remote --category dev-engineering -q react --limit 5
  bun run src/cli.ts detail https://builtin.com/job/<slug>/<id> --format plain

Personal use only; keep volume low. Site search is disallowed by robots.txt and is never used.
`

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["category", "subcategory", "remote", "query", "jobage", "page", "pages", "limit", "format", "help", "h"]),
  detail: new Set(["format", "help", "h"]),
}

function fail(error: string, code: string): number {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
  return 1
}

function intFlag(name: string, raw: unknown, max?: number): number | null {
  const val = typeof raw === "string" ? Number(raw.trim()) : NaN
  if (!Number.isInteger(val) || val < 1 || (max !== undefined && val > max)) {
    fail(`--${name} must be a whole number of at least 1${max ? ` and at most ${max}` : ""}, got "${raw}"`, "BAD_ARG")
    return null
  }
  return val
}

async function main(): Promise<number> {
  const flags = parseFlags(process.argv.slice(2))
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }

  const known = KNOWN_FLAGS[cmd]
  if (known) {
    for (const key of Object.keys(flags)) {
      if (key === "_" || known.has(key)) continue
      return fail(`unknown flag --${key} for '${cmd}' - flags are never silently ignored; see --help`, "UNKNOWN_FLAG")
    }
  }

  if (cmd === "search") {
    if (flags.query !== undefined && (typeof flags.query !== "string" || !flags.query.trim())) {
      return fail("--query requires a non-empty value", "BAD_ARG")
    }
    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "table", "plain"].includes(fmt)) return fail(`--format must be one of json|table|plain, got "${fmt}"`, "BAD_ARG")
    if (flags.remote !== undefined && flags.remote !== true) return fail("--remote takes no value", "BAD_ARG")
    for (const name of ["category", "subcategory"] as const) {
      const v = flags[name]
      if (v !== undefined && (typeof v !== "string" || !isSlug(v))) {
        return fail(`--${name} must be a lowercase slug like dev-engineering, got "${String(v)}"`, "BAD_ARG")
      }
    }
    if (flags.subcategory !== undefined && flags.category === undefined) return fail("--subcategory requires --category", "BAD_ARG")

    let jobage: number | undefined, page = 1, pages = 1, limit: number | undefined
    if (flags.jobage !== undefined) { const v = intFlag("jobage", flags.jobage); if (v === null) return 1; jobage = v }
    if (flags.page !== undefined) { const v = intFlag("page", flags.page); if (v === null) return 1; page = v }
    if (flags.pages !== undefined) { const v = intFlag("pages", flags.pages, 5); if (v === null) return 1; pages = v }
    if (flags.limit !== undefined) { const v = intFlag("limit", flags.limit); if (v === null) return 1; limit = v }

    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query : undefined,
      category: flags.category as string | undefined,
      subcategory: flags.subcategory as string | undefined,
      remote: flags.remote === true,
      jobage,
      page,
      pages,
      limit,
      format: fmt as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = (flags._ as string[])[1]
    if (!id) return fail("detail requires an <id|url>", "NO_ID")
    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "plain"].includes(fmt)) return fail(`--format must be one of json|plain, got "${fmt}"`, "BAD_ARG")
    const opts: DetailOpts = { id, format: fmt as DetailOpts["format"] }
    return runDetail(opts)
  }

  return fail(`Unknown command "${cmd}"`, "BAD_CMD")
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    process.stderr.write(JSON.stringify({ error: e instanceof Error ? e.message : String(e), code: "INTERNAL_ERROR" }) + "\n")
    process.exit(1)
  })

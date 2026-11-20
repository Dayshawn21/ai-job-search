#!/usr/bin/env bun
// Self-contained CLI for searching remote jobs on We Work Remotely's public RSS
// feeds. No external CLI framework, so it runs anywhere `bun` is available
// with zero install beyond the repo clone.
//
// Personal use only. Keep volume low (a handful of requests), do not use it
// commercially or for bulk data collection, and respect We Work Remotely's
// Terms of Use. Run it on your own responsibility.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"
import { FEEDS } from "./helpers.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

// Boolean flags take no value, so `--us-only -q react` never swallows `-q`.
const BOOLEAN_FLAGS = new Set(["us-only", "help", "h"])

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", n: "limit" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith("-") && a.length > 1) {
      const key = alias[a.replace(/^-+/, "")] ?? a.replace(/^-+/, "")
      const next = argv[i + 1]
      if (BOOLEAN_FLAGS.has(key) || next === undefined || next.startsWith("-")) {
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

const CATEGORIES = Object.keys(FEEDS)

const HELP = `weworkremotely-cli - search remote jobs on We Work Remotely (public RSS feeds)

USAGE
  bun run src/cli.ts search [flags]
  bun run src/cli.ts detail <slug|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>      Keywords; every term must appear in title, skills or description (client-side).
  --category <name>       frontend | fullstack | backend | all-programming (default) | all
  --jobage <days>         Keep jobs posted within N days (client-side on pubDate).
  --us-only               Keep Anywhere in the World / USA / North America / empty region; drop explicit non-US regions.
  --limit, -n <n>         Cap results emitted (client-side).
  --format <fmt>          json (default) | table | plain.

EXAMPLES
  bun run src/cli.ts search -q "react" --category fullstack --jobage 14 --us-only --limit 5 --format table
  bun run src/cli.ts search --category frontend --us-only --format json
  bun run src/cli.ts detail some-company-senior-react-engineer --format plain

Each feed holds roughly the 100 most recent postings of its category; there is no pagination.
Personal use only - keep volume low.
`

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["query", "category", "jobage", "us-only", "limit", "format", "help", "h"]),
  detail: new Set(["format", "help", "h"]),
}

function fail(error: string, code: string): number {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
  return 1
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  const flags = parseFlags(argv)
  const cmd = (flags._ as string[])[0]

  if (!cmd || flags.help || flags.h) {
    process.stdout.write(HELP)
    return cmd ? 0 : 1
  }

  const knownFlags = KNOWN_FLAGS[cmd]
  if (knownFlags) {
    for (const key of Object.keys(flags)) {
      if (key === "_" || knownFlags.has(key)) continue
      return fail(
        `unknown flag --${key} for '${cmd}' - flags are never silently ignored, because a discarded filter changes what the search returns; see --help for the supported flags`,
        "UNKNOWN_FLAG",
      )
    }
  }

  const wholeNumber = (name: string, raw: string | boolean | string[]): number | null => {
    const val = typeof raw === "string" ? Number(raw.trim()) : NaN
    return Number.isInteger(val) && val >= 1 ? val : (fail(`--${name} must be a whole number of at least 1, got "${raw}"`, "BAD_ARG"), null)
  }

  if (cmd === "search") {
    if (flags.query !== undefined && (typeof flags.query !== "string" || !flags.query.trim())) {
      return fail("--query requires a non-empty value", "BAD_ARG")
    }
    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "table", "plain"].includes(fmt)) {
      return fail(`--format must be one of json|table|plain, got "${fmt}"`, "BAD_ARG")
    }
    const category = flags.category !== undefined ? flags.category : "all-programming"
    if (typeof category !== "string" || !CATEGORIES.includes(category)) {
      return fail(`--category must be one of ${CATEGORIES.join("|")}, got "${category}"`, "BAD_ARG")
    }
    let jobage: number | undefined
    if (flags.jobage !== undefined) {
      const v = wholeNumber("jobage", flags.jobage)
      if (v === null) return 1
      jobage = v
    }
    let limit: number | undefined
    if (flags.limit !== undefined) {
      const v = wholeNumber("limit", flags.limit)
      if (v === null) return 1
      limit = v
    }
    const opts: SearchOpts = {
      query: typeof flags.query === "string" ? flags.query : undefined,
      category,
      jobage,
      usOnly: flags["us-only"] === true,
      limit,
      format: fmt as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = (flags._ as string[])[1]
    if (!id) return fail("detail requires a <slug|url>", "NO_ID")
    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "plain"].includes(fmt)) {
      return fail(`--format must be one of json|plain, got "${fmt}"`, "BAD_ARG")
    }
    const opts: DetailOpts = { id, format: fmt as DetailOpts["format"] }
    return runDetail(opts)
  }

  return fail(`Unknown command "${cmd}"`, "BAD_CMD")
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    process.stderr.write(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e), code: "INTERNAL_ERROR" }) + "\n",
    )
    process.exit(1)
  })

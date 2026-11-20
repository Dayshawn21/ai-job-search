#!/usr/bin/env bun
// Self-contained CLI for searching Remote OK's public JSON job feed (global remote
// jobs). No external CLI framework, so it runs anywhere `bun` is available.
//
// Personal use only. Keep volume low, do not use it commercially or for bulk data
// collection, and credit Remote OK (link back to the job's remoteok.com url) as the
// source, as the Remote OK API terms require.

import { runSearch, type SearchOpts } from "./commands/search.js"
import { runDetail, type DetailOpts } from "./commands/detail.js"

interface Flags {
  _: string[]
  [k: string]: string | boolean | string[]
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = { _: [] }
  const alias: Record<string, string> = { q: "query", n: "limit" }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith("--") || a.startsWith("-")) {
      const key = alias[a.replace(/^-+/, "")] ?? a.replace(/^-+/, "")
      const next = argv[i + 1]
      // --us-only is a boolean switch: never let it swallow the next token.
      if (key === "us-only" || next === undefined || next.startsWith("-")) {
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

const HELP = `remoteok-cli — search Remote OK's public job feed (global remote jobs)

USAGE
  bun run src/cli.ts search [-q "<keywords>"] [flags]
  bun run src/cli.ts detail <id|url> [--format json|plain]

SEARCH FLAGS
  --query, -q <text>   Keywords; every word must appear in title, company, location or tags.
  --jobage <days>      Posted within N days (filtered client-side on the posting date).
  --us-only            Keep empty/worldwide/US/North America locations, drop explicit non-US ones.
  --limit, -n <n>      Cap results emitted.
  --format <fmt>       json (default) | table | plain.

NOTES
  The feed only lists the ~100 newest postings, so there is no --page.
  Salaries (salary_min/salary_max) are as reported by Remote OK, usually yearly USD; 0 becomes null.

EXAMPLES
  bun run src/cli.ts search -q "react" --jobage 14 --us-only --limit 5 --format table
  bun run src/cli.ts detail 1137719 --format plain

Personal use only — credit Remote OK (remoteok.com) as the source; keep volume low.
`

const KNOWN_FLAGS: Record<string, Set<string>> = {
  search: new Set(["query", "jobage", "us-only", "limit", "format", "help", "h"]),
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

  // Reject unknown flags instead of silently discarding them: a discarded filter
  // changes what the search returns with no error.
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

  if (cmd === "search") {
    if (flags.query !== undefined && (typeof flags.query !== "string" || !flags.query.trim())) {
      return fail("--query requires a non-empty value", "BAD_ARG")
    }
    const fmt = flags.format !== undefined ? String(flags.format) : "json"
    if (!["json", "table", "plain"].includes(fmt)) {
      return fail(`--format must be one of json|table|plain, got "${fmt}"`, "BAD_ARG")
    }
    const wholeNumber = (name: string, raw: string | boolean | string[]): number | null => {
      const val = typeof raw === "string" ? Number(raw.trim()) : NaN
      if (!Number.isInteger(val) || val < 1) {
        fail(`--${name} must be a whole number of at least 1, got "${raw}"`, "BAD_ARG")
        return null
      }
      return val
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
      jobage,
      usOnly: flags["us-only"] === true,
      limit,
      format: fmt as SearchOpts["format"],
    }
    return runSearch(opts)
  }

  if (cmd === "detail") {
    const id = (flags._ as string[])[1]
    if (!id) return fail("detail requires an <id|url>", "NO_ID")
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

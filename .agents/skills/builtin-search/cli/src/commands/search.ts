import {
  CliError,
  htmlFetch,
  listingPath,
  listingUrl,
  matchesQuery,
  parseJobCards,
  rememberUrls,
  stripInvisible,
  withinDays,
  writeError,
  type JobCard,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  category?: string
  subcategory?: string
  remote: boolean
  jobage?: number
  page: number
  pages: number
  limit?: number
  format: "json" | "table" | "plain"
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const cut = (s: string | null, n: number) => (s || "-").slice(0, n).padEnd(n)
  const header = `${"ID".padEnd(9)} ${"TITLE".padEnd(44)} ${"COMPANY".padEnd(24)} ${"LOCATION".padEnd(24)} ${"MODE".padEnd(18)} DATE`
  const rows = cards.map(
    (c) => `${c.id.padEnd(9)} ${cut(c.title, 44)} ${cut(c.company, 24)} ${cut(c.location, 24)} ${cut(c.workMode, 18)} ${c.date || "-"}`,
  )
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const path = listingPath(opts)
    let cards: JobCard[] = []
    const seen = new Set<string>()
    for (let p = opts.page; p < opts.page + opts.pages; p++) {
      const html = await htmlFetch(listingUrl(path, p))
      if (!html) {
        if (p === opts.page) throw new CliError(`Listing not found: ${path}`, "NOT_FOUND")
        break
      }
      const pageCards = parseJobCards(html)
      if (pageCards.length === 0) break
      for (const c of pageCards) if (!seen.has(c.id)) { seen.add(c.id); cards.push(c) }
    }
    rememberUrls(cards)

    cards = cards.filter((c) => matchesQuery(c, opts.query))
    if (opts.jobage !== undefined) cards = cards.filter((c) => withinDays(c, opts.jobage!))
    if (opts.limit !== undefined) cards = cards.slice(0, opts.limit)
    cards = stripInvisible(cards)

    if (opts.format === "table") {
      process.stdout.write(renderTable(cards) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        cards
          .map(
            (c) =>
              `${c.title}\n  ${c.company || "-"} | ${c.location || "-"} | ${c.workMode || "-"} | ${c.date || "-"}${c.salary ? ` | ${c.salary}` : ""}\n  id: ${c.id}\n  ${c.url}`,
          )
          .join("\n\n") + "\n",
      )
    } else {
      process.stdout.write(JSON.stringify({ meta: { count: cards.length, page: opts.page }, results: cards }, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), e instanceof CliError ? e.code : "SEARCH_FAILED")
    return 1
  }
}

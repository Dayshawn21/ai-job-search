import {
  BASE_URL,
  FEEDS,
  isUsEligible,
  matchesQuery,
  parseRss,
  stripInvisible,
  textFetch,
  withinDays,
  writeError,
  type JobCard,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  category: string
  jobage?: number
  usOnly: boolean
  limit?: number
  format: "json" | "table" | "plain"
}

function renderTable(cards: Omit<JobCard, "description">[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const title = (c.title || "").slice(0, 44).padEnd(44)
    const company = (c.company || "-").slice(0, 24).padEnd(24)
    const loc = (c.location || "-").slice(0, 22).padEnd(22)
    return `${(c.date || "-").padEnd(10)} ${title} ${company} ${loc} ${c.id}`
  })
  const header =
    "DATE".padEnd(10) + " " + "TITLE".padEnd(44) + " " + "COMPANY".padEnd(24) + " " + "LOCATION".padEnd(22) + " ID"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const xml = await textFetch(BASE_URL + FEEDS[opts.category])
    if (!xml) {
      writeError(`Feed not found for category "${opts.category}"`, "NOT_FOUND")
      return 1
    }
    const all = stripInvisible(parseRss(xml))
    let jobs = all
    if (opts.query) jobs = jobs.filter((j) => matchesQuery(j, opts.query!))
    if (opts.jobage !== undefined) jobs = jobs.filter((j) => withinDays(j.date, opts.jobage!))
    if (opts.usOnly) jobs = jobs.filter((j) => isUsEligible(j.location, j.countries))
    const matched = jobs.length
    if (opts.limit !== undefined) jobs = jobs.slice(0, opts.limit)
    // Descriptions are full posting text: leave them to `detail`, keep search output compact.
    const cards = jobs.map(({ description: _d, ...rest }) => rest)

    if (opts.format === "table") {
      process.stdout.write(renderTable(cards) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        cards
          .map((c) => `${c.title}\n  ${c.company || "-"} | ${c.location || "-"} | ${c.date || "-"}\n  id: ${c.id}\n  ${c.url}`)
          .join("\n\n") + "\n",
      )
    } else {
      process.stdout.write(
        JSON.stringify(
          {
            meta: {
              count: cards.length,
              matched,
              feedItems: all.length,
              category: opts.category,
              source: BASE_URL + FEEDS[opts.category],
            },
            results: cards,
          },
          null,
          2,
        ) + "\n",
      )
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}

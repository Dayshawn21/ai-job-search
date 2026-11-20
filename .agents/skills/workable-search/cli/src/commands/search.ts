import {
  API_URL,
  jsonFetch,
  parseSearchResponse,
  stripInvisible,
  workplaceParam,
  writeError,
  type JobCard,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  location?: string
  jobage?: number
  remote?: string // "remote" | "hybrid" | "onsite"
  page: number
  limit?: number
  format: "json" | "table" | "plain"
}

export function buildUrl(opts: SearchOpts, pageToken?: string): string {
  const params = new URLSearchParams()
  if (opts.query) params.set("query", opts.query)
  if (opts.location) params.set("location", opts.location)
  const wp = workplaceParam(opts.remote)
  if (wp) params.set("workplace", wp)
  if (opts.jobage) params.set("day_range", String(opts.jobage))
  if (pageToken) params.set("pageToken", pageToken)
  return `${API_URL}?${params.toString()}`
}

function renderTable(cards: JobCard[]): string {
  if (cards.length === 0) return "No results."
  const rows = cards.map((c) => {
    const title = (c.title || "").slice(0, 40).padEnd(40)
    const company = (c.company || "-").slice(0, 24).padEnd(24)
    const loc = (c.location || "-").slice(0, 24).padEnd(24)
    const wp = (c.workplace || "-").padEnd(7)
    return `${c.id.slice(0, 8)} ${title} ${company} ${loc} ${wp} ${c.date || "-"}`
  })
  const header = `${"ID".padEnd(8)} ${"TITLE".padEnd(40)} ${"COMPANY".padEnd(24)} ${"LOCATION".padEnd(24)} ${"WORK".padEnd(7)} DATE`
  return [header, "-".repeat(header.length), ...rows, "", "(ID shown truncated; use --format json for full ids)"].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    // The API pages with an opaque nextPageToken, so page N is reached by
    // walking N-1 tokens (20 results per page).
    let token: string | undefined
    let parsed = parseSearchResponse(await jsonFetch(buildUrl(opts)))
    const total = parsed.total
    for (let p = 2; p <= opts.page; p++) {
      if (!parsed.nextPageToken) {
        parsed = { cards: [], total, nextPageToken: null }
        break
      }
      token = parsed.nextPageToken
      parsed = parseSearchResponse(await jsonFetch(buildUrl(opts, token)))
    }

    let cards = stripInvisible(parsed.cards)
    if (opts.limit !== undefined && opts.limit >= 0) cards = cards.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(cards) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        cards
          .map(
            (c) =>
              `${c.title}\n  ${c.company || "-"} | ${c.location || "-"} | ${c.workplace || "-"} | ${c.date || "-"}${c.salary ? ` | ${c.salary}` : ""}\n  id: ${c.id}\n  ${c.url}`,
          )
          .join("\n\n") + "\n",
      )
    } else {
      process.stdout.write(
        JSON.stringify({ meta: { count: cards.length, page: opts.page, total }, results: cards }, null, 2) + "\n",
      )
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "SEARCH_FAILED")
    return 1
  }
}

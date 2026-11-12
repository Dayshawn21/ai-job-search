import {
  fetchFeed,
  isUsLocation,
  matchesQuery,
  stripInvisible,
  toJob,
  withinDays,
  writeError,
  type Job,
} from "../helpers.js"

export interface SearchOpts {
  query?: string
  jobage?: number // days; undefined = no age filter
  usOnly?: boolean
  limit?: number
  format: "json" | "table" | "plain"
}

function money(j: Job): string {
  if (j.salary_min === null && j.salary_max === null) return "—"
  return `${j.salary_min ?? "?"}-${j.salary_max ?? "?"}`
}

function renderTable(jobs: Job[]): string {
  if (jobs.length === 0) return "No results."
  const rows = jobs.map((c) => {
    const title = (c.title || "").slice(0, 42).padEnd(42)
    const company = (c.company || "—").slice(0, 24).padEnd(24)
    const loc = (c.location || "—").slice(0, 22).padEnd(22)
    return `${c.id.padEnd(8)} ${title} ${company} ${loc} ${(c.date || "—").padEnd(10)} ${money(c)}`
  })
  const header =
    "ID".padEnd(8) + " " + "TITLE".padEnd(42) + " " + "COMPANY".padEnd(24) + " " + "LOCATION".padEnd(22) + " " + "DATE".padEnd(10) + " SALARY"
  return [header, "-".repeat(header.length), ...rows].join("\n")
}

export async function runSearch(opts: SearchOpts): Promise<number> {
  try {
    const raw = await fetchFeed()
    const fetched = raw.length
    let jobs = raw.map((r) => toJob(r)).filter((j): j is Job => j !== null)
    jobs = stripInvisible(jobs)
    jobs = jobs.filter((j) => matchesQuery(j, opts.query))
    if (opts.jobage !== undefined) jobs = jobs.filter((j) => withinDays(j.date, opts.jobage!))
    if (opts.usOnly) jobs = jobs.filter((j) => isUsLocation(j.location))
    const matched = jobs.length
    if (opts.limit !== undefined && opts.limit >= 0) jobs = jobs.slice(0, opts.limit)

    if (opts.format === "table") {
      process.stdout.write(renderTable(jobs) + "\n")
    } else if (opts.format === "plain") {
      process.stdout.write(
        jobs
          .map(
            (c) =>
              `${c.title}\n  ${c.company || "—"} · ${c.location || "—"} · ${c.date || "—"} · salary ${money(c)}\n  id: ${c.id}\n  ${c.url}`,
          )
          .join("\n\n") + "\n",
      )
    } else {
      process.stdout.write(
        JSON.stringify(
          {
            meta: {
              count: jobs.length,
              matched,
              fetched,
              page: 1,
              source: "Remote OK (https://remoteok.com)",
            },
            results: jobs,
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

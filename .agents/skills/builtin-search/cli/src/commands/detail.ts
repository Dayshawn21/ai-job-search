import { BASE_URL, CliError, htmlFetch, lookupUrl, parseJobDetail, stripInvisible, writeError } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

const BUILTIN_HOST = /(^|\.)builtin\.com$/i

/**
 * Resolve the input to a canonical job URL.
 * Accepts a builtin.com /job/<slug>/<id> URL (any scheme/www), a "<slug>/<id>" or
 * "<slug>-<id>"-free path, or a bare numeric id previously returned by `search`
 * (job pages need the slug, so ids are resolved from the local search cache).
 * URLs on any other host are rejected.
 */
export function resolveJobUrl(input: string, lookup: (id: string) => string | null = lookupUrl): string | null {
  const t = input.trim()
  if (/^\d{5,}$/.test(t)) return lookup(t)
  const hasScheme = /^https?:\/\//i.test(t)
  let candidate = t
  if (!hasScheme) {
    if (t.startsWith("/job/")) candidate = BASE_URL + t
    else if (/^[a-z0-9.-]+\.[a-z]{2,}\//i.test(t)) candidate = "https://" + t
    else if (/^[a-z0-9-]+\/\d{5,}$/i.test(t)) candidate = `${BASE_URL}/job/${t}`
    else return null
  }
  let u: URL
  try {
    u = new URL(candidate)
  } catch {
    return null
  }
  if (!BUILTIN_HOST.test(u.hostname)) return null
  const m = u.pathname.match(/^\/job\/([a-z0-9-]+)\/(\d{5,})\/?$/i)
  return m ? `${BASE_URL}/job/${m[1]}/${m[2]}` : null
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const url = resolveJobUrl(opts.id)
  if (!url) {
    const bare = /^\d{5,}$/.test(opts.id.trim())
    writeError(
      bare
        ? `Job id ${opts.id} is not in the local search cache; run a search that returns it first, or pass the full builtin.com/job/<slug>/<id> URL`
        : `Could not parse a builtin.com job URL or id from "${opts.id}"`,
      bare ? "UNKNOWN_ID" : "BAD_ID",
    )
    return 1
  }
  try {
    const html = await htmlFetch(url)
    if (!html) {
      writeError("Job not found (it may have been taken down)", "NOT_FOUND")
      return 1
    }
    const job = stripInvisible(parseJobDetail(html, url))
    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "-"} | ${job.location || "-"}${job.remote ? " | Remote" : ""}`,
        job.salary ? `Salary: ${job.salary}` : "",
        job.employmentType ? `Employment: ${job.employmentType}` : "",
        job.date ? `Posted: ${job.date}` : "",
        "",
        job.description || "(no description)",
        "",
        `URL: ${job.url}`,
      ].filter((l, i) => l !== "" || i > 3)
      process.stdout.write(lines.join("\n") + "\n")
    } else {
      process.stdout.write(JSON.stringify(job, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), e instanceof CliError ? e.code : "DETAIL_FAILED")
    return 1
  }
}

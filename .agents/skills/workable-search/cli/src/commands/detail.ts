import { API_URL, jsonFetch, parseJobDetail, stripInvisible, writeError } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

const WORKABLE_HOST = /(^|\.)jobs\.workable\.com$/i
const ID_RE = /^[A-Za-z0-9]{12,40}$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Accept a job id (UUID from `search`, or the short id in a public link), or a
 * jobs.workable.com/view/<id>[/slug] URL. A URL on any other host is rejected
 * (look-alike hosts and userinfo tricks included, via real URL parsing), so an
 * apply link on another site is never looked up as if it were a Workable id.
 */
export function normalizeId(input: string): string | null {
  const trimmed = input.trim()
  if (ID_RE.test(trimmed)) return trimmed

  const hasScheme = /^https?:\/\//i.test(trimmed)
  if (hasScheme || /^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(trimmed)) {
    let parsed: URL
    try {
      parsed = new URL(hasScheme ? trimmed : `https://${trimmed}`)
    } catch {
      return null
    }
    if (!WORKABLE_HOST.test(parsed.hostname)) return null
    const m = parsed.pathname.match(/^\/view\/([A-Za-z0-9-]{12,40})(?:\/[^/]*)?\/?$/)
    return m && ID_RE.test(m[1]) ? m[1] : null
  }
  return null
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(`Could not parse a Workable job id from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    const body = await jsonFetch(`${API_URL}/${encodeURIComponent(id)}`)
    if (body === null) {
      writeError("Job not found", "NOT_FOUND")
      return 1
    }
    const parsed = parseJobDetail(body)
    if (!parsed) {
      writeError("Unexpected response shape for job", "DETAIL_FAILED")
      return 1
    }
    const job = stripInvisible(parsed)

    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "-"} | ${job.location || "-"}`,
        job.workplace ? `Workplace: ${job.workplace}` : "",
        job.employmentType ? `Employment: ${job.employmentType}` : "",
        job.department ? `Department: ${job.department}` : "",
        job.salary ? `Salary: ${job.salary}` : "",
        job.date ? `Posted: ${job.date}` : "",
        `Status: ${job.isActive ? "ACTIVE" : `CLOSED / ${job.state ?? "UNKNOWN"}`}`,
        "",
        job.description || "(no description)",
        job.requirements ? `\nRequirements\n${job.requirements}` : "",
        job.benefits ? `\nBenefits\n${job.benefits}` : "",
        "",
        `URL: ${job.url}`,
        job.applyUrl ? `Apply: ${job.applyUrl}` : "",
      ].filter((l) => l !== "")
      process.stdout.write(lines.join("\n") + "\n")
    } else {
      process.stdout.write(JSON.stringify(job, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}

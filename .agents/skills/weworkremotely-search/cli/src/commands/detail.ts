import { BASE_URL, parseJobDetail, stripInvisible, textFetch, writeError } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

const WWR_HOST = /(^|\.)weworkremotely\.com$/i

/**
 * Accept a bare job slug ("acme-senior-react-engineer") or a weworkremotely.com
 * job URL (/remote-jobs/<slug> or /listings/<slug>, with or without scheme).
 * A URL on any other host is rejected, so a posting's own apply link cannot
 * make the CLI fetch or mis-attribute something else. Host is read through
 * real URL parsing, so look-alike hosts (weworkremotely.com.evil.io) fail.
 */
export function normalizeId(input: string): string | null {
  const trimmed = input.trim()
  const hasScheme = /^https?:\/\//i.test(trimmed)
  if (hasScheme || /^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(trimmed)) {
    let parsed: URL
    try {
      parsed = new URL(hasScheme ? trimmed : `https://${trimmed}`)
    } catch {
      return null
    }
    if (!WWR_HOST.test(parsed.hostname)) return null
    const m = parsed.pathname.match(/^\/(?:remote-jobs|listings)\/([a-z0-9][a-z0-9-]*)\/?$/i)
    return m ? m[1] : null
  }
  return /^[a-z0-9][a-z0-9-]*$/i.test(trimmed) ? trimmed : null
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(`Could not parse a We Work Remotely job slug or URL from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    const html = await textFetch(`${BASE_URL}/remote-jobs/${id}`)
    if (!html) {
      writeError("Job not found", "NOT_FOUND")
      return 1
    }
    // An unknown slug returns the site's generic search page with HTTP 200, not a 404.
    if (!/lis-container__header__hero__company-info__title/.test(html)) {
      writeError("Job not found", "NOT_FOUND")
      return 1
    }
    const job = stripInvisible(parseJobDetail(html, id))

    if (opts.format === "plain") {
      const lines = [
        job.title,
        `${job.company || "-"} | ${job.location || "-"}`,
        "",
        job.date ? `Posted: ${job.date}` : "",
        job.expires ? `Apply before: ${job.expires}` : "",
        job.salary ? `Salary: ${job.salary}` : "",
        job.jobType ? `Type: ${job.jobType}` : "",
        job.category ? `Category: ${job.category}` : "",
        job.skills.length ? `Skills: ${job.skills.join(", ")}` : "",
        `Status: ${job.isActive ? "ACTIVE (not past its expiry date)" : "EXPIRED"}`,
        "",
        job.description || "(no description)",
        "",
        `URL: ${job.url}`,
      ].filter((l, i, a) => l !== "" || (a[i - 1] !== "" && i > 0))
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

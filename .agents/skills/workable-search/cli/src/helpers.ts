// Data source: Workable's public job-board JSON API (jobs.workable.com/api/v1/jobs).
// No authentication required. We deliberately do NOT touch the HTML /search pages,
// which robots.txt disallows. Plain fetch + JSON, zero runtime dependencies.

export const API_URL = "https://jobs.workable.com/api/v1/jobs"
export const VIEW_URL = "https://jobs.workable.com/view"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; workable-search-cli/1.0)"

/** Fetch JSON with exponential backoff on 429/5xx. Returns null on a 404. */
export async function jsonFetch(url: string): Promise<unknown | null> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json", "Accept-Language": "en-US,en;q=0.9" },
      redirect: "follow",
      signal: AbortSignal.timeout(15000),
    })
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) {
        throw new Error(`Request failed: ${response.status} ${response.statusText}`)
      }
      const jitter = Math.floor(Math.random() * 500)
      await new Promise((r) => setTimeout(r, delay + jitter))
      delay = Math.min(delay * 2, 8000)
      continue
    }
    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }
    try {
      return await response.json()
    } catch {
      throw new Error("Response was not valid JSON")
    }
  }
  throw new Error("Request failed after max retries")
}

export interface JobCard {
  id: string
  title: string
  company: string | null
  location: string | null
  workplace: string | null
  employmentType: string | null
  department: string | null
  date: string | null
  updated: string | null
  salary: string | null
  url: string
  canonicalUrl: string | null
}

export interface JobDetail extends JobCard {
  companyUrl: string | null
  companyWebsite: string | null
  applyUrl: string | null
  description: string | null
  requirements: string | null
  benefits: string | null
  state: string | null
  isActive: boolean
}

function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => numericEntity(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => numericEntity(parseInt(hex, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
}

/**
 * Characters a reader of the posting never sees but a model reading this
 * output does: C0/C1 controls other than tab/newline/CR, soft hyphen, bidi
 * marks and overrides, zero-width characters, BOM, variation selectors and
 * Unicode tag characters. Listing text is third-party data.
 */
const INVISIBLE_CHARS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F­؜᠎​-‏‪-‮⁠-⁯︀-️﻿\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu

/** Strip INVISIBLE_CHARS from every string in a result, recursively: the CLI's output boundary. */
export function stripInvisible<T>(value: T): T {
  if (typeof value === "string") return value.replace(INVISIBLE_CHARS, "") as T
  if (Array.isArray(value)) return value.map(stripInvisible) as T
  if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripInvisible(v)])) as T
  }
  return value
}

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"])

/** Whether an opening tag's attributes keep it from rendering: `hidden`, or an inline style that hides it. */
function isHiddenTag(attrs: string): boolean {
  for (const m of attrs.matchAll(/([^\s"'=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    const name = m[1].toLowerCase()
    const value = m[2] ?? m[3] ?? m[4] ?? ""
    if (name === "hidden") return true
    if (name === "style" && /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|mso-hide\s*:\s*all)\b/i.test(value)) {
      return true
    }
  }
  return false
}

/** Drop markup a browser never renders (comments, script/style/template, hidden elements) before tags are stripped. */
export function visibleHtml(html: string): string {
  const src = html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/<(script|style|template)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, "")
  const open = /<([a-zA-Z][a-zA-Z0-9-]*)(\s[^>]*)?>/g
  const kept: string[] = []
  let from = 0
  let m: RegExpExecArray | null
  while ((m = open.exec(src)) !== null) {
    if (!m[2] || !isHiddenTag(m[2])) continue
    const tag = m[1].toLowerCase()
    let end = open.lastIndex
    if (!VOID_TAGS.has(tag) && !m[0].endsWith("/>")) {
      const same = new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi")
      same.lastIndex = end
      end = src.length
      let depth = 1
      let s: RegExpExecArray | null
      while ((s = same.exec(src)) !== null) {
        if (s[1]) depth--
        else if (!s[0].endsWith("/>")) depth++
        if (depth === 0) {
          end = same.lastIndex
          break
        }
      }
    }
    kept.push(src.slice(from, m.index))
    from = end
    open.lastIndex = end
  }
  kept.push(src.slice(from))
  return kept.join("")
}

function clean(html: string): string {
  return decodeHtmlEntities(visibleHtml(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim())
}

/** Convert a description HTML fragment to readable text, keeping paragraph and list breaks. */
export function htmlToText(html: string | null | undefined): string | null {
  if (!html) return null
  const withBreaks = visibleHtml(html)
    .replace(/\s+/g, " ")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/(p|ul|ol|div|h\d)>/gi, "\n")
  const text = withBreaks.split("\n").map(clean).join("\n").replace(/\n{3,}/g, "\n\n").trim()
  return text || null
}

type Obj = Record<string, unknown>
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null)

/** ISO timestamp -> YYYY-MM-DD, or null when missing/unparseable. */
export function toDate(v: unknown): string | null {
  const s = str(v)
  if (!s) return null
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : null
}

function locationText(job: Obj): string | null {
  const loc = job.location as Obj | undefined
  if (loc && typeof loc === "object") {
    const parts = [str(loc.city), str(loc.subregion), str(loc.countryName)].filter(Boolean) as string[]
    if (parts.length) return parts.join(", ")
  }
  const locs = Array.isArray(job.locations)
    ? (job.locations as unknown[]).map(str).filter((l) => l && l !== "TELECOMMUTE")
    : []
  return locs.length ? (locs[0] as string) : null
}

function salaryText(job: Obj): string | null {
  const from = typeof job.salaryFrom === "number" ? job.salaryFrom : null
  const to = typeof job.salaryTo === "number" ? job.salaryTo : null
  if (from === null && to === null) return null
  const cur = str(job.salaryCurrencyIsoCode) ?? ""
  const freq = str(job.salaryFrequency)
  const nf = (n: number) => n.toLocaleString("en-US")
  const range = from !== null && to !== null && from !== to ? `${nf(from)}-${nf(to)}` : nf((from ?? to) as number)
  return [range, cur].filter(Boolean).join(" ") + (freq ? ` per ${freq}` : "")
}

/** Map one API job object to the portal-contract card. Returns null when it has no usable id/title. */
export function parseJob(raw: unknown): JobCard | null {
  if (!raw || typeof raw !== "object") return null
  const job = raw as Obj
  const id = str(job.id)
  const title = str(job.title)
  if (!id || !title) return null
  const company = job.company as Obj | undefined
  const workplaceRaw = str(job.workplace)
  return {
    id,
    title,
    company: company && typeof company === "object" ? str(company.title) : null,
    location: locationText(job),
    workplace: workplaceRaw ? workplaceRaw.replace("_", "-") : null,
    employmentType: str(job.employmentType),
    department: str(job.department),
    date: toDate(job.created),
    updated: toDate(job.updated),
    salary: salaryText(job),
    url: `${VIEW_URL}/${id}`,
    canonicalUrl: str(job.url),
  }
}

export function parseSearchResponse(body: unknown): {
  cards: JobCard[]
  total: number | null
  nextPageToken: string | null
} {
  const b = (body && typeof body === "object" ? body : {}) as Obj
  const jobs = Array.isArray(b.jobs) ? b.jobs : []
  const cards: JobCard[] = []
  for (const j of jobs) {
    const card = parseJob(j) // one malformed job never breaks the rest
    if (card) cards.push(card)
  }
  return {
    cards,
    total: typeof b.totalSize === "number" ? b.totalSize : null,
    nextPageToken: str(b.nextPageToken),
  }
}

export function parseJobDetail(body: unknown): JobDetail | null {
  const card = parseJob(body)
  if (!card) return null
  const job = body as Obj
  const company = (job.company && typeof job.company === "object" ? job.company : {}) as Obj
  const state = str(job.state)
  return {
    ...card,
    companyUrl: str(company.url),
    companyWebsite: str(company.website),
    applyUrl: str(job.linkoutUrl),
    description: htmlToText(str(job.description)),
    requirements: htmlToText(str(job.requirementsSection)),
    benefits: htmlToText(str(job.benefitsSection)),
    state,
    isActive: state === null || state === "published",
  }
}

/** Workplace filter value for the API, or null for an unknown mode. */
export function workplaceParam(mode: string | undefined): string | null {
  switch ((mode || "").toLowerCase()) {
    case "remote":
      return "remote"
    case "hybrid":
      return "hybrid"
    case "onsite":
    case "on-site":
    case "on_site":
      return "on_site"
    default:
      return null
  }
}

// Data source: We Work Remotely public category RSS feeds (search) and public
// individual job pages (detail). No authentication required. RSS is parsed
// with regex (the feed is flat, regular XML); no XML library is needed.

export const BASE_URL = "https://weworkremotely.com"

/** Category name -> public RSS feed path. */
export const FEEDS: Record<string, string> = {
  frontend: "/categories/remote-front-end-programming-jobs.rss",
  fullstack: "/categories/remote-full-stack-programming-jobs.rss",
  backend: "/categories/remote-back-end-programming-jobs.rss",
  "all-programming": "/categories/remote-programming-jobs.rss",
  all: "/remote-jobs.rss",
}

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; weworkremotely-cli/1.0)"

/** Fetch text with exponential backoff on 429/5xx. Returns "" on a 404. */
export async function textFetch(url: string): Promise<string> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/rss+xml,application/xml,text/html;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(30000),
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
    if (response.status === 404) return ""
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }
    return response.text()
  }
  throw new Error("Request failed after max retries")
}

export interface JobCard {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string
  category: string | null
  jobType: string | null
  skills: string[]
  countries: string[]
  expires: string | null
  description: string | null
}

export interface JobDetail {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string
  category: string | null
  jobType: string | null
  skills: string[]
  expires: string | null
  salary: string | null
  description: string | null
  isActive: boolean
}

/**
 * Extract the inner HTML of a <div> identified by a CSS class name, correctly
 * handling nested <div> elements by tracking tag depth.
 */
export function extractDivContent(html: string, className: string): string | null {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const openRe = new RegExp(`<div[^>]*class="[^"]*${escaped}[^"]*"[^>]*>`, 'i')
  const open = openRe.exec(html)
  if (!open) return null

  let i = open.index + open[0].length
  let depth = 1

  while (depth > 0 && i < html.length) {
    const nextOpen = html.indexOf('<div', i)
    const nextClose = html.indexOf('</div>', i)

    if (nextClose === -1) return null

    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth++
      i = nextOpen + 4
    } else {
      depth--
      i = nextClose + 6
    }
  }

  return html.slice(open.index + open[0].length, i - 6)
}

/**
 * Convert a Unicode code point to a string. Uses `fromCodePoint` (not
 * `fromCharCode`) so supplementary-plane code points (e.g. emoji, U+1F600)
 * decode correctly, and drops out-of-range values instead of throwing.
 */
function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    // Numeric character references: decimal (&#233;) and hexadecimal (&#xE9;).
    .replace(/&#(\d+);/g, (_, dec) => numericEntity(parseInt(dec, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, hex) => numericEntity(parseInt(hex, 16)))
    .replace(/&nbsp;/g, " ")
}

/**
 * Characters a reader of the posting never sees but a model reading this
 * output does: C0/C1 controls other than tab, newline and carriage return, the
 * soft hyphen, bidi marks/embeddings/overrides/isolates, zero-width characters
 * and invisible operators, the BOM, variation selectors, and Unicode tag
 * characters (U+E0000-E007F), which can spell out a whole hidden instruction.
 * Listing text is third-party data, and these arrive raw in a portal's JSON or
 * markup as easily as through a numeric entity.
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

/**
 * Drop markup a browser never renders - comments (including Word's
 * conditional ones), <script>/<style>/<template> blocks, and elements marked
 * hidden - before tags are stripped. A plain tag strip keeps their text, which
 * hands the model words the posting's reader never saw. CSS-only tricks
 * (off-screen, zero font size) need a renderer and are not caught here.
 */
export function visibleHtml(html: string): string {
  const src = html
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/<(script|style|template)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, "")
  // One pass, collecting what is kept: slicing the string per hidden element
  // would make a page full of them quadratic.
  const open = /<([a-zA-Z][a-zA-Z0-9-]*)(\s[^>]*)?>/g
  const kept: string[] = []
  let from = 0
  let m: RegExpExecArray | null
  while ((m = open.exec(src)) !== null) {
    if (!m[2] || !isHiddenTag(m[2])) continue
    const tag = m[1].toLowerCase()
    let end = open.lastIndex
    if (!VOID_TAGS.has(tag) && !m[0].endsWith("/>")) {
      // Skip to the matching close tag, counting nested same-name elements. An
      // unclosed hidden element runs to the end: failing closed drops visible
      // text, failing open would leak the hidden text.
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

function stripTags(html: string): string {
  return visibleHtml(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
}

function clean(html: string): string {
  return decodeHtmlEntities(stripTags(html))
}

/** Unwrap a CDATA section if present, else return the raw text. */
function xmlText(raw: string): string {
  const m = raw.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/)
  return m ? m[1] : raw
}

/** Text of the first <tag>...</tag> inside an RSS <item> chunk (XML entities decoded once). */
function tagText(chunk: string, tag: string): string | null {
  const m = chunk.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"))
  if (!m) return null
  const v = decodeHtmlEntities(xmlText(m[1])).trim()
  return v || null
}

/** Convert an RFC 822 / "YYYY-MM-DD HH:MM:SS UTC" timestamp to YYYY-MM-DD (UTC), or null. */
export function toIsoDate(raw: string | null): string | null {
  if (!raw) return null
  const t = Date.parse(raw.replace(/\s+UTC$/, " +0000"))
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10)
}

/** The job slug (our id) from a weworkremotely job URL. */
export function slugFromUrl(url: string): string | null {
  const m = url.match(/\/(?:remote-jobs|listings)\/([^/?#]+)/i)
  return m ? m[1] : null
}

/** Remove flag emoji (regional-indicator pairs) from a country list entry. */
function stripFlags(s: string): string {
  return s.replace(/[\u{1F1E6}-\u{1F1FF}]/gu, "").replace(/\s+/g, " ").trim()
}

/** Split the <country> list ("flag Canada, flag Mexico, and flag USA") into names. */
function parseCountries(raw: string | null): string[] {
  if (!raw) return []
  return raw
    .split(/,\s*(?:and\s+)?|\s+and\s+(?=[\u{1F1E6}-\u{1F1FF}])/u)
    .map(stripFlags)
    .filter(Boolean)
}

/** Render escaped/real HTML as readable text with paragraph and list breaks preserved. */
export function htmlToText(html: string): string {
  const withBreaks = visibleHtml(html)
    .replace(/\s+/g, " ")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(p|ul|ol|div|h\d|li)>/gi, "\n")
  return withBreaks.split("\n").map(clean).join("\n").replace(/\n{3,}/g, "\n\n").trim()
}

/**
 * Parse an RSS feed into job cards. Splits on <item> and parses each chunk
 * independently so one malformed item cannot break the rest. Items with no
 * usable link or title are skipped.
 */
export function parseRss(xml: string): JobCard[] {
  const results: JobCard[] = []
  const chunks = xml.split(/<item>/i).slice(1)
  for (const raw of chunks) {
    const chunk = raw.split(/<\/item>/i)[0]
    const url = tagText(chunk, "link") ?? tagText(chunk, "guid")
    const rawTitle = tagText(chunk, "title")
    if (!url || !rawTitle) continue
    const id = slugFromUrl(url)
    if (!id) continue

    // Title is "Company: Job Title"; split on the first ": ".
    const sep = rawTitle.indexOf(": ")
    const company = sep > 0 ? clean(rawTitle.slice(0, sep)) || null : null
    const title = clean(sep > 0 ? rawTitle.slice(sep + 2) : rawTitle)
    if (!title) continue

    const region = tagText(chunk, "region")
    const state = tagText(chunk, "state")
    const location = clean([region, state].filter(Boolean).join(", ")) || null
    const skills = (tagText(chunk, "skills") ?? "")
      .split(/,\s*(?:and\s+)?|\s+and\s+/)
      .map((s) => clean(s))
      .filter(Boolean)
    // The description is entity-escaped HTML: tagText decoded it once, so it is real HTML here.
    const descRaw = tagText(chunk, "description")

    results.push({
      id,
      title,
      company,
      location,
      date: toIsoDate(tagText(chunk, "pubDate")),
      url: `${BASE_URL}/remote-jobs/${id}`,
      category: tagText(chunk, "category"),
      jobType: tagText(chunk, "type"),
      skills,
      countries: parseCountries(tagText(chunk, "country")),
      expires: toIsoDate(tagText(chunk, "expires_at")),
      description: descRaw ? htmlToText(descRaw) || null : null,
    })
  }
  return results
}

/**
 * Whether a job's region is acceptable for a US-based candidate: Anywhere in
 * the World, USA, North America, Americas, or empty. An explicit non-US region
 * (Asia, EMEA, Europe, Canada, ...) is dropped. When WWR also lists eligible
 * countries, the United States must be among them.
 */
export function isUsEligible(location: string | null, countries: string[] = []): boolean {
  if (countries.length > 0 && !countries.some((c) => /^(united states|usa$|us$)/i.test(c))) return false
  if (!location) return true
  const loc = location.toLowerCase()
  if (/\bcanada\b/.test(loc) && !/\b(usa|united states|north america)\b/.test(loc)) return false
  return /anywhere|worldwide|\bglobal\b|\busa\b|united states|north america|\bamericas\b|\bus\b/.test(loc)
}

/** Client-side keyword match: every whitespace-separated term must appear in title, skills or description. */
export function matchesQuery(job: Pick<JobCard, "title" | "description" | "skills">, query: string): boolean {
  const hay = `${job.title}\n${job.skills.join(" ")}\n${job.description ?? ""}`.toLowerCase()
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  return terms.every((t) => hay.includes(t))
}

/** Whether a YYYY-MM-DD date falls within the last N days (day precision, UTC). */
export function withinDays(date: string | null, days: number, now: number = Date.now()): boolean {
  if (!date) return false
  const t = Date.parse(date + "T00:00:00Z")
  if (Number.isNaN(t)) return false
  return now - t <= (days + 1) * 86400000
}

function extractListAfter(html: string, className: string): string {
  const i = html.indexOf(`class="${className}"`)
  if (i === -1) return ""
  const end = html.indexOf("</ul>", i)
  return end === -1 ? "" : html.slice(i, end)
}

/** Parse the single-job detail page (public HTML). */
export function parseJobDetail(html: string, id: string): JobDetail {
  const h1 = html.match(/<h1[^>]*lis-container__header__hero__company-info__title[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
  const pageTitle = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]
  const title = h1
    ? clean(h1)
    : pageTitle
      ? clean(pageTitle).replace(/^Remote\s+/, "").replace(/\s+at\s+[^]*$/, "")
      : ""

  const companyH3 = html.match(
    /lis-container__job__sidebar__companyDetails__info__title"[^>]*>\s*<h3[^>]*>([\s\S]*?)<\/h3>/i,
  )?.[1]
  const ldOrg = html.match(/"hiringOrganization"[\s\S]*?"name"\s*:\s*"([^"]*)"/)?.[1]
  const company = (companyH3 ? clean(companyH3) : ldOrg ? clean(ldOrg) : "") || null

  const descHtml = extractDivContent(html, "lis-container__job__content__description")
  const description = descHtml ? htmlToText(descHtml) || null : null

  // Sidebar "About the job" items: a label followed by plain text or chip values.
  const chips: Record<string, string[]> = {}
  const aboutList = extractListAfter(html, "lis-container__job__sidebar__job-about__list")
  for (const m of aboutList.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
    const body = m[1]
    const label = clean(body.split(/<(?:span|a|div)\b/i)[0]).toLowerCase()
    if (!label) continue
    chips[label] = [...body.matchAll(/<span class="box[^"]*"[^>]*>([\s\S]*?)<\/span>/gi)]
      .map((c) => stripFlags(clean(c[1])))
      .filter(Boolean)
  }
  // Region ("Anywhere in the World", "USA Only") is absent when the job is geo-locked to listed countries.
  const location = chips["region"]?.join(", ") || chips["country"]?.join(", ") || null
  const skills = chips["skills"] ?? []

  const posted = html.match(/"datePosted"\s*:\s*"([^"]+)"/)?.[1] ?? null
  const valid = html.match(/"validThrough"\s*:\s*"([^"]+)"/)?.[1] ?? null
  const expires = toIsoDate(valid)
  // Absence of an expiry in the past is not proof the posting is open; this only means "not past its validThrough date".
  const isActive = !(expires && Date.parse(expires + "T23:59:59Z") < Date.now())

  return {
    id,
    title: title || "(untitled)",
    company,
    location,
    salary: chips["salary"]?.[0] ?? null,
    date: toIsoDate(posted),
    url: `${BASE_URL}/remote-jobs/${id}`,
    category: chips["category"]?.[0] ?? null,
    jobType: chips["job type"]?.[0] ?? null,
    skills,
    expires,
    description,
    isActive,
  }
}

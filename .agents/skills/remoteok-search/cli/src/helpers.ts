// Data source: Remote OK public JSON feed (https://remoteok.com/api). No authentication.
// The feed is a JSON array: element 0 is a legal/attribution notice, the rest are the
// ~100 most recent postings. There is no server-side search, so query, age and
// location filtering all happen client-side.
//
// API terms: link back to Remote OK and mention it as the source. Every result keeps
// its remoteok.com url for that reason.

export const API_URL = "https://remoteok.com/api"

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

const UA = "Mozilla/5.0 (compatible; remoteok-search-cli/1.0)"

/** Fetch text with exponential backoff on 429/5xx. Returns "" on a 404. */
export async function textFetch(url: string): Promise<string> {
  const maxRetries = 6
  let delay = 500
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
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
    if (response.status === 404) return ""
    if (!response.ok) {
      throw new Error(`Request failed: ${response.status} ${response.statusText}`)
    }
    return response.text()
  }
  throw new Error("Request failed after max retries")
}

export interface Job {
  id: string
  title: string
  company: string | null
  location: string | null
  date: string | null
  url: string
  salary_min: number | null
  salary_max: number | null
  tags: string[]
  description?: string | null
  apply_url?: string | null
}

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

/** Fix UTF-8 text the feed double-encoded (e.g. "MÃ¼nchen" -> "München"). Leaves valid text alone. */
export function fixMojibake(text: string): string {
  if (!/[Â-ô][\u0080-¿]/.test(text)) return text
  for (const ch of text) if (ch.codePointAt(0)! > 0xff) return text
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(text, (c) => c.charCodeAt(0)))
  } catch {
    return text
  }
}

/** Single-line text field: repair encoding, drop markup and decode entities. */
export function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null
  const t = decodeHtmlEntities(stripTags(fixMojibake(value)))
  return t || null
}

/** Description: keep paragraph/line breaks, drop markup. */
export function cleanDescription(value: unknown): string | null {
  if (typeof value !== "string") return null
  const withBreaks = visibleHtml(fixMojibake(value))
    .replace(/\\n/g, "\n") // the feed sometimes carries a literal backslash-n
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|ul|ol|div|h\d)>/gi, "\n")
  const text = withBreaks
    .split("\n")
    .map((l) => decodeHtmlEntities(l.replace(/<[^>]+>/g, " ")).replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
  return text || null
}

function salary(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null
}

/** Normalize one raw feed entry; returns null when it has no id or title. */
export function toJob(raw: any, withDetail = false): Job | null {
  if (!raw || typeof raw !== "object") return null
  const id = raw.id !== undefined && raw.id !== null ? String(raw.id).trim() : ""
  const title = cleanText(raw.position)
  if (!id || !title) return null
  const rawUrl = typeof raw.url === "string" ? raw.url : ""
  const url = /^https:\/\/(www\.)?remoteok\.com\//i.test(rawUrl)
    ? rawUrl
    : `https://remoteok.com/remote-jobs/${typeof raw.slug === "string" && raw.slug ? raw.slug : id}`
  const date = typeof raw.date === "string" && /^\d{4}-\d{2}-\d{2}/.test(raw.date) ? raw.date.slice(0, 10) : null
  const job: Job = {
    id,
    title,
    company: cleanText(raw.company),
    location: cleanText(raw.location),
    date,
    url,
    salary_min: salary(raw.salary_min),
    salary_max: salary(raw.salary_max),
    tags: Array.isArray(raw.tags) ? raw.tags.map(cleanText).filter((t: string | null): t is string => !!t) : [],
  }
  if (withDetail) {
    job.description = cleanDescription(raw.description)
    job.apply_url = typeof raw.apply_url === "string" ? raw.apply_url : null
  }
  return job
}

/** Parse the feed text into raw postings, skipping the leading legal notice. */
export function parseFeed(text: string): any[] {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error("Remote OK returned a response that is not JSON")
  }
  if (!Array.isArray(data)) throw new Error("Remote OK returned an unexpected response shape")
  return data.filter((e) => e && typeof e === "object" && "id" in e)
}

export async function fetchFeed(): Promise<any[]> {
  return parseFeed(await textFetch(API_URL))
}

const US_STATES = new Set([
  "alabama","alaska","arizona","arkansas","california","colorado","connecticut","delaware","florida","georgia",
  "hawaii","idaho","illinois","indiana","iowa","kansas","kentucky","louisiana","maine","maryland","massachusetts",
  "michigan","minnesota","mississippi","missouri","montana","nebraska","nevada","new hampshire","new jersey",
  "new mexico","new york","north carolina","north dakota","ohio","oklahoma","oregon","pennsylvania","rhode island",
  "south carolina","south dakota","tennessee","texas","utah","vermont","virginia","washington","west virginia",
  "wisconsin","wyoming","district of columbia",
])
const US_ABBR = new Set("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(" "))
const US_CITIES = new Set([
  "new york city","nyc","los angeles","san francisco","san jose","san diego","chicago","houston","dallas","austin",
  "boston","seattle","denver","atlanta","miami","phoenix","philadelphia","portland","palo alto","menlo park",
  "mountain view","waltham","brooklyn","washington dc","san antonio","detroit","minneapolis","nashville","charlotte",
  "salt lake city","pittsburgh","raleigh","columbus","las vegas","orlando","tampa","kansas city","st. louis",
])
const ANYWHERE = /^(remote|worldwide|world wide|global|anywhere|anywhere in the world|any state|earth|everywhere|north america|the americas|americas)$/i

/**
 * Whether a posting's location suits a US-based candidate: empty, worldwide, US,
 * United States, North America, "Remote - US", a US state or a well-known US city.
 * Explicit non-US places (Germany, Toronto, EMEA, ...) are dropped.
 */
export function isUsLocation(location: string | null): boolean {
  const loc = (location ?? "").replace(/\s+/g, " ").trim()
  if (!loc) return true
  const lower = loc.toLowerCase()
  if (ANYWHERE.test(lower)) return true
  if (/\b(u\.?s\.?a?\.?|united states|north america)(?![a-z])/i.test(loc)) return true
  if (/\b(anywhere|worldwide)\b/.test(lower) && !/\b(europe|emea|apac|asia|latam)\b/.test(lower)) return true
  if (US_CITIES.has(lower)) return true
  for (const part of loc.split(/[,;/|]/).map((p) => p.trim())) {
    if (US_STATES.has(part.toLowerCase()) || US_CITIES.has(part.toLowerCase()) || US_ABBR.has(part)) return true
  }
  return false
}

/** All whitespace-separated query terms must appear in title, company, location or tags. */
export function matchesQuery(job: Job, query: string | undefined): boolean {
  if (!query || !query.trim()) return true
  const hay = [job.title, job.company ?? "", job.location ?? "", ...job.tags].join(" ").toLowerCase()
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((t) => hay.includes(t))
}

/** Whether date (YYYY-MM-DD) falls within the last `days` days; undated postings do not pass. */
export function withinDays(date: string | null, days: number, now = Date.now()): boolean {
  if (!date) return false
  const t = Date.parse(date + "T00:00:00Z")
  if (Number.isNaN(t)) return false
  return now - t < (days + 1) * 86400000
}

/** Parse a job id from a bare id, a remoteok.com URL, or a slug ending in the numeric id. */
export function normalizeId(input: string): string | null {
  const trimmed = input.trim()
  if (/^\d{4,}$/.test(trimmed)) return trimmed
  const hasScheme = /^https?:\/\//i.test(trimmed)
  if (hasScheme || /^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(trimmed)) {
    let parsed: URL
    try {
      parsed = new URL(hasScheme ? trimmed : `https://${trimmed}`)
    } catch {
      return null
    }
    if (!/(^|\.)remoteok\.com$/i.test(parsed.hostname)) return null
    const m = parsed.pathname.match(/\/(?:[^/]*-)?(\d{4,})\/?$/)
    return m ? m[1] : null
  }
  const slug = trimmed.match(/^[a-z0-9-]*-(\d{4,})$/i)
  return slug ? slug[1] : null
}

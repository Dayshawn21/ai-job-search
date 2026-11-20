// Data source: Built In (builtin.com) public job-board pages. No authentication.
// Listing pages (category / remote) are server-rendered HTML cards; a single job
// page carries a schema.org JobPosting in JSON-LD, which we prefer over CSS scraping.
//
// COMPLIANCE: every URL this CLI requests is checked against a hard-coded copy of
// builtin.com's robots.txt rules for `User-agent: *` (see isPathAllowed). Site search
// (`/search/`, `?search=`) is disallowed, so keyword filtering is done client-side.

export const BASE_URL = "https://builtin.com"

export class CliError extends Error {
  code: string
  constructor(message: string, code: string) {
    super(message)
    this.code = code
  }
}

export function writeError(error: string, code: string): void {
  process.stderr.write(JSON.stringify({ error, code }) + "\n")
}

// ---------------------------------------------------------------------------
// robots.txt guard (User-agent: *, snapshot taken 2026-11-12)
// ---------------------------------------------------------------------------

interface RobotsRule {
  allow: boolean
  pattern: string
}

const DISALLOW = [
  "/core/", "/profiles/", "/admin/", "/taxonomy/", "/dashboard/", "/desktop/", "/mobile/", "/billing/",
  "/member/", "/members", "/event/*", "/flag", "/modal_forms/", "/search/", "/search", "/login*", "/apply/",
  "/auth/", "/form/", "/signup", "/Signup", "/onboarding", "/user/login/", "/user/register/",
  "/bix-job-newsletter/", "/featureflag", "/External/Challenge*", "/connect/authorize*",
  "*?ni=5", "*?page=", "*?region_id=", "*?event_src=", "*?state=", "*?elementor_library", "*challenge-platform",
  "*?salaries_lock=", "/salaries/get/", "/job/sitemap.xml", "/cdn-cgi/rum",
  "/jobs/office*", "/jobs/*size", "/jobs*?search=", "/jobs*?trending*", "/jobs/*other",
  "/jobs/*dev-engineering/*sales-engineer", "/jobs/*not-specified", "/jobs/*mid-level",
  "/jobs/*analytics-industry", "/jobs/*business-intelligence-industry", "/jobs/*coupons", "/jobs/*kids-family",
  "/jobs/*consumer-web", "/jobs/*angel-vcfirm", "/jobs/*co-working-space-incubator",
  "/jobs/*machine-learning-industry", "/jobs/*sales-industry", "/jobs/*sharing-economy", "/jobs/*on-demand",
  "/jobs/*enterprise-web", "/jobs/*professional-services", "/jobs/*events", "/jobs/*financial-services",
  "/jobs/*hardware-industry", "/jobs/*hr-tech", "/jobs/*insurance", "/jobs/*marketing-tech",
  "/jobs/*nanotechnology", "/jobs/*news-entertainment", "/jobs/*payments", "/jobs/*pet$", "/jobs/*productivity",
  "/jobs/*retail", "/jobs/*security-industry", "/jobs/*travel", "/jobs/*virtual-reality", "/jobs/*wearables",
  "/jobs/*agriculture", "/jobs/*hospitality", "/jobs/*chemical", "/jobs/*appliances", "/jobs/*construction",
  "/jobs/*proptech",
  "/jobs*seattle", "/jobs*san-francisco", "/jobs*boston", "/jobs*austin", "/jobs*colorado",
  "/jobs*los-angeles", "/jobs*chicago", "/jobs*new-york-city",
]
const ALLOW = ["/jobs*?page=", "/tag*?page=", "*sitemap.xml?page="]

const RULES: RobotsRule[] = [
  ...DISALLOW.map((pattern) => ({ allow: false, pattern })),
  ...ALLOW.map((pattern) => ({ allow: true, pattern })),
]

function ruleRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith("$")
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*")
  return new RegExp("^" + body + (anchored ? "$" : ""))
}

const COMPILED = RULES.map((r) => ({ ...r, re: ruleRegex(r.pattern) }))

/** Google-style matching: the longest matching pattern wins, Allow wins a tie. */
export function isPathAllowed(pathAndQuery: string): boolean {
  // Stricter than robots.txt: the only query string this CLI ever sends is ?page=N.
  const q = pathAndQuery.indexOf("?")
  if (q !== -1 && !/^\?page=\d+$/.test(pathAndQuery.slice(q))) return false
  let best: { allow: boolean; len: number } | null = null
  for (const r of COMPILED) {
    if (!r.re.test(pathAndQuery)) continue
    const len = r.pattern.length
    if (!best || len > best.len || (len === best.len && r.allow)) best = { allow: r.allow, len }
  }
  return best ? best.allow : true
}

// ---------------------------------------------------------------------------
// Fetching: browser UA, polite pacing, backoff on 429/5xx, block detection
// ---------------------------------------------------------------------------

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

export const MIN_REQUEST_GAP_MS = 1500
let lastRequestAt = 0

/** Test hook: lets unit tests skip real waiting. */
export const pacing = { gapMs: MIN_REQUEST_GAP_MS, baseDelayMs: 500 }

const BLOCK_RE = /<title>\s*(just a moment|attention required|access denied)|g-recaptcha|cf-chl|hcaptcha|\/cdn-cgi\/challenge-platform\/h\/[a-z]\/orchestrate/i

export function looksBlocked(html: string): boolean {
  return BLOCK_RE.test(html)
}

/** Fetch an HTML page. Returns "" on 404. Refuses any URL robots.txt disallows. */
export async function htmlFetch(url: string): Promise<string> {
  const u = new URL(url)
  if (u.origin !== BASE_URL) throw new CliError(`Refusing non-builtin.com URL: ${url}`, "BAD_URL")
  if (!isPathAllowed(u.pathname + u.search)) {
    throw new CliError(`Refusing ${u.pathname}${u.search}: disallowed by builtin.com robots.txt`, "ROBOTS_DISALLOWED")
  }
  const maxRetries = 5
  let delay = pacing.baseDelayMs
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const wait = lastRequestAt + pacing.gapMs - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    lastRequestAt = Date.now()
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    })
    if (response.status === 429 || response.status >= 500) {
      if (attempt === maxRetries) throw new CliError(`Request failed: ${response.status} ${response.statusText}`, "HTTP_ERROR")
      await new Promise((r) => setTimeout(r, delay + Math.floor(Math.random() * 300)))
      delay = Math.min(delay * 2, 8000)
      continue
    }
    if (response.status === 404) return ""
    if (response.status === 401 || response.status === 403) {
      throw new CliError(`Blocked or login required (HTTP ${response.status}); not attempting to bypass`, "BLOCKED")
    }
    if (!response.ok) throw new CliError(`Request failed: ${response.status} ${response.statusText}`, "HTTP_ERROR")
    const text = await response.text()
    if (looksBlocked(text)) throw new CliError("Bot-check / captcha page returned; not attempting to bypass", "BLOCKED")
    return text
  }
  throw new CliError("Request failed after max retries", "HTTP_ERROR")
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JobCard {
  id: string
  title: string
  company: string | null
  companyUrl: string | null
  location: string | null
  workMode: string | null
  salary: string | null
  level: string | null
  date: string | null
  reposted: boolean
  postedText: string | null
  snippet: string | null
  skills: string[]
  url: string
}

export interface JobDetail {
  id: string
  title: string
  company: string | null
  companyUrl: string | null
  location: string | null
  workMode: string | null
  remote: boolean
  salary: string | null
  salaryMin: number | null
  salaryMax: number | null
  salaryCurrency: string | null
  employmentType: string | null
  date: string | null
  validThrough: string | null
  industries: string[]
  description: string | null
  url: string
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

function numericEntity(cp: number): string {
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, d) => numericEntity(parseInt(d, 10)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, h) => numericEntity(parseInt(h, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
}

/** Characters a reader never sees but a model reading this output does. */
const INVISIBLE_CHARS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F­؜᠎​-‏‪-‮⁠-⁯︀-️﻿\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu

export function stripInvisible<T>(value: T): T {
  if (typeof value === "string") return value.replace(INVISIBLE_CHARS, "") as T
  if (Array.isArray(value)) return value.map(stripInvisible) as T
  if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripInvisible(v)])) as T
  }
  return value
}

function textOf(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim()
}

/** Convert a JobPosting description (HTML) to readable plain text. */
export function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|ul|ol|h[1-6])\s*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<[^>]*>/g, "")
  return decodeHtmlEntities(withBreaks)
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

function ymd(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** "Reposted 7 Hours Ago", "Yesterday", "2 Days Ago", "3 Weeks Ago" -> YYYY-MM-DD (local) or null. */
export function relativeToDate(text: string | null | undefined, now: Date = new Date()): string | null {
  if (!text) return null
  const t = text.toLowerCase()
  if (/\b(just now|today)\b/.test(t)) return ymd(now)
  if (/\byesterday\b/.test(t)) {
    const d = new Date(now)
    d.setDate(d.getDate() - 1)
    return ymd(d)
  }
  const m = t.match(/(\d+)\s*(minute|hour|day|week|month|year)s?\s+ago/)
  if (!m) return null
  const n = parseInt(m[1], 10)
  const d = new Date(now)
  switch (m[2]) {
    case "minute": d.setMinutes(d.getMinutes() - n); break
    case "hour": d.setHours(d.getHours() - n); break
    case "day": d.setDate(d.getDate() - n); break
    case "week": d.setDate(d.getDate() - 7 * n); break
    case "month": d.setMonth(d.getMonth() - n); break
    case "year": d.setFullYear(d.getFullYear() - n); break
  }
  return ymd(d)
}

// ---------------------------------------------------------------------------
// Listing parser
// ---------------------------------------------------------------------------

function iconText(chunk: string, icon: string): string | null {
  const re = new RegExp(
    `<i class="fa-regular fa-${icon}[^"]*"></i></div>\\s*(?:<div>)?\\s*<span class="font-barlow text-gray-04[^"]*"([^>]*)>([^<]*)</span>`,
  )
  const m = re.exec(chunk)
  if (!m) return null
  // Multi-location cards show "N Locations" with the real list in a tooltip attribute.
  const tip = /data-bs-title="([^"]*)"/.exec(m[1])
  if (tip) {
    const places = [...decodeHtmlEntities(tip[1]).matchAll(/<div[^>]*>([^<]*)<\/div>/g)].map((x) => textOf(x[1])).filter(Boolean)
    if (places.length) return places.join(" | ")
  }
  return textOf(m[2]) || null
}

export function parseJobCards(html: string, now: Date = new Date()): JobCard[] {
  const starts = [...html.matchAll(/<div id="job-card-(\d+)" data-id="job-card"/g)]
  const seen = new Set<string>()
  const cards: JobCard[] = []
  for (let i = 0; i < starts.length; i++) {
    const id = starts[i][1]
    if (seen.has(id)) continue
    seen.add(id)
    const chunk = html.slice(starts[i].index!, starts[i + 1]?.index ?? html.length)

    const titleM = /<a href="(\/job\/[^"]+)"[^>]*data-id="job-card-title"[^>]*>([\s\S]*?)<\/a>/.exec(chunk)
    if (!titleM) continue
    const companyM = /data-id="company-title"[^>]*>\s*<span>([\s\S]*?)<\/span>/.exec(chunk)
    const companyUrlM = /<a href="(\/company\/[^"]+)"/.exec(chunk)
    const dateM = /<span x-show="!showSavedTag"[^>]*>\s*<i[^>]*><\/i>([^<]*)<\/span>/.exec(chunk)
    const postedText = dateM ? textOf(dateM[1]) || null : null
    const snippetM = /<div class="fs-sm fw-regular mb-md text-gray-04">([\s\S]*?)<\/div>/.exec(chunk)
    const skillsBlock = /Top Skills:<\/span>([\s\S]*?)<\/div><\/div><\/div>/.exec(chunk)
    const skills = skillsBlock
      ? [...skillsBlock[1].matchAll(/<span class="fs-xs text-gray-04 mx-sm">([^<]*)<\/span>/g)].map((m) => textOf(m[1])).filter(Boolean)
      : []

    cards.push({
      id,
      title: textOf(titleM[2]),
      company: companyM ? textOf(companyM[1]) || null : null,
      companyUrl: companyUrlM ? BASE_URL + companyUrlM[1] : null,
      location: iconText(chunk, "location-dot"),
      workMode: iconText(chunk, "house-building"),
      salary: ((v) => (v && /^0-0\b/.test(v) ? null : v))(iconText(chunk, "sack-dollar")),
      level: iconText(chunk, "trophy"),
      date: relativeToDate(postedText, now),
      reposted: !!postedText && /^reposted/i.test(postedText),
      postedText,
      snippet: snippetM ? textOf(snippetM[1]) || null : null,
      skills,
      url: BASE_URL + titleM[1],
    })
  }
  return cards
}

// ---------------------------------------------------------------------------
// Detail parser (JSON-LD JobPosting)
// ---------------------------------------------------------------------------

function jsonLdNodes(html: string): any[] {
  const nodes: any[] = []
  const re = /<script type="application\/ld(?:\+|&#x2B;|&#43;)json"[^>]*>([\s\S]*?)<\/script>/gi
  for (const m of html.matchAll(re)) {
    try {
      const parsed = JSON.parse(m[1])
      const list = Array.isArray(parsed) ? parsed : parsed["@graph"] ? parsed["@graph"] : [parsed]
      nodes.push(...list)
    } catch {
      // ignore a malformed block
    }
  }
  return nodes
}

function asArray<T>(v: T | T[] | undefined | null): T[] {
  return v == null ? [] : Array.isArray(v) ? v : [v]
}

function formatLocation(jobLocation: any): string | null {
  const parts: string[] = []
  for (const loc of asArray(jobLocation)) {
    const a = loc?.address
    if (!a) continue
    const s = [a.addressLocality, a.addressRegion, a.addressCountry?.name ?? a.addressCountry].filter(Boolean).join(", ")
    if (s) parts.push(s)
  }
  return parts.length ? parts.join(" | ") : null
}

function formatSalary(base: any): { text: string | null; min: number | null; max: number | null; currency: string | null } {
  const v = base?.value
  if (!v) return { text: null, min: null, max: null, currency: null }
  const min = typeof v.minValue === "number" ? v.minValue : null
  const max = typeof v.maxValue === "number" ? v.maxValue : null
  const cur = base.currency ?? null
  const unit = String(v.unitText ?? "").toLowerCase()
  const fmt = (n: number) => n.toLocaleString("en-US")
  const range = min != null && max != null ? `${fmt(min)}-${fmt(max)}` : fmt((min ?? max) as number)
  return min == null && max == null
    ? { text: null, min, max, currency: cur }
    : { text: `${cur ?? ""} ${range}${unit ? ` per ${unit}` : ""}`.trim(), min, max, currency: cur }
}

export function parseJobDetail(html: string, url: string): JobDetail {
  const idM = /\/job\/[^/]+\/(\d+)/.exec(url)
  const id = idM ? idM[1] : ""
  const node = jsonLdNodes(html).find((n) => n && n["@type"] === "JobPosting")
  if (!node) {
    const t = /<title>([^<]*)<\/title>/.exec(html)
    throw new CliError(`No JobPosting data found on page (${t ? textOf(t[1]) : "untitled"})`, "PARSE_FAILED")
  }
  const sal = formatSalary(node.baseSalary)
  const remote = node.jobLocationType === "TELECOMMUTE"
  const loc =
    formatLocation(node.jobLocation) ??
    asArray<any>(node.applicantLocationRequirements).map((r) => r?.name).filter(Boolean).join(", ") ??
    null
  const org = node.hiringOrganization
  return {
    id: node.identifier?.value ? String(node.identifier.value) : id,
    title: textOf(String(node.title ?? "")),
    company: org?.name ?? node.identifier?.name ?? null,
    companyUrl: org?.sameAs ?? null,
    location: loc || null,
    workMode: remote ? "Remote" : null,
    remote,
    salary: sal.text,
    salaryMin: sal.min,
    salaryMax: sal.max,
    salaryCurrency: sal.currency,
    employmentType: asArray<string>(node.employmentType).join(", ") || null,
    date: typeof node.datePosted === "string" ? node.datePosted.slice(0, 10) : null,
    validThrough: typeof node.validThrough === "string" ? node.validThrough.slice(0, 10) : null,
    industries: asArray<string>(node.industry),
    description: node.description ? htmlToText(String(node.description)) : null,
    url,
  }
}

// ---------------------------------------------------------------------------
// Listing paths
// ---------------------------------------------------------------------------

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** Category slugs verified to return listings. Others are accepted if they look like a slug. */
export const KNOWN_CATEGORIES = [
  "dev-engineering", "data-analytics", "design-ux", "product", "project-management", "cybersecurity",
  "devops-engineering", "marketing", "sales", "operations", "hr", "finance", "legal", "content", "customer-success",
]

export function isSlug(s: string): boolean {
  return SLUG_RE.test(s)
}

/** Build the listing path (no query) for the allowed category / remote pages. */
export function listingPath(opts: { remote?: boolean; category?: string; subcategory?: string }): string {
  const segs = ["jobs"]
  if (opts.remote) segs.push("remote")
  if (opts.category) segs.push(opts.category)
  if (opts.category && opts.subcategory) segs.push(opts.subcategory)
  return "/" + segs.join("/")
}

export function listingUrl(path: string, page: number): string {
  return BASE_URL + path + (page > 1 ? `?page=${page}` : "")
}

// ---------------------------------------------------------------------------
// Client-side filters
// ---------------------------------------------------------------------------

/** All whitespace-separated terms must appear in title / company / snippet / skills. */
export function matchesQuery(card: JobCard, query: string | undefined): boolean {
  if (!query) return true
  const hay = [card.title, card.company, card.snippet, card.skills.join(" ")].join(" ").toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((t) => hay.includes(t))
}

export function withinDays(card: JobCard, days: number, now: Date = new Date()): boolean {
  if (!card.date) return true
  const cutoff = new Date(now)
  cutoff.setHours(0, 0, 0, 0)
  cutoff.setDate(cutoff.getDate() - days)
  return card.date >= ymd(cutoff)
}

// ---------------------------------------------------------------------------
// id -> url cache (job pages need the slug, which a bare id does not carry)
// ---------------------------------------------------------------------------

import { tmpdir } from "node:os"
import { join } from "node:path"
import { existsSync, readFileSync, writeFileSync } from "node:fs"

const CACHE_FILE = join(tmpdir(), "builtin-search-url-cache.json")

export function rememberUrls(cards: { id: string; url: string }[]): void {
  try {
    const cache: Record<string, string> = existsSync(CACHE_FILE) ? JSON.parse(readFileSync(CACHE_FILE, "utf8")) : {}
    for (const c of cards) cache[c.id] = c.url
    const entries = Object.entries(cache).slice(-1000)
    writeFileSync(CACHE_FILE, JSON.stringify(Object.fromEntries(entries)))
  } catch {
    // cache is best effort
  }
}

export function lookupUrl(id: string): string | null {
  try {
    if (!existsSync(CACHE_FILE)) return null
    return (JSON.parse(readFileSync(CACHE_FILE, "utf8")) as Record<string, string>)[id] ?? null
  } catch {
    return null
  }
}

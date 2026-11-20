import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { readFileSync } from "node:fs"
import {
  isPathAllowed,
  listingPath,
  listingUrl,
  looksBlocked,
  matchesQuery,
  parseJobCards,
  parseJobDetail,
  relativeToDate,
  withinDays,
} from "../src/helpers.js"
import { resolveJobUrl } from "../src/commands/detail.js"
import { runCLI } from "./helpers.js"

const fx = (n: string) => readFileSync(join(import.meta.dir, "fixtures", n), "utf8")
const NOW = new Date(2026, 10, 12, 12, 0, 0) // 2026-11-12 local

describe("parseJobCards (saved real markup)", () => {
  const cards = parseJobCards(fx("listing.html"), NOW)

  test("extracts every card with id, title, company, url", () => {
    expect(cards.length).toBe(2)
    const c = cards[0]
    expect(c.id).toBe("10698571")
    expect(c.title).toBe("Senior Fullstack Software Engineer, DX")
    expect(c.company).toBe("Atlassian")
    expect(c.url).toBe("https://builtin.com/job/senior-fullstack-software-engineer-dx/10698571")
    expect(c.companyUrl).toBe("https://builtin.com/company/atlassian")
  })

  test("extracts location, work mode, salary, level, snippet, skills", () => {
    const c = cards[0]
    expect(c.location).toBe("94104, San Francisco, CA, USA")
    expect(c.workMode).toBe("In-Office or Remote")
    expect(c.salary).toBe("149K-235K Annually")
    expect(c.level).toBe("Senior level")
    expect(c.snippet).toContain("Senior full-stack engineer")
    expect(c.skills).toContain("React")
  })

  test("converts relative posted text to YYYY-MM-DD and flags reposts", () => {
    expect(cards[0].postedText).toBe("Reposted 7 Hours Ago")
    expect(cards[0].reposted).toBe(true)
    expect(cards[0].date).toBe("2026-11-12")
    for (const c of cards) expect(c.date === null || /^\d{4}-\d{2}-\d{2}$/.test(c.date)).toBe(true)
  })

  test("empty or unrelated HTML yields no cards", () => {
    expect(parseJobCards("<html></html>")).toEqual([])
  })
})

describe("relativeToDate", () => {
  test("handles units", () => {
    expect(relativeToDate("Yesterday", NOW)).toBe("2026-11-11")
    expect(relativeToDate("2 Days Ago", NOW)).toBe("2026-11-10")
    expect(relativeToDate("Reposted 3 Weeks Ago", NOW)).toBe("2026-10-22")
    expect(relativeToDate("5 Minutes Ago", NOW)).toBe("2026-11-12")
    expect(relativeToDate("whenever", NOW)).toBeNull()
    expect(relativeToDate(null, NOW)).toBeNull()
  })
})

describe("parseJobDetail (JSON-LD JobPosting)", () => {
  const url = "https://builtin.com/job/senior-fullstack-software-engineer-dx/10698571"
  const job = parseJobDetail(fx("job.html"), url)

  test("reads structured fields", () => {
    expect(job.id).toBe("10698571")
    expect(job.title).toBe("Senior Fullstack Software Engineer, DX")
    expect(job.company).toBe("Atlassian")
    expect(job.date).toBe("2026-11-12")
    expect(job.remote).toBe(true)
    expect(job.employmentType).toBe("FULL_TIME")
    expect(job.salaryMin).toBe(149400)
    expect(job.salaryMax).toBe(235000)
    expect(job.salary).toContain("149,400-235,000")
    expect(job.location).toBe("San Francisco, California, USA")
  })

  test("description is plain text with list bullets", () => {
    expect(job.description).toContain("About the role")
    expect(job.description).toContain("- Build and ship features")
    expect(job.description).not.toContain("<li>")
  })

  test("page without JobPosting throws PARSE_FAILED", () => {
    expect(() => parseJobDetail("<html><title>x</title></html>", url)).toThrow(/No JobPosting/)
  })
})

describe("filters", () => {
  const cards = parseJobCards(fx("listing.html"), NOW)
  test("client-side query requires every word", () => {
    expect(matchesQuery(cards[0], "react atlassian")).toBe(true)
    expect(matchesQuery(cards[0], "react cobol")).toBe(false)
    expect(matchesQuery(cards[0], undefined)).toBe(true)
  })
  test("jobage", () => {
    expect(withinDays({ ...cards[0], date: "2026-11-05" }, 7, NOW)).toBe(true)
    expect(withinDays({ ...cards[0], date: "2026-11-01" }, 7, NOW)).toBe(false)
  })
})

describe("robots.txt guard", () => {
  test("allows category / remote listings, pagination and job pages", () => {
    for (const p of [
      "/jobs", "/jobs/remote", "/jobs/dev-engineering", "/jobs/remote/dev-engineering",
      "/jobs/remote/dev-engineering/react", "/jobs/remote/dev-engineering?page=2",
      "/jobs/data-analytics?page=3", "/job/some-title/12345678",
    ]) expect(isPathAllowed(p)).toBe(true)
  })
  test("blocks site search and disallowed listing variants", () => {
    for (const p of [
      "/search/jobs", "/jobs?search=react", "/jobs/remote?search=react", "/jobs?trending=1",
      "/jobs/office/dev-engineering", "/jobs/remote/mid-level", "/jobs/remote/dev-engineering/sales-engineer",
      "/jobs/remote/seattle", "/jobs/remote/dev-engineering?page=2&search=x",
    ]) expect(isPathAllowed(p)).toBe(false)
  })
  test("listing paths built from flags are all allowed", () => {
    expect(listingPath({ remote: true, category: "dev-engineering" })).toBe("/jobs/remote/dev-engineering")
    expect(listingPath({ category: "dev-engineering", subcategory: "react" })).toBe("/jobs/dev-engineering/react")
    expect(listingPath({})).toBe("/jobs")
    expect(listingUrl("/jobs/remote", 2)).toBe("https://builtin.com/jobs/remote?page=2")
    expect(isPathAllowed(new URL(listingUrl(listingPath({ remote: true, category: "product" }), 4)).pathname + "?page=4")).toBe(true)
  })
  test("block-page detection", () => {
    expect(looksBlocked("<title>Just a moment...</title>")).toBe(true)
    expect(looksBlocked("<title>Best Remote Jobs</title>")).toBe(false)
  })
})

describe("resolveJobUrl", () => {
  const none = () => null
  test("accepts builtin.com job URLs only", () => {
    expect(resolveJobUrl("https://builtin.com/job/a-b/123456", none)).toBe("https://builtin.com/job/a-b/123456")
    expect(resolveJobUrl("builtin.com/job/a-b/123456", none)).toBe("https://builtin.com/job/a-b/123456")
    expect(resolveJobUrl("/job/a-b/123456", none)).toBe("https://builtin.com/job/a-b/123456")
    expect(resolveJobUrl("https://evil.example/job/a-b/123456", none)).toBeNull()
    expect(resolveJobUrl("https://builtin.com.evil.io/job/a-b/123456", none)).toBeNull()
    expect(resolveJobUrl("https://builtin.com/search/jobs", none)).toBeNull()
  })
  test("bare id resolves via cache", () => {
    expect(resolveJobUrl("123456", () => "https://builtin.com/job/a-b/123456")).toBe("https://builtin.com/job/a-b/123456")
    expect(resolveJobUrl("123456", none)).toBeNull()
  })
})

describe("CLI argument validation (offline)", () => {
  test("unknown flag exits 1 with JSON on stderr", async () => {
    const r = await runCLI(["search", "--bogus", "x"])
    expect(r.exitCode).toBe(1)
    expect(JSON.parse(r.stderr).code).toBe("UNKNOWN_FLAG")
  })
  test("--search style flags are rejected, bad category slug rejected", async () => {
    expect((await runCLI(["search", "--search", "react"])).exitCode).toBe(1)
    const r = await runCLI(["search", "--category", "../search"])
    expect(r.exitCode).toBe(1)
    expect(JSON.parse(r.stderr).code).toBe("BAD_ARG")
  })
  test("detail of an off-site URL fails with BAD_ID before any request", async () => {
    const r = await runCLI(["detail", "https://example.com/job/a/123456"])
    expect(r.exitCode).toBe(1)
    expect(JSON.parse(r.stderr).code).toBe("BAD_ID")
  })
})

describe("multi-location card", () => {
  test("tooltip locations are expanded", () => {
    const html = `<div id="job-card-1" data-id="job-card"><a href="/job/x/1" data-id="job-card-title">T</a><i class="fa-regular fa-location-dot fs-xs text-pretty-blue"></i></div>
      <div><span class="font-barlow text-gray-04 text-decoration-underline" data-bs-title="&lt;div class=&#x27;t&#x27;&gt;Denver, CO, USA&lt;/div&gt;&lt;div class=&#x27;t&#x27;&gt;New York, NY, USA&lt;/div&gt;">2 Locations</span></div>`
    expect(parseJobCards(html)[0].location).toBe("Denver, CO, USA | New York, NY, USA")
  })
})

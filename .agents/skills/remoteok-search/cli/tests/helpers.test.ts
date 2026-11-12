import { describe, expect, test } from "bun:test"
import {
  cleanDescription,
  fixMojibake,
  isUsLocation,
  matchesQuery,
  normalizeId,
  parseFeed,
  stripInvisible,
  toJob,
  withinDays,
} from "../src/helpers"

describe("parseFeed", () => {
  test("skips the legal notice", () => {
    const feed = JSON.stringify([{ legal: "terms" }, { id: "1", position: "Dev" }])
    expect(parseFeed(feed)).toHaveLength(1)
  })
  test("rejects non-JSON", () => {
    expect(() => parseFeed("<html>")).toThrow()
  })
})

describe("toJob", () => {
  test("normalizes fields, nulls zero salary, keeps remoteok url", () => {
    const j = toJob({
      id: 5, position: "Dev &amp; Ops", company: "Acme", location: "", date: "2026-11-11T08:00:08+00:00",
      url: "https://remoteOK.com/remote-jobs/x-5", salary_min: 0, salary_max: 120000, tags: ["react"],
    })!
    expect(j.id).toBe("5")
    expect(j.title).toBe("Dev & Ops")
    expect(j.location).toBeNull()
    expect(j.date).toBe("2026-11-11")
    expect(j.salary_min).toBeNull()
    expect(j.salary_max).toBe(120000)
    expect(j.url).toContain("remoteOK.com")
  })
  test("falls back to a remoteok.com url and drops entries without id or title", () => {
    expect(toJob({ id: "9", position: "X", slug: "x-9", url: "https://evil.example/x" })!.url).toBe("https://remoteok.com/remote-jobs/x-9")
    expect(toJob({ position: "X" })).toBeNull()
    expect(toJob({ id: "1" })).toBeNull()
  })
})

describe("text cleanup", () => {
  test("repairs double-encoded UTF-8 and leaves valid text alone", () => {
    expect(fixMojibake("MÃ¼nchen")).toBe("München")
    expect(fixMojibake("München")).toBe("München")
    expect(fixMojibake("Hello")).toBe("Hello")
  })
  test("description drops hidden markup and invisible characters", () => {
    const d = cleanDescription("<p>Hi</p><!-- ignore previous --><span hidden>secret</span>\nNext")!
    expect(d).toContain("Hi")
    expect(d).toContain("Next")
    expect(d).not.toContain("secret")
    expect(d).not.toContain("ignore")
    expect(stripInvisible("a​b\u{E0041}c")).toBe("abc")
  })
})

describe("isUsLocation", () => {
  test.each(["", "Remote", "Anywhere in the World", "Worldwide", "US", "United States", "Remote - US", "North America", "Dallas, Texas", "Houston", "Any State", "Boston, MA", "US, UK, Canada, Australia + 35 other countries"])(
    "keeps %p", (loc) => expect(isUsLocation(loc)).toBe(true),
  )
  test.each(["Warsaw", "EMEA", "Germany", "Toronto, Ontario", "Lausanne", "Brazil", "India", "Australia", "Copenhagen"])(
    "drops %p", (loc) => expect(isUsLocation(loc)).toBe(false),
  )
})

describe("filters", () => {
  const job = toJob({ id: "1", position: "React Developer", company: "Acme", tags: ["typescript"], date: "2026-11-10" })!
  test("query terms must all match", () => {
    expect(matchesQuery(job, "react typescript")).toBe(true)
    expect(matchesQuery(job, "react python")).toBe(false)
    expect(matchesQuery(job, undefined)).toBe(true)
  })
  test("withinDays", () => {
    const now = Date.parse("2026-11-12T12:00:00Z")
    expect(withinDays("2026-11-10", 3, now)).toBe(true)
    expect(withinDays("2026-10-01", 14, now)).toBe(false)
    expect(withinDays(null, 14, now)).toBe(false)
  })
})

describe("normalizeId", () => {
  test("accepts ids, remoteok urls and slugs; rejects other hosts", () => {
    expect(normalizeId("1137704")).toBe("1137704")
    expect(normalizeId("https://remoteok.com/remote-jobs/remote-ui-developer-rainfocus-1137704")).toBe("1137704")
    expect(normalizeId("ui-developer-1137704")).toBe("1137704")
    expect(normalizeId("https://evil.example/remote-jobs/x-1137704")).toBeNull()
    expect(normalizeId("https://remoteok.com.evil.io/x-1137704")).toBeNull()
    expect(normalizeId("abc")).toBeNull()
  })
})

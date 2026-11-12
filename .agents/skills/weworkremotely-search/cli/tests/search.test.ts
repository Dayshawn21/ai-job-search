// Live smoke tests against the public feed and job pages. Keep volume low: two feed requests, one detail page.
import { describe, expect, test } from "bun:test"
import { parseJSON, runCLI } from "./helpers.ts"

interface Search {
  meta: { count: number }
  results: { id: string; title: string; company: string | null; location: string | null; date: string | null; url: string }[]
}

describe("flag validation (offline)", () => {
  test.each([
    [["search", "--bogus"], "UNKNOWN_FLAG"],
    [["search", "--category", "nope"], "BAD_ARG"],
    [["search", "--jobage", "0"], "BAD_ARG"],
    [["search", "--limit", "abc"], "BAD_ARG"],
    [["search", "--format", "xml"], "BAD_ARG"],
    [["search", "-q"], "BAD_ARG"],
    [["detail"], "NO_ID"],
    [["detail", "https://example.com/remote-jobs/x"], "BAD_ID"],
    [["frobnicate"], "BAD_CMD"],
  ])("%j exits 1 with a JSON error on stderr", async (args, code) => {
    const r = await runCLI(args as string[])
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toBe("")
    expect(JSON.parse(r.stderr).code).toBe(code)
  })

  test("--us-only does not swallow the next flag", async () => {
    const r = await runCLI(["search", "--us-only", "--bogus"])
    expect(JSON.parse(r.stderr).code).toBe("UNKNOWN_FLAG")
  })
})

describe("live", () => {
  test("search returns well-formed results, then detail works on one", async () => {
    const r = await runCLI(["search", "--category", "frontend", "--limit", "3", "--format", "json"])
    const out = parseJSON<Search>(r)
    expect(out.meta.count).toBe(out.results.length)
    expect(out.results.length).toBeGreaterThan(0)
    for (const j of out.results) {
      expect(j.id).toBeTruthy()
      expect(j.title).toBeTruthy()
      expect(j.url.startsWith("https://weworkremotely.com/remote-jobs/")).toBe(true)
      expect(j.date === null || /^\d{4}-\d{2}-\d{2}$/.test(j.date)).toBe(true)
    }
    const d = await runCLI(["detail", out.results[0].url])
    const detail = parseJSON<{ id: string; title: string; description: string | null }>(d)
    expect(detail.id).toBe(out.results[0].id)
    expect(detail.title).toBeTruthy()
    expect(detail.description).toBeTruthy()
  })

  test("unknown job exits 1 with NOT_FOUND", async () => {
    const r = await runCLI(["detail", "zzz-no-such-job-0000"])
    expect(r.exitCode).toBe(1)
    expect(JSON.parse(r.stderr).code).toBe("NOT_FOUND")
  })
})

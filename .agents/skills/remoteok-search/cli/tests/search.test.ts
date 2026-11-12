import { describe, expect, test } from "bun:test"
import { parseJSON, runCLI } from "./helpers"

interface Result { id: string; title: string; company: string | null; location: string | null; date: string | null; url: string }
interface Out { meta: { count: number }; results: Result[] }

describe("CLI contract (offline)", () => {
  test("bogus flag exits 1 with a JSON error on stderr", async () => {
    const r = await runCLI(["search", "--bogus"])
    expect(r.exitCode).toBe(1)
    expect(r.stdout).toBe("")
    expect(JSON.parse(r.stderr).code).toBe("UNKNOWN_FLAG")
  })
  test("bad --jobage and --format exit 1", async () => {
    expect(JSON.parse((await runCLI(["search", "--jobage", "0"])).stderr).code).toBe("BAD_ARG")
    expect(JSON.parse((await runCLI(["search", "--format", "xml"])).stderr).code).toBe("BAD_ARG")
  })
  test("detail without an id and with a foreign url exit 1", async () => {
    expect(JSON.parse((await runCLI(["detail"])).stderr).code).toBe("NO_ID")
    expect(JSON.parse((await runCLI(["detail", "https://example.com/x-123456"])).stderr).code).toBe("BAD_ID")
  })
})

describe("live smoke test", () => {
  test("search returns results with id/title/url, then detail resolves one", async () => {
    const r = await runCLI(["search", "-q", "developer", "--limit", "3"])
    const out = parseJSON<Out>(r)
    expect(out.results.length).toBeGreaterThanOrEqual(1)
    for (const j of out.results) {
      expect(j.id).toBeTruthy()
      expect(j.title).toBeTruthy()
      expect(j.url).toMatch(/^https:\/\/(www\.)?remoteok\.com\//i)
    }
    const d = parseJSON<Result & { description: string | null }>(await runCLI(["detail", out.results[0].id]))
    expect(d.id).toBe(out.results[0].id)
  })
})

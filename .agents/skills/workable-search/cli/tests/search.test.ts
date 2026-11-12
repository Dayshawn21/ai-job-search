import { describe, expect, test } from "bun:test";
import { parseJSON, runCLI } from "./helpers";

interface Result {
  id: string;
  title: string;
  url: string;
  date: string | null;
}

// Live smoke tests against the public Workable API (keep volume low).
describe("workable-search CLI", () => {
  test("search returns real results; detail works on one", async () => {
    const out = parseJSON<{ meta: { count: number; page: number }; results: Result[] }>(
      await runCLI(["search", "-q", "engineer", "--limit", "3"]),
    );
    expect(out.meta.page).toBe(1);
    expect(out.results.length).toBeGreaterThanOrEqual(1);
    for (const r of out.results) {
      expect(r.id).toBeTruthy();
      expect(r.title).toBeTruthy();
      expect(r.url).toBe(`https://jobs.workable.com/view/${r.id}`);
    }
    const detail = parseJSON<{ id: string; description: string | null }>(await runCLI(["detail", out.results[0].id]));
    expect(detail.id).toBe(out.results[0].id);
  });

  test("bogus flag exits 1 with JSON error on stderr", async () => {
    const r = await runCLI(["search", "--bogus", "x"]);
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toBe("");
    expect(JSON.parse(r.stderr).code).toBe("UNKNOWN_FLAG");
  });

  test("bad values and missing detail id exit 1", async () => {
    for (const args of [
      ["search", "--remote", "mars"],
      ["search", "--jobage", "0"],
      ["search", "--format", "xml"],
      ["detail"],
      ["detail", "https://evil.example/view/747efea0-09c7-4d5a-8703-e117901d7041"],
    ]) {
      const r = await runCLI(args);
      expect(r.exitCode).toBe(1);
      expect(JSON.parse(r.stderr).code).toBeTruthy();
    }
  });
});

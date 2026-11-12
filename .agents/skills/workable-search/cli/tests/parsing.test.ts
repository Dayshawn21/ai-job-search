import { afterEach, describe, expect, test } from "bun:test";
import {
  htmlToText,
  jsonFetch,
  parseJob,
  parseJobDetail,
  parseSearchResponse,
  stripInvisible,
  workplaceParam,
} from "../src/helpers";
import { buildUrl } from "../src/commands/search";
import { normalizeId } from "../src/commands/detail";

const ID = "747efea0-09c7-4d5a-8703-e117901d7041";
const RAW = {
  id: ID,
  title: "Software Engineer",
  state: "published",
  employmentType: "Full-time",
  department: "Engineering",
  url: "https://jobs.workable.com/view/abc/remote-software-engineer",
  location: { city: "Austin", subregion: "Texas", countryName: "United States" },
  created: "2026-11-10T01:30:11.371Z",
  updated: "2026-11-11T01:30:11.371Z",
  workplace: "on_site",
  company: { title: "Acme", url: "https://jobs.workable.com/company/x", website: "http://acme.test" },
  description: "<p>Hello &amp; welcome</p><ul><li>One</li><li>Two</li></ul><p hidden>secret</p><!-- c -->",
  salaryFrom: 100000,
  salaryTo: 120000,
  salaryCurrencyIsoCode: "USD",
  salaryFrequency: "year",
};

describe("parsing", () => {
  test("parseJob maps the contract fields", () => {
    const j = parseJob(RAW)!;
    expect(j.id).toBe(ID);
    expect(j.company).toBe("Acme");
    expect(j.location).toBe("Austin, Texas, United States");
    expect(j.date).toBe("2026-11-10");
    expect(j.workplace).toBe("on-site");
    expect(j.url).toBe(`https://jobs.workable.com/view/${ID}`);
    expect(j.salary).toBe("100,000-120,000 USD per year");
  });

  test("missing values are null, malformed jobs are skipped", () => {
    const j = parseJob({ id: ID, title: "T" })!;
    expect(j.company).toBeNull();
    expect(j.date).toBeNull();
    expect(j.salary).toBeNull();
    const r = parseSearchResponse({ totalSize: 2, jobs: [null, { title: "no id" }, RAW] });
    expect(r.cards.length).toBe(1);
    expect(r.total).toBe(2);
  });

  test("detail text keeps list breaks and drops hidden markup", () => {
    const d = parseJobDetail(RAW)!;
    expect(d.description).toBe("Hello & welcome\n\n- One\n- Two");
    expect(d.isActive).toBe(true);
  });

  test("htmlToText and stripInvisible", () => {
    expect(htmlToText("")).toBeNull();
    expect(stripInvisible("a​b\u{E0041}c")).toBe("abc");
  });
});

describe("request building and ids", () => {
  test("buildUrl maps flags to API params", () => {
    const u = new URL(buildUrl({ query: "react", location: "United States", remote: "onsite", jobage: 7, page: 1, format: "json" }, "tok"));
    expect(u.origin + u.pathname).toBe("https://jobs.workable.com/api/v1/jobs");
    expect(u.searchParams.get("query")).toBe("react");
    expect(u.searchParams.get("workplace")).toBe("on_site");
    expect(u.searchParams.get("day_range")).toBe("7");
    expect(u.searchParams.get("pageToken")).toBe("tok");
    expect(workplaceParam("bogus")).toBeNull();
  });

  test("normalizeId accepts ids and Workable URLs only", () => {
    expect(normalizeId(ID)).toBe(ID);
    expect(normalizeId(`https://jobs.workable.com/view/${ID}`)).toBe(ID);
    expect(normalizeId("jobs.workable.com/view/fomAmsTZKqLrECgi2haMeT/remote-software-engineer")).toBe("fomAmsTZKqLrECgi2haMeT");
    expect(normalizeId(`https://evil.example/view/${ID}`)).toBeNull();
    expect(normalizeId(`https://jobs.workable.com.evil.io/view/${ID}`)).toBeNull();
    expect(normalizeId("12")).toBeNull();
  });
});

describe("jsonFetch retry/backoff", () => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  });

  test("retries 429 then succeeds; 404 gives null without retry", async () => {
    globalThis.setTimeout = ((fn: () => void) => originalSetTimeout(fn, 0)) as unknown as typeof setTimeout;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return calls === 1 ? new Response("", { status: 429 }) : new Response('{"ok":true}', { status: 200 });
    }) as unknown as typeof fetch;
    expect(await jsonFetch("https://x.test/")).toEqual({ ok: true });
    expect(calls).toBe(2);

    calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response("Job not found", { status: 404 });
    }) as unknown as typeof fetch;
    expect(await jsonFetch("https://x.test/")).toBeNull();
    expect(calls).toBe(1);
  });

  test("gives up after max retries on 503", async () => {
    globalThis.setTimeout = ((fn: () => void) => originalSetTimeout(fn, 0)) as unknown as typeof setTimeout;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response("", { status: 503 });
    }) as unknown as typeof fetch;
    await expect(jsonFetch("https://x.test/")).rejects.toThrow("503");
    expect(calls).toBe(7);
  });
});

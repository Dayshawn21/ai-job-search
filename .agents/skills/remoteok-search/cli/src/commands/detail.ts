import { fetchFeed, normalizeId, stripInvisible, toJob, writeError } from "../helpers.js"

export interface DetailOpts {
  id: string
  format: "json" | "plain"
}

export async function runDetail(opts: DetailOpts): Promise<number> {
  const id = normalizeId(opts.id)
  if (!id) {
    writeError(`Could not parse a Remote OK job ID from "${opts.id}"`, "BAD_ID")
    return 1
  }
  try {
    const raw = (await fetchFeed()).find((r) => String(r?.id) === id)
    const parsed = raw ? toJob(raw, true) : null
    if (!parsed) {
      writeError(
        "Job not found in the current Remote OK feed (it only lists the ~100 newest postings; older or closed ones drop off)",
        "NOT_FOUND",
      )
      return 1
    }
    const job = stripInvisible(parsed)

    if (opts.format === "plain") {
      const salary =
        job.salary_min !== null || job.salary_max !== null ? `Salary: ${job.salary_min ?? "?"} - ${job.salary_max ?? "?"}` : ""
      const head = [
        job.title,
        `${job.company || "—"} · ${job.location || "—"} · ${job.date || "—"}`,
        salary,
        job.tags.length ? `Tags: ${job.tags.join(", ")}` : "",
      ].filter((l) => l !== "")
      const lines = [
        ...head,
        "",
        job.description || "(no description)",
        "",
        `Apply: ${job.apply_url || job.url}`,
        `Source: Remote OK - ${job.url}`,
      ]
      process.stdout.write(lines.join("\n") + "\n")
    } else {
      process.stdout.write(JSON.stringify(job, null, 2) + "\n")
    }
    return 0
  } catch (e) {
    writeError(e instanceof Error ? e.message : String(e), "DETAIL_FAILED")
    return 1
  }
}

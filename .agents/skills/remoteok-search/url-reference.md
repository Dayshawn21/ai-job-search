# Remote OK URL Reference

Public, unauthenticated JSON feed used by this skill. Global, remote-only.

> Personal use only. Link back to the job's remoteok.com page and mention Remote OK as
> the source (API terms). `robots.txt` Content-Signal: `search=yes, ai-train=no, use=reference`.

## Feed

```
GET https://remoteok.com/api
```

Returns HTTP 200 with a JSON array (~100 newest postings). No query parameters are used:
`/api?tag=react` answers with a 302, so filtering is done client-side. Works with the
honest tool User-Agent `Mozilla/5.0 (compatible; remoteok-search-cli/1.0)`.

- Element `0` is a legal/attribution notice (`{ "last_updated", "legal" }`), skipped by the CLI.
- Each posting:

| Field | Meaning | CLI field |
|-------|---------|-----------|
| `id` | Numeric id as string | `id` |
| `position` | Job title | `title` |
| `company` | Company name | `company` |
| `location` | Free text, often `""` (worldwide) | `location` |
| `date` | ISO timestamp, e.g. `2026-11-11T08:00:08+00:00` | `date` (YYYY-MM-DD) |
| `url` | `https://remoteOK.com/remote-jobs/<slug>` | `url` |
| `apply_url` | Apply link (often the same as `url`) | `apply_url` (detail) |
| `salary_min`, `salary_max` | Numbers; `0` = unset; units inconsistent | `salary_min`, `salary_max` |
| `tags` | Lowercase keyword array | `tags` |
| `description` | Text with markdown-like bullets and entities; sometimes a literal `\n` | `description` (detail) |
| `slug`, `epoch`, `logo`, `company_logo`, `verified` | Unused | |

## Detail

There is no separate JSON endpoint. `detail` looks the id up in the same feed, so only
postings among the ~100 newest resolve. The HTML page `https://remoteok.com/remote-jobs/<id>`
redirects to the slug URL and carries JSON-LD, but the CLI does not scrape it.

## Quirks

- Some strings are double-encoded UTF-8 (`MÃ¼nchen`); the CLI re-decodes them.
- `location` values seen: `""`, `Remote`, `Anywhere in the World`, `Any State`, `US`, `Remote - US`, `Dallas, Texas`, `EMEA`, `Warsaw`, `Toronto, Ontario`, multi-country lists.
- Salary values like `21` or `114000000` appear; treat as unreliable.

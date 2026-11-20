# Workable Jobs API Reference

Public, unauthenticated JSON API behind `https://jobs.workable.com`. Verified live 2026-11-12.

> Personal use only - keep volume low; no commercial or bulk use.

## Access

`robots.txt` disallows `/search`, `/search*?*` and `/profile*` for HTML pages, so this skill never fetches them. `/api/v1/*` is not disallowed. An honest `User-Agent: Mozilla/5.0 (compatible; workable-search-cli/1.0)` is accepted (HTTP 200); no cookies or credentials.

## Search

```
GET https://jobs.workable.com/api/v1/jobs
```

| Param | Meaning | Example |
|-------|---------|---------|
| `query` | Free-text keywords (terms narrow the result) | `react engineer` |
| `location` | Location text | `United States`, `Houston, TX` |
| `workplace` | `remote` \| `hybrid` \| `on_site` | `remote` |
| `day_range` | Posted within N days (server-side; 1, 3, 7, 14, 30, 90 verified) | `7` |
| `pageToken` | The previous response's `nextPageToken` (also accepted as `token`/`nextPageToken`; `pageToken` is used). Page 1 = omit. | `eyJ...` |
| `limit` | Accepted (returns fewer rows) but not used by the CLI; default page size is 20 | `5` |

Unknown values are ignored silently (e.g. `workplace=onsite` returns 0 results; `pageSize` has no effect).

Response: `{ title, totalSize, nextPageToken?, jobs: [...], autoAppliedFilters }`. `nextPageToken` is an opaque base64 string; there is no numeric page parameter, so page N is reached by following N-1 tokens.

### Job object (search)

`id` (UUID), `title`, `state` (`published`), `description` (HTML), `socialSharingDescription`, `requirementsSection` / `benefitsSection` (HTML), `employmentType` (`Full-time`, ... or empty), `department`, `url` (canonical `https://jobs.workable.com/view/<shortId>/<slug>`), `language`, `locations` (strings; `TELECOMMUTE` marks remote), `location` `{ city, subregion, countryName }`, `created` / `updated` (ISO 8601), `workplace` (`remote` \| `hybrid` \| `on_site`), `isFeatured`, `company` `{ id, title, website, image, description, url, ... }`.

No salary fields appear in search results.

## Single job

```
GET https://jobs.workable.com/api/v1/jobs/<id>
```

`<id>` is either the UUID or the short id from a `/view/<shortId>/...` link (both verified). Returns the job object above plus `linkoutUrl` (external apply link, may be null) and, when the employer lists pay, `salaryFrom`, `salaryTo`, `salaryCurrencyIsoCode`, `salaryFrequency`. A missing id returns HTTP 404 with body `Job not found`.

## Public links

`https://jobs.workable.com/view/<uuid>` redirects (301) to the canonical link, so the CLI emits it as `url` and keeps the API's canonical link in `canonicalUrl`.

## Quirks

- Description HTML contains entities and list markup; the CLI converts it to text (hidden elements, comments, scripts dropped; invisible Unicode stripped).
- `totalSize` for a query reflects all matches, not the current page.
- Dates (`created`) may predate the `day_range` window only for reposts; the filter is server-side.

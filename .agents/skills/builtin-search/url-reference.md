# Built In URL and data reference

Verified live 2026-11-12. Plain HTTP GET with a normal browser User-Agent returned 200 and
real content (no captcha, no login, no proxy needed).

## robots.txt (User-agent: *) summary

Read in full from https://builtin.com/robots.txt. Relevant rules:

- Disallowed: `/search/`, `/search`, `/jobs*?search=`, `/jobs*?trending*`, `/jobs/office*`,
  `/jobs/*size`, `/jobs/*other`, `/jobs/*mid-level`, `/jobs/*not-specified`,
  `/jobs/*dev-engineering/*sales-engineer`, many `/jobs/*<industry>` suffixes (retail, payments,
  insurance, travel, ...), city listings `/jobs*seattle|san-francisco|boston|austin|colorado|los-angeles|chicago|new-york-city`,
  `/apply/`, `/login*`, and a blanket `Disallow: *?page=`.
- `Allow: /jobs*?page=` is longer (more specific) than `Disallow: *?page=`, so pagination on
  `/jobs...` listings is allowed under longest-match semantics.
- Not disallowed: `/jobs`, `/jobs/remote`, `/jobs/<category>`, `/jobs/remote/<category>[/<sub>]`, and `/job/<slug>/<id>`.
- `helpers.ts` embeds these rules (`isPathAllowed`) and refuses to fetch anything disallowed.
  It is also stricter: the only query string ever sent is `?page=N`.

## Paths used

| Purpose | Path |
|---|---|
| All listings | `/jobs` |
| Remote listings | `/jobs/remote` |
| Category | `/jobs/<category>` or `/jobs/remote/<category>` |
| Sub-listing (skill) | `/jobs/remote/dev-engineering/react` |
| Page N (25 per page) | append `?page=N` |
| One job | `/job/<slug>/<id>` (the slug is required: `/job/x/<id>` is 404) |

Categories confirmed to return cards: dev-engineering, data-analytics, design-ux, product,
project-management, cybersecurity, devops-engineering.

## Listing page (server-rendered HTML; no JSON-LD or `__NEXT_DATA__` on listings)

Cards: `<div id="job-card-<id>" data-id="job-card" ...>`. Within a card:

- title + url: `<a href="/job/<slug>/<id>" data-id="job-card-title">Title</a>`
- company: `<a data-id="company-title"><span>Name</span></a>`; company url `/company/<slug>`
- posted: `<span x-show="!showSavedTag" ...><i></i>Reposted 7 Hours Ago</span>` (relative: `N Hours|Days|Weeks Ago`, `Yesterday`; may be prefixed "Reposted")
- fields identified by icon class: `fa-house-building` work mode ("Remote", "Hybrid", "In-Office or Remote", "Remote or Hybrid"), `fa-location-dot` location, `fa-sack-dollar` salary ("149K-235K Annually"; "0-0 Annually" means none), `fa-trophy` level
- multiple locations: the span carries a `data-bs-title` HTML tooltip listing each place
- summary: `<div class="fs-sm fw-regular mb-md text-gray-04">`; "Top Skills:" span list
- Pagination: `?page=N` returns a different set of 25 cards; a pinned card may be duplicated (deduped by id). Pager links have `aria-label="Go to Page N"`.

## Job page

`<script type="application/ld&#x2B;json">` containing an `@graph` with a schema.org `JobPosting`:
title, description (HTML), datePosted (YYYY-MM-DD), jobLocationType (`TELECOMMUTE` for remote),
jobLocation[].address or applicantLocationRequirements, baseSalary (min/max/unitText),
employmentType, hiringOrganization (name, sameAs), industry[], identifier.value (job id).
The detail parser reads this JSON-LD; only listing cards need CSS-class parsing.

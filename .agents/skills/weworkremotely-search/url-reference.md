# We Work Remotely URL Reference

Public, unauthenticated resources used by this skill (verified 2026-11-12).

> Personal use only - keep volume low. `robots.txt` is `Allow: /` with only admin and account paths disallowed (`/admin/`, `/account/`, `/job-seekers/account/`, `/job-seekers/profile/`, `/manage-company/`, token edit/cancel URLs).

## Search = category RSS feeds

```
GET https://weworkremotely.com/categories/remote-front-end-programming-jobs.rss
GET https://weworkremotely.com/categories/remote-full-stack-programming-jobs.rss
GET https://weworkremotely.com/categories/remote-back-end-programming-jobs.rss
GET https://weworkremotely.com/categories/remote-programming-jobs.rss
GET https://weworkremotely.com/remote-jobs.rss            (every category)
```

| `--category` | Feed |
|---|---|
| `frontend` | `remote-front-end-programming-jobs.rss` |
| `fullstack` | `remote-full-stack-programming-jobs.rss` |
| `backend` | `remote-back-end-programming-jobs.rss` |
| `all-programming` | `remote-programming-jobs.rss` |
| `all` | `/remote-jobs.rss` |

All returned HTTP 200 with the CLI's `Mozilla/5.0 (compatible; weworkremotely-cli/1.0)` User-Agent. No query parameters; the feed has no keyword, age or pagination controls, so the CLI filters client-side. Each feed carries roughly the 100 most recent items (`<ttl>60</ttl>`). Sizes vary (front-end about 80 KB, full-stack about 1 MB, `remote-jobs.rss` about 2 MB) because every item embeds the full description.

### `<item>` fields

| Element | Example | Used as |
|---|---|---|
| `<title>` | `Sezzle: Data Engineer II` | split on first `": "` into `company` and `title` |
| `<region>` | `Anywhere in the World`, `USA Only`, `North America Only`, `Asia Only`, `EMEA Only`, `Europe Only`, `Canada Only`, `Africa Only`, `Oceania Only` | `location`; basis of `--us-only` |
| `<country>` | empty, or a flag-prefixed list `🇺🇸 United States of America, 🇨🇦 Canada, and 🇲🇽 Mexico` | `countries` (geo-lock list; US must be on it for `--us-only`) |
| `<state>` | usually empty | appended to `location` |
| `<skills>` | `Python, SQL, and Data Engineering` | `skills` |
| `<category>`, `<type>` | `Full-Stack Programming`, `Full-Time` | `category`, `jobType` |
| `<description>` | entity-escaped HTML (starts with a logo `<img>`, HQ and URL, often a salary line) | text, used for `--query` matching |
| `<pubDate>` | `Wed, 11 Nov 2026 17:01:26 +0000` | `date` (YYYY-MM-DD), `--jobage` |
| `<expires_at>` | RFC 822 | `expires` |
| `<link>`, `<guid>` | `https://weworkremotely.com/remote-jobs/<slug>` | `url`; `<slug>` is the `id` |

Items may use CDATA in other feeds; the parser unwraps it. Items without a link or title are skipped.

## Detail = public job page

```
GET https://weworkremotely.com/remote-jobs/<slug>
```

Unknown slugs return the generic search page with HTTP 200 (not 404); the CLI detects the missing posting header and reports `NOT_FOUND`. `/listings/<slug>` is accepted as input and normalised.

Anchors used by `parseJobDetail`:

| Field | Anchor |
|---|---|
| title | `<h1 class="lis-container__header__hero__company-info__title">` |
| company | `lis-container__job__sidebar__companyDetails__info__title` > `<h3>` (fallback: JSON-LD `hiringOrganization.name`) |
| description | `<div class="lis-container__job__content__description">` (nested-div aware) |
| sidebar fields | `<ul class="lis-container__job__sidebar__job-about__list">`: each `<li>` is a label (`Posted on`, `Apply before`, `Job type`, `Salary`, `Category`, `Region`, `Country`, `Skills`) followed by `<span class="box ...">` chips. `Region` is absent on geo-locked jobs, which carry `Country` instead. |
| posted / expiry | JSON-LD `"datePosted"` and `"validThrough"` (the block is not strictly valid JSON, so they are read with regex) |

Anchor class names are the thing to update if the page markup changes. The apply button on the page links to an account-registration prompt; this skill does not use it.

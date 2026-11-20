#!/usr/bin/env python3
"""Build today's outreach queue from job_search_tracker.csv.

Prints Markdown: who to reach out to, who to follow up with, and interview
thank-yous, each with LinkedIn people-search links and a short draft.
It only prepares: nothing is fetched from LinkedIn and nothing is sent.
The tracker's `date` is the application date, so follow-up age is measured
from it (the tracker has no contact-date column).
"""

import argparse
import csv
import re
import sys
from datetime import date, datetime
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent
TRACKER = ROOT / "job_search_tracker.csv"
SEARCH = "https://www.linkedin.com/search/results/people/?keywords={}&origin=GLOBAL_SEARCH_HEADER"

REACH_OUT = (
    "Hi [Name], I recently applied for the {role} role at {company}. I have five years of production "
    "React and TypeScript, most of it on a healthcare platform with 400+ users, and I would like to "
    "learn more about the team. Is the role still open, and is there someone I should speak with?"
)
FOLLOW_UP = (
    "Hi [Name], following up on my application for the {role} role at {company}. I am still very "
    "interested and happy to share anything that would help. Is there an update on the process?"
)
THANK_YOU = (
    "Hi [Name], thank you for your time on [date]. I enjoyed learning about [one specific thing "
    "from the conversation]. I am excited about the {role} role at {company} and happy to answer "
    "any follow-up questions."
)


def clean_company(name: str) -> str:
    return re.sub(r"\s*\(.*?\)", "", name or "").strip()


def parse_date(text: str):
    try:
        return datetime.strptime((text or "").strip()[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def links(company: str, role: str) -> tuple[str, str]:
    keyword = " ".join(re.sub(r"[^\w\s+#.]", " ", role).split()[:4])
    return (SEARCH.format(quote(f"{company} recruiter")), SEARCH.format(quote(f"{company} {keyword}")))


def fit(row) -> int:
    try:
        return int(float(row.get("fit_rating") or 0))
    except ValueError:
        return 0


def build(rows, today, min_age, max_age, follow_age, min_fit, limit):
    reach, follow, interview = [], [], []
    for row in rows:
        age_date = parse_date(row.get("date"))
        if not age_date:
            continue
        age = (today - age_date).days
        status = (row.get("status") or "").strip().lower()
        has_contact = bool((row.get("contact_person") or "").strip())
        if status == "interview":
            interview.append((row, age))
        elif status in ("applied", "contacted") and has_contact and age >= follow_age:
            follow.append((row, age))
        elif status == "applied" and not has_contact and min_age <= age <= max_age and fit(row) >= min_fit:
            reach.append((row, age))
    reach.sort(key=lambda t: (-fit(t[0]), t[1]))
    follow.sort(key=lambda t: -t[1])
    return reach[:limit], follow[:limit], interview


def render(title, items, template):
    out = [f"## {title} ({len(items)})", ""]
    if not items:
        out += ["Nothing in this group today.", ""]
    for row, age in items:
        company, role = clean_company(row["company"]), row.get("role", "")
        rec, peer = links(company, role)
        contact = (row.get("contact_person") or "").strip()
        out += [
            f"### {company} - {role}",
            f"Fit {fit(row) or 'n/a'} | applied {row['date']} ({age} days ago)"
            + (f" | contact: {contact}" if contact else ""),
            f"- Recruiter search: {rec}",
            f"- Team search: {peer}",
            f"- Draft: {template.format(role=role, company=company)}",
            "",
        ]
    return out


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--tracker", type=Path, default=TRACKER)
    p.add_argument("--min-age", type=int, default=3, help="days since applying before first outreach")
    p.add_argument("--max-age", type=int, default=14, help="stop suggesting first outreach after this")
    p.add_argument("--follow-age", type=int, default=7, help="days before a follow-up")
    p.add_argument("--min-fit", type=int, default=0)
    p.add_argument("--limit", type=int, default=10, help="max items per group")
    p.add_argument("--today", help="YYYY-MM-DD, for testing")
    p.add_argument("--out", type=Path, help="also write the Markdown here")
    a = p.parse_args()
    if not a.tracker.is_file():
        sys.exit(f"tracker not found: {a.tracker}")
    today = parse_date(a.today) if a.today else date.today()
    with a.tracker.open(encoding="utf-8-sig", newline="") as fh:
        rows = list(csv.DictReader(fh))
    reach, follow, interview = build(rows, today, a.min_age, a.max_age, a.follow_age, a.min_fit, a.limit)
    lines = [f"# Outreach queue - {today.isoformat()}", "",
             "Open the links yourself, pick 1-3 real people, personalise [Name], send, then log the person in the tracker.", ""]
    lines += render("Reach out", reach, REACH_OUT)
    lines += render("Follow up", follow, FOLLOW_UP)
    lines += render("Interview thank-yous", interview, THANK_YOU)
    text = "\n".join(lines)
    print(text)
    if a.out:
        a.out.parent.mkdir(parents=True, exist_ok=True)
        a.out.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()

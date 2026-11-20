import sys
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
import outreach_queue as q  # noqa: E402

TODAY = date(2026, 11, 13)


def row(company, status="applied", day="2026-11-08", contact="", fit="60", role="Frontend Engineer"):
    return {"company": company, "role": role, "status": status, "date": day,
            "contact_person": contact, "fit_rating": fit}


class Build(unittest.TestCase):
    def run_build(self, rows, **kw):
        args = dict(min_age=3, max_age=14, follow_age=7, min_fit=0, limit=10)
        args.update(kw)
        return q.build(rows, TODAY, args["min_age"], args["max_age"], args["follow_age"], args["min_fit"], args["limit"])

    def test_groups_and_age_window(self):
        rows = [
            row("Fresh", day="2026-11-12"),                       # too new
            row("Ready", day="2026-11-08"),                       # reach out
            row("Old", day="2026-10-01"),                         # past window
            row("Chased", day="2026-11-01", contact="Pat"),       # follow up
            row("Talk", status="interview", day="2026-11-05"),    # interview
            row("Gone", status="rejected", day="2026-11-08"),     # ignored
        ]
        reach, follow, interview = self.run_build(rows)
        self.assertEqual([r["company"] for r, _ in reach], ["Ready"])
        self.assertEqual([r["company"] for r, _ in follow], ["Chased"])
        self.assertEqual([r["company"] for r, _ in interview], ["Talk"])

    def test_reach_out_sorted_by_fit_and_limited(self):
        rows = [row("A", fit="50"), row("B", fit="80"), row("C", fit="70")]
        reach, _, _ = self.run_build(rows, limit=2)
        self.assertEqual([r["company"] for r, _ in reach], ["B", "C"])

    def test_min_fit_filters(self):
        reach, _, _ = self.run_build([row("A", fit="40"), row("B", fit="70")], min_fit=60)
        self.assertEqual([r["company"] for r, _ in reach], ["B"])

    def test_bad_date_is_skipped(self):
        reach, follow, interview = self.run_build([row("A", day="soon")])
        self.assertEqual((reach, follow, interview), ([], [], []))

    def test_clean_company_and_links(self):
        self.assertEqual(q.clean_company("Goodwin Recruiting (sports client)"), "Goodwin Recruiting")
        rec, peer = q.links("Reddit", "Senior Frontend Engineer, Ads Formats")
        self.assertIn("Reddit%20recruiter", rec)
        self.assertIn("Reddit%20Senior%20Frontend%20Engineer%20Ads", peer)


if __name__ == "__main__":
    unittest.main()

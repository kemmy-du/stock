import unittest
from datetime import date

from build_financials import quarter_ends, tidy
from financials_calc import (
    quarter_no, prev_quarter_end, same_quarter_last_year,
    single_from_cum, pct, ratio, annual_sum, build_metrics, new_codes,
)


class TestDerive(unittest.TestCase):
    def test_quarter_no(self):
        self.assertEqual(quarter_no("2026-03-31"), 1)
        self.assertEqual(quarter_no("2026-06-30"), 2)
        self.assertEqual(quarter_no("2026-09-30"), 3)
        self.assertEqual(quarter_no("2026-12-31"), 4)

    def test_prev_quarter_end(self):
        self.assertEqual(prev_quarter_end("2026-09-30"), "2026-06-30")
        self.assertEqual(prev_quarter_end("2026-03-31"), "2025-12-31")

    def test_same_quarter_last_year(self):
        self.assertEqual(same_quarter_last_year("2026-09-30"), "2025-09-30")

    def test_single_from_cum(self):
        cum = {"2026-03-31": 100.0, "2026-06-30": 260.0, "2026-09-30": 480.0}
        self.assertEqual(single_from_cum(cum, "2026-03-31"), 100.0)
        self.assertEqual(single_from_cum(cum, "2026-06-30"), 160.0)
        self.assertEqual(single_from_cum(cum, "2026-09-30"), 220.0)
        self.assertIsNone(single_from_cum(cum, "2026-12-31"))

    def test_pct_and_ratio(self):
        self.assertAlmostEqual(pct(120.0, 100.0), 20.0)
        self.assertAlmostEqual(pct(-50.0, 100.0), -150.0)
        self.assertIsNone(pct(100.0, 0))
        self.assertIsNone(pct(100.0, None))
        self.assertAlmostEqual(ratio(25.0, 100.0), 25.0)
        self.assertIsNone(ratio(25.0, 0))

    def test_annual_sum(self):
        cum = {
            "2025-03-31": 100.0, "2025-06-30": 260.0,
            "2025-09-30": 480.0, "2025-12-31": 700.0,
        }
        self.assertEqual(annual_sum(cum, 2025), 700.0)
        self.assertIsNone(annual_sum(cum, 2024))

    def test_build_metrics_q3(self):
        series = {
            "2024-03-31": {"rev": 200.0, "np": 20.0, "deduct": 19.0, "gross": 60.0},
            "2024-06-30": {"rev": 400.0, "np": 40.0, "deduct": 38.0, "gross": 120.0},
            "2024-09-30": {"rev": 600.0, "np": 60.0, "deduct": 57.0, "gross": 180.0},
            "2024-12-31": {"rev": 800.0, "np": 80.0, "deduct": 78.0, "gross": 240.0},
            "2025-03-31": {"rev": 100.0, "np": 10.0, "deduct": 9.5, "gross": 30.0},
            "2025-06-30": {"rev": 260.0, "np": 26.0, "deduct": 25.0, "gross": 78.0},
            "2025-09-30": {"rev": 460.0, "np": 46.0, "deduct": 44.0, "gross": 138.0},
            "2025-12-31": {"rev": 1000.0, "np": 100.0, "deduct": 95.0, "gross": 300.0},
            "2026-03-31": {"rev": 150.0, "np": 15.0, "deduct": 14.0, "gross": 45.0},
            "2026-06-30": {"rev": 300.0, "np": 30.0, "deduct": 29.0, "gross": 90.0},
            "2026-09-30": {"rev": 540.0, "np": 54.0, "deduct": 52.0, "gross": 162.0},
        }
        m = build_metrics(series, "2026-09-30")
        self.assertEqual(m["q_rev"], 240.0)          # 540 - 300
        self.assertEqual(m["q_np"], 24.0)            # 54 - 30
        self.assertEqual(m["q_deduct"], 23.0)        # 52 - 29
        self.assertAlmostEqual(m["q_gm"], 30.0)      # 72 / 240
        self.assertAlmostEqual(m["q_nm"], 10.0)      # 24 / 240
        self.assertAlmostEqual(m["rev_qoq"], 60.0)   # 240 vs 150
        self.assertAlmostEqual(m["np_qoq"], 60.0)    # 24 vs 15
        self.assertAlmostEqual(m["rev_yoy"], 20.0)   # 240 vs 200
        self.assertAlmostEqual(m["np_yoy"], 20.0)    # 24 vs 20
        self.assertAlmostEqual(m["y_rev"], 1000.0)
        self.assertAlmostEqual(m["y_rev_yoy"], 25.0)  # 1000 vs 800
        self.assertAlmostEqual(m["y_nm"], 10.0)


class TestTidy(unittest.TestCase):
    def test_rounds_and_keeps_types(self):
        self.assertEqual(tidy(13.659185495701873), 13.66)
        self.assertEqual(tidy(2.0), 2)
        self.assertIsNone(tidy(None))
        self.assertEqual(tidy("600519"), "600519")


class TestQuarterEnds(unittest.TestCase):
    def test_no_future_dates(self):
        ends = quarter_ends(date(2026, 10, 27), 12)
        self.assertEqual(ends[0], "2026-09-30")
        self.assertEqual(ends[1], "2026-06-30")
        self.assertEqual(ends[2], "2026-03-31")
        self.assertEqual(len(ends), 12)
        self.assertTrue(all(e <= "2026-09-30" for e in ends))
        self.assertEqual(ends[-1], "2023-12-31")

    def test_year_boundary(self):
        ends = quarter_ends(date(2027, 1, 5), 2)
        self.assertEqual(ends, ["2026-12-31", "2026-09-30"])


class TestNewCodes(unittest.TestCase):
    def test_period_advanced_and_new_stock(self):
        prev = {"600000": "2026-06-30", "600001": "2026-09-30", "600002": "2026-06-30"}
        cur = {"600000": "2026-09-30", "600001": "2026-09-30", "600003": "2026-09-30"}
        self.assertEqual(new_codes(prev, cur), ["600000", "600003"])

    def test_empty_prev_marks_all(self):
        self.assertEqual(new_codes({}, {"1": "2026-09-30", "2": "2026-06-30"}),
                           ["1", "2"])

    def test_no_period_not_marked(self):
        self.assertEqual(new_codes({"1": "2026-06-30"}, {"1": None}), [])

    def test_identical_snapshot(self):
        prev = {"1": "2026-06-30", "2": "2026-03-31"}
        self.assertEqual(new_codes(prev, dict(prev)), [])


if __name__ == "__main__":
    unittest.main()
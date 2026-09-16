"""Network-free safeguards for the production artifact trainers."""

from __future__ import annotations

import csv
import importlib.util
import math
from dataclasses import replace
from datetime import date
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"


def load_script(name: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load training script {name}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


mlb = load_script("build_recent_results_dataset")
nfl = load_script("train_nfl_history")


class TrainingInvariants(unittest.TestCase):
    def setUp(self):
        self.mlb_games = [
            mlb.GameResult(1, "2024-04-01", 2024, 111, "Boston", 147, "New York", 2, 4),
            mlb.GameResult(2, "2024-04-02", 2024, 111, "Boston", 147, "New York", 5, 1),
            mlb.GameResult(3, "2024-04-03", 2024, 111, "Boston", 147, "New York", 1, 3),
        ]
        self.nfl_games = [
            nfl.Game(2024, date(2024, 9, 1), "KC", "BUF", 24, 17, 7, 7, 1),
            nfl.Game(2024, date(2024, 9, 8), "KC", "BUF", 14, 28, 7, 7, 1),
            nfl.Game(2024, date(2024, 9, 15), "KC", "BUF", 31, 20, 7, 7, 1),
        ]
        self.hyperparameters = {"k_factor": 12, "home_advantage": 20, "season_regression": 0.35}

    def test_mlb_current_and_future_outcomes_do_not_change_pregame_features(self):
        baseline = mlb.build_pregame_rows(self.mlb_games, self.hyperparameters)
        changed = mlb.build_pregame_rows(
            [self.mlb_games[0], replace(self.mlb_games[1], home_score=12, away_score=0), self.mlb_games[2]],
            self.hyperparameters,
        )
        self.assertEqual(baseline[0], changed[0])
        self.assertEqual(baseline[1][1], changed[1][1])
        self.assertNotEqual(baseline[1][2], changed[1][2])
        self.assertNotEqual(baseline[2][1], changed[2][1])

    def test_nfl_current_and_future_outcomes_do_not_change_pregame_features(self):
        baseline, targets, _ = nfl.build_examples(self.nfl_games)
        changed, new_targets, _ = nfl.build_examples(
            [self.nfl_games[0], replace(self.nfl_games[1], home_score=35, away_score=7), self.nfl_games[2]]
        )
        self.assertEqual(baseline[:2], changed[:2])
        self.assertNotEqual(targets[1], new_targets[1])
        self.assertNotEqual(baseline[2], changed[2])

    def test_nfl_season_checkpoint_does_not_include_future_season_results(self):
        next_season = replace(self.nfl_games[0], season=2025, gameday=date(2025, 9, 1))
        _, _, checkpoints = nfl.build_examples([*self.nfl_games, next_season])
        _, _, revised = nfl.build_examples([*self.nfl_games, replace(next_season, home_score=0, away_score=40)])
        self.assertEqual(checkpoints[2025], revised[2025])
        self.assertNotEqual(checkpoints[2026], revised[2026])

    def test_mlb_fit_excludes_holdout_labels_and_features(self):
        training = [(2024, [i / 10, i % 2, i % 3, i / 5, -i / 20], i % 2) for i in range(1, 13)]
        baseline = mlb.fit_portable_logistic_model(training + [(2025, [1, 2, 3, 4, 5], 0)], 2024)
        revised = mlb.fit_portable_logistic_model(training + [(2025, [-99, -50, 0, 50, 99], 1)], 2024)
        self.assertEqual(baseline, revised)
        self.assertTrue(all(math.isfinite(weight) for weight in baseline["weights"]))

    def test_nfl_loader_rejects_missing_required_season(self):
        with TemporaryDirectory() as temporary_directory:
            path = Path(temporary_directory) / "games.csv"
            path.write_text("season,gameday,home_score,away_score,game_type,home_team,away_team\n2025,2025-09-01,20,10,REG,KC,BUF\n")
            with self.assertRaisesRegex(ValueError, "missing required NFL seasons"):
                nfl.load_games(str(path), 2024, 2025)

    def test_nfl_loader_filters_incomplete_tied_and_preseason_games(self):
        with TemporaryDirectory() as temporary_directory:
            path = Path(temporary_directory) / "games.csv"
            with path.open("w", newline="", encoding="utf-8") as handle:
                writer = csv.writer(handle)
                writer.writerow(["season", "gameday", "home_score", "away_score", "game_type", "home_team", "away_team"])
                writer.writerows([
                    [2025, "2025-09-01", 20, 10, "REG", "KC", "BUF"],
                    [2025, "2025-09-02", "", "", "REG", "KC", "BUF"],
                    [2025, "2025-09-03", 20, 20, "REG", "KC", "BUF"],
                    [2025, "2025-08-01", 20, 10, "PRE", "KC", "BUF"],
                ])
            self.assertEqual(len(nfl.load_games(str(path), 2025, 2025)), 1)

    def test_nfl_metrics_report_probability_quality_and_sample_count(self):
        metrics = nfl.metrics([[1, 0, 0, 0, 0, 0, 0]] * 2, [0, 1], [0] * 7)
        self.assertEqual(metrics["games"], 2)
        self.assertEqual(metrics["correct"], 1)
        self.assertEqual(metrics["accuracy"], 0.5)
        self.assertEqual(metrics["brierScore"], 0.25)
        self.assertAlmostEqual(metrics["logLoss"], math.log(2))


if __name__ == "__main__":
    unittest.main()

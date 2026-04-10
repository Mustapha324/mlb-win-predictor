from dataclasses import dataclass

from app.schemas.prediction import TeamPrediction


@dataclass(frozen=True)
class PipelineArtifacts:
    """Container for future pipeline outputs.

    This object gives us a stable extension point where we can gradually add
    richer features, model diagnostics, and metadata without changing route code.
    """

    predictions: list[TeamPrediction]


class BaselinePredictionPipeline:
    """Lightweight pipeline facade used by the API route.

    The current implementation intentionally returns mock values while exposing
    method boundaries where production data/model work can be added.
    """

    def build_features(self) -> dict[str, str]:
        """Build feature set for each scheduled game.

        TODO(lineup-aware features): ingest confirmed lineups and include
        batting-order-sensitive features.
        TODO(batter-vs-pitcher history): add matchup aggregates and recency
        weighting for batter/pitcher interactions.
        TODO(bullpen fatigue): track prior workload and rest-days to model
        reliever availability.
        TODO(weather): add venue-aware weather signals (wind, temperature,
        precipitation) once we have a weather provider integration.
        """

        return {"feature_set": "baseline-placeholder"}

    def score_games(self, _features: dict[str, str]) -> list[TeamPrediction]:
        """Run model scoring for today's games.

        TODO(XGBoost comparison): add side-by-side training/evaluation hooks so
        we can compare baseline model metrics against an XGBoost candidate.
        TODO(probability calibration): add optional calibration stage (e.g.,
        isotonic/platt) after model scoring and before API response.
        """

        return [
            TeamPrediction(
                game_id="20260410-nyy-bos",
                home_team="Boston Red Sox",
                away_team="New York Yankees",
                predicted_winner="New York Yankees",
                win_probability=0.57,
            ),
            TeamPrediction(
                game_id="20260410-lad-sf",
                home_team="San Francisco Giants",
                away_team="Los Angeles Dodgers",
                predicted_winner="Los Angeles Dodgers",
                win_probability=0.62,
            ),
        ]

    def run(self) -> PipelineArtifacts:
        features = self.build_features()
        predictions = self.score_games(features)
        return PipelineArtifacts(predictions=predictions)

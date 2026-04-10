# MLB Win Predictor - Architecture Extension Notes

This document records intentional extension points that are now present in the codebase.

## Modeling and feature roadmap

- **Lineup-aware features**
  - Hook: `BaselinePredictionPipeline.build_features` in `app/services/prediction_pipeline.py`.
  - Plan: add confirmed lineup ingestion and derive batting-order-sensitive team signals.

- **Batter vs pitcher history**
  - Hook: `BaselinePredictionPipeline.build_features`.
  - Plan: include head-to-head aggregates with recency weighting and sample-size controls.

- **Bullpen fatigue**
  - Hook: `BaselinePredictionPipeline.build_features`.
  - Plan: track reliever workload over recent games, rest days, and back-to-back usage risk.

- **Weather**
  - Hook: `BaselinePredictionPipeline.build_features`.
  - Plan: inject game-time weather by venue and transform to model-friendly features.

- **Probability calibration**
  - Hook: `BaselinePredictionPipeline.score_games`.
  - Plan: add post-model calibration before returning API probabilities.

- **XGBoost comparison**
  - Hook: `BaselinePredictionPipeline.score_games`.
  - Plan: evaluate a parallel XGBoost model and compare calibration/discrimination metrics.

## Data and operations roadmap

- **PostgreSQL migration**
  - Hook: `Settings.database_url` in `app/core/config.py`.
  - Plan: move from local sqlite default to PostgreSQL plus formal schema migrations.

- **Scheduled daily prediction jobs**
  - Hooks:
    - `Settings.daily_job_enabled` and `Settings.daily_job_cron` in `app/core/config.py`.
    - route note in `app/routes/predictions.py`.
  - Plan: run daily batch predictions and have API serve persisted snapshots.


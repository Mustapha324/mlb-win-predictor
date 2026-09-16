# NFL serving-layer lab — production v2 vs brain stack vs closing market

Generated 2026-09-08 by `npm run backtest -- nfl --ensemble`. Every column is out-of-sample: v2 is replayed from per-season checkpoints trained only on earlier seasons (2022, 2023, 2024, 2025); the brain stack runs frozen at shipped weights on the MOV-Elo baseline; the market is the nflverse closing moneyline (vig removed). Blend weights are fit leave-one-season-out on log-loss, so each season's blended number never saw that season.

Columns: W-L · accuracy · log-loss (lower is better).

## Single models by season

| season | games | v2 (production) | MOV-Elo | brain-lite (record factors) | brain (full) | closing market |
|---|---|---|---|---|---|---|
| 2022 | 269 | 161-108 · 59.9% · 0.6576 | 173-96 · 64.3% · 0.6429 | 171-98 · 63.6% · 0.6418 | 174-95 · 64.7% · 0.6426 | 176-93 · 65.4% · 0.6085 |
| 2023 | 272 | 157-115 · 57.7% · 0.6615 | 168-104 · 61.8% · 0.6605 | 171-101 · 62.9% · 0.6577 | 172-100 · 63.2% · 0.6554 | 184-88 · 67.6% · 0.6273 |
| 2024 | 272 | 184-88 · 67.6% · 0.6314 | 181-91 · 66.5% · 0.6187 | 183-89 · 67.3% · 0.6108 | 184-88 · 67.6% · 0.6079 | 195-77 · 71.7% · 0.5875 |
| 2025 | 271 | 175-96 · 64.6% · 0.6338 | 175-96 · 64.6% · 0.6442 | 175-96 · 64.6% · 0.6399 | 173-98 · 63.8% · 0.6398 | 177-94 · 65.3% · 0.6094 |
| **all** | 1084 | 677-407 · 62.5% · 0.6460 | 697-387 · 64.3% · 0.6416 | 700-384 · 64.6% · 0.6375 | 703-381 · 64.9% · 0.6364 | 732-352 · 67.5% · 0.6082 |

## Leave-one-season-out blends

For each season the blend weight is fit on the other seasons only (grid 0..1 by 0.05 on the logit average), then applied frozen.

| season | games | fitted w(v2) vs brain | v2⊕brain (LOSO) | 50/50 v2⊕brain | fitted w(v2) vs lite | v2⊕lite (LOSO) | market | w(model) vs market | ens⊕market (LOSO) |
|---|---|---|---|---|---|---|---|---|---|
| 2022 | 269 | 0.25 | 170-99 · 63.2% · 0.6442 | 167-102 · 62.1% · 0.6472 | 0.30 | 170-99 · 63.2% · 0.6443 | 176-93 · 65.4% · 0.6085 | 0.00 | 176-93 · 65.4% · 0.6085 |
| 2023 | 272 | 0.10 | 174-98 · 64.0% · 0.6548 | 171-101 · 62.9% · 0.6552 | 0.10 | 168-104 · 61.8% · 0.6569 | 184-88 · 67.6% · 0.6273 | 0.00 | 184-88 · 67.6% · 0.6273 |
| 2024 | 272 | 0.30 | 182-90 · 66.9% · 0.6118 | 186-86 · 68.4% · 0.6159 | 0.35 | 183-89 · 67.3% · 0.6148 | 195-77 · 71.7% · 0.5875 | 0.00 | 195-77 · 71.7% · 0.5875 |
| 2025 | 271 | 0.00 | 173-98 · 63.8% · 0.6398 | 173-98 · 63.8% · 0.6329 | 0.00 | 175-96 · 64.6% · 0.6399 | 177-94 · 65.3% · 0.6094 | 0.00 | 177-94 · 65.3% · 0.6094 |
| **all** | 1084 | — | 699-385 · 64.5% · 0.6376 | 697-387 · 64.3% · 0.6378 | — | 696-388 · 64.2% · 0.6390 | 732-352 · 67.5% · 0.6082 | — | 732-352 · 67.5% · 0.6082 |

Fixed 25% model / 75% market anchor (no fitting): 739-345 · 68.2% · 0.6116 over 1084 games with a closing line.

## Paired bootstrap (3,000 resamples, per-game differences)

Δ log-loss is A − B (negative favours A) with a 95% interval; Δ accuracy likewise; P(A better) is the share of resamples where A had lower log-loss.

| comparison (A vs B) | window | games | Δ log-loss [95%] | Δ accuracy [95%] | P(A better) |
|---|---|---|---|---|---|
| v2⊕brain (LOSO w) vs v2 production | all seasons | 1084 | -0.0084 [-0.0155, 0.0005] | 2.0pp [0.3, 4.1] | 95% |
| v2⊕brain (LOSO w) vs v2 production | 2025 holdout | 271 | 0.0060 [-0.0197, 0.0240] | -0.7pp [-4.8, 3.3] | 37% |
| v2⊕brain (LOSO w) vs brain full | all seasons | 1084 | 0.0012 [-0.0004, 0.0032] | -0.4pp [-1.3, 0.4] | 9% |
| v2⊕brain (LOSO w) vs brain full | 2025 holdout | 271 | -0.0000 [-0.0000, 0.0000] | 0.0pp [0.0, 0.0] | 83% |
| 50/50 v2⊕brain vs v2 production | all seasons | 1084 | -0.0083 [-0.0125, -0.0029] | 1.8pp [0.8, 3.8] | 100% |
| 50/50 v2⊕brain vs v2 production | 2025 holdout | 271 | -0.0009 [-0.0139, 0.0082] | -0.7pp [-4.1, 3.0] | 67% |
| v2⊕brain-lite (LOSO w) vs v2 production | all seasons | 1084 | -0.0071 [-0.0143, 0.0024] | 1.8pp [0.0, 4.2] | 88% |
| v2⊕brain-lite (LOSO w) vs v2 production | 2025 holdout | 271 | 0.0061 [-0.0193, 0.0235] | 0.0pp [-3.7, 5.2] | 36% |
| closing market vs v2⊕brain (LOSO w) | all seasons | 1084 | -0.0295 [-0.0424, -0.0207] | 3.0pp [1.1, 4.3] | 100% |
| closing market vs v2⊕brain (LOSO w) | 2025 holdout | 271 | -0.0304 [-0.0517, -0.0096] | 1.5pp [-1.8, 5.9] | 100% |
| closing market vs v2 production | all seasons | 1084 | -0.0379 [-0.0492, -0.0271] | 5.1pp [3.8, 7.3] | 100% |
| closing market vs v2 production | 2025 holdout | 271 | -0.0244 [-0.0500, -0.0053] | 0.7pp [-2.6, 5.9] | 99% |
| ens⊕market (LOSO w) vs closing market | all seasons | 1084 | -0.0000 [-0.0000, -0.0000] | 0.0pp [0.0, 0.0] | 99% |
| ens⊕market (LOSO w) vs closing market | 2025 holdout | 271 | -0.0000 [-0.0000, 0.0000] | 0.0pp [0.0, 0.0] | 95% |
| ens⊕market (LOSO w) vs v2⊕brain (LOSO w) | all seasons | 1084 | -0.0295 [-0.0424, -0.0207] | 3.0pp [1.1, 4.3] | 100% |
| ens⊕market (LOSO w) vs v2⊕brain (LOSO w) | 2025 holdout | 271 | -0.0304 [-0.0517, -0.0096] | 1.5pp [-1.8, 5.9] | 100% |
| 25/75 ens⊕market vs closing market | all seasons | 1084 | 0.0034 [0.0011, 0.0067] | 0.6pp [-0.2, 1.4] | 0% |
| 25/75 ens⊕market vs closing market | 2025 holdout | 271 | 0.0034 [-0.0018, 0.0083] | 0.7pp [-1.1, 2.6] | 9% |

## Weights fit on all four seasons (for shipping)

- v2 weight in the v2⊕brain logit blend: **0.15** (brain 0.85)
- model weight in the ens⊕market logit blend: **0.00** (market 1.00)

- Model-vs-market disagreements: 179 of 1084 games; ensemble right 73, market right 106.
- Ensemble edges of 5+ points vs the market: 633 games; the ensemble side won 215 (34.0%).

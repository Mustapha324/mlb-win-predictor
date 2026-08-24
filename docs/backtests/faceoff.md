# Deployed GitHub models vs the new model — head to head

Generated 2026-08-24 by `npm run backtest -- all --faceoff`. Identical games, identical chronological replay; each model manages its own state exactly as its production code does.

- **GitHub MLB** ("diamond-elo-v4"): the deployed Elo + pretrained logistic, replayed with its exact hyperparameters and snapshot weights; the live pitcher ERA/WHIP adjustment is approximated with a runs-allowed-per-start proxy (WHIP neutral). Its logistic was trained through 2025-09-28, so **2022–2025 rows are in-sample for it** — the 2026 holdout is the only window that is out-of-sample for both sides.
- **GitHub NFL** ("nfl-elo-form-v1"): fully self-contained constants — fair on every window.
- **NEW model**: margin-of-victory Elo + Game Brain factors at shipped `DEFAULT_BRAIN_WEIGHTS`, frozen (no tuning during the faceoff).

## MLB

| window | games | GitHub W-L | GitHub acc | GitHub logloss | NEW W-L | NEW acc | NEW logloss |
|---|---|---|---|---|---|---|---|
| **overall** | 11699 | 6603-5096 | 56.4% | 0.6822 | 6656-5043 | 56.9% | 0.6796 |
| **final holdout (2026 — fair for both)** | 1965 | 1067-898 | 54.3% | 0.6894 | 1102-863 | 56.1% | 0.6865 |
| 2022 | 2431 | 1428-1003 | 58.7% | 0.6739 | 1428-1003 | 58.7% | 0.6737 |
| 2023 | 2437 | 1372-1065 | 56.3% | 0.6832 | 1369-1068 | 56.2% | 0.6805 |
| 2024 | 2432 | 1357-1075 | 55.8% | 0.6829 | 1378-1054 | 56.7% | 0.6804 |
| 2025 | 2434 | 1379-1055 | 56.7% | 0.6828 | 1379-1055 | 56.7% | 0.6781 |
| 2026 | 1965 | 1067-898 | 54.3% | 0.6894 | 1102-863 | 56.1% | 0.6865 |

## NFL

| window | games | GitHub W-L | GitHub acc | GitHub logloss | NEW W-L | NEW acc | NEW logloss |
|---|---|---|---|---|---|---|---|
| **overall** | 1084 | 688-396 | 63.5% | 0.6520 | 704-380 | 64.9% | 0.6363 |
| **final holdout (2025)** | 271 | 181-90 | 66.8% | 0.6359 | 173-98 | 63.8% | 0.6398 |
| 2022 | 269 | 158-111 | 58.7% | 0.6668 | 174-95 | 64.7% | 0.6425 |
| 2023 | 272 | 162-110 | 59.6% | 0.6887 | 173-99 | 63.6% | 0.6552 |
| 2024 | 272 | 187-85 | 68.8% | 0.6166 | 184-88 | 67.6% | 0.6079 |
| 2025 | 271 | 181-90 | 66.8% | 0.6359 | 173-98 | 63.8% | 0.6398 |

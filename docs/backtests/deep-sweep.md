# NFL deep-factor sweep — 14-agent scientific run (2026-08-24)

One-variable-at-a-time trials of ten "deep" factors — line play, coaching proxies, efficiency
skill, style matchups — run by parallel agents against the walk-forward lab (2021 burn-in,
train 2022–23, validation 2024, holdout 2025), with a parallel research fan-out and an
adversarial protocol reviewer. Every trial changed exactly one factor against an otherwise
frozen shipped configuration.

## Research findings (4 agents, sources in workflow transcript)

- **Pass protection is predictive; pass rush is noise.** ESPN player-tracking: pass-block win
  rate correlates with wins at r≈0.37–0.59; pass-rush win rate at r≈0.12. Sack rate allowed
  travels with the QB, not just the line.
- **4th-down aggressiveness is real but tiny** (~0.2–0.4 wins/season at team level — Romer 2006,
  Yam & Lopez 2019); too small to detect per game.
- **Third downs / first downs / time of possession are explanatory, not predictive** — they
  regress to efficiency already captured by margins (the literature matched our trial results
  one for one).
- **Interaction (style-matchup) features add little beyond additive strength** out of sample
  (Chen & Joachims 2016) — confirming the round-6 lesson.

## Trials (one agent per factor, isolated)

| factor | tuned weight | val logloss | verdict |
|---|---|---|---|
| sackMatchup (rush+protection) | ~0 | 0.60394 (= baseline) | reject — tuner found nothing |
| sacksAllowedGap (protection, counts) | 0.073 | 0.60378 | reject — sub-bar after re-baselining |
| sackRateAllowed (protection, per dropback) | 0.079 | 0.60410 | reject — worse than baseline |
| anyaGap (ANY/A differential) | ~0 | 0.60394 | reject — qbValue+pythag already carry it |
| penaltyDiscipline | 0.097 | 0.61157 | reject — clearly worse |
| thirdDown | 0.185 | 0.60533 | reject |
| fourthAggression | 0.200 | 0.60334 | reject — validation-only gain, holdout degrades (overfit signature) |
| modeEdge (style interaction) | 0.053 | 0.60524 | reject |
| possessionGap | 0.032 | 0.60477 | reject |
| firstDownsGap | 0 | 0.60394 | reject — tuner chose zero |

## The adversarial reviewer's catch (the most valuable output)

Two independent zero-weight runs pinned the true no-factor baseline at **0.60394** — below the
stale 0.60498 reference the trials were scored against. Re-baselined, both provisional keeps
failed, and the reviewer noted that with 8 tuned trials at a ±0.0003 bar, **1–2 chance "keeps"
were expected; we observed 2** — fully consistent with zero real signal. Batch 2 (the two
literature-strongest corrected candidates) confirmed it under a 0.001 Bonferroni-style bar.

**Protocol upgrades adopted permanently:** (1) the no-factor reference must be computed as a
zero-weight run *inside the trial configuration*; (2) holdout non-degradation is required
against that same zero-weight config; (3) the validation bar scales with the number of trials
in a batch, and correlated sibling factors count as one test family.

## Conclusion

The shipped core — Pythagorean strength, division damp, QB value, late-season damp, temperature
calibration — already absorbs everything these box-score-derivable "deep" factors carry.
Twenty-five candidates have now been tested across all rounds; the box-score well is
empirically dry. The remaining edge is live pregame information, which the capture ledger
accumulates daily.

*Note: Open-Meteo archive throttling left the sim's weather factor inert during this sweep
(consistent across all trials; ≤0.0001 logloss effect). Production weather uses the live
forecast endpoint and is unaffected.*

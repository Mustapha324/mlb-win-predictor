import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const artifact = JSON.parse(await readFile(new URL("../data/nfl-model-v2.json", import.meta.url), "utf8"));

test("production NFL artifact contains 15 complete chronological seasons", () => {
  assert.equal(artifact.modelVersion, "nfl-history-logit-v2");
  assert.equal(artifact.seasons.length, 15);
  assert.equal(artifact.trainingStart, 2011);
  assert.equal(artifact.trainedThrough, 2025);
  assert.ok(artifact.trainingGames >= 3_500);
  assert.equal(artifact.holdoutSeason, 2025);
  assert.ok(artifact.checkpoints[2025]);
  assert.ok(artifact.checkpoints[2026]);
});

test("NFL holdout metrics are finite and beat the stored baseline", () => {
  const metrics = artifact.holdoutMetrics;
  assert.ok(metrics.games >= 250);
  assert.ok(metrics.accuracy > metrics.homeWinBaseline);
  assert.ok(metrics.brierScore > 0 && metrics.brierScore < 0.25);
  assert.ok(metrics.logLoss > 0 && metrics.logLoss < 0.7);
  assert.equal(artifact.checkpoints[2026].coefficients.length, artifact.features.length);
});

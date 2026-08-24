import assert from "node:assert/strict";
import test from "node:test";
import {
  applyLogitDelta,
  bucketInjuryStatus,
  combineFactors,
  formEdge,
  injuryBurden,
  isQbOut,
  MAX_BRAIN_LOGIT,
  nflPositionWeight,
  percentileRank,
  weatherSeverity
} from "../lib/server/brain/brainScoring.ts";

test("status strings from MLB and ESPN map into buckets", () => {
  assert.equal(bucketInjuryStatus("Injured 10-Day"), "il_short");
  assert.equal(bucketInjuryStatus("Injured 60-Day"), "il_long");
  assert.equal(bucketInjuryStatus("Injured Reserve"), "il_long");
  assert.equal(bucketInjuryStatus("Out"), "out");
  assert.equal(bucketInjuryStatus("Questionable"), "questionable");
  assert.equal(bucketInjuryStatus("Day-To-Day"), "day_to_day");
  assert.equal(bucketInjuryStatus("Active"), null);
});

test("QB injuries dominate NFL burden the way books treat them", () => {
  assert.equal(nflPositionWeight("QB"), 1);
  assert.ok(nflPositionWeight("QB") > nflPositionWeight("WR") * 3);
  const qbOut = injuryBurden([{ position: "QB", status: "out" }], "nfl");
  const wrOut = injuryBurden([{ position: "WR", status: "out" }], "nfl");
  assert.ok(qbOut > wrOut * 2, "a QB out must outweigh a WR out");
  assert.equal(isQbOut([{ playerName: "Q", position: "QB", status: "questionable", detail: null }]), false, "questionable is not out");
  assert.equal(isQbOut([{ playerName: "Q", position: "QB", status: "out", detail: null }]), true);
});

test("burden saturates instead of growing without bound", () => {
  const pile = Array.from({ length: 20 }, () => ({ position: "WR", status: "out" }));
  const burden = injuryBurden(pile, "nfl");
  assert.ok(burden > 0.9 && burden <= 1);
});

test("weather severity only reacts to extremes", () => {
  assert.equal(weatherSeverity({ tempF: 72, windMph: 6, gustMph: 10, precipProbability: 0.1, snowfall: false }), 0);
  const gale = weatherSeverity({ tempF: 20, windMph: 24, gustMph: 35, precipProbability: 0.8, snowfall: true });
  assert.ok(gale >= 0.9);
});

test("shadow adjustment is clamped and reversible", () => {
  const big = combineFactors([
    { label: "a", detail: "", homeLogit: 0.5 },
    { label: "b", detail: "", homeLogit: 0.4 }
  ]);
  assert.equal(big.logitDelta, MAX_BRAIN_LOGIT);
  const shifted = applyLogitDelta(0.55, MAX_BRAIN_LOGIT);
  assert.ok(shifted > 0.55 && shifted < 0.65, "cap keeps the shift under ~9 points");
  assert.equal(applyLogitDelta(0.55, 0), 0.55);
  const tiny = combineFactors([{ label: "noise", detail: "", homeLogit: 0.001 }]);
  assert.equal(tiny.factors.length, 0, "noise factors are dropped");
});

test("form edge rewards the hotter, more rested side and stays small", () => {
  const hot = { lastTenWins: 8, lastTenGames: 10, streak: 5, restDays: 2 };
  const cold = { lastTenWins: 2, lastTenGames: 10, streak: -4, restDays: 0 };
  const edge = formEdge(hot, cold);
  assert.ok(edge > 0 && edge < 0.15, "form nudges, never dominates");
  assert.equal(formEdge(hot, hot), 0);
});

test("percentile ranks are league-relative", () => {
  const peers = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  assert.ok(percentileRank(9, peers) > 90);
  assert.ok(percentileRank(1, peers) < 15);
  assert.ok(percentileRank(3, peers, false) > percentileRank(3, peers), "inverted metrics flip the rank");
});

import assert from "node:assert/strict";
import test from "node:test";
import { evaluateMlbHitterEligibility, evaluateNflEligibility } from "../lib/server/pickEligibility.ts";

const nfl = (overrides) => evaluateNflEligibility({
  market: "Passing yards",
  position: "QB",
  rosterStatus: "Active",
  injuryStatus: null,
  depthRank: 1,
  depthChartAvailable: true,
  ...overrides
});

test("NFL backups and non-roster players are never picks", () => {
  assert.equal(nfl({ depthRank: 2 }).eligible, false, "backup quarterback");
  assert.equal(nfl({ depthRank: null }).eligible, false, "not on the depth chart");
  assert.equal(nfl({ rosterStatus: null }).eligible, false, "left the roster");
  assert.equal(nfl({ rosterStatus: "Practice Squad" }).eligible, false);
  assert.equal(nfl({ rosterStatus: "Injured Reserve" }).eligible, false);
  assert.equal(nfl({ market: "Rushing yards", position: "RB", depthRank: 3 }).eligible, false, "third running back");
  assert.equal(nfl({ market: "Receiving yards", position: "TE", depthRank: 2 }).eligible, false, "second tight end");
  assert.equal(nfl({ market: "Receiving yards", position: "WR", depthRank: 4 }).eligible, false, "fourth receiver");
  assert.equal(nfl({ market: "Passing yards", position: "WR" }).eligible, false, "a receiver has no passing line");
});

test("NFL injuries: out and doubtful are refused, questionable is flagged and discounted", () => {
  assert.equal(nfl({ injuryStatus: "Out" }).eligible, false);
  assert.equal(nfl({ injuryStatus: "Doubtful" }).eligible, false);
  const questionable = nfl({ injuryStatus: "Questionable" });
  assert.equal(questionable.eligible, true);
  assert.equal(questionable.confidenceMultiplier, 0.92);
  assert.match(questionable.note, /questionable/i);
});

test("NFL starter-tier roles pass with the right depth and get small haircuts for secondary roles", () => {
  assert.deepEqual(nfl({}), { eligible: true, reason: null, confidenceMultiplier: 1, note: null });
  assert.equal(nfl({ market: "Receiving yards", position: "WR", depthRank: 3 }).confidenceMultiplier, 1, "WR3 is a full-time role");
  const rb2 = nfl({ market: "Rushing yards", position: "RB", depthRank: 2 });
  assert.equal(rb2.eligible, true);
  assert.equal(rb2.confidenceMultiplier, 0.95);
  assert.equal(nfl({ market: "Rush+Rec TDs", position: "QB", depthRank: 1 }).eligible, true);
  const noChart = nfl({ depthChartAvailable: false, depthRank: null });
  assert.equal(noChart.eligible, true, "no chart means box-score inference with a haircut, not a refusal");
  assert.equal(noChart.confidenceMultiplier, 0.9);
});

test("MLB hitters must be on the active roster and either in the lineup or everyday players", () => {
  const base = { onActiveRoster: true, lineupIds: null, playerId: "1", gamesPlayed: 120, teamGames: 140, plateAppearances: 500 };
  assert.equal(evaluateMlbHitterEligibility(base).eligible, true);
  assert.equal(evaluateMlbHitterEligibility({ ...base, onActiveRoster: false }).eligible, false);
  assert.equal(evaluateMlbHitterEligibility({ ...base, lineupIds: new Set(["2", "3"]) }).eligible, false, "lineup posted without them");
  assert.equal(evaluateMlbHitterEligibility({ ...base, lineupIds: new Set(["1", "3"]) }).note, "Confirmed in the posted lineup");
  assert.equal(evaluateMlbHitterEligibility({ ...base, gamesPlayed: 12, plateAppearances: 40 }).eligible, false, "call-up sample");
  assert.equal(evaluateMlbHitterEligibility({ ...base, gamesPlayed: 90, plateAppearances: 150 }).eligible, false, "pinch-hit usage");
  assert.equal(evaluateMlbHitterEligibility({ ...base, gamesPlayed: 80 }).eligible, false, "under 70% of team games");
  const nearEveryday = evaluateMlbHitterEligibility({ ...base, gamesPlayed: 105 });
  assert.equal(nearEveryday.eligible, true);
  assert.equal(nearEveryday.confidenceMultiplier, 0.95);
});

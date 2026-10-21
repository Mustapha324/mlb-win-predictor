import assert from "node:assert/strict";
import test from "node:test";
import { modelProbability, ratingChange, ratingsBefore, winProbability } from "../lib/nbaPrediction.ts";

test("NBA ratings use completed games before the cutoff only", () => {
  const games = [
    { id: "late", date: "2026-10-22T23:00:00Z", homeId: "A", awayId: "B", homeScore: 90, awayScore: 120 },
    { id: "early", date: "2026-10-18T23:00:00Z", homeId: "A", awayId: "B", homeScore: 120, awayScore: 90 }
  ];
  const before = ratingsBefore(games, "2026-10-20T00:00:00Z");
  assert.ok(before.get("A") > 1500);
  assert.ok(before.get("B") < 1500);
  assert.deepEqual(before, ratingsBefore([games[1]], "2026-10-20T00:00:00Z"));
  assert.equal(modelProbability(new Map(), "A", "B"), null);
});

test("NBA model preserves home advantage and finite probabilities", () => {
  assert.ok(winProbability(1500, 1500) > 0.5);
  assert.ok(winProbability(1500, 1700) < 0.5);
  const value = modelProbability(new Map([["A", 2500], ["B", 500]]), "A", "B");
  assert.equal(value, 0.9);
});

test("NBA ratings ignore repeated events and corrupt scores", () => {
  const valid = { id: "1", date: "2026-10-18T23:00:00Z", homeId: "A", awayId: "B", homeScore: 120, awayScore: 90 };
  const baseline = ratingsBefore([valid], "2026-10-20");
  assert.deepEqual(ratingsBefore([valid, valid, { ...valid, id: "bad", homeScore: NaN }, { ...valid, id: "negative", awayScore: -1 }], "2026-10-20"), baseline);
  assert.equal(modelProbability(new Map([["A", NaN], ["B", 1500]]), "A", "B"), null);
  assert.equal(modelProbability(baseline, "A", "A"), null);
});

test("NBA margin ratings learn more from decisive wins and discount expected blowouts", () => {
  assert.ok(ratingChange(1500, 1500, 120, 90) > ratingChange(1500, 1500, 101, 100));
  assert.ok(ratingChange(1700, 1500, 120, 90) < ratingChange(1500, 1700, 120, 90));
  const ratings = ratingsBefore([{ id: "final", date: "2026-10-18T23:00:00Z", homeId: "A", awayId: "B", homeScore: 120, awayScore: 90 }], "2026-10-20");
  assert.equal(ratings.get("A"), 1500 + ratingChange(1500, 1500, 120, 90));
  assert.equal(ratings.get("A") + ratings.get("B"), 3000);
});

test("NBA history compares instants rather than timezone-formatted strings", () => {
  const row = { id: "offset", date: "2026-10-19T23:30:00-03:00", homeId: "A", awayId: "B", homeScore: 120, awayScore: 90 };
  assert.equal(ratingsBefore([row], "2026-10-20T00:00:00Z").size, 0);
  assert.equal(ratingsBefore([{ ...row, date: "2026-10-20T00:30:00+03:00" }], "2026-10-20T00:00:00Z").size, 2);
});

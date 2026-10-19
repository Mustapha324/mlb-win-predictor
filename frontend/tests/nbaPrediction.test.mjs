import assert from "node:assert/strict";
import test from "node:test";
import { modelProbability, ratingsBefore, winProbability } from "../lib/nbaPrediction.ts";

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

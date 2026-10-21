import assert from "node:assert/strict";
import test from "node:test";
import { estimateNbaProp, parseNbaGameLog } from "../lib/nbaPlayerModel.ts";
import { gameProgress, gradePlayerPick } from "../lib/server/playerPickScoring.ts";
import { parseEspnPropBets } from "../lib/sportsbookPropParsing.ts";

test("NBA form excludes future games, DNPs, preseason and duplicate categories", () => {
  const row = { eventId: "past", stats: ["31", "25", "8", "7", "3-7"] };
  const payload = { names: ["minutes", "points", "totalRebounds", "assists", "threePointFieldGoalsMade-threePointFieldGoalsAttempted"], events: { past: { gameDate: "2026-10-18T23:00Z", gameResult: "W" }, future: { gameDate: "2026-10-22T23:00Z", gameResult: "L" }, dnp: { gameDate: "2026-10-17T23:00Z", gameResult: "W" } }, seasonTypes: [{ displayName: "Regular Season", categories: [{ events: [row, row, { eventId: "future", stats: ["35", "99", "8", "7", "3-7"] }, { eventId: "dnp", stats: ["DNP", "0", "0", "0", "0-0"] }] }] }, { displayName: "Preseason", categories: [{ events: [{ eventId: "preseason", stats: row.stats }] }] }] };
  const samples = parseNbaGameLog(payload, "2026-10-20T00:00Z");
  assert.equal(samples.length, 1);
  assert.equal(samples[0].values.points, 25);
  assert.equal(samples[0].values["threePointFieldGoalsMade-threePointFieldGoalsAttempted"], 3);
});

test("NBA player estimates require established minutes and never confuse made threes with attempts", () => {
  const samples = Array.from({ length: 20 }, (_, i) => ({ id: String(i), date: "2026-10-18", minutes: 30, values: { points: 25, totalRebounds: 8, assists: 7, "threePointFieldGoalsMade-threePointFieldGoalsAttempted": 3 } }));
  assert.equal(estimateNbaProp(samples.slice(0, 9), "Points", 20.5), null);
  assert.equal(estimateNbaProp(samples.map(row => ({ ...row, minutes: 5 })), "Points", 20.5), null);
  const combined = estimateNbaProp(samples, "Points+Rebounds+Assists", 37.5);
  assert.equal(combined.projection, 40);
  assert.equal(combined.selection, "Over");
  assert.ok(combined.confidence <= 0.72);
  assert.equal(estimateNbaProp(samples, "3-pointers", 3.5).selection, "Under");
  assert.equal(estimateNbaProp(samples, "Unknown", 1.5), null);
});

test("NBA real prop pairs, live clock and final grading use basketball rules", () => {
  const item = { athlete: { $ref: "https://sports.core.api.espn.com/athletes/1966" }, type: { id: "1" }, current: { target: { value: 24.5 } }, lastUpdated: "2026-10-20T12:00Z", odds: { american: { value: "-110" } } };
  const line = parseEspnPropBets("nba", [item, { ...item, odds: { american: { value: "-115" } } }]).get("1966").get("Points");
  assert.equal(line.line, 24.5); assert.equal(line.overOdds, -110); assert.equal(line.underOdds, -115);
  assert.equal(gameProgress("nba", "live", "6:00 - 3rd"), 0.625);
  assert.equal(gradePlayerPick("Over", 24.5, 25, "final"), "correct");
  assert.equal(gradePlayerPick("Under", 3.5, 4, "final"), "incorrect");
  assert.equal(gradePlayerPick("Over", 24, 24, "final"), "push");
  assert.equal(gradePlayerPick("Over", 24.5, null, "final", false), "void");
});

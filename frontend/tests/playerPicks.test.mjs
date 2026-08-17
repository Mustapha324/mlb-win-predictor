import assert from "node:assert/strict";
import test from "node:test";
import { applyPlayerPickAccess } from "../lib/server/playerPickAccess.ts";
import { calculatePerformance, gradePlayerPick, isValidPickDate, pickStatus } from "../lib/server/playerPickScoring.ts";

function pick(rank) {
  return {
    id: `pick-${rank}`,
    sport: "mlb",
    rank,
    gameId: "1",
    playerId: String(rank),
    playerName: `Player ${rank}`,
    headshotUrl: null,
    position: "OF",
    team: "Home",
    opponent: "Away",
    gameTime: "2026-08-17T23:00:00Z",
    market: "Hits",
    selection: "Over",
    line: 0.5,
    projection: 1.1,
    confidence: 0.64,
    supportingStats: [],
    explanation: "Test",
    modelVersion: "test-v1",
    modelEdge: 0.6,
    sampleSize: 10,
    status: "scheduled",
    statusLabel: "Scheduled",
    actualValue: null,
    result: "pending",
    resultUpdatedAt: null,
    isTopFive: rank <= 5,
    is_locked: false
  };
}

test("date validation rejects rollover and out-of-range values", () => {
  assert.equal(isValidPickDate("2026-08-17"), true);
  assert.equal(isValidPickDate("2026-02-30"), false);
  assert.equal(isValidPickDate("not-a-date"), false);
  assert.equal(isValidPickDate("2040-01-01"), false);
});

test("game status recognizes live, final, and postponed states", () => {
  assert.equal(pickStatus("Q3 05:14", false), "live");
  assert.equal(pickStatus("Final", true), "final");
  assert.equal(pickStatus("Postponed", false), "postponed");
  assert.equal(pickStatus("Scheduled", false), "scheduled");
});

test("player picks grade only when a game is final", () => {
  assert.equal(gradePlayerPick("Over", 1.5, 2, "live"), "pending");
  assert.equal(gradePlayerPick("Over", 1.5, 2, "final"), "correct");
  assert.equal(gradePlayerPick("Under", 1.5, 2, "final"), "incorrect");
  assert.equal(gradePlayerPick("Over", 2, 2, "final"), "push");
  assert.equal(gradePlayerPick("Under", 1.5, null, "final", false), "void");
  assert.equal(gradePlayerPick("Over", 1.5, null, "postponed"), "void");
});

test("free access returns only ranks 6 through 10 and never leaks the top five", () => {
  const board = Array.from({ length: 40 }, (_, index) => pick(index + 1));
  const free = applyPlayerPickAccess(board, false);
  assert.deepEqual(free.map((item) => item.rank), [6, 7, 8, 9, 10]);
  assert.equal(free.some((item) => item.rank <= 5), false);
  assert.equal(applyPlayerPickAccess(board, true).length, 40);
});

test("performance keeps overall and premium top-five accuracy separate", () => {
  const results = [
    { ...pick(1), result: "correct" },
    { ...pick(2), result: "incorrect" },
    { ...pick(6), result: "correct" },
    { ...pick(7), result: "push" },
    { ...pick(8), result: "void" }
  ];
  const performance = calculatePerformance(results);
  assert.equal(performance.graded, 3);
  assert.equal(performance.correct, 2);
  assert.equal(performance.topFiveGraded, 2);
  assert.equal(performance.topFiveCorrect, 1);
  assert.equal(performance.pushes, 1);
  assert.equal(performance.voids, 1);
});

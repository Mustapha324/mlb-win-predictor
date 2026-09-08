import assert from "node:assert/strict";
import test from "node:test";
import { applyPlayerPickAccess } from "../lib/server/playerPickAccess.ts";
import { calculatePerformance, gradePlayerPick, isValidPickDate, mergePlayerPickResults, pickStatus } from "../lib/server/playerPickScoring.ts";
import { compilePlayerPropQuotes, normalizePlayerName, playerPropKey } from "../lib/playerPropOdds.ts";

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

test("current final picks appear in results and replace an older stored copy", () => {
  const older = { ...pick(6), result: "incorrect", resultUpdatedAt: "2026-08-26T03:00:00Z" };
  const current = { ...pick(6), result: "correct", resultUpdatedAt: "2026-08-27T03:00:00Z" };
  const another = { ...pick(7), result: "push", resultUpdatedAt: "2026-08-27T02:00:00Z" };
  const pending = { ...pick(8), result: "pending", resultUpdatedAt: null };
  const merged = mergePlayerPickResults([older], [current, another, pending]);
  assert.deepEqual(merged.map((item) => [item.rank, item.result]), [[6, "correct"], [7, "push"]]);
});

test("sportsbook prop consensus uses the widely posted line and best captured payout", () => {
  const quotes = compilePlayerPropQuotes("nfl", "game-1", [
    {
      key: "book-a",
      title: "Book A",
      markets: [{
        key: "player_pass_yds",
        last_update: "2026-08-24T18:00:00Z",
        outcomes: [
          { name: "Over", description: "Patrick Mahomes II", point: 250.5, price: 1.91 },
          { name: "Under", description: "Patrick Mahomes II", point: 250.5, price: 1.91 }
        ]
      }]
    },
    {
      key: "book-b",
      title: "Book B",
      markets: [{
        key: "player_pass_yds",
        last_update: "2026-08-24T18:01:00Z",
        outcomes: [
          { name: "Over", description: "Patrick Mahomes", point: 250.5, price: 2.05 },
          { name: "Under", description: "Patrick Mahomes", point: 250.5, price: 1.8 }
        ]
      }]
    },
    {
      key: "book-c",
      title: "Book C",
      markets: [{
        key: "player_pass_yds",
        outcomes: [
          { name: "Over", description: "Patrick Mahomes", point: 249.5, price: 2.2 },
          { name: "Under", description: "Patrick Mahomes", point: 249.5, price: 1.7 }
        ]
      }]
    }
  ]);
  const quote = quotes.get(playerPropKey("game-1", "Patrick Mahomes", "Passing yards"));
  assert.equal(normalizePlayerName("Patrick Mahomes II"), normalizePlayerName("Patrick Mahomes"));
  assert.equal(quote?.line, 250.5);
  assert.equal(quote?.books, 2);
  assert.equal(quote?.overAmericanOdds, 105);
  assert.equal(quote?.overBook, "Book B");
  assert.equal(quote?.updatedAt, "2026-08-24T18:01:00Z");
});

test("game progress reads innings and quarter clocks", async () => {
  const { gameProgress } = await import("../lib/server/playerPickScoring.ts");
  assert.equal(gameProgress("mlb", "scheduled", "Scheduled"), 0);
  assert.equal(gameProgress("mlb", "final", "Final"), 1);
  assert.ok(Math.abs(gameProgress("mlb", "live", "Bottom 7th") - (6.75 / 9)) < 1e-9);
  assert.ok(Math.abs(gameProgress("mlb", "live", "Top 1st") - (0.25 / 9)) < 1e-9);
  assert.ok(Math.abs(gameProgress("nfl", "live", "Q3 05:14") - ((2 * 900 + (900 - 314)) / 3600)) < 1e-9);
  assert.equal(gameProgress("nfl", "live", "Halftime"), 0.5);
  assert.equal(gameProgress("nfl", "live", "OT 4:00"), 0.97);
});

test("live pace classifies cleared, on-pace, behind, busted, and settled picks", async () => {
  const { livePace, summarizeLive } = await import("../lib/server/playerPickScoring.ts");
  assert.equal(livePace("Over", 1.5, 2, 0.5, "live", "pending").state, "cleared");
  assert.equal(livePace("Over", 60.5, 40, 0.5, "live", "pending").state, "on_pace");
  assert.equal(livePace("Over", 60.5, 10, 0.75, "live", "pending").state, "behind");
  assert.equal(livePace("Under", 60.5, 61, 0.4, "live", "pending").state, "busted");
  assert.equal(livePace("Under", 60.5, 20, 0.5, "live", "pending").state, "on_pace");
  assert.equal(livePace("Under", 60.5, 45, 0.5, "live", "pending").state, "behind");
  assert.equal(livePace("Over", 1.5, null, 0.3, "live", "pending").state, "pending");
  assert.equal(livePace("Over", 1.5, null, 0, "scheduled", "pending").state, "pending");
  const settled = livePace("Over", 1.5, 2, 1, "final", "correct");
  assert.equal(settled.state, "final");
  assert.equal(settled.label, "Hit");
  const summary = summarizeLive([
    { status: "live", result: "pending", live: { state: "cleared" } },
    { status: "live", result: "pending", live: { state: "behind" } },
    { status: "final", result: "correct", live: { state: "final" } },
    { status: "scheduled", result: "pending", live: null }
  ]);
  assert.deepEqual(summary, { total: 4, scheduled: 1, live: 2, final: 1, cleared: 1, onPace: 0, behind: 1, busted: 0, correct: 1, incorrect: 0 });
});

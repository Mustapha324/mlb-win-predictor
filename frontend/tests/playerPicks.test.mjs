import assert from "node:assert/strict";
import test from "node:test";
import { publicPlayerPicks, publicPlayerResults } from "../lib/server/playerPickAccess.ts";
import { calculatePerformance, gradePlayerPick, isValidPickDate, pickStatus } from "../lib/server/playerPickScoring.ts";
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

test("guests receive the entire player board, including top five and ranks beyond ten", () => {
  const board = Array.from({ length: 40 }, (_, index) => pick(index + 1));
  const visible = publicPlayerPicks(board);
  assert.deepEqual(visible, board);
  assert.equal(visible.length, 40);
  assert.equal(visible.filter((item) => item.isTopFive).length, 5);
  assert.equal(visible.some((item) => item.is_locked), false);
});

test("guest result history preserves top-five and lower-ranked results without altering stored rows", () => {
  const board = Array.from({ length: 40 }, (_, index) => ({ ...pick(index + 1), is_locked: true }));
  const visible = publicPlayerResults(board, 24);
  assert.deepEqual(visible.map((item) => item.rank), Array.from({ length: 24 }, (_, index) => index + 1));
  assert.equal(visible.some((item) => item.is_locked), false);
  assert.equal(board.every((item) => item.is_locked), true);
});

test("performance keeps overall and top-five accuracy separate", () => {
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

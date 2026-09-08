import assert from "node:assert/strict";
import test from "node:test";
import {
  boardCountLine,
  diversifyBoard,
  isBoardRealisticConfidence,
  isBoardSelectionAllowed,
  MLB_HITTER_MARKETS,
  mlbBoardLine,
  NFL_MARKETS,
  nflBoardLine,
  RARE_EVENT_MARKETS,
  RARE_EVENT_SLATE_CAP
} from "../lib/server/propBoardCatalog.ts";

const marketDef = (list, market) => list.find((item) => item.market === market);

test("board lines sit adjacent to the projected median in 0.5 steps", () => {
  assert.equal(boardCountLine(1.7, [0.5, 2.5]), 1.5);
  assert.equal(boardCountLine(1.2, [0.5, 2.5]), 0.5);
  assert.equal(boardCountLine(4.8, [3.5, 9.5]), 4.5);
  assert.equal(boardCountLine(12.4, [3.5, 9.5]), 9.5);
});

test("thin projections are not board-listed instead of becoming freebie lines", () => {
  const hits = marketDef(MLB_HITTER_MARKETS, "Hits");
  assert.equal(mlbBoardLine(hits, 0.6), null);
  assert.equal(mlbBoardLine(hits, 1.15), 0.5);
  assert.equal(mlbBoardLine(hits, 1.7), 1.5);
  const homeRuns = marketDef(MLB_HITTER_MARKETS, "Home runs");
  assert.equal(mlbBoardLine(homeRuns, 0.1), null, "non-sluggers have no HR prop at all");
  assert.equal(mlbBoardLine(homeRuns, 0.28), 0.5);
});

test("unders on 0.5 lines and rare-event unders are never sellable picks", () => {
  assert.equal(isBoardSelectionAllowed("Home runs", 0.5, "Under"), false);
  assert.equal(isBoardSelectionAllowed("Hits", 0.5, "Under"), false);
  assert.equal(isBoardSelectionAllowed("Home runs", 1.5, "Under"), false);
  assert.equal(isBoardSelectionAllowed("Home runs", 0.5, "Over"), true);
  assert.equal(isBoardSelectionAllowed("Hits", 1.5, "Under"), true);
  assert.equal(isBoardSelectionAllowed("Strikeouts", 5.5, "Under"), true);
});

test("standard picks must sit in the contested band a full-payout square occupies", () => {
  assert.equal(isBoardRealisticConfidence(0.51, false), false, "no edge, no pick");
  assert.equal(isBoardRealisticConfidence(0.62, false), true);
  assert.equal(isBoardRealisticConfidence(0.76, false), false, "near-locks mean the line is off-board");
  assert.equal(isBoardRealisticConfidence(0.76, true), true, "a real board line widens the band");
  assert.equal(isBoardRealisticConfidence(0.82, true), false);
});

test("NFL lines use board granularity and drop thin roles", () => {
  const rushing = marketDef(NFL_MARKETS, "Rushing yards");
  assert.equal(nflBoardLine(rushing, 67.2)?.line, 66.5);
  assert.equal(nflBoardLine(rushing, 12), null, "backup backs are not board-listed");
  const passingTds = marketDef(NFL_MARKETS, "Passing touchdowns");
  assert.equal(nflBoardLine(passingTds, 2.4)?.line, 2.5);
  assert.equal(nflBoardLine(passingTds, 1.4)?.line, 1.5);
  for (const definition of NFL_MARKETS) {
    const result = nflBoardLine(definition, definition.minAverage + 5);
    if (result) assert.equal(Math.abs((result.line % 1) - 0.5) < 1e-9, true, `${definition.market} line ends in .5`);
  }
});

test("rare boost picks are capped and can never crowd the headline board", () => {
  const standard = Array.from({ length: 10 }, (_, index) => ({
    id: `standard-${index}`,
    playerId: `player-${index}`,
    market: index % 2 ? "Hits" : "Strikeouts",
    confidence: 0.7 - index * 0.01,
    modelEdge: 0.4
  }));
  const rare = Array.from({ length: 4 }, (_, index) => ({
    id: `rare-${index}`,
    playerId: `slugger-${index}`,
    market: "Home runs",
    confidence: 0.99,
    modelEdge: 0.2
  }));
  const board = diversifyBoard([...rare, ...standard], { top: 5, freePreview: 3, maximum: 12 });
  const rareOnBoard = board.filter((pick) => RARE_EVENT_MARKETS.has(pick.market));
  assert.equal(rareOnBoard.length, RARE_EVENT_SLATE_CAP);
  assert.equal(board.slice(0, 5).some((pick) => RARE_EVENT_MARKETS.has(pick.market)), false);
  assert.deepEqual(board.slice(-2).map((pick) => pick.market), ["Home runs", "Home runs"], "rare picks rank at the bottom");
  assert.equal(new Set(board.slice(0, 5).map((pick) => pick.playerId)).size, 5, "top five stays player-diverse");
});

test("headline slots skip picks that fail the price gate but still fill the board with them", async () => {
  const { isSellablePrice, MAX_PICK_JUICE } = await import("../lib/server/propBoardCatalog.ts");
  assert.equal(MAX_PICK_JUICE, -160);
  assert.equal(isSellablePrice(null), true);
  assert.equal(isSellablePrice(-160), true);
  assert.equal(isSellablePrice(-230), false);
  assert.equal(isSellablePrice(120), true);
  const candidates = Array.from({ length: 12 }, (_, index) => ({
    id: `pick-${index}`,
    playerId: `player-${index}`,
    market: index % 2 ? "Hits" : "Total bases",
    confidence: 0.75 - index * 0.01,
    modelEdge: 0.3,
    headline: index >= 4
  }));
  const board = diversifyBoard(candidates, { top: 5, freePreview: 5, maximum: 40 }, { headline: (pick) => pick.headline });
  assert.deepEqual(board.slice(0, 5).map((pick) => pick.id), ["pick-4", "pick-5", "pick-6", "pick-7", "pick-8"]);
  assert.ok(board.some((pick) => pick.id === "pick-0"), "heavily juiced picks still appear lower on the board");
});

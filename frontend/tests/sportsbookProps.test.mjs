import assert from "node:assert/strict";
import test from "node:test";
import { fairOverProbability, parseDkPropMarkets, parseEspnPropBets } from "../lib/sportsbookPropParsing.ts";
import { parseNflDepthChart, parseNflRoster } from "../lib/nflRosterParsing.ts";

const athlete = (id) => ({ $ref: `http://sports.core.api.espn.com/v2/sports/baseball/leagues/mlb/seasons/2026/athletes/${id}?lang=en` });

test("MLB propBets pair consecutive over/under prices on the same line", () => {
  const board = parseEspnPropBets("mlb", [
    { athlete: athlete("32801"), type: { id: "53", name: "Total Hits" }, lastUpdated: "2026-09-08T05:10Z", current: { target: { value: 0.5 } }, open: { target: { value: 0.5 } }, odds: { american: { value: "-230", open: "-244" } } },
    { athlete: athlete("32801"), type: { id: "53", name: "Total Hits" }, lastUpdated: "2026-09-08T05:10Z", current: { target: { value: 0.5 } }, open: { target: { value: 0.5 } }, odds: { american: { value: "+171", open: "+180" } } },
    { athlete: athlete("32801"), type: { id: "240", name: "Home Runs Milestones" }, current: { target: { value: 1 } }, odds: { american: { value: "+428" } } },
    { athlete: athlete("32801"), type: { id: "999", name: "Unknown market" }, current: { target: { value: 3.5 } } }
  ]);
  const player = board.get("32801");
  assert.ok(player);
  assert.deepEqual([...player.keys()], ["Hits", "Home runs"]);
  const hits = player.get("Hits");
  assert.equal(hits.line, 0.5);
  assert.equal(hits.overOdds, -230);
  assert.equal(hits.underOdds, 171);
  assert.equal(hits.updatedAt, "2026-09-08T05:10Z");
  const homers = player.get("Home runs");
  assert.equal(homers.line, 0.5, "milestone squares are yes/no props at 0.5");
  assert.equal(homers.overOdds, 428);
  assert.equal(homers.underOdds, null);
});

test("NFL propBets carry lines only and anytime touchdown items become 0.5 lines", () => {
  const nfl = (id) => ({ $ref: `http://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2026/athletes/${id}?lang=en` });
  const board = parseEspnPropBets("nfl", [
    { athlete: nfl("3912547"), type: { id: "8", name: "Total Passing Yards (incl. overtime)" }, current: { target: { value: 228.5 } }, open: { target: { value: 229.5 } } },
    { athlete: nfl("2975863"), type: { id: "31", name: "Anytime Touchdown Scorer" }, current: {}, open: {} },
    { athlete: nfl("2975863"), type: { id: "29", name: "First Touchdown Scorer" }, current: {} }
  ]);
  const passer = board.get("3912547").get("Passing yards");
  assert.equal(passer.line, 228.5);
  assert.equal(passer.openLine, 229.5);
  assert.equal(passer.overOdds, null);
  assert.equal(board.get("2975863").get("Rush+Rec TDs").line, 0.5);
  assert.equal(board.get("2975863").has("First Touchdown Scorer"), false);
});

test("DraftKings markets map O/U types and anytime touchdown prices by player name", () => {
  const board = parseDkPropMarkets(
    [
      { id: "m1", name: "Rhamondre Stevenson Rushing Yards O/U", marketType: { name: "Rushing Yards O/U" } },
      { id: "m2", name: "Anytime Touchdown Scorer", marketType: { name: "Anytime Touchdown Scorer" } },
      { id: "m3", name: "Drake Maye Longest Completion O/U", marketType: { name: "Longest Passing Completion O/U" } }
    ],
    [
      { marketId: "m1", label: "Over", points: 58.5, outcomeType: "Over", displayOdds: { american: "−114" }, participants: [{ name: "Rhamondre Stevenson" }] },
      { marketId: "m1", label: "Under", points: 58.5, outcomeType: "Under", displayOdds: { american: "−110" }, participants: [{ name: "Rhamondre Stevenson" }] },
      { marketId: "m2", label: "Rhamondre Stevenson", displayOdds: { american: "+120" }, participants: [{ name: "Rhamondre Stevenson" }] },
      { marketId: "m3", label: "Over", points: 38.5, outcomeType: "Over", displayOdds: { american: "−115" }, participants: [{ name: "Drake Maye" }] }
    ]
  );
  const stevenson = board.get("rhamondrestevenson");
  assert.ok(stevenson);
  assert.deepEqual(stevenson.get("Rushing yards"), { market: "Rushing yards", line: 58.5, openLine: null, overOdds: -114, underOdds: -110, updatedAt: null });
  assert.equal(stevenson.get("Rush+Rec TDs").overOdds, 120);
  assert.equal(board.has("drakemaye"), false, "unsupported market types are ignored");
});

test("fair over probability strips the vig when both prices exist", () => {
  assert.equal(fairOverProbability({ overOdds: -114, underOdds: -110 }).toFixed(3), "0.504");
  assert.equal(fairOverProbability({ overOdds: 428, underOdds: null }).toFixed(3), "0.189");
  assert.equal(fairOverProbability({ overOdds: null, underOdds: null }), null);
});

test("roster parsing keys status off the roster group and keeps only fresh injuries", () => {
  const now = Date.parse("2026-09-08T12:00:00Z");
  const players = parseNflRoster({
    athletes: [
      { position: "offense", items: [
        { id: "1", displayName: "Starter QB", position: { abbreviation: "QB" }, status: { name: "Active" }, injuries: [{ status: "Out", date: "2026-07-01T00:00:00Z" }] },
        { id: "2", displayName: "Nicked WR", position: { abbreviation: "WR" }, status: { name: "Day-To-Day" }, injuries: [] },
        { id: "3", displayName: "Hurt RB", position: { abbreviation: "RB" }, status: { name: "Active" }, injuries: [{ status: "Questionable", date: "2026-09-01T00:00:00Z" }, { status: "Out", date: "2026-09-06T00:00:00Z" }] }
      ] },
      { position: "practiceSquad", items: [{ id: "4", displayName: "PS WR", position: { abbreviation: "WR" }, status: { name: "Practice Squad" } }] },
      { position: "injuredReserveOrOut", items: [{ id: "5", displayName: "IR TE", position: { abbreviation: "TE" }, status: { name: "Injured Reserve" } }] }
    ]
  }, now);
  assert.equal(players.get("1").injuryStatus, null, "a July note is stale by September");
  assert.equal(players.get("2").injuryStatus, "Questionable");
  assert.equal(players.get("3").injuryStatus, "Out", "the latest fresh note wins");
  assert.equal(players.get("4").rosterStatus, "Practice Squad");
  assert.equal(players.get("5").rosterStatus, "Injured Reserve");
});

test("depth chart ranks slot starters and treats receivers behind WR1-3 as depth", () => {
  const chart = parseNflDepthChart({
    depthchart: [
      { name: "Base 4-3 D", positions: { de: { athletes: [{ id: "99" }] } } },
      { name: "3WR 1TE", positions: {
        qb: { athletes: [{ id: "10" }, { id: "11" }] },
        rb: { athletes: [{ id: "20" }, { id: "21" }, { id: "22" }] },
        wr1: { athletes: [{ id: "30" }, { id: "33" }] },
        wr2: { athletes: [{ id: "31" }] },
        wr3: { athletes: [{ id: "32" }, { id: "34" }] },
        te: { athletes: [{ id: "40" }, { id: "41" }] },
        lt: { athletes: [{ id: "50" }] }
      } }
    ]
  });
  assert.equal(chart.available, true);
  assert.equal(chart.depthRank.get("10"), 1);
  assert.equal(chart.depthRank.get("11"), 2);
  assert.equal(chart.depthRank.get("22"), 3);
  assert.equal(chart.depthRank.get("30"), 1);
  assert.equal(chart.depthRank.get("31"), 2);
  assert.equal(chart.depthRank.get("32"), 3);
  assert.equal(chart.depthRank.get("33"), 4, "second name in the WR1 slot is depth");
  assert.equal(chart.depthRank.get("41"), 2);
  assert.equal(chart.depthRank.has("50"), false, "linemen are not pick candidates");
  assert.equal(parseNflDepthChart({ depthchart: [{ name: "Special Teams", positions: { k: { athletes: [{ id: "1" }] } } }] }).available, false);
});

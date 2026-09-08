import assert from "node:assert/strict";
import test from "node:test";
import {
  americanToImplied,
  americanToPayout,
  anchorToMarket,
  noVigPair,
  parseAmerican,
  parseEspnMoneyline,
  probabilityToAmerican
} from "../lib/marketMath.ts";
import { pickOutcome, serveProbability } from "../lib/servingPolicy.ts";

test("american odds convert to implied probability and payout multipliers", () => {
  assert.equal(americanToImplied(-150).toFixed(4), "0.6000");
  assert.equal(americanToImplied(150).toFixed(4), "0.4000");
  assert.equal(americanToPayout(-110).toFixed(3), "1.909");
  assert.equal(americanToPayout(140).toFixed(2), "2.40");
  assert.equal(probabilityToAmerican(0.6), -150);
  assert.equal(probabilityToAmerican(0.4), 150);
});

test("no-vig pair sums to one and keeps the favourite", () => {
  const fair = noVigPair(-170, 142);
  assert.equal((fair.home + fair.away).toFixed(6), "1.000000");
  assert.ok(fair.home > 0.6 && fair.home < 0.63, `expected ~0.617, got ${fair.home}`);
});

test("parseAmerican reads book formats including the unicode minus and EVEN", () => {
  assert.equal(parseAmerican("−112"), -112);
  assert.equal(parseAmerican("+135"), 135);
  assert.equal(parseAmerican("EVEN"), 100);
  assert.equal(parseAmerican(""), null);
  assert.equal(parseAmerican(undefined), null);
  assert.equal(parseAmerican(0), null);
});

test("anchorToMarket blends in logit space and respects the weight ends", () => {
  assert.equal(anchorToMarket(0.7, 0.5, 1), 0.7);
  assert.equal(anchorToMarket(0.7, 0.5, 0), 0.5);
  const mid = anchorToMarket(0.7, 0.5, 0.25);
  assert.ok(mid > 0.5 && mid < 0.6, `expected the market to dominate, got ${mid}`);
});

test("ESPN odds blocks become no-vig quotes with the DraftKings event id decoded from the link", () => {
  const quote = parseEspnMoneyline(
    {
      provider: { name: "DraftKings" },
      moneyline: {
        home: { close: { odds: "-170", link: { href: "https://sportsbook.draftkings.com/event%2F34118042?wpsrc=espn" } }, open: { odds: "-160" } },
        away: { close: { odds: "+142" }, open: { odds: "+135" } }
      }
    },
    "Home Team",
    "Away Team",
    "2026-09-08T12:00:00Z",
    "401770000"
  );
  assert.ok(quote);
  assert.equal(quote.favorite, "Home Team");
  assert.equal(quote.homeAmericanOdds, -170);
  assert.equal(quote.openHomeAmericanOdds, -160);
  assert.equal(quote.dkEventId, "34118042");
  assert.equal(quote.espnEventId, "401770000");
  assert.equal(quote.source, "DraftKings via ESPN");
  assert.equal(parseEspnMoneyline({ moneyline: { home: { close: { odds: "OFF" } } } }, "A", "B", "now"), null);
});

test("served probability anchors to the market when a line exists and stands alone otherwise", () => {
  const anchored = serveProbability("nfl", 0.7, 0.55, "nfl-v2");
  assert.equal(anchored.anchored, true);
  assert.ok(anchored.homeWinProbability > 0.55 && anchored.homeWinProbability < 0.62);
  assert.equal(anchored.modelHomeWinProbability, 0.7);
  assert.equal(anchored.marketHomeWinProbability, 0.55);
  assert.equal(anchored.marketDelta, 0.15);
  assert.equal(anchored.source, "nfl-v2+market-anchor-v1");
  assert.equal((anchored.homeWinProbability + anchored.awayWinProbability).toFixed(4), "1.0000");

  const alone = serveProbability("mlb", 0.58, null, "diamond-elo-v4");
  assert.equal(alone.anchored, false);
  assert.equal(alone.homeWinProbability, 0.58);
  assert.equal(alone.source, "diamond-elo-v4");
  assert.equal(alone.tier, "A");
});

test("pick outcome grades finals and tracks the leader while live", () => {
  const base = { predicted_winner: "Home", home_team: "Home", away_team: "Away" };
  assert.deepEqual(pickOutcome({ ...base, actual_winner: "Home", is_final: true, status: "Final", home_score: 5, away_score: 2 }), { pick_result: "hit", pick_leading: null });
  assert.deepEqual(pickOutcome({ ...base, actual_winner: "Away", is_final: true, status: "Final", home_score: 1, away_score: 2 }), { pick_result: "miss", pick_leading: null });
  assert.deepEqual(pickOutcome({ ...base, actual_winner: null, is_final: false, status: "In Progress", home_score: 1, away_score: 2 }), { pick_result: null, pick_leading: false });
  assert.deepEqual(pickOutcome({ ...base, actual_winner: null, is_final: false, status: "In Progress", home_score: 2, away_score: 2 }), { pick_result: null, pick_leading: null });
  assert.deepEqual(pickOutcome({ ...base, actual_winner: null, is_final: false, status: "Scheduled", home_score: null, away_score: null }), { pick_result: null, pick_leading: null });
});

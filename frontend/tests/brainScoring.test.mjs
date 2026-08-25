import assert from "node:assert/strict";
import test from "node:test";
import {
  applyLogitDelta,
  bucketInjuryStatus,
  combineFactors,
  formEdge,
  injuryBurden,
  isQbOut,
  MAX_BRAIN_LOGIT,
  nflPositionWeight,
  percentileRank,
  weatherSeverity
} from "../lib/server/brain/brainScoring.ts";

test("status strings from MLB and ESPN map into buckets", () => {
  assert.equal(bucketInjuryStatus("Injured 10-Day"), "il_short");
  assert.equal(bucketInjuryStatus("Injured 60-Day"), "il_long");
  assert.equal(bucketInjuryStatus("Injured Reserve"), "il_long");
  assert.equal(bucketInjuryStatus("Out"), "out");
  assert.equal(bucketInjuryStatus("Questionable"), "questionable");
  assert.equal(bucketInjuryStatus("Day-To-Day"), "day_to_day");
  assert.equal(bucketInjuryStatus("Active"), null);
});

test("QB injuries dominate NFL burden the way books treat them", () => {
  assert.equal(nflPositionWeight("QB"), 1);
  assert.ok(nflPositionWeight("QB") > nflPositionWeight("WR") * 3);
  const qbOut = injuryBurden([{ position: "QB", status: "out" }], "nfl");
  const wrOut = injuryBurden([{ position: "WR", status: "out" }], "nfl");
  assert.ok(qbOut > wrOut * 2, "a QB out must outweigh a WR out");
  assert.equal(isQbOut([{ playerName: "Q", position: "QB", status: "questionable", detail: null }]), false, "questionable is not out");
  assert.equal(isQbOut([{ playerName: "Q", position: "QB", status: "out", detail: null }]), true);
});

test("burden saturates instead of growing without bound", () => {
  const pile = Array.from({ length: 20 }, () => ({ position: "WR", status: "out" }));
  const burden = injuryBurden(pile, "nfl");
  assert.ok(burden > 0.9 && burden <= 1);
});

test("weather severity only reacts to extremes", () => {
  assert.equal(weatherSeverity({ tempF: 72, windMph: 6, gustMph: 10, precipProbability: 0.1, snowfall: false }), 0);
  const gale = weatherSeverity({ tempF: 20, windMph: 24, gustMph: 35, precipProbability: 0.8, snowfall: true });
  assert.ok(gale >= 0.9);
});

test("shadow adjustment is clamped and reversible", () => {
  const big = combineFactors([
    { label: "a", detail: "", homeLogit: 0.5 },
    { label: "b", detail: "", homeLogit: 0.4 }
  ]);
  assert.equal(big.logitDelta, MAX_BRAIN_LOGIT);
  const shifted = applyLogitDelta(0.55, MAX_BRAIN_LOGIT);
  assert.ok(shifted > 0.55 && shifted < 0.65, "cap keeps the shift under ~9 points");
  assert.equal(applyLogitDelta(0.55, 0), 0.55);
  const tiny = combineFactors([{ label: "noise", detail: "", homeLogit: 0.001 }]);
  assert.equal(tiny.factors.length, 0, "noise factors are dropped");
});

test("form edge rewards the hotter, more rested side and stays small", () => {
  const hot = { lastTenWins: 8, lastTenGames: 10, streak: 5, restDays: 2 };
  const cold = { lastTenWins: 2, lastTenGames: 10, streak: -4, restDays: 0 };
  const edge = formEdge(hot, cold);
  assert.ok(edge > 0 && edge < 0.15, "form nudges, never dominates");
  assert.equal(formEdge(hot, hot), 0);
});

test("percentile ranks are league-relative", () => {
  const peers = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  assert.ok(percentileRank(9, peers) > 90);
  assert.ok(percentileRank(1, peers) < 15);
  assert.ok(percentileRank(3, peers, false) > percentileRank(3, peers), "inverted metrics flip the rank");
});

test("pythagorean expectation tracks scoring margin quality", async () => {
  const { pythagoreanExpectation } = await import("../lib/server/brain/brainScoring.ts");
  assert.equal(pythagoreanExpectation(500, 500, 1.83), 0.5);
  assert.ok(pythagoreanExpectation(800, 600, 1.83) > 0.6);
  assert.ok(pythagoreanExpectation(300, 450, 2.37) < 0.35);
});

test("record factors activate only where the backtest earned them a weight", async () => {
  const { factorTerms } = await import("../lib/server/brain/brainScoring.ts");
  const form = { lastTenWins: 5, lastTenGames: 10, streak: 0, restDays: 6 };
  const base = { burdenGap: 0, homeQbOut: false, awayQbOut: false, homeForm: form, awayForm: form, weatherSeverity: 0 };
  const nfl = factorTerms({ ...base, sport: "nfl", pythagGap: 0.1, divisionGame: true, baselineLogit: 1, homeOffBye: true, awayOffBye: false });
  const kinds = nfl.map((term) => term.kind);
  assert.ok(kinds.includes("pythag"), "NFL pythag is live");
  assert.ok(kinds.includes("division"), "NFL division damp is live");
  assert.equal(kinds.includes("bye"), false, "bye was rejected by experiments, weight 0");
  const pythagTerm = nfl.find((term) => term.kind === "pythag");
  assert.ok(pythagTerm.homeLogit > 0.05 && pythagTerm.homeLogit < 0.09);
  const divisionTerm = nfl.find((term) => term.kind === "division");
  assert.ok(divisionTerm.homeLogit < 0, "division play damps the home favorite");
  const mlb = factorTerms({ ...base, sport: "mlb", pythagGap: 0.1, scoringFormGap: 2, densityGap: 3, pitcherFormGap: 2 });
  assert.equal(mlb.filter((term) => ["pythag", "scoring-form", "density", "pitcher-form"].includes(term.kind)).length, 0, "rejected MLB record factors stay inert");
});

test("news tagger classifies brain-relevant headlines", async () => {
  const { tagNewsText } = await import("../lib/server/brain/brainScoring.ts");
  assert.deepEqual(tagNewsText("Star slugger placed on 10-day injured list with hamstring strain"), ["injury"]);
  assert.ok(tagNewsText("Yankees acquire reliever in trade with Marlins").includes("trade"));
  assert.ok(tagNewsText("Ace activated from IL, returns to the rotation Friday").includes("activation"));
  assert.ok(tagNewsText("Club selected the contract of top prospect").includes("call-up"));
  assert.ok(tagNewsText("Starter scratched from tonight's outing").includes("pitching"));
  assert.deepEqual(tagNewsText("Team unveils new alternate jerseys"), []);
});

test("temperature calibration shrinks probabilities without changing picks", async () => {
  const { applyTemperature, MODEL_TEMPERATURE } = await import("../lib/server/brain/brainScoring.ts");
  assert.ok(MODEL_TEMPERATURE.mlb > 1 && MODEL_TEMPERATURE.nfl > 1, "both engines run overconfident");
  const shrunk = applyTemperature(0.7, "nfl");
  assert.ok(shrunk > 0.5 && shrunk < 0.7, "confident picks shrink toward 50% but keep their side");
  assert.ok(applyTemperature(0.3, "mlb") > 0.3 && applyTemperature(0.3, "mlb") < 0.5);
  assert.equal(applyTemperature(0.5, "nfl"), 0.5, "coin flips stay coin flips");
});

test("late-season damp shrinks favorites in weeks 17-18 only", async () => {
  const { factorTerms } = await import("../lib/server/brain/brainScoring.ts");
  const form = { lastTenWins: 5, lastTenGames: 10, streak: 0, restDays: 6 };
  const base = { sport: "nfl", burdenGap: 0, homeQbOut: false, awayQbOut: false, homeForm: form, awayForm: form, weatherSeverity: 0, baselineLogit: 1.2 };
  const late = factorTerms({ ...base, lateSeason: true });
  const early = factorTerms({ ...base, lateSeason: false });
  const damp = late.find((term) => term.kind === "late-season");
  assert.ok(damp && damp.homeLogit < -0.05, "week 17-18 home favorite gets dampened");
  assert.equal(early.some((term) => term.kind === "late-season"), false);
  assert.equal(factorTerms({ ...base, sport: "mlb", lateSeason: true }).some((t) => t.kind === "late-season"), false, "MLB unaffected");
});

test("confidence tiers match the selective-prediction sweep floors", async () => {
  const { confidenceTier } = await import("../lib/server/brain/brainScoring.ts");
  assert.equal(confidenceTier(0.65, "nfl"), "A");
  assert.equal(confidenceTier(0.35, "nfl"), "A", "tier is side-agnostic");
  assert.equal(confidenceTier(0.6, "nfl"), "B");
  assert.equal(confidenceTier(0.55, "nfl"), "C");
  assert.equal(confidenceTier(0.59, "mlb"), "A");
  assert.equal(confidenceTier(0.56, "mlb"), "B");
  assert.equal(confidenceTier(0.52, "mlb"), "C");
});

test("factor input vector decomposes exactly into factorTerms contributions", async () => {
  const { factorTerms, factorInputVector, DEFAULT_BRAIN_WEIGHTS } = await import("../lib/server/brain/brainScoring.ts");
  const inputs = {
    sport: "nfl", burdenGap: 0.2, homeQbOut: false, awayQbOut: false,
    homeForm: { lastTenWins: 7, lastTenGames: 10, streak: 2, restDays: 7 },
    awayForm: { lastTenWins: 3, lastTenGames: 10, streak: -1, restDays: 6 },
    weatherSeverity: 0.4, pythagGap: 0.08, divisionGame: true, baselineLogit: 0.9,
    qbValueGap: 1.2, lateSeason: true
  };
  const vector = factorInputVector(inputs);
  const terms = factorTerms(inputs);
  for (const term of terms) {
    const key = { injury: "injuryGap", form: "formWinRate", weather: "weatherHome", pythag: "pythag", division: "divisionDamp", "qb-value": "qbValue", "late-season": "lateSeasonDamp" }[term.kind];
    if (!key || key === "formWinRate") continue; // form term mixes formWinRate+restDay
    const reconstructed = vector[key] * DEFAULT_BRAIN_WEIGHTS.nfl[key];
    assert.ok(Math.abs(reconstructed - term.homeLogit) < 1e-6, `${term.kind}: ${reconstructed} vs ${term.homeLogit}`);
  }
});

test("online updates move weights toward outcomes, stay bounded, and anchor to shipped", async () => {
  const { onlineUpdate, LEARNABLE_BOUNDS, MODEL_TEMPERATURE } = await import("../lib/server/brain/brainScoring.ts");
  let state = { weights: {}, temperature: MODEL_TEMPERATURE.nfl, gamesLearned: 0, buffer: [], resets: 0 };
  const inputs = { pythag: 0.1, qbValue: 1.0 };
  state = onlineUpdate(state, "nfl", 0.1, inputs, true, 0.05);
  assert.ok(state.weights.pythag > 0.69, "home win with positive pythag input raises the weight");
  assert.ok(state.weights.qbValue > 0.05, "qbValue rises too");
  assert.equal(state.gamesLearned, 1);
  for (let i = 0; i < 500; i++) state = onlineUpdate(state, "nfl", 0.1, inputs, true, 0.05);
  assert.ok(state.weights.pythag <= LEARNABLE_BOUNDS.nfl.pythag.max + 1e-9, "bounds hold under sustained pressure");
  assert.ok(state.buffer.length <= 400, "temperature buffer is capped");
  let down = { weights: {}, temperature: 1.45, gamesLearned: 0, buffer: [], resets: 0 };
  down = onlineUpdate(down, "nfl", 0.1, inputs, false, 0.05);
  assert.ok(down.weights.pythag < 0.69, "home loss with positive input lowers the weight");
});

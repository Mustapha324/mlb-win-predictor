// Relative `.ts` imports on purpose: this module is pure and runs under `node --test`, which has no `@/` alias.
import { anchorToMarket, MARKET_ANCHOR_MODEL_WEIGHT } from "./marketMath.ts";
import { confidenceTier } from "./server/brain/brainScoring.ts";
import { pickStatus } from "./server/playerPickScoring.ts";

/**
 * The served game-winner policy. Pure so the whole thing is unit-tested.
 *
 * Evidence (docs/backtests/ensemble.md, 1,084 NFL games 2022–2025, all
 * out-of-sample): the DraftKings closing line beat every model variant
 * (67.5% / 0.6082 log-loss vs 64.9% / 0.6364 for the best model stack), the
 * leave-one-season-out fitter gave the model a 0.00 share, and a fixed 25/75
 * model/market logit blend produced the best raw hit rate (68.2%) at a
 * negligible log-loss cost. So: when a pregame line exists the served
 * probability is that blend; when it does not, the model stands alone.
 */

export type ServedProbability = {
  homeWinProbability: number;
  awayWinProbability: number;
  modelHomeWinProbability: number;
  marketHomeWinProbability: number | null;
  /** Model minus market, home side; null without a line. */
  marketDelta: number | null;
  tier: "A" | "B" | "C";
  source: string;
  anchored: boolean;
};

export function serveProbability(sport: "mlb" | "nfl", modelHome: number, marketHome: number | null, modelVersion: string): ServedProbability {
  const model = Number(Math.max(0.01, Math.min(0.99, modelHome)).toFixed(4));
  const anchored = marketHome !== null && Number.isFinite(marketHome) && marketHome > 0 && marketHome < 1;
  const home = anchored ? anchorToMarket(model, marketHome, MARKET_ANCHOR_MODEL_WEIGHT[sport]) : model;
  return {
    homeWinProbability: home,
    awayWinProbability: Number((1 - home).toFixed(4)),
    modelHomeWinProbability: model,
    marketHomeWinProbability: anchored ? Number(marketHome.toFixed(4)) : null,
    marketDelta: anchored ? Number((model - marketHome).toFixed(4)) : null,
    tier: confidenceTier(home, sport),
    source: anchored ? `${modelVersion}+market-anchor-v1` : modelVersion,
    anchored
  };
}

/** Confidence label shared by both sports so the dashboard reads the same way everywhere. */
export function confidenceLabel(sport: "mlb" | "nfl", homeWinProbability: number): "Lean" | "Edge" | "Strong" {
  const pick = Math.max(homeWinProbability, 1 - homeWinProbability);
  if (sport === "nfl") return pick >= 0.65 ? "Strong" : pick >= 0.57 ? "Edge" : "Lean";
  return pick >= 0.62 ? "Strong" : pick >= 0.56 ? "Edge" : "Lean";
}

/** Factor line explaining the anchor on the game card. */
export function marketFactorLabel(quote: { favorite: string; homeWinProbability: number; awayWinProbability: number; source: string }): string {
  const percent = Math.round(Math.max(quote.homeWinProbability, quote.awayWinProbability) * 100);
  return `Anchored to the sportsbook line: ${quote.favorite} ${percent}% (${quote.source})`;
}

/** Factor list with the anchor explanation first when the market flipped the model's side, last otherwise. */
export function withMarketFactor(
  factors: string[],
  served: ServedProbability,
  quote: { favorite: string; homeWinProbability: number; awayWinProbability: number; source: string } | null
): string[] {
  if (!served.anchored || !quote) return factors;
  const flipped = served.modelHomeWinProbability >= 0.5 !== served.homeWinProbability >= 0.5;
  const label = marketFactorLabel(quote);
  return flipped ? [label, ...factors] : [...factors, label];
}

export type PickOutcome = { pick_result: "hit" | "miss" | null; pick_leading: boolean | null };

/**
 * How the served pick is doing: graded once the game is final, and while the
 * game is live whether the picked side currently leads (null when tied or
 * scores are unknown).
 */
export function pickOutcome(game: {
  predicted_winner: string;
  actual_winner: string | null;
  is_final: boolean;
  status: string;
  home_team: string;
  away_team: string;
  home_score: number | null;
  away_score: number | null;
}): PickOutcome {
  if (game.is_final && game.actual_winner) {
    return { pick_result: game.actual_winner === game.predicted_winner ? "hit" : "miss", pick_leading: null };
  }
  if (pickStatus(game.status, game.is_final) !== "live" || game.home_score === null || game.away_score === null || game.home_score === game.away_score) {
    return { pick_result: null, pick_leading: null };
  }
  const leader = game.home_score > game.away_score ? game.home_team : game.away_team;
  return { pick_result: null, pick_leading: leader === game.predicted_winner };
}

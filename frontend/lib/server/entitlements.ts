import type { TeamPrediction, TodayPredictionsResponse } from "@/lib/api";
import type { AccessState } from "@/lib/server/access";

export type EntitledPrediction = TeamPrediction & { is_locked: boolean };
export type EntitledSlate = Omit<TodayPredictionsResponse, "predictions"> & {
  access: Pick<AccessState, "authenticated" | "isPro" | "tier">;
  predictions: EntitledPrediction[];
};

export function applyGameEntitlement(prediction: TeamPrediction, access: AccessState, isLocked = false): EntitledPrediction {
  const locked = !access.isPro && isLocked;
  const withoutLive: TeamPrediction = access.isPro
    ? prediction
    : {
        ...prediction,
        live_home_win_probability: null,
        live_away_win_probability: null,
        live_favorite: null,
        live_probability_source: null,
        live_updated_at: null,
        live_market: null
      };
  if (!locked) return { ...withoutLive, is_locked: false };
  return {
    ...withoutLive,
    predicted_winner: "Pro prediction",
    pregame_predicted_winner: "Pro prediction",
    home_win_probability: 0.5,
    away_win_probability: 0.5,
    pregame_home_win_probability: 0.5,
    pregame_away_win_probability: 0.5,
    confidence: "Lean",
    factors: [],
    is_locked: true
  };
}

export function applyPredictionEntitlements(slate: TodayPredictionsResponse, access: AccessState): EntitledSlate {
  const predictions = slate.predictions.map((prediction, index) => applyGameEntitlement(prediction, access, index % 2 === 1));
  return {
    ...slate,
    live_updates: access.isPro && slate.live_updates,
    access: { authenticated: access.authenticated, isPro: access.isPro, tier: access.tier },
    predictions
  };
}

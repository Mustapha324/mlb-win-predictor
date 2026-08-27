import "server-only";
import type { TeamPrediction, TodayPredictionsResponse } from "@/lib/api";
import { createSupabaseAdminClient, hasSupabaseAdminCredentials } from "@/lib/supabase/admin";

type SnapshotRow = {
  game_id: string;
  pregame_predicted_winner: string;
  pregame_home_win_probability: number;
  pregame_away_win_probability: number;
  model_version: string;
  factors: string[];
};

function hasAdminConfig(): boolean {
  return hasSupabaseAdminCredentials();
}

function applySnapshot(prediction: TeamPrediction, snapshot: SnapshotRow): TeamPrediction {
  const confidenceValue = Math.max(snapshot.pregame_home_win_probability, snapshot.pregame_away_win_probability);
  return {
    ...prediction,
    predicted_winner: snapshot.pregame_predicted_winner,
    pregame_predicted_winner: snapshot.pregame_predicted_winner,
    home_win_probability: snapshot.pregame_home_win_probability,
    away_win_probability: snapshot.pregame_away_win_probability,
    pregame_home_win_probability: snapshot.pregame_home_win_probability,
    pregame_away_win_probability: snapshot.pregame_away_win_probability,
    prediction_source: snapshot.model_version,
    confidence: confidenceValue >= 0.62 ? "Strong" : confidenceValue >= 0.56 ? "Edge" : "Lean",
    factors: snapshot.factors
  };
}

export async function preservePregameSnapshots<T extends TodayPredictionsResponse>(slate: T): Promise<T> {
  if (!hasAdminConfig() || slate.predictions.length === 0) return slate;
  const supabase = createSupabaseAdminClient();
  const gameIds = slate.predictions.map((prediction) => prediction.gameId);
  const { data: existing, error } = await supabase
    .from("prediction_snapshots")
    .select("game_id,pregame_predicted_winner,pregame_home_win_probability,pregame_away_win_probability,model_version,factors")
    .eq("sport", slate.sport)
    .in("game_id", gameIds);
  if (error) return slate;
  const snapshots = new Map((existing as SnapshotRow[] | null ?? []).map((row) => [row.game_id, row]));
  const missing = slate.predictions.filter((prediction) => !snapshots.has(prediction.gameId));
  if (missing.length) {
    await supabase.from("prediction_snapshots").upsert(
      missing.map((prediction) => ({
        sport: slate.sport,
        game_id: prediction.gameId,
        scheduled_at: prediction.game_time_utc ?? `${prediction.date}T12:00:00Z`,
        away_team: prediction.away_team,
        home_team: prediction.home_team,
        pregame_predicted_winner: prediction.pregame_predicted_winner,
        pregame_home_win_probability: prediction.pregame_home_win_probability,
        pregame_away_win_probability: prediction.pregame_away_win_probability,
        model_version: prediction.prediction_source,
        factors: prediction.factors
      })),
      { onConflict: "sport,game_id", ignoreDuplicates: true }
    );
  }
  const finals = slate.predictions.filter((prediction) => prediction.is_final && prediction.actual_winner);
  await Promise.all(finals.map((prediction) => supabase.from("prediction_snapshots").update({
    actual_winner: prediction.actual_winner,
    away_score: prediction.away_score,
    home_score: prediction.home_score,
    final_at: new Date().toISOString()
  }).eq("sport", slate.sport).eq("game_id", prediction.gameId)));
  return { ...slate, predictions: slate.predictions.map((prediction) => snapshots.has(prediction.gameId) ? applySnapshot(prediction, snapshots.get(prediction.gameId)!) : prediction) };
}

export async function preserveGameSnapshot(prediction: TeamPrediction): Promise<TeamPrediction> {
  const slate: TodayPredictionsResponse = {
    sport: prediction.sport,
    date: prediction.date,
    slate_label: prediction.date,
    data_through: prediction.date,
    model_version: prediction.prediction_source,
    games_trained: 0,
    updated_at: new Date().toISOString(),
    live_updates: prediction.live_home_win_probability !== null || prediction.live_market !== null,
    predictions: [prediction]
  };
  return (await preservePregameSnapshots(slate)).predictions[0];
}

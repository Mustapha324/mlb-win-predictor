import "server-only";
import type { NbaGame } from "@/lib/server/nba";
import { createSupabaseAdminClient, hasSupabaseAdminCredentials } from "@/lib/supabase/admin";

export async function preserveNbaCalls(games: NbaGame[]): Promise<void> {
  if (!hasSupabaseAdminCredentials()) return;
  const pending = games.filter(game => game.state === "pre" && Date.parse(game.tipoff) > Date.now() && game.homeWinProbability !== null && !/postpon|cancel|suspend|delay/i.test(game.status));
  if (!pending.length) return;
  const { error } = await createSupabaseAdminClient().from("prediction_snapshots").upsert(pending.map(game => ({ sport: "nba", game_id: game.id, scheduled_at: game.tipoff, away_team: game.away.name, home_team: game.home.name, pregame_predicted_winner: game.homeWinProbability! >= 0.5 ? game.home.name : game.away.name, pregame_home_win_probability: game.homeWinProbability, pregame_away_win_probability: 1 - game.homeWinProbability!, model_version: game.probabilitySource ?? "nba-margin-elo-v2", factors: ["Captured before tipoff"] })), { onConflict: "sport,game_id", ignoreDuplicates: true });
  if (error) console.warn("NBA pregame snapshot write unavailable", error.code);
}

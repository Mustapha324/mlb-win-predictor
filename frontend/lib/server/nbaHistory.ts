import "server-only";
import type { PredictionHistoryItem, TeamIdentity } from "@/lib/api";
import { ratingsBefore, modelProbability } from "@/lib/nbaPrediction";
import { nbaCompletedResults } from "@/lib/server/nba";
import { createSupabaseAdminClient, hasSupabaseAdminCredentials } from "@/lib/supabase/admin";

type Saved = { game_id: string; pregame_predicted_winner: string; pregame_home_win_probability: number; pregame_away_win_probability: number };
export async function getNbaHistory(limit = 100): Promise<PredictionHistoryItem[]> {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const results = await nbaCompletedResults(today);
  const recent = results.slice(-Math.max(1, Math.min(200, Math.floor(limit))));
  const saved = new Map<string, Saved>();
  if (hasSupabaseAdminCredentials() && recent.length) {
    const db = createSupabaseAdminClient();
    const { data } = await db.from("prediction_snapshots").select("game_id,pregame_predicted_winner,pregame_home_win_probability,pregame_away_win_probability").eq("sport", "nba").in("game_id", recent.map(row => row.id));
    for (const row of (data ?? []) as Saved[]) saved.set(row.game_id, row);
    await Promise.all(recent.filter(row => saved.has(row.id)).map(row => db.from("prediction_snapshots").update({ actual_winner: row.homeScore > row.awayScore ? row.homeName : row.awayName, home_score: row.homeScore, away_score: row.awayScore, final_at: new Date().toISOString() }).eq("sport", "nba").eq("game_id", row.id)));
  }
  return recent.flatMap(row => {
    const snapshot = saved.get(row.id);
    const probability = snapshot?.pregame_home_win_probability ?? modelProbability(ratingsBefore(results, row.date), row.homeId, row.awayId);
    if (probability === null || !row.homeName || !row.awayName) return [];
    const home: TeamIdentity = { id: Number(row.homeId), name: row.homeName, abbreviation: row.homeAbbreviation ?? row.homeName, primary: "#fdba74", accent: "#ffffff", record: "" };
    const away: TeamIdentity = { id: Number(row.awayId), name: row.awayName, abbreviation: row.awayAbbreviation ?? row.awayName, primary: "#fdba74", accent: "#ffffff", record: "" };
    const predictedWinner = snapshot?.pregame_predicted_winner ?? (probability >= 0.5 ? home.name : away.name);
    const actualWinner = row.homeScore > row.awayScore ? home.name : away.name;
    return [{ sport: "nba" as const, gameId: row.id, date: row.date.slice(0,10), homeTeam: home, awayTeam: away, predictedWinner, actualWinner, homeWinProbability: probability, awayWinProbability: snapshot?.pregame_away_win_probability ?? 1-probability, wasCorrect: predictedWinner === actualWinner, homeScore: row.homeScore, awayScore: row.awayScore, historySource: snapshot ? "Captured pregame" : "Rating replay" }];
  }).reverse();
}

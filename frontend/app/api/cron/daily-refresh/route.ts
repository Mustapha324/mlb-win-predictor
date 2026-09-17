import { getDefaultPredictionDate, getPredictions } from "@/lib/server/mlbModel";
import { getDefaultNflDate, getNflPredictions } from "@/lib/server/nflModel";
import { getPlayerPicks, refreshRecentPlayerPickResults } from "@/lib/server/playerPicks";
import { preservePregameSnapshots } from "@/lib/server/predictionSnapshots";
import { recordModelRefresh } from "@/lib/server/modelRefresh";
import type { Sport } from "@/lib/sports";
import { refreshSocialPickResults } from "@/lib/server/social";
import { hasValidBearer } from "@/lib/server/requestSecurity";

export const maxDuration = 60;

async function refreshSport(sport: Sport) {
  const date = sport === "mlb" ? getDefaultPredictionDate() : getDefaultNflDate();
  try {
    const gradedPlayerPicks = await refreshRecentPlayerPickResults(sport, date, 3);
    const slate = sport === "mlb" ? await getPredictions(date) : await getNflPredictions(date);
    const players = await getPlayerPicks(sport, date, slate);
    await preservePregameSnapshots(slate);
    const gradedUserPicks = await refreshSocialPickResults(sport);
    const ok = gradedUserPicks.failed === 0;
    await recordModelRefresh(sport, { status: ok ? "success" : "failed", games: slate.predictions.length, playerPicks: players.picks.length, ...(ok ? {} : { error: `${gradedUserPicks.failed} social game results need retry.` }) });
    return { sport, ok, games: slate.predictions.length, playerPicks: players.picks.length, gradedPlayerPicks, gradedUserPicks, modelVersion: slate.model_version };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown refresh error";
    await recordModelRefresh(sport, { status: "failed", games: 0, playerPicks: 0, error: message });
    return { sport, ok: false, error: message };
  }
}

export async function GET(request: Request): Promise<Response> {
  if (!hasValidBearer(request, process.env.CRON_SECRET)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const results = await Promise.all([refreshSport("mlb"), refreshSport("nfl")]);
  const ok = results.every((result) => result.ok);
  return Response.json({ ok, ranAt: new Date().toISOString(), results }, { status: ok ? 200 : 207 });
}

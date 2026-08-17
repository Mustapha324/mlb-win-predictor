import type { AccessState } from "@/lib/server/access";
import { getDefaultPredictionDate, getPredictions } from "@/lib/server/mlbModel";
import { getDefaultNflDate, getNflPredictions } from "@/lib/server/nflModel";
import { getPlayerPicks } from "@/lib/server/playerPicks";
import { preservePregameSnapshots } from "@/lib/server/predictionSnapshots";
import { recordModelRefresh } from "@/lib/server/modelRefresh";
import type { Sport } from "@/lib/sports";

export const maxDuration = 60;

const SYSTEM_PRO_ACCESS: AccessState = {
  authenticated: true,
  isPro: true,
  tier: "pro",
  email: null,
  userId: null,
  stripeCustomerId: null,
  subscriptionStatus: "system"
};

async function refreshSport(sport: Sport) {
  const date = sport === "mlb" ? getDefaultPredictionDate() : getDefaultNflDate();
  try {
    const slate = sport === "mlb" ? await getPredictions(date) : await getNflPredictions(date);
    const players = await getPlayerPicks(sport, date, SYSTEM_PRO_ACCESS, slate);
    await preservePregameSnapshots(slate);
    await recordModelRefresh(sport, { status: "success", games: slate.predictions.length, playerPicks: players.picks.length });
    return { sport, ok: true, games: slate.predictions.length, playerPicks: players.picks.length, modelVersion: slate.model_version };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown refresh error";
    await recordModelRefresh(sport, { status: "failed", games: 0, playerPicks: 0, error: message });
    return { sport, ok: false, error: message };
  }
}

export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const results = await Promise.all([refreshSport("mlb"), refreshSport("nfl")]);
  const ok = results.every((result) => result.ok);
  return Response.json({ ok, ranAt: new Date().toISOString(), results }, { status: ok ? 200 : 207 });
}

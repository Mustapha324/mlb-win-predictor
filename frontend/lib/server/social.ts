import "server-only";
import type { TeamPrediction, TodayPredictionsResponse } from "@/lib/api";
import type { Sport } from "@/lib/sports";
import { isSport } from "@/lib/sports";
import { classifyGameResult, isPickOpen } from "@/lib/social";
import { createSupabaseAdminClient, hasSupabaseAdminCredentials } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export class SocialError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

const SETUP_MESSAGE = "Social features are unavailable. Configure Supabase and apply the social database migration. Predictions remain available.";

export function socialDatabaseError(error: { code?: string; message: string }): SocialError {
  if (["PGRST202", "PGRST205", "42P01", "42883", "42501"].includes(error.code ?? "")) return new SocialError(SETUP_MESSAGE, 503);
  if (error.code === "28000") return new SocialError("Sign in to use account features.", 401);
  if (error.code === "P0001") return new SocialError(error.message, /locked|started/.test(error.message) ? 409 : 400);
  if (["23514", "22001", "22P02", "23502"].includes(error.code ?? "")) return new SocialError("Check your profile or pick details and try again.");
  if (error.code === "23505") return new SocialError("That username is already taken.", 409);
  return new SocialError("Social data could not be loaded. Please try again.", 503);
}

export async function readSocial(view: string, params: Record<string, string>) {
  const client = await createSupabaseServerClient();
  if (!client) throw new SocialError(SETUP_MESSAGE, 503);
  const { data, error } = await client.rpc("social_read", { p_view: view, p_params: params });
  if (error) throw socialDatabaseError(error);
  if (view === "profile" && !data) throw new SocialError("This profile does not exist.", 404);
  return data;
}

/** Public pipeline objects only. Never accept a browser-supplied game object. */
export async function registerSocialGame(prediction: TeamPrediction): Promise<number> {
  if (!hasSupabaseAdminCredentials()) return 0;
  if (!prediction.game_time_utc || !Number.isFinite(Date.parse(prediction.game_time_utc))) return 0;
  const result = classifyGameResult(prediction);
  const status = result.status === "closed" && isPickOpen(prediction.game_time_utc, prediction.status) ? "scheduled" : result.status;
  const probability = prediction.pregame_predicted_winner === prediction.home_team ? prediction.pregame_home_win_probability : prediction.pregame_away_win_probability;
  if (![prediction.home_team, prediction.away_team].includes(prediction.pregame_predicted_winner) || !Number.isFinite(probability)) return 0;
  const { data, error } = await createSupabaseAdminClient().rpc("social_register_game", {
    p_game: {
      sport: prediction.sport, gameId: prediction.gameId, date: prediction.date,
      startsAt: prediction.game_time_utc, homeTeam: prediction.home_team, awayTeam: prediction.away_team,
      modelSelection: prediction.pregame_predicted_winner, modelProbability: probability,
      modelVersion: prediction.prediction_source, status, winner: result.winner
    }
  });
  if (error) throw socialDatabaseError(error);
  return Number(data ?? 0);
}

/** Prediction availability must not depend on optional social database setup. */
export async function syncSocialSlate(slate: TodayPredictionsResponse): Promise<void> {
  if (!hasSupabaseAdminCredentials()) return;
  const results = await Promise.allSettled(slate.predictions.map(registerSocialGame));
  if (results.some((result) => result.status === "rejected")) console.warn("Social game synchronization unavailable; predictions remain available.");
}

async function authoritativeGame(sport: Sport, gameId: string): Promise<TeamPrediction> {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(gameId)) throw new SocialError("Choose a valid game.");
  if (!hasSupabaseAdminCredentials()) throw new SocialError(SETUP_MESSAGE, 503);
  const prediction = sport === "mlb"
    ? await (await import("@/lib/server/mlbModel")).getGamePrediction(gameId)
    : await (await import("@/lib/server/nflModel")).getNflGamePrediction(gameId);
  if (!prediction || prediction.sport !== sport || prediction.gameId !== gameId) throw new SocialError("This game is no longer available.", 404);
  if (!isPickOpen(prediction.game_time_utc, prediction.status) || prediction.is_final) throw new SocialError("This game has started or is unavailable. Picks are locked.", 409);
  // Match the immutable model call shown by existing prediction routes.
  const { data: snapshot, error } = await createSupabaseAdminClient().from("prediction_snapshots")
    .select("pregame_predicted_winner,pregame_home_win_probability,pregame_away_win_probability,model_version")
    .eq("sport", sport).eq("game_id", gameId).maybeSingle();
  if (error) throw socialDatabaseError(error);
  if (snapshot) {
    prediction.pregame_predicted_winner = snapshot.pregame_predicted_winner;
    prediction.pregame_home_win_probability = snapshot.pregame_home_win_probability;
    prediction.pregame_away_win_probability = snapshot.pregame_away_win_probability;
    prediction.prediction_source = snapshot.model_version;
  }
  await registerSocialGame(prediction);
  return prediction;
}

export async function writeSocial(action: string, payload: Record<string, unknown>) {
  const client = await createSupabaseServerClient();
  if (!client) throw new SocialError(SETUP_MESSAGE, 503);
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) throw new SocialError("Sign in to make picks, add friends or tail a pick.", 401);
  if (["pick", "deletePick", "tail"].includes(action)) {
    let sport = payload.sport;
    let gameId = payload.gameId;
    if (action === "tail") {
      if (!hasSupabaseAdminCredentials()) throw new SocialError(SETUP_MESSAGE, 503);
      if (typeof payload.pickId !== "string" || !/^[0-9a-f-]{36}$/i.test(payload.pickId)) throw new SocialError("Choose a valid source pick.");
      // Resolve only the game identity; the authenticated RPC checks friendship
      // and locks the source row before copying its selection.
      const { data, error } = await createSupabaseAdminClient().from("user_picks").select("sport,game_id").eq("id", payload.pickId).maybeSingle();
      if (error) throw socialDatabaseError(error);
      if (!data) throw new SocialError("This source pick is no longer available.", 404);
      sport = data.sport; gameId = data.game_id;
    }
    if (typeof sport !== "string" || !isSport(sport) || typeof gameId !== "string") throw new SocialError("Choose a supported sport and game.");
    await authoritativeGame(sport, gameId);
  }
  // Only this verified server path may submit picks. The database rejects
  // direct browser RPC pick writes, even against previously registered games.
  const pickMutation = ["pick", "deletePick", "tail"].includes(action);
  const writer = pickMutation ? createSupabaseAdminClient() : client;
  const { data, error } = await writer.rpc("social_write", {
    p_action: action, p_payload: payload, ...(pickMutation ? { p_actor: user.id } : {})
  });
  if (error) throw socialDatabaseError(error);
  return data;
}

/** Retry pending games regardless of age; missing results stay pending. Bounded
 * batches rotate by checked_at so postponed/historical games cannot starve. */
export async function refreshSocialPickResults(sport: Sport): Promise<{ available: boolean; checked: number; graded: number; failed: number }> {
  if (!hasSupabaseAdminCredentials()) return { available: false, checked: 0, graded: 0, failed: 0 };
  const admin = createSupabaseAdminClient();
  const { data: games, error } = await admin.from("social_games")
    .select("game_id,slate_date,status,user_picks!inner(result)")
    .eq("sport", sport).eq("user_picks.result", "PENDING").lte("starts_at", new Date().toISOString())
    .order("checked_at", { ascending: true }).limit(50);
  if (error) {
    const failure = socialDatabaseError(error);
    if (failure.status === 503 && ["PGRST202", "PGRST205", "42P01"].includes(error.code ?? "")) return { available: false, checked: 0, graded: 0, failed: 0 };
    throw failure;
  }
  let graded = 0; let failed = 0;
  const dates = new Map<string, typeof games>();
  for (const game of games ?? []) dates.set(game.slate_date, [...(dates.get(game.slate_date) ?? []), game]);
  for (const [date, pending] of dates) {
    try {
      const slate = sport === "mlb" ? await (await import("@/lib/server/mlbModel")).getPredictions(date) : await (await import("@/lib/server/nflModel")).getNflPredictions(date);
      for (const game of pending ?? []) {
        const prediction = slate.predictions.find((entry) => entry.gameId === game.game_id);
        if (prediction) graded += await registerSocialGame(prediction);
        else failed++;
      }
    } catch { failed += pending?.length ?? 0; }
    // Rotate failures as well, while keeping their picks pending for retry.
    await admin.from("social_games").update({ checked_at: new Date().toISOString() }).eq("sport", sport).in("game_id", (pending ?? []).map((game) => game.game_id));
  }
  return { available: true, checked: games?.length ?? 0, graded, failed };
}

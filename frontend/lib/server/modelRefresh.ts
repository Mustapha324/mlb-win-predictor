import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Sport } from "@/lib/sports";

export type ModelRefreshStatus = {
  schedule: string;
  mode: string;
  lastRunAt: string | null;
  status: string;
  gamesRefreshed: number | null;
  playerPicksRefreshed: number | null;
};

export async function getModelRefreshStatus(sport: Sport): Promise<ModelRefreshStatus> {
  const fallback: ModelRefreshStatus = {
    schedule: "Daily at 09:05 UTC",
    mode: "Chronological state replay + current player features",
    lastRunAt: null,
    status: process.env.CRON_SECRET ? "scheduled" : "setup required",
    gamesRefreshed: null,
    playerPicksRefreshed: null
  };
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return fallback;
  try {
    const { data } = await createSupabaseAdminClient()
      .from("model_refresh_runs")
      .select("ran_at,status,games_refreshed,player_picks_refreshed")
      .eq("sport", sport)
      .order("ran_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    return data ? {
      ...fallback,
      lastRunAt: data.ran_at,
      status: data.status,
      gamesRefreshed: data.games_refreshed,
      playerPicksRefreshed: data.player_picks_refreshed
    } : fallback;
  } catch {
    return fallback;
  }
}

export async function recordModelRefresh(sport: Sport, values: { status: string; games: number; playerPicks: number; error?: string }): Promise<void> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  await createSupabaseAdminClient().from("model_refresh_runs").insert({
    sport,
    status: values.status,
    games_refreshed: values.games,
    player_picks_refreshed: values.playerPicks,
    error_message: values.error ?? null
  });
}

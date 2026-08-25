import "server-only";
import type { PlayerPick } from "@/lib/api";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Sport } from "@/lib/sports";

type PlayerPickRow = {
  pick_key: string;
  sport: Sport;
  slate_date: string;
  game_id: string;
  rank: number;
  player_id: string;
  player_name: string;
  headshot_url: string | null;
  position: string | null;
  team: string;
  opponent: string;
  game_time: string | null;
  market: string;
  selection: "Over" | "Under";
  line: number;
  projection: number;
  confidence: number;
  supporting_stats: string[] | null;
  explanation: string | null;
  model_version: string;
  model_edge: number | null;
  line_source: PlayerPick["lineSource"] | null;
  american_odds: number | null;
  sportsbook: string | null;
  over_odds: number | null;
  under_odds: number | null;
  market_books: number | null;
  market_updated_at: string | null;
  expected_value: number | null;
  sample_size: number;
  status: PlayerPick["status"];
  status_label: string;
  actual_value: number | null;
  result: PlayerPick["result"];
  result_updated_at: string | null;
};

const PLAYER_PICK_SELECT = "pick_key,sport,slate_date,game_id,rank,player_id,player_name,headshot_url,position,team,opponent,game_time,market,selection,line,projection,confidence,supporting_stats,explanation,model_version,model_edge,line_source,american_odds,sportsbook,over_odds,under_odds,market_books,market_updated_at,expected_value,sample_size,status,status_label,actual_value,result,result_updated_at";

function isConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function fromRow(row: PlayerPickRow): PlayerPick {
  return {
    id: row.pick_key,
    sport: row.sport,
    rank: row.rank,
    gameId: row.game_id,
    playerId: row.player_id,
    playerName: row.player_name,
    headshotUrl: row.headshot_url,
    position: row.position,
    team: row.team,
    opponent: row.opponent,
    gameTime: row.game_time,
    market: row.market,
    selection: row.selection,
    line: row.line,
    projection: row.projection,
    confidence: row.confidence,
    supportingStats: Array.isArray(row.supporting_stats) ? row.supporting_stats : [],
    explanation: row.explanation,
    modelVersion: row.model_version,
    modelEdge: row.model_edge,
    lineSource: row.line_source ?? "model_estimate",
    americanOdds: row.american_odds,
    sportsbook: row.sportsbook,
    overOdds: row.over_odds,
    underOdds: row.under_odds,
    marketBooks: row.market_books ?? 0,
    marketUpdatedAt: row.market_updated_at,
    expectedValue: row.expected_value,
    sampleSize: row.sample_size,
    status: row.status,
    statusLabel: row.status_label,
    actualValue: row.actual_value,
    result: row.result,
    resultUpdatedAt: row.result_updated_at,
    isTopFive: row.rank <= 5,
    is_locked: false
  };
}

function toRow(pick: PlayerPick, slateDate: string): PlayerPickRow {
  return {
    pick_key: pick.id,
    sport: pick.sport,
    slate_date: slateDate,
    game_id: pick.gameId,
    rank: pick.rank,
    player_id: pick.playerId,
    player_name: pick.playerName,
    headshot_url: pick.headshotUrl,
    position: pick.position,
    team: pick.team,
    opponent: pick.opponent,
    game_time: pick.gameTime,
    market: pick.market,
    selection: pick.selection,
    line: pick.line,
    projection: pick.projection ?? 0,
    confidence: pick.confidence ?? 0.5,
    supporting_stats: pick.supportingStats,
    explanation: pick.explanation,
    model_version: pick.modelVersion,
    model_edge: pick.modelEdge,
    line_source: pick.lineSource,
    american_odds: pick.americanOdds,
    sportsbook: pick.sportsbook,
    over_odds: pick.overOdds,
    under_odds: pick.underOdds,
    market_books: pick.marketBooks,
    market_updated_at: pick.marketUpdatedAt,
    expected_value: pick.expectedValue,
    sample_size: pick.sampleSize,
    status: pick.status,
    status_label: pick.statusLabel,
    actual_value: pick.actualValue,
    result: pick.result,
    result_updated_at: pick.resultUpdatedAt
  };
}

export async function loadPlayerPickSnapshots(sport: Sport, date: string): Promise<PlayerPick[] | null> {
  if (!isConfigured()) return null;
  try {
    const { data, error } = await createSupabaseAdminClient()
      .from("player_pick_snapshots")
      .select(PLAYER_PICK_SELECT)
      .eq("sport", sport)
      .eq("slate_date", date)
      .order("rank", { ascending: true });
    if (error) return null;
    return ((data ?? []) as PlayerPickRow[]).map(fromRow);
  } catch {
    return null;
  }
}

export async function storeInitialPlayerPicks(date: string, picks: PlayerPick[]): Promise<PlayerPick[]> {
  if (!isConfigured() || picks.length === 0) return picks;
  try {
    const supabase = createSupabaseAdminClient();
    await supabase.from("player_pick_snapshots").upsert(picks.map((pick) => toRow(pick, date)), {
      onConflict: "sport,slate_date,pick_key",
      ignoreDuplicates: true
    });
    return (await loadPlayerPickSnapshots(picks[0].sport, date)) ?? picks;
  } catch {
    return picks;
  }
}

export async function updatePlayerPickResults(date: string, picks: PlayerPick[]): Promise<void> {
  if (!isConfigured() || picks.length === 0) return;
  try {
    await createSupabaseAdminClient().from("player_pick_snapshots").upsert(
      picks.map((pick) => toRow(pick, date)),
      { onConflict: "sport,slate_date,pick_key" }
    );
  } catch {
    // A data-provider outage must not make the read path fail.
  }
}

export async function loadRecentPlayerPickResults(sport: Sport, limit = 250): Promise<PlayerPick[] | null> {
  if (!isConfigured()) return null;
  try {
    const { data, error } = await createSupabaseAdminClient()
      .from("player_pick_snapshots")
      .select(PLAYER_PICK_SELECT)
      .eq("sport", sport)
      .in("result", ["correct", "incorrect", "push", "void"])
      .order("result_updated_at", { ascending: false })
      .limit(Math.max(1, Math.min(500, limit)));
    if (error) return null;
    return ((data ?? []) as PlayerPickRow[]).map(fromRow);
  } catch {
    return null;
  }
}

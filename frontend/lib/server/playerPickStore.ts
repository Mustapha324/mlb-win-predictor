import "server-only";
import type { PlayerPick } from "@/lib/api";
import { createSupabaseAdminClient, hasSupabaseAdminCredentials } from "@/lib/supabase/admin";
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
  line_source?: PlayerPick["lineSource"] | null;
  american_odds?: number | null;
  sportsbook?: string | null;
  over_odds?: number | null;
  under_odds?: number | null;
  market_books?: number | null;
  market_updated_at?: string | null;
  expected_value?: number | null;
  sample_size: number;
  status: PlayerPick["status"];
  status_label: string;
  actual_value: number | null;
  result: PlayerPick["result"];
  result_updated_at: string | null;
};

type LegacyPlayerPickRow = Omit<PlayerPickRow, "line_source" | "american_odds" | "sportsbook" | "over_odds" | "under_odds" | "market_books" | "market_updated_at" | "expected_value">;
type StoreError = { code?: string; message?: string };

const LEGACY_PLAYER_PICK_SELECT = "pick_key,sport,slate_date,game_id,rank,player_id,player_name,headshot_url,position,team,opponent,game_time,market,selection,line,projection,confidence,supporting_stats,explanation,model_version,model_edge,sample_size,status,status_label,actual_value,result,result_updated_at";
const PLAYER_PICK_SELECT = `${LEGACY_PLAYER_PICK_SELECT},line_source,american_odds,sportsbook,over_odds,under_odds,market_books,market_updated_at,expected_value`;
const MARKET_COLUMN_PATTERN = /\b(line_source|american_odds|sportsbook|over_odds|under_odds|market_books|market_updated_at|expected_value)\b/i;
const reportedStoreIssues = new Set<string>();

function isConfigured(): boolean {
  return hasSupabaseAdminCredentials();
}

function storeError(error: unknown): StoreError {
  if (!error || typeof error !== "object") return { message: error instanceof Error ? error.message : "Unknown storage error" };
  const value = error as Record<string, unknown>;
  return {
    code: typeof value.code === "string" ? value.code : undefined,
    message: typeof value.message === "string" ? value.message : "Unknown storage error"
  };
}

function hasMissingMarketColumns(error: StoreError | null): boolean {
  return Boolean(
    (error?.code === "42703" || error?.code === "PGRST204") &&
    MARKET_COLUMN_PATTERN.test(error.message ?? "")
  );
}

function reportStoreIssue(operation: string, error: unknown): void {
  const normalized = storeError(error);
  const key = `${operation}:${normalized.code ?? "unknown"}:${normalized.message ?? ""}`;
  if (reportedStoreIssues.has(key)) return;
  reportedStoreIssues.add(key);
  console.warn(`[playerPickStore] ${operation}`, {
    code: normalized.code ?? "unknown",
    message: (normalized.message ?? "Unknown storage error").slice(0, 240)
  });
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
    americanOdds: row.american_odds ?? null,
    sportsbook: row.sportsbook ?? null,
    overOdds: row.over_odds ?? null,
    underOdds: row.under_odds ?? null,
    marketBooks: row.market_books ?? 0,
    marketUpdatedAt: row.market_updated_at ?? null,
    expectedValue: row.expected_value ?? null,
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

function toLegacyRow(pick: PlayerPick, slateDate: string): LegacyPlayerPickRow {
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
    sample_size: pick.sampleSize,
    status: pick.status,
    status_label: pick.statusLabel,
    actual_value: pick.actualValue,
    result: pick.result,
    result_updated_at: pick.resultUpdatedAt
  };
}

function toRow(pick: PlayerPick, slateDate: string): PlayerPickRow {
  return {
    ...toLegacyRow(pick, slateDate),
    line_source: pick.lineSource,
    american_odds: pick.americanOdds,
    sportsbook: pick.sportsbook,
    over_odds: pick.overOdds,
    under_odds: pick.underOdds,
    market_books: pick.marketBooks,
    market_updated_at: pick.marketUpdatedAt,
    expected_value: pick.expectedValue
  };
}

export async function loadPlayerPickSnapshots(sport: Sport, date: string): Promise<PlayerPick[] | null> {
  if (!isConfigured()) return null;
  try {
    const supabase = createSupabaseAdminClient();
    const primary = await supabase
      .from("player_pick_snapshots")
      .select(PLAYER_PICK_SELECT)
      .eq("sport", sport)
      .eq("slate_date", date)
      .order("rank", { ascending: true });
    if (!primary.error) return ((primary.data ?? []) as PlayerPickRow[]).map(fromRow);
    const normalized = storeError(primary.error);
    if (!hasMissingMarketColumns(normalized)) {
      reportStoreIssue("snapshot read failed", primary.error);
      return null;
    }
    reportStoreIssue("market columns unavailable; using the legacy snapshot schema", primary.error);
    const fallback = await supabase
      .from("player_pick_snapshots")
      .select(LEGACY_PLAYER_PICK_SELECT)
      .eq("sport", sport)
      .eq("slate_date", date)
      .order("rank", { ascending: true });
    if (fallback.error) {
      reportStoreIssue("legacy snapshot read failed", fallback.error);
      return null;
    }
    return ((fallback.data ?? []) as PlayerPickRow[]).map(fromRow);
  } catch (error) {
    reportStoreIssue("snapshot read threw", error);
    return null;
  }
}

export async function storeInitialPlayerPicks(date: string, picks: PlayerPick[]): Promise<PlayerPick[]> {
  if (!isConfigured() || picks.length === 0) return picks;
  try {
    const supabase = createSupabaseAdminClient();
    const primary = await supabase.from("player_pick_snapshots").upsert(picks.map((pick) => toRow(pick, date)), {
      onConflict: "sport,slate_date,pick_key",
      ignoreDuplicates: true
    });
    if (primary.error) {
      const normalized = storeError(primary.error);
      if (!hasMissingMarketColumns(normalized)) {
        reportStoreIssue("initial snapshot write failed", primary.error);
        return picks;
      }
      reportStoreIssue("market columns unavailable; storing the legacy snapshot shape", primary.error);
      const fallback = await supabase.from("player_pick_snapshots").upsert(picks.map((pick) => toLegacyRow(pick, date)), {
        onConflict: "sport,slate_date,pick_key",
        ignoreDuplicates: true
      });
      if (fallback.error) {
        reportStoreIssue("legacy initial snapshot write failed", fallback.error);
        return picks;
      }
    }
    return (await loadPlayerPickSnapshots(picks[0].sport, date)) ?? picks;
  } catch (error) {
    reportStoreIssue("initial snapshot write threw", error);
    return picks;
  }
}

export async function updatePlayerPickResults(date: string, picks: PlayerPick[]): Promise<void> {
  if (!isConfigured() || picks.length === 0) return;
  try {
    const supabase = createSupabaseAdminClient();
    const updates = picks.filter((pick) => pick.status !== "scheduled" || pick.result !== "pending");
    for (let offset = 0; offset < updates.length; offset += 8) {
      const responses = await Promise.all(updates.slice(offset, offset + 8).map((pick) => supabase
        .from("player_pick_snapshots")
        .update({
          status: pick.status,
          status_label: pick.statusLabel,
          actual_value: pick.actualValue,
          result: pick.result,
          result_updated_at: pick.resultUpdatedAt
        })
        .eq("sport", pick.sport)
        .eq("slate_date", date)
        .eq("pick_key", pick.id)));
      for (const response of responses) {
        if (response.error) reportStoreIssue("result-only snapshot update failed", response.error);
      }
    }
  } catch (error) {
    reportStoreIssue("result-only snapshot update threw", error);
  }
}

export async function loadRecentPlayerPickResults(sport: Sport, limit = 250): Promise<PlayerPick[] | null> {
  if (!isConfigured()) return null;
  try {
    const supabase = createSupabaseAdminClient();
    const primary = await supabase
      .from("player_pick_snapshots")
      .select(PLAYER_PICK_SELECT)
      .eq("sport", sport)
      .in("result", ["correct", "incorrect", "push", "void"])
      .order("result_updated_at", { ascending: false })
      .limit(Math.max(1, Math.min(500, limit)));
    if (!primary.error) return ((primary.data ?? []) as PlayerPickRow[]).map(fromRow);
    const normalized = storeError(primary.error);
    if (!hasMissingMarketColumns(normalized)) {
      reportStoreIssue("recent result read failed", primary.error);
      return null;
    }
    reportStoreIssue("market columns unavailable; reading legacy results", primary.error);
    const fallback = await supabase
      .from("player_pick_snapshots")
      .select(LEGACY_PLAYER_PICK_SELECT)
      .eq("sport", sport)
      .in("result", ["correct", "incorrect", "push", "void"])
      .order("result_updated_at", { ascending: false })
      .limit(Math.max(1, Math.min(500, limit)));
    if (fallback.error) {
      reportStoreIssue("legacy recent result read failed", fallback.error);
      return null;
    }
    return ((fallback.data ?? []) as PlayerPickRow[]).map(fromRow);
  } catch (error) {
    reportStoreIssue("recent result read threw", error);
    return null;
  }
}

export async function loadPendingPlayerPickDates(sport: Sport, beforeDate: string, limit = 3): Promise<string[]> {
  if (!isConfigured()) return [];
  try {
    const { data, error } = await createSupabaseAdminClient()
      .from("player_pick_snapshots")
      .select("slate_date")
      .eq("sport", sport)
      .eq("result", "pending")
      .lt("slate_date", beforeDate)
      .order("slate_date", { ascending: false })
      .limit(500);
    if (error) {
      reportStoreIssue("pending result date read failed", error);
      return [];
    }
    return [...new Set((data ?? []).map((row) => String(row.slate_date)))].slice(0, Math.max(1, Math.min(14, limit)));
  } catch (error) {
    reportStoreIssue("pending result date read threw", error);
    return [];
  }
}

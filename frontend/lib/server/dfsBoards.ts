import "server-only";
import type { Sport } from "@/lib/sports";

/**
 * Fetches the actual PrizePicks / Underdog pick'em boards through The Odds API
 * DFS region so generated picks can be pinned to props that are really listed
 * at standard full-payout multipliers.
 *
 * Only main market keys are requested — The Odds API files demons/goblins and
 * other non-1x-multiplier squares under `_alternate` markets, so everything
 * returned here is a standard-payout board projection by construction.
 *
 * Like marketOdds.ts, a missing THE_ODDS_API_KEY is non-fatal: callers fall
 * back to the synthetic board-plausible catalog.
 */

export type DfsBoardProp = {
  line: number;
  /** Which boards list the prop, e.g. ["PrizePicks", "Underdog"]. */
  sources: string[];
};

/** normalized player name -> app market name -> board prop */
export type DfsBoard = Map<string, Map<string, DfsBoardProp>>;

type OddsApiEvent = { id?: string; home_team?: string; away_team?: string; commence_time?: string };
type OddsApiOutcome = { name?: string; description?: string; point?: number };
type OddsApiMarket = { key?: string; outcomes?: OddsApiOutcome[] };
type OddsApiBookmaker = { key?: string; markets?: OddsApiMarket[] };
type OddsApiEventOdds = { bookmakers?: OddsApiBookmaker[] };

const SPORT_KEYS: Record<Sport, string> = {
  mlb: "baseball_mlb",
  nfl: "americanfootball_nfl"
};

const DFS_BOOKMAKERS: Record<string, string> = {
  prizepicks: "PrizePicks",
  underdog: "Underdog"
};

/** App market name -> The Odds API main market key (never `_alternate`). */
const MARKET_KEYS: Record<Sport, Record<string, string>> = {
  mlb: {
    Hits: "batter_hits",
    "Total bases": "batter_total_bases",
    "Hits+Runs+RBIs": "batter_hits_runs_rbis",
    RBIs: "batter_rbis",
    Runs: "batter_runs_scored",
    "Home runs": "batter_home_runs",
    "Stolen bases": "batter_stolen_bases",
    Strikeouts: "pitcher_strikeouts",
    "Pitching outs": "pitcher_outs",
    "Earned runs allowed": "pitcher_earned_runs",
    "Hits allowed": "pitcher_hits_allowed",
    "Walks allowed": "pitcher_walks"
  },
  nfl: {
    "Passing yards": "player_pass_yds",
    "Passing touchdowns": "player_pass_tds",
    Completions: "player_pass_completions",
    "Pass attempts": "player_pass_attempts",
    "Rushing yards": "player_rush_yds",
    "Rush attempts": "player_rush_attempts",
    "Receiving yards": "player_reception_yds",
    Receptions: "player_receptions",
    "Rush+Rec yards": "player_rush_reception_yds",
    "Rush+Rec TDs": "player_rush_reception_tds"
  }
};

export function normalizePlayerName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function normalizeTeam(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function fetchJson<T>(url: string, revalidate: number): Promise<T | null> {
  try {
    const response = await fetch(url, { next: { revalidate }, headers: { Accept: "application/json" } });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}

function mergeEventOdds(board: DfsBoard, odds: OddsApiEventOdds, marketNames: Map<string, string>): void {
  for (const bookmaker of odds.bookmakers ?? []) {
    const source = bookmaker.key ? DFS_BOOKMAKERS[bookmaker.key] : undefined;
    if (!source) continue;
    for (const market of bookmaker.markets ?? []) {
      const marketName = market.key ? marketNames.get(market.key) : undefined;
      if (!marketName) continue;
      for (const outcome of market.outcomes ?? []) {
        if (!outcome.description || typeof outcome.point !== "number") continue;
        const player = normalizePlayerName(outcome.description);
        if (!player) continue;
        const markets = board.get(player) ?? new Map<string, DfsBoardProp>();
        const existing = markets.get(marketName);
        if (existing) {
          if (!existing.sources.includes(source)) existing.sources.push(source);
          // PrizePicks line wins ties for display; boards rarely disagree by much.
          if (source === "PrizePicks") existing.line = outcome.point;
        } else {
          markets.set(marketName, { line: outcome.point, sources: [source] });
        }
        board.set(player, markets);
      }
    }
  }
}

/**
 * Returns the standard-payout DFS board for the slate, keyed by normalized
 * player name. Empty map when the key is missing, boards are disabled, or the
 * API has nothing — callers must treat that as "board unknown", not "off-board".
 */
export async function getDfsBoard(
  sport: Sport,
  games: Array<{ homeTeam: string; awayTeam: string }>
): Promise<DfsBoard> {
  const board: DfsBoard = new Map();
  const apiKey = process.env.THE_ODDS_API_KEY;
  if (!apiKey || games.length === 0 || process.env.DFS_BOARDS === "off") return board;

  const baseUrl = process.env.THE_ODDS_API_BASE_URL ?? "https://api.the-odds-api.com/v4";
  const sportKey = SPORT_KEYS[sport];
  const events = await fetchJson<OddsApiEvent[]>(`${baseUrl}/sports/${sportKey}/events?apiKey=${encodeURIComponent(apiKey)}&dateFormat=iso`, 900);
  if (!events) return board;

  const wanted = new Set(games.map((game) => `${normalizeTeam(game.homeTeam)}|${normalizeTeam(game.awayTeam)}`));
  const maxEvents = Math.max(1, Number(process.env.DFS_BOARD_MAX_EVENTS ?? 16));
  const matched = events
    .filter((event) => event.id && event.home_team && event.away_team && wanted.has(`${normalizeTeam(event.home_team)}|${normalizeTeam(event.away_team)}`))
    .slice(0, maxEvents);
  if (matched.length === 0) return board;

  const marketNames = new Map(Object.entries(MARKET_KEYS[sport]).map(([name, key]) => [key, name]));
  const marketsParam = Object.values(MARKET_KEYS[sport]).join(",");
  await Promise.all(
    matched.map(async (event) => {
      const query = new URLSearchParams({
        apiKey,
        regions: "us_dfs",
        markets: marketsParam,
        oddsFormat: "american",
        dateFormat: "iso"
      });
      const odds = await fetchJson<OddsApiEventOdds>(`${baseUrl}/sports/${sportKey}/events/${encodeURIComponent(event.id!)}/odds?${query}`, 1800);
      if (odds) mergeEventOdds(board, odds, marketNames);
    })
  );
  return board;
}

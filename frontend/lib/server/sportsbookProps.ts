import "server-only";
import type { Sport } from "@/lib/sports";
import { normalizePlayerName } from "@/lib/playerPropOdds";
import { parseEspnMoneyline } from "@/lib/marketMath";
import {
  parseDkPropMarkets,
  parseEspnPropBets,
  type DkMarket,
  type DkSelection,
  type EspnPropBetItem,
  type SportsbookLine
} from "@/lib/sportsbookPropParsing";
import { fetchEspnScoreboard, matchEspnEvents, slateDateRange, type SlateGameRef } from "@/lib/server/espnScoreboard";

/**
 * Real sportsbook player-prop lines for a slate, with no API key.
 *
 * Lines: ESPN's core API republishes DraftKings' player props for every game
 * (`.../odds/100/propBets`), keyed by ESPN athlete id. MLB items carry prices
 * as [over, under] pairs; NFL items are lines only.
 * Prices (NFL): DraftKings' public sportsbook feed, reached through the event
 * id ESPN embeds in its bet links. That feed is Akamai-fronted and may refuse
 * some hosts, so it is best-effort: a refusal leaves NFL lines priced "pending"
 * and never blocks the board.
 * Names: ESPN team rosters map athlete ids to names so MLB picks (StatsAPI
 * ids) and DraftKings selections (names) can be matched.
 */

export type SportsbookPropLine = SportsbookLine & { sportsbook: string };
/** lookup key -> market -> line */
export type SportsbookLineLookup = Map<string, Map<string, SportsbookPropLine>>;

export type SportsbookBoard = {
  sportsbook: string;
  /** Player-market lines found across the slate; 0 means the feed had nothing. */
  coverage: number;
  /** Game ids with at least one player line. */
  gamesWithLines: Set<string>;
  /** gameId -> ESPN athlete id -> market -> line. NFL box-score ids are ESPN ids, so this matches directly. */
  byAthlete: Map<string, SportsbookLineLookup>;
  /** gameId -> normalized player name -> market -> line. MLB picks (StatsAPI ids) match by name. */
  byName: Map<string, SportsbookLineLookup>;
  /** Number of lines that carry at least an over price. */
  pricedLines: number;
};

const CORE_BASE: Record<Sport, string> = {
  mlb: "https://sports.core.api.espn.com/v2/sports/baseball/leagues/mlb",
  nfl: "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl"
};
const SITE_BASE: Record<Sport, string> = {
  mlb: "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb",
  nfl: "https://site.api.espn.com/apis/site/v2/sports/football/nfl"
};
const DK_BASE = "https://sportsbook-nash.draftkings.com/api/sportscontent/dkusoh/v1";
/** DraftKings NFL categories: passing, rushing, receiving, touchdown scorers. */
const DK_NFL_CATEGORIES = [1000, 1001, 1342, 1003];
const SPORTSBOOK_NAME = "DraftKings";

export function emptySportsbookBoard(): SportsbookBoard {
  return { sportsbook: SPORTSBOOK_NAME, coverage: 0, gamesWithLines: new Set(), byAthlete: new Map(), byName: new Map(), pricedLines: 0 };
}

async function fetchJson<T>(url: string, revalidate: number, timeoutMs = 10_000): Promise<T | null> {
  try {
    const response = await fetch(url, {
      next: { revalidate },
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; SportIQ/2.0)" },
      signal: AbortSignal.timeout(timeoutMs)
    });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}

type PropBetsPage = { pageCount?: number; items?: EspnPropBetItem[] };

async function fetchPropBets(sport: Sport, espnEventId: string): Promise<EspnPropBetItem[]> {
  const base = `${CORE_BASE[sport]}/events/${espnEventId}/competitions/${espnEventId}/odds/100/propBets?limit=1000`;
  const first = await fetchJson<PropBetsPage>(base, 600);
  if (!first) return [];
  const items = [...(first.items ?? [])];
  const pages = Math.min(3, first.pageCount ?? 1);
  for (let page = 2; page <= pages; page += 1) {
    const next = await fetchJson<PropBetsPage>(`${base}&page=${page}`, 600);
    items.push(...(next?.items ?? []));
  }
  return items;
}

type RosterPayload = { athletes?: Array<{ items?: Array<{ id?: string; displayName?: string; fullName?: string }> } & { id?: string; displayName?: string; fullName?: string }> };

/** ESPN athlete id -> display name for one team (24h cache; rosters rarely change within a day). */
async function fetchRosterNames(sport: Sport, teamId: string): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const payload = await fetchJson<RosterPayload>(`${SITE_BASE[sport]}/teams/${encodeURIComponent(teamId)}/roster`, 21_600);
  for (const group of payload?.athletes ?? []) {
    const entries = group.items ?? [group];
    for (const athlete of entries) {
      const name = athlete.displayName ?? athlete.fullName;
      if (athlete.id && name) names.set(String(athlete.id), name);
    }
  }
  return names;
}

type DkCategoryPayload = { markets?: DkMarket[]; selections?: DkSelection[] };

/** DraftKings NFL prices keyed by normalized player name; empty when the feed refuses. */
async function fetchDkNflPrices(dkEventId: string): Promise<Map<string, Map<string, SportsbookLine>>> {
  const merged = new Map<string, Map<string, SportsbookLine>>();
  const pages = await Promise.all(
    DK_NFL_CATEGORIES.map((category) => fetchJson<DkCategoryPayload>(`${DK_BASE}/events/${dkEventId}/categories/${category}`, 300, 6_000))
  );
  for (const page of pages) {
    if (!page) continue;
    for (const [player, markets] of parseDkPropMarkets(page.markets ?? [], page.selections ?? [])) {
      const existing = merged.get(player) ?? new Map<string, SportsbookLine>();
      for (const [market, line] of markets) if (!existing.has(market)) existing.set(market, line);
      merged.set(player, existing);
    }
  }
  return merged;
}

function setLine(lookup: Map<string, SportsbookLineLookup>, gameId: string, key: string, line: SportsbookPropLine): void {
  const game = lookup.get(gameId) ?? new Map<string, Map<string, SportsbookPropLine>>();
  const perKey = game.get(key) ?? new Map<string, SportsbookPropLine>();
  perKey.set(line.market, line);
  game.set(key, perKey);
  lookup.set(gameId, game);
}

/**
 * Builds the real-line board for the slate. `SPORTSBOOK_PROPS=off` disables
 * it (the generator then falls back to DFS/synthetic lines).
 */
export async function getSportsbookBoard(sport: Sport, games: SlateGameRef[], slateDate: string): Promise<SportsbookBoard> {
  const board = emptySportsbookBoard();
  if (games.length === 0 || process.env.SPORTSBOOK_PROPS === "off") return board;
  const range = slateDateRange(games, slateDate);
  const events = await fetchEspnScoreboard(sport, range.start, range.end);
  const matched = [...matchEspnEvents(sport, games, events)].filter(([, event]) => event.state === "pre");
  if (!matched.length) return board;

  const rosterCache = new Map<string, Promise<Map<string, string>>>();
  const rosterFor = (teamId: string | null) => {
    if (!teamId) return Promise.resolve(new Map<string, string>());
    const cached = rosterCache.get(teamId) ?? fetchRosterNames(sport, teamId);
    rosterCache.set(teamId, cached);
    return cached;
  };

  await Promise.all(matched.map(async ([gameId, event]) => {
    const game = games.find((item) => item.gameId === gameId);
    const [items, homeNames, awayNames] = await Promise.all([fetchPropBets(sport, event.id), rosterFor(event.homeTeamId), rosterFor(event.awayTeamId)]);
    const lines = parseEspnPropBets(sport, items);
    if (lines.size === 0) return;
    const names = new Map([...homeNames, ...awayNames]);
    let prices = new Map<string, Map<string, SportsbookLine>>();
    if (sport === "nfl" && game) {
      const dkEventId = parseEspnMoneyline(event.odds, game.homeTeam, game.awayTeam, "")?.dkEventId ?? null;
      if (dkEventId) prices = await fetchDkNflPrices(dkEventId);
    }
    for (const [athleteId, markets] of lines) {
      const name = names.get(athleteId) ?? null;
      const nameKey = name ? normalizePlayerName(name) : null;
      for (const [market, espnLine] of markets) {
        const priced = nameKey ? prices.get(nameKey)?.get(market) : undefined;
        // DraftKings' own feed is the source of truth when it answers; ESPN mirrors it with a lag.
        const line: SportsbookPropLine = priced
          ? { ...espnLine, line: priced.line, overOdds: priced.overOdds, underOdds: priced.underOdds, sportsbook: SPORTSBOOK_NAME }
          : { ...espnLine, sportsbook: SPORTSBOOK_NAME };
        setLine(board.byAthlete, gameId, athleteId, line);
        if (nameKey) setLine(board.byName, gameId, nameKey, line);
        board.coverage += 1;
        if (line.overOdds !== null) board.pricedLines += 1;
        board.gamesWithLines.add(gameId);
      }
    }
  }));
  return board;
}

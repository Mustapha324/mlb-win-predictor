import "server-only";
import type { Sport } from "@/lib/sports";
import { normalizeTeamName, parseEspnMoneyline, type EspnOddsLike, type MoneylineQuote } from "@/lib/marketMath";

/**
 * ESPN site scoreboard, shared by the market-line adapter and the sportsbook
 * prop adapter. One cached fetch per sport + date range; every consumer reads
 * event ids, ESPN team ids, and the DraftKings odds block from it.
 */

export type EspnScoreboardEvent = {
  id: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeTeamId: string | null;
  awayTeamId: string | null;
  state: "pre" | "in" | "post";
  odds: EspnOddsLike | undefined;
};

const SCOREBOARD_BASE: Record<Sport, string> = {
  mlb: "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard",
  nfl: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
};

type RawScoreboard = {
  events?: Array<{
    id?: string;
    date?: string;
    status?: { type?: { state?: "pre" | "in" | "post" } };
    competitions?: Array<{
      competitors?: Array<{ homeAway?: "home" | "away"; team?: { id?: string; displayName?: string } }>;
      odds?: EspnOddsLike[];
    }>;
  }>;
};

function compact(date: string): string {
  return date.replaceAll("-", "");
}

/** Events for one date (MLB) or an inclusive date range (NFL week). */
export async function fetchEspnScoreboard(sport: Sport, startDate: string, endDate = startDate): Promise<EspnScoreboardEvent[]> {
  const dates = startDate === endDate ? compact(startDate) : `${compact(startDate)}-${compact(endDate)}`;
  try {
    const response = await fetch(`${SCOREBOARD_BASE[sport]}?dates=${dates}&limit=1000`, {
      next: { revalidate: 300 },
      headers: { Accept: "application/json", "User-Agent": "SportIQ/2.0 (market lines)" },
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as RawScoreboard;
    const events: EspnScoreboardEvent[] = [];
    for (const event of payload.events ?? []) {
      const competition = event.competitions?.[0];
      const home = competition?.competitors?.find((team) => team.homeAway === "home");
      const away = competition?.competitors?.find((team) => team.homeAway === "away");
      if (!event.id || !event.date || !home?.team?.displayName || !away?.team?.displayName) continue;
      events.push({
        id: event.id,
        date: event.date,
        homeTeam: home.team.displayName,
        awayTeam: away.team.displayName,
        homeTeamId: home.team.id ?? null,
        awayTeamId: away.team.id ?? null,
        state: event.status?.type?.state ?? "pre",
        odds: competition?.odds?.[0]
      });
    }
    return events;
  } catch {
    return [];
  }
}

export type SlateGameRef = { gameId: string; homeTeam: string; awayTeam: string; gameTimeUtc?: string | null };

/**
 * Matches slate games to ESPN events. NFL game ids are ESPN event ids already;
 * MLB (StatsAPI ids) match on team names plus the nearest start time, which
 * keeps doubleheaders apart.
 */
export function matchEspnEvents(sport: Sport, games: SlateGameRef[], events: EspnScoreboardEvent[]): Map<string, EspnScoreboardEvent> {
  const matched = new Map<string, EspnScoreboardEvent>();
  const used = new Set<string>();
  for (const game of games) {
    if (sport === "nfl") {
      const event = events.find((item) => item.id === game.gameId);
      if (event) matched.set(game.gameId, event);
      continue;
    }
    const candidates = events.filter(
      (item) =>
        !used.has(item.id) &&
        normalizeTeamName(item.homeTeam) === normalizeTeamName(game.homeTeam) &&
        normalizeTeamName(item.awayTeam) === normalizeTeamName(game.awayTeam)
    );
    if (!candidates.length) continue;
    const target = game.gameTimeUtc ? Date.parse(game.gameTimeUtc) : NaN;
    const best = Number.isFinite(target)
      ? candidates.toSorted((a, b) => Math.abs(Date.parse(a.date) - target) - Math.abs(Date.parse(b.date) - target))[0]
      : candidates[0];
    used.add(best.id);
    matched.set(game.gameId, best);
  }
  return matched;
}

/** Date range that covers every game in the slate (falls back to the slate date). */
export function slateDateRange(games: SlateGameRef[], fallbackDate: string): { start: string; end: string } {
  const days = games
    .map((game) => game.gameTimeUtc)
    .filter((value): value is string => Boolean(value))
    .map((value) => value.slice(0, 10))
    .toSorted();
  if (!days.length) return { start: fallbackDate, end: fallbackDate };
  // Late US games cross midnight UTC; widen by a day on both ends so the ESPN calendar day always covers them.
  const shift = (day: string, amount: number) => {
    const date = new Date(`${day}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + amount);
    return date.toISOString().slice(0, 10);
  };
  return { start: shift(days[0], -1), end: shift(days.at(-1)!, 1) };
}

/** DraftKings moneylines (via ESPN) for slate games, keyed by our game id. */
export async function getEspnMoneylines(sport: Sport, games: SlateGameRef[], fallbackDate: string): Promise<Map<string, MoneylineQuote>> {
  const quotes = new Map<string, MoneylineQuote>();
  if (!games.length) return quotes;
  const range = slateDateRange(games, fallbackDate);
  const events = await fetchEspnScoreboard(sport, range.start, range.end);
  if (!events.length) return quotes;
  const now = new Date().toISOString();
  for (const [gameId, event] of matchEspnEvents(sport, games, events)) {
    if (event.state !== "pre") continue;
    const game = games.find((item) => item.gameId === gameId)!;
    const quote = parseEspnMoneyline(event.odds, game.homeTeam, game.awayTeam, now, event.id);
    if (quote) quotes.set(gameId, quote);
  }
  return quotes;
}

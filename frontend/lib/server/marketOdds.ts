import type { Sport } from "@/lib/sports";
import {
  compilePlayerPropQuotes,
  decimalToAmerican,
  PLAYER_PROP_MARKETS,
  type PlayerPropQuote,
  type RawPropBookmaker
} from "@/lib/playerPropOdds";
import type { MoneylineQuote } from "@/lib/marketMath";
import { getEspnMoneylines } from "@/lib/server/espnScoreboard";

type OddsOutcome = { name?: string; price?: number };
type OddsMarket = { key?: string; outcomes?: OddsOutcome[] };
type OddsBookmaker = { key?: string; title?: string; last_update?: string; markets?: OddsMarket[] };
type OddsEvent = {
  id?: string;
  commence_time?: string;
  home_team?: string;
  away_team?: string;
  bookmakers?: OddsBookmaker[];
};

export type MarketConsensus = MoneylineQuote;

export type MarketGameRef = { gameId: string; homeTeam: string; awayTeam: string; gameTimeUtc?: string | null };

const SPORT_KEYS: Record<Sport, string> = {
  mlb: "baseball_mlb",
  nfl: "americanfootball_nfl"
};

function normalizeTeam(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findOutcome(outcomes: OddsOutcome[], team: string): OddsOutcome | undefined {
  const normalized = normalizeTeam(team);
  return outcomes.find((outcome) => outcome.name && normalizeTeam(outcome.name) === normalized);
}

type PropCacheEntry = { expiresAt: number; quotes: Map<string, PlayerPropQuote> };
const globalOddsCache = globalThis as typeof globalThis & { __sportIqPlayerPropCache?: Map<string, PropCacheEntry> };
const playerPropCache = globalOddsCache.__sportIqPlayerPropCache ?? new Map<string, PropCacheEntry>();
globalOddsCache.__sportIqPlayerPropCache = playerPropCache;

/**
 * Loads player-prop lines one event at a time, as required by The Odds API.
 * Quotes are server-only, no-vig consensus lines with the best available price
 * retained for each side. Any provider or quota failure is a safe empty result.
 */
export async function getPlayerPropMarkets(
  sport: Sport,
  games: Array<{ gameId: string; homeTeam: string; awayTeam: string }>
): Promise<Map<string, PlayerPropQuote>> {
  const apiKey = process.env.THE_ODDS_API_KEY;
  if (!apiKey || games.length === 0) return new Map();
  const cacheKey = `${sport}:${games.map((game) => game.gameId).toSorted().join(",")}`;
  const cached = playerPropCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return new Map(cached.quotes);

  const baseUrl = process.env.THE_ODDS_API_BASE_URL ?? "https://api.the-odds-api.com/v4";
  const commonQuery = new URLSearchParams({ apiKey, dateFormat: "iso" });
  try {
    const eventsResponse = await fetch(`${baseUrl}/sports/${SPORT_KEYS[sport]}/events?${commonQuery}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000)
    });
    if (!eventsResponse.ok) return new Map();
    const events = (await eventsResponse.json()) as OddsEvent[];
    const matched = games.flatMap((game) => {
      const event = events.find((item) =>
        item.id && item.home_team && item.away_team &&
        normalizeTeam(item.home_team) === normalizeTeam(game.homeTeam) &&
        normalizeTeam(item.away_team) === normalizeTeam(game.awayTeam)
      );
      return event?.id ? [{ game, eventId: event.id }] : [];
    });
    const marketKeys = Object.keys(PLAYER_PROP_MARKETS[sport]).join(",");
    const settled = await Promise.allSettled(matched.map(async ({ game, eventId }) => {
      const query = new URLSearchParams({
        apiKey,
        regions: process.env.ODDS_REGIONS ?? "us",
        markets: marketKeys,
        oddsFormat: "decimal",
        dateFormat: "iso"
      });
      const response = await fetch(`${baseUrl}/sports/${SPORT_KEYS[sport]}/events/${encodeURIComponent(eventId)}/odds?${query}`, {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000)
      });
      if (!response.ok) return new Map<string, PlayerPropQuote>();
      const event = (await response.json()) as { bookmakers?: RawPropBookmaker[] };
      return compilePlayerPropQuotes(sport, game.gameId, event.bookmakers ?? []);
    }));
    const quotes = new Map<string, PlayerPropQuote>();
    for (const item of settled) {
      if (item.status !== "fulfilled") continue;
      for (const [key, quote] of item.value) quotes.set(key, quote);
    }
    playerPropCache.set(cacheKey, { quotes, expiresAt: Date.now() + 60_000 });
    return quotes;
  } catch {
    return cached ? new Map(cached.quotes) : new Map();
  }
}

function consensusFor(event: OddsEvent, homeTeam: string, awayTeam: string): MarketConsensus | null {
  const samples: Array<{ home: number; away: number; homePrice: number; awayPrice: number; updatedAt: string }> = [];
  for (const bookmaker of event.bookmakers ?? []) {
    const market = bookmaker.markets?.find((item) => item.key === "h2h");
    if (!market?.outcomes) continue;
    const home = findOutcome(market.outcomes, homeTeam);
    const away = findOutcome(market.outcomes, awayTeam);
    if (!home?.price || !away?.price || home.price <= 1 || away.price <= 1) continue;
    const rawHome = 1 / home.price;
    const rawAway = 1 / away.price;
    const overround = rawHome + rawAway;
    samples.push({
      home: rawHome / overround,
      away: rawAway / overround,
      homePrice: home.price,
      awayPrice: away.price,
      updatedAt: bookmaker.last_update ?? new Date().toISOString()
    });
  }
  if (!samples.length) return null;
  const average = (key: "home" | "away" | "homePrice" | "awayPrice") =>
    samples.reduce((sum, sample) => sum + sample[key], 0) / samples.length;
  const homeProbability = average("home");
  const awayProbability = average("away");
  return {
    homeWinProbability: Number(homeProbability.toFixed(4)),
    awayWinProbability: Number(awayProbability.toFixed(4)),
    homeAmericanOdds: decimalToAmerican(average("homePrice")),
    awayAmericanOdds: decimalToAmerican(average("awayPrice")),
    favorite: homeProbability >= awayProbability ? homeTeam : awayTeam,
    source: "Live market consensus",
    books: samples.length,
    updatedAt: samples.map((sample) => sample.updatedAt).sort().at(-1) ?? new Date().toISOString()
  };
}

/**
 * Pregame moneylines for the slate. Multi-book consensus from The Odds API
 * when THE_ODDS_API_KEY is configured; every game still missing a line then
 * falls back to the DraftKings moneyline ESPN publishes on its scoreboard,
 * which needs no key. Failures are non-fatal: an empty map means "no line".
 */
export async function getMarketConsensus(sport: Sport, games: MarketGameRef[], slateDate?: string): Promise<Map<string, MarketConsensus>> {
  if (games.length === 0) return new Map();
  const result = await oddsApiConsensus(sport, games);
  const missing = games.filter((game) => !result.has(game.gameId));
  if (missing.length === 0) return result;
  const fallbackDate = slateDate ?? missing.find((game) => game.gameTimeUtc)?.gameTimeUtc?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
  for (const [gameId, quote] of await getEspnMoneylines(sport, missing, fallbackDate)) result.set(gameId, quote);
  return result;
}

async function oddsApiConsensus(sport: Sport, games: MarketGameRef[]): Promise<Map<string, MarketConsensus>> {
  const apiKey = process.env.THE_ODDS_API_KEY;
  if (!apiKey || games.length === 0) return new Map();

  const baseUrl = process.env.THE_ODDS_API_BASE_URL ?? "https://api.the-odds-api.com/v4";
  const query = new URLSearchParams({
    apiKey,
    regions: process.env.ODDS_REGIONS ?? "us",
    markets: "h2h",
    oddsFormat: "decimal",
    dateFormat: "iso"
  });

  try {
    const response = await fetch(`${baseUrl}/sports/${SPORT_KEYS[sport]}/odds?${query}`, {
      cache: "no-store",
      headers: { Accept: "application/json" }
    });
    if (!response.ok) return new Map();
    const events = (await response.json()) as OddsEvent[];
    const result = new Map<string, MarketConsensus>();
    for (const game of games) {
      const event = events.find(
        (item) =>
          item.home_team &&
          item.away_team &&
          normalizeTeam(item.home_team) === normalizeTeam(game.homeTeam) &&
          normalizeTeam(item.away_team) === normalizeTeam(game.awayTeam)
      );
      if (!event) continue;
      const consensus = consensusFor(event, game.homeTeam, game.awayTeam);
      if (consensus) result.set(game.gameId, consensus);
    }
    return result;
  } catch {
    return new Map();
  }
}

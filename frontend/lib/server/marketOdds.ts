import type { Sport } from "@/lib/sports";

type OddsOutcome = { name?: string; price?: number };
type OddsMarket = { key?: string; outcomes?: OddsOutcome[] };
type OddsBookmaker = { key?: string; title?: string; last_update?: string; markets?: OddsMarket[] };
type OddsEvent = {
  id?: string;
  home_team?: string;
  away_team?: string;
  bookmakers?: OddsBookmaker[];
};

export type MarketConsensus = {
  homeWinProbability: number;
  awayWinProbability: number;
  homeAmericanOdds: number;
  awayAmericanOdds: number;
  favorite: string;
  source: string;
  books: number;
  updatedAt: string;
};

const SPORT_KEYS: Record<Sport, string> = {
  mlb: "baseball_mlb",
  nfl: "americanfootball_nfl"
};

function normalizeTeam(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function decimalToAmerican(price: number): number {
  if (price >= 2) return Math.round((price - 1) * 100);
  return Math.round(-100 / (price - 1));
}

function findOutcome(outcomes: OddsOutcome[], team: string): OddsOutcome | undefined {
  const normalized = normalizeTeam(team);
  return outcomes.find((outcome) => outcome.name && normalizeTeam(outcome.name) === normalized);
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
 * Fetches live moneyline consensus when THE_ODDS_API_KEY is configured.
 * A missing key is intentionally non-fatal so the prediction product still works.
 */
export async function getMarketConsensus(
  sport: Sport,
  games: Array<{ gameId: string; homeTeam: string; awayTeam: string }>
): Promise<Map<string, MarketConsensus>> {
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

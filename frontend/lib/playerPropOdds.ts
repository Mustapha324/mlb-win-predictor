import type { Sport } from "@/lib/sports";

export type RawPropOutcome = { name?: string; description?: string; price?: number; point?: number };
export type RawPropMarket = { key?: string; last_update?: string; outcomes?: RawPropOutcome[] };
export type RawPropBookmaker = { key?: string; title?: string; last_update?: string; markets?: RawPropMarket[] };

export type PlayerPropQuote = {
  gameId: string;
  playerName: string;
  market: string;
  line: number;
  fairOverProbability: number;
  overAmericanOdds: number | null;
  underAmericanOdds: number | null;
  overBook: string | null;
  underBook: string | null;
  books: number;
  updatedAt: string;
};

export const PLAYER_PROP_MARKETS: Record<Sport, Record<string, string>> = {
  nfl: {
    player_pass_yds: "Passing yards",
    player_rush_yds: "Rushing yards",
    player_reception_yds: "Receiving yards",
    player_receptions: "Receptions",
    player_pass_tds: "Passing touchdowns"
  },
  mlb: {
    batter_hits: "Hits",
    batter_total_bases: "Total bases",
    batter_home_runs: "Home runs",
    batter_rbis: "RBIs",
    pitcher_strikeouts: "Strikeouts"
  }
};

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

export function normalizePlayerName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((part) => part && !SUFFIXES.has(part))
    .join("");
}

export function playerPropKey(gameId: string, playerName: string, market: string): string {
  return `${gameId}|${normalizePlayerName(playerName)}|${market.toLowerCase()}`;
}

export function decimalToAmerican(price: number): number {
  if (price >= 2) return Math.round((price - 1) * 100);
  return Math.round(-100 / (price - 1));
}

export function americanToDecimal(price: number): number {
  return price > 0 ? 1 + price / 100 : 1 + 100 / Math.abs(price);
}

type BookLine = {
  title: string;
  over: number | null;
  under: number | null;
  updatedAt: string;
};

type QuoteGroup = {
  playerName: string;
  market: string;
  line: number;
  books: Map<string, BookLine>;
};

function finiteDecimal(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 1;
}

export function compilePlayerPropQuotes(
  sport: Sport,
  gameId: string,
  bookmakers: RawPropBookmaker[]
): Map<string, PlayerPropQuote> {
  const groups = new Map<string, QuoteGroup>();
  const supported = PLAYER_PROP_MARKETS[sport];
  for (const bookmaker of bookmakers) {
    const bookKey = bookmaker.key ?? bookmaker.title;
    const title = bookmaker.title ?? bookmaker.key ?? "Sportsbook";
    if (!bookKey) continue;
    for (const market of bookmaker.markets ?? []) {
      const marketName = market.key ? supported[market.key] : undefined;
      if (!marketName) continue;
      for (const outcome of market.outcomes ?? []) {
        const side = outcome.name?.toLowerCase();
        const playerName = outcome.description?.trim();
        if ((side !== "over" && side !== "under") || !playerName || !Number.isFinite(outcome.point) || !finiteDecimal(outcome.price)) continue;
        const line = Number(outcome.point);
        const groupKey = `${normalizePlayerName(playerName)}|${marketName}|${line}`;
        const group = groups.get(groupKey) ?? { playerName, market: marketName, line, books: new Map() };
        const book = group.books.get(bookKey) ?? {
          title,
          over: null,
          under: null,
          updatedAt: market.last_update ?? bookmaker.last_update ?? new Date().toISOString()
        };
        book[side] = outcome.price;
        book.updatedAt = market.last_update ?? bookmaker.last_update ?? book.updatedAt;
        group.books.set(bookKey, book);
        groups.set(groupKey, group);
      }
    }
  }

  const byPlayerMarket = new Map<string, QuoteGroup[]>();
  for (const group of groups.values()) {
    const key = `${normalizePlayerName(group.playerName)}|${group.market}`;
    byPlayerMarket.set(key, [...(byPlayerMarket.get(key) ?? []), group]);
  }

  const result = new Map<string, PlayerPropQuote>();
  for (const lineGroups of byPlayerMarket.values()) {
    const selected = lineGroups.toSorted((a, b) => {
      const completeA = [...a.books.values()].filter((book) => book.over && book.under).length;
      const completeB = [...b.books.values()].filter((book) => book.over && book.under).length;
      return completeB - completeA || b.books.size - a.books.size;
    })[0];
    const completeBooks = [...selected.books.values()].filter(
      (book): book is BookLine & { over: number; under: number } => book.over !== null && book.under !== null
    );
    if (!completeBooks.length) continue;
    const fairOverProbability = completeBooks.reduce((sum, book) => {
      const over = 1 / book.over;
      const under = 1 / book.under;
      return sum + over / (over + under);
    }, 0) / completeBooks.length;
    const bestOver = completeBooks.toSorted((a, b) => b.over - a.over)[0];
    const bestUnder = completeBooks.toSorted((a, b) => b.under - a.under)[0];
    const updatedAt = completeBooks.map((book) => book.updatedAt).toSorted().at(-1) ?? new Date().toISOString();
    const quote: PlayerPropQuote = {
      gameId,
      playerName: selected.playerName,
      market: selected.market,
      line: selected.line,
      fairOverProbability: Number(fairOverProbability.toFixed(4)),
      overAmericanOdds: decimalToAmerican(bestOver.over),
      underAmericanOdds: decimalToAmerican(bestUnder.under),
      overBook: bestOver.title,
      underBook: bestUnder.title,
      books: completeBooks.length,
      updatedAt
    };
    result.set(playerPropKey(gameId, selected.playerName, selected.market), quote);
  }
  return result;
}

import type { Sport } from "@/lib/sports";
// Relative `.ts` imports on purpose: this module is pure and runs under `node --test`, which has no `@/` alias.
import { normalizePlayerName } from "./playerPropOdds.ts";
import { americanToImplied, parseAmerican } from "./marketMath.ts";

/**
 * Pure parsers for real sportsbook player-prop lines. Two free feeds:
 *
 * - ESPN core API `.../odds/100/propBets` — DraftKings props for every game,
 *   both sports. Each item carries the line (`current.target.value`) and, for
 *   MLB, a price; MLB items arrive as [over, under] pairs on the same line.
 *   NFL items carry lines only.
 * - DraftKings' public sportsbook feed `events/{id}/categories/{id}` — NFL
 *   over/under markets with both prices, plus the Anytime Touchdown Scorer
 *   market. Used for NFL prices when reachable; lines still come from ESPN.
 */

export type SportsbookLine = {
  market: string;
  line: number;
  openLine: number | null;
  overOdds: number | null;
  underOdds: number | null;
  updatedAt: string | null;
};

/** ESPN propBets `type.id` -> app market name. */
export const ESPN_PROP_TYPES: Record<Sport, Record<string, string>> = {
  nfl: {
    "8": "Passing yards",
    "9": "Completions",
    "10": "Passing touchdowns",
    "11": "Rush attempts",
    "12": "Rushing yards",
    "13": "Receiving yards",
    "14": "Receptions",
    "16": "Pass attempts",
    "20": "Rush+Rec yards",
    "31": "Rush+Rec TDs"
  },
  mlb: {
    "46": "Strikeouts",
    "52": "Total bases",
    "53": "Hits",
    "54": "Hits allowed",
    "55": "Earned runs allowed",
    "56": "Hits+Runs+RBIs",
    "57": "Pitching outs",
    "58": "Runs",
    "59": "RBIs",
    "60": "Stolen bases",
    "61": "Walks allowed",
    "240": "Home runs"
  }
};

/** Markets sold as yes/no "milestone" squares: the line is 0.5 and the quoted price is the over. */
const YES_NO_MARKETS = new Set(["Rush+Rec TDs", "Home runs"]);

export type EspnPropBetItem = {
  athlete?: { $ref?: string };
  type?: { id?: string; name?: string };
  lastUpdated?: string;
  current?: { target?: { value?: number } };
  open?: { target?: { value?: number } };
  odds?: { american?: { value?: string; open?: string } };
};

export function athleteIdFromRef(ref: string | undefined): string | null {
  return ref?.match(/athletes\/(\d+)/)?.[1] ?? null;
}

/**
 * Groups ESPN propBets by athlete id and market. MLB items come as consecutive
 * [over, under] pairs at the same line, so the first price of a pair is the
 * over and the second the under; a lone item is treated as the over price.
 */
export function parseEspnPropBets(sport: Sport, items: EspnPropBetItem[]): Map<string, Map<string, SportsbookLine>> {
  const board = new Map<string, Map<string, SportsbookLine>>();
  const markets = ESPN_PROP_TYPES[sport];
  for (const item of items) {
    const market = item.type?.id ? markets[item.type.id] : undefined;
    const athleteId = athleteIdFromRef(item.athlete?.$ref);
    if (!market || !athleteId) continue;
    const yesNo = YES_NO_MARKETS.has(market);
    const rawLine = item.current?.target?.value;
    const line = yesNo ? 0.5 : typeof rawLine === "number" && Number.isFinite(rawLine) ? rawLine : null;
    if (line === null) continue;
    const openRaw = item.open?.target?.value;
    const openLine = yesNo ? 0.5 : typeof openRaw === "number" && Number.isFinite(openRaw) ? openRaw : null;
    const price = parseAmerican(item.odds?.american?.value);
    const perAthlete = board.get(athleteId) ?? new Map<string, SportsbookLine>();
    const existing = perAthlete.get(market);
    if (existing && existing.line === line) {
      if (existing.overOdds !== null && existing.underOdds === null && price !== null && !yesNo) existing.underOdds = price;
      continue;
    }
    perAthlete.set(market, {
      market,
      line,
      openLine,
      overOdds: price,
      underOdds: null,
      updatedAt: item.lastUpdated ?? null
    });
    board.set(athleteId, perAthlete);
  }
  return board;
}

export type DkMarket = { id?: string; name?: string; marketType?: { name?: string } };
export type DkSelection = { marketId?: string; label?: string; points?: number; outcomeType?: string; displayOdds?: { american?: string }; participants?: Array<{ name?: string }> };

/** DraftKings NFL market-type name -> app market. */
const DK_NFL_MARKET_TYPES: Record<string, string> = {
  "Passing Yards O/U": "Passing yards",
  "Passing Touchdowns O/U": "Passing touchdowns",
  "Pass Completions O/U": "Completions",
  "Passing Completions O/U": "Completions",
  "Pass Attempts O/U": "Pass attempts",
  "Passing Attempts O/U": "Pass attempts",
  "Rushing Yards O/U": "Rushing yards",
  "Rushing Attempts O/U": "Rush attempts",
  "Rushing + Receiving Yards O/U": "Rush+Rec yards",
  "Receiving Yards O/U": "Receiving yards",
  "Receptions O/U": "Receptions"
};

/**
 * Reads DraftKings over/under player markets (plus Anytime Touchdown Scorer)
 * into a board keyed by normalized player name.
 */
export function parseDkPropMarkets(markets: DkMarket[], selections: DkSelection[]): Map<string, Map<string, SportsbookLine>> {
  const board = new Map<string, Map<string, SportsbookLine>>();
  const byMarket = new Map<string, DkSelection[]>();
  for (const selection of selections) {
    if (!selection.marketId) continue;
    byMarket.set(selection.marketId, [...(byMarket.get(selection.marketId) ?? []), selection]);
  }
  const put = (playerName: string, entry: SportsbookLine) => {
    const key = normalizePlayerName(playerName);
    if (!key) return;
    const perPlayer = board.get(key) ?? new Map<string, SportsbookLine>();
    if (!perPlayer.has(entry.market)) perPlayer.set(entry.market, entry);
    board.set(key, perPlayer);
  };
  for (const market of markets) {
    if (!market.id) continue;
    const typeName = market.marketType?.name ?? "";
    const rows = byMarket.get(market.id) ?? [];
    if (typeName === "Anytime Touchdown Scorer") {
      for (const row of rows) {
        const playerName = row.participants?.[0]?.name ?? row.label;
        const price = parseAmerican(row.displayOdds?.american);
        if (!playerName || price === null) continue;
        put(playerName, { market: "Rush+Rec TDs", line: 0.5, openLine: null, overOdds: price, underOdds: null, updatedAt: null });
      }
      continue;
    }
    const appMarket = DK_NFL_MARKET_TYPES[typeName];
    if (!appMarket) continue;
    const over = rows.find((row) => /^over$/i.test(row.outcomeType ?? row.label ?? ""));
    const under = rows.find((row) => /^under$/i.test(row.outcomeType ?? row.label ?? ""));
    const playerName = over?.participants?.[0]?.name ?? under?.participants?.[0]?.name ?? market.name?.replace(/\s+[A-Z].*$/, "");
    const line = over?.points ?? under?.points;
    if (!playerName || typeof line !== "number" || !Number.isFinite(line)) continue;
    put(playerName, {
      market: appMarket,
      line,
      openLine: null,
      overOdds: parseAmerican(over?.displayOdds?.american),
      underOdds: parseAmerican(under?.displayOdds?.american),
      updatedAt: null
    });
  }
  return board;
}

/** No-vig probability of the over when both prices are known; the raw implied over probability otherwise. */
export function fairOverProbability(line: Pick<SportsbookLine, "overOdds" | "underOdds">): number | null {
  if (line.overOdds === null) return null;
  const over = americanToImplied(line.overOdds);
  if (line.underOdds === null) return Number(over.toFixed(4));
  const under = americanToImplied(line.underOdds);
  return over + under > 0 ? Number((over / (over + under)).toFixed(4)) : null;
}

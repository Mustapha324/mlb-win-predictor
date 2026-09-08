/**
 * Pure moneyline / market math shared by the serving layer, the odds
 * adapters, and the live-capture script. No fetches, no server-only import,
 * so every function here is unit-testable.
 */

export type MoneylineQuote = {
  homeWinProbability: number;
  awayWinProbability: number;
  homeAmericanOdds: number;
  awayAmericanOdds: number;
  favorite: string;
  source: string;
  books: number;
  updatedAt: string;
  /** Opening prices when the book exposes them (ESPN/DraftKings do). */
  openHomeAmericanOdds?: number | null;
  openAwayAmericanOdds?: number | null;
  /** DraftKings event id parsed from the ESPN bet link; unlocks player-prop prices. */
  dkEventId?: string | null;
  /** ESPN event id the quote was read from (MLB game ids are StatsAPI ids, so this is the bridge). */
  espnEventId?: string | null;
};

/**
 * Model weight in the served logit blend, per sport. Fit by
 * `npm run backtest -- nfl --ensemble` (docs/backtests/ensemble.md): the
 * closing market beat every model variant on both log-loss and accuracy, and
 * the leave-one-season-out fitter kept only a small model share. MLB has no
 * free historical odds archive yet, so it inherits the NFL weight and is
 * measured forward by the live-capture ledger (market column).
 */
export const MARKET_ANCHOR_MODEL_WEIGHT: Record<"mlb" | "nfl", number> = { mlb: 0.25, nfl: 0.25 };

export function americanToImplied(odds: number): number {
  if (!Number.isFinite(odds) || odds === 0) return 0.5;
  return odds < 0 ? -odds / (-odds + 100) : 100 / (odds + 100);
}

export function americanToPayout(odds: number): number {
  return odds > 0 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds);
}

export function probabilityToAmerican(probability: number): number {
  const clamped = Math.max(0.01, Math.min(0.99, probability));
  return clamped >= 0.5 ? Math.round(-100 * clamped / (1 - clamped)) : Math.round(100 * (1 - clamped) / clamped);
}

/** Removes the vig from a two-way price pair. */
export function noVigPair(homeOdds: number, awayOdds: number): { home: number; away: number } {
  const rawHome = americanToImplied(homeOdds);
  const rawAway = americanToImplied(awayOdds);
  const overround = rawHome + rawAway;
  if (overround <= 0) return { home: 0.5, away: 0.5 };
  return { home: rawHome / overround, away: rawAway / overround };
}

/** Parses "-170", "+142", "−112" (unicode minus), "EVEN"; null when unreadable. */
export function parseAmerican(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value !== 0 ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/−/g, "-");
  if (/^(even|ev|pk)$/i.test(trimmed)) return 100;
  const parsed = Number(trimmed.replace(/[^\d.+-]/g, ""));
  return Number.isFinite(parsed) && parsed !== 0 ? parsed : null;
}

export function logit(probability: number): number {
  const clamped = Math.max(0.02, Math.min(0.98, probability));
  return Math.log(clamped / (1 - clamped));
}

export function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

/**
 * Logit-space blend of the model probability toward the market probability.
 * `modelWeight` is the share kept by the model (0 = pure market).
 */
export function anchorToMarket(modelProbability: number, marketProbability: number, modelWeight: number): number {
  const weight = Math.max(0, Math.min(1, modelWeight));
  return Number(sigmoid(weight * logit(modelProbability) + (1 - weight) * logit(marketProbability)).toFixed(4));
}

type EspnOddsSide = { close?: { odds?: string | number; link?: { href?: string } }; open?: { odds?: string | number } };
export type EspnOddsLike = {
  provider?: { name?: string; id?: string };
  details?: string;
  moneyline?: { home?: EspnOddsSide; away?: EspnOddsSide };
  homeTeamOdds?: { moneyLine?: number };
  awayTeamOdds?: { moneyLine?: number };
};

function dkEventIdFrom(link: string | undefined): string | null {
  if (!link) return null;
  try {
    return decodeURIComponent(link).match(/\/event\/(\d+)/)?.[1] ?? null;
  } catch {
    return link.match(/event(?:%2F|\/)(\d+)/)?.[1] ?? null;
  }
}

/** Turns an ESPN scoreboard `competitions[].odds[]` entry into a no-vig moneyline quote. */
export function parseEspnMoneyline(odds: EspnOddsLike | undefined, homeTeam: string, awayTeam: string, updatedAt: string, espnEventId: string | null = null): MoneylineQuote | null {
  if (!odds) return null;
  const homeOdds = parseAmerican(odds.moneyline?.home?.close?.odds) ?? parseAmerican(odds.homeTeamOdds?.moneyLine);
  const awayOdds = parseAmerican(odds.moneyline?.away?.close?.odds) ?? parseAmerican(odds.awayTeamOdds?.moneyLine);
  if (homeOdds === null || awayOdds === null) return null;
  const fair = noVigPair(homeOdds, awayOdds);
  const provider = odds.provider?.name ?? "Sportsbook";
  return {
    homeWinProbability: Number(fair.home.toFixed(4)),
    awayWinProbability: Number(fair.away.toFixed(4)),
    homeAmericanOdds: homeOdds,
    awayAmericanOdds: awayOdds,
    favorite: fair.home >= fair.away ? homeTeam : awayTeam,
    source: `${provider} via ESPN`,
    books: 1,
    updatedAt,
    openHomeAmericanOdds: parseAmerican(odds.moneyline?.home?.open?.odds),
    openAwayAmericanOdds: parseAmerican(odds.moneyline?.away?.open?.odds),
    dkEventId: dkEventIdFrom(odds.moneyline?.home?.close?.link?.href) ?? dkEventIdFrom(odds.moneyline?.away?.close?.link?.href),
    espnEventId
  };
}

export function normalizeTeamName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Pure scoring math for the Game Brain. No fetches, no server-only import —
 * everything here is unit-testable. Weights are deliberately conservative and
 * bounded: the brain runs in shadow mode until logged results justify size.
 */

export type InjuryStatusBucket = "out" | "doubtful" | "questionable" | "day_to_day" | "il_long" | "il_short";

export type InjuryEntry = {
  playerName: string;
  position: string | null;
  status: InjuryStatusBucket;
  detail: string | null;
};

export type TeamInjuryReport = {
  entries: InjuryEntry[];
  /** 0 (healthy) to 1 (decimated), impact-weighted. */
  burden: number;
  qbOut: boolean;
};

export type WeatherSnapshot = {
  tempF: number;
  windMph: number;
  gustMph: number;
  precipProbability: number;
  snowfall: boolean;
};

export type TeamForm = {
  lastTenWins: number;
  lastTenGames: number;
  streak: number;
  restDays: number | null;
};

export type BrainFactor = { label: string; detail: string; homeLogit: number };

/** Max total logit swing ≈ ±8 percentage points of win probability. */
export const MAX_BRAIN_LOGIT = 0.35;

/** Availability multiplier per injury designation. */
const STATUS_WEIGHTS: Record<InjuryStatusBucket, number> = {
  out: 1,
  il_long: 1,
  il_short: 0.9,
  doubtful: 0.75,
  questionable: 0.35,
  day_to_day: 0.25
};

/** NFL positional importance; QB dominates, matching how books move lines. */
const NFL_POSITION_WEIGHTS: Array<[RegExp, number]> = [
  [/^QB$/i, 1],
  [/^(RB|FB)$/i, 0.3],
  [/^(WR|TE)$/i, 0.3],
  [/^(LT|RT|LG|RG|C|OT|OG|OL)$/i, 0.28],
  [/^(DE|DT|EDGE|DL|NT)$/i, 0.26],
  [/^(LB|ILB|OLB|MLB)$/i, 0.22],
  [/^(CB|S|FS|SS|DB)$/i, 0.24],
  [/^(K|P|LS)$/i, 0.08]
];

export function nflPositionWeight(position: string | null): number {
  for (const [pattern, weight] of NFL_POSITION_WEIGHTS) {
    if (position && pattern.test(position)) return weight;
  }
  return 0.15;
}

export function statusWeight(status: InjuryStatusBucket): number {
  return STATUS_WEIGHTS[status];
}

/**
 * Impact-weighted burden: sum of (positional weight x availability), squashed
 * so one superstar or a pile of role players both register without saturating.
 */
export function injuryBurden(entries: Array<{ position: string | null; status: InjuryStatusBucket }>, sport: "mlb" | "nfl"): number {
  let load = 0;
  for (const entry of entries) {
    // MLB weights are small: in-season IL lists run 8-13 players league-wide,
    // and larger weights saturate the curve, erasing team-to-team gaps.
    const positional = sport === "nfl" ? nflPositionWeight(entry.position) : entry.position === "P" ? 0.1 : 0.14;
    load += positional * statusWeight(entry.status);
  }
  return Number((1 - Math.exp(-load)).toFixed(4));
}

export function isQbOut(entries: InjuryEntry[]): boolean {
  return entries.some((entry) => /^QB$/i.test(entry.position ?? "") && (entry.status === "out" || entry.status === "il_long" || entry.status === "doubtful"));
}

/** Maps raw status strings from MLB StatsAPI / ESPN into buckets. */
export function bucketInjuryStatus(raw: string): InjuryStatusBucket | null {
  const value = raw.toLowerCase();
  if (/60-day|injured reserve|^ir\b|out for season/.test(value)) return "il_long";
  if (/15-day|10-day|7-day/.test(value)) return "il_short";
  if (/^out$/.test(value)) return "out";
  if (/doubtful/.test(value)) return "doubtful";
  if (/questionable/.test(value)) return "questionable";
  if (/day.to.day|dtd|probable/.test(value)) return "day_to_day";
  return null;
}

/** Severity 0–1 for outdoor weather; only extremes matter for win probability. */
export function weatherSeverity(weather: WeatherSnapshot): number {
  let severity = 0;
  if (weather.windMph >= 20 || weather.gustMph >= 30) severity += 0.4;
  else if (weather.windMph >= 15) severity += 0.2;
  if (weather.tempF <= 25) severity += 0.35;
  else if (weather.tempF <= 32) severity += 0.15;
  if (weather.snowfall) severity += 0.35;
  else if (weather.precipProbability >= 0.7) severity += 0.2;
  return Math.min(1, Number(severity.toFixed(2)));
}

export function formEdge(home: TeamForm, away: TeamForm): number {
  const homeRate = home.lastTenGames ? home.lastTenWins / home.lastTenGames : 0.5;
  const awayRate = away.lastTenGames ? away.lastTenWins / away.lastTenGames : 0.5;
  let edge = (homeRate - awayRate) * 0.12;
  if (home.restDays !== null && away.restDays !== null) {
    const restGap = Math.max(-3, Math.min(3, home.restDays - away.restDays));
    edge += restGap * 0.015;
  }
  return edge;
}

/**
 * Combines factor terms into a clamped logit delta plus readable factors.
 * Positive logit favors the home team.
 */
export function combineFactors(factors: BrainFactor[]): { logitDelta: number; factors: BrainFactor[] } {
  const meaningful = factors.filter((factor) => Math.abs(factor.homeLogit) >= 0.005);
  const total = meaningful.reduce((sum, factor) => sum + factor.homeLogit, 0);
  return {
    logitDelta: Number(Math.max(-MAX_BRAIN_LOGIT, Math.min(MAX_BRAIN_LOGIT, total)).toFixed(4)),
    factors: meaningful.toSorted((a, b) => Math.abs(b.homeLogit) - Math.abs(a.homeLogit))
  };
}

export function applyLogitDelta(probability: number, logitDelta: number): number {
  const clamped = Math.max(0.02, Math.min(0.98, probability));
  const logit = Math.log(clamped / (1 - clamped)) + logitDelta;
  return Number((1 / (1 + Math.exp(-logit))).toFixed(4));
}

/** League percentile (0–100) of a value among peers; higher is better unless inverted. */
export function percentileRank(value: number, peers: number[], higherIsBetter = true): number {
  if (peers.length === 0) return 50;
  const below = peers.filter((peer) => (higherIsBetter ? peer < value : peer > value)).length;
  const equal = peers.filter((peer) => peer === value).length;
  return Math.round(((below + equal / 2) / peers.length) * 100);
}

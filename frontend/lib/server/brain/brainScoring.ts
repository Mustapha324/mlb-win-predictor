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

/**
 * Tunable factor coefficients, per sport. Values are fit by the walk-forward
 * backtest harness (`frontend/scripts/brain-backtest.mjs`); the runs behind
 * them live in docs/backtests/ (charts + experiments.md ledger). Hand-edit
 * only with a rerun to back it up.
 *
 * Provenance (2026-08-24 v3 runs — MOV-Elo baseline with NFL home advantage
 * re-swept to 28 Elo on validation, matching the league-wide home-edge
 * decline; 2021 burn-in; greedy factor selection on a dedicated validation
 * season; untouched final holdout):
 *
 * NFL (train 2022–23, validation 2024, holdout 2025): selection keeps
 * pythag (~0.69), divisionDamp (~0.27), and qbValue — a rolling
 * projected-starter QB composite from real box scores (week 1 excluded:
 * offseason starter carryover is unreliable). qbValue was the top validation
 * gain (Δ logloss +0.0038) and helps in 3 of 4 frozen seasons; the seasons
 * disagree on size (2022/23 favor 0.1, 2025 favors 0), so it ships shrunk to
 * 0.05, where holdout log-loss beats baseline again. lateSeasonDamp 0.15 was
 * added from the confident-loss autopsy (worst-ever miss: Bills 93.6% in a
 * week-18 seed-locked rest spot) — shrinks favorites in weeks 17-18, improving
 * holdout log-loss with flat accuracy. qbOut raised 0.25 -> 0.35 after the
 * Chiefs@Titans autopsy (QB out + eliminated, books move 4-6 points).
 * REJECTED: toMargin (season turnover margin does not predict game-day
 * turnover swings - 38% of confident losses, all luck), travel, shortWeek,
 * scoringForm, homeSplit, bye. injuryGap stays a research prior.
 *
 * MLB (train 2022–24, validation 2025, holdout 2026-to-date): every record
 * candidate was REJECTED — including real per-start FIP from game logs
 * (Δ −0.0007) and transaction-wire roster churn — a margin-aware baseline
 * already carries that information. MLB ships display-grade weights;
 * weatherHome (~0.06) is the one consistent survivor.
 */
export type SportWeightSet = {
  /** Logit per unit of injury-burden gap (away − home). */
  injuryGap: number;
  /** Flat logit against a side likely missing its starting QB. */
  qbOut: number;
  /** Logit per unit of last-10 win-rate gap. */
  formWinRate: number;
  /** Logit per rest-day advantage (clamped ±3 days). */
  restDay: number;
  /** Home-familiarity logit per unit of weather severity. */
  weatherHome: number;
  /** Logit per run/point of recent per-game scoring-margin gap (home − away, last 15/5). */
  scoringForm: number;
  /** Logit per unit of home-record vs road-record win-rate gap. */
  homeSplit: number;
  /** Logit per unit of season-to-date Pythagorean-expectation gap. */
  pythag: number;
  /** MLB: logit per extra game the away side played in the last 6 days (fatigue). */
  density: number;
  /** MLB: logit per run of starting-pitcher recent runs-allowed gap (away starter − home starter). */
  pitcherForm: number;
  /** NFL: shrink applied against the favorite in division games (familiarity closes gaps). */
  divisionDamp: number;
  /** NFL: flat logit for a side coming off a bye (10+ rest days) when the other is not. */
  bye: number;
  /** Logit per unit of roster-disruption gap (away churn − home churn, transactions last 14 days). */
  rosterChurn: number;
  /** MLB: logit per unit of starting-pitcher FIP-lite gap (away − home, from real per-start K/BB/HR logs). */
  starterFip: number;
  /** NFL: logit per unit of projected-starter QB value gap (home − away, rolling per-start composite). */
  qbValue: number;
  /** NFL: logit per 1,000 km the road team travels. */
  travel: number;
  /** NFL: flat logit against a side on a short week (≤4 rest days) when the other is not. */
  shortWeek: number;
  /** NFL: logit per unit of season-to-date turnover-margin-per-game gap (home − away). */
  toMargin: number;
  /** NFL: shrink applied against the favorite in weeks 17-18 (seed-locked rest and motivation risk). */
  lateSeasonDamp: number;
  /** NFL: logit per 100 yards of unit-matchup edge (our offenses vs their defenses, rolling). */
  unitMatchup: number;
  /** NFL: logit per 100 yards of rolling total-yardage margin gap (yards predict better than points). */
  yardsMargin: number;
  /** MLB: logit per unit of platoon edge (team record vs today's opposing starter hand, relative to overall). */
  platoon: number;
};

export type BrainWeights = Record<"mlb" | "nfl", SportWeightSet>;

export const DEFAULT_BRAIN_WEIGHTS: BrainWeights = {
  mlb: {
    injuryGap: 0.05, qbOut: 0, formWinRate: 0.02, restDay: 0.005, weatherHome: 0.06,
    scoringForm: 0, homeSplit: 0, pythag: 0, density: 0, pitcherForm: 0, divisionDamp: 0, bye: 0, rosterChurn: 0, starterFip: 0, qbValue: 0, travel: 0, shortWeek: 0, toMargin: 0, lateSeasonDamp: 0, unitMatchup: 0, yardsMargin: 0, platoon: 0
  },
  nfl: {
    injuryGap: 0.4, qbOut: 0.35, formWinRate: 0.085, restDay: 0.045, weatherHome: 0.055,
    scoringForm: 0, homeSplit: 0, pythag: 0.69, density: 0, pitcherForm: 0, divisionDamp: 0.27, bye: 0, rosterChurn: 0, starterFip: 0, qbValue: 0.05, travel: 0, shortWeek: 0, toMargin: 0, lateSeasonDamp: 0.15, unitMatchup: 0, yardsMargin: 0, platoon: 0
  }
};

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

export function formEdge(home: TeamForm, away: TeamForm, weights: SportWeightSet = DEFAULT_BRAIN_WEIGHTS.mlb): number {
  const homeRate = home.lastTenGames ? home.lastTenWins / home.lastTenGames : 0.5;
  const awayRate = away.lastTenGames ? away.lastTenWins / away.lastTenGames : 0.5;
  let edge = (homeRate - awayRate) * weights.formWinRate;
  if (home.restDays !== null && away.restDays !== null) {
    const restGap = Math.max(-3, Math.min(3, home.restDays - away.restDays));
    edge += restGap * weights.restDay;
  }
  return edge;
}

export type FactorInputs = {
  sport: "mlb" | "nfl";
  /** away burden − home burden; positive favors home. */
  burdenGap: number;
  homeQbOut: boolean;
  awayQbOut: boolean;
  homeForm: TeamForm;
  awayForm: TeamForm;
  /** 0 when sheltered or unknown. */
  weatherSeverity: number;
  /** Recent per-game scoring-margin gap, home − away (runs or points). */
  scoringFormGap?: number;
  /** Home team's home win rate − away team's road win rate (season to date, 0 until sampled). */
  homeSplitGap?: number;
  /** Season-to-date Pythagorean expectation gap, home − away. */
  pythagGap?: number;
  /** Games the away side played in the last 6 days minus the home side's (MLB fatigue). */
  densityGap?: number;
  /** Away starter's recent runs-allowed per start minus home starter's (MLB; positive favors home). */
  pitcherFormGap?: number;
  /** Division rivalry game (NFL). */
  divisionGame?: boolean;
  /** Baseline home logit, required for divisionDamp to know who the favorite is. */
  baselineLogit?: number;
  /** Off a bye this week (NFL). */
  homeOffBye?: boolean;
  awayOffBye?: boolean;
  /** Roster-disruption gap: away transactions − home transactions over the last 14 days. */
  rosterChurnGap?: number;
  /** Starting-pitcher FIP-lite gap, away − home (positive favors home). */
  starterFipGap?: number;
  /** Projected-starter QB value gap, home − away. */
  qbValueGap?: number;
  /** Road-team travel distance in thousands of km. */
  travelMm?: number;
  /** Short week (≤4 rest days) flags. */
  homeShortWeek?: boolean;
  awayShortWeek?: boolean;
  /** Season-to-date turnover-margin-per-game gap, home − away. */
  toMarginGap?: number;
  /** Regular-season week 17-18 (rest/motivation risk for locked teams). */
  lateSeason?: boolean;
  /** Unit-matchup edge in hundreds of yards, home − away (offenses vs opposing defenses). */
  unitMatchupGap?: number;
  /** Rolling total-yardage margin gap in hundreds of yards, home − away. */
  yardsMarginGap?: number;
  /** Platoon edge vs today's opposing starter hand, home − away. */
  platoonGap?: number;
};

export type FactorTerm = {
  kind: "injury" | "qb" | "form" | "weather" | "scoring-form" | "home-split" | "pythag" | "density" | "pitcher-form" | "division" | "bye" | "roster-churn" | "starter-fip" | "qb-value" | "travel" | "short-week" | "to-margin" | "late-season" | "unit-matchup" | "yards-margin" | "platoon";
  homeLogit: number;
};

/**
 * The brain's factor math, shared verbatim by production assembly and the
 * backtest harness so tuned weights mean the same thing in both. A factor
 * contributes only when its input is present and its weight is non-zero.
 */
export function factorTerms(inputs: FactorInputs, weights: BrainWeights = DEFAULT_BRAIN_WEIGHTS): FactorTerm[] {
  const sportWeights = weights[inputs.sport];
  const terms: FactorTerm[] = [];
  if (Math.abs(inputs.burdenGap) >= 0.02) terms.push({ kind: "injury", homeLogit: inputs.burdenGap * sportWeights.injuryGap });
  if (inputs.sport === "nfl" && inputs.homeQbOut !== inputs.awayQbOut) {
    terms.push({ kind: "qb", homeLogit: inputs.homeQbOut ? -sportWeights.qbOut : sportWeights.qbOut });
  }
  const form = formEdge(inputs.homeForm, inputs.awayForm, sportWeights);
  if (Math.abs(form) >= 0.01) terms.push({ kind: "form", homeLogit: form });
  if (inputs.weatherSeverity >= 0.2) terms.push({ kind: "weather", homeLogit: inputs.weatherSeverity * sportWeights.weatherHome });
  if (inputs.scoringFormGap !== undefined && sportWeights.scoringForm > 0) {
    terms.push({ kind: "scoring-form", homeLogit: inputs.scoringFormGap * sportWeights.scoringForm });
  }
  if (inputs.homeSplitGap !== undefined && sportWeights.homeSplit > 0) {
    terms.push({ kind: "home-split", homeLogit: inputs.homeSplitGap * sportWeights.homeSplit });
  }
  if (inputs.pythagGap !== undefined && sportWeights.pythag > 0) {
    terms.push({ kind: "pythag", homeLogit: inputs.pythagGap * sportWeights.pythag });
  }
  if (inputs.densityGap !== undefined && sportWeights.density > 0) {
    terms.push({ kind: "density", homeLogit: inputs.densityGap * sportWeights.density });
  }
  if (inputs.pitcherFormGap !== undefined && sportWeights.pitcherForm > 0) {
    terms.push({ kind: "pitcher-form", homeLogit: inputs.pitcherFormGap * sportWeights.pitcherForm });
  }
  if (inputs.divisionGame && inputs.baselineLogit !== undefined && sportWeights.divisionDamp > 0) {
    terms.push({ kind: "division", homeLogit: -Math.tanh(inputs.baselineLogit) * sportWeights.divisionDamp });
  }
  if ((inputs.homeOffBye ?? false) !== (inputs.awayOffBye ?? false) && sportWeights.bye > 0) {
    terms.push({ kind: "bye", homeLogit: inputs.homeOffBye ? sportWeights.bye : -sportWeights.bye });
  }
  if (inputs.rosterChurnGap !== undefined && sportWeights.rosterChurn > 0) {
    terms.push({ kind: "roster-churn", homeLogit: inputs.rosterChurnGap * sportWeights.rosterChurn });
  }
  if (inputs.starterFipGap !== undefined && sportWeights.starterFip > 0) {
    terms.push({ kind: "starter-fip", homeLogit: Math.max(-3, Math.min(3, inputs.starterFipGap)) * sportWeights.starterFip });
  }
  if (inputs.qbValueGap !== undefined && sportWeights.qbValue > 0) {
    terms.push({ kind: "qb-value", homeLogit: Math.max(-4, Math.min(4, inputs.qbValueGap)) * sportWeights.qbValue });
  }
  if (inputs.travelMm !== undefined && sportWeights.travel > 0) {
    terms.push({ kind: "travel", homeLogit: Math.min(4.5, inputs.travelMm) * sportWeights.travel });
  }
  if ((inputs.homeShortWeek ?? false) !== (inputs.awayShortWeek ?? false) && sportWeights.shortWeek > 0) {
    terms.push({ kind: "short-week", homeLogit: inputs.homeShortWeek ? -sportWeights.shortWeek : sportWeights.shortWeek });
  }
  if (inputs.toMarginGap !== undefined && sportWeights.toMargin > 0) {
    terms.push({ kind: "to-margin", homeLogit: Math.max(-1.5, Math.min(1.5, inputs.toMarginGap)) * sportWeights.toMargin });
  }
  if (inputs.lateSeason && inputs.baselineLogit !== undefined && sportWeights.lateSeasonDamp > 0) {
    terms.push({ kind: "late-season", homeLogit: -Math.tanh(inputs.baselineLogit) * sportWeights.lateSeasonDamp });
  }
  if (inputs.unitMatchupGap !== undefined && sportWeights.unitMatchup > 0) {
    terms.push({ kind: "unit-matchup", homeLogit: Math.max(-2, Math.min(2, inputs.unitMatchupGap)) * sportWeights.unitMatchup });
  }
  if (inputs.yardsMarginGap !== undefined && sportWeights.yardsMargin > 0) {
    terms.push({ kind: "yards-margin", homeLogit: Math.max(-2, Math.min(2, inputs.yardsMarginGap)) * sportWeights.yardsMargin });
  }
  if (inputs.platoonGap !== undefined && sportWeights.platoon > 0) {
    terms.push({ kind: "platoon", homeLogit: Math.max(-0.3, Math.min(0.3, inputs.platoonGap)) * sportWeights.platoon });
  }
  return terms;
}

export type CompletedTeamResult = { date: string; won: boolean };

/** Last-10 record, streak, and rest days from results strictly before `gameDate`. */
export function computeTeamForm(results: CompletedTeamResult[], gameDate: string): TeamForm {
  const prior = results.filter((game) => game.date < gameDate).toSorted((a, b) => a.date.localeCompare(b.date));
  if (prior.length === 0) return { lastTenWins: 0, lastTenGames: 0, streak: 0, restDays: null };
  const lastTen = prior.slice(-10);
  let streak = 0;
  for (let index = prior.length - 1; index >= 0; index -= 1) {
    const won = prior[index].won;
    if (index === prior.length - 1) streak = won ? 1 : -1;
    else if (won === streak > 0) streak += won ? 1 : -1;
    else break;
  }
  const lastDate = new Date(`${prior.at(-1)!.date}T12:00:00Z`);
  const slateDate = new Date(`${gameDate}T12:00:00Z`);
  const restDays = Math.max(0, Math.round((slateDate.getTime() - lastDate.getTime()) / 86400000) - 1);
  return {
    lastTenWins: lastTen.filter((game) => game.won).length,
    lastTenGames: lastTen.length,
    streak,
    restDays
  };
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

/**
 * Serving-layer probability calibration, fit by the backtest harness on train
 * seasons (2026-08-24): both sim engines run overconfident, so final
 * probabilities are shrunk toward 50% by dividing the logit by a per-sport
 * temperature. Picks are unaffected (monotone); log-loss improves materially
 * (NFL holdout 0.6564 -> 0.6401; MLB 0.6887 -> 0.6865). K-factor sweeps were
 * ambiguous on validation (logloss vs accuracy split), so incumbent k stays.
 * Applied at output time only - factor tuning stays on raw probabilities.
 */
export const MODEL_TEMPERATURE: Record<"mlb" | "nfl", number> = { mlb: 1.3, nfl: 1.45 };

export function applyTemperature(probability: number, sport: "mlb" | "nfl"): number {
  const clamped = Math.max(0.02, Math.min(0.98, probability));
  const logit = Math.log(clamped / (1 - clamped)) / MODEL_TEMPERATURE[sport];
  return Number((1 / (1 + Math.exp(-logit))).toFixed(4));
}

export function applyLogitDelta(probability: number, logitDelta: number): number {
  const clamped = Math.max(0.02, Math.min(0.98, probability));
  const logit = Math.log(clamped / (1 - clamped)) + logitDelta;
  return Number((1 / (1 + Math.exp(-logit))).toFixed(4));
}

export type NewsTag = "injury" | "trade" | "activation" | "call-up" | "suspension" | "pitching" | "milestone";

/** Classifies a headline/description into brain-relevant tags. Pure and testable. */
export function tagNewsText(text: string): NewsTag[] {
  const value = text.toLowerCase();
  const tags: NewsTag[] = [];
  if (/injur|hurt|il\b|injured list|out for|out indefinitely|surgery|strain|sprain|fracture|concussion|sore|questionable|doubtful/.test(value)) tags.push("injury");
  if (/trade|acquir|deal[t ]|swap|waiver claim|claimed/.test(value)) tags.push("trade");
  if (/activat|reinstat|return[s]? (from|to)|back (in|from)/.test(value)) tags.push("activation");
  if (/call[- ]?up|promot|recalled|selected the contract/.test(value)) tags.push("call-up");
  if (/suspend|banned|ineligible/.test(value)) tags.push("suspension");
  if (/starter|rotation|bullpen|pitch(er|ing)|mound|scratch/.test(value)) tags.push("pitching");
  if (/record|milestone|streak|no-hitter|perfect game|mvp|cy young/.test(value)) tags.push("milestone");
  return tags;
}

/** Pythagorean win expectation from runs/points scored and allowed (MLB exponent ≈ 1.83, NFL ≈ 2.37). */
export function pythagoreanExpectation(scored: number, allowed: number, exponent: number): number {
  if (scored <= 0 && allowed <= 0) return 0.5;
  const s = Math.max(0, scored) ** exponent;
  const a = Math.max(0, allowed) ** exponent;
  return s + a > 0 ? s / (s + a) : 0.5;
}

/** League percentile (0–100) of a value among peers; higher is better unless inverted. */
export function percentileRank(value: number, peers: number[], higherIsBetter = true): number {
  if (peers.length === 0) return 50;
  const below = peers.filter((peer) => (higherIsBetter ? peer < value : peer > value)).length;
  const equal = peers.filter((peer) => peer === value).length;
  return Math.round(((below + equal / 2) / peers.length) * 100);
}

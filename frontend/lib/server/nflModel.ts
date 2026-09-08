import "server-only";
import { getMarketConsensus, type MarketConsensus } from "@/lib/server/marketOdds";
import { pickOutcome, serveProbability, withMarketFactor } from "@/lib/servingPolicy";
import type { ModelMetricsResponse, PredictionHistoryItem, TeamIdentity, TeamPrediction, TodayPredictionsResponse } from "@/lib/api";
import { fetchEspnNflSeason } from "@/lib/server/espnNflFeed";
import nflArtifact from "@/data/nfl-model-v2.json";

const K_FACTOR = 22;
const HOME_ADVANTAGE = 48;
const TEAM_ALIASES: Record<string, string> = { OAK: "LV", STL: "LA", LAR: "LA", SD: "LAC", WSH: "WAS" };

type EspnTeam = {
  id?: string;
  displayName?: string;
  abbreviation?: string;
  color?: string;
  alternateColor?: string;
};

type EspnCompetitor = {
  id?: string;
  homeAway?: "home" | "away";
  score?: string;
  winner?: boolean;
  team?: EspnTeam;
  records?: Array<{ name?: string; summary?: string }>;
};

type EspnEvent = {
  id?: string;
  date?: string;
  name?: string;
  shortName?: string;
  season?: { year?: number; type?: number };
  week?: { number?: number };
  status?: {
    period?: number;
    displayClock?: string;
    type?: { state?: "pre" | "in" | "post"; completed?: boolean; description?: string; detail?: string; shortDetail?: string };
  };
  competitions?: Array<{
    competitors?: EspnCompetitor[];
    venue?: { fullName?: string };
    neutralSite?: boolean;
  }>;
};

type TeamState = { games: number; wins: number; pointDiff: number; recent: number[]; lastGameAt: string | null };
type ModelState = { ratings: Map<string, number>; teams: Map<string, TeamState>; coefficients: number[] };
type NflArtifact = {
  modelVersion: string;
  trainedAt: string;
  trainingStart: number;
  trainedThrough: number;
  seasons: number[];
  trainingGames: number;
  holdoutSeason: number;
  holdoutMetrics: { games: number; correct: number; accuracy: number; brierScore: number; logLoss: number; homeWinBaseline: number; liftOverBaseline: number };
  checkpoints: Record<string, { coefficients: number[]; ratings: Record<string, number> }>;
};
const NFL_MODEL = nflArtifact as NflArtifact;
type ParsedGame = {
  id: string;
  date: string;
  season: number;
  week: number | null;
  status: string;
  state: "pre" | "in" | "post";
  completed: boolean;
  period: number;
  clock: string;
  venue: string | null;
  neutralSite: boolean;
  home: EspnCompetitor & { id: string; team: EspnTeam & { displayName: string } };
  away: EspnCompetitor & { id: string; team: EspnTeam & { displayName: string } };
  homeScore: number | null;
  awayScore: number | null;
};

type Evaluation = {
  games: number;
  correct: number;
  brier: number;
  logLoss: number;
  homeWins: number;
};

function easternToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

export function getDefaultNflDate(): string {
  return easternToday();
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00Z`).getTime());
}

function seasonForDate(value: string): number {
  const date = new Date(`${value}T12:00:00Z`);
  const year = date.getUTCFullYear();
  return date.getUTCMonth() < 2 ? year - 1 : year;
}

function weekWindow(value: string): { start: string; end: string } {
  const date = new Date(`${value}T12:00:00Z`);
  const day = date.getUTCDay();
  const daysSinceTuesday = (day + 5) % 7;
  const start = new Date(date);
  start.setUTCDate(start.getUTCDate() - daysSinceTuesday);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

async function fetchSeason(year: number): Promise<EspnEvent[]> {
  return fetchEspnNflSeason<EspnEvent>(year);
}

function parseScore(value: string | undefined): number | null {
  if (value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseEvent(event: EspnEvent): ParsedGame | null {
  const competition = event.competitions?.[0];
  const home = competition?.competitors?.find((team) => team.homeAway === "home");
  const away = competition?.competitors?.find((team) => team.homeAway === "away");
  if (!event.id || !event.date || !home?.id || !away?.id || !home.team?.displayName || !away.team?.displayName) return null;
  const state = event.status?.type?.state ?? "pre";
  return {
    id: event.id,
    date: event.date,
    season: event.season?.year ?? Number(event.date.slice(0, 4)),
    week: event.week?.number ?? null,
    status: event.status?.type?.shortDetail ?? event.status?.type?.detail ?? event.status?.type?.description ?? "Scheduled",
    state,
    completed: event.status?.type?.completed ?? state === "post",
    period: event.status?.period ?? 0,
    clock: event.status?.displayClock ?? "",
    venue: competition?.venue?.fullName ?? null,
    neutralSite: competition?.neutralSite ?? false,
    home: home as ParsedGame["home"],
    away: away as ParsedGame["away"],
    homeScore: parseScore(home.score),
    awayScore: parseScore(away.score)
  };
}

function parseEvents(events: EspnEvent[]): ParsedGame[] {
  return events.map(parseEvent).filter((game): game is ParsedGame => game !== null).sort((a, b) => a.date.localeCompare(b.date));
}

function createState(): TeamState {
  return { games: 0, wins: 0, pointDiff: 0, recent: [], lastGameAt: null };
}

function cloneModelState(source: ModelState): ModelState {
  return {
    ratings: new Map(source.ratings),
    teams: new Map([...source.teams].map(([id, team]) => [id, { ...team, recent: [...team.recent] }])),
    coefficients: [...source.coefficients]
  };
}

function rate(numerator: number, denominator: number, fallback = 0.5): number {
  return denominator ? numerator / denominator : fallback;
}

function teamKey(competitor: ParsedGame["home"] | ParsedGame["away"]): string {
  const abbreviation = competitor.team.abbreviation?.toUpperCase() ?? competitor.id;
  return TEAM_ALIASES[abbreviation] ?? abbreviation;
}

function clamp(value: number, lower: number, upper: number): number {
  return Math.max(lower, Math.min(upper, value));
}

function restDays(lastGameAt: string | null, gameAt: string): number {
  if (!lastGameAt) return 7;
  return clamp((new Date(gameAt).getTime() - new Date(lastGameAt).getTime()) / 86_400_000, 0, 21);
}

function gameFeatures(state: ModelState, game: ParsedGame): number[] {
  const homeKey = teamKey(game.home);
  const awayKey = teamKey(game.away);
  const homeRating = state.ratings.get(homeKey) ?? 1500;
  const awayRating = state.ratings.get(awayKey) ?? 1500;
  const home = state.teams.get(homeKey) ?? createState();
  const away = state.teams.get(awayKey) ?? createState();
  const recordEdge = rate(home.wins, home.games) - rate(away.wins, away.games);
  const recentEdge = rate(home.recent.reduce((sum, value) => sum + value, 0), home.recent.length) -
    rate(away.recent.reduce((sum, value) => sum + value, 0), away.recent.length);
  const pointEdge = rate(home.pointDiff, home.games, 0) - rate(away.pointDiff, away.games, 0);
  const restEdge = (restDays(home.lastGameAt, game.date) - restDays(away.lastGameAt, game.date)) / 7;
  return [
    1,
    clamp((homeRating - awayRating) / 400, -2.5, 2.5),
    game.neutralSite ? 0 : 1,
    recordEdge,
    recentEdge,
    clamp(pointEdge, -28, 28) / 14,
    clamp(restEdge, -2, 2)
  ];
}

function winProbability(state: ModelState, game: ParsedGame): number {
  const features = gameFeatures(state, game);
  const logit = features.reduce((sum, value, index) => sum + value * (state.coefficients[index] ?? 0), 0);
  return clamp(1 / (1 + Math.exp(-logit)), 0.12, 0.88);
}

function eloProbability(state: ModelState, game: ParsedGame): number {
  const homeRating = state.ratings.get(teamKey(game.home)) ?? 1500;
  const awayRating = state.ratings.get(teamKey(game.away)) ?? 1500;
  const advantage = game.neutralSite ? 0 : HOME_ADVANTAGE;
  return 1 / (1 + 10 ** (-(homeRating + advantage - awayRating) / 400));
}

function updateState(state: ModelState, game: ParsedGame): void {
  if (game.homeScore === null || game.awayScore === null || game.homeScore === game.awayScore) return;
  const homeKey = teamKey(game.home);
  const awayKey = teamKey(game.away);
  const homeWon = Number(game.homeScore > game.awayScore);
  const margin = Math.abs(game.homeScore - game.awayScore);
  const multiplier = Math.min(1.8, 1 + Math.log1p(margin) / 4.5);
  const change = K_FACTOR * multiplier * (homeWon - eloProbability(state, game));
  state.ratings.set(homeKey, (state.ratings.get(homeKey) ?? 1500) + change);
  state.ratings.set(awayKey, (state.ratings.get(awayKey) ?? 1500) - change);
  const home = state.teams.get(homeKey) ?? createState();
  const away = state.teams.get(awayKey) ?? createState();
  home.games += 1;
  home.wins += homeWon;
  home.pointDiff += game.homeScore - game.awayScore;
  home.recent = [...home.recent.slice(-4), homeWon];
  home.lastGameAt = game.date;
  away.games += 1;
  away.wins += 1 - homeWon;
  away.pointDiff += game.awayScore - game.homeScore;
  away.recent = [...away.recent.slice(-4), 1 - homeWon];
  away.lastGameAt = game.date;
  state.teams.set(homeKey, home);
  state.teams.set(awayKey, away);
}

function replay(games: ParsedGame[], state: ModelState, evaluate = false): Evaluation {
  const evaluation: Evaluation = { games: 0, correct: 0, brier: 0, logLoss: 0, homeWins: 0 };
  for (const game of games) {
    if (!game.completed || game.homeScore === null || game.awayScore === null || game.homeScore === game.awayScore) continue;
    const probability = winProbability(state, game);
    const homeWon = Number(game.homeScore > game.awayScore);
    if (evaluate) {
      evaluation.games += 1;
      evaluation.correct += Number((probability >= 0.5) === Boolean(homeWon));
      evaluation.homeWins += homeWon;
      evaluation.brier += (probability - homeWon) ** 2;
      evaluation.logLoss += -(homeWon * Math.log(probability) + (1 - homeWon) * Math.log(1 - probability));
    }
    updateState(state, game);
  }
  return evaluation;
}

function baseModelState(season: number): ModelState {
  const available = Object.keys(NFL_MODEL.checkpoints).map(Number).sort((a, b) => a - b);
  const checkpointSeason = available.filter((value) => value <= season).at(-1);
  if (checkpointSeason === undefined) throw new Error(`NFL predictions are available from the ${available[0]} season.`);
  const checkpoint = NFL_MODEL.checkpoints[String(checkpointSeason)];
  return { ratings: new Map(Object.entries(checkpoint.ratings)), teams: new Map(), coefficients: checkpoint.coefficients };
}

function recordFor(state: TeamState | undefined): string {
  if (!state) return "0-0";
  return `${state.wins}-${state.games - state.wins}`;
}

function identity(competitor: ParsedGame["home"] | ParsedGame["away"], state: TeamState | undefined): TeamIdentity {
  const numericId = Number(competitor.id);
  return {
    id: Number.isFinite(numericId) ? numericId : 0,
    name: competitor.team.displayName,
    abbreviation: competitor.team.abbreviation ?? competitor.team.displayName.split(" ").at(-1)?.slice(0, 3).toUpperCase() ?? "NFL",
    primary: `#${competitor.team.color ?? "262626"}`,
    accent: `#${competitor.team.alternateColor ?? "f5f5f5"}`,
    record: recordFor(state)
  };
}

function liveProbability(game: ParsedGame, pregame: number): number | null {
  if (game.homeScore === null || game.awayScore === null) return null;
  if (game.completed) return game.homeScore > game.awayScore ? 1 : 0;
  if (game.state !== "in") return null;
  const clockParts = game.clock.split(":").map(Number);
  const secondsInPeriod = Number.isFinite(clockParts[0]) ? clockParts[0] * 60 + (clockParts[1] || 0) : 900;
  const elapsed = Math.min(3600, Math.max(0, (Math.max(1, game.period) - 1) * 900 + (900 - secondsInPeriod)));
  const remainingShare = Math.max(0.04, 1 - elapsed / 3600);
  const priorLogit = Math.log(pregame / (1 - pregame));
  const scoreEffect = (game.homeScore - game.awayScore) * (0.13 / Math.sqrt(remainingShare));
  return Math.max(0.01, Math.min(0.99, 1 / (1 + Math.exp(-(priorLogit + scoreEffect)))));
}

function factorsFor(state: ModelState, game: ParsedGame): string[] {
  const homeRating = state.ratings.get(teamKey(game.home)) ?? 1500;
  const awayRating = state.ratings.get(teamKey(game.away)) ?? 1500;
  const home = state.teams.get(teamKey(game.home)) ?? createState();
  const away = state.teams.get(teamKey(game.away)) ?? createState();
  const factors = [
    `${homeRating + HOME_ADVANTAGE >= awayRating ? game.home.team.displayName : game.away.team.displayName} has the adjusted team-strength edge`,
    `${rate(home.wins, home.games) >= rate(away.wins, away.games) ? game.home.team.displayName : game.away.team.displayName} has the stronger season record`,
    `${home.pointDiff >= away.pointDiff ? game.home.team.displayName : game.away.team.displayName} has the better scoring margin profile`
  ];
  return factors;
}

function predictionFor(game: ParsedGame, state: ModelState, quote: MarketConsensus | null = null): TeamPrediction {
  // Served probability = model anchored to the pregame sportsbook line when one exists (lib/servingPolicy.ts).
  const served = serveProbability(
    "nfl",
    winProbability(state, game),
    game.completed || game.state === "in" ? null : quote?.homeWinProbability ?? null,
    NFL_MODEL.modelVersion
  );
  const probability = served.homeWinProbability;
  const awayProbability = served.awayWinProbability;
  const winner = probability >= 0.5 ? game.home.team.displayName : game.away.team.displayName;
  const liveHome = liveProbability(game, probability);
  const liveHomeRounded = liveHome === null ? null : Number(liveHome.toFixed(4));
  const liveAwayRounded = liveHomeRounded === null ? null : Number((1 - liveHomeRounded).toFixed(4));
  const homeIdentity = identity(game.home, state.teams.get(teamKey(game.home)));
  const awayIdentity = identity(game.away, state.teams.get(teamKey(game.away)));
  const actualWinner = game.completed && game.homeScore !== null && game.awayScore !== null
    ? game.homeScore > game.awayScore ? game.home.team.displayName : game.away.team.displayName
    : null;

  const factors = withMarketFactor(factorsFor(state, game), served, quote);
  const prediction: TeamPrediction = {
    sport: "nfl",
    game_id: game.id,
    gameId: game.id,
    date: game.date.slice(0, 10),
    week: game.week,
    home_team: game.home.team.displayName,
    away_team: game.away.team.displayName,
    homeTeam: homeIdentity,
    awayTeam: awayIdentity,
    game_time_utc: game.date,
    status: game.status,
    inning: game.state === "in" ? `${game.period > 4 ? "OT" : `Q${game.period}`} ${game.clock}` : null,
    venue: game.venue,
    homeProbablePitcher: null,
    awayProbablePitcher: null,
    home_probable_pitcher: null,
    away_probable_pitcher: null,
    predicted_winner: winner,
    pregame_predicted_winner: winner,
    home_win_probability: probability,
    away_win_probability: awayProbability,
    pregame_home_win_probability: probability,
    pregame_away_win_probability: awayProbability,
    live_home_win_probability: liveHomeRounded,
    live_away_win_probability: liveAwayRounded,
    live_favorite: liveHomeRounded === null ? null : liveHomeRounded >= 0.5 ? game.home.team.displayName : game.away.team.displayName,
    live_probability_source: game.completed ? "Final score" : liveHomeRounded === null ? null : "In-game score model",
    live_updated_at: liveHomeRounded === null ? null : new Date().toISOString(),
    live_market: quote,
    actual_winner: actualWinner,
    is_final: game.completed,
    prediction_source: served.source,
    confidence: Math.max(probability, awayProbability) >= 0.65 ? "Strong" : Math.max(probability, awayProbability) >= 0.57 ? "Edge" : "Lean",
    factors,
    home_score: game.homeScore,
    away_score: game.awayScore,
    model_home_win_probability: served.modelHomeWinProbability,
    market_home_win_probability: served.marketHomeWinProbability,
    market_delta: served.marketDelta,
    prediction_tier: served.tier,
    pick_result: null,
    pick_leading: null
  };
  return { ...prediction, ...pickOutcome(prediction) };
}

async function seasonContext(dateValue: string) {
  const season = seasonForDate(dateValue);
  const current = parseEvents(await fetchSeason(season)).filter((game) => game.season === season);
  return { season, current, baseline: { state: baseModelState(season) } };
}

export async function getNflPredictions(dateValue = easternToday()): Promise<TodayPredictionsResponse> {
  if (!isIsoDate(dateValue)) throw new Error("Use a valid date in YYYY-MM-DD format.");
  const { start, end } = weekWindow(dateValue);
  const context = await seasonContext(dateValue);
  const slate = context.current.filter((game) => game.date.slice(0, 10) >= start && game.date.slice(0, 10) <= end);
  const market = await getMarketConsensus(
    "nfl",
    slate.map((game) => ({ gameId: game.id, homeTeam: game.home.team.displayName, awayTeam: game.away.team.displayName, gameTimeUtc: game.date })),
    dateValue
  );
  const predictions = slate.map((game) => {
    const state = cloneModelState(context.baseline.state);
    const priorCurrentGames = context.current.filter((prior) => prior.completed && prior.date < game.date);
    replay(priorCurrentGames, state);
    return predictionFor(game, state, market.get(game.id) ?? null);
  });
  const weeks = [...new Set(slate.map((game) => game.week).filter((week): week is number => week !== null))];
  return {
    sport: "nfl",
    date: dateValue,
    slate_label: weeks.length === 1 ? `Week ${weeks[0]}` : `${start} – ${end}`,
    data_through: context.current.filter((game) => game.completed && game.date.slice(0, 10) < start).at(-1)?.date.slice(0, 10) ?? `${context.season}-season start`,
    model_version: NFL_MODEL.modelVersion,
    games_trained: NFL_MODEL.trainingGames + context.current.filter((game) => game.completed && game.date < dateValue).length,
    updated_at: new Date().toISOString(),
    live_updates: predictions.some((prediction) => prediction.live_home_win_probability !== null || prediction.live_market !== null),
    predictions
  };
}

export async function getNflHistory(limit = 80): Promise<PredictionHistoryItem[]> {
  const context = await seasonContext(easternToday());
  const state = cloneModelState(context.baseline.state);
  const result: PredictionHistoryItem[] = [];
  for (const game of context.current) {
    if (!game.completed || game.homeScore === null || game.awayScore === null || game.homeScore === game.awayScore) continue;
    const prediction = predictionFor(game, state);
    const actualWinner = game.homeScore > game.awayScore ? game.home.team.displayName : game.away.team.displayName;
    result.push({
      sport: "nfl",
      gameId: game.id,
      date: game.date.slice(0, 10),
      awayTeam: prediction.awayTeam,
      homeTeam: prediction.homeTeam,
      predictedWinner: prediction.predicted_winner,
      actualWinner,
      homeWinProbability: prediction.home_win_probability,
      awayWinProbability: prediction.away_win_probability,
      wasCorrect: prediction.predicted_winner === actualWinner,
      awayScore: game.awayScore,
      homeScore: game.homeScore
    });
    updateState(state, game);
  }
  return result.slice(-Math.max(1, Math.min(200, limit))).reverse();
}

export async function getNflMetrics(): Promise<ModelMetricsResponse> {
  const evaluation = NFL_MODEL.holdoutMetrics;
  return {
    sport: "nfl",
    available: true,
    status: "ready",
    message: null,
    model_name: "NFL 15-season calibrated strength + form model",
    version: NFL_MODEL.modelVersion,
    total_predictions_evaluated: evaluation.games,
    correct_predictions: evaluation.correct,
    accuracy: evaluation.accuracy,
    brier_score: evaluation.brierScore,
    log_loss: evaluation.logLoss,
    majority_baseline_accuracy: evaluation.homeWinBaseline,
    lift_over_baseline: evaluation.liftOverBaseline,
    last_trained_at: NFL_MODEL.trainedAt,
    training_start: String(NFL_MODEL.trainingStart),
    trained_through: String(NFL_MODEL.trainedThrough),
    total_training_examples: NFL_MODEL.trainingGames - evaluation.games,
    seasons: NFL_MODEL.seasons,
    description: "A separate NFL model trains chronologically on 15 complete seasons. It learns calibrated weights for franchise strength, home field, record, recent form, scoring margin, and rest, with each feature captured before kickoff.",
    features: ["elo_strength", "home_field", "win_rate", "recent_form", "point_differential", "rest_days"]
  };
}

export async function getNflGamePrediction(gameId: string): Promise<TeamPrediction | null> {
  let context = await seasonContext(easternToday());
  let game = context.current.find((item) => item.id === gameId);
  if (!game && context.season > NFL_MODEL.holdoutSeason) {
    context = await seasonContext(`${NFL_MODEL.holdoutSeason}-09-01`);
    game = context.current.find((item) => item.id === gameId);
  }
  if (!game) return null;
  const state = cloneModelState(context.baseline.state);
  replay(context.current.filter((prior) => prior.completed && prior.date < game.date), state);
  const market = await getMarketConsensus(
    "nfl",
    [{ gameId, homeTeam: game.home.team.displayName, awayTeam: game.away.team.displayName, gameTimeUtc: game.date }],
    game.date.slice(0, 10)
  );
  return predictionFor(game, state, market.get(gameId) ?? null);
}

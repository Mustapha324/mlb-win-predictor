import "server-only";
import { getMarketConsensus, type MarketConsensus } from "@/lib/server/marketOdds";
import type { ModelMetricsResponse, PredictionHistoryItem, TeamIdentity, TeamPrediction, TodayPredictionsResponse } from "@/lib/api";
import { fetchEspnNflSeason } from "@/lib/server/espnNflFeed";

const HOME_ADVANTAGE = 48;
const K_FACTOR = 22;
const SEASON_REGRESSION = 0.35;

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

type TeamState = { games: number; wins: number; pointDiff: number; recent: number[] };
type ModelState = { ratings: Map<string, number>; teams: Map<string, TeamState> };
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
  return { games: 0, wins: 0, pointDiff: 0, recent: [] };
}

function cloneModelState(source: ModelState): ModelState {
  return {
    ratings: new Map(source.ratings),
    teams: new Map([...source.teams].map(([id, team]) => [id, { ...team, recent: [...team.recent] }]))
  };
}

function rate(numerator: number, denominator: number, fallback = 0.5): number {
  return denominator ? numerator / denominator : fallback;
}

function winProbability(state: ModelState, game: ParsedGame): number {
  const homeRating = state.ratings.get(game.home.id) ?? 1500;
  const awayRating = state.ratings.get(game.away.id) ?? 1500;
  const home = state.teams.get(game.home.id) ?? createState();
  const away = state.teams.get(game.away.id) ?? createState();
  const elo = 1 / (1 + 10 ** (-(homeRating + HOME_ADVANTAGE - awayRating) / 400));
  const recordEdge = rate(home.wins, home.games) - rate(away.wins, away.games);
  const recentEdge = rate(home.recent.reduce((sum, value) => sum + value, 0), home.recent.length) -
    rate(away.recent.reduce((sum, value) => sum + value, 0), away.recent.length);
  const pointEdge = rate(home.pointDiff, home.games, 0) - rate(away.pointDiff, away.games, 0);
  const logit = Math.log(elo / (1 - elo)) + recordEdge * 0.7 + recentEdge * 0.45 + Math.max(-18, Math.min(18, pointEdge)) * 0.018;
  return Math.max(0.18, Math.min(0.82, 1 / (1 + Math.exp(-logit))));
}

function updateState(state: ModelState, game: ParsedGame, probability: number): void {
  if (game.homeScore === null || game.awayScore === null || game.homeScore === game.awayScore) return;
  const homeWon = Number(game.homeScore > game.awayScore);
  const margin = Math.abs(game.homeScore - game.awayScore);
  const multiplier = Math.min(1.8, 1 + Math.log1p(margin) / 4.5);
  const change = K_FACTOR * multiplier * (homeWon - probability);
  state.ratings.set(game.home.id, (state.ratings.get(game.home.id) ?? 1500) + change);
  state.ratings.set(game.away.id, (state.ratings.get(game.away.id) ?? 1500) - change);
  const home = state.teams.get(game.home.id) ?? createState();
  const away = state.teams.get(game.away.id) ?? createState();
  home.games += 1;
  home.wins += homeWon;
  home.pointDiff += game.homeScore - game.awayScore;
  home.recent = [...home.recent.slice(-4), homeWon];
  away.games += 1;
  away.wins += 1 - homeWon;
  away.pointDiff += game.awayScore - game.homeScore;
  away.recent = [...away.recent.slice(-4), 1 - homeWon];
  state.teams.set(game.home.id, home);
  state.teams.set(game.away.id, away);
}

function regressRatings(state: ModelState): void {
  for (const [id, rating] of state.ratings) state.ratings.set(id, 1500 + (rating - 1500) * (1 - SEASON_REGRESSION));
  state.teams.clear();
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
    updateState(state, game, probability);
  }
  return evaluation;
}

function baseModelState(trainingGames: ParsedGame[], evaluationGames: ParsedGame[]): { state: ModelState; evaluation: Evaluation } {
  const state: ModelState = { ratings: new Map(), teams: new Map() };
  replay(trainingGames, state);
  regressRatings(state);
  const evaluation = replay(evaluationGames, state, true);
  regressRatings(state);
  return { state, evaluation };
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
  const homeRating = state.ratings.get(game.home.id) ?? 1500;
  const awayRating = state.ratings.get(game.away.id) ?? 1500;
  const home = state.teams.get(game.home.id) ?? createState();
  const away = state.teams.get(game.away.id) ?? createState();
  const factors = [
    `${homeRating + HOME_ADVANTAGE >= awayRating ? game.home.team.displayName : game.away.team.displayName} has the adjusted team-strength edge`,
    `${rate(home.wins, home.games) >= rate(away.wins, away.games) ? game.home.team.displayName : game.away.team.displayName} has the stronger season record`,
    `${home.pointDiff >= away.pointDiff ? game.home.team.displayName : game.away.team.displayName} has the better scoring margin profile`
  ];
  return factors;
}

function predictionFor(game: ParsedGame, state: ModelState): TeamPrediction {
  const probability = Number(winProbability(state, game).toFixed(4));
  const awayProbability = Number((1 - probability).toFixed(4));
  const winner = probability >= 0.5 ? game.home.team.displayName : game.away.team.displayName;
  const liveHome = liveProbability(game, probability);
  const liveHomeRounded = liveHome === null ? null : Number(liveHome.toFixed(4));
  const liveAwayRounded = liveHomeRounded === null ? null : Number((1 - liveHomeRounded).toFixed(4));
  const homeIdentity = identity(game.home, state.teams.get(game.home.id));
  const awayIdentity = identity(game.away, state.teams.get(game.away.id));
  const actualWinner = game.completed && game.homeScore !== null && game.awayScore !== null
    ? game.homeScore > game.awayScore ? game.home.team.displayName : game.away.team.displayName
    : null;

  return {
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
    live_market: null as MarketConsensus | null,
    actual_winner: actualWinner,
    is_final: game.completed,
    prediction_source: "nfl-elo-form-v1",
    confidence: Math.max(probability, awayProbability) >= 0.65 ? "Strong" : Math.max(probability, awayProbability) >= 0.57 ? "Edge" : "Lean",
    factors: factorsFor(state, game),
    home_score: game.homeScore,
    away_score: game.awayScore
  };
}

async function seasonContext(dateValue: string) {
  const season = seasonForDate(dateValue);
  const [trainingEvents, evaluationEvents, currentEvents] = await Promise.all([
    fetchSeason(season - 2),
    fetchSeason(season - 1),
    fetchSeason(season)
  ]);
  const training = parseEvents(trainingEvents).filter((game) => game.season === season - 2);
  const evaluationGames = parseEvents(evaluationEvents).filter((game) => game.season === season - 1);
  const current = parseEvents(currentEvents).filter((game) => game.season === season);
  const baseline = baseModelState(training, evaluationGames);
  return { season, training, evaluationGames, current, baseline };
}

export async function getNflPredictions(dateValue = easternToday()): Promise<TodayPredictionsResponse> {
  if (!isIsoDate(dateValue)) throw new Error("Use a valid date in YYYY-MM-DD format.");
  const { start, end } = weekWindow(dateValue);
  const context = await seasonContext(dateValue);
  const slate = context.current.filter((game) => game.date.slice(0, 10) >= start && game.date.slice(0, 10) <= end);
  const predictions = slate.map((game) => {
    const state = cloneModelState(context.baseline.state);
    const priorCurrentGames = context.current.filter((prior) => prior.completed && prior.date < game.date);
    replay(priorCurrentGames, state);
    return predictionFor(game, state);
  });
  const market = await getMarketConsensus(
    "nfl",
    predictions.map((prediction) => ({ gameId: prediction.gameId, homeTeam: prediction.home_team, awayTeam: prediction.away_team }))
  );
  for (const prediction of predictions) prediction.live_market = market.get(prediction.gameId) ?? null;
  const weeks = [...new Set(slate.map((game) => game.week).filter((week): week is number => week !== null))];
  return {
    sport: "nfl",
    date: dateValue,
    slate_label: weeks.length === 1 ? `Week ${weeks[0]}` : `${start} – ${end}`,
    data_through: context.current.filter((game) => game.completed && game.date.slice(0, 10) < start).at(-1)?.date.slice(0, 10) ?? `${context.season}-season start`,
    model_version: "nfl-elo-form-v1",
    games_trained: context.training.filter((game) => game.completed).length + context.evaluationGames.filter((game) => game.completed).length,
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
    updateState(state, game, prediction.home_win_probability);
  }
  return result.slice(-Math.max(1, Math.min(200, limit))).reverse();
}

export async function getNflMetrics(): Promise<ModelMetricsResponse> {
  const context = await seasonContext(easternToday());
  const evaluation = context.baseline.evaluation;
  const games = Math.max(1, evaluation.games);
  return {
    sport: "nfl",
    available: evaluation.games > 0,
    status: evaluation.games > 0 ? "ready" : "evaluation unavailable",
    message: evaluation.games > 0 ? null : "Historical NFL results were unavailable from the schedule service.",
    model_name: "NFL chronological Elo + form model",
    version: "nfl-elo-form-v1",
    total_predictions_evaluated: evaluation.games,
    correct_predictions: evaluation.correct,
    accuracy: evaluation.correct / games,
    brier_score: evaluation.brier / games,
    log_loss: evaluation.logLoss / games,
    majority_baseline_accuracy: evaluation.homeWins / games,
    lift_over_baseline: evaluation.correct / games - evaluation.homeWins / games,
    last_trained_at: `${context.season - 1}-02-15T00:00:00Z`,
    training_start: String(context.season - 2),
    trained_through: String(context.season - 1),
    total_training_examples: context.training.filter((game) => game.completed).length,
    seasons: [context.season - 2, context.season - 1],
    description: "A separate NFL model replays games chronologically. It combines regressed Elo strength, record, scoring margin, recent form, and a measured home-field adjustment without using future results.",
    features: ["elo_strength", "home_field", "win_rate", "recent_form", "point_differential"]
  };
}

export async function getNflGamePrediction(gameId: string): Promise<TeamPrediction | null> {
  const context = await seasonContext(easternToday());
  const game = context.current.find((item) => item.id === gameId) ?? context.evaluationGames.find((item) => item.id === gameId);
  if (!game) return null;
  const state = cloneModelState(context.baseline.state);
  replay(context.current.filter((prior) => prior.completed && prior.date < game.date), state);
  const prediction = predictionFor(game, state);
  const market = await getMarketConsensus("nfl", [{ gameId, homeTeam: prediction.home_team, awayTeam: prediction.away_team }]);
  prediction.live_market = market.get(gameId) ?? null;
  return prediction;
}

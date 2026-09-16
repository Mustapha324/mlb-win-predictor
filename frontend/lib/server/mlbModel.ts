import modelSnapshotJson from "@/data/model-snapshot.json";
import { getMarketConsensus, type MarketConsensus } from "@/lib/server/marketOdds";
import { pickOutcome, serveProbability, withMarketFactor } from "@/lib/servingPolicy";

const MLB_API = "https://statsapi.mlb.com/api/v1";
const REGULAR_SEASON_START_MONTH_DAY = "03-01";

type SnapshotTeam = {
  name: string;
  abbreviation: string;
  primary: string;
  accent: string;
  rating: number;
};

type ModelSnapshot = {
  model_name: string;
  version: string;
  description: string;
  training_start: string;
  trained_through: string;
  seasons: number[];
  games_trained: number;
  holdout_season: number;
  holdout_metrics: {
    games: number;
    correct: number;
    accuracy: number;
    brier_score: number;
    log_loss: number;
    home_win_rate: number;
    majority_baseline_accuracy: number;
  };
  hyperparameters: {
    k_factor: number;
    home_advantage: number;
    season_regression: number;
  };
  portable_model: {
    feature_names: string[];
    means: number[];
    scales: number[];
    weights: number[];
    trained_through_season: number;
  };
  teams: Record<string, SnapshotTeam>;
};

const snapshot = modelSnapshotJson as ModelSnapshot;

type RawTeam = { id?: number; name?: string };
type RawProbablePitcher = { id?: number; fullName?: string };
type RawGameSide = {
  score?: number;
  team?: RawTeam;
  probablePitcher?: RawProbablePitcher;
};
type RawScheduleGame = {
  gamePk?: number;
  gameDate?: string;
  officialDate?: string;
  status?: { abstractGameState?: string; detailedState?: string };
  teams?: { away?: RawGameSide; home?: RawGameSide };
  venue?: { name?: string };
  linescore?: { currentInning?: number; currentInningOrdinal?: string; inningState?: string };
};
type SchedulePayload = { dates?: Array<{ date?: string; games?: RawScheduleGame[] }> };

type CompletedGame = {
  gameId: number;
  date: string;
  awayTeamId: number;
  awayTeam: string;
  homeTeamId: number;
  homeTeam: string;
  awayScore: number;
  homeScore: number;
};

type TeamState = {
  games: number;
  wins: number;
  runDiff: number;
  homeGames: number;
  homeWins: number;
  awayGames: number;
  awayWins: number;
  recent: number[];
};

type PitcherStats = { era: number; whip: number; innings: number } | null;

export type TeamIdentity = {
  id: number;
  name: string;
  abbreviation: string;
  primary: string;
  accent: string;
  record: string;
};

export type WebPrediction = {
  sport: "mlb";
  game_id: string;
  gameId: string;
  date: string;
  game_time_utc: string | null;
  status: string;
  inning: string | null;
  venue: string | null;
  away_team: string;
  home_team: string;
  awayTeam: TeamIdentity;
  homeTeam: TeamIdentity;
  away_probable_pitcher: string | null;
  home_probable_pitcher: string | null;
  awayProbablePitcher: string | null;
  homeProbablePitcher: string | null;
  predicted_winner: string;
  pregame_predicted_winner: string;
  home_win_probability: number;
  away_win_probability: number;
  pregame_home_win_probability: number;
  pregame_away_win_probability: number;
  live_home_win_probability: number | null;
  live_away_win_probability: number | null;
  live_favorite: string | null;
  live_probability_source: string | null;
  live_updated_at: string | null;
  live_market: MarketConsensus | null;
  actual_winner: string | null;
  is_final: boolean;
  prediction_source: string;
  confidence: "Lean" | "Edge" | "Strong";
  factors: string[];
  away_score: number | null;
  home_score: number | null;
  model_home_win_probability: number | null;
  market_home_win_probability: number | null;
  market_delta: number | null;
  prediction_tier: "A" | "B" | "C" | null;
  pick_result: "hit" | "miss" | null;
  pick_leading: boolean | null;
};

export type TodayPredictions = {
  sport: "mlb";
  date: string;
  slate_label: string;
  data_through: string;
  model_version: string;
  games_trained: number;
  updated_at: string;
  live_updates: boolean;
  predictions: WebPrediction[];
};

export type WebHistoryItem = {
  gameId: string;
  date: string;
  awayTeam: TeamIdentity;
  homeTeam: TeamIdentity;
  predictedWinner: string;
  actualWinner: string;
  homeWinProbability: number;
  awayWinProbability: number;
  wasCorrect: boolean;
  awayScore: number;
  homeScore: number;
};

function createTeamState(): TeamState {
  return { games: 0, wins: 0, runDiff: 0, homeGames: 0, homeWins: 0, awayGames: 0, awayWins: 0, recent: [] };
}

function easternToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

export function getDefaultPredictionDate(): string {
  return easternToday();
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return !Number.isNaN(new Date(`${value}T12:00:00Z`).getTime());
}

function toQuery(params: Record<string, string | number>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) search.set(key, String(value));
  return search.toString();
}

async function fetchMlb<T>(path: string, params: Record<string, string | number>): Promise<T> {
  const response = await fetch(`${MLB_API}${path}?${toQuery(params)}`, {
    headers: { Accept: "application/json", "User-Agent": "sport-iq/1.0" }
  });
  if (!response.ok) throw new Error(`MLB data service returned ${response.status}.`);
  return (await response.json()) as T;
}

function parseCompletedGames(payload: SchedulePayload): CompletedGame[] {
  const games: CompletedGame[] = [];
  for (const day of payload.dates ?? []) {
    for (const game of day.games ?? []) {
      if (game.status?.abstractGameState !== "Final") continue;
      const away = game.teams?.away;
      const home = game.teams?.home;
      const required = [game.gamePk, game.officialDate ?? day.date, away?.team?.id, away?.team?.name, home?.team?.id, home?.team?.name, away?.score, home?.score];
      if (required.some((value) => value === null || value === undefined)) continue;
      if (away?.score === home?.score) continue;
      games.push({
        gameId: game.gamePk as number,
        date: (game.officialDate ?? day.date) as string,
        awayTeamId: away?.team?.id as number,
        awayTeam: away?.team?.name as string,
        homeTeamId: home?.team?.id as number,
        homeTeam: home?.team?.name as string,
        awayScore: away?.score as number,
        homeScore: home?.score as number
      });
    }
  }
  return games.sort((a, b) => a.date.localeCompare(b.date) || a.gameId - b.gameId);
}

function baseRatings(): Map<number, number> {
  const ratings = new Map<number, number>();
  for (const [teamId, team] of Object.entries(snapshot.teams)) {
    const regressed = 1500 + (team.rating - 1500) * (1 - snapshot.hyperparameters.season_regression);
    ratings.set(Number(teamId), regressed);
  }
  return ratings;
}

function ratingFor(ratings: Map<number, number>, teamId: number): number {
  return ratings.get(teamId) ?? 1500;
}

function eloProbability(homeRating: number, awayRating: number): number {
  const edge = homeRating + snapshot.hyperparameters.home_advantage - awayRating;
  return 1 / (1 + 10 ** (-edge / 400));
}

function rate(numerator: number, denominator: number, fallback = 0.5): number {
  return denominator ? numerator / denominator : fallback;
}

function modelFeatures(home: TeamState, away: TeamState, eloHomeProbability: number): number[] {
  return [
    Math.log(eloHomeProbability / (1 - eloHomeProbability)),
    rate(home.wins, home.games) - rate(away.wins, away.games),
    rate(home.recent.reduce((sum, result) => sum + result, 0), home.recent.length) -
      rate(away.recent.reduce((sum, result) => sum + result, 0), away.recent.length),
    rate(home.runDiff, home.games, 0) - rate(away.runDiff, away.games, 0),
    rate(home.homeWins, home.homeGames) - rate(away.awayWins, away.awayGames)
  ];
}

function logisticProbability(features: number[]): number {
  const model = snapshot.portable_model;
  const standardized = features.map((value, index) => (value - model.means[index]) / model.scales[index]);
  const score = model.weights[0] + standardized.reduce((sum, value, index) => sum + value * model.weights[index + 1], 0);
  const probability = 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, score))));
  return Math.max(0.2, Math.min(0.8, probability));
}

function updateState(state: TeamState, won: number, runDiff: number, side: "home" | "away"): void {
  state.games += 1;
  state.wins += won;
  state.runDiff += runDiff;
  state.recent = [...state.recent.slice(-9), won];
  if (side === "home") {
    state.homeGames += 1;
    state.homeWins += won;
  } else {
    state.awayGames += 1;
    state.awayWins += won;
  }
}

function updateAfterGame(ratings: Map<number, number>, states: Map<number, TeamState>, game: CompletedGame, probability: number): void {
  const homeWon = Number(game.homeScore > game.awayScore);
  const marginMultiplier = Math.min(1.75, 1 + Math.log1p(Math.abs(game.homeScore - game.awayScore)) / 5);
  const change = snapshot.hyperparameters.k_factor * marginMultiplier * (homeWon - probability);
  ratings.set(game.homeTeamId, ratingFor(ratings, game.homeTeamId) + change);
  ratings.set(game.awayTeamId, ratingFor(ratings, game.awayTeamId) - change);
  const homeState = states.get(game.homeTeamId) ?? createTeamState();
  const awayState = states.get(game.awayTeamId) ?? createTeamState();
  updateState(homeState, homeWon, game.homeScore - game.awayScore, "home");
  updateState(awayState, 1 - homeWon, game.awayScore - game.homeScore, "away");
  states.set(game.homeTeamId, homeState);
  states.set(game.awayTeamId, awayState);
}

function identity(teamId: number, name: string, state?: TeamState): TeamIdentity {
  const saved = snapshot.teams[String(teamId)];
  return {
    id: teamId,
    name,
    abbreviation: saved?.abbreviation ?? name.split(" ").map((part) => part[0]).join("").slice(0, 3).toUpperCase(),
    primary: saved?.primary ?? "#334155",
    accent: saved?.accent ?? "#e2e8f0",
    record: state ? `${state.wins}-${state.games - state.wins}` : "0-0"
  };
}

function getFactorLabels(features: number[], homeName: string, awayName: string): string[] {
  const labels = ["long-term rating", "season record", "last 10 games", "run differential", "home/road split"];
  const contributions = features.map((value, index) => ({
    index,
    value: ((value - snapshot.portable_model.means[index]) / snapshot.portable_model.scales[index]) * snapshot.portable_model.weights[index + 1]
  }));
  return contributions
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, 2)
    .map((item) => `${item.value >= 0 ? homeName : awayName} has the ${labels[item.index]} edge`);
}

function parseInnings(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return 0;
  const [innings, outs = "0"] = value.split(".");
  return Number(innings) + Number(outs) / 3;
}

async function fetchPitcherStats(pitcherId: number | undefined, season: number): Promise<PitcherStats> {
  if (!pitcherId) return null;
  try {
    const payload = await fetchMlb<{ stats?: Array<{ splits?: Array<{ stat?: Record<string, unknown> }> }> }>(
      `/people/${pitcherId}/stats`,
      { stats: "season", group: "pitching", season }
    );
    const stat = payload.stats?.[0]?.splits?.[0]?.stat;
    if (!stat) return null;
    const era = Number(stat.era);
    const whip = Number(stat.whip);
    const innings = parseInnings(stat.inningsPitched);
    return Number.isFinite(era) && Number.isFinite(whip) ? { era, whip, innings } : null;
  } catch {
    return null;
  }
}

function withPitcherAdjustment(baseProbability: number, home: PitcherStats, away: PitcherStats): { probability: number; factor: string | null } {
  if (!home || !away) return { probability: baseProbability, factor: null };
  const reliability = Math.min(1, Math.min(home.innings, away.innings) / 45);
  const adjustment = ((away.era - home.era) * 0.045 + (away.whip - home.whip) * 0.12) * reliability;
  const baseLogit = Math.log(baseProbability / (1 - baseProbability));
  const probability = Math.max(0.2, Math.min(0.8, 1 / (1 + Math.exp(-(baseLogit + adjustment)))));
  const factor = Math.abs(adjustment) >= 0.025 ? `${adjustment >= 0 ? "Home" : "Away"} starter has the pitching edge` : null;
  return { probability, factor };
}

function isFinalStatus(status: RawScheduleGame["status"]): boolean {
  return status?.abstractGameState === "Final" || /final|completed|game over/i.test(status?.detailedState ?? "");
}

function isLiveStatus(status: RawScheduleGame["status"]): boolean {
  return status?.abstractGameState === "Live" || /progress|inning|top |bottom |middle |end |delay/i.test(status?.detailedState ?? "");
}

function inGameHomeProbability(game: RawScheduleGame, pregameProbability: number): number | null {
  const homeScore = game.teams?.home?.score;
  const awayScore = game.teams?.away?.score;
  if (homeScore === undefined || awayScore === undefined) return null;
  if (isFinalStatus(game.status)) return homeScore > awayScore ? 1 : 0;
  if (!isLiveStatus(game.status)) return null;

  const inning = Math.max(1, game.linescore?.currentInning ?? 1);
  const inningState = game.linescore?.inningState?.toLowerCase() ?? "";
  const halfInning = inningState.includes("bottom") || inningState.includes("end") ? 0.75 : inningState.includes("middle") ? 0.5 : 0.2;
  const completedShare = Math.min(0.98, Math.max(0, (inning - 1 + halfInning) / 9));
  const remainingShare = Math.max(0.06, 1 - completedShare);
  const priorLogit = Math.log(pregameProbability / (1 - pregameProbability));
  const scoreLeverage = 0.82 / Math.sqrt(remainingShare);
  const battingAdjustment = inningState.includes("bottom") ? 0.08 : inningState.includes("top") ? -0.05 : 0;
  const liveLogit = priorLogit + (homeScore - awayScore) * scoreLeverage + battingAdjustment;
  return Math.max(0.01, Math.min(0.99, 1 / (1 + Math.exp(-liveLogit))));
}

async function seasonGamesThrough(dateValue: string): Promise<CompletedGame[]> {
  const season = Number(dateValue.slice(0, 4));
  const payload = await fetchMlb<SchedulePayload>("/schedule", {
    sportId: 1,
    gameTypes: "R",
    startDate: `${season}-${REGULAR_SEASON_START_MONTH_DAY}`,
    endDate: dateValue,
    fields: "dates,date,games,gamePk,gameDate,officialDate,status,abstractGameState,detailedState,teams,away,score,team,id,name,home"
  });
  return parseCompletedGames(payload);
}

function replayBefore(games: CompletedGame[], cutoffDate: string): { ratings: Map<number, number>; states: Map<number, TeamState>; dataThrough: string } {
  const ratings = baseRatings();
  const states = new Map<number, TeamState>();
  let dataThrough = snapshot.trained_through;
  for (const game of games) {
    if (game.date >= cutoffDate) continue;
    const homeState = states.get(game.homeTeamId) ?? createTeamState();
    const awayState = states.get(game.awayTeamId) ?? createTeamState();
    const probability = logisticProbability(modelFeatures(homeState, awayState, eloProbability(ratingFor(ratings, game.homeTeamId), ratingFor(ratings, game.awayTeamId))));
    updateAfterGame(ratings, states, game, probability);
    dataThrough = game.date;
  }
  return { ratings, states, dataThrough };
}

export async function getPredictions(dateValue = easternToday()): Promise<TodayPredictions> {
  if (!isIsoDate(dateValue)) throw new Error("Use a valid date in YYYY-MM-DD format.");
  const season = Number(dateValue.slice(0, 4));
  if (season !== Number(easternToday().slice(0, 4))) throw new Error("Predictions are available for the current MLB season.");

  const [seasonGames, schedule] = await Promise.all([
    seasonGamesThrough(dateValue),
    fetchMlb<SchedulePayload>("/schedule", { sportId: 1, date: dateValue, hydrate: "probablePitcher,team,linescore" })
  ]);
  const { ratings, states, dataThrough } = replayBefore(seasonGames, dateValue);
  const rawGames = (schedule.dates ?? []).flatMap((day) => day.games ?? []);
  const pitcherIds = new Set<number>();
  for (const game of rawGames) {
    const homeId = game.teams?.home?.probablePitcher?.id;
    const awayId = game.teams?.away?.probablePitcher?.id;
    if (homeId) pitcherIds.add(homeId);
    if (awayId) pitcherIds.add(awayId);
  }
  const pitcherPairs = await Promise.all([...pitcherIds].map(async (id) => [id, await fetchPitcherStats(id, season)] as const));
  const pitchers = new Map(pitcherPairs);

  // Pregame sportsbook lines first: the served probability is anchored to them (see lib/servingPolicy.ts).
  const market = await getMarketConsensus(
    "mlb",
    rawGames.flatMap((game) => {
      const homeName = game.teams?.home?.team?.name;
      const awayName = game.teams?.away?.team?.name;
      return game.gamePk && homeName && awayName
        ? [{ gameId: String(game.gamePk), homeTeam: homeName, awayTeam: awayName, gameTimeUtc: game.gameDate ?? null }]
        : [];
    }),
    dateValue
  );

  const predictions: WebPrediction[] = [];
  for (const game of rawGames) {
    const away = game.teams?.away;
    const home = game.teams?.home;
    if (!game.gamePk || !away?.team?.id || !away.team.name || !home?.team?.id || !home.team.name) continue;
    const homeState = states.get(home.team.id) ?? createTeamState();
    const awayState = states.get(away.team.id) ?? createTeamState();
    const features = modelFeatures(homeState, awayState, eloProbability(ratingFor(ratings, home.team.id), ratingFor(ratings, away.team.id)));
    const baseProbability = logisticProbability(features);
    const adjusted = withPitcherAdjustment(
      baseProbability,
      pitchers.get(home.probablePitcher?.id ?? -1) ?? null,
      pitchers.get(away.probablePitcher?.id ?? -1) ?? null
    );
    const final = isFinalStatus(game.status);
    const quote = market.get(String(game.gamePk)) ?? null;
    const served = serveProbability("mlb", adjusted.probability, final || isLiveStatus(game.status) ? null : quote?.homeWinProbability ?? null, snapshot.version);
    const homeProbability = served.homeWinProbability;
    const awayProbability = served.awayWinProbability;
    const winner = homeProbability >= 0.5 ? home.team.name : away.team.name;
    const liveHomeProbability = inGameHomeProbability(game, homeProbability);
    const liveAwayProbability = liveHomeProbability === null ? null : Number((1 - liveHomeProbability).toFixed(4));
    const liveHomeRounded = liveHomeProbability === null ? null : Number(liveHomeProbability.toFixed(4));
    const actualWinner = final && home.score !== undefined && away.score !== undefined
      ? home.score > away.score ? home.team.name : away.team.name
      : null;
    const confidenceValue = Math.max(homeProbability, awayProbability);
    const factors = getFactorLabels(features, home.team.name, away.team.name);
    if (adjusted.factor) factors.push(adjusted.factor);
    const prediction: WebPrediction = {
      sport: "mlb",
      game_id: String(game.gamePk),
      gameId: String(game.gamePk),
      date: game.officialDate ?? dateValue,
      game_time_utc: game.gameDate ?? null,
      status: game.status?.detailedState ?? "Scheduled",
      inning:
        game.linescore?.currentInning && game.linescore?.inningState
          ? `${game.linescore.inningState} ${game.linescore.currentInningOrdinal ?? game.linescore.currentInning}`
          : null,
      venue: game.venue?.name ?? null,
      away_team: away.team.name,
      home_team: home.team.name,
      awayTeam: identity(away.team.id, away.team.name, awayState),
      homeTeam: identity(home.team.id, home.team.name, homeState),
      away_probable_pitcher: away.probablePitcher?.fullName ?? null,
      home_probable_pitcher: home.probablePitcher?.fullName ?? null,
      awayProbablePitcher: away.probablePitcher?.fullName ?? null,
      homeProbablePitcher: home.probablePitcher?.fullName ?? null,
      predicted_winner: winner,
      pregame_predicted_winner: winner,
      home_win_probability: homeProbability,
      away_win_probability: awayProbability,
      pregame_home_win_probability: homeProbability,
      pregame_away_win_probability: awayProbability,
      live_home_win_probability: liveHomeRounded,
      live_away_win_probability: liveAwayProbability,
      live_favorite: liveHomeRounded === null ? null : liveHomeRounded >= 0.5 ? home.team.name : away.team.name,
      live_probability_source: final ? "Final score" : liveHomeRounded === null ? null : "In-game score model",
      live_updated_at: liveHomeRounded === null ? null : new Date().toISOString(),
      live_market: quote,
      actual_winner: actualWinner,
      is_final: final,
      prediction_source: served.source,
      confidence: confidenceValue >= 0.62 ? "Strong" : confidenceValue >= 0.56 ? "Edge" : "Lean",
      factors: withMarketFactor(factors, served, quote),
      away_score: away.score ?? null,
      home_score: home.score ?? null,
      model_home_win_probability: served.modelHomeWinProbability,
      market_home_win_probability: served.marketHomeWinProbability,
      market_delta: served.marketDelta,
      prediction_tier: served.tier,
      pick_result: null,
      pick_leading: null
    };
    predictions.push({ ...prediction, ...pickOutcome(prediction) });
  }

  predictions.sort((a, b) => (a.game_time_utc ?? "").localeCompare(b.game_time_utc ?? ""));
  return {
    sport: "mlb",
    date: dateValue,
    slate_label: dateValue === easternToday() ? "Today's games" : dateValue,
    data_through: dataThrough,
    model_version: snapshot.version,
    games_trained: snapshot.games_trained,
    updated_at: new Date().toISOString(),
    live_updates: predictions.some((prediction) => prediction.live_home_win_probability !== null || prediction.live_market !== null),
    predictions
  };
}

export async function getRecentHistory(limit = 60): Promise<WebHistoryItem[]> {
  const today = easternToday();
  const games = await seasonGamesThrough(today);
  const ratings = baseRatings();
  const states = new Map<number, TeamState>();
  const history: WebHistoryItem[] = [];
  for (const game of games) {
    const homeState = states.get(game.homeTeamId) ?? createTeamState();
    const awayState = states.get(game.awayTeamId) ?? createTeamState();
    const probability = logisticProbability(modelFeatures(homeState, awayState, eloProbability(ratingFor(ratings, game.homeTeamId), ratingFor(ratings, game.awayTeamId))));
    const predictedWinner = probability >= 0.5 ? game.homeTeam : game.awayTeam;
    const actualWinner = game.homeScore > game.awayScore ? game.homeTeam : game.awayTeam;
    history.push({
      gameId: String(game.gameId),
      date: game.date,
      awayTeam: identity(game.awayTeamId, game.awayTeam, awayState),
      homeTeam: identity(game.homeTeamId, game.homeTeam, homeState),
      predictedWinner,
      actualWinner,
      homeWinProbability: Number(probability.toFixed(4)),
      awayWinProbability: Number((1 - probability).toFixed(4)),
      wasCorrect: predictedWinner === actualWinner,
      awayScore: game.awayScore,
      homeScore: game.homeScore
    });
    updateAfterGame(ratings, states, game, probability);
  }
  return history.slice(-Math.max(1, Math.min(limit, 200))).reverse();
}

export function getModelMetrics() {
  return {
    available: true,
    status: "ready",
    message: null,
    model_name: snapshot.model_name,
    version: snapshot.version,
    total_predictions_evaluated: snapshot.holdout_metrics.games,
    correct_predictions: snapshot.holdout_metrics.correct,
    accuracy: snapshot.holdout_metrics.accuracy,
    brier_score: snapshot.holdout_metrics.brier_score,
    log_loss: snapshot.holdout_metrics.log_loss,
    majority_baseline_accuracy: snapshot.holdout_metrics.majority_baseline_accuracy,
    lift_over_baseline: snapshot.holdout_metrics.accuracy - snapshot.holdout_metrics.majority_baseline_accuracy,
    last_trained_at: `${snapshot.trained_through}T23:59:59Z`,
    training_start: snapshot.training_start,
    trained_through: snapshot.trained_through,
    total_training_examples: snapshot.games_trained,
    seasons: snapshot.seasons,
    description: snapshot.description,
    features: [...snapshot.portable_model.feature_names, "probable_pitcher_era", "probable_pitcher_whip"]
  };
}

export async function getGamePrediction(gameId: string): Promise<WebPrediction | null> {
  const schedule = await fetchMlb<SchedulePayload>("/schedule", { sportId: 1, gamePk: gameId, hydrate: "probablePitcher,team,linescore" });
  const raw = (schedule.dates ?? []).flatMap((day) => day.games ?? [])[0];
  const dateValue = raw?.officialDate;
  if (!dateValue) return null;
  const slate = await getPredictions(dateValue);
  return slate.predictions.find((prediction) => prediction.gameId === gameId) ?? null;
}

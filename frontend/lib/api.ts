import { apiUrl } from "@/lib/apiConfig";
import type { Sport } from "@/lib/sports";

export type TeamIdentity = {
  id: number;
  name: string;
  abbreviation: string;
  primary: string;
  accent: string;
  record: string;
};

export type TeamPrediction = {
  is_locked?: boolean;
  sport: Sport;
  game_id: string;
  gameId: string;
  date: string;
  week?: number | null;
  home_team: string;
  away_team: string;
  homeTeam: TeamIdentity;
  awayTeam: TeamIdentity;
  game_time_utc: string | null;
  status: string;
  inning: string | null;
  venue: string | null;
  homeProbablePitcher: string | null;
  awayProbablePitcher: string | null;
  home_probable_pitcher: string | null;
  away_probable_pitcher: string | null;
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
  live_market: {
    homeWinProbability: number;
    awayWinProbability: number;
    homeAmericanOdds: number;
    awayAmericanOdds: number;
    favorite: string;
    source: string;
    books: number;
    updatedAt: string;
  } | null;
  actual_winner: string | null;
  is_final: boolean;
  prediction_source: string;
  confidence: "Lean" | "Edge" | "Strong";
  factors: string[];
  home_score: number | null;
  away_score: number | null;
  /** Raw model probability before the market anchor (null when locked). */
  model_home_win_probability?: number | null;
  /** No-vig sportsbook probability the served number was anchored to; null when no pregame line existed. */
  market_home_win_probability?: number | null;
  /** Model minus market on the home side; null without a line. */
  market_delta?: number | null;
  /** Selective-prediction tier of the served probability: A = strongest. */
  prediction_tier?: "A" | "B" | "C" | null;
  /** Graded once the game is final. */
  pick_result?: "hit" | "miss" | null;
  /** While live: whether the picked side currently leads (null when tied or unknown). */
  pick_leading?: boolean | null;
};

export type TodayPredictionsResponse = {
  sport: Sport;
  date: string;
  slate_label: string;
  data_through: string;
  model_version: string;
  games_trained: number;
  updated_at: string;
  live_updates: boolean;
  predictions: TeamPrediction[];
};

export type ModelMetricsResponse = {
  sport?: Sport;
  available: boolean;
  status: string;
  message: string | null;
  model_name: string;
  version: string;
  total_predictions_evaluated: number;
  correct_predictions: number;
  accuracy: number;
  brier_score: number;
  log_loss: number;
  majority_baseline_accuracy: number;
  lift_over_baseline: number;
  last_trained_at: string;
  training_start: string;
  trained_through: string;
  total_training_examples: number;
  seasons: number[];
  description: string;
  features: string[];
  refresh?: {
    schedule: string;
    mode: string;
    lastRunAt: string | null;
    status: string;
    gamesRefreshed: number | null;
    playerPicksRefreshed: number | null;
  };
};

export type PredictionHistoryItem = {
  sport?: Sport;
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

export type PlayerPick = {
  id: string;
  sport: Sport;
  rank: number;
  gameId: string;
  playerId: string;
  playerName: string;
  headshotUrl: string | null;
  position: string | null;
  team: string;
  opponent: string;
  gameTime: string | null;
  market: string;
  selection: "Over" | "Under";
  line: number;
  projection: number | null;
  confidence: number | null;
  supportingStats: string[];
  explanation: string | null;
  modelVersion: string;
  modelEdge: number | null;
  lineSource: "sportsbook_consensus" | "model_estimate";
  americanOdds: number | null;
  sportsbook: string | null;
  overOdds: number | null;
  underOdds: number | null;
  marketBooks: number;
  marketUpdatedAt: string | null;
  expectedValue: number | null;
  sampleSize: number;
  status: "scheduled" | "live" | "final" | "postponed";
  statusLabel: string;
  actualValue: number | null;
  result: "pending" | "correct" | "incorrect" | "push" | "void";
  resultUpdatedAt: string | null;
  isTopFive: boolean;
  is_locked: boolean;
  /** Live pace while the game is in progress; settled once graded. Absent on older snapshots. */
  live?: LivePaceInfo | null;
};

export type LivePaceInfo = {
  current: number | null;
  line: number;
  progress: number;
  projected: number | null;
  state: "pending" | "cleared" | "on_pace" | "behind" | "busted" | "final";
  label: string;
};

export type LiveSummary = {
  total: number;
  scheduled: number;
  live: number;
  final: number;
  cleared: number;
  onPace: number;
  behind: number;
  busted: number;
  correct: number;
  incorrect: number;
};

export type PlayerPickPerformance = {
  graded: number;
  correct: number;
  incorrect: number;
  pushes: number;
  voids: number;
  accuracy: number | null;
  topFiveGraded: number;
  topFiveCorrect: number;
  topFiveAccuracy: number | null;
  byMarket: Array<{ market: string; graded: number; correct: number; accuracy: number }>;
};

export type PlayerPicksResponse = {
  sport: Sport;
  date: string;
  updatedAt: string;
  totalPicks: number;
  topFiveCount: number;
  hasLiveGames: boolean;
  trackingAvailable: boolean;
  performance: PlayerPickPerformance;
  /** Today's slate only: graded record so far. */
  slatePerformance?: PlayerPickPerformance;
  /** Live strip counts across the whole board (all tiers). */
  liveSummary?: LiveSummary | null;
  /** Live strip counts for the premium top five (Pro only; null for free). */
  topFiveLive?: LiveSummary | null;
  /** Whether today's board came from real sportsbook lines. */
  lineProvider?: string | null;
  recentResults: PlayerPick[];
  picks: PlayerPick[];
};

export class ApiError extends Error {
  status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const url = apiUrl(path);
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store", ...init });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network request failed";
    throw new ApiError(`Could not reach the live baseball data service. ${message}`);
  }
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Keep the status-based message when the upstream body is not JSON.
    }
    throw new ApiError(message, response.status);
  }
  return (await response.json()) as T;
}

function withQuery(path: string, values: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined) query.set(key, String(value));
  const suffix = query.toString();
  return suffix ? `${path}?${suffix}` : path;
}

export function getTodayPredictions(date?: string, sport: Sport = "mlb"): Promise<TodayPredictionsResponse> {
  return fetchJson<TodayPredictionsResponse>(withQuery("/predictions/today", { date, sport }));
}

export function getModelMetrics(sport: Sport = "mlb"): Promise<ModelMetricsResponse> {
  return fetchJson<ModelMetricsResponse>(withQuery("/metrics", { sport }));
}

export function getPredictionHistory(limit = 80, sport: Sport = "mlb"): Promise<PredictionHistoryItem[]> {
  return fetchJson<PredictionHistoryItem[]>(withQuery("/predictions/history", { limit, sport }));
}

export function getGamePrediction(gameId: string, sport: Sport = "mlb"): Promise<TeamPrediction> {
  return fetchJson<TeamPrediction>(withQuery(`/games/${encodeURIComponent(gameId)}`, { sport }));
}

export function getPlayerPicks(date?: string, sport: Sport = "mlb"): Promise<PlayerPicksResponse> {
  return fetchJson<PlayerPicksResponse>(withQuery("/player-picks", { date, sport }));
}

export function getErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof Error && error.message) return `${fallbackMessage} ${error.message}`;
  return fallbackMessage;
}

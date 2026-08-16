import { apiUrl } from "@/lib/apiConfig";

export type TeamIdentity = {
  id: number;
  name: string;
  abbreviation: string;
  primary: string;
  accent: string;
  record: string;
};

export type TeamPrediction = {
  game_id: string;
  gameId: string;
  date: string;
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
  home_win_probability: number;
  away_win_probability: number;
  prediction_source: string;
  confidence: "Lean" | "Edge" | "Strong";
  factors: string[];
  home_score: number | null;
  away_score: number | null;
};

export type TodayPredictionsResponse = {
  date: string;
  data_through: string;
  model_version: string;
  games_trained: number;
  predictions: TeamPrediction[];
};

export type ModelMetricsResponse = {
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
};

export type PredictionHistoryItem = {
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

export function getTodayPredictions(date?: string): Promise<TodayPredictionsResponse> {
  return fetchJson<TodayPredictionsResponse>(`/predictions/today${date ? `?date=${encodeURIComponent(date)}` : ""}`);
}

export function getModelMetrics(): Promise<ModelMetricsResponse> {
  return fetchJson<ModelMetricsResponse>("/metrics");
}

export function getPredictionHistory(limit = 80): Promise<PredictionHistoryItem[]> {
  return fetchJson<PredictionHistoryItem[]>(`/predictions/history?limit=${limit}`);
}

export function getGamePrediction(gameId: string): Promise<TeamPrediction> {
  return fetchJson<TeamPrediction>(`/games/${encodeURIComponent(gameId)}`);
}

export function getErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof Error && error.message) return `${fallbackMessage} ${error.message}`;
  return fallbackMessage;
}

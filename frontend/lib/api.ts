import { apiUrl } from "@/lib/apiConfig";

export type TeamPrediction = {
  game_id: string;
  home_team: string;
  away_team: string;
  game_time_utc?: string | null;
  homeProbablePitcher?: string | null;
  awayProbablePitcher?: string | null;
  home_probable_pitcher?: string | null;
  away_probable_pitcher?: string | null;
  predicted_winner: string;
  home_win_probability: number;
  away_win_probability: number;
};

export type TodayPredictionsResponse = {
  date: string;
  predictions: TeamPrediction[];
};

export type ModelMetricsResponse = {
  available: boolean;
  status: string;
  message: string | null;
  model_name: string | null;
  version: string | null;
  total_predictions_evaluated: number | null;
  correct_predictions: number | null;
  accuracy: number | null;
  brier_score: number | null;
  precision: number | null;
  recall: number | null;
  roc_auc: number | null;
  last_trained_at: string | null;
  last_results_sync: string | null;
  unresolved_predictions_remaining: number | null;
};

export type PredictionHistoryItem = {
  gameId: string;
  date: string;
  awayTeam: string;
  homeTeam: string;
  predictedWinner: string;
  actualWinner: string | null;
  homeWinProbability: number;
  awayWinProbability: number;
  wasCorrect: boolean | null;
};

export type ResultsUpdateResponse = {
  updated_predictions: number;
  finalized_predictions: number;
  correct_predictions: number;
  accuracy: number;
  model_name: string;
  version: string;
  updated_at: string;
};

type RawModelMetricsResponse = Partial<ModelMetricsResponse> & {
  model_version?: string;
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
    response = await fetch(url, {
      cache: "no-store",
      ...init
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network request failed";
    const normalized = message.toLowerCase();
    const isReachabilityIssue =
      normalized.includes("failed to fetch") ||
      normalized.includes("networkerror") ||
      normalized.includes("load failed");

    if (isReachabilityIssue) {
      throw new ApiError(`Could not reach backend at ${url}. ${message}`);
    }

    throw new ApiError(`Request to ${url} failed before a response was received. ${message}`);
  }

  if (!response.ok) {
    const rawBody = await response.text();
    const bodyMessage = rawBody.trim() ? ` - ${rawBody.trim().slice(0, 160)}` : "";
    throw new ApiError(
      `Request failed (${response.status} ${response.statusText || "Unknown Status"})${bodyMessage}`,
      response.status
    );
  }

  return (await response.json()) as T;
}

export function getTodayPredictions(): Promise<TodayPredictionsResponse> {
  return fetchJson<TodayPredictionsResponse>("/predictions/today");
}

export function getModelMetrics(): Promise<ModelMetricsResponse> {
  return fetchJson<RawModelMetricsResponse>("/metrics").then((metrics) => ({
    available: metrics.available ?? false,
    status: metrics.status ?? "unavailable",
    message: metrics.message ?? null,
    model_name: metrics.model_name ?? null,
    version: metrics.version ?? metrics.model_version ?? null,
    total_predictions_evaluated: metrics.total_predictions_evaluated ?? null,
    correct_predictions: metrics.correct_predictions ?? null,
    accuracy: metrics.accuracy ?? null,
    brier_score: metrics.brier_score ?? null,
    precision: metrics.precision ?? null,
    recall: metrics.recall ?? null,
    roc_auc: metrics.roc_auc ?? null,
    last_trained_at: metrics.last_trained_at ?? null,
    last_results_sync: metrics.last_results_sync ?? null,
    unresolved_predictions_remaining: metrics.unresolved_predictions_remaining ?? null
  }));
}

export function getPredictionHistory(): Promise<PredictionHistoryItem[]> {
  return fetchJson<PredictionHistoryItem[]>("/predictions/history");
}

export function syncCompletedResults(): Promise<ResultsUpdateResponse> {
  return fetchJson<ResultsUpdateResponse>("/results/update", {
    method: "POST"
  });
}

export function getErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof ApiError) {
    return `${fallbackMessage} ${error.message}`;
  }

  if (error instanceof Error) {
    return `${fallbackMessage} ${error.message}`;
  }

  return fallbackMessage;
}

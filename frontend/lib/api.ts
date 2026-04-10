import { apiUrl } from "@/lib/apiConfig";

export type TeamPrediction = {
  game_id: string;
  home_team: string;
  away_team: string;
  game_time_utc?: string | null;
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
  model_name: string;
  version: string;
  accuracy: number;
  precision: number;
  recall: number;
  roc_auc: number;
  last_trained_at: string;
};

export class ApiError extends Error {
  status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function fetchJson<T>(path: string): Promise<T> {
  let response: Response;

  try {
    response = await fetch(apiUrl(path), {
      cache: "no-store"
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Network request failed";
    throw new ApiError(`Could not reach backend at ${apiUrl(path)}. ${message}`);
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
  return fetchJson<ModelMetricsResponse>("/metrics");
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

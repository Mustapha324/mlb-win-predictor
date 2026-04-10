const API_BASE_URL = "http://localhost:8000/api";

export type TeamPrediction = {
  game_id: string;
  home_team: string;
  away_team: string;
  predicted_winner: string;
  win_probability: number;
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

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`);

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return (await response.json()) as T;
}

export function getTodayPredictions(): Promise<TodayPredictionsResponse> {
  return fetchJson<TodayPredictionsResponse>("/predictions/today");
}

export function getModelMetrics(): Promise<ModelMetricsResponse> {
  return fetchJson<ModelMetricsResponse>("/metrics");
}

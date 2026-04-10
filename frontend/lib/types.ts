/** Shared UI types used across dashboard pages. */
export type GamePredictionCardData = {
  awayTeamName: string;
  homeTeamName: string;
  startTimeLabel: string;
  predictedWinnerTeam: string;
  confidencePercent: number;
};

/** Metric card values displayed in the metrics dashboard view. */
export type DashboardMetricCardData = {
  metricLabel: string;
  metricValue: string;
  metricTrend: string;
};

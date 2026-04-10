import type { DashboardMetricCardData, GamePredictionCardData } from "@/lib/types";

/** Example daily picks used until live API integration is enabled. */
export const featuredPredictions: GamePredictionCardData[] = [
  {
    awayTeamName: "New York Yankees",
    homeTeamName: "Boston Red Sox",
    startTimeLabel: "7:05 PM ET",
    predictedWinnerTeam: "New York Yankees",
    confidencePercent: 62
  },
  {
    awayTeamName: "Los Angeles Dodgers",
    homeTeamName: "San Diego Padres",
    startTimeLabel: "9:40 PM ET",
    predictedWinnerTeam: "Los Angeles Dodgers",
    confidencePercent: 58
  },
  {
    awayTeamName: "Atlanta Braves",
    homeTeamName: "Philadelphia Phillies",
    startTimeLabel: "6:45 PM ET",
    predictedWinnerTeam: "Philadelphia Phillies",
    confidencePercent: 55
  }
];

/** Example historical picks used for the history page. */
export const historicalPredictions: GamePredictionCardData[] = [
  {
    awayTeamName: "Chicago Cubs",
    homeTeamName: "Milwaukee Brewers",
    startTimeLabel: "Yesterday · Final",
    predictedWinnerTeam: "Milwaukee Brewers",
    confidencePercent: 61
  },
  {
    awayTeamName: "Seattle Mariners",
    homeTeamName: "Houston Astros",
    startTimeLabel: "2 days ago · Final",
    predictedWinnerTeam: "Houston Astros",
    confidencePercent: 57
  },
  {
    awayTeamName: "Cleveland Guardians",
    homeTeamName: "Minnesota Twins",
    startTimeLabel: "3 days ago · Final",
    predictedWinnerTeam: "Cleveland Guardians",
    confidencePercent: 54
  }
];

/** Example model metrics shown in the metrics page. */
export const dashboardMetrics: DashboardMetricCardData[] = [
  { metricLabel: "Model Accuracy", metricValue: "63.4%", metricTrend: "+1.8% vs last 7 days" },
  { metricLabel: "Games Predicted", metricValue: "1,248", metricTrend: "102 this week" },
  { metricLabel: "Avg Confidence", metricValue: "58.9%", metricTrend: "Stable this month" }
];

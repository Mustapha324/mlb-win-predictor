export type GameDetail = {
  game_id: string;
  game_time: string;
  teams: {
    away: string;
    home: string;
  };
  probable_pitchers: {
    away: string;
    home: string;
  };
  predicted_probabilities: {
    away_win: number;
    home_win: number;
  };
  actual_result: {
    status: string;
    winner: string | null;
    away_runs: number | null;
    home_runs: number | null;
  } | null;
  feature_values: Record<string, number | string | null>;
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export async function getGameById(gameId: string): Promise<GameDetail | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/games/${gameId}`, {
      cache: "no-store"
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as GameDetail;
  } catch {
    return null;
  }
}

export async function getFeaturedGames(): Promise<GameDetail[]> {
  const gameIds = ["20260410-nyy-bos", "20260410-lad-sf"];
  const results = await Promise.all(gameIds.map((id) => getGameById(id)));
  return results.filter((game): game is GameDetail => Boolean(game));
}

export function summarizeLeanFactors(featureValues: GameDetail["feature_values"]): string[] {
  const differentialFeatures = Object.entries(featureValues)
    .filter(([feature, value]) => feature.endsWith("_diff") && typeof value === "number")
    .map(([feature, value]) => ({
      feature,
      value
    }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

  return differentialFeatures.slice(0, 4).map(({ feature, value }) => {
    const direction = value > 0 ? "away side" : "home side";
    return `${feature}: ${value.toFixed(2)} (${direction})`;
  });
}

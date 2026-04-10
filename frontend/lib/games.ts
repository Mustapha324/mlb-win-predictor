import { BACKEND_BASE_URL } from "@/lib/apiConfig";

export type GameDetail = {
  gameId: string;
  date: string;
  status: string;
  awayTeam: string;
  homeTeam: string;
  awayProbablePitcher: string;
  homeProbablePitcher: string;
  awayWinProbability: number | null;
  homeWinProbability: number | null;
  predictedWinner: string;
  awayTeamRecord: string;
  homeTeamRecord: string;
  awayTeamBattingAverage: number | null;
  homeTeamBattingAverage: number | null;
  awayTeamEra: number | null;
  homeTeamEra: number | null;
};

export async function getGameById(gameId: string): Promise<GameDetail | null> {
  try {
    const response = await fetch(`${BACKEND_BASE_URL}/api/games/${gameId}`, {
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

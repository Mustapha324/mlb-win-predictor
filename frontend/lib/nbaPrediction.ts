/** Pure NBA pregame rating math. Ratings are updated only after completed games. */
export type NbaResult = { id: string; date: string; homeId: string; awayId: string; homeScore: number; awayScore: number };

const BASE = 1500;
// Chosen on 2024-25 walk-forward log loss; 2025-26 was held out.
const HOME_EDGE = 40;
const K = 30;

export function winProbability(homeRating: number, awayRating: number): number {
  return 1 / (1 + 10 ** ((awayRating - homeRating - HOME_EDGE) / 400));
}

export function ratingsBefore(results: NbaResult[], cutoff: string): Map<string, number> {
  const ratings = new Map<string, number>();
  const ordered = results.filter((game) => game.date < cutoff).toSorted((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  for (const game of ordered) {
    if (game.homeScore === game.awayScore) continue;
    const home = ratings.get(game.homeId) ?? BASE;
    const away = ratings.get(game.awayId) ?? BASE;
    const delta = K * ((game.homeScore > game.awayScore ? 1 : 0) - winProbability(home, away));
    ratings.set(game.homeId, home + delta);
    ratings.set(game.awayId, away - delta);
  }
  return ratings;
}

export function modelProbability(ratings: Map<string, number>, homeId: string, awayId: string): number | null {
  if (!ratings.has(homeId) || !ratings.has(awayId)) return null;
  return Math.max(0.1, Math.min(0.9, winProbability(ratings.get(homeId)!, ratings.get(awayId)!)));
}
